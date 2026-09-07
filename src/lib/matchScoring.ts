// Shared "save one hole" core, extracted verbatim from
// app/(app)/score/enter/[matchId].tsx's processHoleScores (2026-09-07) so a
// real scorer and the tournament verification harness write through the
// EXACT same computation and the exact same match_holes/hole_stats/matches
// calls — never a second, drifting copy of the scoring rules. The live
// screen keeps every UI-only side effect (Live Activity, voice pressure,
// notifications, optimistic state, records-breaking checks, handicap-cuts
// reprocessing, Alert/router navigation) exactly where it already was —
// only the computation + the raw DB write moved here.
import { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from './supabase';
import { calcStrokesReceived, calcStablefordPoints, calcHoles } from './scoring';
import { resolvePlayingHandicap, type RoundPlayerTeeSnapshot } from './whs';
import { enqueueHole, isNetworkError } from './offlineQueue';

export interface CompPlayer { player_id: string; handicap_index: number }

export interface MatchScoringDay {
  slope_rating?: number | null;
  course_rating?: number | null;
  course_par?: number | null;
  competition?: { include_in_kronos?: boolean | null; handicap_cuts_enabled?: boolean | null; format?: string | null } | null;
}

export interface MatchForScoring {
  id: string;
  round_format: 'matchplay' | 'stableford' | 'medal';
  handicap_method: string | null;
  secondary_format: string | null | undefined;
  hcp_allowance: number | null;
  home_player_ids: string[];
  away_player_ids: string[];
  status: 'upcoming' | 'in_progress' | 'complete';
  winner: string | null;
  result_str: string | null;
  started_at: string | null;
  completed_at: string | null;
  holes_to_play?: number | null;
  competition_id?: string | null;
  day_id?: string | null;
  day: MatchScoringDay | null;
}

export interface HoleStatsInput {
  fairway: 'left' | 'centre' | 'right' | null;
  putts: number | null;
  bunker?: number;
  penalty?: number;
  chips?: number;
}

export interface CourseHoleForScoring { par: number; stroke_index: number }

export interface ComputeHoleScoresInput {
  match: MatchForScoring;
  courseHole: CourseHoleForScoring;
  activeHole: number;
  editingHole: boolean;
  allPlayerIds: string[];
  compPlayers: CompPlayer[];
  roundPlayerTees: Record<string, RoundPlayerTeeSnapshot>;
  continuingSecondary: boolean;
  holeChars: string[];          // 18-length, one char per literal hole number
  holeSequence: number[];       // play-order sequence of literal hole numbers
  scores: Record<string, number>;
  stats?: Record<string, HoleStatsInput>;
  client?: SupabaseClient;      // defaults to the shared app client; the
                                 // verification harness passes a per-player
                                 // authenticated client instead so RLS is
                                 // checked as that real participant.
}

export interface MatchHoleRow {
  match_id: string; player_id: string; hole_number: number;
  score: string; gross_score: number | null; net_score?: number | null; stableford_pts: number | null;
}

export interface HoleStatRow {
  match_id: string; player_id: string; hole_number: number;
  fairway_hit: boolean | null; fairway_direction: string | null;
  putts: number | null; bunker_shots: number | null; penalty_strokes: number | null; chip_shots: number | null;
}

export interface ComputedHoleScores {
  isStrokePlay: boolean;
  holeRows: MatchHoleRow[];
  statRows: HoleStatRow[];
  matchUpdate: Record<string, any>;
  newStatus: 'upcoming' | 'in_progress' | 'complete';
  winner: string | null;
  result_str: string | null;
  newHolesStr: string;
  seqStr: string | null;        // matchplay only
  homeUp: number | null;        // matchplay only
  wasAlreadyComplete: boolean;
  continuingSecondaryNext: boolean;
}

export type SaveHoleOutcome =
  | { kind: 'saved'; savedOffline: boolean; computed: ComputedHoleScores }
  | { kind: 'missing_match' }
  | { kind: 'error'; error: any };

function playerCourseHcp(
  playerId: string, compPlayers: CompPlayer[], day: MatchScoringDay | null, hcpAllowance = 100,
  roundPlayerTees: Record<string, RoundPlayerTeeSnapshot> = {},
): number {
  const cp = compPlayers.find(c => c.player_id === playerId);
  return resolvePlayingHandicap(cp?.handicap_index ?? 0, day, hcpAllowance, roundPlayerTees[playerId]);
}

function matchplayHcp(
  id: string, match: MatchForScoring, compPlayers: CompPlayer[], roundPlayerTees: Record<string, RoundPlayerTeeSnapshot>,
  allPlayerIds: string[],
): number {
  const base = playerCourseHcp(id, compPlayers, match.day ?? null, match.hcp_allowance ?? 100, roundPlayerTees);
  if (match.handicap_method !== 'relative_low' && match.handicap_method !== 'relative_low_stableford') return base;
  const groupHcps = allPlayerIds.map(pid => playerCourseHcp(pid, compPlayers, match.day ?? null, match.hcp_allowance ?? 100, roundPlayerTees));
  return Math.max(0, base - Math.min(...groupHcps));
}

function isMissingMatchError(err: any): boolean {
  return err?.code === '23503' || /foreign key/i.test(String(err?.message ?? ''));
}

function buildStatRows(
  matchId: string, activeHole: number, courseHole: CourseHoleForScoring, allPlayerIds: string[],
  stats: Record<string, HoleStatsInput>,
): HoleStatRow[] {
  return allPlayerIds
    .map(id => ({
      match_id: matchId,
      player_id: id,
      hole_number: activeHole,
      fairway_hit: courseHole.par >= 4 ? (stats[id]?.fairway != null ? stats[id]?.fairway === 'centre' : null) : null,
      fairway_direction: courseHole.par >= 4 ? (stats[id]?.fairway ?? null) : null,
      putts: stats[id]?.putts ?? null,
      bunker_shots: (stats[id]?.bunker ?? 0) > 0 ? stats[id]!.bunker! : null,
      penalty_strokes: (stats[id]?.penalty ?? 0) > 0 ? stats[id]!.penalty! : null,
      chip_shots: (stats[id]?.chips ?? 0) > 0 ? stats[id]!.chips! : null,
    }))
    .filter(r => r.fairway_direction !== null || r.putts !== null || r.bunker_shots !== null || r.penalty_strokes !== null || r.chip_shots !== null);
}

function computeStrokePlay(input: ComputeHoleScoresInput): Omit<ComputedHoleScores, 'wasAlreadyComplete'> {
  const { match, courseHole, activeHole, allPlayerIds, compPlayers, roundPlayerTees, scores, stats = {}, holeChars } = input;
  const si = courseHole.stroke_index;
  const par = courseHole.par;
  const day = match.day;

  const spRows: MatchHoleRow[] = allPlayerIds.map(id => {
    const hcp = playerCourseHcp(id, compPlayers, day, match.hcp_allowance ?? 100, roundPlayerTees);
    const shots = calcStrokesReceived(hcp, si);
    const gross = scores[id] ?? null;
    const net = gross !== null ? gross - shots : null;
    const needsStablefordPts = match.round_format === 'stableford' || !!match.secondary_format || !!match.day?.competition?.include_in_kronos || !!match.day?.competition?.handicap_cuts_enabled;
    return {
      match_id: match.id, player_id: id, hole_number: activeHole, score: 'd',
      gross_score: gross, net_score: net,
      stableford_pts: needsStablefordPts ? calcStablefordPoints(gross as number, par, shots) : null,
    };
  });

  const spStatRows = buildStatRows(match.id, activeHole, courseHole, allPlayerIds, stats);

  const spChars = [...holeChars];
  spChars[activeHole - 1] = 'd';
  const newHolesStr = spChars.join('');
  const isAlreadyComplete = match.status === 'complete';
  const newStatus: 'upcoming' | 'in_progress' | 'complete' = isAlreadyComplete ? 'complete' : 'in_progress';
  const startedAtField = !match.started_at ? { started_at: new Date().toISOString() } : {};
  const matchUpdate = isAlreadyComplete
    ? { holes_string: newHolesStr, status: 'complete' as const, winner: match.winner, result_str: match.result_str, ...startedAtField }
    : { holes_string: newHolesStr, status: 'in_progress' as const, winner: null as null, result_str: null as null, ...startedAtField };

  return {
    isStrokePlay: true, holeRows: spRows, statRows: spStatRows, matchUpdate,
    newStatus: matchUpdate.status, winner: matchUpdate.winner, result_str: matchUpdate.result_str,
    newHolesStr, seqStr: null, homeUp: null, continuingSecondaryNext: input.continuingSecondary,
  };
}

function computeMatchPlay(input: ComputeHoleScoresInput): Omit<ComputedHoleScores, 'wasAlreadyComplete'> {
  const { match, courseHole, activeHole, allPlayerIds, compPlayers, roundPlayerTees, scores, stats = {}, holeChars, holeSequence, continuingSecondary } = input;
  const si = courseHole.stroke_index;
  const par = courseHole.par;

  const getNetScore = (id: string) => {
    const shots = calcStrokesReceived(matchplayHcp(id, match, compPlayers, roundPlayerTees, allPlayerIds), si);
    return (scores[id] ?? 99) - shots;
  };

  const isStablefordBestBall = match.round_format === 'matchplay'
    && (match.handicap_method === 'relative_low_stableford' || match.handicap_method === 'individual_stableford');

  let holeResult: 'h' | 'a' | 'f';
  if (isStablefordBestBall) {
    const getMainPts = (id: string) => {
      const shots = calcStrokesReceived(matchplayHcp(id, match, compPlayers, roundPlayerTees, allPlayerIds), si);
      return calcStablefordPoints(scores[id] ?? 99, par, shots);
    };
    const homeBestPts = Math.max(...match.home_player_ids.map(getMainPts));
    const awayBestPts = Math.max(...match.away_player_ids.map(getMainPts));
    holeResult = homeBestPts > awayBestPts ? 'h' : awayBestPts > homeBestPts ? 'a' : 'f';
  } else {
    const homeNet = Math.min(...match.home_player_ids.map(getNetScore));
    const awayNet = Math.min(...match.away_player_ids.map(getNetScore));
    holeResult = homeNet < awayNet ? 'h' : awayNet < homeNet ? 'a' : 'f';
  }

  const rows: MatchHoleRow[] = allPlayerIds.map(id => {
    const gross = scores[id] ?? null;
    const fullHcp = playerCourseHcp(id, compPlayers, match.day, 100, roundPlayerTees);
    const sideShots = calcStrokesReceived(fullHcp, si);
    const needsStablefordPts = !!match.secondary_format || !!match.day?.competition?.include_in_kronos || !!match.day?.competition?.handicap_cuts_enabled;
    return {
      match_id: match.id, player_id: id, hole_number: activeHole, score: holeResult,
      gross_score: gross,
      stableford_pts: needsStablefordPts ? calcStablefordPoints(gross as number, par, sideShots) : null,
    };
  });

  const statRows = buildStatRows(match.id, activeHole, courseHole, allPlayerIds, stats);

  const chars = [...holeChars];
  chars[activeHole - 1] = holeResult;
  const newHolesStr = chars.join('');
  const holesToPlay = match.holes_to_play ?? 18;
  const seqStr = holeSequence.map(h => newHolesStr[h - 1] ?? '.').join('');
  const { homeUp, played, remaining, concluded } = calcHoles(seqStr, holesToPlay);

  let newStatus: 'upcoming' | 'in_progress' | 'complete' = 'in_progress';
  let winner: string | null = null;
  let result_str: string | null = null;

  if (concluded) {
    newStatus = 'complete';
    winner = homeUp > 0 ? 'home' : 'away';
    result_str = `${Math.abs(homeUp)}&${remaining}`;
  } else if (played === holesToPlay) {
    newStatus = 'complete';
    if (homeUp === 0) { winner = 'half'; result_str = 'Halved'; }
    else { winner = homeUp > 0 ? 'home' : 'away'; result_str = `${Math.abs(homeUp)}UP`; }
  }

  let continuingSecondaryNext = continuingSecondary;
  if (continuingSecondary) {
    newStatus = played === 18 ? 'complete' : 'in_progress';
    winner = match.winner;
    result_str = match.result_str;
  }

  const timerFields2: { started_at?: string; completed_at?: string } = {};
  if (!match.started_at) timerFields2.started_at = new Date().toISOString();
  if (newStatus === 'complete' && !match.completed_at) timerFields2.completed_at = new Date().toISOString();
  const matchUpdate = { holes_string: newHolesStr, status: newStatus, winner, result_str, ...timerFields2 };

  return {
    isStrokePlay: false, holeRows: rows, statRows, matchUpdate,
    newStatus, winner, result_str, newHolesStr, seqStr, homeUp, continuingSecondaryNext,
  };
}

// Computes exactly what processHoleScores computes for the active hole, then
// performs the exact same match_holes delete+insert, hole_stats upsert, and
// matches update — on `input.client` if given (a real per-player session for
// the verification harness), otherwise the shared app client. Offline
// queueing (enqueueHole) is included since it's pure data-layer resilience,
// not a UI concern; UI-only things (Alert, router, Live Activity, voice,
// notifications, optimistic React state, records-breaking checks,
// handicap-cuts reprocessing) stay in the caller, which should switch on
// `outcome.kind` exactly as processHoleScores's existing catch block does.
export async function computeAndSaveHoleScores(input: ComputeHoleScoresInput): Promise<SaveHoleOutcome> {
  const client = input.client ?? defaultSupabase;
  const wasAlreadyComplete = input.match.status === 'complete';
  const isStrokePlay = input.match.round_format === 'stableford' || input.match.round_format === 'medal';
  const partial = isStrokePlay ? computeStrokePlay(input) : computeMatchPlay(input);
  const computed: ComputedHoleScores = { ...partial, wasAlreadyComplete };

  try {
    await client.from('match_holes').delete().eq('match_id', input.match.id).eq('hole_number', input.activeHole);
    const { error: insErr } = await client.from('match_holes').insert(computed.holeRows);
    if (insErr) throw insErr;
    if (computed.statRows.length > 0) {
      await client.from('hole_stats').upsert(computed.statRows, { onConflict: 'match_id,player_id,hole_number' });
    }
    const { error: updErr } = await client.from('matches').update(computed.matchUpdate).eq('id', input.match.id);
    if (updErr) throw updErr;
    return { kind: 'saved', savedOffline: false, computed };
  } catch (err: any) {
    if (isMissingMatchError(err)) return { kind: 'missing_match' };
    if (!isNetworkError(err)) return { kind: 'error', error: err };
    await enqueueHole({
      matchId: input.match.id, holeNumber: input.activeHole,
      insertRows: computed.holeRows, statRows: computed.statRows, matchUpdate: computed.matchUpdate,
    });
    return { kind: 'saved', savedOffline: true, computed };
  }
}
