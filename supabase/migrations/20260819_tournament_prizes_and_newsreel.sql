-- Tournament prize money + NTP/LD winners, and the Inbox DM 'newsreel'
-- message type — both needed for the end-of-tournament Titan Newsreel
-- feature (Dave/Rick, 2026-08-19). Tournaments never had a money concept
-- before (only Swindle did); prize_split mirrors swindle_games.prize_split's
-- shape (percentages by finishing position), but admin-entered directly
-- rather than derived from an entry-fee — tournaments have no per-player
-- entry-fee concept.

ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS prize_pool     NUMERIC,
  ADD COLUMN IF NOT EXISTS prize_split    INTEGER[];

-- NTP/LD winners go on competition_days, not competitions — that table
-- already tracks ntp_hole/ld_hole PER DAY (admin/build.tsx's day config
-- already lets each day toggle its own NTP/LD hole, since different days
-- can be different courses), so the winner belongs alongside it rather
-- than duplicating a tournament-wide hole number that doesn't fit that
-- existing per-day model.
ALTER TABLE competition_days
  ADD COLUMN IF NOT EXISTS ntp_winner_id UUID REFERENCES players(id),
  ADD COLUMN IF NOT EXISTS ld_winner_id  UUID REFERENCES players(id);

-- direct_messages 'newsreel' message type — same extension pattern as
-- 'tournament_invite' (20260818040000_tournament_invites.sql): a new card
-- type in the Inbox thread view, this one linking out to the public
-- newsreel page rather than an accept/decline action.
ALTER TABLE direct_messages DROP CONSTRAINT IF EXISTS direct_messages_message_type_check;
ALTER TABLE direct_messages ADD CONSTRAINT direct_messages_message_type_check
  CHECK (message_type IN ('text', 'tournament_invite', 'newsreel'));
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS link_url TEXT;
