-- ============================================================
-- Casual Games — run once in Supabase SQL Editor
-- 1. Allow matches without teams (casual play)
-- 2. Create the "Casual Games" competition
-- 3. Pre-create a day record per course
-- ============================================================

-- Allow nullable team IDs so casual matches don't need team records
ALTER TABLE matches
  ALTER COLUMN home_team_id DROP NOT NULL,
  ALTER COLUMN away_team_id DROP NOT NULL;

-- Casual Games competition (parent for all non-tour games)
INSERT INTO competitions (id, society_id, name, year, format, status, settings) VALUES (
  '40000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'Casual Games',
  2027,
  'casual',
  'active',
  '{}'
) ON CONFLICT (id) DO NOTHING;

-- One day record per course under Casual Games
INSERT INTO competition_days (id, competition_id, day_number, course_name, course_par, course_rating, slope_rating) VALUES
  ('50000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000002', 1, 'West Cliffs',    72, 69.5, 121),
  ('50000000-0000-0000-0000-000000000012', '40000000-0000-0000-0000-000000000002', 2, 'Praia D''El Rey', 73, 71.0, 129)
ON CONFLICT (competition_id, day_number) DO NOTHING;
