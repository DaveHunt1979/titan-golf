# Titan Golf — Handover Notes
**Date:** 2026-07-22  
**Current branch:** `main`  
**app.json buildNumber:** `82` (next TestFlight build should be **83** — bump before archiving)

---

## State when Mac shut down

All code is committed but **not yet pushed** — the `git push` failed because the remote is set to HTTPS and needs credentials. First thing back:

```bash
git remote set-url origin git@github.com:DaveHunt1979/titan-golf.git
git push
```

Then build for TestFlight as normal (see build process below).

---

## What's in the unpushed commits (ready for build 83)

### 1. Eagle / Albatross / Hole-in-One celebration (`src/components/EagleAlert.tsx`)
- Animated full-screen modal fires on score save when any player scores eagle or better
- Auto-dismisses after 4.5s, tap anywhere to dismiss early
- Three tiers: Hole in One 🏆 (amber), Albatross ✨ (purple), Eagle 🦅 (gold)

### 2. Play screen hero fixed (`app/(app)/score/index.tsx`)
- Natural image proportions — no more green tree block
- Lighter overlay, smaller title text, Titan logo removed from that screen

### 3. Offline network timeout silenced (`src/lib/offlineQueue.ts`)
- "Network request timed out" now queues silently instead of showing a hard alert

### 4. Mashie day leaderboard — best-N drop logic (`app/(app)/score/day/[dayId].tsx`)
- Was summing all player pts raw; now correctly applies per-hole best-N drop logic using `counting_scores`

### 5. Secondary stableford after matchplay fixed (`app/(app)/score/enter/[matchId].tsx`)
- Added `continuingSecondary` state flag — prevents "Continue Stableford" dialog re-firing on every hole
- Preserves original `winner` / `result_str` from matchplay result
- Final completion shows "All Done!" alert instead of looping back to the dialog

### 6. Tees / Starting Hole dialog only shows once (`app/(app)/score/[matchId].tsx`)
- Was re-prompting every time you left and re-entered a match
- Now: if `status === 'in_progress'`, skips both dialogs and goes straight to the scorer

### 7. Groups selector moved above players (`app/(app)/games/new.tsx`)
- "Groups" picker now sits above "Players" in new game setup — pick count first, then fill each group
- Renamed "Teams" → "Groups" throughout

### 8. Mashie hero logo bigger (`app/(app)/index.tsx`)
- Society logo in home screen hero bumped from `height: 160` → `height: 220`

---

## SQL migration outstanding

**Must be run in Supabase SQL editor** before Mashie group codes work:

```
supabase/migrations/20260719_mashie_group_code.sql
```

Adds `group_code TEXT` column to `matches` table.

---

## Build process (reminder)

```bash
# 1. Bump buildNumber in app.json (82 → 83)
# 2. Install deps
npm install
# 3. Fix fmt permissions (needed every time)
chmod u+w ios/Pods/fmt/include/fmt/base.h
# 4. Pod install
cd ios && pod install
# 5. Open Xcode
open titangolf.xcworkspace
# 6. Product → Archive → Distribute App → App Store Connect → Upload
```

- Signing team: **Dave Hunt (S64D36K9G7)** (paid — needed for push notifications)
- dSYM warning and CocoaPods 33MB warning: both safe to ignore

---

## Key testers
- **Rick** — tournaments, scoring edge cases, society admin
- **The boys** — scoring, general use

---

## Backlog (not started)

| Feature | Notes |
|---|---|
| **Competition Info Board** | Rick wants tour pack (times, hotels, flights) readable in-app. Phase 1: paste rich text. Phase 2: PDF upload via Supabase Storage. |
| **Feed → Instagram** | Phase 1: WebView on society Instagram. Phase 2: Instagram Basic Display API for native cards. |
| **Apple Watch** | Push notifications already work via APNs. Score ENTRY needs bare workflow + WatchKit — significant native work. |
| **Launch Monitor** | Ball tracking via phone camera. 3–6 month ML/CV project. v1 option: manual entry form. |

---

## Key files quick reference

| File | What it does |
|---|---|
| `app/(app)/games/new.tsx` | New game creation (format, groups, players, settings) |
| `app/(app)/score/[matchId].tsx` | Match detail + Enter Scores button |
| `app/(app)/score/enter/[matchId].tsx` | Live hole-by-hole scoring (matchplay / secondary stableford) |
| `app/(app)/score/day/[dayId].tsx` | Day leaderboard (Groups + Leaderboard tabs) |
| `app/(app)/score/index.tsx` | Play screen — "Are we playing today?" hero + match list |
| `app/(app)/index.tsx` | Home screen — society hero logo, tile grid |
| `src/components/EagleAlert.tsx` | Eagle/albatross/hole-in-one celebration modal |
| `src/lib/offlineQueue.ts` | Offline queue + network error detection |
| `src/lib/SocietyThemeContext.tsx` | Society logo, colours, palette for themed screens |

---

## Stack
- Expo SDK **54** (intentionally pinned — v56 caused crashes)
- React Native old arch (`newArchEnabled: false`)
- expo-sqlite **v15.0.0** (v16 crashes on SDK 54)
- Supabase (auth + DB + storage)
- expo-router for navigation

---

Enjoy the break. Everything is stable and committed. 🏌️
