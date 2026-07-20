-- Add group_code to matches for Mashie Golf group access
-- Each group of 4 in a Mashie game gets a unique code so players
-- can only score for their own group.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS group_code TEXT;
