-- Gods (is_platform_admin) can promote/demote members in ANY society, not
-- just ones they already own — Ricky, a God, joined Skullers as a plain
-- member and couldn't make himself or the Skullers leader an admin there
-- (Dave, 2026-09-14). set_member_role previously hard-required the caller
-- be that specific society's owner, with no God exception, unlike every
-- other platform-tier gate (courses RLS, set_platform_admin itself) which
-- already goes through is_platform_admin(). This is exactly the onboarding
-- case the God tier was built for — see the 2026-09-09 platform-admin-tier
-- migration's own stated motivation ("Dave needs to onboard a genuinely
-- external society").
CREATE OR REPLACE FUNCTION set_member_role(
  p_society_id UUID,
  p_player_id  UUID,
  p_role       TEXT  -- 'member' | 'admin'
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT (
    is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM society_members sm
      JOIN players p ON p.id = sm.player_id
      WHERE sm.society_id = p_society_id
        AND sm.role = 'owner'
        AND p.auth_uid = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized — must be society owner or a platform admin';
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
