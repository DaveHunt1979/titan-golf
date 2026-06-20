-- ============================================================
-- Extended player profile fields
-- Run in Supabase SQL Editor
-- ============================================================

ALTER TABLE players ADD COLUMN IF NOT EXISTS nickname    TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS bag         JSONB DEFAULT '{}';
ALTER TABLE players ADD COLUMN IF NOT EXISTS cdh_number  TEXT;
