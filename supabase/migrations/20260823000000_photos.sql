-- Camera photos taken from inside an active game, permanently tagged with
-- the tournament/round/match/player/course/hole context Titan already knew
-- at capture time (Rick's brief, 2026-08-22, Section 6). player_name and
-- course_name are snapshotted as text (not just resolved via the FKs) so
-- the frame's info stays correct even after the competition/match rows are
-- gone or renamed — same "snapshot the facts, don't recompute later"
-- approach as titan_news.input_snapshot.
CREATE TABLE IF NOT EXISTS photos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       UUID REFERENCES players(id) ON DELETE SET NULL,
  competition_id  UUID REFERENCES competitions(id) ON DELETE SET NULL,
  day_id          UUID REFERENCES competition_days(id) ON DELETE SET NULL,
  match_id        UUID REFERENCES matches(id) ON DELETE SET NULL,
  player_name     TEXT,
  course_name     TEXT,
  hole_number     INTEGER,
  storage_path    TEXT NOT NULL,
  taken_at        TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players read their own photos" ON photos
  FOR SELECT USING (
    player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  );

CREATE POLICY "Players insert their own photos" ON photos
  FOR INSERT WITH CHECK (
    player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  );

CREATE POLICY "Players delete their own photos" ON photos
  FOR DELETE USING (
    player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  );

-- Storage bucket for the actual image bytes — same pattern as the avatars
-- bucket (supabase/add_avatars_bucket.sql), but private and path-scoped by
-- player id (`{playerId}/{filename}.jpg`, see app/(app)/camera/index.tsx's
-- persistPhotoRecord) since these are personal shots, not public assets.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('photos', 'photos', false, 10485760, ARRAY['image/jpeg'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Players upload their own photo files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'photos'
    AND (storage.foldername(name))[1] = (SELECT id::text FROM players WHERE auth_uid = auth.uid())
  );

CREATE POLICY "Players read their own photo files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'photos'
    AND (storage.foldername(name))[1] = (SELECT id::text FROM players WHERE auth_uid = auth.uid())
  );

CREATE POLICY "Players delete their own photo files" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'photos'
    AND (storage.foldername(name))[1] = (SELECT id::text FROM players WHERE auth_uid = auth.uid())
  );
