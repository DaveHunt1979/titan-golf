import type { Router } from 'expo-router';

// True "go back one screen" whenever there's real navigation history to go
// back to; falls back to a fixed destination only when there isn't (a
// screen opened from a push notification/DM link, or reachable from more
// than one place in the app, can have an empty or unpredictable stack —
// router.back() alone landed on the home tab in that case, see the history
// in swindle/group/new.tsx before this helper existed). Every "← Back"
// button should use this rather than a bare router.replace(fixedRoute),
// which ignores real history and always jumps to the same place even when
// the user actually came from somewhere else (Dave, 2026-08-19 — "back
// buttons need to go back one stage").
export function goBack(router: Router, fallback: string) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback as any);
}
