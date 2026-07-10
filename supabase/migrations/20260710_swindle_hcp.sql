-- WHS-compliant handicap fields for swindle games.
-- slope_rating / course_rating allow proper Course Handicap conversion.
-- hcp_allowance (%) lets the organiser set full/3-quarter/scratch etc.
ALTER TABLE swindle_games
  ADD COLUMN IF NOT EXISTS slope_rating  INTEGER      NOT NULL DEFAULT 113,
  ADD COLUMN IF NOT EXISTS course_rating NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS hcp_allowance INTEGER      NOT NULL DEFAULT 100;
