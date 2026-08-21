-- Spectator Mode ticker — Dave, 2026-08-20: "the little ticker tape along
-- the bottom of spectator mode... we need it more dynamic... we get the
-- opening messages, we want more." The `notifications` table already had
-- exactly the right shape for this (type: birdie/eagle/hole_in_one/
-- match_result, target: 'spectator') but nothing in the app has ever
-- written to it — confirmed via a full codebase search before writing
-- this migration. Also missing an INSERT policy entirely (RLS denies by
-- default with none defined), which is very likely *why* nobody ever
-- wired it up: it would have failed the moment anyone tried.

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS match_id UUID REFERENCES matches(id) ON DELETE CASCADE;

-- Same permissive pattern as casual matches/competition_days themselves
-- (20260705_casual_rls.sql) — these are informational ticker events, not
-- sensitive data, and casual matches have no society_id to check against.
CREATE POLICY "Authed users insert notifications" ON notifications FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
