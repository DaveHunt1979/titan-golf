-- ── Skullers Scramble Day 2 is Captain-Picked Singles: each side's captain
-- submits a running order 1..N for their own roster, and the draw pairs Red
-- position N against Blue position N (Dave, 2026-09-14).
--
-- Stored as one nullable integer per enrolled player rather than a separate
-- orders table: the order IS a property of that player's enrolment in that
-- competition, it disappears with them if they're dropped from the draft, and
-- "has this captain submitted yet?" is derivable (every player on the side has
-- a non-null value) without a second row to keep in sync.
--
-- Additive and NULL for every existing row — no other format reads this
-- column, so nothing about an existing tournament changes.

ALTER TABLE competition_players ADD COLUMN IF NOT EXISTS singles_order INTEGER;

CREATE INDEX IF NOT EXISTS idx_competition_players_singles_order
  ON competition_players(competition_id, team_id, singles_order)
  WHERE singles_order IS NOT NULL;
