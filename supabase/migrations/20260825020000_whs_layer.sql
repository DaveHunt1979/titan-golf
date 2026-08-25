-- WHS (World Handicap System) layer — additive only. Existing scoring is
-- untouched: whs_enabled defaults to FALSE everywhere, and round_player_tees
-- is a brand-new table nothing else reads yet.
--
-- round_player_tees holds two things per (round, player):
--  1. Which tee they're playing (needed regardless of WHS on/off, so the
--     scorecard/yardages can reflect a mixed-tee group).
--  2. The frozen WHS snapshot taken the moment the round starts — later
--     changes to a player's profile handicap or the day's course data must
--     never retroactively alter a historic round's stroke allocation.

ALTER TABLE competition_days ADD COLUMN IF NOT EXISTS whs_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE swindle_games    ADD COLUMN IF NOT EXISTS whs_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS round_player_tees (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id                    UUID REFERENCES competition_days(id) ON DELETE CASCADE,
  swindle_game_id           UUID REFERENCES swindle_games(id) ON DELETE CASCADE,
  player_id                 UUID NOT NULL REFERENCES players(id),
  tee_name                  TEXT,
  gender                    TEXT CHECK (gender IN ('M','F','')),
  handicap_index_at_start   NUMERIC(4,1),
  slope_at_start            INTEGER,
  course_rating_at_start    NUMERIC(4,1),
  par_at_start              INTEGER,
  course_handicap_at_start  NUMERIC(6,2),
  allowance_at_start        INTEGER,        -- percentage, e.g. 95 — matches playerCourseHcp's convention
  playing_handicap_at_start INTEGER,
  whs_enabled_at_start      BOOLEAN,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((day_id IS NOT NULL) <> (swindle_game_id IS NOT NULL)),
  UNIQUE (day_id, player_id),
  UNIQUE (swindle_game_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_round_player_tees_day ON round_player_tees(day_id);
CREATE INDEX IF NOT EXISTS idx_round_player_tees_game ON round_player_tees(swindle_game_id);

ALTER TABLE round_player_tees ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'round_player_tees' AND policyname = 'Auth manage round player tees') THEN
    CREATE POLICY "Auth manage round player tees" ON round_player_tees FOR ALL USING (auth.uid() IS NOT NULL);
  END IF;
END $$;
