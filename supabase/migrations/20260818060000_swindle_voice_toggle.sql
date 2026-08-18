-- Chip/Birdie voice was unconditionally on for every Swindle round (solo
-- and group), with no way to mute it — unlike casual rounds' opt-in
-- 'voice:on' side game. Default true here preserves today's behaviour;
-- players/groups can now switch it off.
ALTER TABLE swindle_entries ADD COLUMN IF NOT EXISTS voice_on BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE swindle_groups  ADD COLUMN IF NOT EXISTS voice_on BOOLEAN NOT NULL DEFAULT true;
