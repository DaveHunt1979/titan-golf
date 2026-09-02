-- Swindle moves from each player picking their own tee to one Tee Box the
-- game creator sets for everyone (Dave, 2026-09-02 — same model tournament
-- already uses: "whatever Rick sets up, that is what it is"). slope_rating/
-- course_rating already exist on swindle_games; tee identity itself didn't.
ALTER TABLE swindle_games ADD COLUMN IF NOT EXISTS tee_name   TEXT;
ALTER TABLE swindle_games ADD COLUMN IF NOT EXISTS tee_gender TEXT;
ALTER TABLE swindle_games ADD COLUMN IF NOT EXISTS tee_par    INTEGER;
