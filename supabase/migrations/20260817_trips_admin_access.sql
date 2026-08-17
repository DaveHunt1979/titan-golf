-- Up & Coming trips were deliberately owner-only in 20260814_society_trips.sql.
-- Dave's call on 08-17: bring it in line with the usual admin+owner
-- "is_society_admin" write convention used everywhere else in this schema,
-- since the owner-only restriction meant a society's admins (e.g. Rick)
-- couldn't add trips at all.
DROP POLICY IF EXISTS "Owner manages trips" ON society_trips;

CREATE POLICY "Admins manage trips" ON society_trips
  FOR ALL USING (is_society_admin(society_id));
