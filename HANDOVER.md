# Titan Golf — Handover Doc
_Last updated: 2026-08-05, morning of Rick's round_

## Where we are — READ THIS FIRST

- Latest commit: `0da27f0` ("so many changes") on `main`
- **Pushed to GitHub** — confirmed `origin/main` matches local HEAD, so the code is safe on GitHub even if this machine has a problem.
- **iOS build number: 95** — bumped in `app.json` (`ios.buildNumber`) AND in `ios/titangolf.xcodeproj/project.pbxproj` (`CURRENT_PROJECT_VERSION`, main app + watch app targets).
- ⚠️ **The `ios/` folder is gitignored** (`.gitignore:40`). The build-number-95 change to `project.pbxproj` is **local-only, not backed up in git**. If `ios/` is ever regenerated (`expo prebuild --clean`, fresh clone, new machine), you must manually re-bump `CURRENT_PROJECT_VERSION` to match whatever App Store Connect says is next.
- Not yet done as of this writing: opening Xcode and running Archive → Distribute for build 95. That step is manual (needs your Apple ID signing session) — do that next.

## What was fixed this session (2026-08-04 evening → 2026-08-05 morning)

All of the below are root-caused against Rick's actual WhatsApp screenshots (timestamped 06:18–06:20, Wed 5 Aug) and Dave's live testing, not guessed at.

### 1. Round completion bug (score/enter, group Stableford/Medal rounds)
Commit `96d61bd` (4 Aug, "Fix all Rick feedback") changed a fallback value from `?? 19` to `?? 18` in `currentHole` calc, meant to fix a rangefinder bug. Side effect: `allHolesFilled = currentHole > 18` could never become true, so the "Complete Round" button never appeared and hole 18 could be re-scored indefinitely, stacking points each time.
**Fix:** restored `?? 19` sentinel; clamped only the specific hole-number lookups that can't handle 19 (rangefinder deep-link, shot tracker, voice caddie) via a new `safeCurrentHole` var.

### 2. Missing DB columns (PostgREST "column not found in schema cache")
Three `matches` columns were referenced in code but never migrated to the live Supabase DB: `player_overrides`, `home_name`/`away_name`, and `secondary_format` (the worst one — it's in *every* match insert, so it silently broke all new game creation). All three now have migration files in `supabase/migrations/` and **have been applied** to the live DB (confirmed via direct query — `secondary_format` column exists).

### 3. Eagle/birdie/par/bogey/double color scheme + "numbers should be white"
Recolored to Rick's spec: Eagle=Gold, Birdie=Red, Par=Plain white, Bogey=Blue, Double Bogey=Dark Blue. Also fixed unselected numbers rendering dark grey instead of white across the score-entry modals and hole strips.

### 4. THE BIG ONE — points/par color bug ("the weird point thing")
`scoreVsPar()` (drives every eagle/birdie/par/bogey color and the "Scoring Breakdown" tallies) was classifying by **net** score (gross − handicap shots) instead of **gross**. So a gross par with a handicap shot on that hole showed as a red "birdie", and the round-end breakdown counted it as a birdie too. Points themselves were always calculated correctly — only the label/color was wrong.
**Fix:** `scoreVsPar()` now classifies by gross strokes vs par only, everywhere it's used, in all 4 scoring screens (solo, group entry, match detail scorecard, swindle). Points remain handicap-adjusted and display correctly alongside — they just don't drive the color anymore. Rick's own words: "Points and stroke should remain separate."

### 5. "Hole 19" cosmetic bug returning
Not a regression of #1 — the completion logic was correct, but the big "HOLE" number card kept showing the literal digit "19" before you tapped Complete Round. Now shows a checkmark and "ALL HOLES" instead.

### 6. Finished rounds dumping you back into live scoring at Hole 1
Commit `5778470` (4 Aug) changed the round-list tap handler to route **unconditionally** into the live scoring screen (`score/enter/[matchId]`) — no check for whether the round was already complete, no check for solo rounds. So tapping a finished round reopened it as if starting fresh. Fixed in both `score/index.tsx` (RoundCard) and `score/day/[dayId].tsx` (group list): completed rounds now route to the results/edit hub (`score/[matchId].tsx`), which itself correctly routes solo vs. group when you tap "Edit Scores".

### 7. "History" screen showing nothing
Traced to `/profile/rounds` filtering on `status = 'complete'` — likely a symptom of #1 (Rick's test rounds from before the fix never actually reached `complete` in the DB), not a separate bug. Should self-resolve as new rounds complete properly on build 95. Confirmed the RLS read policy for casual (no-competition) rounds is already correctly in place — not the cause.

### 8. Track Stats toggle (new feature, not a bug)
Added a "Track Stats" on/off toggle to the game creation wizard settings (defaults On). When off, hides Fairway/Putts/Bunker/Penalty/Chips inputs in both solo and group score entry. Stored via the existing `side_games` tag array (`'stats:off'`) — no schema change needed.

## Not fixed — explicitly out of scope for this morning

Rick also flagged in the same screenshot batch, but these are separate from what broke his round and weren't touched:
- Player registration architecture (wants one place to register a player that surfaces across casual/tournament/swindle sections) — real feature request, needs proper design work.
- Any other Admin-section rough edges.

## If something goes wrong today

1. **Don't panic-revert past `0da27f0`.** Everything before that commit still has the hole-19/points-color/routing bugs described above. Rolling back further brings those back.
2. `0da27f0` is one big bundled commit (not broken into per-fix commits), so `git revert` of a single fix isn't clean — if a specific fix needs undoing, it'll need a manual patch, not a revert. Ping through the chat history above for the exact file/line if that's needed.
3. Quick triage if a scoring screen looks wrong: check `app/(app)/score/solo/[matchId].tsx`, `app/(app)/score/enter/[matchId].tsx`, `app/(app)/score/[matchId].tsx`, `app/(app)/swindle/score/[gameId].tsx` — these 4 files all share the same `scoreVsPar`/`SCORE_COLORS` pattern (independently, not via a shared module — see the architecture note below).
4. If TestFlight upload itself fails: see "Known Pitfalls" below (unchanged from before).

## Known architecture debt (raised by Dave, not yet actioned)

`scoreVsPar`, the color palette, and completion-state logic are duplicated near-identically across solo/group/swindle instead of living in one shared module. That's *why* today's chain of bugs happened — a fix (or mistake) in one copy doesn't propagate to the others, and it's easy to miss one when making a "small" change. Plan: extract a shared `src/lib/scoring.ts`-level module for score classification, colors, and completion state once things are stable; each game-mode screen should only own what's genuinely different about it (tiered system, so tweaking one game mode can't silently break the other two).

## iOS Build & Upload Flow (unchanged process)

1. `npm install`
2. `chmod u+w ios/Pods/fmt/include/fmt/base.h` (always needed before pod install — file is read-only)
3. `cd ios && pod install`
4. `open ios/titangolf.xcworkspace`
5. Xcode: **Product → Archive → Distribute App → App Store Connect → Upload**
6. Wait ~10 min for TestFlight processing, then install on device

Steps 1–3 have already been run this session (clean). Step 4 onward is next.

### Known Pitfalls
- Personal team (free) does NOT support Push Notifications — must use paid team **S64D36K9G7** (Dave Hunt)
- `fmt/base.h` permission denied on every fresh pod install — always chmod first
- dSYM warning for hermes.framework during upload — safe to ignore
- CocoaPods payload ~33MB warning — safe to ignore, install still succeeds
- `newArchEnabled: false` — Old Architecture only; New Arch crashes on iOS 26.5
- `expo-updates` disabled — update queue was crashing at startup
- `expo-av` removed — AVAudioSession init at startup crashes on iOS 26.5

## Files changed this session

| File | Change |
|------|--------|
| `app/(app)/score/solo/[matchId].tsx` | Gross-based scoring colors, white numbers, stats toggle gating |
| `app/(app)/score/enter/[matchId].tsx` | Hole-19 fix, gross-based colors everywhere, breakdown tally fix, scorecard grid fix, stats toggle gating |
| `app/(app)/score/[matchId].tsx` | Gross-based colors, hole-tile fix |
| `app/(app)/swindle/score/[gameId].tsx` | Gross-based colors (dropped net calc in 4 places), dead code cleanup |
| `app/(app)/score/index.tsx` | RoundCard routing fix (complete/solo-aware) |
| `app/(app)/score/day/[dayId].tsx` | Group card routing fix (complete-aware) |
| `app/(app)/games/new.tsx` | Track Stats toggle added |
| `app.json` | Build number → 95 |
| `ios/titangolf.xcodeproj/project.pbxproj` | Build number → 95 (gitignored, local only) |
| `supabase/migrations/20260804_home_away_name.sql` | `home_name`, `away_name`, `secondary_format` columns |
| `supabase/migrations/20260804_player_overrides.sql` | `player_overrides` column (pre-existing file, now actually applied) |
