-- Custom group/team display names set in GroupBuilderSheet (e.g. "2 from 4" pairings)
ALTER TABLE matches ADD COLUMN IF NOT EXISTS home_name TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS away_name TEXT;

-- Secondary stableford/medal side-game run alongside the primary matchplay format
ALTER TABLE matches ADD COLUMN IF NOT EXISTS secondary_format TEXT;
