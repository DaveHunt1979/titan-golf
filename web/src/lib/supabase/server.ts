import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    'https://zzmkdwjkxqeioeukqaie.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6bWtkd2preHFlaW9ldWtxYWllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NDc0MDEsImV4cCI6MjA5NzEyMzQwMX0.oJAdTog31DWWtbb_WcO6sPo3GVD95pPkd9LOxkjnvJA',
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );
}
