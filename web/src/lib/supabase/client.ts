import { createBrowserClient } from '@supabase/ssr';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://zzmkdwjkxqeioeukqaie.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6bWtkd2preHFlaW9ldWtxYWllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NDc0MDEsImV4cCI6MjA5NzEyMzQwMX0.oJAdTog31DWWtbb_WcO6sPo3GVD95pPkd9LOxkjnvJA';

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
