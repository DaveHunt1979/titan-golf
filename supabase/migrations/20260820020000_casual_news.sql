-- Casual Golf – Final Match Report (Dave, 2026-08-20, TODO item 5): extends
-- the existing Titan News AI infra (20260818070000_titan_news.sql) to cover
-- a single completed casual round, not just tournaments. Casual Golf only
-- ever needs one report per match, generated once it completes — no
-- preview/round_report/admin-review workflow, unlike tournaments.
--
-- Casual matches have no competition_id (see 20260705_casual_rounds_standalone.sql
-- and 20260705_casual_rls.sql) — reusing the same "competition_id IS NULL means
-- any authed user" RLS convention those migrations already established for
-- competition_days/matches, applied here via the new match_id column instead.

ALTER TABLE titan_news ALTER COLUMN competition_id DROP NOT NULL;
ALTER TABLE titan_news ADD COLUMN IF NOT EXISTS match_id UUID REFERENCES matches(id) ON DELETE CASCADE;

ALTER TABLE titan_news DROP CONSTRAINT IF EXISTS titan_news_subject_check;
ALTER TABLE titan_news ADD CONSTRAINT titan_news_subject_check
  CHECK (competition_id IS NOT NULL OR match_id IS NOT NULL);

ALTER TABLE titan_news DROP CONSTRAINT IF EXISTS titan_news_story_type_check;
ALTER TABLE titan_news ADD CONSTRAINT titan_news_story_type_check
  CHECK (story_type IN ('preview', 'round_report', 'final_report', 'casual_final'));

DROP POLICY IF EXISTS "Members read published titan_news" ON titan_news;
CREATE POLICY "Members read published titan_news" ON titan_news FOR SELECT
  USING (
    status = 'published' AND (
      (match_id IS NOT NULL AND auth.uid() IS NOT NULL)
      OR EXISTS (SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_member(c.society_id))
    )
  );

DROP POLICY IF EXISTS "Admins read all titan_news" ON titan_news;
CREATE POLICY "Admins read all titan_news" ON titan_news FOR SELECT
  USING (
    (match_id IS NOT NULL AND auth.uid() IS NOT NULL)
    OR EXISTS (SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_admin(c.society_id))
  );

-- Admin UPDATE policy (publish/unpublish) is tournament-only by design —
-- casual reports auto-publish from the edge function (service role, bypasses
-- RLS) the moment they're generated, no review step, so it's left untouched.
