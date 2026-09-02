// Titan Season Mode — round sourcing / anti-cheat ingestion (Dave, 2026-09-06).
// A Season round is never entered separately. Any completed casual round,
// Titan Tour tournament round (both live in matches/match_holes — a
// tournament round is just a casual-shaped match with competition_id set),
// or Swindle round (swindle_groups/swindle_scores) that a Season entrant
// played counts automatically, PROVIDED it wasn't played solo and at least
// one of the other players is a real, identifiable Titan Golf account who
// belongs to the same society. Guests, made-up names, and playing alone
// never qualify — that's the whole anti-cheating check. There is no
// separate manual "partner taps verify" step (unlike the original spec's
// §12) — the fact that it's a real multiplayer round recorded through the
// app's existing scoring flows, with a real identifiable co-player, IS the
// verification. Dave's call, 2026-09-06.
//
// Idempotent by design (spec §20.2): every ingested season_round traces back
// to its source match/swindle group via a unique index (see migration
// 20260906000000), so re-running this for a player is always safe — already
// -ingested rounds are simply skipped, never duplicated.
import { supabase, fetchAllRows } from './supabase';
import { fetchCourseTees } from '../components/TeePickerSheet';
import {
  calcSeasonPlayingHandicap, calcSeasonRound, resolveMajorRound, selectCountingRounds,
  qualificationStatus, DEFAULT_SEASON_SCORING_PROFILE, type SeasonScoringProfile, type SeasonHoleInput,
} from './seasonScoring';
import { rankDivisionEntries } from './seasonLeaderboard';
import { sendPushNotification } from './notifications';

interface ResolvedRoundSource {
  sourceMatchId: string | null;
  sourceSwindleGroupId: string | null;
  courseName: string;
  playedAt: string; // ISO
  otherPlayerIds: string[]; // real, non-guest player_ids only, excludes the target player
  handicapIndex: number;
  courseRating: number;
  slopeRating: number;
  teeName: string | null;
  teeGender: string | null;
  holes: SeasonHoleInput[]; // only ever built if all 18 holes have a gross score
}

async function fetchSocietyMemberIds(societyId: string): Promise<Set<string>> {
  const { data } = await supabase.from('society_members').select('player_id').eq('society_id', societyId);
  return new Set((data ?? []).map((r: any) => r.player_id as string));
}

async function fetchAlreadyIngestedSourceIds(seasonEntryId: string): Promise<{ matchIds: Set<string>; swindleGroupIds: Set<string> }> {
  const { data } = await supabase
    .from('season_rounds')
    .select('source_match_id, source_swindle_group_id')
    .eq('season_entry_id', seasonEntryId);
  const matchIds = new Set<string>();
  const swindleGroupIds = new Set<string>();
  for (const r of (data ?? []) as any[]) {
    if (r.source_match_id) matchIds.add(r.source_match_id);
    if (r.source_swindle_group_id) swindleGroupIds.add(r.source_swindle_group_id);
  }
  return { matchIds, swindleGroupIds };
}

async function fetchHolesByCourse(courseNames: string[]): Promise<Record<string, { hole_number: number; par: number; stroke_index: number }[]>> {
  if (courseNames.length === 0) return {};
  const rows = await fetchAllRows<{ course_name: string; hole_number: number; par: number; stroke_index: number }>(
    (from, to) => supabase.from('course_holes').select('course_name, hole_number, par, stroke_index').in('course_name', courseNames).range(from, to)
  );
  const byCourse: Record<string, { hole_number: number; par: number; stroke_index: number }[]> = {};
  for (const r of rows) {
    (byCourse[r.course_name] ??= []).push({ hole_number: r.hole_number, par: r.par, stroke_index: r.stroke_index });
  }
  return byCourse;
}

// ── Casual + Tournament rounds (matches/match_holes) ───────────────────────
async function resolveMatchSources(
  playerId: string, startAt: string, endAt: string, excludeMatchIds: Set<string>,
): Promise<ResolvedRoundSource[]> {
  const { data: matchRows } = await supabase
    .from('matches')
    .select('id, day_id, course_name, home_player_ids, away_player_ids, completed_at')
    .or(`home_player_ids.cs.{${playerId}},away_player_ids.cs.{${playerId}}`)
    .eq('status', 'complete')
    .not('course_name', 'is', null)
    .gte('completed_at', startAt)
    .lte('completed_at', endAt);

  const candidates = ((matchRows ?? []) as any[]).filter(m => !excludeMatchIds.has(m.id));
  if (candidates.length === 0) return [];

  const matchIds = candidates.map(c => c.id);
  const dayIds = [...new Set(candidates.map(c => c.day_id).filter((id): id is string => id != null))];
  const courseNames = [...new Set(candidates.map(c => c.course_name as string))];

  const [holeRows, snapshotRows, courseHolesByName, playerRow] = await Promise.all([
    fetchAllRows<{ match_id: string; hole_number: number; gross_score: number | null }>(
      (from, to) => supabase.from('match_holes').select('match_id, hole_number, gross_score').in('match_id', matchIds).eq('player_id', playerId).range(from, to)
    ),
    dayIds.length
      ? supabase.from('round_player_tees').select('day_id, tee_name, gender, handicap_index_at_start, course_rating_at_start, slope_at_start').in('day_id', dayIds).eq('player_id', playerId).then(r => r.data ?? [])
      : Promise.resolve([] as any[]),
    fetchHolesByCourse(courseNames),
    supabase.from('players').select('handicap_index').eq('id', playerId).maybeSingle().then(r => r.data as any),
  ]);

  const grossByMatch: Record<string, Record<number, number>> = {};
  for (const h of holeRows) {
    if (h.gross_score == null) continue;
    (grossByMatch[h.match_id] ??= {})[h.hole_number] = h.gross_score;
  }

  const snapshotByDay: Record<string, any> = {};
  for (const s of snapshotRows as any[]) snapshotByDay[s.day_id] = s;

  // Fallback rating/slope when no WHS snapshot exists for the round —
  // averaged across the course's tees, same approach the suggested-handicap
  // engine uses, since the exact tee played isn't recorded when WHS is off.
  const fallbackRatingByCourse: Record<string, { rating: number; slope: number } | null> = {};
  const needsFallback = candidates.filter(c => !snapshotByDay[c.day_id]).map(c => c.course_name as string);
  await Promise.all([...new Set(needsFallback)].map(async name => {
    const tees = await fetchCourseTees(name);
    const rated = tees.filter(t => t.course_rating != null && t.slope_rating != null);
    fallbackRatingByCourse[name] = rated.length === 0 ? null : {
      rating: rated.reduce((a, t) => a + t.course_rating!, 0) / rated.length,
      slope: rated.reduce((a, t) => a + t.slope_rating!, 0) / rated.length,
    };
  }));

  const out: ResolvedRoundSource[] = [];
  for (const m of candidates) {
    const courseHoles = courseHolesByName[m.course_name];
    if (!courseHoles || courseHoles.length < 18) continue;
    const gross = grossByMatch[m.id];
    if (!gross || Object.keys(gross).length !== 18) continue; // full 18-hole gross required, spec §7.1

    const otherPlayerIds = [...new Set([...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])])].filter(id => id !== playerId);
    const snapshot = snapshotByDay[m.day_id];
    const fallback = fallbackRatingByCourse[m.course_name];
    const rating = snapshot?.course_rating_at_start ?? fallback?.rating;
    const slope = snapshot?.slope_at_start ?? fallback?.slope;
    if (rating == null || slope == null) continue; // no rating data available — can't score this round

    out.push({
      sourceMatchId: m.id, sourceSwindleGroupId: null,
      courseName: m.course_name, playedAt: m.completed_at,
      otherPlayerIds,
      handicapIndex: snapshot?.handicap_index_at_start ?? playerRow?.handicap_index ?? 0,
      courseRating: Number(rating), slopeRating: Number(slope),
      teeName: snapshot?.tee_name ?? null, teeGender: snapshot?.gender ?? null,
      holes: courseHoles.map(h => ({ holeNumber: h.hole_number, par: h.par, strokeIndex: h.stroke_index, grossScore: gross[h.hole_number] })),
    });
  }
  return out;
}

// ── Swindle rounds (swindle_groups/swindle_scores) ─────────────────────────
async function resolveSwindleSources(
  playerId: string, startAt: string, endAt: string, excludeGroupIds: Set<string>,
): Promise<ResolvedRoundSource[]> {
  const { data: myGroupRows } = await supabase
    .from('swindle_group_players').select('group_id').eq('player_id', playerId).eq('is_guest', false);
  const groupIds = [...new Set((myGroupRows ?? []).map((r: any) => r.group_id as string))].filter(id => !excludeGroupIds.has(id));
  if (groupIds.length === 0) return [];

  const { data: groupRows } = await supabase.from('swindle_groups').select('id, game_id').in('id', groupIds);
  const groups = (groupRows ?? []) as { id: string; game_id: string }[];
  if (groups.length === 0) return [];
  const gameIds = [...new Set(groups.map(g => g.game_id))];

  const { data: gameRows } = await supabase
    .from('swindle_games')
    .select('id, course_name, course_rating, slope_rating, game_date, status')
    .in('id', gameIds).eq('status', 'complete')
    .gte('game_date', startAt).lte('game_date', endAt);
  const gamesById = new Map(((gameRows ?? []) as any[]).map(g => [g.id, g]));
  const qualifyingGroups = groups.filter(g => gamesById.has(g.game_id));
  if (qualifyingGroups.length === 0) return [];

  const qualifyingGroupIds = qualifyingGroups.map(g => g.id);
  const qualifyingGameIds = [...new Set(qualifyingGroups.map(g => g.game_id))];
  const courseNames = [...new Set(qualifyingGroups.map(g => gamesById.get(g.game_id).course_name as string).filter(Boolean))];

  const [otherPlayerRows, entryRows, scoreRows, courseHolesByName] = await Promise.all([
    supabase.from('swindle_group_players').select('group_id, player_id').in('group_id', qualifyingGroupIds).eq('is_guest', false).neq('player_id', playerId).then(r => r.data ?? []),
    supabase.from('swindle_entries').select('game_id, handicap').in('game_id', qualifyingGameIds).eq('player_id', playerId).then(r => r.data ?? []),
    fetchAllRows<{ game_id: string; hole_number: number; gross_score: number | null }>(
      (from, to) => supabase.from('swindle_scores').select('game_id, hole_number, gross_score').in('game_id', qualifyingGameIds).eq('player_id', playerId).range(from, to)
    ),
    fetchHolesByCourse(courseNames),
  ]);

  const otherPlayersByGroup: Record<string, string[]> = {};
  for (const r of otherPlayerRows as any[]) (otherPlayersByGroup[r.group_id] ??= []).push(r.player_id);

  const handicapByGame: Record<string, number> = {};
  for (const r of entryRows as any[]) handicapByGame[r.game_id] = Number(r.handicap);

  const grossByGame: Record<string, Record<number, number>> = {};
  for (const r of scoreRows) {
    if (r.gross_score == null) continue;
    (grossByGame[r.game_id] ??= {})[r.hole_number] = r.gross_score;
  }

  const out: ResolvedRoundSource[] = [];
  for (const g of qualifyingGroups) {
    const game = gamesById.get(g.game_id);
    const courseHoles = courseHolesByName[game.course_name];
    if (!courseHoles || courseHoles.length < 18) continue;
    const gross = grossByGame[g.game_id];
    if (!gross || Object.keys(gross).length !== 18) continue;
    if (game.course_rating == null || game.slope_rating == null) continue;
    const otherPlayerIds = otherPlayersByGroup[g.id] ?? [];

    out.push({
      sourceMatchId: null, sourceSwindleGroupId: g.id,
      courseName: game.course_name, playedAt: new Date(game.game_date).toISOString(),
      otherPlayerIds,
      handicapIndex: handicapByGame[g.game_id] ?? 0,
      courseRating: Number(game.course_rating), slopeRating: Number(game.slope_rating),
      teeName: null, teeGender: null,
      holes: courseHoles.map(h => ({ holeNumber: h.hole_number, par: h.par, strokeIndex: h.stroke_index, grossScore: gross[h.hole_number] })),
    });
  }
  return out;
}

// ── Ingest one resolved source into season_rounds/season_hole_scores ───────
async function ingestRound(
  seasonEntryId: string, seasonId: string, src: ResolvedRoundSource,
  handicapAllowancePercent: number, par: number, profile: SeasonScoringProfile,
): Promise<void> {
  const playingHandicap = calcSeasonPlayingHandicap(src.handicapIndex, src.slopeRating, src.courseRating, par, handicapAllowancePercent);
  const result = calcSeasonRound(src.holes, playingHandicap, { profile });

  const { data: round, error } = await supabase.from('season_rounds').insert({
    season_id: seasonId, season_entry_id: seasonEntryId,
    source_match_id: src.sourceMatchId, source_swindle_group_id: src.sourceSwindleGroupId,
    course_name: src.courseName, tee_name: src.teeName, tee_gender: src.teeGender,
    group_player_ids: src.otherPlayerIds,
    played_at: src.playedAt, submitted_at: src.playedAt, verified_at: src.playedAt,
    handicap_index_snapshot: src.handicapIndex, course_rating_snapshot: src.courseRating,
    slope_snapshot: src.slopeRating, par_snapshot: par,
    handicap_allowance_percent: handicapAllowancePercent, playing_handicap_snapshot: playingHandicap,
    stableford_total: result.stablefordTotal, performance_bonus: result.performanceBonus,
    gross_achievement_bonus: result.grossAchievementBonus, base_titan_round_points: result.baseTitanRoundPoints,
    final_round_points: result.baseTitanRoundPoints, // Major multiplier resolved separately, see recalculateSeasonEntry
    status: 'scored', is_qualifying: true, is_counting: false,
  } as any).select('id').single();
  if (error || !round) { console.error('[seasonRoundIngestion] insert failed', error); return; }

  const holeRows = result.holes.map(h => ({
    round_id: (round as any).id, hole_number: h.holeNumber, par: h.par, stroke_index: h.strokeIndex,
    gross_score: h.grossScore, handicap_strokes_received: h.handicapStrokesReceived,
    net_score: h.netScore, net_relative_to_par: h.netRelativeToPar, stableford_points: h.stablefordPoints,
    gross_relative_to_par: h.grossRelativeToPar, gross_achievement_type: h.grossAchievementType,
    gross_bonus_points: h.grossBonusPoints,
  }));
  await supabase.from('season_hole_scores').insert(holeRows as any);
}

// ── Major reassignment + Best 20 + live position/notifications ─────────────
// spec §20.3's dependency order: resolve Major → recalc Best 20 → recalc
// league position → zone/status changes → notifications. Simplification:
// only the notification moments listed in spec §15 that this data already
// supports are wired up (counting score, position move, promotion/
// relegation zone entry, qualification reached) — verification-pending and
// Major-countdown/result notifications don't apply to this app's simplified
// anti-cheat model or aren't built yet.
async function recalculateSeasonEntry(seasonEntryId: string, seasonId: string, countingLimit: number, minimumQualifyingRounds: number): Promise<void> {
  const [{ data: entry }, { data: rounds }, { data: majors }] = await Promise.all([
    supabase.from('season_entries').select('player_id, division_id, current_position, movement_status, qualification_status, counting_rounds_count')
      .eq('id', seasonEntryId).maybeSingle(),
    supabase.from('season_rounds').select('id, played_at, base_titan_round_points, major_id')
      .eq('season_entry_id', seasonEntryId).eq('is_qualifying', true).not('status', 'in', '(void,rejected,disputed)'),
    supabase.from('season_majors').select('id, start_at, end_at').eq('season_id', seasonId),
  ]);
  const entryRow = entry as { player_id: string; division_id: string | null; current_position: number | null; movement_status: string | null; qualification_status: string; counting_rounds_count: number } | null;
  const roundRows = (rounds ?? []) as { id: string; played_at: string; base_titan_round_points: number; major_id: string | null }[];
  if (!entryRow || roundRows.length === 0) return;

  // Resolve each Major window independently — only the entry's single best
  // Base Titan Round Points inside that window gets the multiplier.
  const finalPointsByRound: Record<string, number> = {};
  const majorIdByRound: Record<string, string | null> = {};
  for (const r of roundRows) { finalPointsByRound[r.id] = r.base_titan_round_points; majorIdByRound[r.id] = null; }

  for (const major of (majors ?? []) as { id: string; start_at: string; end_at: string }[]) {
    const inWindow = roundRows.filter(r => r.played_at >= major.start_at && r.played_at <= major.end_at);
    if (inWindow.length === 0) continue;
    for (const r of inWindow) majorIdByRound[r.id] = major.id;
    const winnerId = resolveMajorRound(inWindow.map(r => ({ roundId: r.id, baseTitanRoundPoints: r.base_titan_round_points, playedAt: r.played_at })));
    if (winnerId) {
      const winner = inWindow.find(r => r.id === winnerId)!;
      finalPointsByRound[winnerId] = Math.round(winner.base_titan_round_points * 1.5);
    }
  }

  const best = selectCountingRounds(
    roundRows.map(r => ({ roundId: r.id, finalRoundPoints: finalPointsByRound[r.id], playedAt: r.played_at })),
    countingLimit,
  );
  const countingIds = new Set(best.counting.map(r => r.roundId));

  await Promise.all(roundRows.map(r => supabase.from('season_rounds').update({
    final_round_points: finalPointsByRound[r.id],
    major_id: majorIdByRound[r.id],
    major_multiplier: finalPointsByRound[r.id] !== r.base_titan_round_points ? 1.5 : null,
    is_counting: countingIds.has(r.id),
  } as any).eq('id', r.id)));

  const newQualificationStatus = qualificationStatus(roundRows.length, minimumQualifyingRounds);

  // Live position/zone within the division — spec §16.1's "Next Score To
  // Beat" dashboard needs this even mid-season, not just at Season Close.
  // Skipped entirely until divisions are published (division_id null).
  let newPosition: number | null = null;
  let newMovementStatus: string | null = null;
  if (entryRow.division_id) {
    const { data: division } = await supabase.from('season_divisions').select('promotion_places, relegation_places').eq('id', entryRow.division_id).maybeSingle();
    const { data: siblings } = await supabase.from('season_entries').select('id, season_points, qualification_status').eq('division_id', entryRow.division_id);
    const siblingRows = (siblings ?? []) as { id: string; season_points: number; qualification_status: string }[];
    const siblingIds = siblingRows.map(s => s.id);
    const { data: siblingCounting } = siblingIds.length
      ? await supabase.from('season_rounds').select('season_entry_id, final_round_points').in('season_entry_id', siblingIds).eq('is_counting', true)
      : { data: [] as any[] };
    const pointsBySibling: Record<string, number[]> = {};
    for (const r of (siblingCounting ?? []) as any[]) (pointsBySibling[r.season_entry_id] ??= []).push(r.final_round_points);
    // This entry's own just-recalculated numbers may not be in siblingRows
    // yet if this is its very first round — fold them in explicitly.
    const withSelf = siblingRows.some(s => s.id === seasonEntryId)
      ? siblingRows.map(s => s.id === seasonEntryId ? { ...s, season_points: best.seasonPoints, qualification_status: newQualificationStatus } : s)
      : [...siblingRows, { id: seasonEntryId, season_points: best.seasonPoints, qualification_status: newQualificationStatus }];
    const ranked = rankDivisionEntries(
      withSelf.map(s => ({
        entryId: s.id, seasonPoints: s.season_points, qualificationStatus: s.qualification_status as any,
        countingRoundPoints: s.id === seasonEntryId ? best.counting.map(r => r.finalRoundPoints) : (pointsBySibling[s.id] ?? []),
      })),
      (division as any)?.promotion_places ?? 0, (division as any)?.relegation_places ?? 0,
    );
    const mine = ranked.find(r => r.entryId === seasonEntryId);
    newPosition = mine?.position ?? null;
    newMovementStatus = mine?.movementStatus ?? null;
  }

  await supabase.from('season_entries').update({
    qualifying_rounds_count: roundRows.length,
    counting_rounds_count: best.counting.length,
    season_points: best.seasonPoints,
    qualification_status: newQualificationStatus,
    previous_position: entryRow.current_position,
    current_position: newPosition,
    movement_status: newMovementStatus,
  } as any).eq('id', seasonEntryId);

  // ── Notifications (spec §15) — only fire on a genuine change, never on
  // every sync, so a player isn't pushed every time they simply reopen the
  // Season tab with nothing new to report.
  const notifications: string[] = [];
  if (best.counting.length > entryRow.counting_rounds_count) {
    notifications.push(`Your latest round entered your Best 20 — Season Points: ${best.seasonPoints}.`);
  }
  if (newPosition != null && entryRow.current_position != null && newPosition !== entryRow.current_position) {
    notifications.push(newPosition < entryRow.current_position
      ? `You moved up to ${newPosition}${ordinalSuffix(newPosition)} place.`
      : `You moved down to ${newPosition}${ordinalSuffix(newPosition)} place.`);
  }
  const wasInZone = entryRow.movement_status === 'promotion' || entryRow.movement_status === 'champion';
  const nowInZone = newMovementStatus === 'promotion' || newMovementStatus === 'champion';
  if (!wasInZone && nowInZone) notifications.push('You are now in the promotion places.');
  if (entryRow.movement_status !== 'relegation' && newMovementStatus === 'relegation') notifications.push('You are now in the relegation zone.');
  if (entryRow.qualification_status === 'provisional' && newQualificationStatus === 'qualified') {
    notifications.push(`You've completed your ${minimumQualifyingRounds}/${minimumQualifyingRounds} qualifying rounds.`);
  }
  if (notifications.length > 0) {
    sendPushNotification('Titan Season', notifications.join(' '), [entryRow.player_id]); // fire-and-forget
  }
}

function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  switch (n % 10) { case 1: return 'st'; case 2: return 'nd'; case 3: return 'rd'; default: return 'th'; }
}

export interface SyncSummary { ingested: number; skipped: number; }

// The one public entry point — call whenever a Season entrant opens the
// Season section. Pulls any newly-completed casual/tournament/Swindle
// rounds they played with a real, identifiable co-player from the same
// society, scores them, and recalculates their Best 20 + Majors.
export async function syncSeasonRoundsForEntry(
  seasonEntryId: string, playerId: string,
  season: { id: string; societyId: string; startAt: string; endAt: string; handicapAllowancePercent: number; countingRoundLimit: number; minimumQualifyingRounds: number },
  profile: SeasonScoringProfile = DEFAULT_SEASON_SCORING_PROFILE,
): Promise<SyncSummary> {
  const [societyMemberIds, alreadyIngested] = await Promise.all([
    fetchSocietyMemberIds(season.societyId),
    fetchAlreadyIngestedSourceIds(seasonEntryId),
  ]);

  const [matchSources, swindleSources] = await Promise.all([
    resolveMatchSources(playerId, season.startAt, season.endAt, alreadyIngested.matchIds),
    resolveSwindleSources(playerId, season.startAt, season.endAt, alreadyIngested.swindleGroupIds),
  ]);

  let ingested = 0, skipped = 0;
  for (const src of [...matchSources, ...swindleSources]) {
    // The anti-cheating check: not solo, and at least one real co-player is
    // a member of the same society this Season belongs to.
    const eligible = src.otherPlayerIds.some(id => societyMemberIds.has(id));
    if (!eligible) { skipped++; continue; }
    const par = src.holes.reduce((sum, h) => sum + h.par, 0);
    await ingestRound(seasonEntryId, season.id, src, season.handicapAllowancePercent, par, profile);
    ingested++;
  }

  if (ingested > 0) {
    await recalculateSeasonEntry(seasonEntryId, season.id, season.countingRoundLimit, season.minimumQualifyingRounds);
  }
  return { ingested, skipped };
}
