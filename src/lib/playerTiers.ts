import { supabase } from './supabase';

// Shared favourites/recently-played model behind the 3-tier player lists in
// both the game-creation picker (GroupBuilderSheet) and the Player Library —
// one engine, two different candidate pools (society members vs library
// entries), so favouriting/recency logic never drifts between the screens.

export async function fetchFavouriteIds(ownerId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('player_favourites').select('favourite_player_id').eq('owner_player_id', ownerId);
  return new Set((data ?? []).map((r: any) => r.favourite_player_id as string));
}

export async function toggleFavourite(ownerId: string, targetId: string, makeFavourite: boolean): Promise<string | null> {
  if (makeFavourite) {
    const { error } = await supabase
      .from('player_favourites').insert({ owner_player_id: ownerId, favourite_player_id: targetId } as any);
    if (error && (error as any).code !== '23505') return error.message;
    return null;
  }
  const { error } = await supabase
    .from('player_favourites').delete().eq('owner_player_id', ownerId).eq('favourite_player_id', targetId);
  return error?.message ?? null;
}

// Derived live from match history, most-recent-first, deduped — no stored
// column to maintain, so it can never go stale or need a backfill. Ordered
// by created_at for the fetch window (matches virtually always complete
// close to when they're created), then re-sorted client-side by whichever
// timestamp best reflects "when this was actually played."
export async function fetchRecentlyPlayedWithIds(myId: string, limit = 12): Promise<string[]> {
  const { data } = await supabase
    .from('matches')
    .select('home_player_ids, away_player_ids, completed_at, started_at, created_at')
    .or(`home_player_ids.cs.{${myId}},away_player_ids.cs.{${myId}}`)
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = (data ?? []) as any[];
  rows.sort((a, b) => {
    const at = new Date(a.completed_at ?? a.started_at ?? a.created_at).getTime();
    const bt = new Date(b.completed_at ?? b.started_at ?? b.created_at).getTime();
    return bt - at;
  });

  const seen = new Set<string>([myId]);
  const ordered: string[] = [];
  for (const m of rows) {
    const ids: string[] = [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
      if (ordered.length >= limit) return ordered;
    }
  }
  return ordered;
}

export interface RecentRound {
  matchId: string;
  courseName: string | null;
  points: number | null;
}

// T-Card's "last 3 rounds" stat (Dave, 2026-08-21) — same completed-match
// lookup pattern as fetchRecentlyPlayedWithIds above, just scoped to one
// player and summing their own stableford_pts per round rather than
// collecting opponent ids. stableford_pts is recorded for every round
// format (see solo.tsx/enter.tsx), not just Stableford ones, so this stays
// meaningful as a quick form indicator regardless of what was actually
// played.
export async function fetchLastRounds(playerId: string, limit = 3): Promise<RecentRound[]> {
  const { data: matches } = await supabase
    .from('matches')
    .select('id, completed_at, day:day_id(course_name)')
    .or(`home_player_ids.cs.{${playerId}},away_player_ids.cs.{${playerId}}`)
    .eq('status', 'complete')
    .order('completed_at', { ascending: false })
    .limit(limit);

  const rows = (matches ?? []) as any[];
  if (!rows.length) return [];

  const matchIds = rows.map(m => m.id);
  const { data: holes } = await supabase
    .from('match_holes').select('match_id, stableford_pts')
    .in('match_id', matchIds).eq('player_id', playerId);

  const ptsByMatch: Record<string, number> = {};
  for (const h of (holes ?? []) as any[]) {
    ptsByMatch[h.match_id] = (ptsByMatch[h.match_id] ?? 0) + (h.stableford_pts ?? 0);
  }

  return rows.map(m => ({
    matchId: m.id,
    courseName: (m.day as any)?.course_name ?? null,
    points: ptsByMatch[m.id] ?? null,
  }));
}

export function partitionIntoTiers<T extends { id: string }>(
  candidates: T[],
  favouriteIds: Set<string>,
  recentIds: string[],
): { favourites: T[]; recent: T[]; rest: T[] } {
  const byId = new Map(candidates.map(c => [c.id, c]));
  const used = new Set<string>();

  const favourites = candidates.filter(c => favouriteIds.has(c.id));
  favourites.forEach(c => used.add(c.id));

  const recent: T[] = [];
  for (const id of recentIds) {
    if (used.has(id)) continue;
    const c = byId.get(id);
    if (c) { recent.push(c); used.add(id); }
  }

  const rest = candidates.filter(c => !used.has(c.id));
  return { favourites, recent, rest };
}
