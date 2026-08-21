-- match_holes and hole_stats had no INSERT policy, so RLS blocked score
-- writes mid-round (e.g. Rick's hole-13 error). Any authenticated user can
-- read and write both tables; the app enforces player-level constraints.

DROP POLICY IF EXISTS "Members write match holes"       ON match_holes;
DROP POLICY IF EXISTS "Authenticated read match holes"  ON match_holes;
DROP POLICY IF EXISTS "Authenticated write match holes" ON match_holes;

CREATE POLICY "Authenticated read match holes" ON match_holes
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated write match holes" ON match_holes
  FOR ALL
  USING    (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated read hole stats"  ON hole_stats;
DROP POLICY IF EXISTS "Authenticated write hole stats" ON hole_stats;

CREATE POLICY "Authenticated read hole stats" ON hole_stats
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated write hole stats" ON hole_stats
  FOR ALL
  USING    (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
