-- Locker Room Coaching AI rebrand: Chip & Birdie retired in favour of Davey
-- McFadey and Rick Driver everywhere (Dave, 2026-09-11 — "swapping the guys
-- over"), reversing the 2026-09-10 split that kept this table on its own
-- 'chip'/'birdie' CHECK (see 20260918060000_titan_news_mcfadey_driver.sql).
--
-- Extends rather than replaces the CHECK so existing saved reports with
-- banter_speaker 'chip'/'birdie' keep rendering exactly as before — only new
-- reports going forward are generated as mcfadey/driver (see
-- supabase/functions/coaching-report). Constraint name is looked up
-- dynamically since the original (20260918050000) added it as an inline,
-- unnamed CHECK.
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'ai_coaching_reports'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%banter_speaker%'
  LOOP
    EXECUTE format('ALTER TABLE ai_coaching_reports DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

ALTER TABLE ai_coaching_reports ADD CONSTRAINT ai_coaching_reports_banter_speaker_check
  CHECK (banter_speaker IN ('chip', 'birdie', 'mcfadey', 'driver'));
