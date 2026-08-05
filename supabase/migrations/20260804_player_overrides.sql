-- Per-round handicap + tee overrides set during group builder
ALTER TABLE matches ADD COLUMN IF NOT EXISTS player_overrides JSONB DEFAULT '{}';
