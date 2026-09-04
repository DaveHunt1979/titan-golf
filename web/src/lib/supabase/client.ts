import { createBrowserClient } from '@supabase/ssr';

const SUPABASE_URL = 'https://zzmkdwjkxqeioeukqaie.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6bWtkd2preHFlaW9ldWtxYWllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NDc0MDEsImV4cCI6MjA5NzEyMzQwMX0.oJAdTog31DWWtbb_WcO6sPo3GVD95pPkd9LOxkjnvJA';

// Singleton: components that call createClient() in the render body and use
// the result as a useEffect dependency (e.g. `useEffect(..., [supabase])`)
// were getting a brand-new client instance every render, which never equals
// the previous one — the effect fires again, sets state, re-renders, gets a
// new client, fires again... an infinite refetch loop. That loop is what
// produces flickering dropdowns/lists and races where a stale response can
// clobber a correct one (e.g. an admin gate flipping to "access required").
// A shared browser client is the standard, safe pattern here — reuse one
// instance for the life of the page instead of minting a new one per call.
//
// The singleton is built by a concrete (non-generic-call-site) helper so
// `ReturnType<typeof ...>` resolves to the real, fully-typed client rather
// than the generic `createBrowserClient` function's unresolved type.
function buildBrowserClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

let browserClient: ReturnType<typeof buildBrowserClient> | undefined;

export function createClient() {
  if (!browserClient) {
    browserClient = buildBrowserClient();
  }
  return browserClient;
}
