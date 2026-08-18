-- Enrolled vs invited players, and a structured "tournament invite" DM
-- card (Yes/Decline) instead of a plain text message.

ALTER TABLE competition_players
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'enrolled'
    CHECK (status IN ('enrolled', 'invited', 'declined'));

-- competition_players only had "Admins manage ALL" — an invited player
-- responding Yes/Decline to their own invite needs to write their own row,
-- which no existing policy covers.
CREATE POLICY "Players respond to own invite" ON competition_players FOR UPDATE USING (
  player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

ALTER TABLE direct_messages
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'tournament_invite')),
  ADD COLUMN IF NOT EXISTS competition_id UUID REFERENCES competitions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS invite_response TEXT
    CHECK (invite_response IN ('accepted', 'declined'));
-- invite_response is written by the recipient via the existing
-- dm_recipient_mark_read UPDATE policy (unscoped to columns) — no new
-- direct_messages policy needed.
