-- T-Tag System, Phase 1: unique player handle.
-- Auto-generated from display_name on every insert (society signup, PIN
-- join, and admin-added players all insert into `players` already — a
-- BEFORE INSERT trigger covers all three without touching those RPCs).
--
-- generate_t_tag() must be SECURITY DEFINER: `players` RLS is strict
-- self-read-only ("Players read own"), so an invoker-rights uniqueness
-- check would never see any other player's tag and could hand out
-- duplicates.

ALTER TABLE players ADD COLUMN IF NOT EXISTS t_tag TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'players_t_tag_unique'
  ) THEN
    ALTER TABLE players ADD CONSTRAINT players_t_tag_unique UNIQUE (t_tag);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION generate_t_tag(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base      TEXT;
  v_candidate TEXT;
  v_suffix    INT;
BEGIN
  v_base := upper(regexp_replace(coalesce(p_name, 'PLAYER'), '[^a-zA-Z0-9]', '', 'g'));
  IF v_base = '' THEN v_base := 'PLAYER'; END IF;
  v_base := left(v_base, 20);

  IF NOT EXISTS (SELECT 1 FROM players WHERE t_tag = v_base) THEN
    RETURN v_base;
  END IF;

  -- Collision: short numeric suffixes first (matches the spec's
  -- @RICKYSNELL7 example), then a 4-digit random suffix as a fallback
  -- that's essentially guaranteed unique so this always terminates.
  FOR v_suffix IN 2..99 LOOP
    v_candidate := v_base || v_suffix::TEXT;
    IF NOT EXISTS (SELECT 1 FROM players WHERE t_tag = v_candidate) THEN
      RETURN v_candidate;
    END IF;
  END LOOP;

  LOOP
    v_candidate := v_base || (floor(random() * 9000) + 1000)::INT::TEXT;
    IF NOT EXISTS (SELECT 1 FROM players WHERE t_tag = v_candidate) THEN
      RETURN v_candidate;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION set_t_tag_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.t_tag IS NULL THEN
    NEW.t_tag := generate_t_tag(NEW.display_name);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS players_set_t_tag ON players;
CREATE TRIGGER players_set_t_tag
  BEFORE INSERT ON players
  FOR EACH ROW
  EXECUTE FUNCTION set_t_tag_on_insert();

-- Backfill existing players one row at a time (not a single bulk UPDATE) so
-- each generate_t_tag() call can see the tags just assigned earlier in this
-- same loop — otherwise two players sharing a name could both pass the
-- uniqueness check against the same pre-loop snapshot and collide.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id, display_name FROM players WHERE t_tag IS NULL LOOP
    UPDATE players SET t_tag = generate_t_tag(r.display_name) WHERE id = r.id;
  END LOOP;
END;
$$;
