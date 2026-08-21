-- Inbox messages had no DELETE policy at all — a player couldn't remove a
-- message from their own inbox (Dave, 2026-08-21). Either participant may
-- delete their own copy of a conversation message.
CREATE POLICY dm_participant_delete ON direct_messages
  FOR DELETE
  USING (
    sender_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
    OR recipient_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  );
