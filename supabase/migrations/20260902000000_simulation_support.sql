-- In-app "Simulate" feature (Dave, 2026-09-02): admins run a full
-- tournament/swindle simulation from inside the app itself, at whatever
-- scale they pick, to find where a format's scoring breaks at volume — the
-- same thing scripts/seed_titan_way_sim.mts did manually earlier today, but
-- as a real authenticated client action (never a service-role key in the
-- app). That surfaces two genuine RLS gaps this feature needs closed:

-- 1) players had no INSERT policy at all (only self-insert-on-signup via
-- add_join_system.sql) — an admin could never create a guest/synthetic
-- player directory row from the client. Scoped to society admins/owners
-- generally (not one specific society) since players has no society_id of
-- its own — the row only becomes society-scoped once linked via
-- society_members in the same flow, same as every existing "admin adds a
-- guest player" path already relies on.
CREATE POLICY "Admins create players" ON players FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM society_members sm
    JOIN players p ON p.id = sm.player_id
    WHERE p.auth_uid = auth.uid() AND sm.role IN ('admin', 'owner')
  )
);

-- 2) swindle_entries could only ever be inserted by the entrant themselves
-- (player_id must match auth.uid()'s own player) — blocks an organiser from
-- entering simulated/guest players into their own game. Additive: the
-- self-insert case from supabase/swindle.sql is untouched.
CREATE POLICY "Game creator can add entries" ON swindle_entries FOR INSERT WITH CHECK (
  game_id IN (SELECT id FROM swindle_games WHERE created_by IN (SELECT id FROM players WHERE auth_uid = auth.uid()))
);

ALTER TABLE competitions  ADD COLUMN IF NOT EXISTS is_simulation BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE swindle_games ADD COLUMN IF NOT EXISTS is_simulation BOOLEAN NOT NULL DEFAULT false;
