-- T-Tag System, Phase 2: private per-user Player Library.
--
-- "MY PLAYER LIBRARY IS PRIVATE TO ME" (spec) — the owner-scoped RLS policy
-- below is the entire enforcement of that rule. Nobody but the owner can
-- read, insert into, or delete from their own library rows — not even the
-- player referenced by member_player_id.
--
-- Two SECURITY DEFINER RPCs are required (not optional) because `players`
-- itself only has a self-read RLS policy ("Players read own"): without
-- bypassing that, a lookup-by-tag could never see another player's row, and
-- the library list's join to `players` would silently return nulls for
-- every real (non-guest) entry.

CREATE TABLE IF NOT EXISTS player_library (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_player_id   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  member_player_id  UUID REFERENCES players(id) ON DELETE CASCADE,
  is_guest          BOOLEAN NOT NULL DEFAULT false,
  guest_name        TEXT,
  guest_handicap    NUMERIC(4,1),
  guest_home_club   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT player_library_shape CHECK (
    (is_guest = false AND member_player_id IS NOT NULL AND guest_name IS NULL)
    OR
    (is_guest = true  AND member_player_id IS NULL     AND guest_name IS NOT NULL)
  ),
  CONSTRAINT player_library_not_self CHECK (member_player_id IS NULL OR member_player_id <> owner_player_id),
  CONSTRAINT player_library_unique_member UNIQUE (owner_player_id, member_player_id)
);

CREATE INDEX IF NOT EXISTS player_library_owner_idx ON player_library(owner_player_id);

ALTER TABLE player_library ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'player_library' AND policyname = 'Library owner full access'
  ) THEN
    CREATE POLICY "Library owner full access" ON player_library
      FOR ALL
      USING     (owner_player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid()))
      WITH CHECK (owner_player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid()));
  END IF;
END $$;

-- Public-safe lookup by T-Tag — only the columns the spec's "basic profile"
-- preview needs (name, avatar, handicap, tag). Never email/auth_uid/cdh/bag.
CREATE OR REPLACE FUNCTION find_player_by_ttag(p_tag TEXT)
RETURNS TABLE (id UUID, display_name TEXT, avatar_url TEXT, handicap_index NUMERIC, t_tag TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.id, p.display_name, p.avatar_url, p.handicap_index, p.t_tag
  FROM players p
  WHERE p.t_tag = upper(regexp_replace(trim(p_tag), '^@', ''));
$$;

-- The caller's own library, enriched with each real member's public profile
-- fields (falling back to the guest_* columns for guest rows).
CREATE OR REPLACE FUNCTION get_my_player_library()
RETURNS TABLE (
  library_id       UUID,
  member_player_id UUID,
  is_guest         BOOLEAN,
  display_name     TEXT,
  avatar_url       TEXT,
  handicap_index   NUMERIC,
  t_tag            TEXT,
  home_club        TEXT,
  created_at       TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    pl.id,
    pl.member_player_id,
    pl.is_guest,
    COALESCE(p.display_name, pl.guest_name),
    p.avatar_url,
    COALESCE(p.handicap_index, pl.guest_handicap),
    p.t_tag,
    pl.guest_home_club,
    pl.created_at
  FROM player_library pl
  LEFT JOIN players p ON p.id = pl.member_player_id
  WHERE pl.owner_player_id = (SELECT id FROM players WHERE auth_uid = auth.uid())
  ORDER BY COALESCE(p.display_name, pl.guest_name);
$$;
