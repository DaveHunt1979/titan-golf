-- ── God / Admin / Player permission tiers ──────────────────────────────────
-- Proposed 2026-09-04, deferred ("not ready to build, revisit next week"),
-- now triggered by onboarding the first genuinely external society (Dave,
-- 2026-09-09): "I don't want anyone touching stuff that me and rick can
-- control." Until now there was no platform-level tier at all —
-- society_members.role was only ever 'member'/'admin'/'owner', scoped to one
-- society, and shared/global resources (the courses database) were writable
-- by ANY signed-in user regardless of which society they belonged to.
--
-- This migration adds the "God" tier: a small, explicit flag on `players`
-- (not scoped to any society, since these two people control shared
-- platform data across every society) and locks the courses database down
-- to it. Society creation is deliberately left open per the earlier explicit
-- decision — not bundled into this change.

ALTER TABLE players ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- Dave and Rick each have more than one real login (a main account plus a
-- dedicated single-society test account) — grant to all four so "God" status
-- follows the person, not just whichever login happens to be active.
UPDATE players SET is_platform_admin = true
WHERE auth_uid IN (
  'eac54d88-8837-4a86-aed0-a250bc99d4f3', -- Dave Hunt (main)
  '40000000-0000-0000-0000-000000000003', -- Dave (Mashie test account)
  'a7d27c8f-a51d-4623-95ec-c8b5543a636a', -- Ricky Snell (main)
  'b486164c-7035-48fc-9926-f416f036428a'  -- Rick (Mashie test account)
);

CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM players WHERE auth_uid = auth.uid() AND is_platform_admin = true
  );
$$;

-- ── Lock the shared courses database to platform admins only ──────────────
-- SELECT stays open for everyone — every round/tournament screen needs to
-- read courses regardless of tier. Only writes are restricted.

DROP POLICY IF EXISTS "Auth insert courses" ON courses;
DROP POLICY IF EXISTS "Auth update courses" ON courses;
CREATE POLICY "Platform admin insert courses" ON courses FOR INSERT WITH CHECK (is_platform_admin());
CREATE POLICY "Platform admin update courses" ON courses FOR UPDATE USING (is_platform_admin());
-- No DELETE policy existed before either — courses has none now, matching that.

DROP POLICY IF EXISTS "Auth insert course holes" ON course_holes;
DROP POLICY IF EXISTS "Auth update course holes" ON course_holes;
DROP POLICY IF EXISTS "Auth delete course holes" ON course_holes;
CREATE POLICY "Platform admin insert course holes" ON course_holes FOR INSERT WITH CHECK (is_platform_admin());
CREATE POLICY "Platform admin update course holes" ON course_holes FOR UPDATE USING (is_platform_admin());
CREATE POLICY "Platform admin delete course holes" ON course_holes FOR DELETE USING (is_platform_admin());

-- ── Request a Course — society admins can no longer edit the shared course
-- database directly, so they get a lightweight request queue instead, with
-- a Gods-only inbox to review/fulfill/decline. ──────────────────────────────
CREATE TABLE IF NOT EXISTS course_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id    UUID NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  requested_by  UUID NOT NULL REFERENCES players(id),
  course_name   TEXT NOT NULL,
  club_location TEXT,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'fulfilled', 'declined')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ
);

ALTER TABLE course_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society admin insert course request" ON course_requests
  FOR INSERT WITH CHECK (is_society_admin(society_id));

CREATE POLICY "Requester or platform admin read course requests" ON course_requests
  FOR SELECT USING (
    is_platform_admin()
    OR requested_by IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  );

CREATE POLICY "Platform admin update course requests" ON course_requests
  FOR UPDATE USING (is_platform_admin());
