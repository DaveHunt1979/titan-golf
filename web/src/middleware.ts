import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const SUPABASE_URL = 'https://zzmkdwjkxqeioeukqaie.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6bWtkd2preHFlaW9ldWtxYWllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NDc0MDEsImV4cCI6MjA5NzEyMzQwMX0.oJAdTog31DWWtbb_WcO6sPo3GVD95pPkd9LOxkjnvJA';

// Without this middleware, @supabase/ssr's browser client (used for sign-in)
// and server client (used by server components like /admin, /dashboard,
// /profile) can see different, desynced sessions — the browser thinks
// you're signed in as the new account while a server-rendered page still
// reads the old/expired auth cookie. This is the standard Supabase +
// Next.js SSR middleware: it runs on every request, refreshes the session
// if the access token has expired, and re-writes the resulting cookies onto
// the response so client and server always agree on who's signed in.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: request.headers } });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Touching auth on every request is what actually refreshes an expiring
  // session and writes the new cookies above — do not remove this call even
  // though the result is unused.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
