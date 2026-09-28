// AsyncStorage's native module isn't available under Jest — this is the
// package's own documented mock (see AsyncStorage's Jest integration docs),
// needed because src/lib/supabase.ts imports it at module scope and gets
// pulled in transitively by anything importing src/lib code, even pure
// functions that never touch storage themselves.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// src/lib/supabase.ts creates its client at module load time (not lazily),
// so any test importing a src/lib module transitively needs these set even
// when it never calls Supabase — createClient() throws immediately if the
// URL is empty. Jest doesn't load .env.local the way Expo's dev server
// does, so these are deliberately fake placeholders, not real credentials.
process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
