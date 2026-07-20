# Titan Golf — Changelog

---

## Build 80 — 2026-07-20

### Offline-First Phase 3 — SQLite local database
- **expo-sqlite** installed and wired in; the app now maintains a persistent local relational database (`titan_offline.db`) on device
- **Offline queue** migrated from AsyncStorage JSON blob → `offline_queue` SQLite table with proper columns; enables querying, avoids JSON parse/stringify on every hole save, and survives large backlogs
- **Match pack** migrated from AsyncStorage JSON blob → `match_pack` SQLite table; course holes, player handicaps and match data stored relationally and queryable
- **Sync metadata** (last synced time, backoff fail count) stored in `sync_meta` key-value table — no more separate AsyncStorage keys
- **DB initialised at app startup** (`app/_layout.tsx`) before auth check, so the queue is ready before any screen loads
- **Sign-out guard rail** — Profile → Sign Out now warns if there are unsynced scores in the queue before allowing sign-out

### Admin
- **Player Groups** — saved 4-ball groups now persist correctly (missing `player_groups` table created in Supabase)

---

## Build 79 — 2026-07-20

### Offline-First Architecture (Phase 1 + 2)

**Phase 1 — Sync status & guard rails**
- **SyncBar** — compact status strip on the scoring screen; shows Online · Offline · Syncing · Synced · Error with a coloured dot, pending score count, last-synced time, and a "Sync Now" button
- **Exponential backoff** — failed sync retries wait 30 s → 60 s → 2 min → 5 min before trying again; state is persisted so it survives app restarts
- **Foreground drain** — the offline queue now drains automatically when the app returns to foreground, replacing the old manual AppState listener
- **Offline polling** — when the device is offline the app pings every 30 s and drains the queue the moment connectivity returns
- **`lastSyncedAt` tracking** — last successful sync time is persisted and shown in the SyncBar

**Phase 2 — Pre-game offline pack**
- **Pack download on game creation** — immediately after a game is created, a local pack is written to AsyncStorage containing the match, course holes, par/SI/yardage, player handicaps, and comp data
- **Pack-first load** — the scoring screen reads from the local pack first (instant, works offline); falls back to network if no pack exists
- **14-hour TTL** — packs expire after 14 hours so stale data can't persist across multiple days

---

## Build 78 — 2026-07-20

### Mashie Golf Overhaul
- **Group dropdown fixed** — number of teams picker now scrolls from the top (no more jumping to Team 30)
- **No more "vs" label** — Mashie games show "3 groups ready" instead of "Team A vs Team B", reflecting that it's a leaderboard, not head-to-head
- **Auto-open players after Add Another Group** — tapping "Add Another Group" now takes you straight into the player picker on the new screen
- **Format preserved on Add Another Group** — the game mode carries through so you don't have to reselect Mashie
- **Group codes** — each Mashie group of 4 gets a unique 4-character code on creation; codes are shown in the success alert so Rick can share them straight away
- **SQL migration required** — run `supabase/migrations/20260719_mashie_group_code.sql` in Supabase to add the `group_code` column to `matches`

### Admin
- **Codes & PINs cleaned up** — the main Admin screen no longer shows the join PIN inline; it's a single "All Codes & PINs →" link that takes you to the dedicated codes page
- **Mashie Group Codes section** — Admin → Codes & PINs now shows active Mashie groups with their individual codes and a Share button per group

### Home Screen
- **Friends on a Round** — section restored and working on the main menu

### Navigation
- **Bottom tab bar tidied** — the `friends` and `admin/codes` screens are no longer auto-added as tab bar icons; they remain accessible as screens but are hidden from the bottom nav (Home · Profile · Admin only)

---

## Build 69 — 2026-07-16

- Hero logo sharp and blended on home screen
- Rick's UI fixes batch (spacing, labels, colours)
- Stableford points calculation bug fixed
- LEADERS button added to tour screen
- Stroke index displayed in white on scorecard

---

## Build 63 — 2026-07-15

- Voice commentary opt-in fix (Chip & Birdie)
- Watch / Tour / Swindle hook fixes
- Mashie society bug fixed
- Camera FAB added (persistent floating button)
- Home match count scoped to current player only

---

## Build 56 — 2026-07-13

- Team Stableford format built and wired
- Both DB migrations applied (team_stableford columns, round_format constraint)
- Rogue tab bug fixed

---

## Earlier Builds

- Web portal: auth-aware navbar (Profile + Sign Out when logged in)
- Web Locker Room: full profile editing, My Bag with brand/model selectors, career stats, change password
- Web tournament wizard: 4-step (Format → Details → Days → Review) with large PIN on success
- Admin Codes & PINs page (web + app): society join PIN, tournament PIN, area codes all in one place
- Casual join code, Tour join code, Swindle join code moved off main admin screens
