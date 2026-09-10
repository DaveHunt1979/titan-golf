-- ── Ryder Cup needs 2 sides created fresh for that one event (captain-led
-- draft from the whole membership), not a pick from the society's permanent
-- club teams (MOB, Elite, etc.) — those are for formats that run on the
-- standing roster (Titan Way, Team Matchplay, Odd Titan).
--
-- `teams.competition_id` marks a team as scoped to one competition: set for
-- a Ryder Cup's 2 event-only sides, NULL for every permanent club team.
-- Event-scoped teams must stay out of the permanent Teams/Players roster
-- screen and out of other tournaments' "tap a crest" pickers — every
-- existing `.from('teams')` query used as a picker gets `.is('competition_id',
-- null)` added alongside this migration.

ALTER TABLE teams ADD COLUMN IF NOT EXISTS competition_id UUID REFERENCES competitions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_teams_competition_id ON teams(competition_id) WHERE competition_id IS NOT NULL;
