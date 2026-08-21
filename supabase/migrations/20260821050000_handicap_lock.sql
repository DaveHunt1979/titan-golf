-- Titan Way's "Final Tournament Handicaps can be locked" checkpoint —
-- an explicit, admin-visible marker that handicaps are final before
-- splitting into divisions (Dave, 2026-08-21). Nothing else in the app
-- mutates competition_players.handicap_index after enrollment today, so
-- this is informational/checkpoint-only, not an enforcement mechanism.
ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS handicaps_locked_at TIMESTAMPTZ;
