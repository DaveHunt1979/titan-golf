-- ── Tournament Engine Phase 1 ────────────────────────────────────────────────
-- Adds tournament type, configurable points, per-day format/HCP, and prize tables.
-- Builds on existing competitions + competition_days tables.

-- ── 1. competitions: tournament type + configurable points ───────────────────

ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS tournament_type TEXT NOT NULL DEFAULT 'casual'
    CHECK (tournament_type IN ('casual', 'ryder_cup', 'titan_tour')),
  ADD COLUMN IF NOT EXISTS pts_win  NUMERIC(5,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pts_half NUMERIC(5,2) NOT NULL DEFAULT 0.5;

-- ── 2. competition_days: per-day format + handicap percentage ─────────────────

ALTER TABLE competition_days
  ADD COLUMN IF NOT EXISTS day_format TEXT,            -- '4bbb' | 'singles' | 'foursomes' etc.
  ADD COLUMN IF NOT EXISTS hcp_pct   INTEGER NOT NULL DEFAULT 100
    CHECK (hcp_pct BETWEEN 0 AND 100);

-- ── 3. Prize categories (e.g. "Cat 1: 0–10 HCP") ────────────────────────────

CREATE TABLE IF NOT EXISTS prize_categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id  UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,        -- 'Category 1', 'Low Handicap'
  hcp_min         NUMERIC(4,1),         -- null = no lower bound
  hcp_max         NUMERIC(4,1),         -- null = no upper bound
  display_order   INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. Prize payouts per rank within a category ──────────────────────────────

CREATE TABLE IF NOT EXISTS prize_payouts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  UUID NOT NULL REFERENCES prize_categories(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL CHECK (position >= 1),   -- 1st, 2nd, 3rd …
  prize_money  NUMERIC(8,2) NOT NULL DEFAULT 0,
  UNIQUE (category_id, position)
);

-- ── 5. Live prize position tracker per player ────────────────────────────────

CREATE TABLE IF NOT EXISTS player_prize_positions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id   UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  player_id        UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  category_id      UUID REFERENCES prize_categories(id),
  current_position INTEGER,          -- live rank within their category
  current_prize    NUMERIC(8,2) DEFAULT 0,
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (competition_id, player_id)
);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE prize_categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE prize_payouts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_prize_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read prize_categories" ON prize_categories FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_member(c.society_id)
  ));
CREATE POLICY "Admins manage prize_categories" ON prize_categories FOR ALL
  USING (EXISTS (
    SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_admin(c.society_id)
  ));

CREATE POLICY "Members read prize_payouts" ON prize_payouts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM prize_categories pc
    JOIN competitions c ON c.id = pc.competition_id
    WHERE pc.id = category_id AND is_society_member(c.society_id)
  ));
CREATE POLICY "Admins manage prize_payouts" ON prize_payouts FOR ALL
  USING (EXISTS (
    SELECT 1 FROM prize_categories pc
    JOIN competitions c ON c.id = pc.competition_id
    WHERE pc.id = category_id AND is_society_admin(c.society_id)
  ));

CREATE POLICY "Members read player_prize_positions" ON player_prize_positions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_member(c.society_id)
  ));
CREATE POLICY "Admins manage player_prize_positions" ON player_prize_positions FOR ALL
  USING (EXISTS (
    SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_admin(c.society_id)
  ));
