-- Handicap index history — one row per calculation
CREATE TABLE IF NOT EXISTS handicap_history (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id      UUID NOT NULL,
  handicap_index NUMERIC NOT NULL,
  calculated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE handicap_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players manage own handicap history" ON handicap_history
  FOR ALL USING (
    player_id IN (
      SELECT id FROM players WHERE auth_uid = auth.uid()
    )
  );
