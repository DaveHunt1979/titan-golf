-- Automatic Tournament Handicap Cutting System (Rick's brief, 2026-08-25) —
-- Tournament Mode only, per-tournament opt-in, default OFF. Strong
-- Stableford rounds progressively cut a player's TOURNAMENT-ONLY handicap
-- for later rounds; this never touches players.handicap_index (permanent
-- WHS) or competition_players.handicap_index (the existing enrollment
-- snapshot, left untouched as the feature-off fallback value — see
-- src/lib/tournamentHandicap.ts).
--
-- Distinct from the existing competitions.handicaps_locked_at
-- (20260821050000_handicap_lock.sql) — that one is a manual,
-- informational-only admin checkpoint for prize-division splitting.
-- handicap_cuts_config_locked_at below is automatic (set the instant
-- finishDraft() goes live) and actually gates the Builder UI.

ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS handicap_cuts_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS handicap_cut_trigger_score   INTEGER NOT NULL DEFAULT 36,
  ADD COLUMN IF NOT EXISTS handicap_cut_minimum         NUMERIC(4,1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS handicap_cut_bands           JSONB NOT NULL DEFAULT
    '[{"min":0,"max":9.9,"cutPerPoint":0.5},
      {"min":10,"max":18.9,"cutPerPoint":1.0},
      {"min":19,"max":28.9,"cutPerPoint":2.0},
      {"min":29,"max":null,"cutPerPoint":2.0}]',
  ADD COLUMN IF NOT EXISTS handicap_cuts_config_locked_at TIMESTAMPTZ;

ALTER TABLE competition_players
  ADD COLUMN IF NOT EXISTS starting_tournament_handicap NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS current_tournament_handicap  NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS total_tournament_cut          NUMERIC(4,1) NOT NULL DEFAULT 0;

-- Append-only ledger, one row per (round, player) cut calculation. A
-- correction doesn't delete/overwrite a row — it soft-supersedes it and
-- inserts a new revision, so the required full audit history is a real
-- table scan, never reconstructed. The partial unique index below is both
-- the idempotency guard (a second concurrent INSERT for the same
-- day+player fails the constraint and is caught/ignored — see
-- processDayCuts()) and what makes corrections safe.
CREATE TABLE IF NOT EXISTS tournament_handicap_history (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id        UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  competition_day_id    UUID NOT NULL REFERENCES competition_days(id) ON DELETE CASCADE,
  player_id             UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  day_number            INTEGER NOT NULL,
  stableford_pts        INTEGER NOT NULL,
  trigger_score         INTEGER NOT NULL,
  handicap_before_cut   NUMERIC(4,1) NOT NULL,
  points_over_trigger   INTEGER NOT NULL,
  cut_per_point         NUMERIC(4,2) NOT NULL,
  cut_applied           NUMERIC(4,1) NOT NULL,
  handicap_after_cut    NUMERIC(4,1) NOT NULL,
  revision              INTEGER NOT NULL DEFAULT 1,
  superseded_at         TIMESTAMPTZ,
  superseded_reason     TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tournament_handicap_history_active_uq
  ON tournament_handicap_history (competition_day_id, player_id)
  WHERE superseded_at IS NULL;

ALTER TABLE tournament_handicap_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read tournament_handicap_history" ON tournament_handicap_history FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_member(c.society_id)
  ));
CREATE POLICY "Admins manage tournament_handicap_history" ON tournament_handicap_history FOR ALL
  USING (EXISTS (
    SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_admin(c.society_id)
  ));
