-- 1-1 player messaging ("Inbox"). Separate from the existing `messages`
-- table, which is society-channel group chat (general/swindle/tour) — a DM
-- has exactly two participants and its own read-state per recipient.

CREATE TABLE IF NOT EXISTS direct_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id    UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  content      TEXT NOT NULL CHECK (char_length(content) > 0 AND char_length(content) <= 1000),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at      TIMESTAMPTZ,
  CONSTRAINT direct_messages_not_self CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS direct_messages_recipient_idx ON direct_messages(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS direct_messages_sender_idx    ON direct_messages(sender_id, created_at DESC);

ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dm_participants_read" ON direct_messages FOR SELECT USING (
  sender_id    IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  OR recipient_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

CREATE POLICY "dm_sender_insert" ON direct_messages FOR INSERT WITH CHECK (
  sender_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

-- Recipient marks their own inbound messages read; nothing else is editable.
CREATE POLICY "dm_recipient_mark_read" ON direct_messages FOR UPDATE USING (
  recipient_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

-- `players` SELECT is strict self-read-only RLS (see 20260813_t_tag.sql),
-- so the thread list needs a SECURITY DEFINER RPC to resolve each other
-- participant's name/avatar — same pattern as find_player_by_ttag /
-- get_my_player_library, just aggregating direct_messages instead.
CREATE OR REPLACE FUNCTION get_my_dm_threads()
RETURNS TABLE (
  other_id     UUID,
  display_name TEXT,
  avatar_url   TEXT,
  last_content TEXT,
  last_at      TIMESTAMPTZ,
  last_from_me BOOLEAN,
  unread_count BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH me AS (SELECT id FROM players WHERE auth_uid = auth.uid()),
  mine AS (
    SELECT
      CASE WHEN dm.sender_id = (SELECT id FROM me) THEN dm.recipient_id ELSE dm.sender_id END AS other_id,
      dm.sender_id, dm.content, dm.created_at, dm.read_at
    FROM direct_messages dm
    WHERE dm.sender_id = (SELECT id FROM me) OR dm.recipient_id = (SELECT id FROM me)
  ),
  latest AS (
    SELECT DISTINCT ON (other_id) other_id, content, created_at, sender_id
    FROM mine
    ORDER BY other_id, created_at DESC
  ),
  unread AS (
    SELECT other_id, COUNT(*) AS unread_count
    FROM mine
    WHERE read_at IS NULL AND sender_id <> (SELECT id FROM me)
    GROUP BY other_id
  )
  SELECT
    l.other_id, p.display_name, p.avatar_url,
    l.content, l.created_at, (l.sender_id = (SELECT id FROM me)),
    COALESCE(u.unread_count, 0)
  FROM latest l
  JOIN players p ON p.id = l.other_id
  LEFT JOIN unread u ON u.other_id = l.other_id
  ORDER BY l.created_at DESC;
$$;
