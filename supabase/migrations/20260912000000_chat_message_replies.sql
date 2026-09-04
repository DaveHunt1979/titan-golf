-- WhatsApp-style "reply to a message" (Dave, 2026-09-12). Both chat surfaces
-- get it: society channel chat (the `messages` table — general/swindle/tour,
-- rendered by src/components/ChatChannel.tsx) and 1-1 Inbox DMs (the
-- `direct_messages` table, rendered by app/(app)/inbox/[playerId].tsx).
--
-- Additive and nullable on purpose: every existing message keeps working
-- exactly as it does today and a NULL simply means "this isn't a reply". No
-- existing column, constraint, index or RLS policy is touched — the two send
-- paths just pass one extra column on their existing insert, and the existing
-- INSERT policies (which gate on player_id / sender_id) already cover it.
--
-- ON DELETE SET NULL, not CASCADE: deleting the original message must never
-- take the replies to it with it. Inbox already lets either participant delete
-- a message (20260821040000_direct_messages_delete.sql) and the platform admin
-- screen can clear channel chat, so the reply has to survive and simply lose
-- its quote, which the UI degrades to "Original message deleted".

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS messages_reply_to_message_id_idx
  ON messages (reply_to_message_id);

ALTER TABLE direct_messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES direct_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS direct_messages_reply_to_message_id_idx
  ON direct_messages (reply_to_message_id);
