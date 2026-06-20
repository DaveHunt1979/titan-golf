-- Stores the raw round entries used to calculate the player's handicap index.
-- Run in Supabase SQL Editor.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS handicap_rounds JSONB DEFAULT '[]';
