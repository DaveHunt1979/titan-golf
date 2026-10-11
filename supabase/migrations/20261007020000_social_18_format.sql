-- Social 18 format (Dave, 2026-10-07): the host says up front whether it's a
-- Singles day or a Team event. Additive; existing rows default to singles.
ALTER TABLE social_events ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'singles'
  CHECK (format IN ('singles', 'team'));
