-- Titan Season Mode — data model (Dave's spec, screenshots/Titan_Season_Mode_
-- Full_Product_Technical_Specification.md, §18). Purely additive: eight new
-- season_* tables, nothing existing touched, nothing existing reads these
-- yet. Adapted from the spec's generic course_id/layout_id/tee_id to this
-- app's actual course reference shape (course_name + course_tees keyed by
-- tee_name/gender — there's no separate "layout" concept here), and scoped
-- per-society (society_id) since every other competition type in this app
-- (competitions, swindle_games) is society-scoped and Season is no different.
--
-- RLS follows the same simple "any authenticated user" policy every other
-- table in this app uses (see round_player_tees in 20260825020000_whs_layer.sql)
-- rather than inventing a stricter model for just this feature.

-- ── Season ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seasons (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id                  UUID NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  name                        TEXT NOT NULL,
  season_year                 INTEGER NOT NULL,
  timezone                    TEXT NOT NULL DEFAULT 'Europe/London',
  registration_open_at        TIMESTAMPTZ,
  registration_close_at       TIMESTAMPTZ,
  start_at                    TIMESTAMPTZ,
  end_at                      TIMESTAMPTZ,
  verification_grace_minutes  INTEGER NOT NULL DEFAULT 2880, -- 48 hours, spec §3.2
  minimum_qualifying_rounds   INTEGER NOT NULL DEFAULT 20,
  counting_round_limit        INTEGER NOT NULL DEFAULT 20,
  min_group_size              INTEGER NOT NULL DEFAULT 2,
  handicap_allowance_percent  INTEGER NOT NULL DEFAULT 100,
  -- Versioned per spec §9.4/§21.2 — once a Season starts, this is locked and
  -- never mutated; a scoring-rule change creates a new profile for future
  -- Seasons instead. Default matches spec Appendix A exactly.
  scoring_profile             JSONB NOT NULL DEFAULT '{
    "format": "stableford",
    "handicap_allowance_percent": 100,
    "performance_bonus": {"31_or_less":0,"32":2,"33":4,"34":6,"35":8,"36":10,"37":12,"38":14,"39":16,"40":18,"41_plus":20},
    "gross_bonus": {"birdie":5,"eagle":10,"albatross_or_better":20,"hole_in_one_extra":10},
    "round_floor": 0,
    "major_multiplier": 1.5
  }'::jsonb,
  join_pin                    TEXT, -- 6-digit, regenerable per Season (spec §4.1)
  join_requires_approval      BOOLEAN NOT NULL DEFAULT TRUE,
  status                      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','registration_open','registration_closed','divisions_preview',
    'published','active','verification_grace','finalising','locked','archived'
  )),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at                   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_seasons_society ON seasons(society_id);

-- ── Division ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS season_divisions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id             UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  display_order         INTEGER NOT NULL,
  target_player_count   INTEGER NOT NULL DEFAULT 20,
  promotion_places      INTEGER NOT NULL DEFAULT 3,
  relegation_places     INTEGER NOT NULL DEFAULT 3,
  status                TEXT NOT NULL DEFAULT 'draft',
  UNIQUE (season_id, display_order)
);

CREATE INDEX IF NOT EXISTS idx_season_divisions_season ON season_divisions(season_id);

-- ── Season Entry — one player's participation record in one Season ────────
CREATE TABLE IF NOT EXISTS season_entries (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id                 UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  division_id               UUID REFERENCES season_divisions(id) ON DELETE SET NULL, -- NULL until division build
  player_id                 UUID NOT NULL REFERENCES players(id),
  entry_handicap_index      NUMERIC(4,1), -- snapshot at approval, spec §4.1/§5.2 — never recalculated after the fact
  join_status               TEXT NOT NULL DEFAULT 'pending_approval' CHECK (join_status IN (
    'pending_approval','approved','declined','waitlisted','next_season'
  )),
  qualification_status      TEXT NOT NULL DEFAULT 'provisional' CHECK (qualification_status IN (
    'provisional','qualified','dnq'
  )),
  qualifying_rounds_count   INTEGER NOT NULL DEFAULT 0,
  counting_rounds_count     INTEGER NOT NULL DEFAULT 0,
  season_points              NUMERIC NOT NULL DEFAULT 0,
  current_position          INTEGER,
  previous_position          INTEGER,
  movement_status            TEXT, -- safe / promotion / relegation / champion, computed by the Leaderboard Service
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (season_id, player_id) -- "a player cannot create duplicate Season entries", spec §4.3
);

CREATE INDEX IF NOT EXISTS idx_season_entries_season   ON season_entries(season_id);
CREATE INDEX IF NOT EXISTS idx_season_entries_division ON season_entries(division_id);
CREATE INDEX IF NOT EXISTS idx_season_entries_player   ON season_entries(player_id);

-- ── Join Request — the PIN-entry request itself, before admin approval ────
CREATE TABLE IF NOT EXISTS season_join_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  player_id     UUID NOT NULL REFERENCES players(id),
  status        TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN (
    'pending_approval','approved','declined','waitlisted'
  )),
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at    TIMESTAMPTZ,
  decided_by    UUID REFERENCES players(id),
  UNIQUE (season_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_season_join_requests_season ON season_join_requests(season_id);

-- ── Major — four configured Season windows with a multiplier ──────────────
CREATE TABLE IF NOT EXISTS season_majors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  sequence      INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 4),
  name          TEXT NOT NULL,
  start_at      TIMESTAMPTZ NOT NULL,
  end_at        TIMESTAMPTZ NOT NULL,
  multiplier    NUMERIC(3,2) NOT NULL DEFAULT 1.5,
  status        TEXT NOT NULL DEFAULT 'scheduled',
  description   TEXT,
  image_ref     TEXT,
  UNIQUE (season_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_season_majors_season ON season_majors(season_id);

-- ── Round — one Season Stableford round, gross scores live in
--    season_hole_scores below ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS season_rounds (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id                     UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  season_entry_id               UUID NOT NULL REFERENCES season_entries(id) ON DELETE CASCADE,
  major_id                      UUID REFERENCES season_majors(id) ON DELETE SET NULL,
  course_name                   TEXT NOT NULL,
  tee_name                      TEXT,
  tee_gender                    TEXT CHECK (tee_gender IN ('M','F','')),
  group_player_ids              UUID[] NOT NULL DEFAULT '{}', -- other players in the group — 2-ball minimum, spec §7.2
  played_at                     TIMESTAMPTZ,
  submitted_at                  TIMESTAMPTZ,
  verified_at                   TIMESTAMPTZ,
  -- Frozen handicap snapshot — a later change to the player's live handicap
  -- must never retroactively alter a historic round, same rule as
  -- round_player_tees for casual/tournament rounds (whs.ts).
  handicap_index_snapshot       NUMERIC(4,1),
  course_rating_snapshot        NUMERIC(4,1),
  slope_snapshot                INTEGER,
  par_snapshot                  INTEGER,
  handicap_allowance_percent    INTEGER,
  playing_handicap_snapshot     INTEGER,
  stableford_total               INTEGER,
  performance_bonus              INTEGER,
  gross_achievement_bonus        INTEGER,
  base_titan_round_points        INTEGER,
  major_multiplier                NUMERIC(3,2),
  final_round_points              INTEGER,
  status                         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','started','submitted','awaiting_verification','verified',
    'scored','disputed','rejected','void','locked'
  )),
  is_qualifying                  BOOLEAN NOT NULL DEFAULT FALSE,
  is_counting                    BOOLEAN NOT NULL DEFAULT FALSE,
  score_version                  INTEGER NOT NULL DEFAULT 1, -- bumped on any post-verification edit, invalidates verification (spec §12.2)
  scoring_rules_version           TEXT, -- snapshot tag of the season's scoring_profile used for this round
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_season_rounds_season  ON season_rounds(season_id);
CREATE INDEX IF NOT EXISTS idx_season_rounds_entry   ON season_rounds(season_entry_id);
CREATE INDEX IF NOT EXISTS idx_season_rounds_major   ON season_rounds(major_id);
CREATE INDEX IF NOT EXISTS idx_season_rounds_counting ON season_rounds(season_entry_id, is_counting) WHERE is_counting;

-- ── Hole Score ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS season_hole_scores (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id                    UUID NOT NULL REFERENCES season_rounds(id) ON DELETE CASCADE,
  hole_number                 INTEGER NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  par                         INTEGER NOT NULL,
  stroke_index                INTEGER NOT NULL,
  gross_score                 INTEGER,
  handicap_strokes_received   INTEGER,
  net_score                   INTEGER,
  net_relative_to_par         INTEGER,
  stableford_points           INTEGER,
  gross_relative_to_par       INTEGER,
  gross_achievement_type      TEXT CHECK (gross_achievement_type IN (
    'hole_in_one','albatross_or_better','eagle','birdie','par','bogey','double_or_worse'
  )),
  gross_bonus_points           INTEGER NOT NULL DEFAULT 0,
  UNIQUE (round_id, hole_number)
);

CREATE INDEX IF NOT EXISTS idx_season_hole_scores_round ON season_hole_scores(round_id);

-- ── Verification — partner sign-off per round ──────────────────────────────
CREATE TABLE IF NOT EXISTS season_verifications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id               UUID NOT NULL REFERENCES season_rounds(id) ON DELETE CASCADE,
  verifier_player_id     UUID NOT NULL REFERENCES players(id),
  score_version           INTEGER NOT NULL, -- must match season_rounds.score_version at time of verification (spec §12.2)
  status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','disputed')),
  verified_at             TIMESTAMPTZ,
  dispute_reason          TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_season_verifications_round ON season_verifications(round_id);

-- ── RLS — same "any authenticated user" policy every other table here uses ─
ALTER TABLE seasons               ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_divisions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_entries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_join_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_majors         ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_rounds         ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_hole_scores    ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_verifications  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'seasons' AND policyname = 'Auth manage seasons') THEN
    CREATE POLICY "Auth manage seasons" ON seasons FOR ALL USING (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'season_divisions' AND policyname = 'Auth manage season divisions') THEN
    CREATE POLICY "Auth manage season divisions" ON season_divisions FOR ALL USING (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'season_entries' AND policyname = 'Auth manage season entries') THEN
    CREATE POLICY "Auth manage season entries" ON season_entries FOR ALL USING (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'season_join_requests' AND policyname = 'Auth manage season join requests') THEN
    CREATE POLICY "Auth manage season join requests" ON season_join_requests FOR ALL USING (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'season_majors' AND policyname = 'Auth manage season majors') THEN
    CREATE POLICY "Auth manage season majors" ON season_majors FOR ALL USING (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'season_rounds' AND policyname = 'Auth manage season rounds') THEN
    CREATE POLICY "Auth manage season rounds" ON season_rounds FOR ALL USING (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'season_hole_scores' AND policyname = 'Auth manage season hole scores') THEN
    CREATE POLICY "Auth manage season hole scores" ON season_hole_scores FOR ALL USING (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'season_verifications' AND policyname = 'Auth manage season verifications') THEN
    CREATE POLICY "Auth manage season verifications" ON season_verifications FOR ALL USING (auth.uid() IS NOT NULL);
  END IF;
END $$;
