-- Optional Longest Drive / Nearest the Pin side games per tournament day —
-- same simple enable+pick-a-hole idea as Casual Round (games/new.tsx), not
-- Swindle's fee-tracking version. Per-day (not per-competition) since each
-- day can be a different course with different par-3s/par-5s.
ALTER TABLE competition_days
  ADD COLUMN IF NOT EXISTS ld_hole  INTEGER,
  ADD COLUMN IF NOT EXISTS ntp_hole INTEGER;
