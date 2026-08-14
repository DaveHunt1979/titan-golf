-- Separate Swindle and Tournament chats from the main society chat. Same
-- `messages` table, discriminated by a new `channel` column instead of
-- separate tables — keeps the existing realtime/RLS setup working as-is.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'general' CHECK (channel IN ('general', 'swindle', 'tour'));

CREATE INDEX IF NOT EXISTS messages_society_channel_created_at_idx
  ON messages (society_id, channel, created_at DESC);
