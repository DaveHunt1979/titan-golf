-- swindle_games never had a DELETE policy (RLS defaults to deny) — the
-- existing admin "Delete" button in admin/swindle.tsx was almost certainly
-- silently failing. Scoped to the creator, same pattern as swindle_games_update.
-- Entries/scores/groups all reference swindle_games ON DELETE CASCADE already.
CREATE POLICY "swindle_games_delete" ON swindle_games FOR DELETE USING (
  created_by IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);
