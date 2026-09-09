-- ── Fix: societies created after 20260706010000_membership_areas.sql never got
-- casual_join_code / tour_join_code / swindle_join_code populated. That migration's
-- code-generation was a one-time backfill over societies existing at the time —
-- create_society_with_owner was never updated to generate them for new societies.
-- Result: "Join with a Code" (lookup_by_area_code / join_by_area_code) can never
-- succeed for any society created since, even though the admin UI presents the
-- feature as working.
--
-- This migration:
--   1. Updates create_society_with_owner to generate all three area codes at creation time.
--   2. Backfills any existing society whose area codes are still NULL (safe/idempotent —
--      societies that already have codes, e.g. Titan, Guinness Boys, are untouched).
--   3. Adds generate_area_codes(p_society_id) so an admin can self-serve a repair via
--      the Codes & PINs screen without needing a manual SQL run.

-- ── 1. create_society_with_owner now also generates area codes ────────────
CREATE OR REPLACE FUNCTION create_society_with_owner(
  p_name          TEXT,
  p_slug          TEXT,
  p_primary_color TEXT,
  p_plan_tier     TEXT,
  p_owner_name    TEXT,
  p_auth_uid      UUID
)
RETURNS TABLE(out_society_id UUID, join_pin TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  chars          TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_society_id   UUID;
  v_pin          TEXT;
  v_player_id    UUID;
  v_casual_code  TEXT;
  v_tour_code    TEXT;
  v_swindle_code TEXT;
  v_code         TEXT;
  i              INT;
BEGIN
  LOOP
    v_pin := LPAD((FLOOR(RANDOM() * 900000) + 100000)::TEXT, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM societies WHERE societies.join_pin = v_pin);
  END LOOP;

  LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(chars, floor(random() * length(chars))::integer + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM societies
      WHERE casual_join_code = v_code OR tour_join_code = v_code OR swindle_join_code = v_code
    );
  END LOOP;
  v_casual_code := v_code;

  LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(chars, floor(random() * length(chars))::integer + 1, 1);
    END LOOP;
    EXIT WHEN v_code <> v_casual_code AND NOT EXISTS (
      SELECT 1 FROM societies
      WHERE casual_join_code = v_code OR tour_join_code = v_code OR swindle_join_code = v_code
    );
  END LOOP;
  v_tour_code := v_code;

  LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(chars, floor(random() * length(chars))::integer + 1, 1);
    END LOOP;
    EXIT WHEN v_code NOT IN (v_casual_code, v_tour_code) AND NOT EXISTS (
      SELECT 1 FROM societies
      WHERE casual_join_code = v_code OR tour_join_code = v_code OR swindle_join_code = v_code
    );
  END LOOP;
  v_swindle_code := v_code;

  INSERT INTO societies (name, slug, primary_color, plan_tier, join_pin, casual_join_code, tour_join_code, swindle_join_code)
  VALUES (p_name, p_slug, p_primary_color, p_plan_tier, v_pin, v_casual_code, v_tour_code, v_swindle_code)
  RETURNING id INTO v_society_id;

  SELECT id INTO v_player_id FROM players WHERE auth_uid = p_auth_uid;
  IF v_player_id IS NULL THEN
    INSERT INTO players (auth_uid, display_name)
    VALUES (p_auth_uid, p_owner_name)
    RETURNING id INTO v_player_id;
  END IF;

  INSERT INTO society_members (society_id, player_id, role)
  VALUES (v_society_id, v_player_id, 'owner')
  ON CONFLICT (society_id, player_id) DO UPDATE SET role = 'owner';

  RETURN QUERY SELECT v_society_id, v_pin;
END;
$$;

-- ── 2. Backfill any society still missing area codes (e.g. Mashie) ────────
DO $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code TEXT;
  v_id UUID;
BEGIN
  FOR v_id IN
    SELECT id FROM societies
    WHERE casual_join_code IS NULL OR tour_join_code IS NULL OR swindle_join_code IS NULL
  LOOP

    IF NOT EXISTS (SELECT 1 FROM societies WHERE id = v_id AND casual_join_code IS NOT NULL) THEN
      LOOP
        v_code := '';
        FOR i IN 1..6 LOOP
          v_code := v_code || substr(chars, floor(random() * length(chars))::integer + 1, 1);
        END LOOP;
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM societies
          WHERE casual_join_code = v_code OR tour_join_code = v_code OR swindle_join_code = v_code
        );
      END LOOP;
      UPDATE societies SET casual_join_code = v_code WHERE id = v_id;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM societies WHERE id = v_id AND tour_join_code IS NOT NULL) THEN
      LOOP
        v_code := '';
        FOR i IN 1..6 LOOP
          v_code := v_code || substr(chars, floor(random() * length(chars))::integer + 1, 1);
        END LOOP;
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM societies
          WHERE casual_join_code = v_code OR tour_join_code = v_code OR swindle_join_code = v_code
        );
      END LOOP;
      UPDATE societies SET tour_join_code = v_code WHERE id = v_id;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM societies WHERE id = v_id AND swindle_join_code IS NOT NULL) THEN
      LOOP
        v_code := '';
        FOR i IN 1..6 LOOP
          v_code := v_code || substr(chars, floor(random() * length(chars))::integer + 1, 1);
        END LOOP;
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM societies
          WHERE casual_join_code = v_code OR tour_join_code = v_code OR swindle_join_code = v_code
        );
      END LOOP;
      UPDATE societies SET swindle_join_code = v_code WHERE id = v_id;
    END IF;

  END LOOP;
END $$;

-- ── 3. Admin self-serve repair RPC ─────────────────────────────────────────
-- Fills in any of the three area codes that are still NULL for a society (does not
-- touch codes that already exist — use this to repair, not to rotate live codes).
CREATE OR REPLACE FUNCTION generate_area_codes(p_society_id UUID)
RETURNS TABLE(r_casual_code TEXT, r_tour_code TEXT, r_swindle_code TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code TEXT;
BEGIN
  IF NOT is_society_admin(p_society_id) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM societies WHERE id = p_society_id AND casual_join_code IS NOT NULL) THEN
    LOOP
      v_code := '';
      FOR i IN 1..6 LOOP
        v_code := v_code || substr(chars, floor(random() * length(chars))::integer + 1, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM societies
        WHERE casual_join_code = v_code OR tour_join_code = v_code OR swindle_join_code = v_code
      );
    END LOOP;
    UPDATE societies SET casual_join_code = v_code WHERE id = p_society_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM societies WHERE id = p_society_id AND tour_join_code IS NOT NULL) THEN
    LOOP
      v_code := '';
      FOR i IN 1..6 LOOP
        v_code := v_code || substr(chars, floor(random() * length(chars))::integer + 1, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM societies
        WHERE casual_join_code = v_code OR tour_join_code = v_code OR swindle_join_code = v_code
      );
    END LOOP;
    UPDATE societies SET tour_join_code = v_code WHERE id = p_society_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM societies WHERE id = p_society_id AND swindle_join_code IS NOT NULL) THEN
    LOOP
      v_code := '';
      FOR i IN 1..6 LOOP
        v_code := v_code || substr(chars, floor(random() * length(chars))::integer + 1, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM societies
        WHERE casual_join_code = v_code OR tour_join_code = v_code OR swindle_join_code = v_code
      );
    END LOOP;
    UPDATE societies SET swindle_join_code = v_code WHERE id = p_society_id;
  END IF;

  RETURN QUERY
  SELECT casual_join_code, tour_join_code, swindle_join_code
  FROM societies WHERE id = p_society_id;
END;
$$;
