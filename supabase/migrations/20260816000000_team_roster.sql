-- Permanent team rosters. Until now player<->team assignment only existed
-- per-tournament (competition_players.team_id, wiped clean for every new
-- tournament) — teams themselves had no default roster to prebuild from.
-- ON DELETE SET NULL (not CASCADE): deleting a team should only clear the
-- player's team assignment, not their society membership.
ALTER TABLE society_members
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS society_members_team_id_idx ON society_members(team_id);
