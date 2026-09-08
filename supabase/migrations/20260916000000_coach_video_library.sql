-- Coach video library (Dave, 2026-09-08) — a coach builds up a reusable set
-- of instruction videos once (e.g. "Standard Split Grip Drill demo") instead
-- of re-recording the same instruction video for every player they assign
-- the same drill to. Deliberately its own entity, not shoehorned into
-- coaching_videos: a library video has no relationship/submission/lesson/
-- drill parent at upload time (coaching_videos' "exactly one parent" rule
-- would reject it) — it's coach-owned content that gets attached to a drill
-- afterwards, for any player.
CREATE TABLE IF NOT EXISTS coach_video_library (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  area         TEXT CHECK (area IN ('driver', 'iron', 'short_game', 'putting', 'bunker', 'general')),
  storage_path TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coach_video_library_coach_idx ON coach_video_library(coach_id, created_at DESC);

ALTER TABLE coach_video_library ENABLE ROW LEVEL SECURITY;

-- Readable by the coach themselves and by any player with an active
-- relationship to that coach (so a player can watch the instruction video
-- attached to their own drill).
CREATE POLICY "coach_video_library_read" ON coach_video_library FOR SELECT USING (
  coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  OR coach_id IN (
    SELECT coach_id FROM coaching_relationships
    WHERE player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid()) AND status = 'active'
  )
);

CREATE POLICY "coach_video_library_owner_write" ON coach_video_library FOR INSERT WITH CHECK (
  coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

CREATE POLICY "coach_video_library_owner_delete" ON coach_video_library FOR DELETE USING (
  coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

-- A drill can optionally point at a reusable library video instead of (or
-- alongside) its free-text instructions.
ALTER TABLE coaching_drills ADD COLUMN IF NOT EXISTS library_video_id UUID REFERENCES coach_video_library(id) ON DELETE SET NULL;

-- Same coaching-videos bucket, `library/{coach_id}/{filename}` prefix —
-- scoped to the owning coach only (unlike the relationship-scoped prefixes,
-- since a library video isn't tied to one relationship). Read access for
-- players comes via the signed URL the app generates after checking the
-- coach_video_library row above, not via a storage SELECT policy here.
CREATE POLICY "coach_video_library_bucket_insert" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'coaching-videos'
  AND (storage.foldername(name))[1] = 'library'
  AND (storage.foldername(name))[2] = (SELECT id::text FROM players WHERE auth_uid = auth.uid())
);

CREATE POLICY "coach_video_library_bucket_read" ON storage.objects FOR SELECT USING (
  bucket_id = 'coaching-videos'
  AND (storage.foldername(name))[1] = 'library'
  AND (
    (storage.foldername(name))[2] = (SELECT id::text FROM players WHERE auth_uid = auth.uid())
    OR (storage.foldername(name))[2] IN (
      SELECT coach_id::text FROM coaching_relationships
      WHERE player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid()) AND status = 'active'
    )
  )
);
