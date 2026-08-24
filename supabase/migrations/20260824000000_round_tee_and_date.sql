-- Round Setup needs a Tee + Tee Time field per round (Rick's brief, 2026-08-22,
-- section 4.5/4.10). This is a simple reference field, not a full per-tee
-- course-rating system — course_rating/slope_rating stay single values per
-- round. Revisit if tee-specific ratings are ever needed.
ALTER TABLE competition_days
  ADD COLUMN IF NOT EXISTS tee_name TEXT,
  ADD COLUMN IF NOT EXISTS tee_time TIME;
