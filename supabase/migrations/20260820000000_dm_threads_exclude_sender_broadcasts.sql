-- Fix: an admin broadcasting a DM to N players (tournament invites via
-- admin/build.tsx's finishDraft(), or the Titan Newsreel via
-- admin/news.tsx's publishAndSend()) was cluttering the ADMIN's own inbox
-- with N new "threads" — one per recipient — because get_my_dm_threads()
-- surfaced any row where the caller is sender OR recipient, with no
-- concept of "this was a broadcast I sent, not a conversation I'm in."
-- Dave/Rick, 2026-08-20: "we set up a 4-ball... Rick would get his and the
-- 3 others [in his inbox], when he posted the news article" — correctly
-- delivered to each recipient, but also spammed the sender's own thread
-- list. Not a privacy leak (RLS already scopes each row to its own
-- sender/recipient), just the wrong shape for a one-to-many system
-- message riding on a 1-1 chat table.
--
-- Fix: broadcast-type messages ('tournament_invite', 'newsreel') only
-- ever create a thread for the recipient now, never for the sender who
-- fired it at multiple people. Ordinary 'text' DMs are untouched — a real
-- 1-1 chat still shows on both sides exactly as before.
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
    WHERE (dm.sender_id = (SELECT id FROM me) OR dm.recipient_id = (SELECT id FROM me))
      AND (dm.message_type = 'text' OR dm.recipient_id = (SELECT id FROM me))
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
