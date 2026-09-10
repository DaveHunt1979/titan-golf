-- Titan News reporters rebrand: Davey McFadey and Rick Driver (Dave,
-- 2026-09-10). The news screen's byline has said "Titan News Reporters
-- Davey McFadey and Rick Driver" since it launched, but the banter itself
-- was still generated in Chip & Birdie's voice underneath — this brings the
-- two in line. Chip & Birdie stay exclusively on the live Caddie voice and
-- Chip & Birdie Coaching (ai_coaching_reports keeps its own separate
-- 'chip'/'birdie' CHECK, untouched) — Dave wants both duos, not a
-- replacement ("I want them all").
--
-- Extends rather than replaces the CHECK so existing published articles
-- with banter_speaker 'chip'/'birdie' keep rendering exactly as before —
-- only new reports going forward are generated as mcfadey/driver (see
-- supabase/functions/titan-news). Constraint name is looked up dynamically
-- since the original (20260821020000) added it as an inline, unnamed CHECK.
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'titan_news'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%banter_speaker%'
  LOOP
    EXECUTE format('ALTER TABLE titan_news DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

ALTER TABLE titan_news ADD CONSTRAINT titan_news_banter_speaker_check
  CHECK (banter_speaker IN ('chip', 'birdie', 'mcfadey', 'driver'));
