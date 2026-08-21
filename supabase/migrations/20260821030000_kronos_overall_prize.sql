-- Kronos overall-winner prize — a single amount separate from the
-- per-division prize_categories/prize_payouts, since the Kronos champion
-- isn't tied to a handicap division (Dave, 2026-08-21).
ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS kronos_overall_prize NUMERIC;
