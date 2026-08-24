-- Info Pack complete redesign (Rick's brief, section 5, 2026-08-24). The old
-- freeform `info_sections` column (arbitrary hand-typed section blocks) is
-- superseded by a fixed, structured shape — see app/(app)/admin/info.tsx.
-- `info_sections` is left in place, unused, rather than dropped: zero risk,
-- and nothing currently reads/writes it once this ships.
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS info_pack JSONB NOT NULL DEFAULT '{}';
