// Automatic counterpart to the manual "enter 3+ scorecards" calculator in
// profile/handicap.tsx (Dave, 2026-09-02 — "Titan Season" prep). Same WHS
// differential math (see whs.ts), but built from rounds actually played
// inside the app instead of typed in by hand, so a player's Suggested
// Handicap keeps itself current without them lifting a finger — the case
// that prompted this was a player whose declared Handicap Index (an 18)
// never moved no matter how many rounds they played.
//
// Scope for v1: casual + tournament rounds only (the matches/match_holes
// tables) — Swindle uses a separate scoring model and isn't included yet.
// Only full 18-hole rounds with every hole's gross_score recorded count,
// since a partial round can't produce a real WHS differential.
import { supabase, fetchAllRows } from './supabase';
import { fetchCourseTees } from '../components/TeePickerSheet';
import { calcDifferential, calcHandicapIndex } from './whs';

export interface SuggestedHandicapResult {
  value: number;
  roundsUsed: number;
}

const MIN_ROUNDS = 3;
// Most-recent matches scanned for a valid differential — WHS only ever
// needs the best of the most recent 20, so this comfortably covers that
// for any player who plays semi-regularly without scanning their whole history.
const MAX_MATCHES_CHECKED = 50;
const MAX_DIFFERENTIALS = 20;

interface RatingInfo { rating: number; slope: number; }

export async function computeSuggestedHandicap(playerId: string): Promise<SuggestedHandicapResult | null> {
  const { data: matches } = await supabase
    .from('matches')
    .select('id, day_id, course_name, completed_at')
    .or(`home_player_ids.cs.{${playerId}},away_player_ids.cs.{${playerId}}`)
    .eq('status', 'complete')
    .not('course_name', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(MAX_MATCHES_CHECKED);

  const rows = (matches ?? []) as { id: string; day_id: string | null; course_name: string; completed_at: string | null }[];
  if (rows.length === 0) return null;

  const matchIds = rows.map(r => r.id);
  const dayIds = [...new Set(rows.map(r => r.day_id).filter((id): id is string => id != null))];

  const [holeRows, snapshotRows] = await Promise.all([
    fetchAllRows<{ match_id: string; gross_score: number | null }>(
      (from, to) => supabase.from('match_holes').select('match_id, gross_score').in('match_id', matchIds).eq('player_id', playerId).range(from, to)
    ),
    dayIds.length
      ? supabase.from('round_player_tees').select('day_id, course_rating_at_start, slope_at_start').in('day_id', dayIds).eq('player_id', playerId).then(r => r.data ?? [])
      : Promise.resolve([] as any[]),
  ]);

  const grossByMatch: Record<string, number> = {};
  const holeCountByMatch: Record<string, number> = {};
  for (const h of holeRows) {
    if (h.gross_score == null) continue;
    grossByMatch[h.match_id] = (grossByMatch[h.match_id] ?? 0) + h.gross_score;
    holeCountByMatch[h.match_id] = (holeCountByMatch[h.match_id] ?? 0) + 1;
  }

  // Only a full 18-hole gross score is a valid WHS differential input.
  const qualifying = rows.filter(r => holeCountByMatch[r.id] === 18);
  if (qualifying.length === 0) return null;

  // Exact per-round rating/slope when WHS was on for that round
  // (round_player_tees snapshot); otherwise fall back to the course's own
  // tees averaged together — an estimate, since the exact tee played isn't
  // recorded when WHS is off.
  const snapshotByDay: Record<string, RatingInfo> = {};
  for (const s of snapshotRows as any[]) {
    if (s.course_rating_at_start != null && s.slope_at_start != null) {
      snapshotByDay[s.day_id] = { rating: Number(s.course_rating_at_start), slope: Number(s.slope_at_start) };
    }
  }

  const courseNamesNeedingFallback = [...new Set(
    qualifying.filter(r => !r.day_id || !snapshotByDay[r.day_id]).map(r => r.course_name)
  )];
  const ratingByCourse: Record<string, RatingInfo | null> = {};
  await Promise.all(courseNamesNeedingFallback.map(async name => {
    const tees = await fetchCourseTees(name);
    const rated = tees.filter(t => t.course_rating != null && t.slope_rating != null);
    if (rated.length === 0) { ratingByCourse[name] = null; return; }
    ratingByCourse[name] = {
      rating: rated.reduce((a, t) => a + t.course_rating!, 0) / rated.length,
      slope: rated.reduce((a, t) => a + t.slope_rating!, 0) / rated.length,
    };
  }));

  const differentials: number[] = [];
  for (const r of qualifying) {
    const info = (r.day_id && snapshotByDay[r.day_id]) ?? ratingByCourse[r.course_name];
    if (!info) continue;
    differentials.push(calcDifferential(grossByMatch[r.id], info.rating, info.slope));
    if (differentials.length >= MAX_DIFFERENTIALS) break;
  }

  if (differentials.length < MIN_ROUNDS) return null;
  return { value: calcHandicapIndex(differentials), roundsUsed: differentials.length };
}
