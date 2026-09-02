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
  // Present regardless of WHS on/off — the tee a player chose for the round,
  // used to show their real per-tee yardage (course_tee_holes) even when no
  // handicap math is involved. See round_player_tees' original design note.
  tee_name?: string | null;
  gender?: string | null;
}

// Swindle games use one shared Tee Box the creator sets, not each player
// picking their own (Dave, 2026-09-02 — same model tournament already uses).
// A round_player_tees row is still written per player so score/[gameId].tsx's
// existing WHS handicap resolution never has to know the tee came from the
// game rather than the player — this only changes WHERE the tee choice comes
// from, not how it's consumed downstream. Pure by design (no supabase import
// here — see file header); callers upsert the returned snapshot themselves.
export function buildSwindleTeeSnapshot(
  game: {
    tee_name: string | null; tee_gender: string | null; tee_par: number | null;
    course_rating: number | null; slope_rating: number | null;
    whs_enabled: boolean; hcp_allowance: number | null;
  },
  handicapIndex: number | null,
): (RoundPlayerTeeSnapshot & {
  handicap_index_at_start?: number | null; slope_at_start?: number | null;
  course_rating_at_start?: number | null; par_at_start?: number | null;
}) | null {
  if (!game.tee_name) return null; // no shared tee configured — leave the round exactly as it was before this feature existed
  if (game.whs_enabled && handicapIndex != null && game.tee_par != null && game.course_rating != null && game.slope_rating != null) {
    const whs = calculateWHSPlayingHandicap(handicapIndex, game.slope_rating, game.course_rating, game.tee_par, game.hcp_allowance ?? 100);
    return {
      tee_name: game.tee_name, gender: game.tee_gender,
      handicap_index_at_start: handicapIndex,
      slope_at_start: game.slope_rating, course_rating_at_start: game.course_rating, par_at_start: game.tee_par,
      playing_handicap_at_start: whs.playingHandicap,
      whs_enabled_at_start: true,
    };
  }
  return { tee_name: game.tee_name, gender: game.tee_gender, whs_enabled_at_start: false };
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
