-- ============================================================
-- Player claiming: when an existing admin-added player signs up
-- via PIN with a matching email, claim their record instead of
-- creating a duplicate.
--
-- Also adds admin_update_player RPC so admins can set/edit
-- player email, name and handicap from the players screen.
--
-- Run in Supabase SQL Editor.
-- ============================================================

-- ── join_society_by_pin — add email claim logic ──────────────
DROP FUNCTION IF EXISTS join_society_by_pin(TEXT, TEXT, NUMERIC, UUID);
DROP FUNCTION IF EXISTS join_society_by_pin(TEXT, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION join_society_by_pin(
  p_pin          TEXT,
  p_display_name TEXT,
  p_handicap     NUMERIC DEFAULT NULL,
  p_auth_uid     UUID    DEFAULT NULL,
  p_email        TEXT    DEFAULT NULL
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

  -- 1. Look up by auth_uid (returning user)
  SELECT id INTO v_player_id FROM players WHERE auth_uid = v_uid;

  -- 2. Not found — try to claim an unlinked record by email
  IF v_player_id IS NULL AND p_email IS NOT NULL THEN
    SELECT id INTO v_player_id
    FROM players
    WHERE LOWER(email) = LOWER(p_email)
      AND auth_uid IS NULL
    LIMIT 1;

    IF v_player_id IS NOT NULL THEN
      -- Claim: link auth account to the existing player record
      UPDATE players
      SET auth_uid      = v_uid,
          display_name  = p_display_name,
          handicap_index = COALESCE(p_handicap, handicap_index),
          email         = p_email
      WHERE id = v_player_id;
    END IF;
  END IF;

  -- 3. Still nothing — create a fresh player record
  IF v_player_id IS NULL THEN
    INSERT INTO players (auth_uid, display_name, handicap_index, email)
    VALUES (v_uid, p_display_name, p_handicap, p_email)
    RETURNING id INTO v_player_id;
  ELSE
    -- Update name/handicap for an already-linked returning user
    UPDATE players
    SET display_name   = p_display_name,
        handicap_index = COALESCE(p_handicap, handicap_index)
    WHERE id = v_player_id AND auth_uid = v_uid;
  END IF;

  INSERT INTO society_members (society_id, player_id, role)
  VALUES (v_society_id, v_player_id, 'member')
  ON CONFLICT (society_id, player_id) DO NOTHING;

  RETURN QUERY SELECT v_society_id, v_soc_name, v_player_id;
END;
$$;

-- ── admin_update_player — let admins edit name/email/handicap ─
CREATE OR REPLACE FUNCTION admin_update_player(
  p_society_id   UUID,
  p_player_id    UUID,
  p_display_name TEXT    DEFAULT NULL,
  p_email        TEXT    DEFAULT NULL,
  p_handicap     NUMERIC DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_society_admin(p_society_id) THEN
    RAISE EXCEPTION 'Not authorized — must be society admin';
  END IF;

  UPDATE players
  SET
    display_name   = COALESCE(p_display_name,   display_name),
    email          = COALESCE(p_email,           email),
    handicap_index = COALESCE(p_handicap,        handicap_index)
  WHERE id = p_player_id;
END;
$$;
