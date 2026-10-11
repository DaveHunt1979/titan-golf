-- Swindle AI report: one auto-published report per completed Swindle,
-- covering the main swindle and, when switched on, the Nines Prizes side game.
-- Tied to its game via swindle_game_id and read through that game's society,
-- so it can never appear in another society's feed. Additive: existing
-- tournament / casual / season stories are untouched.

ALTER TABLE titan_news
  ADD COLUMN IF NOT EXISTS swindle_game_id UUID REFERENCES swindle_games(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_titan_news_swindle ON titan_news(swindle_game_id);

ALTER TABLE titan_news DROP CONSTRAINT IF EXISTS titan_news_subject_check;
ALTER TABLE titan_news ADD CONSTRAINT titan_news_subject_check
  CHECK (competition_id IS NOT NULL OR match_id IS NOT NULL OR season_id IS NOT NULL OR swindle_game_id IS NOT NULL);

ALTER TABLE titan_news DROP CONSTRAINT IF EXISTS titan_news_story_type_check;
ALTER TABLE titan_news ADD CONSTRAINT titan_news_story_type_check
  CHECK (story_type IN (
    'preview', 'round_report', 'final_report', 'casual_final',
    'season_divisions_published', 'season_finished', 'season_summary',
    'swindle_final'
  ));

DROP POLICY IF EXISTS "Members read published titan_news" ON titan_news;
CREATE POLICY "Members read published titan_news" ON titan_news FOR SELECT
  USING (
    status = 'published' AND (
      (match_id IS NOT NULL AND auth.uid() IS NOT NULL)
      OR EXISTS (SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_member(c.society_id))
      OR EXISTS (SELECT 1 FROM seasons se WHERE se.id = season_id AND is_society_member(se.society_id))
      OR EXISTS (SELECT 1 FROM swindle_games sg WHERE sg.id = swindle_game_id AND is_society_member(sg.society_id))
    )
  );

DROP POLICY IF EXISTS "Admins read all titan_news" ON titan_news;
CREATE POLICY "Admins read all titan_news" ON titan_news FOR SELECT
  USING (
    (match_id IS NOT NULL AND auth.uid() IS NOT NULL)
    OR EXISTS (SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_admin(c.society_id))
    OR EXISTS (SELECT 1 FROM seasons se WHERE se.id = season_id AND is_society_admin(se.society_id))
    OR EXISTS (SELECT 1 FROM swindle_games sg WHERE sg.id = swindle_game_id AND is_society_admin(sg.society_id))
  );
