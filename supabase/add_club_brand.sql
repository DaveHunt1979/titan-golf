-- Add brand and model fields to clubs so players can track their equipment
ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS model TEXT;
