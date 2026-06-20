-- Fix match_holes RLS — allow any authenticated user to read/write
-- (suitable for a small closed-group app)

-- Drop all existing match_holes policies
DROP POLICY IF EXISTS "Members read holes"              ON match_holes;
DROP POLICY IF EXISTS "Players write own holes"         ON match_holes;
DROP POLICY IF EXISTS "Players update own holes"        ON match_holes;
DROP POLICY IF EXISTS "Match participants write holes"  ON match_holes;
DROP POLICY IF EXISTS "Match participants update holes" ON match_holes;
DROP POLICY IF EXISTS "Match participants delete holes" ON match_holes;

-- Replace with simple authenticated-user policies
CREATE POLICY "Auth read holes"   ON match_holes FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth insert holes" ON match_holes FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth update holes" ON match_holes FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth delete holes" ON match_holes FOR DELETE USING (auth.uid() IS NOT NULL);
