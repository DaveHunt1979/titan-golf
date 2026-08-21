-- Every player in a casual round gets their own match report in their own
-- inbox, including the player who just finished and generated it — not
-- just their opponents (Dave, 2026-08-21 — "all rounds that anyone is in
-- should go to their mailbox, it is a great little feature"). The
-- direct_messages self-DM guard is right for a real 1-1 conversation, but
-- wrong for this one-way system notification, so relax it narrowly for
-- match_report only. get_my_dm_threads() already treats non-'text'
-- message types as recipient-only broadcasts (see
-- 20260820000000_dm_threads_exclude_sender_broadcasts.sql), so a self-row
-- here surfaces as a normal thread with no extra RPC changes needed.
ALTER TABLE direct_messages DROP CONSTRAINT IF EXISTS direct_messages_not_self;
ALTER TABLE direct_messages ADD CONSTRAINT direct_messages_not_self
  CHECK (sender_id <> recipient_id OR message_type = 'match_report');
