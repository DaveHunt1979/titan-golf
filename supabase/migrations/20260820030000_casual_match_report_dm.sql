-- Casual Golf match report now also lands in every player's Inbox, not
-- just the News tab (Dave, 2026-08-20 — "will it also save to my inbox as
-- well"). Same 'newsreel' card pattern, new message_type so the Inbox card
-- can carry its own heading/icon rather than say "Titan Newsreel".
ALTER TABLE direct_messages DROP CONSTRAINT IF EXISTS direct_messages_message_type_check;
ALTER TABLE direct_messages ADD CONSTRAINT direct_messages_message_type_check
  CHECK (message_type IN ('text', 'tournament_invite', 'newsreel', 'swindle_settlement', 'match_report'));
