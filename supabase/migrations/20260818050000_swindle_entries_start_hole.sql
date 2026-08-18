-- Solo swindle rounds never tracked a start hole (only tee-time groups did,
-- via swindle_groups.start_hole added 2026-08-17), so Chip/Birdie's voice
-- checkpoints assumed every solo player started on hole 1. Two-tee starts
-- broke that assumption and fired every pressure checkpoint back-to-back.
ALTER TABLE swindle_entries ADD COLUMN IF NOT EXISTS start_hole INTEGER NOT NULL DEFAULT 1;
