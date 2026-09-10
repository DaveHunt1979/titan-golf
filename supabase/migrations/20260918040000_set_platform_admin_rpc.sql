-- ── God assignment from the Players screen ─────────────────────────────────
-- Dave, 2026-09-09: "me and rick who can assign the roles... we need to be
-- able to change them to gods." Existing role UI (PlayerEditSheet.tsx) only
-- ever touched society_members.role (member/admin), gated to the society
-- owner. This adds a separate, orthogonal control for players.is_platform_admin
-- itself, gated to existing platform admins only — a normal society
-- owner/admin can never promote anyone to God, and never even sees the
-- control (client-side gate; this RPC is the real enforcement).

CREATE OR REPLACE FUNCTION set_platform_admin(p_player_id UUID, p_value BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  UPDATE players SET is_platform_admin = p_value WHERE id = p_player_id;
END;
$$;
