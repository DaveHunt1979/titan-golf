-- Recurring weekly swindle support
ALTER TABLE swindle_games
  ADD COLUMN IF NOT EXISTS is_recurring       boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurring_day      text,      -- 'saturday' | 'sunday' | 'friday' etc
  ADD COLUMN IF NOT EXISTS closes_at_time     time DEFAULT '08:30:00';
