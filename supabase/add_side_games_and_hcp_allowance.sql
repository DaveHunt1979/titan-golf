-- Add side games tags and handicap allowance percentage to matches
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS hcp_allowance INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS side_games    TEXT[]  DEFAULT '{}';

-- Allow any authenticated user to insert matches (for casual game creation)
DROP POLICY IF EXISTS "Members insert matches" ON matches;
CREATE POLICY "Auth insert matches" ON matches FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Allow match participants to delete their own games
DROP POLICY IF EXISTS "Members delete matches" ON matches;
CREATE POLICY "Participants delete matches" ON matches FOR DELETE
  USING (
    auth.uid() IS NOT NULL AND (
      EXISTS (SELECT 1 FROM players p WHERE p.auth_uid = auth.uid()
              AND (p.id = ANY(home_player_ids) OR p.id = ANY(away_player_ids)))
      OR EXISTS (SELECT 1 FROM competitions c
                 JOIN players p ON is_society_admin(c.society_id)
                 WHERE c.id = competition_id AND p.auth_uid = auth.uid())
    )
  );

-- Allow members to update all match fields (not just holes_string)
DROP POLICY IF EXISTS "Members write match holes" ON matches;
CREATE POLICY "Members update matches" ON matches FOR UPDATE
  USING (auth.uid() IS NOT NULL);
