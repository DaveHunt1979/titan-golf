-- ============================================================
-- Spectator role support
-- Adds p_role param to join_society_by_pin so spectators can
-- join the society without appearing in the player roster.
-- Run in Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION join_society_by_pin(
  p_pin          TEXT,
  p_display_name TEXT,
  p_handicap     NUMERIC DEFAULT NULL,
  p_role         TEXT    DEFAULT 'member'
)
RETURNS TABLE(r_society_id UUID, r_society_name TEXT, r_player_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_society_id   UUID;
  v_society_name TEXT;
  v_player_id    UUID;
  v_role         TEXT;
BEGIN
  SELECT id, name INTO v_society_id, v_society_name
  FROM societies WHERE join_pin = p_pin;

  IF v_society_id IS NULL THEN
    RAISE EXCEPTION 'Invalid PIN — no society found';
  END IF;

  v_role := CASE WHEN p_role = 'spectator' THEN 'spectator' ELSE 'member' END;

  SELECT id INTO v_player_id FROM players WHERE auth_uid = auth.uid();
  IF v_player_id IS NULL THEN
    INSERT INTO players (auth_uid, display_name, handicap_index)
    VALUES (auth.uid(), p_display_name, p_handicap)
    RETURNING id INTO v_player_id;
  ELSE
    UPDATE players
    SET display_name = p_display_name, handicap_index = p_handicap
    WHERE id = v_player_id;
  END IF;

  INSERT INTO society_members (society_id, player_id, role)
  VALUES (v_society_id, v_player_id, v_role)
  ON CONFLICT (society_id, player_id) DO NOTHING;

  RETURN QUERY SELECT v_society_id, v_society_name, v_player_id;
END;
$$;
