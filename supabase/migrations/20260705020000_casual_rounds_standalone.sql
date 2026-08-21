-- Casual game days should not require a competition/tournament wrapper.
-- Make competition_id nullable on both tables so a standalone game day
-- (join code, pick-up round) can exist independently of any tour or trophy.

ALTER TABLE competition_days ALTER COLUMN competition_id DROP NOT NULL;
ALTER TABLE matches          ALTER COLUMN competition_id DROP NOT NULL;

-- Also drop the old day_number constraint fix migration's work — superseded by
-- the NULL competition_id approach (casual days no longer consume day_numbers).

-- Rewrite the RPC: create a standalone game day with no competition attached.
CREATE OR REPLACE FUNCTION create_game_day_with_code(
  p_society_id  UUID,
  p_course_name TEXT
)
RETURNS TABLE(day_id UUID, join_code TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_day_id UUID;
  v_code   TEXT;
  v_par    INTEGER;
  chars    TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
BEGIN
  -- Generate a unique 6-char join code
  LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(chars, floor(random() * length(chars))::integer + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM competition_days cd WHERE cd.join_code = v_code);
  END LOOP;

  -- Derive par from course holes if available, else default 72
  SELECT COALESCE(SUM(par), 72) INTO v_par
  FROM course_holes WHERE course_name = p_course_name;

  -- Insert a standalone day (no competition_id, no day_number needed)
  INSERT INTO competition_days (competition_id, day_number, course_name, course_par, join_code, day_date)
  VALUES (NULL, 1, p_course_name, v_par, v_code, current_date)
  RETURNING id INTO v_day_id;

  RETURN QUERY SELECT v_day_id, v_code;
END;
$$;
