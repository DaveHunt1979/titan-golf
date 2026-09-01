-- match_holes had two overlapping "any authenticated user" policy sets live
-- at once (one from an untracked fix_match_holes_rls.sql run, one from this
-- migration's own earlier version) — neither ties a write to the match
-- being scored, so any logged-in Titan user could insert/update/delete
-- another tournament's hole results. Rick's RLS report ("new row violates
-- row-level security...") turned out not to be a false rejection of a
-- legitimate scorer — the live policy already allowed any authenticated
-- user through. The actual trigger was a stale/anon client session at
-- submit time (see friendlyScoreError in score/enter/[matchId].tsx for the
-- user-facing side of that). This migration closes the real gap Rick's
-- brief called out: writes must be tied to match participation, not just
-- "is logged in". Reads are left untouched — only writes were ever the
-- concern, and narrowing reads risks breaking spectate for a case not
-- audited here.

DROP POLICY IF EXISTS "Members read holes"              ON match_holes;
DROP POLICY IF EXISTS "Players write own holes"          ON match_holes;
DROP POLICY IF EXISTS "Players update own holes"         ON match_holes;
DROP POLICY IF EXISTS "Match participants write holes"   ON match_holes;
DROP POLICY IF EXISTS "Match participants update holes"  ON match_holes;
DROP POLICY IF EXISTS "Match participants delete holes"  ON match_holes;
DROP POLICY IF EXISTS "Auth read holes"                  ON match_holes;
DROP POLICY IF EXISTS "Auth insert holes"                ON match_holes;
DROP POLICY IF EXISTS "Auth update holes"                ON match_holes;
DROP POLICY IF EXISTS "Auth delete holes"                ON match_holes;
DROP POLICY IF EXISTS "Authenticated read match holes"   ON match_holes;
DROP POLICY IF EXISTS "Authenticated write match holes"  ON match_holes;

-- Is the current user one of the players in this specific match? Covers
-- every format here (singles, 4BBB, team) since home_player_ids/
-- away_player_ids always lists the actual individual players on each side,
-- even for team matches (team name/color comes from home_team/away_team
-- separately).
CREATE OR REPLACE FUNCTION is_match_participant(mid UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM matches m
    JOIN players p ON p.auth_uid = auth.uid()
    WHERE m.id = mid
      AND (p.id = ANY(m.home_player_ids) OR p.id = ANY(m.away_player_ids))
  );
$$;

-- Authorised to score this match: a participant in it, or a society
-- admin/owner for the competition it belongs to (organisers can correct
-- scores Titan already lets them manage).
CREATE OR REPLACE FUNCTION is_match_scorer(mid UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT is_match_participant(mid) OR EXISTS (
    SELECT 1 FROM matches m
    JOIN competitions c ON c.id = m.competition_id
    WHERE m.id = mid AND is_society_admin(c.society_id)
  );
$$;

CREATE POLICY "Auth read holes" ON match_holes
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Match participants write holes" ON match_holes
  FOR INSERT WITH CHECK (is_match_scorer(match_id));

CREATE POLICY "Match participants update holes" ON match_holes
  FOR UPDATE USING (is_match_scorer(match_id));

CREATE POLICY "Match participants delete holes" ON match_holes
  FOR DELETE USING (is_match_scorer(match_id));
