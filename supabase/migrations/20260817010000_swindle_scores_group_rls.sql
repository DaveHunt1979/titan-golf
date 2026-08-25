-- swindle_scores' original INSERT/UPDATE policies only let a player write
-- their own score row (player_id must match auth.uid()'s player). That
-- silently blocked group scoring entirely — the whole point of one scorer
-- entering for their tee-time group is writing teammates' scores too.
-- match_holes hit the exact same problem (see fix_match_holes_rls.sql) and
-- was opened up to any authenticated user; applying the same fix here for
-- consistency. The app's own logic (group membership, one active player per
-- hole) is what actually governs correctness, same as it already does for
-- match_holes.
DROP POLICY IF EXISTS "swindle_scores_upsert" ON swindle_scores;
DROP POLICY IF EXISTS "swindle_scores_update" ON swindle_scores;
DROP POLICY IF EXISTS "Auth insert swindle_scores" ON swindle_scores;
DROP POLICY IF EXISTS "Auth update swindle_scores" ON swindle_scores;

CREATE POLICY "Auth insert swindle_scores" ON swindle_scores FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth update swindle_scores" ON swindle_scores FOR UPDATE
  USING (auth.uid() IS NOT NULL);
