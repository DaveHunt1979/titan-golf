-- Add society_id to messages so each society has its own chat
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS society_id UUID REFERENCES societies(id) ON DELETE CASCADE;

-- Backfill existing messages using the sender's society membership
UPDATE messages m
SET society_id = sm.society_id
FROM society_members sm
WHERE sm.player_id = m.player_id
  AND m.society_id IS NULL;

-- Index for fast per-society queries
CREATE INDEX IF NOT EXISTS messages_society_id_created_at_idx
  ON messages (society_id, created_at DESC);
