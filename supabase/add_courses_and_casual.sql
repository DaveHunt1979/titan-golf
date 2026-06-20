-- ============================================================
-- Dynamic courses + casual competition per society
-- Run in Supabase SQL Editor
-- ============================================================

-- Allow authenticated users to read/write course hole data
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'course_holes' AND policyname = 'Auth select course holes'
  ) THEN
    CREATE POLICY "Auth select course holes" ON course_holes
      FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'course_holes' AND policyname = 'Auth insert course holes'
  ) THEN
    CREATE POLICY "Auth insert course holes" ON course_holes
      FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'course_holes' AND policyname = 'Auth update course holes'
  ) THEN
    CREATE POLICY "Auth update course holes" ON course_holes
      FOR UPDATE USING (auth.uid() IS NOT NULL);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'course_holes' AND policyname = 'Auth delete course holes'
  ) THEN
    CREATE POLICY "Auth delete course holes" ON course_holes
      FOR DELETE USING (auth.uid() IS NOT NULL);
  END IF;
END $$;

-- ── get_or_create_casual_competition ────────────────────────
-- Returns (or creates) the permanent casual rounds bucket for
-- a society. Called once per session by games/new.tsx.
CREATE OR REPLACE FUNCTION get_or_create_casual_competition(p_society_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_comp_id UUID;
BEGIN
  SELECT id INTO v_comp_id
  FROM competitions
  WHERE society_id = p_society_id AND format = 'casual'
  LIMIT 1;

  IF v_comp_id IS NULL THEN
    INSERT INTO competitions (society_id, name, format, status, year)
    VALUES (
      p_society_id,
      'Casual Rounds',
      'casual',
      'active',
      EXTRACT(YEAR FROM NOW())::INTEGER
    )
    RETURNING id INTO v_comp_id;
  END IF;

  RETURN v_comp_id;
END;
$$;

-- ── get_or_create_course_day ─────────────────────────────────
-- Returns (or creates) a competition_days row for a course
-- inside the casual competition. Each distinct course gets its
-- own day row, used as the day_id on casual matches.
CREATE OR REPLACE FUNCTION get_or_create_course_day(
  p_competition_id UUID,
  p_course_name    TEXT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_day_id  UUID;
  v_day_num INTEGER;
  v_par     INTEGER;
BEGIN
  SELECT id INTO v_day_id
  FROM competition_days
  WHERE competition_id = p_competition_id
    AND course_name = p_course_name
  LIMIT 1;

  IF v_day_id IS NULL THEN
    SELECT COALESCE(MAX(day_number), 0) + 1 INTO v_day_num
    FROM competition_days
    WHERE competition_id = p_competition_id;

    SELECT COALESCE(SUM(par), 72) INTO v_par
    FROM course_holes
    WHERE course_name = p_course_name;

    INSERT INTO competition_days (competition_id, day_number, course_name, course_par)
    VALUES (p_competition_id, v_day_num, p_course_name, v_par)
    RETURNING id INTO v_day_id;
  END IF;

  RETURN v_day_id;
END;
$$;
