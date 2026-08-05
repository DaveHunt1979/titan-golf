# Titan Golf — Handover Doc
_Last updated: 2026-08-04_

## Where we are

Commit `132416b` on `main` — **NOT YET PUSHED** (HTTPS auth not configured in Claude session).

## What was done this session

### WOW Score Entry Redesign (all 3 scoring modes)
Applied to `enter/[matchId].tsx`, `solo/[matchId].tsx`, `swindle/score/[gameId].tsx`:
- Hero circle (100px, glow colour by result) with ± arrow buttons defaulting to par on first tap
- 2×5 quick-tap number grid replacing old 3×4 grid
- Stats only shown for the logged-in player; others just get the score picker
- No BIRDIE/PAR/NET label — just bold white pts number
- Scorecard header: PLAYER → HOLE
- Scoring breakdown: colour-coded tiles (eagle=gold, birdie=green, par=blue, bogey=orange, double=red)
- 2×2 stat cards: PUTTS | BUNKER / PENALTY | CHIPS side by side

### Solo Round Completion Fix (`solo/[matchId].tsx`)
The "End Round" button never appeared because `setSavedScores` ran AFTER 3 Supabase awaits — if any hung (RLS issue), state never updated.

**Fixes:**
1. **Optimistic update** — all state changes happen BEFORE the first await. Supabase saves in background.
2. **`roundDone` state** — explicit flag set to true when `newStatus === 'complete'`. `isComplete = roundDone || scoredSet.size >= 18`.
3. **End Round button moved into complete card** — was `position: absolute, bottom: 32` (hidden behind iPhone home indicator). Now inside ScrollView, always visible.
4. **Removed Alert.alert on completion** — was firing on top of End Round button and routing back immediately.
5. **`checkAndUpdateRecords` wrapped in try/catch** — errors no longer block the complete flow.
6. **Stat snapshots** — `snapFairway/snapPutts/snapBunker/snapPenalty/snapChips` captured before resets.

## What to do next

```bash
# 1. Push
git push

# 2. Build for TestFlight
eas build --platform ios --profile production --non-interactive
```

Then test on physical device: score all 18 holes on a solo round. After hole 18, the ROUND COMPLETE card should appear with a gold End Round button. Scroll down slightly if needed.

## Known issue — Supabase RLS on match_holes

Inserts are likely failing silently (from Rick's Feedback). With the optimistic update, UI shows ROUND COMPLETE even if DB save fails. But on reload the session resets to last saved hole. Fix is a Supabase RLS policy change in the dashboard SQL editor — not a code change.

## Key architecture notes

- SDK 54 pinned — do NOT upgrade
- `newArchEnabled: false` but Expo Go forces new arch — test on physical device or dev build
- `isComplete = roundDone || scoredSet.size >= 18`
- `saveScore`: compute values → update all UI state (no awaits) → then persist to Supabase
- Simulator was unusable this session: native `com.titangolf.app` cached old bundle, Watch kept intercepting

## Files changed this session

| File | Change |
|------|--------|
| `app/(app)/score/solo/[matchId].tsx` | Optimistic update, roundDone, End Round in card, WOW modal |
| `app/(app)/score/enter/[matchId].tsx` | WOW modal, stat cards, scorecard header, breakdown tiles |
| `app/(app)/swindle/score/[gameId].tsx` | WOW modal |
| `app/(app)/score/day/[dayId].tsx` | Various fixes |
| `app/(app)/games/GroupBuilderSheet.tsx` | Group builder full names + avatars |
| `app/(app)/games/new.tsx` | Game creation tweaks |
