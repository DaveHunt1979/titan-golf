import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// supabase.channel(name) returns the SAME object for a repeated name — it
// doesn't create a second one. A screen using a fixed, non-id-scoped
// channel name (a society-wide or home-screen live feed, not a
// per-record one) crashes with "cannot add postgres_changes callbacks...
// after subscribe()" the moment it's mounted twice, e.g. because React
// Navigation kept an earlier instance alive in the background rather than
// unmounting it (see the identical dangling-subscription crash fixed in
// score/enter/[matchId].tsx today, 2026-08-20 — same underlying cause,
// different screen). Removing any stale channel with this name first
// guarantees every mount starts from a clean, unsubscribed channel.
export function freshChannel(name: string) {
  const existing = supabase.getChannels().find(c => c.topic === `realtime:${name}`);
  if (existing) supabase.removeChannel(existing);
  return supabase.channel(name);
}

// PostgREST caps an unbounded .select() at 1000 rows by default — fine when
// course_holes held 738 rows total, silently truncating "list every course"
// queries now that the course-master import brought it to 13k+ (2026-08-25).
// Pages through with .range() until a short page signals the end.
export async function fetchAllRows<T>(
  queryFactory: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryFactory(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
