-- Add front/back/tee pin columns to course_holes for the rangefinder screen
ALTER TABLE course_holes
  ADD COLUMN IF NOT EXISTS front_lat  double precision,
  ADD COLUMN IF NOT EXISTS front_lng  double precision,
  ADD COLUMN IF NOT EXISTS back_lat   double precision,
  ADD COLUMN IF NOT EXISTS back_lng   double precision,
  ADD COLUMN IF NOT EXISTS tee_lat    double precision,
  ADD COLUMN IF NOT EXISTS tee_lng    double precision;
