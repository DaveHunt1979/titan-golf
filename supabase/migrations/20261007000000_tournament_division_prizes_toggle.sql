-- Tournament Builder "Division prizes" toggle (Rick/Dave, 2026-10-07). A
-- singles event may pay one overall winner and nothing else, but Go Live
-- required handicap-division Prize Categories regardless. Default true keeps
-- the existing requirement for every tournament already built; only one that
-- explicitly flips this off skips the division setup and just needs the
-- overall winner's prize (competitions.kronos_overall_prize).
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS division_prizes_enabled BOOLEAN NOT NULL DEFAULT true;
