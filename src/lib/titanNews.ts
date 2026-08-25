// Titan News AI — snapshot builders.
//
// These functions compute nothing new. They query the same tables and call
// the same getStandings/calcSweepBonus functions the live Tour leaderboard
// uses (see app/(app)/tour/index.tsx), then package the results into the
// plain-facts JSON the titan-news edge function hands to Claude. Titan
// calculates, AI only writes — this file is the "Titan calculates" half.

import { supabase } from './supabase';
import { getStandings, calcSweepBonus, scoreVsPar, individualScoreValue, getEffectiveWinner, matchLabel, buildKronosTieBreakMaps, kronosTieBreakCompare, type KronosTieBreakMaps } from './scoring';
import { individualBoardLabel, matchFormatLabel } from './tournamentFormat';

interface Core {
  competition: any;
  days: any[];
  matches: any[];
  teams: any[];
  cpData: any[];
  holes: any[];
}

async function loadCore(competitionId: string): Promise<Core> {
  const { data: competition, error } = await supabase
    .from('competitions').select('*').eq('id', competitionId).single();
  if (error || !competition) throw new Error('Competition not found');

  const [{ data: days }, { data: matches }, { data: teams }, { data: cpData }] = await Promise.all([
    supabase.from('competition_days').select('*').eq('competition_id', competitionId).order('day_number'),
    supabase.from('matches').select('*').eq('competition_id', competitionId).order('match_number'),
    supabase.from('teams').select('*').eq('society_id', (competition as any).society_id).order('sort_order'),
    supabase.from('competition_players')
      .select('player_id,team_id,handicap_index,players(display_name)')
      .eq('competition_id', competitionId),
  ]);

  const matchIds = ((matches ?? []) as any[]).map(m => m.id);
  const { data: holes } = matchIds.length
    ? await supabase.from('match_holes').select('player_id,stableford_pts,match_id,hole_number').in('match_id', matchIds)
    : { data: [] as any[] };

  return {
    competition, days: (days ?? []) as any[], matches: (matches ?? []) as any[],
    teams: (teams ?? []) as any[], cpData: (cpData ?? []) as any[], holes: (holes ?? []) as any[],
  };
}

function playerName(cpData: any[], playerId: string): string {
  return cpData.find(cp => cp.player_id === playerId)?.players?.display_name ?? '—';
}

function teamName(teams: any[], teamId: string): string {
  return teams.find(t => t.id === teamId)?.name ?? '—';
}

// Individual Stableford totals, restricted to matches whose day_number <= throughDayNumber.
// This IS the Kronos number in this data model (see tour/index.tsx comment: Kronos is just
// this tournament's own cumulative Stableford total) — one calculation, used for both.
function individualTotals(core: Core, throughDayNumber: number): Record<string, number> {
  const dayNumberByDayId = new Map(core.days.map(d => [d.id, d.day_number]));
  const eligibleMatchIds = new Set(
    core.matches.filter(m => (dayNumberByDayId.get(m.day_id) ?? 0) <= throughDayNumber).map(m => m.id)
  );
  const totals: Record<string, number> = {};
  core.holes.forEach(h => {
    if (h.stableford_pts == null || !eligibleMatchIds.has(h.match_id)) return;
    totals[h.player_id] = (totals[h.player_id] ?? 0) + h.stableford_pts;
  });
  return totals;
}

function individualRanking(core: Core, throughDayNumber: number) {
  const totals = individualTotals(core, throughDayNumber);
  return Object.entries(totals)
    .map(([playerId, pts]) => ({ playerId, name: playerName(core.cpData, playerId), pts }))
    .sort((a, b) => b.pts - a.pts);
}

// Same tie-break ladder the live Kronos/individual leaderboard uses — best
// final round, then back 9, back 6, back 3, then the 18th hole — all
// measured within the final competition day only. Ties on raw points
// otherwise sit in arbitrary object-key order, which is what let the news
// bot silently declare a "winner" who wasn't really decided by anything
// (Dave, 2026-08-21). Now a thin wrapper over the single shared
// implementation in scoring.ts (Rick's brief, 2026-08-25) — also used by
// tour/index.tsx's live leaderboard and admin/draw.tsx's Titan Way singles
// seeding, so a tie can never resolve differently on different screens.
function finalDayTieBreakMaps(core: Core, finalDayNumber: number): KronosTieBreakMaps {
  const finalDay = core.days.find(d => d.day_number === finalDayNumber);
  if (!finalDay) return { finalRound: {}, back9: {}, back6: {}, back3: {}, hole18: {} };
  const finalDayMatchIds = new Set(core.matches.filter(m => m.day_id === finalDay.id).map(m => m.id));
  return buildKronosTieBreakMaps(core.holes, finalDayMatchIds);
}

// Re-sorts a points-tied top of the leaderboard using the tie-break ladder,
// and reports which rung (if any) actually separated 1st from 2nd — so the
// news report can say a tie was settled by a real rule rather than imply a
// clean win that never happened.
function applyFinalTieBreak(ranking: { playerId: string; name: string; pts: number }[], core: Core, finalDayNumber: number) {
  if (ranking.length < 2 || ranking[0].pts !== ranking[1].pts) {
    return { ranking, winnerDecidedByTieBreak: null as string | null };
  }
  const maps = finalDayTieBreakMaps(core, finalDayNumber);
  const rungs: { label: string; map: Record<string, number> }[] = [
    { label: 'Best Final Round', map: maps.finalRound },
    { label: 'Best Back 9',      map: maps.back9 },
    { label: 'Best Back 6',      map: maps.back6 },
    { label: 'Best Back 3',      map: maps.back3 },
    { label: '18th Hole',        map: maps.hole18 },
  ];
  const tiedIds = new Set(ranking.filter(r => r.pts === ranking[0].pts).map(r => r.playerId));
  const tiedRows = ranking.filter(r => tiedIds.has(r.playerId));
  const untiedRows = ranking.filter(r => !tiedIds.has(r.playerId));

  let winnerDecidedByTieBreak: string | null = null;
  for (const rung of rungs) {
    const values = tiedRows.map(r => rung.map[r.playerId] ?? 0);
    const maxVal = Math.max(...values);
    const stillTied = values.filter(v => v === maxVal).length;
    if (stillTied < tiedRows.length) { winnerDecidedByTieBreak = rung.label; break; }
  }
  tiedRows.sort((a, b) => kronosTieBreakCompare(maps, a.playerId, b.playerId));
  return { ranking: [...tiedRows, ...untiedRows], winnerDecidedByTieBreak };
}

// Team standings through a given day, reusing getStandings/calcSweepBonus exactly
// as the live leaderboard does — no team standings section if this tournament
// doesn't use teams at all (singles/individual-only formats).
function teamRanking(core: Core, throughDayNumber: number) {
  const usesTeams = core.matches.some(m => m.home_team_id && m.away_team_id);
  if (!usesTeams) return null;

  const dayNumberByDayId = new Map(core.days.map(d => [d.id, d.day_number]));
  const eligibleMatches = core.matches.filter(m => (dayNumberByDayId.get(m.day_id) ?? 0) <= throughDayNumber);
  const eligibleDayIds = new Set(core.days.filter(d => d.day_number <= throughDayNumber).map(d => d.id));

  const individualPts = individualTotals(core, throughDayNumber);
  const teamStableford: Record<string, number> = {};
  core.cpData.forEach(cp => {
    if (!cp.team_id) return;
    teamStableford[cp.team_id] = (teamStableford[cp.team_id] ?? 0) + (individualPts[cp.player_id] ?? 0);
  });

  const singlesDayIds = new Set(core.days.filter(d => eligibleDayIds.has(d.id) && (d.day_format === 'singles' || d.day_format === 'singles_stableford')).map(d => d.id));
  const bonusPts = calcSweepBonus(eligibleMatches, singlesDayIds, core.competition.bonus_points ?? 2);
  const standings = getStandings(
    eligibleMatches, core.competition.pts_win ?? 1, core.competition.pts_half ?? 0.5, teamStableford, bonusPts
  );
  return standings.map(s => ({ teamId: s.teamId, teamName: teamName(core.teams, s.teamId), pts: s.pts, wins: s.w, halved: s.h, losses: s.l, played: s.played }));
}

// Position deltas: rank now vs rank as of the previous day. Computed here in
// plain code, never left for the AI to work out (per Rick's brief section 5).
function withPositionDeltas<T extends { playerId?: string; teamId?: string }>(current: T[], previous: T[]) {
  const prevRank = new Map(previous.map((row, i) => [(row as any).playerId ?? (row as any).teamId, i + 1]));
  return current.map((row, i) => {
    const id = (row as any).playerId ?? (row as any).teamId;
    const previousPosition = prevRank.get(id) ?? null;
    const currentPosition = i + 1;
    return { ...row, currentPosition, previousPosition, positionChange: previousPosition ? previousPosition - currentPosition : null };
  });
}

function dayMatchSummaries(core: Core, dayId: string) {
  return core.matches.filter(m => m.day_id === dayId).map(m => {
    // A match can be mathematically decided (e.g. 3&2) before its `status`
    // column flips to 'complete' — getStandings() already resolves this via
    // getEffectiveWinner() internally, so without doing the same here a
    // snapshot could tell the AI a match's standings-affecting result while
    // also telling it, in the very same snapshot, that the match has no
    // winner yet (Rick's brief, section 10 — nothing should contradict what
    // the Calculation Engine already decided).
    const holesStr = m.holes_string ?? '..................';
    const totalHoles = m.holes_to_play ?? 18;
    const effectiveWinner = getEffectiveWinner(m.status, m.winner, holesStr, totalHoles);
    const effectiveResultStr = m.status === 'complete'
      ? m.result_str
      : (effectiveWinner ? matchLabel(m.status, m.winner, m.result_str, holesStr, totalHoles) : m.result_str);
    return {
      homeTeam: m.home_team_id ? teamName(core.teams, m.home_team_id) : null,
      awayTeam: m.away_team_id ? teamName(core.teams, m.away_team_id) : null,
      homePlayers: (m.home_player_ids ?? []).map((id: string) => playerName(core.cpData, id)),
      awayPlayers: (m.away_player_ids ?? []).map((id: string) => playerName(core.cpData, id)),
      status: m.status,
      resultStr: effectiveResultStr,
      winner: effectiveWinner ?? m.winner,
    };
  });
}

// Deterministic stage label — same "Titan calculates, AI only writes" split as the
// snapshot builders above. Which stage a report belongs to is a fact Titan already
// knows (story_type + round number), so it's never left to the AI's freeform headline
// (Rick's brief, 2026-08-22 — "the user should immediately know which round the
// article relates to", not a generic "Round Preview"/"Round Report").
export function stageLabel(storyType: string, dayNumber: number | null): string {
  switch (storyType) {
    case 'preview':       return dayNumber ? `Round ${dayNumber} Preview` : 'Tournament Preview';
    case 'round_report':  return dayNumber ? `Round ${dayNumber} Report` : 'Round Report';
    case 'final_report':  return 'Final Tournament Report';
    case 'casual_final':  return 'Match Report';
    default:               return storyType;
  }
}

export function articleLabel(storyType: string, dayNumber: number | null, tournamentName: string | null | undefined): string {
  const stage = stageLabel(storyType, dayNumber);
  return tournamentName ? `${tournamentName} — ${stage}` : stage;
}

function tournamentInfo(core: Core, currentDay: any | null) {
  return {
    tournamentName: core.competition.name,
    format: core.competition.format,
    tournamentType: core.competition.tournament_type,
    // Titan calculates which term applies, the AI just uses it verbatim —
    // "Kronos" is Titan Way-exclusive branding, every other format calls the
    // same individual standings board "Individual" (Rick's brief, section 4.4).
    individualBoardLabel: individualBoardLabel(core.competition.format),
    totalRounds: core.days.length,
    currentRound: currentDay?.day_number ?? null,
    course: currentDay?.course_name ?? null,
    date: currentDay?.play_date ?? null,
    status: core.competition.status,
  };
}

export async function buildPreviewSnapshot(competitionId: string, upcomingDayId: string) {
  const core = await loadCore(competitionId);
  const upcomingDay = core.days.find(d => d.id === upcomingDayId);
  if (!upcomingDay) throw new Error('Day not found on this competition');
  const throughDayNumber = upcomingDay.day_number - 1;

  return {
    storyType: 'preview',
    tournament: tournamentInfo(core, upcomingDay),
    currentIndividualLeaderboard: individualRanking(core, throughDayNumber).slice(0, 10),
    currentTeamStandings: teamRanking(core, throughDayNumber),
    todaysMatches: dayMatchSummaries(core, upcomingDayId),
    roundsRemainingAfterToday: core.days.filter(d => d.day_number >= upcomingDay.day_number).length,
  };
}

export async function buildRoundReportSnapshot(competitionId: string, dayId: string) {
  const core = await loadCore(competitionId);
  const day = core.days.find(d => d.id === dayId);
  if (!day) throw new Error('Day not found on this competition');

  const individualNow  = individualRanking(core, day.day_number);
  const individualPrev = individualRanking(core, day.day_number - 1);
  const teamNow  = teamRanking(core, day.day_number);
  const teamPrev = teamRanking(core, day.day_number - 1);

  return {
    storyType: 'round_report',
    tournament: tournamentInfo(core, day),
    individualLeaderboard: withPositionDeltas(individualNow, individualPrev).slice(0, 10),
    teamStandings: teamNow ? withPositionDeltas(teamNow, teamPrev ?? []) : null,
    kronosLeaderboard: core.competition.include_in_kronos ? withPositionDeltas(individualNow, individualPrev).slice(0, 5) : null,
    thisRoundMatches: dayMatchSummaries(core, dayId),
    roundsRemaining: core.days.filter(d => d.day_number > day.day_number).length,
  };
}

// Casual Golf's one-and-only report, generated when a group round completes.
// Unlike tournaments this has no preview/round_report/admin-review — just a
// single match's own data (Dave, 2026-08-20, TODO item 5). Same "Titan
// calculates, AI only writes" split as the tournament builders above: every
// number here comes straight from match_holes/hole_stats, nothing inferred.
export async function buildCasualFinalReportSnapshot(matchId: string) {
  const { data: match, error } = await supabase.from('matches').select('*').eq('id', matchId).single();
  if (error || !match) throw new Error('Match not found');
  const m = match as any;

  const [{ data: day }, { data: holes }, { data: statsRows }] = await Promise.all([
    m.day_id
      ? supabase.from('competition_days').select('course_name,course_par').eq('id', m.day_id).single()
      : Promise.resolve({ data: null as any }),
    supabase.from('match_holes').select('player_id,hole_number,gross_score,stableford_pts').eq('match_id', matchId).order('hole_number'),
    supabase.from('hole_stats').select('player_id,fairway_hit,putts').eq('match_id', matchId),
  ]);

  const allPlayerIds = [...new Set([...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])])] as string[];
  const { data: playersData } = allPlayerIds.length
    ? await supabase.from('players').select('id,display_name').in('id', allPlayerIds)
    : { data: [] as any[] };
  const nameFor = (pid: string) => (playersData ?? []).find((p: any) => p.id === pid)?.display_name ?? '—';

  // Per-hole par, for real eagle/birdie detection — the round's overall
  // par/18 would misclassify on any course with a mix of par 3/4/5 holes.
  const { data: courseHoles } = (day as any)?.course_name
    ? await supabase.from('course_holes').select('hole_number,par').eq('course_name', (day as any).course_name)
    : { data: [] as any[] };
  const parFor = (holeNum: number) => (courseHoles ?? []).find((h: any) => h.hole_number === holeNum)?.par ?? 4;

  const isStroke = m.round_format === 'stableford' || m.round_format === 'medal';
  const holeRows = (holes ?? []) as any[];

  const totalsByPlayer: Record<string, { gross: number; pts: number; vsPar: number }> = {};
  const keyMoments: { name: string; holeNumber: number; type: 'eagle' | 'birdie' }[] = [];
  holeRows.forEach(h => {
    if (!totalsByPlayer[h.player_id]) totalsByPlayer[h.player_id] = { gross: 0, pts: 0, vsPar: 0 };
    if (h.gross_score != null) {
      const par = parFor(h.hole_number);
      totalsByPlayer[h.player_id].gross += h.gross_score;
      totalsByPlayer[h.player_id].vsPar += h.gross_score - par;
      const category = scoreVsPar(h.gross_score, par);
      if (category === 'eagle' || category === 'birdie') {
        keyMoments.push({ name: nameFor(h.player_id), holeNumber: h.hole_number, type: category });
      }
    }
    if (h.stableford_pts != null) totalsByPlayer[h.player_id].pts += h.stableford_pts;
  });

  // Medal (stroke play) ranks ascending by gross-vs-par, never by Stableford
  // points (Rick's brief, section 10) — this is also the one place a raw
  // score reaches the AI with no official "winner" attached, leaving it to
  // infer the winner from array order; standings[0] is now always the
  // genuine winner for both stroke-play sub-formats.
  const standings = isStroke
    ? allPlayerIds
        .map(id => ({ name: nameFor(id), grossTotal: totalsByPlayer[id]?.gross ?? null, vsPar: totalsByPlayer[id]?.vsPar ?? null, points: totalsByPlayer[id]?.pts ?? null }))
        .sort((a, b) =>
          individualScoreValue(m.round_format, b.points ?? 0, b.vsPar ?? 0) - individualScoreValue(m.round_format, a.points ?? 0, a.vsPar ?? 0)
        )
    : null;
  const strokePlayWinner = standings && standings.length > 0 ? standings[0].name : null;

  // A close matchplay finish is one decided on the very last hole or with
  // the match still alive going into it — the AI is told this fact directly
  // rather than left to infer "close" from the raw result string.
  const holesPlayed = m.holes_string ? m.holes_string.split('').filter((c: string) => c !== '.').length : 0;
  const wentToTheWire = !isStroke && holesPlayed >= 17;

  const sideGameTags = ((m.side_games ?? []) as string[]).filter(sg => !sg.startsWith('voice') && !sg.startsWith('stats'));

  const statsSummary = (statsRows ?? []).length > 0
    ? allPlayerIds.map(id => {
        const rows = (statsRows as any[]).filter(r => r.player_id === id);
        const puttsRecorded = rows.filter(r => r.putts != null);
        return {
          name: nameFor(id),
          fairwaysHit: rows.filter(r => r.fairway_hit === true).length,
          fairwayOpportunities: rows.filter(r => r.fairway_hit !== null).length,
          totalPutts: puttsRecorded.length > 0 ? puttsRecorded.reduce((s, r) => s + r.putts, 0) : null,
        };
      })
    : null;

  return {
    storyType: 'casual_final',
    round: {
      format: matchFormatLabel(m.round_format, m.is_singles, m.handicap_method),
      secondaryFormat: m.secondary_format ?? null,
      course: (day as any)?.course_name ?? null,
      isMatchplay: !isStroke,
    },
    standings,
    strokePlayWinner,
    matchplayResult: !isStroke ? {
      winner: m.winner,
      resultStr: m.result_str,
      wentToTheWire,
      homePlayers: (m.home_player_ids ?? []).map(nameFor),
      awayPlayers: (m.away_player_ids ?? []).map(nameFor),
    } : null,
    keyMoments,
    sideGames: sideGameTags,
    stats: statsSummary,
  };
}

export async function buildFinalReportSnapshot(competitionId: string) {
  const core = await loadCore(competitionId);
  const finalDayNumber = Math.max(0, ...core.days.map(d => d.day_number));
  const penultimateDayNumber = Math.max(0, ...core.days.filter(d => d.day_number < finalDayNumber).map(d => d.day_number));

  const individualFinalRaw = individualRanking(core, finalDayNumber);
  const { ranking: individualFinal, winnerDecidedByTieBreak } = applyFinalTieBreak(individualFinalRaw, core, finalDayNumber);
  const individualPrev  = individualRanking(core, penultimateDayNumber);
  const teamFinal = teamRanking(core, finalDayNumber);
  const teamPrev  = teamRanking(core, penultimateDayNumber);

  return {
    storyType: 'final_report',
    tournament: tournamentInfo(core, null),
    finalIndividualLeaderboard: withPositionDeltas(individualFinal, individualPrev).slice(0, 10),
    finalTeamStandings: teamFinal ? withPositionDeltas(teamFinal, teamPrev ?? []) : null,
    finalKronosLeaderboard: core.competition.include_in_kronos ? withPositionDeltas(individualFinal, individualPrev).slice(0, 5) : null,
    winner: teamFinal?.[0] ?? individualFinal[0] ?? null,
    runnerUp: teamFinal?.[1] ?? individualFinal[1] ?? null,
    // Non-null only when the individual winner was tied on points and had to be
    // settled by the tie-break ladder — the AI must say so, not imply a clean win.
    winnerDecidedByTieBreak: teamFinal ? null : winnerDecidedByTieBreak,
    finalDayMatches: core.days.length ? dayMatchSummaries(core, core.days[core.days.length - 1].id) : [],
  };
}

// Fire-and-forget: builds the snapshot and calls the edge function for a
// just-completed casual round. Called from the "Complete Round" handlers,
// deliberately swallowing its own errors — a failed report shouldn't ever
// block or alarm a player who just finished scoring, it should just mean
// no report shows up. The edge function auto-publishes storyType
// 'casual_final' (see supabase/functions/titan-news/index.ts). Once it's
// live, also DMs every other player in the round (Dave, 2026-08-20 —
// "will it also save to my inbox as well") — same 'newsreel'-style
// broadcast pattern admin/news.tsx uses for tournament reports, just fired
// by whoever completed the round instead of an admin.
export async function generateCasualMatchReport(matchId: string): Promise<void> {
  try {
    const snapshot = await buildCasualFinalReportSnapshot(matchId);
    const { data, error } = await supabase.functions.invoke('titan-news', {
      body: { dedupeKey: `casual:${matchId}`, matchId, storyType: 'casual_final', snapshot },
    });
    // The edge function always returns HTTP 200, even on failure (Anthropic
    // error, unparseable article, DB save failure) — it puts the problem in
    // `data.error` rather than the response status, so a transport-level
    // `error` check alone can't see it. Treat both as failure, or a failed
    // generation gets logged as a success and every reader hits an empty
    // article (Dave, 2026-08-21 — "it said this is empty").
    if (error || data?.error) { console.error('[titanNews] casual report generation failed', error ?? data.error); return; }
    console.log('[titanNews] casual report generated', { matchId });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: me } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
    if (!me) return;

    const { data: match } = await supabase.from('matches').select('home_player_ids,away_player_ids').eq('id', matchId).single();
    const allPlayerIds = [...new Set([...(match?.home_player_ids ?? []), ...(match?.away_player_ids ?? [])])] as string[];
    // Every player in the round gets their own report in their own inbox,
    // including whoever just finished and triggered this (Dave, 2026-08-21
    // — "all rounds that anyone is in should go to their mailbox"). The DB
    // only allows a self-targeted row for message_type 'match_report' (see
    // 20260821000000_match_report_self_dm.sql) — this isn't a general DM
    // exemption.
    const rows = allPlayerIds
      .map(id => ({
        sender_id: (me as any).id, recipient_id: id,
        content: data?.headline ?? 'Your Titan match report is ready to read.',
        message_type: 'match_report' as const,
        link_url: `titangolf://news?matchId=${matchId}`,
      }));
    if (rows.length) {
      const { error: dmErr } = await supabase.from('direct_messages').insert(rows);
      if (dmErr) console.error('[titanNews] match report DM send failed', dmErr);
    }
  } catch (e) {
    console.error('[titanNews] casual report generation failed', e);
  }
}
