-- All existing policies on competition_days and matches check competition_id,
-- which is now NULL for casual standalone rounds. Update every policy to
-- allow access when competition_id IS NULL (any authed user) OR when the
-- existing society-membership check passes (tournament rows).

-- ── competition_days ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Members read days"  ON competition_days;
DROP POLICY IF EXISTS "Admins manage days" ON competition_days;

CREATE POLICY "Read days" ON competition_days FOR SELECT
  USING (
    (competition_id IS NULL AND auth.uid() IS NOT NULL)
    OR EXISTS (SELECT 1 FROM competitions c
               WHERE c.id = competition_id AND is_society_member(c.society_id))
  );

CREATE POLICY "Manage days" ON competition_days FOR ALL
  USING (
    (competition_id IS NULL AND auth.uid() IS NOT NULL)
    OR EXISTS (SELECT 1 FROM competitions c
               WHERE c.id = competition_id AND is_society_admin(c.society_id))
  );

-- ── matches ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Members read matches"  ON matches;
DROP POLICY IF EXISTS "Members write match holes" ON matches;
DROP POLICY IF EXISTS "Members update matches" ON matches;
DROP POLICY IF EXISTS "Admins manage matches" ON matches;

CREATE POLICY "Read matches" ON matches FOR SELECT
  USING (
    (competition_id IS NULL AND auth.uid() IS NOT NULL)
    OR EXISTS (SELECT 1 FROM competitions c
               WHERE c.id = competition_id AND is_society_member(c.society_id))
  );

CREATE POLICY "Update matches" ON matches FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Manage matches" ON matches FOR ALL
  USING (
    (competition_id IS NULL AND auth.uid() IS NOT NULL)
    OR EXISTS (SELECT 1 FROM competitions c
               WHERE c.id = competition_id AND is_society_admin(c.society_id))
  );
