-- Titan Coach: video analysis (drawn lines/angles/circles over a swing) and a
-- richer video library (description + "model swing" flag).
--
-- Drawings are stored as data (normalised 0..1 coordinates against the video
-- frame), not baked into a video, so they replay over the original at any
-- screen size — iPad editing, phone viewing. Additive only: nothing existing
-- changes.

ALTER TABLE coach_video_library
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS is_model    BOOLEAN NOT NULL DEFAULT false;

-- A coach can now edit their own library entries (name/description/model flag).
DROP POLICY IF EXISTS "coach_video_library_owner_update" ON coach_video_library;
CREATE POLICY "coach_video_library_owner_update" ON coach_video_library FOR UPDATE USING (
  coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

CREATE TABLE IF NOT EXISTS coaching_analyses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id          UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player_id         UUID REFERENCES players(id) ON DELETE CASCADE,   -- null for a library (model swing) analysis
  coaching_video_id UUID REFERENCES coaching_videos(id) ON DELETE CASCADE,
  library_video_id  UUID REFERENCES coach_video_library(id) ON DELETE CASCADE,
  video_aspect      NUMERIC,                                         -- width/height the drawings were made against
  annotations       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coaching_analyses_exactly_one_video CHECK (
    (coaching_video_id IS NOT NULL)::int + (library_video_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT coaching_analyses_one_per_video UNIQUE (coaching_video_id),
  CONSTRAINT coaching_analyses_one_per_library_video UNIQUE (library_video_id)
);

CREATE INDEX IF NOT EXISTS coaching_analyses_coach_idx  ON coaching_analyses(coach_id);
CREATE INDEX IF NOT EXISTS coaching_analyses_player_idx ON coaching_analyses(player_id);

ALTER TABLE coaching_analyses ENABLE ROW LEVEL SECURITY;

-- The coach who made it, and the player it is about, can read it.
CREATE POLICY "coaching_analyses_read" ON coaching_analyses FOR SELECT USING (
  coach_id  IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  OR player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

-- Only the coach writes, and only against a video they actually coach /
-- own in their library.
CREATE POLICY "coaching_analyses_coach_insert" ON coaching_analyses FOR INSERT WITH CHECK (
  coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  AND (
    coaching_video_id IS NULL
    OR EXISTS (SELECT 1 FROM coaching_videos v WHERE v.id = coaching_video_id AND v.coach_id = coaching_analyses.coach_id)
  )
  AND (
    library_video_id IS NULL
    OR EXISTS (SELECT 1 FROM coach_video_library l WHERE l.id = library_video_id AND l.coach_id = coaching_analyses.coach_id)
  )
);

CREATE POLICY "coaching_analyses_coach_update" ON coaching_analyses FOR UPDATE USING (
  coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

CREATE POLICY "coaching_analyses_coach_delete" ON coaching_analyses FOR DELETE USING (
  coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);
