-- Casual (non-tournament) rounds set matches.competition_id = NULL, and the
-- matches table policy deliberately opens read/write to any authenticated
-- user for that case ("Update matches"/"Manage matches" in
-- 20260705010000_casual_rls.sql). match_holes never got that same casual
-- fallback: is_match_scorer() only allows a listed home/away participant,
-- or a society admin looked up via the match's competition_id — which is
-- always NULL for a casual round, so that branch can never match. Anyone in
-- the group who isn't literally listed on that specific match (e.g.
-- entering a score for someone else in the group) gets silently rejected
-- by RLS (Ricky's "wouldn't accept a score for Kenny" report, 2026-09-07).

CREATE OR REPLACE FUNCTION is_match_scorer(mid UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM matches m
    WHERE m.id = mid AND m.competition_id IS NULL AND auth.uid() IS NOT NULL
  )
  OR is_match_participant(mid)
  OR EXISTS (
    SELECT 1 FROM matches m
    JOIN competitions c ON c.id = m.competition_id
    WHERE m.id = mid AND is_society_admin(c.society_id)
  );
$$;
