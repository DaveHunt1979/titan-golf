import { createClient } from '@supabase/supabase-js';

// Service-role client — server-only, never imported by a 'use client'
// component. Used for genuinely public pages (the Titan Newsreel) so they
// don't need RLS opened up to `anon` on tables that may later grow
// sensitive columns; the route itself controls exactly which fields it
// selects and renders instead.
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set — add it to web/.env.local (same value the titan-news edge function uses).');
  return createClient(
    'https://zzmkdwjkxqeioeukqaie.supabase.co',
    key,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
