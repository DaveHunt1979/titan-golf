-- England master audit (2026-10-06) contains one genuine par-6 hole. course_holes
-- already allows 3-6 (20260826000000); course_tee_holes was left at 3-5.
ALTER TABLE course_tee_holes DROP CONSTRAINT IF EXISTS course_tee_holes_par_check;
ALTER TABLE course_tee_holes ADD CONSTRAINT course_tee_holes_par_check CHECK (par BETWEEN 3 AND 6);
