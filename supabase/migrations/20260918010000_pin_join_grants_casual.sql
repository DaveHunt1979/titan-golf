-- ── Dave's brief: the society's single Join PIN (shown as "SOCIETY JOIN PIN"
-- in admin > Codes & PINs) is the one code that should be handed to anyone
-- wanting to join. Using it should automatically grant Casual Golf access;
-- admin then manually adds Tour/Swindle per-player via Admin > Players.
--
-- join_society_by_pin (the overload actually called by the app — with
-- p_auth_uid/p_email, from fix_join_claim_player.sql) left membership_types
-- at its default '{}' on insert. Casual access happens to already work today
-- via each screen's own `area === 'casual' || ...` fallback, but this makes
-- it explicit and consistent with how join_by_area_code grants its area.

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

  INSERT INTO society_members (society_id, player_id, role, membership_types)
  VALUES (v_society_id, v_player_id, 'member', ARRAY['casual'])
  ON CONFLICT (society_id, player_id) DO UPDATE
    SET membership_types = (
      SELECT array_agg(DISTINCT t ORDER BY t)
      FROM unnest(array_append(society_members.membership_types, 'casual')) t
    );

  RETURN QUERY SELECT v_society_id, v_soc_name, v_player_id;
END;
$$;
