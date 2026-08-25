-- Some clubs run a two-tee start — a tee-time group can begin on the front
-- or the back nine. Decided once, at group creation, same as casual's
-- start_hole on matches.
ALTER TABLE swindle_groups
  ADD COLUMN IF NOT EXISTS start_hole INTEGER NOT NULL DEFAULT 1 CHECK (start_hole IN (1, 10));
