-- ── Swindle Groups: morning tee-time based sign-up ─────────────────────────
-- Replaces individual "I'm in" with organiser-led group creation.
-- One group per tee time; players selected from swindle membership list.

-- ── 1. Groups (one per tee time slot) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS swindle_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     UUID NOT NULL REFERENCES swindle_games(id) ON DELETE CASCADE,
  tee_time    TEXT NOT NULL,            -- '08:12' display string
  course_tee  TEXT,                     -- optional start tee / tee colour
  created_by  UUID REFERENCES players(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. Players per group ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS swindle_group_players (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL REFERENCES swindle_groups(id) ON DELETE CASCADE,
  player_id       UUID REFERENCES players(id),   -- null for guests
  is_guest        BOOLEAN NOT NULL DEFAULT false,
  guest_name      TEXT,
  guest_handicap  NUMERIC(4,1),
  guest_home_club TEXT,
  added_by        UUID REFERENCES players(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, player_id)
);

-- ── 3. Close registration on swindle_games ────────────────────────────────────
ALTER TABLE swindle_games
  ADD COLUMN IF NOT EXISTS registration_closed_at TIMESTAMPTZ;

-- ── 4. RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE swindle_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE swindle_group_players ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all groups and group players
CREATE POLICY "Auth read swindle_groups"         ON swindle_groups        FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth read swindle_group_players"  ON swindle_group_players FOR SELECT TO authenticated USING (true);

-- Any authenticated user can create a group or add players (duplicate prevention is app-side)
CREATE POLICY "Auth insert swindle_groups"        ON swindle_groups        FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth insert swindle_group_players" ON swindle_group_players FOR INSERT TO authenticated WITH CHECK (true);

-- Only the creator of the group (or group player row creator) can update/delete
CREATE POLICY "Creator update swindle_groups"  ON swindle_groups FOR UPDATE TO authenticated
  USING (created_by = (SELECT id FROM players WHERE auth_uid = auth.uid() LIMIT 1));
CREATE POLICY "Creator delete swindle_groups"  ON swindle_groups FOR DELETE TO authenticated
  USING (created_by = (SELECT id FROM players WHERE auth_uid = auth.uid() LIMIT 1));
CREATE POLICY "Creator delete swindle_group_players" ON swindle_group_players FOR DELETE TO authenticated
  USING (added_by = (SELECT id FROM players WHERE auth_uid = auth.uid() LIMIT 1));
