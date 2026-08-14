-- "Up & Coming" home section: society-scoped trip information (name, dates,
-- location, flights, cost). Visible to every member of the society, but
-- per spec only the society OWNER may create/edit/delete it — admins are
-- view-only here, unlike the usual admin+owner "is_society_admin" write
-- convention used elsewhere in this schema.
CREATE TABLE IF NOT EXISTS society_trips (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id       UUID NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  start_date       DATE,
  end_date         DATE,
  location         TEXT,
  airport          TEXT,
  outbound_flight  TEXT,
  return_flight    TEXT,
  total_cost       TEXT,
  created_by       UUID REFERENCES players(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS society_trips_society_idx ON society_trips(society_id);

ALTER TABLE society_trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read trips" ON society_trips
  FOR SELECT USING (is_society_member(society_id));

CREATE OR REPLACE FUNCTION is_society_owner(sid UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM society_members sm
    JOIN players p ON p.id = sm.player_id
    WHERE sm.society_id = sid
      AND p.auth_uid = auth.uid()
      AND sm.role = 'owner'
  );
$$;

CREATE POLICY "Owner manages trips" ON society_trips
  FOR ALL USING (is_society_owner(society_id));
