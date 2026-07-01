-- Add directional fairway tracking to hole_stats
-- Run in Supabase SQL Editor
ALTER TABLE hole_stats
  ADD COLUMN IF NOT EXISTS fairway_direction TEXT
    CHECK (fairway_direction IN ('left', 'centre', 'right'));
