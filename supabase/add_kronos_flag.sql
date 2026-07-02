-- Add include_in_kronos flag to competitions
-- Allows Rick to explicitly mark which tournaments count toward the Kronos Trophy.
-- Default false so existing/casual competitions are unaffected.

ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS include_in_kronos BOOLEAN NOT NULL DEFAULT FALSE;
