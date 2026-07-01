CREATE TABLE IF NOT EXISTS hole_stats (
  id           UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id     UUID    NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id    UUID    NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  hole_number  INTEGER NOT NULL,
  fairway_hit  BOOLEAN,       -- NULL on par 3s (not applicable)
  putts        INTEGER,       -- NULL if not recorded
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(match_id, player_id, hole_number)
);

ALTER TABLE hole_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read hole_stats"    ON hole_stats;
DROP POLICY IF EXISTS "Players can insert hole_stats" ON hole_stats;
DROP POLICY IF EXISTS "Players can update hole_stats" ON hole_stats;

CREATE POLICY "Anyone can read hole_stats"
  ON hole_stats FOR SELECT USING (true);

CREATE POLICY "Players can insert hole_stats"
  ON hole_stats FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM players WHERE id = player_id AND auth_uid = auth.uid())
  );

CREATE POLICY "Players can update hole_stats"
  ON hole_stats FOR UPDATE USING (
    EXISTS (SELECT 1 FROM players WHERE id = player_id AND auth_uid = auth.uid())
  );
