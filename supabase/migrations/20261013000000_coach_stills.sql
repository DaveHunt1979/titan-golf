-- Titan Coach: stills (screenshots) saved from a paused swing frame.
-- Stored as coach_video_library rows with media_type = 'image' (same
-- coaching-videos bucket, same library/{coach_id}/ prefix, same RLS), and
-- annotated through coaching_analyses.library_video_id exactly like a model
-- swing video. Additive only: every existing row stays a video.

ALTER TABLE coach_video_library
  ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'video'
    CHECK (media_type IN ('video', 'image'));
