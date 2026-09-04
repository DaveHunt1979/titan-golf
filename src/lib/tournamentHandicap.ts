// Automatic Tournament Handicap Cutting System (Rick's brief, 2026-08-25).
// Tournament Mode only, per-tournament opt-in (competitions.handicap_cuts_enabled,
// default false). Strong Stableford rounds progressively cut a player's
// TOURNAMENT-ONLY handicap for later rounds — never the permanent WHS
// handicap (players.handicap_index) or the existing enrollment snapshot
// (competition_players.handicap_index), which stays untouched as the
// feature-off fallback.
//
// Kept out of scoring.ts deliberately: that module is a pure, DB-free,
// fixture-verified port ("ported from Titan Tour 2026... verified against
// the 2026 fixture corpus"). This file needs Supabase reads/writes and is
// tournament-specific — it produces the one input (an effective handicap
// index) that scoring.ts's calcCourseHandicap/playerCourseHcp already
// accept, without touching those functions.
import { supabase, fetchAllRows } from './supabase';

export interface HandicapCutBand { min: number; max: number | null; cutPerPoint: number; }

export const DEFAULT_HANDICAP_CUT_BANDS: HandicapCutBand[] = [
  { min: 0,  max: 9.9,  cutPerPoint: 0.5 },
  { min: 10, max: 18.9, cutPerPoint: 1.0 },
  { min: 19, max: 28.9, cutPerPoint: 2.0 },
  { min: 29, max: null, cutPerPoint: 2.0 },
];

export interface TournamentCutConfig {
  enabled: boolean;
  triggerScore: number;
  minimum: number;
  bands: HandicapCutBand[];
}

// ── Pure functions — directly checkable against the brief's worked examples ──

// The band is looked up ONCE against the handicap at round-start and never
// re-evaluated mid-calculation (brief, section 6 — "the category is locked
// for that individual round calculation").
export function lookupCutPerPoint(handicapAtRoundStart: number, bands: HandicapCutBand[]): number {
  const band = bands.find(b => handicapAtRoundStart >= b.min && (b.max == null || handicapAtRoundStart <= b.max));
  return band?.cutPerPoint ?? bands[bands.length - 1]?.cutPerPoint ?? 0;
}

export interface RoundCutResult {
  pointsOverTrigger: number;
  cutPerPoint: number;
  cut: number;
}

export function calcRoundCut(
  stablefordPts: number,
  triggerScore: number,
  handicapAtRoundStart: number,
  bands: HandicapCutBand[],
): RoundCutResult {
  const pointsOverTrigger = Math.max(0, stablefordPts - triggerScore);
  if (pointsOverTrigger === 0) return { pointsOverTrigger: 0, cutPerPoint: 0, cut: 0 };
  const cutPerPoint = lookupCutPerPoint(handicapAtRoundStart, bands);
  return { pointsOverTrigger, cutPerPoint, cut: pointsOverTrigger * cutPerPoint };
}

// Cuts only ever reduce the handicap (brief, section 11 — "no automatic
// handicap increases"), floored at the tournament's configured minimum.
export function applyCut(currentHandicap: number, cut: number, minimum: number): number {
  return Math.max(minimum, currentHandicap - cut);
}

// A 9-hole round's Stableford ceiling is roughly half an 18-hole round's, so
// the default 36-point trigger (an 18-hole baseline) is scaled by holes
// actually played rather than applied as-is — otherwise every 9-hole round
// would trigger a cut far too easily. Resolved with Dave, 2026-08-25.
export function effectiveTriggerScore(baseTrigger: number, holesToPlay: number): number {
  if (!holesToPlay || holesToPlay >= 18) return baseTrigger;
  return Math.round(baseTrigger * (holesToPlay / 18));
}

// ── Orchestration ──

export async function fetchTournamentCutConfig(competitionId: string): Promise<TournamentCutConfig> {
  const { data } = await supabase
    .from('competitions')
    .select('handicap_cuts_enabled, handicap_cut_trigger_score, handicap_cut_minimum, handicap_cut_bands')
    .eq('id', competitionId)
    .maybeSingle();
  return {
    enabled: !!(data as any)?.handicap_cuts_enabled,
    triggerScore: (data as any)?.handicap_cut_trigger_score ?? 36,
    minimum: (data as any)?.handicap_cut_minimum ?? 0,
    bands: ((data as any)?.handicap_cut_bands as HandicapCutBand[] | null) ?? DEFAULT_HANDICAP_CUT_BANDS,
  };
}

// The single seam every scoring/spectate screen calls before its existing
// playerCourseHcp/calcCourseHandicap call. Returns rawHandicapIndex
// unchanged whenever cuts are off, so a disabled tournament (or a casual
// round with no competitionId at all) is byte-identical to today.
export function resolveEffectiveHandicapIndex(opts: {
  rawHandicapIndex: number;
  cutsEnabled: boolean;
  currentTournamentHandicap: number | null | undefined;
  startingTournamentHandicap: number | null | undefined;
  // Set when this round has already been processed (round is complete) —
  // historic results must never move just because the player's CURRENT
  // handicap later changes (brief, section 9).
  roundHandicapSnapshot?: number | null;
}): number {
  if (!opts.cutsEnabled) return opts.rawHandicapIndex;
  if (opts.roundHandicapSnapshot != null) return opts.roundHandicapSnapshot;
  return opts.currentTournamentHandicap ?? opts.startingTournamentHandicap ?? opts.rawHandicapIndex;
}

// For an already-processed round: player_id -> handicap actually used for
// it (tournament_handicap_history.handicap_before_cut on the active,
// non-superseded row). Empty map for a day that hasn't been processed yet
// (e.g. still in progress) — callers fall back to current_tournament_handicap.
export async function fetchRoundHandicapSnapshots(dayId: string): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('tournament_handicap_history')
    .select('player_id, handicap_before_cut')
    .eq('competition_day_id', dayId)
    .is('superseded_at', null);
  const out: Record<string, number> = {};
  (data ?? []).forEach((r: any) => { out[r.player_id] = Number(r.handicap_before_cut); });
  return out;
}

// Drop-in replacement for the last step of every screen's existing
// "build compPlayers from competition_players.handicap_index" fetch — takes
// whatever raw {player_id, handicap_index} array a screen already builds
// (the enrollment-snapshot value, untouched) and returns the same shape
// with handicap_index resolved through the tournament-cut engine. A day
// with an existing tournament_handicap_history snapshot uses it (frozen,
// matches whatever that round was actually played off); otherwise falls
// back to the player's live current_tournament_handicap. Returns rawComp
// completely unchanged whenever cuts are off or no competition/day context
// exists (casual rounds) — the required no-op path.
export async function resolveTournamentHandicaps<T extends { player_id: string; handicap_index: number }>(
  competitionId: string | null | undefined,
  dayId: string | null | undefined,
  rawComp: T[],
): Promise<T[]> {
  if (!competitionId || !dayId || rawComp.length === 0) return rawComp;
  const config = await fetchTournamentCutConfig(competitionId);
  if (!config.enabled) return rawComp;

  const [{ data: cpRows }, snapshots] = await Promise.all([
    supabase.from('competition_players')
      .select('player_id, starting_tournament_handicap, current_tournament_handicap')
      .eq('competition_id', competitionId)
      .in('player_id', rawComp.map(c => c.player_id)),
    fetchRoundHandicapSnapshots(dayId),
  ]);
  const byPlayer = new Map(((cpRows ?? []) as any[]).map(r => [r.player_id, r]));

  return rawComp.map(cp => {
    const cpRow = byPlayer.get(cp.player_id);
    const effective = resolveEffectiveHandicapIndex({
      rawHandicapIndex: cp.handicap_index,
      cutsEnabled: true,
      currentTournamentHandicap: cpRow?.current_tournament_handicap ?? null,
      startingTournamentHandicap: cpRow?.starting_tournament_handicap ?? null,
      roundHandicapSnapshot: snapshots[cp.player_id] ?? null,
    });
    return { ...cp, handicap_index: effective };
  });
}

interface DayMatchRow {
  id: string;
  status: string;
  home_player_ids: string[];
  away_player_ids: string[];
  holes_to_play: number | null;
}

async function loadDayPlayerStableford(dayId: string): Promise<{ playerIds: string[]; holesToPlay: number; totals: Record<string, number> }> {
  const { data: matches } = await supabase
    .from('matches')
    .select('id, status, home_player_ids, away_player_ids, holes_to_play')
    .eq('day_id', dayId);
  const dayMatches = (matches ?? []) as DayMatchRow[];
  const playerIds = [...new Set(dayMatches.flatMap(m => [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])]))];
  const holesToPlay = dayMatches[0]?.holes_to_play ?? 18;
  const totals: Record<string, number> = {};
  if (dayMatches.length > 0) {
    // 18 holes x every player on the day — a big field blows past PostGREST's
    // 1000-row default cap, and a truncated read here would silently under-count
    // Stableford totals and cut the wrong players' handicaps.
    const holes = await fetchAllRows<any>(
      (from, to) => supabase
        .from('match_holes')
        .select('player_id, stableford_pts')
        .in('match_id', dayMatches.map(m => m.id))
        .order('id')
        .range(from, to)
    );
    (holes ?? []).forEach((h: any) => {
      if (h.stableford_pts == null) return;
      totals[h.player_id] = (totals[h.player_id] ?? 0) + h.stableford_pts;
    });
  }
  return { playerIds, holesToPlay, totals };
}

// Call from every score-completion write site right after a match's status
// flips to 'complete', and from the same reconciliation-pass load effects
// admin/news.tsx/tour/index.tsx already use for the Final Report — checks
// the exact "every match in this day is complete" predicate those screens
// already compute (tour/index.tsx's allDaysComplete/isDayUnlocked shape)
// before calling processDayCuts, which is itself idempotent.
export async function checkAndProcessDayCuts(dayId: string | null | undefined): Promise<void> {
  if (!dayId) return;
  const { data: matches } = await supabase.from('matches').select('status').eq('day_id', dayId);
  if (!matches || matches.length === 0) return;
  if (!matches.every((m: any) => m.status === 'complete')) return;
  await processDayCuts(dayId);
}

// Call once every match in a day is complete (fire-and-forget from the
// score-completion screens, plus the same reconciliation-pass pattern
// admin/news.tsx already uses for the Final Report). Idempotent: a second
// concurrent call for the same day+player hits the partial unique index on
// tournament_handicap_history and is caught/ignored below.
export async function processDayCuts(dayId: string): Promise<void> {
  const { data: day } = await supabase
    .from('competition_days')
    .select('id, day_number, competition_id')
    .eq('id', dayId)
    .maybeSingle();
  if (!day) return;
  const competitionId = (day as any).competition_id as string;
  const dayNumber = (day as any).day_number as number;

  const config = await fetchTournamentCutConfig(competitionId);
  if (!config.enabled) return;

  const { playerIds, holesToPlay, totals } = await loadDayPlayerStableford(dayId);
  if (playerIds.length === 0) return;

  const { data: cpRows } = await supabase
    .from('competition_players')
    .select('id, player_id, starting_tournament_handicap, current_tournament_handicap')
    .eq('competition_id', competitionId)
    .in('player_id', playerIds);

  const trigger = effectiveTriggerScore(config.triggerScore, holesToPlay);

  for (const cp of (cpRows ?? []) as any[]) {
    const startHcp = cp.starting_tournament_handicap;
    const beforeCut = cp.current_tournament_handicap ?? startHcp;
    if (beforeCut == null) continue; // not snapshotted (shouldn't happen post-Go-Live, but never guess)
    const stablefordPts = totals[cp.player_id] ?? 0;
    const result = calcRoundCut(stablefordPts, trigger, beforeCut, config.bands);
    const afterCut = applyCut(beforeCut, result.cut, config.minimum);

    const { error } = await supabase.from('tournament_handicap_history').insert({
      competition_id: competitionId,
      competition_day_id: dayId,
      player_id: cp.player_id,
      day_number: dayNumber,
      stableford_pts: stablefordPts,
      trigger_score: trigger,
      handicap_before_cut: beforeCut,
      points_over_trigger: result.pointsOverTrigger,
      cut_per_point: result.cutPerPoint,
      cut_applied: result.cut,
      handicap_after_cut: afterCut,
    });
    // 23505 = unique_violation — another client already processed this
    // day+player; leave their competition_players row exactly as that
    // first successful call left it.
    if (error) { if ((error as any).code !== '23505') console.error('[tournamentHandicap] processDayCuts insert failed', error); continue; }

    await supabase.from('competition_players').update({
      current_tournament_handicap: afterCut,
      total_tournament_cut: startHcp != null ? Number(startHcp) - afterCut : 0,
    }).eq('id', cp.id);
  }
}

// Correction path: a completed round's score was edited after the fact.
// Reverses that round's cut, recomputes it, then walks forward through
// every later day in chronological order rebuilding the cumulative chain —
// never leaving a stale cut in place, never touching starting_tournament_handicap.
export async function reprocessFromDay(dayId: string): Promise<void> {
  const { data: fromDay } = await supabase
    .from('competition_days')
    .select('id, day_number, competition_id')
    .eq('id', dayId)
    .maybeSingle();
  if (!fromDay) return;
  const competitionId = (fromDay as any).competition_id as string;
  const fromDayNumber = (fromDay as any).day_number as number;

  const config = await fetchTournamentCutConfig(competitionId);
  if (!config.enabled) return;

  const { data: days } = await supabase
    .from('competition_days')
    .select('id, day_number')
    .eq('competition_id', competitionId)
    .gte('day_number', fromDayNumber)
    .order('day_number', { ascending: true });
  const chain = (days ?? []) as { id: string; day_number: number }[];
  if (chain.length === 0) return;

  const { data: cpRows } = await supabase
    .from('competition_players')
    .select('id, player_id, starting_tournament_handicap')
    .eq('competition_id', competitionId);
  const startHcpByPlayer: Record<string, number | null> = {};
  const cpIdByPlayer: Record<string, string> = {};
  (cpRows ?? []).forEach((cp: any) => { startHcpByPlayer[cp.player_id] = cp.starting_tournament_handicap; cpIdByPlayer[cp.player_id] = cp.id; });

  // Running "handicap before this round" per player, seeded from the
  // starting handicap and advanced as we walk forward.
  const runningBefore: Record<string, number | null> = { ...startHcpByPlayer };
  const finalAfter: Record<string, number> = {};

  for (const day of chain) {
    const isCorrectedDay = day.day_number === fromDayNumber;
    // The corrected day's own stableford total must be recomputed live
    // (it's the one that changed); every later day reuses its own
    // previously-stored total so an unrelated edit elsewhere isn't
    // compounded into this pass.
    let totals: Record<string, number>;
    let holesToPlay: number;
    if (isCorrectedDay) {
      const loaded = await loadDayPlayerStableford(day.id);
      totals = loaded.totals;
      holesToPlay = loaded.holesToPlay;
    } else {
      const { data: rows } = await supabase
        .from('tournament_handicap_history')
        .select('player_id, stableford_pts, trigger_score')
        .eq('competition_day_id', day.id)
        .is('superseded_at', null);
      totals = {};
      (rows ?? []).forEach((r: any) => { totals[r.player_id] = r.stableford_pts; });
      holesToPlay = 18; // trigger_score on the superseded row already reflects any 9-hole scaling; recomputed below from that row directly where possible
      const triggerByPlayer: Record<string, number> = {};
      (rows ?? []).forEach((r: any) => { triggerByPlayer[r.player_id] = r.trigger_score; });
      (day as any)._triggerByPlayer = triggerByPlayer;
    }

    // Soft-supersede this day's currently-active rows before inserting revisions.
    const { data: activeRows } = await supabase
      .from('tournament_handicap_history')
      .select('id, player_id, revision')
      .eq('competition_day_id', day.id)
      .is('superseded_at', null);
    const revisionByPlayer: Record<string, number> = {};
    for (const row of (activeRows ?? []) as any[]) {
      revisionByPlayer[row.player_id] = row.revision;
      await supabase.from('tournament_handicap_history').update({
        superseded_at: new Date().toISOString(),
        superseded_reason: `score_correction:day_${fromDayNumber}`,
      }).eq('id', row.id);
    }

    for (const playerId of Object.keys(totals)) {
      const before = runningBefore[playerId];
      if (before == null) continue;
      const trigger = isCorrectedDay
        ? effectiveTriggerScore(config.triggerScore, holesToPlay)
        : ((day as any)._triggerByPlayer?.[playerId] ?? config.triggerScore);
      const stablefordPts = totals[playerId];
      const result = calcRoundCut(stablefordPts, trigger, before, config.bands);
      const after = applyCut(before, result.cut, config.minimum);

      await supabase.from('tournament_handicap_history').insert({
        competition_id: competitionId,
        competition_day_id: day.id,
        player_id: playerId,
        day_number: day.day_number,
        stableford_pts: stablefordPts,
        trigger_score: trigger,
        handicap_before_cut: before,
        points_over_trigger: result.pointsOverTrigger,
        cut_per_point: result.cutPerPoint,
        cut_applied: result.cut,
        handicap_after_cut: after,
        revision: (revisionByPlayer[playerId] ?? 0) + 1,
      });

      runningBefore[playerId] = after;
      finalAfter[playerId] = after;
    }
  }

  await Promise.all(Object.entries(finalAfter).map(([playerId, afterCut]) => {
    const cpId = cpIdByPlayer[playerId];
    if (!cpId) return Promise.resolve();
    const startHcp = startHcpByPlayer[playerId];
    return supabase.from('competition_players').update({
      current_tournament_handicap: afterCut,
      total_tournament_cut: startHcp != null ? Number(startHcp) - afterCut : 0,
    }).eq('id', cpId);
  }));
}
