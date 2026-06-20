-- ============================================================
-- TITAN GOLF — Supabase Schema v1
-- Run this in the Supabase SQL Editor to create all tables
-- ============================================================

-- ── Societies (multi-tenant root) ────────────────────────────
CREATE TABLE IF NOT EXISTS societies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,           -- URL-safe: 'titan-tour'
  logo_url      TEXT,
  primary_color TEXT DEFAULT '#D4AF37',
  plan_tier     TEXT DEFAULT 'free' CHECK (plan_tier IN ('free', 'society', 'club')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Players (global — one account, many societies) ───────────
CREATE TABLE IF NOT EXISTS players (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid        UUID UNIQUE,                  -- Supabase Auth user id
  display_name    TEXT NOT NULL,
  email           TEXT,
  avatar_url      TEXT,
  handicap_index  NUMERIC(4,1),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Society Members (player ↔ society with role) ─────────────
CREATE TABLE IF NOT EXISTS society_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id    UUID NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role          TEXT DEFAULT 'member' CHECK (role IN ('member', 'admin', 'owner')),
  joined_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (society_id, player_id)
);

-- ── Teams ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id    UUID NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                  -- 'Elite', 'MOB', etc.
  accent_color  TEXT DEFAULT '#D4AF37',
  logo_key      TEXT,                           -- asset key for local logo
  sort_order    INTEGER DEFAULT 0
);

-- ── Competitions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS competitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id    UUID NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                  -- 'Titan Tour 2027'
  year          INTEGER,
  format        TEXT NOT NULL DEFAULT 'team_matchplay_4bbb',
  status        TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'complete')),
  settings      JSONB DEFAULT '{}',             -- all admin-configurable options
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Competition Players (registered players + team assignment) ─
CREATE TABLE IF NOT EXISTS competition_players (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id  UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  player_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team_id         UUID REFERENCES teams(id),
  is_captain      BOOLEAN DEFAULT FALSE,
  handicap_index  NUMERIC(4,1),                 -- snapshot at competition start
  player_number   INTEGER,                      -- 1-24 for Titan Tour
  UNIQUE (competition_id, player_id)
);

-- ── Competition Days ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS competition_days (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id  UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  day_number      INTEGER NOT NULL CHECK (day_number BETWEEN 1 AND 10),
  course_name     TEXT,                         -- 'West Cliffs', 'Praia D''El Rey'
  course_par      INTEGER DEFAULT 72,
  course_rating   NUMERIC(4,1),
  slope_rating    INTEGER DEFAULT 113,
  play_date       DATE,
  UNIQUE (competition_id, day_number)
);

-- ── Matches ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id    UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  day_id            UUID NOT NULL REFERENCES competition_days(id) ON DELETE CASCADE,
  match_number      INTEGER,
  home_team_id      UUID REFERENCES teams(id),
  away_team_id      UUID REFERENCES teams(id),
  home_player_ids   UUID[] DEFAULT '{}',        -- up to 2 for 4BBB
  away_player_ids   UUID[] DEFAULT '{}',
  status            TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'in_progress', 'complete')),
  winner            TEXT CHECK (winner IN ('home', 'away', 'half', NULL)),
  result_str        TEXT,                       -- '3&2', '1UP', 'AS'
  holes_string      TEXT DEFAULT '..................',
  is_singles        BOOLEAN DEFAULT FALSE,      -- Day 4
  locked            BOOLEAN DEFAULT FALSE,      -- Ricky-proof: cannot reset once locked
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Match Holes (per-player, per-hole scores) ────────────────
CREATE TABLE IF NOT EXISTS match_holes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id       UUID NOT NULL REFERENCES players(id),
  hole_number     INTEGER NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  score           TEXT CHECK (score IN ('h', 'a', 'f', NULL)),  -- matchplay result
  gross_score     INTEGER,                      -- actual strokes (for Kronos)
  net_score       INTEGER,
  stableford_pts  INTEGER,
  revision        INTEGER DEFAULT 0,            -- optimistic concurrency
  last_write_by   UUID,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (match_id, player_id, hole_number)
);

-- ── Course Holes (stroke index + par per hole) ───────────────
CREATE TABLE IF NOT EXISTS course_holes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_name   TEXT NOT NULL,
  hole_number   INTEGER NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  par           INTEGER NOT NULL CHECK (par BETWEEN 3 AND 5),
  stroke_index  INTEGER NOT NULL CHECK (stroke_index BETWEEN 1 AND 18),
  yardage       INTEGER,
  hole_name     TEXT,                           -- Praia has named holes
  UNIQUE (course_name, hole_number)
);

-- ── Notifications ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id    UUID REFERENCES societies(id),
  type          TEXT NOT NULL,                  -- 'birdie','eagle','match_result','draw','admin','tournament_winner','kronos_champ','hole_in_one'
  payload       JSONB DEFAULT '{}',
  target        TEXT DEFAULT 'spectator' CHECK (target IN ('spectator', 'all', 'player')),
  player_id     UUID REFERENCES players(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Wall of Champions ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS champions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id    UUID NOT NULL REFERENCES societies(id),
  year          INTEGER NOT NULL,
  award_name    TEXT NOT NULL,                  -- 'Titan Tour', 'Kronos Trophy'
  winner_name   TEXT NOT NULL,
  winner_type   TEXT NOT NULL CHECK (winner_type IN ('team', 'player')),
  detail        TEXT,                           -- '140 pts', 'vs Elite 2&1'
  UNIQUE (society_id, year, award_name)
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE societies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE players          ENABLE ROW LEVEL SECURITY;
ALTER TABLE society_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams            ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches          ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_holes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_holes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications    ENABLE ROW LEVEL SECURITY;
ALTER TABLE champions        ENABLE ROW LEVEL SECURITY;

-- Helper: is the current user a member of a society?
CREATE OR REPLACE FUNCTION is_society_member(sid UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM society_members sm
    JOIN players p ON p.id = sm.player_id
    WHERE sm.society_id = sid AND p.auth_uid = auth.uid()
  );
$$;

-- Helper: is the current user an admin/owner of a society?
CREATE OR REPLACE FUNCTION is_society_admin(sid UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM society_members sm
    JOIN players p ON p.id = sm.player_id
    WHERE sm.society_id = sid
      AND p.auth_uid = auth.uid()
      AND sm.role IN ('admin', 'owner')
  );
$$;

-- Players: can read/update own record
CREATE POLICY "Players read own" ON players FOR SELECT USING (auth_uid = auth.uid());
CREATE POLICY "Players update own" ON players FOR UPDATE USING (auth_uid = auth.uid());

-- Societies: members can read their society
CREATE POLICY "Members read society" ON societies FOR SELECT USING (is_society_member(id));
CREATE POLICY "Admins update society" ON societies FOR UPDATE USING (is_society_admin(id));

-- Society members: members can read their society's members
CREATE POLICY "Members read members" ON society_members FOR SELECT USING (is_society_member(society_id));
CREATE POLICY "Admins manage members" ON society_members FOR ALL USING (is_society_admin(society_id));

-- Teams, competitions, days, matches: members read; admins write
CREATE POLICY "Members read teams" ON teams FOR SELECT USING (is_society_member(society_id));
CREATE POLICY "Admins manage teams" ON teams FOR ALL USING (is_society_admin(society_id));

CREATE POLICY "Members read competitions" ON competitions FOR SELECT USING (is_society_member(society_id));
CREATE POLICY "Admins manage competitions" ON competitions FOR ALL USING (is_society_admin(society_id));

CREATE POLICY "Members read comp_players" ON competition_players FOR SELECT
  USING (EXISTS (SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_member(c.society_id)));
CREATE POLICY "Admins manage comp_players" ON competition_players FOR ALL
  USING (EXISTS (SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_admin(c.society_id)));

CREATE POLICY "Members read days" ON competition_days FOR SELECT
  USING (EXISTS (SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_member(c.society_id)));
CREATE POLICY "Admins manage days" ON competition_days FOR ALL
  USING (EXISTS (SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_admin(c.society_id)));

CREATE POLICY "Members read matches" ON matches FOR SELECT
  USING (EXISTS (SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_member(c.society_id)));
CREATE POLICY "Members write match holes" ON matches FOR UPDATE
  USING (EXISTS (SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_member(c.society_id)));
CREATE POLICY "Admins manage matches" ON matches FOR ALL
  USING (EXISTS (SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_admin(c.society_id)));

-- Match holes: members can write their own scores; all members can read
CREATE POLICY "Members read holes" ON match_holes FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM matches m
    JOIN competitions c ON c.id = m.competition_id
    WHERE m.id = match_id AND is_society_member(c.society_id)
  ));
CREATE POLICY "Players write own holes" ON match_holes FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM players p WHERE p.id = player_id AND p.auth_uid = auth.uid()));
CREATE POLICY "Players update own holes" ON match_holes FOR UPDATE
  USING (EXISTS (SELECT 1 FROM players p WHERE p.id = player_id AND p.auth_uid = auth.uid()));

-- Course holes: any authenticated user can read
CREATE POLICY "Auth read course holes" ON course_holes FOR SELECT USING (auth.uid() IS NOT NULL);

-- Notifications: members read their society's
CREATE POLICY "Members read notifications" ON notifications FOR SELECT USING (
  society_id IS NULL OR is_society_member(society_id)
);

-- Champions: members read their society's
CREATE POLICY "Members read champions" ON champions FOR SELECT USING (is_society_member(society_id));
CREATE POLICY "Admins manage champions" ON champions FOR ALL USING (is_society_admin(society_id));

-- ============================================================
-- REALTIME (enable for live scoring)
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE matches;
ALTER PUBLICATION supabase_realtime ADD TABLE match_holes;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
