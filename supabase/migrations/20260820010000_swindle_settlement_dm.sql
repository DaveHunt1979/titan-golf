-- New direct_messages type for Swindle settlement notices — sent to each
-- player when the organiser marks a swindle complete, telling them exactly
-- how much they owe (and to whom, for the direct/"who owes who" method).
-- Same broadcast pattern as 'tournament_invite'/'newsreel': one row per
-- recipient, organiser as sender. get_my_dm_threads() (see
-- 20260820000000_dm_threads_exclude_sender_broadcasts.sql) already excludes
-- every non-'text' message_type from the SENDER's own thread list, so this
-- doesn't need its own carve-out there — it's covered automatically.
ALTER TABLE direct_messages DROP CONSTRAINT IF EXISTS direct_messages_message_type_check;
ALTER TABLE direct_messages ADD CONSTRAINT direct_messages_message_type_check
  CHECK (message_type IN ('text', 'tournament_invite', 'newsreel', 'swindle_settlement'));
