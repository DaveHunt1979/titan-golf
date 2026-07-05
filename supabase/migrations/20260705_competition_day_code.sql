-- Day join codes so multiple groups can link into one shared game day
ALTER TABLE competition_days
  ADD COLUMN IF NOT EXISTS join_code text,
  ADD COLUMN IF NOT EXISTS day_date  date DEFAULT current_date;

-- Backfill existing rows with unique codes
DO $$
DECLARE
  r RECORD;
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code  text;
BEGIN
  FOR r IN SELECT id FROM competition_days WHERE join_code IS NULL LOOP
    LOOP
      code := '';
      FOR i IN 1..6 LOOP
        code := code || substr(chars, floor(random() * length(chars))::integer + 1, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM competition_days WHERE join_code = code);
    END LOOP;
    UPDATE competition_days SET join_code = code WHERE id = r.id;
  END LOOP;
END;
$$;

ALTER TABLE competition_days ADD CONSTRAINT competition_days_join_code_unique UNIQUE (join_code);

-- Helper: unique 6-char day code
CREATE OR REPLACE FUNCTION generate_day_code()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code  text;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..6 LOOP
      code := code || substr(chars, floor(random() * length(chars))::integer + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM competition_days WHERE join_code = code);
  END LOOP;
  RETURN code;
END;
$$;

-- RPC: create a fresh game day with a shareable join code
CREATE OR REPLACE FUNCTION create_game_day_with_code(
  p_society_id  UUID,
  p_course_name TEXT
)
RETURNS TABLE(day_id UUID, join_code TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_comp_id UUID;
  v_day_id  UUID;
  v_code    TEXT;
  v_day_num INTEGER;
  v_par     INTEGER;
BEGIN
  SELECT id INTO v_comp_id FROM competitions
  WHERE society_id = p_society_id AND format = 'casual' LIMIT 1;

  IF v_comp_id IS NULL THEN
    INSERT INTO competitions (society_id, name, format, status, year)
    VALUES (p_society_id, 'Casual Rounds', 'casual', 'active', EXTRACT(YEAR FROM NOW())::INTEGER)
    RETURNING id INTO v_comp_id;
  END IF;

  v_code := generate_day_code();

  SELECT COALESCE(MAX(day_number), 0) + 1 INTO v_day_num
  FROM competition_days WHERE competition_id = v_comp_id;

  SELECT COALESCE(SUM(par), 72) INTO v_par
  FROM course_holes WHERE course_name = p_course_name;

  INSERT INTO competition_days (competition_id, day_number, course_name, course_par, join_code, day_date)
  VALUES (v_comp_id, v_day_num, p_course_name, v_par, v_code, current_date)
  RETURNING id INTO v_day_id;

  RETURN QUERY SELECT v_day_id, v_code;
END;
$$;
