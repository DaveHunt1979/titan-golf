import { Stack } from 'expo-router';

// Reset to this section's hub screen whenever its tab is pressed again —
// see the tabPress listeners in app/(app)/_layout.tsx.
export default function ProfileLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
