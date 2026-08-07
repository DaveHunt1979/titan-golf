-- 4BBB Stroke Matchplay: lets a match opt into the traditional "lowest
-- handicap plays off scratch, others relative to that" stroke allocation
-- instead of each player's own %-cut handicap independently. Tournament days
-- select this via day_format ('four_bbb_stroke'); admin/draw.tsx derives the
-- value below when it generates each day's matches.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS handicap_method TEXT NOT NULL DEFAULT 'individual';
