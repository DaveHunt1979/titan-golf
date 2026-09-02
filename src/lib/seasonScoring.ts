// Titan Season Mode — Stableford + Titan Round scoring engine (spec §8-11,
// Dave, 2026-09-05). Pure functions only, no supabase import — mirrors
// scoring.ts/whs.ts. Reuses calcStrokesReceived/calcStablefordPoints from
// scoring.ts (already implements exactly the stroke-index allocation + net
// Stableford table the spec wants, including plus-handicap support per
// spec §8.5) instead of reimplementing them, and calculateWHSPlayingHandicap
// from whs.ts for the Season Playing Handicap (identical concept, same math).
//
// Scope: this covers the spec's Stableford Service + Titan Scoring Engine +
// Best20 Service + Major Service (§19) — the deterministic per-round and
// per-season calculations. League table ranking/tiebreakers (§13),
// promotion/relegation (§6) and DNQ-at-close (§21) are the Leaderboard/
// Movement/Season-Close services — a later phase, not built here.
import { calcStrokesReceived, calcStablefordPoints } from './scoring';
import { calculateWHSPlayingHandicap } from './whs';

export interface SeasonScoringProfile {
  performanceBonus: Record<string, number>; // keys: "31_or_less", "32".."40", "41_plus"
  grossBonus: { birdie: number; eagle: number; albatrossOrBetter: number; holeInOneExtra: number };
  roundFloor: number;
  majorMultiplier: number;
}

// Matches spec Appendix A / §9.4 exactly.
export const DEFAULT_SEASON_SCORING_PROFILE: SeasonScoringProfile = {
  performanceBonus: {
    '31_or_less': 0, '32': 2, '33': 4, '34': 6, '35': 8, '36': 10,
    '37': 12, '38': 14, '39': 16, '40': 18, '41_plus': 20,
  },
  grossBonus: { birdie: 5, eagle: 10, albatrossOrBetter: 20, holeInOneExtra: 10 },
  roundFloor: 0,
  majorMultiplier: 1.5,
};

export type GrossAchievementType =
  | 'hole_in_one' | 'albatross_or_better' | 'eagle' | 'birdie' | 'par' | 'bogey' | 'double_or_worse';

export interface SeasonHoleInput {
  holeNumber: number;
  par: number;
  strokeIndex: number; // 1-18
  grossScore: number;
}

export interface SeasonHoleResult {
  holeNumber: number;
  par: number;
  strokeIndex: number;
  grossScore: number;
  handicapStrokesReceived: number;
  netScore: number;
  netRelativeToPar: number;
  stablefordPoints: number;
  grossRelativeToPar: number;
  grossAchievementType: GrossAchievementType;
  grossBonusPoints: number;
}

function classifyGross(grossScore: number, par: number): GrossAchievementType {
  if (grossScore === 1) return 'hole_in_one';
  const rel = grossScore - par;
  if (rel <= -3) return 'albatross_or_better';
  if (rel === -2) return 'eagle';
  if (rel === -1) return 'birdie';
  if (rel === 0) return 'par';
  if (rel === 1) return 'bogey';
  return 'double_or_worse';
}

// spec §9.3 — birdie/eagle/albatross bonuses are keyed off relative-to-par,
// not the hole_in_one classification itself (a hole-in-one on a par 4 is
// still 3-under-par, i.e. "albatross or better"); the +10 HIO bonus is
// always additional on top of whatever that relative-to-par bonus is.
function grossBonusFor(grossScore: number, par: number, profile: SeasonScoringProfile): number {
  const rel = grossScore - par;
  let bonus = 0;
  if (rel <= -3) bonus = profile.grossBonus.albatrossOrBetter;
  else if (rel === -2) bonus = profile.grossBonus.eagle;
  else if (rel === -1) bonus = profile.grossBonus.birdie;
  // par/bogey/double-or-worse: 0 additional, spec §9.3
  if (grossScore === 1) bonus += profile.grossBonus.holeInOneExtra;
  return bonus;
}

export function calcSeasonHoleResult(
  hole: SeasonHoleInput,
  playingHandicap: number,
  profile: SeasonScoringProfile = DEFAULT_SEASON_SCORING_PROFILE,
): SeasonHoleResult {
  const strokesReceived = calcStrokesReceived(playingHandicap, hole.strokeIndex);
  const netScore = hole.grossScore - strokesReceived;
  return {
    holeNumber: hole.holeNumber,
    par: hole.par,
    strokeIndex: hole.strokeIndex,
    grossScore: hole.grossScore,
    handicapStrokesReceived: strokesReceived,
    netScore,
    netRelativeToPar: netScore - hole.par,
    stablefordPoints: calcStablefordPoints(hole.grossScore, hole.par, strokesReceived),
    grossRelativeToPar: hole.grossScore - hole.par,
    grossAchievementType: classifyGross(hole.grossScore, hole.par),
    grossBonusPoints: grossBonusFor(hole.grossScore, hole.par, profile),
  };
}

// spec §9.2 — table lookup by 18-hole Stableford total.
export function calcPerformanceBonus(
  stablefordTotal: number,
  profile: SeasonScoringProfile = DEFAULT_SEASON_SCORING_PROFILE,
): number {
  if (stablefordTotal >= 41) return profile.performanceBonus['41_plus'] ?? 0;
  if (stablefordTotal <= 31) return profile.performanceBonus['31_or_less'] ?? 0;
  return profile.performanceBonus[String(stablefordTotal)] ?? 0;
}

export interface SeasonRoundResult {
  holes: SeasonHoleResult[];
  stablefordTotal: number;
  performanceBonus: number;
  grossAchievementBonus: number;
  baseTitanRoundPoints: number;
  majorMultiplier: number | null;
  finalRoundPoints: number;
}

// spec §8.1/§8.2 — Season Playing Handicap: Course Handicap × allowance%,
// same math as calculateWHSPlayingHandicap (whs.ts). Season default
// allowance is 100% per spec §8.1, unlike casual/tournament rounds which
// default to whatever the round's own allowance setting is.
export function calcSeasonPlayingHandicap(
  handicapIndex: number,
  slopeRating: number,
  courseRating: number,
  par: number,
  handicapAllowancePercent: number,
): number {
  return calculateWHSPlayingHandicap(handicapIndex, slopeRating, courseRating, par, handicapAllowancePercent).playingHandicap;
}

// spec §9.1 — full round: Stableford + Performance Bonus + Gross Achievement
// Bonus, then round_half_up(points × Major Multiplier) if Major-eligible.
// Math.round is round-half-up for the positive values every round produces
// here, matching spec's round_half_up requirement exactly.
export function calcSeasonRound(
  holes: SeasonHoleInput[],
  playingHandicap: number,
  opts: { profile?: SeasonScoringProfile; majorMultiplier?: number | null } = {},
): SeasonRoundResult {
  const profile = opts.profile ?? DEFAULT_SEASON_SCORING_PROFILE;
  const holeResults = holes.map(h => calcSeasonHoleResult(h, playingHandicap, profile));
  const stablefordTotal = holeResults.reduce((sum, h) => sum + h.stablefordPoints, 0);
  const performanceBonus = calcPerformanceBonus(stablefordTotal, profile);
  const grossAchievementBonus = holeResults.reduce((sum, h) => sum + h.grossBonusPoints, 0);
  const baseTitanRoundPoints = Math.max(profile.roundFloor, stablefordTotal + performanceBonus + grossAchievementBonus);
  const majorMultiplier = opts.majorMultiplier ?? null;
  const finalRoundPoints = majorMultiplier != null
    ? Math.round(baseTitanRoundPoints * majorMultiplier)
    : baseTitanRoundPoints;
  return { holes: holeResults, stablefordTotal, performanceBonus, grossAchievementBonus, baseTitanRoundPoints, majorMultiplier, finalRoundPoints };
}

// spec §11.2 — only the player's highest Base Titan Round Points inside a
// Major window receives the multiplier, reassigned automatically whenever a
// later verified round beats it. Pure/idempotent: always recomputed fresh
// from the current set of rounds, so calling it again after a new round
// naturally reassigns rather than needing a separate "undo" step. Ties
// broken by earliest playedAt — the spec doesn't define its own Major tie
// rule, so this reuses the same determinism requirement as Best 20 (§10.2).
export function resolveMajorRound<T extends { roundId: string; baseTitanRoundPoints: number; playedAt: string }>(
  roundsInMajorWindow: T[],
): string | null {
  if (roundsInMajorWindow.length === 0) return null;
  const sorted = [...roundsInMajorWindow].sort((a, b) =>
    b.baseTitanRoundPoints - a.baseTitanRoundPoints || a.playedAt.localeCompare(b.playedAt)
  );
  return sorted[0].roundId;
}

export interface BestRoundsResult<T> {
  counting: T[];
  nonCounting: T[];
  seasonPoints: number;
  nextScoreToBeat: number | null;
}

// spec §10.2 — Best 20: sort all qualifying rounds by Final Round Points
// descending (deterministic tiebreak by earliest playedAt), mark the top
// `limit` counting. Idempotent by construction — always a fresh recompute
// off the full round list, never a stateful "replace the lowest" step, so
// a corrected/voided round just falls out of the input set naturally
// (spec §20.2's idempotency requirement, and the edge case in §22 "Admin
// voids a counting round → rebuild Best 20 automatically").
export function selectCountingRounds<T extends { roundId: string; finalRoundPoints: number; playedAt: string }>(
  qualifyingRounds: T[],
  limit: number,
): BestRoundsResult<T> {
  const sorted = [...qualifyingRounds].sort((a, b) =>
    b.finalRoundPoints - a.finalRoundPoints || a.playedAt.localeCompare(b.playedAt)
  );
  const counting = sorted.slice(0, limit);
  const nonCounting = sorted.slice(limit);
  const seasonPoints = counting.reduce((sum, r) => sum + r.finalRoundPoints, 0);
  const nextScoreToBeat = counting.length >= limit ? counting[counting.length - 1].finalRoundPoints : null;
  return { counting, nonCounting, seasonPoints, nextScoreToBeat };
}

// spec §10.1/§13.2 — the LIVE in-season display value. DNQ is a separate,
// season-close-only transition (§21.1 step 51/§22): a future Season Close
// service relabels any entry still 'provisional' at that point to 'dnq'.
// Not built here — this only ever returns the two live states.
export function qualificationStatus(qualifyingRoundsCount: number, minimumQualifyingRounds: number): 'provisional' | 'qualified' {
  return qualifyingRoundsCount >= minimumQualifyingRounds ? 'qualified' : 'provisional';
}
