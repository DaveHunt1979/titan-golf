-- Swindle / Roll-Up game tables
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS swindle_games (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT    NOT NULL,
  game_date    DATE    NOT NULL DEFAULT CURRENT_DATE,
  course_name  TEXT,
  entry_fee    DECIMAL(6,2) NOT NULL DEFAULT 5.00,
  currency     TEXT    NOT NULL DEFAULT '£',
  prize_split  INTEGER[] NOT NULL DEFAULT '{50,30,20}',
  join_code    TEXT    UNIQUE NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'open',  -- open | in_progress | complete
  created_by   UUID    REFERENCES players(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS swindle_entries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id    UUID NOT NULL REFERENCES swindle_games(id) ON DELETE CASCADE,
  player_id  UUID NOT NULL REFERENCES players(id),
  handicap   DECIMAL(4,1),
  joined_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(game_id, player_id)
);

CREATE TABLE IF NOT EXISTS swindle_scores (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id        UUID    NOT NULL REFERENCES swindle_games(id) ON DELETE CASCADE,
  player_id      UUID    NOT NULL REFERENCES players(id),
  hole_number    INTEGER NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  gross_score    INTEGER,
  stableford_pts INTEGER,
  recorded_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(game_id, player_id, hole_number)
);

-- RLS
ALTER TABLE swindle_games   ENABLE ROW LEVEL SECURITY;
ALTER TABLE swindle_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE swindle_scores  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "swindle_games_read"   ON swindle_games   FOR SELECT USING (true);
CREATE POLICY "swindle_games_insert" ON swindle_games   FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "swindle_games_update" ON swindle_games   FOR UPDATE USING (
  created_by IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

CREATE POLICY "swindle_entries_read"   ON swindle_entries FOR SELECT USING (true);
CREATE POLICY "swindle_entries_insert" ON swindle_entries FOR INSERT WITH CHECK (
  player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

CREATE POLICY "swindle_scores_read"   ON swindle_scores FOR SELECT USING (true);
CREATE POLICY "swindle_scores_upsert" ON swindle_scores FOR INSERT WITH CHECK (
  player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);
CREATE POLICY "swindle_scores_update" ON swindle_scores FOR UPDATE USING (
  player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);
