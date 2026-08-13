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
