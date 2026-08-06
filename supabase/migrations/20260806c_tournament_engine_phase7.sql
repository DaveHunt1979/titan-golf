-- Tournament Engine Phase 7 — remaining setup wizard fields.

ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS logo_url     TEXT,
  ADD COLUMN IF NOT EXISTS description  TEXT,
  ADD COLUMN IF NOT EXISTS start_date   DATE,
  ADD COLUMN IF NOT EXISTS end_date     DATE,
  ADD COLUMN IF NOT EXISTS max_handicap NUMERIC(4,1);
