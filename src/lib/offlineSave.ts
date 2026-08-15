import { supabase } from './supabase';
import { enqueueHole, isNetworkError } from './offlineQueue';

export function isMissingMatchError(err: any): boolean {
  return err?.code === '23503' || /foreign key/i.test(String(err?.message ?? ''));
}

export interface HoleSaveInput {
  matchId: string;
  holeNumber: number;
  insertRows: Record<string, any>[];
  statRows?: Record<string, any>[];
  matchUpdate: Record<string, any>;
}

export type HoleSaveResult =
  | { outcome: 'saved' }
  | { outcome: 'saved_offline' }
  | { outcome: 'missing_match' }
  | { outcome: 'error'; error: any };

// Local-first hole save used by every scoring screen: try the live write,
// and only fall back to the offline queue on a genuine network error — a
// real server/validation error is surfaced to the caller instead of queued,
// since silently queuing a bad write would just replay the same failure
// later. Callers own all format-specific scoring math and their own
// optimistic UI update; this only owns the persist-or-queue decision.
export async function saveHoleWithOfflineFallback(input: HoleSaveInput): Promise<HoleSaveResult> {
  const { matchId, holeNumber, insertRows, statRows = [], matchUpdate } = input;
  try {
    await supabase.from('match_holes').delete().eq('match_id', matchId).eq('hole_number', holeNumber);
    // A hole can legitimately end up with no rows — team stableford lets the
    // scorer clear every entered score by re-tapping it — and an empty insert
    // body is rejected, so the delete above is the whole write in that case.
    // Matches drainQueue's replay, which already guards the same way.
    if (insertRows.length > 0) {
      const { error: insErr } = await supabase.from('match_holes').insert(insertRows);
      if (insErr) throw insErr;
    }
    if (statRows.length > 0) {
      await supabase.from('hole_stats').upsert(statRows, { onConflict: 'match_id,player_id,hole_number' });
    }
    // Some formats (skins/nassau/scramble/par-bogey) only touch the match row
    // when the round finishes, so a per-hole save has nothing to update — an
    // empty PATCH body is rejected by PostgREST, so skip the write entirely.
    if (Object.keys(matchUpdate).length > 0) {
      const { error: updErr } = await supabase.from('matches').update(matchUpdate).eq('id', matchId);
      if (updErr) throw updErr;
    }
    return { outcome: 'saved' };
  } catch (err: any) {
    if (isMissingMatchError(err)) return { outcome: 'missing_match' };
    if (!isNetworkError(err)) return { outcome: 'error', error: err };
    await enqueueHole({ matchId, holeNumber, insertRows, statRows, matchUpdate });
    return { outcome: 'saved_offline' };
  }
}
