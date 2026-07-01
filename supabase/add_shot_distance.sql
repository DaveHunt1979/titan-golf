-- Add optional distance tracking to shots
ALTER TABLE shots ADD COLUMN IF NOT EXISTS distance_yards INT;
