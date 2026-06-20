-- ============================================================
-- Join system: society PIN, player self-join, admin add player
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Add join PIN to societies
ALTER TABLE societies ADD COLUMN IF NOT EXISTS join_pin TEXT UNIQUE;

-- Generate PINs for existing societies that don't have one
UPDATE societies
SET join_pin = LPAD((FLOOR(RANDOM() * 900000) + 100000)::TEXT, 6, '0')
WHERE join_pin IS NULL;

-- 2. Allow authenticated users to create societies (for new society signup)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'societies' AND policyname = 'Authenticated users create societies'
  ) THEN
    CREATE POLICY "Authenticated users create societies" ON societies
      FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
  END IF;
END $$;

-- 3. Allow players to insert their own record (self-signup)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'players' AND policyname = 'Players insert own'
  ) THEN
    CREATE POLICY "Players insert own" ON players
      FOR INSERT WITH CHECK (auth_uid = auth.uid());
  END IF;
END $$;

-- Note: reading other society players is handled via SECURITY DEFINER RPC functions
-- to avoid infinite recursion in RLS policies on the players table.

-- ============================================================
-- RPC: Look up a society by PIN (bypasses RLS safely)
-- ============================================================
CREATE OR REPLACE FUNCTION lookup_society_by_pin(p_pin TEXT)
RETURNS TABLE(id UUID, name TEXT, primary_color TEXT)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id, name, primary_color
  FROM societies
  WHERE join_pin = p_pin
  LIMIT 1;
$$;

-- ============================================================
-- RPC: Player self-joins a society by PIN
-- Creates player record + society_members in one transaction
-- ============================================================
CREATE OR REPLACE FUNCTION join_society_by_pin(
  p_pin         TEXT,
  p_display_name TEXT,
  p_handicap    NUMERIC DEFAULT NULL
)
RETURNS TABLE(r_society_id UUID, r_society_name TEXT, r_player_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_society_id   UUID;
  v_society_name TEXT;
  v_player_id    UUID;
BEGIN
  SELECT id, name INTO v_society_id, v_society_name
  FROM societies WHERE join_pin = p_pin;

  IF v_society_id IS NULL THEN
    RAISE EXCEPTION 'Invalid PIN — no society found';
  END IF;

  -- Get or create player record
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

  -- Join society (ignore if already a member)
  INSERT INTO society_members (society_id, player_id, role)
  VALUES (v_society_id, v_player_id, 'member')
  ON CONFLICT (society_id, player_id) DO NOTHING;

  RETURN QUERY SELECT v_society_id, v_society_name, v_player_id;
END;
$$;

-- ============================================================
-- RPC: Create a new society + owner account in one transaction
-- ============================================================
CREATE OR REPLACE FUNCTION create_society_with_owner(
  p_name          TEXT,
  p_slug          TEXT,
  p_primary_color TEXT,
  p_plan_tier     TEXT,
  p_owner_name    TEXT
)
RETURNS TABLE(society_id UUID, join_pin TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_society_id UUID;
  v_pin        TEXT;
  v_player_id  UUID;
BEGIN
  -- Generate a unique 6-digit PIN
  LOOP
    v_pin := LPAD((FLOOR(RANDOM() * 900000) + 100000)::TEXT, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM societies WHERE societies.join_pin = v_pin);
  END LOOP;

  INSERT INTO societies (name, slug, primary_color, plan_tier, join_pin)
  VALUES (p_name, p_slug, p_primary_color, p_plan_tier, v_pin)
  RETURNING id INTO v_society_id;

  -- Get or create the creator's player record
  SELECT id INTO v_player_id FROM players WHERE auth_uid = auth.uid();
  IF v_player_id IS NULL THEN
    INSERT INTO players (auth_uid, display_name)
    VALUES (auth.uid(), p_owner_name)
    RETURNING id INTO v_player_id;
  END IF;

  INSERT INTO society_members (society_id, player_id, role)
  VALUES (v_society_id, v_player_id, 'owner')
  ON CONFLICT (society_id, player_id) DO UPDATE SET role = 'owner';

  RETURN QUERY SELECT v_society_id, v_pin;
END;
$$;

-- ============================================================
-- RPC: Admin adds a player to their society
-- ============================================================
CREATE OR REPLACE FUNCTION admin_add_player(
  p_society_id   UUID,
  p_display_name TEXT,
  p_email        TEXT    DEFAULT NULL,
  p_handicap     NUMERIC DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id UUID;
BEGIN
  IF NOT is_society_admin(p_society_id) THEN
    RAISE EXCEPTION 'Not authorized — must be society admin';
  END IF;

  INSERT INTO players (display_name, email, handicap_index)
  VALUES (p_display_name, p_email, p_handicap)
  RETURNING id INTO v_player_id;

  INSERT INTO society_members (society_id, player_id, role)
  VALUES (p_society_id, v_player_id, 'member');

  RETURN v_player_id;
END;
$$;
