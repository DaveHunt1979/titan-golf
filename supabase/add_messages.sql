-- Society group chat
CREATE TABLE IF NOT EXISTS messages (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id  UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  content    TEXT        NOT NULL CHECK (char_length(content) > 0 AND char_length(content) <= 500),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read messages"   ON messages;
DROP POLICY IF EXISTS "Players can send messages"  ON messages;

CREATE POLICY "Anyone can read messages"
  ON messages FOR SELECT USING (true);

CREATE POLICY "Players can send messages"
  ON messages FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM players WHERE id = player_id AND auth_uid = auth.uid())
  );

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
