-- Prize money handling: collector-collects-all vs pay-each-other-directly,
-- plus a paid flag per entry so either method can be tracked in-app.
-- Tracking only — the app never moves money itself.

ALTER TABLE swindle_games
  ADD COLUMN IF NOT EXISTS prize_money_method TEXT NOT NULL DEFAULT 'collector'
    CHECK (prize_money_method IN ('collector', 'direct')),
  ADD COLUMN IF NOT EXISTS collector_player_id UUID REFERENCES players(id);

ALTER TABLE swindle_entries
  ADD COLUMN IF NOT EXISTS paid    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- swindle_entries never had an UPDATE policy — matches the match_holes RLS
-- trap already hit once in this codebase. Loose auth.uid() check, same
-- pattern already used for swindle_scores_update, so a collector marking
-- someone else's entry paid isn't silently blocked.
CREATE POLICY "swindle_entries_update" ON swindle_entries FOR UPDATE USING (
  auth.uid() IS NOT NULL
);
