-- Casual rounds (competition_days with competition_id IS NULL, see
-- 20260705020000_casual_rounds_standalone.sql) never recorded which society
-- they belonged to at all -- the only column that ever pointed at a
-- competition/society was competition_id, and casual rounds deliberately
-- leave that null. Titan News' global feed (app/(app)/news/index.tsx) had
-- no choice but to infer "does this round belong to my society" from
-- whether ANY player in it is currently a member of the viewing society --
-- which leaks a round into another society's feed the moment a single
-- multi-society player (an admin testing both societies, say) appears in
-- it, even if the round has nothing to do with that other society (Dave,
-- 2026-09-21: "why in titan news when im in skullers, showing titan
-- news... not skullers round").
--
-- Fix: record the actual creating society directly on the day, the same
-- way every other round type (competitions, seasons) already carries its
-- own society_id. Nullable and additive -- existing rows keep working via
-- the app's existing player-membership fallback for rows where this is
-- still null.
ALTER TABLE competition_days
  ADD COLUMN IF NOT EXISTS society_id UUID REFERENCES societies(id);

-- create_game_day_with_code already receives p_society_id (used, in an
-- earlier since-reverted version of this function, to look up/create a
-- linked competitions row) but the currently-live version drops it on the
-- floor entirely. Now it just stamps the new column -- competition_id
-- stays NULL exactly as the "standalone casual days" migration intended,
-- this changes nothing else about how casual rounds work.
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
  LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(chars, floor(random() * length(chars))::integer + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM competition_days cd WHERE cd.join_code = v_code);
  END LOOP;

  SELECT COALESCE(SUM(par), 72) INTO v_par
  FROM course_holes WHERE course_name = p_course_name;

  INSERT INTO competition_days (competition_id, society_id, day_number, course_name, course_par, join_code, day_date)
  VALUES (NULL, p_society_id, 1, p_course_name, v_par, v_code, current_date)
  RETURNING id INTO v_day_id;

  RETURN QUERY SELECT v_day_id, v_code;
END;
$$;
