-- Add per-tee yardages to course holes and track selected tee on matches.
-- tee_yardages stores eg: {"black": 425, "white": 390, "yellow": 365, "blue": 355, "red": 310}
-- Existing yardage column kept for backward compat (used when tee_yardages is empty).

ALTER TABLE course_holes ADD COLUMN IF NOT EXISTS tee_yardages JSONB NOT NULL DEFAULT '{}';
ALTER TABLE matches      ADD COLUMN IF NOT EXISTS tee_color    TEXT;
