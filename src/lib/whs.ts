// WHS (World Handicap System) layer — an isolated calculation service that
// sits BEFORE the existing scoring engine. Its only job is to turn a
// player's Handicap Index into a Playing Handicap using their own selected
// tee's rating data; everything below that point (calcStrokesReceived,
// stableford/matchplay scoring) is untouched and unaware WHS exists.
//
// Deliberately kept out of scoring.ts: this is the one central WHS service
// the brief calls for, not a per-format variant.
import { playerCourseHcp } from './scoring';

export interface WHSHandicapResult {
  courseHandicapUnrounded: number;
  playingHandicap: number;
}

// courseRating/par/slope must never be guessed — callers are responsible
// for confirming all three are present before calling this (see the Start
// Round validation in game-setup screens). handicapAllowancePct is a
// percentage (e.g. 100, 95), matching playerCourseHcp's existing convention.
export function calculateWHSPlayingHandicap(
  handicapIndex: number,
  slopeRating: number,
  courseRating: number,
  par: number,
  handicapAllowancePct: number,
): WHSHandicapResult {
  const courseHandicapUnrounded = handicapIndex * (slopeRating / 113) + (courseRating - par);
  const playingHandicap = Math.round(courseHandicapUnrounded * (handicapAllowancePct / 100));
  return { courseHandicapUnrounded, playingHandicap };
}

export interface RoundPlayerTeeSnapshot {
  whs_enabled_at_start?: boolean | null;
  playing_handicap_at_start?: number | null;
}

// The one new call every scoring screen adopts in place of calling
// playerCourseHcp directly. With no snapshot (WHS off, or not yet started)
// this falls through to today's exact playerCourseHcp behavior — same
// arguments, same result. Once a round has started with WHS on, the frozen
// snapshot value is returned instead, so a later change to the player's
// profile handicap or the day's course data can never retroactively alter
// a historic round's stroke allocation.
export function resolvePlayingHandicap(
  hcpIndex: number,
  day: { slope_rating?: number | null; course_rating?: number | null; course_par?: number | null } | null | undefined,
  allowance: number | undefined,
  roundPlayerTee: RoundPlayerTeeSnapshot | null | undefined,
): number {
  if (roundPlayerTee?.whs_enabled_at_start && roundPlayerTee.playing_handicap_at_start != null) {
    return roundPlayerTee.playing_handicap_at_start;
  }
  return playerCourseHcp(hcpIndex, day, allowance);
}
