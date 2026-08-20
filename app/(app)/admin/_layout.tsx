import { Stack } from 'expo-router';

// Reset to this section's hub screen whenever its tab is pressed again —
// without this, React Navigation keeps a nested Stack's full push history
// alive across tab switches, so returning to the Admin tab after drilling
// into Build resumes mid-wizard instead of showing the hub (Dave,
// 2026-08-20 — "I click on admin and it wants me to build a tournament").
// See the tabPress listeners in app/(app)/_layout.tsx for the actual reset.
export default function AdminLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
