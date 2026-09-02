-- Titan Season Mode — round sourcing (Dave, 2026-09-06). Season rounds are
-- never entered separately: any qualifying casual round, Titan Tour
-- tournament round, or Swindle round a Season entrant plays with another
-- real app player counts automatically. These two nullable, mutually
-- exclusive FKs trace a season_round back to the real round it was pulled
-- from, and the two partial unique indexes make ingestion idempotent — the
-- same match/swindle group can never be ingested twice for the same entry,
-- so a lazy "sync on view" ingestion job can safely re-run.

ALTER TABLE season_rounds ADD COLUMN IF NOT EXISTS source_match_id         UUID REFERENCES matches(id) ON DELETE CASCADE;
ALTER TABLE season_rounds ADD COLUMN IF NOT EXISTS source_swindle_group_id UUID REFERENCES swindle_groups(id) ON DELETE CASCADE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'season_rounds_source_exclusive') THEN
    ALTER TABLE season_rounds ADD CONSTRAINT season_rounds_source_exclusive
      CHECK (source_match_id IS NULL OR source_swindle_group_id IS NULL);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_season_rounds_entry_match
  ON season_rounds(season_entry_id, source_match_id) WHERE source_match_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_season_rounds_entry_swindle_group
  ON season_rounds(season_entry_id, source_swindle_group_id) WHERE source_swindle_group_id IS NOT NULL;
