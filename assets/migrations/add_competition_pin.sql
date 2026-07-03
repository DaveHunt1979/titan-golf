-- Add 4-digit PIN to competitions so players can unlock the Tour tab
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS pin TEXT;

-- Backfill any existing competitions with a random 4-digit PIN
UPDATE competitions
SET pin = LPAD((1000 + FLOOR(RANDOM() * 9000)::INT)::TEXT, 4, '0')
WHERE pin IS NULL;
