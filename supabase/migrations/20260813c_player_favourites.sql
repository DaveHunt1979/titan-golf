-- Favourites: lightweight per-user starring, independent of player_library.
-- Deliberately its own table rather than a column on player_library —
-- starring a society member for quick-pick purposes during game creation
-- must not force them into the user's private cross-society Player
-- Library (two different concepts: "who I keep track of" vs "who I want
-- pinned to the top of a picker right now").

CREATE TABLE IF NOT EXISTS player_favourites (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  favourite_player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT player_favourites_not_self CHECK (favourite_player_id <> owner_player_id),
  CONSTRAINT player_favourites_unique   UNIQUE (owner_player_id, favourite_player_id)
);

CREATE INDEX IF NOT EXISTS player_favourites_owner_idx ON player_favourites(owner_player_id);

ALTER TABLE player_favourites ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'player_favourites' AND policyname = 'Favourites owner full access'
  ) THEN
    CREATE POLICY "Favourites owner full access" ON player_favourites
      FOR ALL
      USING     (owner_player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid()))
      WITH CHECK (owner_player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid()));
  END IF;
END $$;
