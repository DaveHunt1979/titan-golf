-- Swindle side pots: format, two's competition, nearest the pin, longest drive
ALTER TABLE swindle_games
  ADD COLUMN IF NOT EXISTS format         text             DEFAULT 'stableford',
  ADD COLUMN IF NOT EXISTS twos_enabled   boolean          DEFAULT false,
  ADD COLUMN IF NOT EXISTS twos_fee       numeric(10,2)    DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ntp_hole       integer,
  ADD COLUMN IF NOT EXISTS ntp_fee        numeric(10,2)    DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ntp_winner_id  uuid,
  ADD COLUMN IF NOT EXISTS ld_hole        integer,
  ADD COLUMN IF NOT EXISTS ld_fee         numeric(10,2)    DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ld_winner_id   uuid;
