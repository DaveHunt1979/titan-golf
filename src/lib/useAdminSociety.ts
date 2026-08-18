import { useSocietyTheme } from './SocietyThemeContext';

// Admin screens must act on whichever society the player currently has
// active (via the Locker Room switcher), not just "any society they admin" —
// an admin of two societies could otherwise silently edit the wrong one.
export function useAdminSociety() {
  const { societyId, loaded } = useSocietyTheme();
  return { societyId: loaded ? societyId : null, loading: !loaded };
}
