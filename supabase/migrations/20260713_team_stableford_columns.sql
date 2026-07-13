-- Add team configuration columns to matches for Team Stableford format
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS team_size INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS counting_scores INT DEFAULT NULL;
