CREATE TABLE IF NOT EXISTS range_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  notes      TEXT
);

CREATE TABLE IF NOT EXISTS range_shots (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES range_sessions(id) ON DELETE CASCADE,
  player_id  UUID REFERENCES players(id) ON DELETE CASCADE,
  club       TEXT NOT NULL,
  carry      INTEGER,
  shape      TEXT CHECK (shape IN ('straight','draw','fade','hook','slice')),
  quality    TEXT CHECK (quality IN ('poor','ok','flush')),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE range_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE range_shots    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players manage own sessions" ON range_sessions
  FOR ALL USING (player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid()));

CREATE POLICY "Players manage own shots" ON range_shots
  FOR ALL USING (player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid()));
