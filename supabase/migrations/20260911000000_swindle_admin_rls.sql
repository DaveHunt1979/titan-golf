-- Swindle write policies were written for a "creator owns it" model only
-- (swindle_games_update/delete, "Creator update/delete swindle_groups", etc.
-- all require created_by/added_by to match the calling player). A society
-- admin managing a swindle they didn't personally create via the mobile app
-- gets zero rows affected on UPDATE/DELETE — RLS denies silently, no error.
-- Same class of gap the swindle_games_delete migration fixed for creators.
--
-- These policies are additive: Postgres RLS policies for the same command
-- are OR'd together, so the existing creator-only policies are untouched —
-- this just adds an admin/owner override on top of them.

CREATE POLICY "Admin update swindle_games" ON swindle_games FOR UPDATE TO authenticated
  USING (
    society_id IN (
      SELECT sm.society_id FROM society_members sm
      JOIN players p ON p.id = sm.player_id
      WHERE p.auth_uid = auth.uid() AND sm.role IN ('admin', 'owner')
    )
  );

CREATE POLICY "Admin delete swindle_games" ON swindle_games FOR DELETE TO authenticated
  USING (
    society_id IN (
      SELECT sm.society_id FROM society_members sm
      JOIN players p ON p.id = sm.player_id
      WHERE p.auth_uid = auth.uid() AND sm.role IN ('admin', 'owner')
    )
  );

CREATE POLICY "Admin update swindle_groups" ON swindle_groups FOR UPDATE TO authenticated
  USING (
    game_id IN (
      SELECT g.id FROM swindle_games g
      JOIN society_members sm ON sm.society_id = g.society_id
      JOIN players p ON p.id = sm.player_id
      WHERE p.auth_uid = auth.uid() AND sm.role IN ('admin', 'owner')
    )
  );

CREATE POLICY "Admin delete swindle_groups" ON swindle_groups FOR DELETE TO authenticated
  USING (
    game_id IN (
      SELECT g.id FROM swindle_games g
      JOIN society_members sm ON sm.society_id = g.society_id
      JOIN players p ON p.id = sm.player_id
      WHERE p.auth_uid = auth.uid() AND sm.role IN ('admin', 'owner')
    )
  );

CREATE POLICY "Admin delete swindle_group_players" ON swindle_group_players FOR DELETE TO authenticated
  USING (
    group_id IN (
      SELECT sg.id FROM swindle_groups sg
      JOIN swindle_games g ON g.id = sg.game_id
      JOIN society_members sm ON sm.society_id = g.society_id
      JOIN players p ON p.id = sm.player_id
      WHERE p.auth_uid = auth.uid() AND sm.role IN ('admin', 'owner')
    )
  );
