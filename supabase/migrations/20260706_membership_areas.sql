-- ── Membership areas: three separate player pools within one society ──────────
-- Each society has three join codes (one per area: casual, tour, swindle).
-- society_members gains a membership_types array tracking which areas a player belongs to.
-- Existing members are grandfathered into all three areas.

-- Area codes on societies
ALTER TABLE societies ADD COLUMN IF NOT EXISTS casual_join_code  TEXT UNIQUE;
ALTER TABLE societies ADD COLUMN IF NOT EXISTS tour_join_code    TEXT UNIQUE;
ALTER TABLE societies ADD COLUMN IF NOT EXISTS swindle_join_code TEXT UNIQUE;

-- Membership types on society_members
ALTER TABLE society_members ADD COLUMN IF NOT EXISTS membership_types TEXT[] DEFAULT '{}'::TEXT[];

-- Grandfather existing members into all three areas
UPDATE society_members
SET membership_types = ARRAY['casual', 'tour', 'swindle']
WHERE array_length(membership_types, 1) IS NULL OR membership_types = '{}'::TEXT[];

-- Generate unique 6-char codes for each existing society
DO $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code TEXT;
  v_id UUID;
BEGIN
  FOR v_id IN SELECT id FROM societies LOOP

    -- casual_join_code
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

    -- tour_join_code
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

    -- swindle_join_code
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

-- ── RPC: look up a society and area type by any area join code ────────────
CREATE OR REPLACE FUNCTION lookup_by_area_code(p_code TEXT)
RETURNS TABLE(society_id UUID, society_name TEXT, primary_color TEXT, area_type TEXT)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id, name, primary_color, 'casual'
  FROM societies WHERE casual_join_code = upper(p_code)
  UNION ALL
  SELECT id, name, primary_color, 'tour'
  FROM societies WHERE tour_join_code = upper(p_code)
  UNION ALL
  SELECT id, name, primary_color, 'swindle'
  FROM societies WHERE swindle_join_code = upper(p_code)
  LIMIT 1;
$$;

-- ── RPC: join a society area by code ─────────────────────────────────────
-- Creates player + society_members on first join; adds area to membership_types if already a member.
CREATE OR REPLACE FUNCTION join_by_area_code(
  p_code         TEXT,
  p_display_name TEXT,
  p_handicap     NUMERIC DEFAULT NULL
)
RETURNS TABLE(r_society_id UUID, r_society_name TEXT, r_player_id UUID, r_area_type TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_society_id   UUID;
  v_society_name TEXT;
  v_player_id    UUID;
  v_area_type    TEXT;
BEGIN
  SELECT s.society_id, s.society_name, s.area_type
  INTO v_society_id, v_society_name, v_area_type
  FROM lookup_by_area_code(p_code) s;

  IF v_society_id IS NULL THEN
    RAISE EXCEPTION 'Invalid code — no area found';
  END IF;

  SELECT id INTO v_player_id FROM players WHERE auth_uid = auth.uid();
  IF v_player_id IS NULL THEN
    INSERT INTO players (auth_uid, display_name, handicap_index)
    VALUES (auth.uid(), p_display_name, p_handicap)
    RETURNING id INTO v_player_id;
  ELSE
    UPDATE players
    SET display_name   = p_display_name,
        handicap_index = COALESCE(p_handicap, handicap_index)
    WHERE id = v_player_id;
  END IF;

  INSERT INTO society_members (society_id, player_id, role, membership_types)
  VALUES (v_society_id, v_player_id, 'member', ARRAY[v_area_type])
  ON CONFLICT (society_id, player_id) DO UPDATE
    SET membership_types = (
      SELECT array_agg(DISTINCT t ORDER BY t)
      FROM unnest(array_append(society_members.membership_types, v_area_type)) t
    );

  RETURN QUERY SELECT v_society_id, v_society_name, v_player_id, v_area_type;
END;
$$;

-- ── RPC: admin updates a player's membership types ────────────────────────
CREATE OR REPLACE FUNCTION admin_set_membership_types(
  p_society_id UUID,
  p_player_id  UUID,
  p_types      TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_society_admin(p_society_id) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  UPDATE society_members
  SET membership_types = p_types
  WHERE society_id = p_society_id AND player_id = p_player_id;
END;
$$;
