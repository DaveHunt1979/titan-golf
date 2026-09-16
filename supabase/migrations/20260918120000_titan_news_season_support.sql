-- Fix: Season Mode news has been silently broken since season_id was added
-- (20260907000000_titan_season_news.sql) — that migration added the column
-- but never widened titan_news_subject_check (still required competition_id
-- OR match_id) or titan_news_story_type_check (still only 'preview',
-- 'round_report', 'final_report', 'casual_final'). Every
-- publishDivisionsPublishedStory/publishSeasonFinishedStory call since
-- 2026-09-06 has been failing its INSERT silently (fire-and-forget catch in
-- seasonNews.ts + the edge function's own try/catch swallow it). Matches
-- the "Season news found broken (DB constraint gap)... deferred" note from
-- 2026-09-11. Fixed now as a prerequisite for the new season_summary story
-- type (Dave, 2026-09-16 — season recap news).

ALTER TABLE titan_news DROP CONSTRAINT IF EXISTS titan_news_subject_check;
ALTER TABLE titan_news ADD CONSTRAINT titan_news_subject_check
  CHECK (competition_id IS NOT NULL OR match_id IS NOT NULL OR season_id IS NOT NULL);

ALTER TABLE titan_news DROP CONSTRAINT IF EXISTS titan_news_story_type_check;
ALTER TABLE titan_news ADD CONSTRAINT titan_news_story_type_check
  CHECK (story_type IN (
    'preview', 'round_report', 'final_report', 'casual_final',
    'season_divisions_published', 'season_finished', 'season_summary'
  ));

DROP POLICY IF EXISTS "Members read published titan_news" ON titan_news;
CREATE POLICY "Members read published titan_news" ON titan_news FOR SELECT
  USING (
    status = 'published' AND (
      (match_id IS NOT NULL AND auth.uid() IS NOT NULL)
      OR EXISTS (SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_member(c.society_id))
      OR EXISTS (SELECT 1 FROM seasons se WHERE se.id = season_id AND is_society_member(se.society_id))
    )
  );

DROP POLICY IF EXISTS "Admins read all titan_news" ON titan_news;
CREATE POLICY "Admins read all titan_news" ON titan_news FOR SELECT
  USING (
    (match_id IS NOT NULL AND auth.uid() IS NOT NULL)
    OR EXISTS (SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_admin(c.society_id))
    OR EXISTS (SELECT 1 FROM seasons se WHERE se.id = season_id AND is_society_admin(se.society_id))
  );
