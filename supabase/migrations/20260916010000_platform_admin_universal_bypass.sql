-- God tier, take 2 (Dave, 2026-09-16): the original God tier (see
-- 20260918030000_platform_admin_tier.sql) was deliberately scoped to just
-- platform-wide resources (courses DB, course requests) — a God still
-- needed a real society_members admin/owner row to manage any one society's
-- tournaments/Swindle. Dave hit this directly: had to manually promote
-- himself+Rick to admin in a society before he could add players to a
-- tournament or manage Swindle there. His call, with only two Gods ever
-- (himself + Rick): God should be able to do everything, everywhere,
-- without needing to join a society first — both to bail out an admin in
-- trouble, and so they can toggle their OWN is_platform_admin flag off to
-- test the app as a genuinely restricted normal admin/member.
--
-- is_society_admin(sid) is the shared gate behind the great majority of
-- society-scoped "admins only" policies (society_members, competition_players,
-- and 11 more call sites per a full-repo grep) — ORing in is_platform_admin()
-- here fixes all of them in one place, for free, with no other file touched.
CREATE OR REPLACE FUNCTION is_society_admin(sid UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT is_platform_admin() OR EXISTS (
    SELECT 1 FROM society_members sm
    JOIN players p ON p.id = sm.player_id
    WHERE sm.society_id = sid
      AND p.auth_uid = auth.uid()
      AND sm.role IN ('admin', 'owner')
  );
$$;

-- A handful of older policies inline-duplicate the role join instead of
-- calling is_society_admin(sid), so they don't inherit the fix above.
-- Postgres RLS policies for the same command are OR'd together, so these
-- are purely additive — none of the existing policies are touched.

-- player_groups (saved 4-balls/squads) — see 20260720_player_groups.sql
CREATE POLICY "Platform admins manage groups" ON player_groups FOR ALL
  USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- players INSERT (simulation/guest player creation) — see 20260902000000_simulation_support.sql
CREATE POLICY "Platform admins create players" ON players FOR INSERT
  WITH CHECK (is_platform_admin());

-- Swindle admin overrides — see 20260911000000_swindle_admin_rls.sql
CREATE POLICY "Platform admin update swindle_games" ON swindle_games FOR UPDATE TO authenticated
  USING (is_platform_admin());
CREATE POLICY "Platform admin delete swindle_games" ON swindle_games FOR DELETE TO authenticated
  USING (is_platform_admin());
CREATE POLICY "Platform admin update swindle_groups" ON swindle_groups FOR UPDATE TO authenticated
  USING (is_platform_admin());
CREATE POLICY "Platform admin delete swindle_groups" ON swindle_groups FOR DELETE TO authenticated
  USING (is_platform_admin());
CREATE POLICY "Platform admin delete swindle_group_players" ON swindle_group_players FOR DELETE TO authenticated
  USING (is_platform_admin());
