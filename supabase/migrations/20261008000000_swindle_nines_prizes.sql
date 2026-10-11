-- Swindle "Nines Prizes" side game: Front 9 / Back 9 / Overall Stableford
-- prizes carved out of each player's entry fee. Off by default, so every
-- existing Swindle behaves exactly as before. front/back/overall are £ per
-- player when mode = 'fixed', or % of the entry fee when mode = 'percent';
-- whatever is left of the entry fee stays in the main swindle pot.

ALTER TABLE swindle_games
  ADD COLUMN IF NOT EXISTS nines_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nines_mode    TEXT    NOT NULL DEFAULT 'fixed'
    CHECK (nines_mode IN ('fixed', 'percent')),
  ADD COLUMN IF NOT EXISTS nines_front   NUMERIC NOT NULL DEFAULT 0 CHECK (nines_front   >= 0),
  ADD COLUMN IF NOT EXISTS nines_back    NUMERIC NOT NULL DEFAULT 0 CHECK (nines_back    >= 0),
  ADD COLUMN IF NOT EXISTS nines_overall NUMERIC NOT NULL DEFAULT 0 CHECK (nines_overall >= 0);
