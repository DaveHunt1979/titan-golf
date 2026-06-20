-- ============================================================
-- Fix: "column reference society_id is ambiguous" in
-- create_society_with_owner. The RETURNS TABLE(society_id…)
-- declaration created an OUT variable with the same name as
-- the society_members.society_id column, confusing PostgreSQL
-- inside the ON CONFLICT clause.
-- Rename the return column to out_society_id to avoid conflict.
-- Run in Supabase SQL Editor.
-- ============================================================

DROP FUNCTION IF EXISTS create_society_with_owner(TEXT, TEXT, TEXT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS create_society_with_owner(TEXT, TEXT, TEXT, TEXT, TEXT);

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
