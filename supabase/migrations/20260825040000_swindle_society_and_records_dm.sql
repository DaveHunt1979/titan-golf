-- Swindle season stats: swindle_games has never carried a society_id, so
-- every swindle game across the whole platform is currently one global
-- list (admin/swindle.tsx and swindle/index.tsx both query it unscoped).
-- That's been fine with effectively one active society, but a per-society
-- "season stats" page needs a real scope to filter on. Additive + backfilled
-- from the creator's own society membership, so nothing existing breaks.
ALTER TABLE swindle_games ADD COLUMN IF NOT EXISTS society_id UUID REFERENCES societies(id);

UPDATE swindle_games g
SET society_id = sm.society_id
FROM (
  SELECT DISTINCT ON (player_id) player_id, society_id
  FROM society_members
  ORDER BY player_id, joined_at ASC
) sm
WHERE g.society_id IS NULL AND g.created_by = sm.player_id;

CREATE INDEX IF NOT EXISTS idx_swindle_games_society_id ON swindle_games(society_id);

-- New DM type for "the season stats page is ready" pushes, same mechanism
-- as newsreel (message_type + link_url), widening the existing CHECK
-- constraint the same way each prior swindle_settlement/match_report/
-- newsreel type was added.
ALTER TABLE direct_messages DROP CONSTRAINT IF EXISTS direct_messages_message_type_check;
ALTER TABLE direct_messages ADD CONSTRAINT direct_messages_message_type_check
  CHECK (message_type IN ('text', 'tournament_invite', 'newsreel', 'swindle_settlement', 'match_report', 'swindle_records'));
