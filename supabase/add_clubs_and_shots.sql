-- ============================================================
-- Golf bag (clubs) + shot tracking per round
-- Run in Supabase SQL Editor
-- ============================================================

-- Each player's bag: clubs with optional NFC tag assignment
CREATE TABLE IF NOT EXISTS clubs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,          -- e.g. 'Driver', '7 Iron'
  short_name  TEXT NOT NULL,          -- e.g. 'D', '7i'
  category    TEXT NOT NULL DEFAULT 'iron',  -- wood | iron | wedge | putter | hybrid
  nfc_tag_id  TEXT,                   -- hardware UID of the NFC sticker
  sort_order  INTEGER DEFAULT 0,
  in_bag      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (player_id, nfc_tag_id)
);

-- Individual shots within a match hole
CREATE TABLE IF NOT EXISTS shots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id     UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id    UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  hole_number  INTEGER NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  shot_number  INTEGER NOT NULL,
  club_id      UUID REFERENCES clubs(id) ON DELETE SET NULL,
  club_name    TEXT,                  -- snapshot in case club is later deleted
  club_short   TEXT,                  -- e.g. '7i'
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS shots_match_player ON shots (match_id, player_id);
CREATE INDEX IF NOT EXISTS clubs_player       ON clubs (player_id);
CREATE INDEX IF NOT EXISTS clubs_nfc_tag      ON clubs (nfc_tag_id) WHERE nfc_tag_id IS NOT NULL;

-- RLS
ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE shots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players manage own clubs" ON clubs FOR ALL
  USING (player_id = (SELECT id FROM players WHERE auth_uid = auth.uid()));

CREATE POLICY "Players read match shots" ON shots FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM matches m
    JOIN competitions c ON c.id = m.competition_id
    WHERE m.id = match_id AND is_society_member(c.society_id)
  ));

CREATE POLICY "Players insert own shots" ON shots FOR INSERT
  WITH CHECK (player_id = (SELECT id FROM players WHERE auth_uid = auth.uid()));

CREATE POLICY "Players delete own shots" ON shots FOR DELETE
  USING (player_id = (SELECT id FROM players WHERE auth_uid = auth.uid()));
