# Titan Golf — Premium Design Handover
**Date:** 2026-07-09 | **Build:** 1.0.0 (48) on TestFlight

---

## Your Mission

Make Titan Golf feel **prestige**. Rick (the key tester/stakeholder) saw an earlier gold concept screen and loved it. Dave has Photoshop concept designs ready to share. Your job is to look at those designs, understand the vision, and implement a premium visual refresh that makes the app feel like a luxury product — not just a golf tracker.

**First step:** Ask Dave to share his Photoshop concept screenshots before writing a single line of code.

---

## The App

Expo SDK 54 / expo-router 6 / React Native / TypeScript. Old arch (`newArchEnabled: false`). Supabase backend.

Working directory: `/Users/davehunt/Desktop/titan-golf`

**TypeScript check:** `npx tsc --noEmit --skipLibCheck 2>&1 | grep -v "CourseMapView\|TS2307" | grep "error" | head -10`

---

## Current Design System

All tokens live in `src/lib/theme.ts`. Read it before touching anything.

Key colors:
- `bg` = `#070b10` — very dark navy/black
- `gold` = `#D4AF37` — primary accent, used everywhere
- `goldDim` = semi-transparent gold for backgrounds
- `goldBorder` = gold at low opacity for borders
- `card` = slightly lighter than bg for cards
- `cardAlt` = alternate card surface
- `border` = subtle divider color
- `textSecondary` — body text
- `textMuted` — de-emphasised text
- `green` = `#4ade80` — Casual Golf accent
- Purple `#a78bfa` — The Swindle accent

Dynamic theming: `useDynamicColors()` and `useSocietyTheme()` — some screens use `palette.accent` instead of hardcoded gold. Be aware of this before overriding colors.

---

## The Three Area Tiles (Home Screen)

`app/(app)/feed/index.tsx` — the portal home screen Dave/Rick see first.

Three clickable tiles at the top:
- 🏌️ **Casual Golf** (green `#4ade80`)
- 🏆 **The Tour** (gold `#D4AF37`) — "Tournament" in old language
- 💰 **The Swindle** (purple `#a78bfa`) — "Clubhouse" in old language

These tiles are the app's front door and a prime candidate for premium treatment. Below them are Info and Live tabs.

---

## Key Screens to Consider for Refresh

In rough priority order based on what users see most:

1. **Home/Feed portal** — `app/(app)/feed/index.tsx` (the 3 area tiles)
2. **Score entry** — `app/(app)/score/enter/[matchId].tsx` (most-used screen)
3. **Tour/Leaderboard** — `app/(app)/tour/index.tsx`
4. **Tab bar** — `app/(app)/_layout.tsx` (visible on every screen)
5. **Profile** — `app/(app)/profile/index.tsx`
6. **Game creation** — `app/(app)/games/new.tsx`

---

## Design Language Rick Responded To

From WhatsApp feedback and the concept Dave showed earlier:
- Ultra-dark backgrounds (current `#070b10` is already good)
- Gold (`#D4AF37`) as the hero accent — Rick specifically said "wants the gold one in Titan branding"
- Clean, uncluttered layouts — Rick: "keep it simple and clean"
- Premium card surfaces — think member's club, not sports app
- Strong typography hierarchy

What Rick does NOT want:
- Too many side options cluttering the interface
- Broken/confusing features front-and-centre

---

## Files Dave's Concept Designs Will Likely Affect

These are the files you'll be editing once you've seen the designs:

| File | What it controls |
|------|-----------------|
| `src/lib/theme.ts` | All design tokens — DO NOT change gold or bg without checking every screen |
| `app/(app)/feed/index.tsx` | Home portal — the 3 area tiles |
| `app/(app)/_layout.tsx` | Tab bar config |
| `app/(app)/score/enter/[matchId].tsx` | Score entry (most complex screen) |
| `app/(app)/tour/index.tsx` | Tour hub / leaderboard |
| `app/(app)/profile/index.tsx` | Player profile |
| `app/(app)/games/new.tsx` | Game mode selector |

---

## Critical Rules (Do Not Break These)

1. **Never add a file to `app/(app)/admin/` without registering `href: null` in `_layout.tsx`** — expo-router auto-discovers all files as tabs. Previous incident caused a rogue admin tab for all users.

2. **Never use `.maybeSingle()` on `society_members`** — a player can have multiple rows. Use `.select()` + `.some()` to check roles.

3. **`matches_round_format_check` DB constraint** — `round_format` field only accepts specific values. Don't add game modes without checking this first.

4. **Build bumps need TWO files:** `buildNumber` in `app.json` AND all 4 `CURRENT_PROJECT_VERSION` occurrences in `ios/titangolf.xcodeproj/project.pbxproj`.

5. **Current build is 48.** Next build for TestFlight will be 49.

6. **Dynamic colors** — some screens use `useDynamicColors()` — if you're changing colors, check whether the screen uses the dynamic hook or hardcoded theme tokens.

---

## Assets Available

```
assets/
  TitanAppLogo.png      ← App icon (gold T on dark)
  logo_trans.png        ← Transparent background logo
  titan_logo.svg        ← Vector logo
  logo.ai               ← Illustrator source
```

Screenshots of Rick's WhatsApp feedback: `screenshots/` (useful for understanding what Rick sees and reacts to)

---

## Deployment

- **TestFlight:** Xcode → Product → Archive → Distribute App → TestFlight (EAS free tier exhausted — must use Xcode manually)
- **Website:** `git push` → Vercel auto-deploys `titangolf-web.vercel.app`
- Dave does the actual archive/upload — you produce the code

---

## What's Already Working Well (Don't Break)

- Admin button visibility (uses `.some()` pattern — was fixed in build 48)
- Range session scroll (Log Shot button now inside ScrollView)
- Game creation (fun games removed — only Stableford + Medal in Individual, 4 side game options)
- Player management (delete + photo change added in build 48/49)
- Three area gating on home screen
- Admin join codes (three area cards in admin)

---

## The Goal

When Rick opens this app, it should feel like pulling out a **black card**. Every screen should feel intentional, premium, and considered. The gold should feel earned — not scattered everywhere, but used to draw the eye to exactly what matters. Dave has the vision in Photoshop. Your job is to bring it to life in React Native.
