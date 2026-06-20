-- ============================================================
-- Fix auth.uid() null inside SECURITY DEFINER functions
-- Pass p_auth_uid explicitly from the client instead
-- Run in Supabase SQL Editor
-- ============================================================

-- Drop old versions first (return type changes require DROP)
DROP FUNCTION IF EXISTS create_society_with_owner(TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS join_society_by_pin(TEXT, TEXT, NUMERIC);

-- ============================================================
-- create_society_with_owner — now accepts explicit auth uid
-- ============================================================
CREATE OR REPLACE FUNCTION create_society_with_owner(
  p_name          TEXT,
  p_slug          TEXT,
  p_primary_color TEXT,
  p_plan_tier     TEXT,
  p_owner_name    TEXT,
  p_auth_uid      UUID
)
RETURNS TABLE(society_id UUID, join_pin TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_society_id UUID;
  v_pin        TEXT;
  v_player_id  UUID;
BEGIN
  LOOP
    v_pin := LPAD((FLOOR(RANDOM() * 900000) + 100000)::TEXT, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM societies WHERE societies.join_pin = v_pin);
  END LOOP;

  INSERT INTO societies (name, slug, primary_color, plan_tier, join_pin)
  VALUES (p_name, p_slug, p_primary_color, p_plan_tier, v_pin)
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

-- ============================================================
-- join_society_by_pin — now accepts explicit auth uid
-- ============================================================
CREATE OR REPLACE FUNCTION join_society_by_pin(
  p_pin          TEXT,
  p_display_name TEXT,
  p_handicap     NUMERIC DEFAULT NULL,
  p_auth_uid     UUID    DEFAULT NULL
)
RETURNS TABLE(r_society_id UUID, r_society_name TEXT, r_player_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid        UUID;
  v_society_id UUID;
  v_soc_name   TEXT;
  v_player_id  UUID;
BEGIN
  v_uid := COALESCE(p_auth_uid, auth.uid());

  SELECT id, name INTO v_society_id, v_soc_name
  FROM societies WHERE join_pin = p_pin;

  IF v_society_id IS NULL THEN
    RAISE EXCEPTION 'Invalid PIN — no society found';
  END IF;

  SELECT id INTO v_player_id FROM players WHERE auth_uid = v_uid;
  IF v_player_id IS NULL THEN
    INSERT INTO players (auth_uid, display_name, handicap_index)
    VALUES (v_uid, p_display_name, p_handicap)
    RETURNING id INTO v_player_id;
  ELSE
    UPDATE players
    SET display_name = p_display_name, handicap_index = p_handicap
    WHERE id = v_player_id;
  END IF;

  INSERT INTO society_members (society_id, player_id, role)
  VALUES (v_society_id, v_player_id, 'member')
  ON CONFLICT (society_id, player_id) DO NOTHING;

  RETURN QUERY SELECT v_society_id, v_soc_name, v_player_id;
END;
$$;
