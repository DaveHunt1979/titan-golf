-- ============================================================
-- Member committee roles + society deletion
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Committee role on society_members (display-only, separate from permission role)
ALTER TABLE society_members ADD COLUMN IF NOT EXISTS committee_role TEXT;

-- ============================================================
-- RPC: Set a member's committee role (admin/owner only)
-- ============================================================
CREATE OR REPLACE FUNCTION set_committee_role(
  p_society_id UUID,
  p_player_id  UUID,
  p_role       TEXT
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_society_admin(p_society_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE society_members
  SET committee_role = NULLIF(TRIM(p_role), '')
  WHERE society_id = p_society_id AND player_id = p_player_id;
END;
$$;

-- ============================================================
-- RPC: Change a member's app permission role (owner only)
-- Cannot demote the owner or promote to owner
-- ============================================================
CREATE OR REPLACE FUNCTION set_member_role(
  p_society_id UUID,
  p_player_id  UUID,
  p_role       TEXT  -- 'member' | 'admin'
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM society_members sm
    JOIN players p ON p.id = sm.player_id
    WHERE sm.society_id = p_society_id
      AND sm.role = 'owner'
      AND p.auth_uid = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized — must be society owner';
  END IF;
  IF p_role NOT IN ('member', 'admin') THEN
    RAISE EXCEPTION 'Invalid role — must be member or admin';
  END IF;
  UPDATE society_members
  SET role = p_role
  WHERE society_id = p_society_id
    AND player_id = p_player_id
    AND role != 'owner';  -- owners cannot be demoted this way
END;
$$;

-- ============================================================
-- RPC: Delete a society (owner only) — cascades all data
-- Does NOT delete the player records themselves
-- ============================================================
CREATE OR REPLACE FUNCTION delete_society(p_society_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM society_members sm
    JOIN players p ON p.id = sm.player_id
    WHERE sm.society_id = p_society_id
      AND sm.role = 'owner'
      AND p.auth_uid = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized — must be society owner';
  END IF;

  DELETE FROM match_holes
  WHERE match_id IN (
    SELECT m.id FROM matches m
    JOIN competition_days cd ON cd.id = m.day_id
    JOIN competitions c ON c.id = cd.competition_id
    WHERE c.society_id = p_society_id
  );

  DELETE FROM matches
  WHERE day_id IN (
    SELECT cd.id FROM competition_days cd
    JOIN competitions c ON c.id = cd.competition_id
    WHERE c.society_id = p_society_id
  );

  DELETE FROM competition_days
  WHERE competition_id IN (
    SELECT id FROM competitions WHERE society_id = p_society_id
  );

  DELETE FROM competitions  WHERE society_id = p_society_id;
  DELETE FROM champions     WHERE society_id = p_society_id;
  DELETE FROM teams         WHERE society_id = p_society_id;
  DELETE FROM society_members WHERE society_id = p_society_id;
  DELETE FROM societies     WHERE id = p_society_id;
END;
$$;
