-- Tournament Engine Phase 5 — captain-pairing + singles-sweep bonus config.

ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS opening_rounds INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS bonus_points   NUMERIC(5,2) NOT NULL DEFAULT 2;
