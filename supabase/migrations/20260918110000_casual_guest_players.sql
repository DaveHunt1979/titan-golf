-- Guest Mode for Casual Golf (Rick, 2026-09-15): fill out a 4-ball with
-- someone who doesn't have the app. Casual rounds are scored through
-- matches/match_holes, and match_holes.player_id is a NOT NULL FK to
-- players — so unlike swindle_group_players (which carries its own
-- guest_name/guest_handicap columns and never touches players), a guest
-- here needs a real players row to be scorable at all through the existing
-- engine unchanged. This flag is what keeps that row from ever being
-- mistaken for a member: no auth_uid, no society_members row, so every
-- membership-scoped surface (Season eligibility, Friends-on-a-round, the
-- Players list) already excludes them for free.
ALTER TABLE players ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT false;

-- The only INSERT policy on players today is "Admins create players"
-- (20260902000000_simulation_support.sql), which requires the caller be an
-- admin/owner of some society — so an ordinary member could never add a
-- guest to their own casual round. Narrower companion policy: any signed-in
-- player may insert, but ONLY a guest row. Creating a real/pending member
-- row stays admin-only via the existing policy, which is untouched.
DROP POLICY IF EXISTS "Members create guest players" ON players;
CREATE POLICY "Members create guest players" ON players FOR INSERT WITH CHECK (
  is_guest = true
  AND auth_uid IS NULL
  AND EXISTS (SELECT 1 FROM players me WHERE me.auth_uid = auth.uid())
);
