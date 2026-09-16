// One-off backfill (Dave, 2026-09-15): "anyone that is in season mode and
// was in a round over the weekend must be added". Season Mode's round
// ingestion (src/lib/seasonRoundIngestion.ts) never actually worked for any
// casual/tournament round since it was built 2026-09-06 — it queried
// matches.course_name, a column that has never existed (course_name lives on
// competition_days), and the missing error check silently turned every
// failed query into "no rounds found" for every player, forever. Fixed
// 2026-09-15 (same session). That fix only applies going forward — it can't
// retroactively ingest rounds already played, since the app only syncs a
// player's OWN rounds when THEY personally open their own Season tab. This
// script runs the exact same resolve -> ingest -> recalculate pipeline
// server-side, once, for every active season entrant, so nobody has to
// individually reopen the tab to catch up.
//
// Mirrors src/lib/seasonRoundIngestion.ts's logic faithfully (same
// eligibility rules, same scoring functions) but can't import that module
// directly — it pulls in the app's own supabase client (src/lib/supabase.ts),
// which drags in react-native-url-polyfill/AsyncStorage and doesn't run
// under plain Node. Uses a fresh service-role client instead, same pattern
// as scripts/seed_titan_way_sim.mts. Only reuses the PURE calculation
// functions (seasonScoring.ts, scoring.ts, whs.ts — none of them import
// supabase or any RN package), never re-derives the scoring math by hand.
//
// Additive + idempotent, same as the real ingestion path: every season_round
// traces back to its source match/swindle group via a unique index, so
// re-running this is always safe.
//
// Run with: node scripts/backfill_season_rounds.mts

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import {
  calcSeasonPlayingHandicap, calcSeasonRound, selectCountingRounds, resolveMajorRound,
  qualificationStatus, DEFAULT_SEASON_SCORING_PROFILE, type SeasonHoleInput,
} from '../src/lib/seasonScoring.ts';

const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const env: Record<string, string> = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchAllRows<T>(query: (from: number, to: number) => Promise<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await query(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function fetchCourseTees(courseName: string) {
  const { data } = await supabase.from('course_tees').select('tee_name, gender, par, course_rating, slope_rating').eq('course_name', courseName);
  return data ?? [];
}

async function fetchHolesByCourse(courseNames: string[]) {
  if (courseNames.length === 0) return {} as Record<string, { hole_number: number; par: number; stroke_index: number }[]>;
  const rows = await fetchAllRows<any>((from, to) =>
    supabase.from('course_holes').select('course_name, hole_number, par, stroke_index').in('course_name', courseNames).range(from, to) as any
  );
  const byCourse: Record<string, { hole_number: number; par: number; stroke_index: number }[]> = {};
  for (const r of rows) (byCourse[r.course_name] ??= []).push({ hole_number: r.hole_number, par: r.par, stroke_index: r.stroke_index });
  return byCourse;
}

interface ResolvedRoundSource {
  sourceMatchId: string | null; sourceSwindleGroupId: string | null;
  courseName: string; playedAt: string; otherPlayerIds: string[]; hasGuest: boolean;
  handicapIndex: number; courseRating: number; slopeRating: number;
  teeName: string | null; teeGender: string | null; holes: SeasonHoleInput[];
}

async function resolveMatchSources(playerId: string, startAt: string, endAt: string, excludeMatchIds: Set<string>): Promise<ResolvedRoundSource[]> {
  const { data: matchRows, error } = await supabase
    .from('matches')
    .select('id, day_id, home_player_ids, away_player_ids, completed_at, competition_days(course_name)')
    .or(`home_player_ids.cs.{${playerId}},away_player_ids.cs.{${playerId}}`)
    .eq('status', 'complete').gte('completed_at', startAt).lte('completed_at', endAt);
  if (error) throw error;

  const withCourse = ((matchRows ?? []) as any[])
    .map(m => ({ ...m, course_name: m.competition_days?.course_name ?? null }))
    .filter(m => m.course_name != null);
  const candidates = withCourse.filter(m => !excludeMatchIds.has(m.id));
  if (candidates.length === 0) return [];

  const matchIds = candidates.map(c => c.id);
  const dayIds = [...new Set(candidates.map(c => c.day_id).filter((id): id is string => id != null))];
  const courseNames = [...new Set(candidates.map(c => c.course_name as string))];
  // Guests are real `players` rows (is_guest=true) mixed into
  // home_player_ids/away_player_ids indistinguishably from real accounts —
  // keep this in sync with src/lib/seasonRoundIngestion.ts (Dave, 2026-09-16:
  // "rounds with guests dont count").
  const allOtherIds = [...new Set(candidates.flatMap(c => [...(c.home_player_ids ?? []), ...(c.away_player_ids ?? [])]).filter((id: string) => id !== playerId))];

  const [holeRows, snapshotRows, courseHolesByName, playerRow, guestRows] = await Promise.all([
    fetchAllRows<any>((from, to) => supabase.from('match_holes').select('match_id, hole_number, gross_score').in('match_id', matchIds).eq('player_id', playerId).range(from, to) as any),
    dayIds.length
      ? supabase.from('round_player_tees').select('day_id, tee_name, gender, handicap_index_at_start, course_rating_at_start, slope_at_start').in('day_id', dayIds).eq('player_id', playerId).then(r => r.data ?? [])
      : Promise.resolve([] as any[]),
    fetchHolesByCourse(courseNames),
    supabase.from('players').select('handicap_index').eq('id', playerId).maybeSingle().then(r => r.data as any),
    allOtherIds.length
      ? supabase.from('players').select('id, is_guest').in('id', allOtherIds).then(r => r.data ?? [])
      : Promise.resolve([] as any[]),
  ]);
  const guestIds = new Set(((guestRows ?? []) as any[]).filter(p => p.is_guest).map(p => p.id as string));

  const grossByMatch: Record<string, Record<number, number>> = {};
  for (const h of holeRows as any[]) { if (h.gross_score == null) continue; (grossByMatch[h.match_id] ??= {})[h.hole_number] = h.gross_score; }
  const snapshotByDay: Record<string, any> = {};
  for (const s of snapshotRows as any[]) snapshotByDay[s.day_id] = s;

  const fallbackRatingByCourse: Record<string, { rating: number; slope: number } | null> = {};
  const needsFallback = candidates
    .filter(c => { const s = snapshotByDay[c.day_id]; return !s || s.course_rating_at_start == null || s.slope_at_start == null; })
    .map(c => c.course_name as string);
  await Promise.all([...new Set(needsFallback)].map(async name => {
    const tees = await fetchCourseTees(name);
    const rated = tees.filter((t: any) => t.course_rating != null && t.slope_rating != null);
    fallbackRatingByCourse[name] = rated.length === 0 ? null : {
      rating: rated.reduce((a: number, t: any) => a + t.course_rating, 0) / rated.length,
      slope: Math.round(rated.reduce((a: number, t: any) => a + t.slope_rating, 0) / rated.length),
    };
  }));

  const out: ResolvedRoundSource[] = [];
  for (const m of candidates) {
    const courseHoles = courseHolesByName[m.course_name];
    if (!courseHoles || courseHoles.length < 18) continue;
    const gross = grossByMatch[m.id];
    if (!gross || Object.keys(gross).length !== 18) continue;

    const otherPlayerIds = [...new Set([...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])])].filter(id => id !== playerId);
    const snapshot = snapshotByDay[m.day_id];
    const fallback = fallbackRatingByCourse[m.course_name];
    const rating = snapshot?.course_rating_at_start ?? fallback?.rating;
    const slope = snapshot?.slope_at_start ?? fallback?.slope;
    if (rating == null || slope == null) continue;

    out.push({
      sourceMatchId: m.id, sourceSwindleGroupId: null, courseName: m.course_name, playedAt: m.completed_at,
      otherPlayerIds, hasGuest: otherPlayerIds.some(id => guestIds.has(id)),
      handicapIndex: snapshot?.handicap_index_at_start ?? playerRow?.handicap_index ?? 0,
      courseRating: Number(rating), slopeRating: Number(slope),
      teeName: snapshot?.tee_name ?? null, teeGender: snapshot?.gender ?? null,
      holes: courseHoles.map(h => ({ holeNumber: h.hole_number, par: h.par, strokeIndex: h.stroke_index, grossScore: gross[h.hole_number] })),
    });
  }
  return out;
}

async function resolveSwindleSources(playerId: string, startAt: string, endAt: string, excludeGroupIds: Set<string>): Promise<ResolvedRoundSource[]> {
  const { data: myGroupRows } = await supabase.from('swindle_group_players').select('group_id').eq('player_id', playerId).eq('is_guest', false);
  const groupIds = [...new Set((myGroupRows ?? []).map((r: any) => r.group_id as string))].filter(id => !excludeGroupIds.has(id));
  if (groupIds.length === 0) return [];

  const { data: groupRows } = await supabase.from('swindle_groups').select('id, game_id').in('id', groupIds);
  const groups = (groupRows ?? []) as { id: string; game_id: string }[];
  if (groups.length === 0) return [];
  const gameIds = [...new Set(groups.map(g => g.game_id))];

  const { data: gameRows } = await supabase.from('swindle_games').select('id, course_name, course_rating, slope_rating, game_date, status').in('id', gameIds).eq('status', 'complete').gte('game_date', startAt).lte('game_date', endAt);
  const gamesById = new Map(((gameRows ?? []) as any[]).map(g => [g.id, g]));
  const qualifyingGroups = groups.filter(g => gamesById.has(g.game_id));
  if (qualifyingGroups.length === 0) return [];

  const qualifyingGroupIds = qualifyingGroups.map(g => g.id);
  const qualifyingGameIds = [...new Set(qualifyingGroups.map(g => g.game_id))];
  const courseNames = [...new Set(qualifyingGroups.map(g => gamesById.get(g.game_id).course_name as string).filter(Boolean))];

  const [groupPlayerRows, entryRows, scoreRows, courseHolesByName] = await Promise.all([
    // Fetch every group member (guests included) to detect guest presence —
    // swindle guests store player_id NULL + is_guest true, keep in sync with
    // src/lib/seasonRoundIngestion.ts.
    supabase.from('swindle_group_players').select('group_id, player_id, is_guest').in('group_id', qualifyingGroupIds).then(r => r.data ?? []),
    supabase.from('swindle_entries').select('game_id, handicap').in('game_id', qualifyingGameIds).eq('player_id', playerId).then(r => r.data ?? []),
    fetchAllRows<any>((from, to) => supabase.from('swindle_scores').select('game_id, hole_number, gross_score').in('game_id', qualifyingGameIds).eq('player_id', playerId).range(from, to) as any),
    fetchHolesByCourse(courseNames),
  ]);

  const otherPlayersByGroup: Record<string, string[]> = {};
  const hasGuestByGroup: Record<string, boolean> = {};
  for (const r of groupPlayerRows as any[]) {
    if (r.is_guest) { hasGuestByGroup[r.group_id] = true; continue; }
    if (r.player_id && r.player_id !== playerId) (otherPlayersByGroup[r.group_id] ??= []).push(r.player_id);
  }
  const handicapByGame: Record<string, number> = {};
  for (const r of entryRows as any[]) handicapByGame[r.game_id] = Number(r.handicap);
  const grossByGame: Record<string, Record<number, number>> = {};
  for (const r of scoreRows as any[]) { if (r.gross_score == null) continue; (grossByGame[r.game_id] ??= {})[r.hole_number] = r.gross_score; }

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
      sourceMatchId: null, sourceSwindleGroupId: g.id, courseName: game.course_name, playedAt: new Date(game.game_date).toISOString(),
      otherPlayerIds, hasGuest: !!hasGuestByGroup[g.id], handicapIndex: handicapByGame[g.game_id] ?? 0,
      courseRating: Number(game.course_rating), slopeRating: Number(game.slope_rating),
      teeName: null, teeGender: null,
      holes: courseHoles.map(h => ({ holeNumber: h.hole_number, par: h.par, strokeIndex: h.stroke_index, grossScore: gross[h.hole_number] })),
    });
  }
  return out;
}

async function ingestRound(seasonEntryId: string, seasonId: string, src: ResolvedRoundSource, handicapAllowancePercent: number, par: number): Promise<void> {
  const playingHandicap = calcSeasonPlayingHandicap(src.handicapIndex, src.slopeRating, src.courseRating, par, handicapAllowancePercent);
  const result = calcSeasonRound(src.holes, playingHandicap, { profile: DEFAULT_SEASON_SCORING_PROFILE });

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
    final_round_points: result.baseTitanRoundPoints,
    status: 'scored', is_qualifying: true, is_counting: false,
  } as any).select('id').single();
  if (error || !round) { console.error('  insert failed', src.sourceMatchId ?? src.sourceSwindleGroupId, error); return; }

  const holeRows = result.holes.map(h => ({
    round_id: (round as any).id, hole_number: h.holeNumber, par: h.par, stroke_index: h.strokeIndex,
    gross_score: h.grossScore, handicap_strokes_received: h.handicapStrokesReceived,
    net_score: h.netScore, net_relative_to_par: h.netRelativeToPar, stableford_points: h.stablefordPoints,
    gross_relative_to_par: h.grossRelativeToPar, gross_achievement_type: h.grossAchievementType,
    gross_bonus_points: h.grossBonusPoints,
  }));
  await supabase.from('season_hole_scores').insert(holeRows as any);
}

async function recalculateSeasonEntry(seasonEntryId: string, seasonId: string, countingLimit: number, minimumQualifyingRounds: number): Promise<void> {
  const [{ data: rounds }, { data: majors }] = await Promise.all([
    supabase.from('season_rounds').select('id, played_at, base_titan_round_points, major_id').eq('season_entry_id', seasonEntryId).eq('is_qualifying', true).not('status', 'in', '(void,rejected,disputed)'),
    supabase.from('season_majors').select('id, start_at, end_at').eq('season_id', seasonId),
  ]);
  const roundRows = (rounds ?? []) as any[];
  if (roundRows.length === 0) {
    // Every round this entry had was cascade-deleted (its source
    // competition — a Simulate run — got deleted), but the cached counts on
    // season_entries never got told. Zero them out rather than leaving
    // stale numbers from rounds that no longer exist (Dave, 2026-09-15).
    await supabase.from('season_entries').update({
      qualifying_rounds_count: 0, counting_rounds_count: 0, season_points: 0,
      qualification_status: qualificationStatus(0, minimumQualifyingRounds),
    } as any).eq('id', seasonEntryId);
    return;
  }

  const finalPointsByRound: Record<string, number> = {};
  const majorIdByRound: Record<string, string | null> = {};
  for (const r of roundRows) { finalPointsByRound[r.id] = r.base_titan_round_points; majorIdByRound[r.id] = null; }

  for (const major of (majors ?? []) as any[]) {
    const inWindow = roundRows.filter(r => r.played_at >= major.start_at && r.played_at <= major.end_at);
    if (inWindow.length === 0) continue;
    for (const r of inWindow) majorIdByRound[r.id] = major.id;
    const winnerId = resolveMajorRound(inWindow.map(r => ({ roundId: r.id, baseTitanRoundPoints: r.base_titan_round_points, playedAt: r.played_at })));
    if (winnerId) {
      const winner = inWindow.find(r => r.id === winnerId)!;
      finalPointsByRound[winnerId] = Math.round(winner.base_titan_round_points * 1.5);
    }
  }

  const best = selectCountingRounds(roundRows.map(r => ({ roundId: r.id, finalRoundPoints: finalPointsByRound[r.id], playedAt: r.played_at })), countingLimit);
  const countingIds = new Set(best.counting.map(r => r.roundId));

  await Promise.all(roundRows.map(r => supabase.from('season_rounds').update({
    final_round_points: finalPointsByRound[r.id], major_id: majorIdByRound[r.id],
    major_multiplier: finalPointsByRound[r.id] !== r.base_titan_round_points ? 1.5 : null,
    is_counting: countingIds.has(r.id),
  } as any).eq('id', r.id)));

  const newQualificationStatus = qualificationStatus(roundRows.length, minimumQualifyingRounds);
  await supabase.from('season_entries').update({
    qualifying_rounds_count: roundRows.length, counting_rounds_count: best.counting.length,
    season_points: best.seasonPoints, qualification_status: newQualificationStatus,
  } as any).eq('id', seasonEntryId);
}

async function main() {
  const { data: seasons, error: seasonErr } = await supabase.from('seasons').select('*').eq('status', 'active');
  if (seasonErr) throw seasonErr;
  console.log(`Found ${seasons?.length ?? 0} active season(s).`);

  for (const season of (seasons ?? []) as any[]) {
    console.log(`\n=== ${season.name} (${season.id}) ===`);
    const { data: entries, error: entriesErr } = await supabase.from('season_entries').select('id, player_id').eq('season_id', season.id);
    if (entriesErr) throw entriesErr;
    console.log(`${entries?.length ?? 0} entrant(s).`);

    for (const entry of (entries ?? []) as any[]) {
      const { data: player } = await supabase.from('players').select('display_name').eq('id', entry.player_id).maybeSingle();
      const name = (player as any)?.display_name ?? entry.player_id;

      const { data: already } = await supabase.from('season_rounds').select('source_match_id, source_swindle_group_id').eq('season_entry_id', entry.id);
      const matchIds = new Set<string>(); const groupIds = new Set<string>();
      for (const r of (already ?? []) as any[]) { if (r.source_match_id) matchIds.add(r.source_match_id); if (r.source_swindle_group_id) groupIds.add(r.source_swindle_group_id); }

      const [matchSources, swindleSources] = await Promise.all([
        resolveMatchSources(entry.player_id, season.start_at, season.end_at, matchIds),
        resolveSwindleSources(entry.player_id, season.start_at, season.end_at, groupIds),
      ]);

      const { data: societyMemberRows } = await supabase.from('society_members').select('player_id').eq('society_id', season.society_id);
      const societyMemberIds = new Set((societyMemberRows ?? []).map((r: any) => r.player_id as string));

      let ingested = 0, skipped = 0;
      for (const src of [...matchSources, ...swindleSources]) {
        const eligible = !src.hasGuest && src.otherPlayerIds.some(id => societyMemberIds.has(id));
        if (!eligible) { skipped++; continue; }
        const par = src.holes.reduce((sum, h) => sum + h.par, 0);
        await ingestRound(entry.id, season.id, src, season.handicap_allowance_percent, par);
        ingested++;
      }

      // Always recalculate, not just when something new was ingested —
      // rounds can also have disappeared since last time (a Simulate
      // competition deleted, cascading away the season_rounds it created),
      // and the cached counts on season_entries need to catch up either way.
      await recalculateSeasonEntry(entry.id, season.id, season.counting_round_limit, season.minimum_qualifying_rounds);
      const { data: after } = await supabase.from('season_entries').select('qualifying_rounds_count, season_points').eq('id', entry.id).maybeSingle();
      console.log(`  ${name}: +${ingested} ingested, ${skipped} skipped (no eligible co-player or guest present) — now ${(after as any)?.qualifying_rounds_count ?? '?'} rounds, ${(after as any)?.season_points ?? '?'} pts`);
    }
  }
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
