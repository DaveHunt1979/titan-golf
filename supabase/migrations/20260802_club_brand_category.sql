-- Add brand_category column to clubs table for Brand → Category → Model picker
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS brand_category TEXT;
