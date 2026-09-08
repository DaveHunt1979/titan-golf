-- Titan Coach — Phase 1 database foundation (Ricky Snell/ARC UK brief,
-- screenshots/Titan Coach.docx, 2026-08-18 — read in full 2026-09-08 before
-- writing this). Entirely new, separate module: read-only against the
-- existing golf engine (scoring/handicap/WHS/tournament tables are never
-- referenced by a foreign key here, only by player_id joins the app does
-- itself), per the brief's repeated "must never touch the golf engine" rule.
--
-- Every coaching table below carries denormalized player_id/coach_id (and
-- often relationship_id) columns rather than requiring multi-hop joins for
-- RLS — same reasoning as photos.player_id or titan_news.input_snapshot
-- elsewhere in this schema: cheap at write time, keeps every policy a
-- single-table check.
--
-- Relationship lifecycle (request/accept/remove) goes through the RPCs at
-- the bottom rather than raw client UPDATEs, so a party can never edit a
-- field on the relationship they shouldn't be able to touch.

-- ── Coach profiles ───────────────────────────────────────────────────────
-- One per player who has enabled coaching (Section 34). Readable by any
-- signed-in player (same visibility level as the rest of the player
-- directory already has in this app) since a player must be able to see
-- their coach's bio/qualifications, and eventually browse Find a Coach
-- (Phase 2/3) — none of this is sensitive data, unlike the private notes
-- table further down.
CREATE TABLE IF NOT EXISTS coach_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id             UUID NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  bio                   TEXT,
  qualifications        TEXT,
  club_location         TEXT,
  online_coaching       BOOLEAN NOT NULL DEFAULT false,
  in_person_coaching    BOOLEAN NOT NULL DEFAULT false,
  specialisms           TEXT[] NOT NULL DEFAULT '{}',
  contact_preferences   TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE coach_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coach_profiles_read_all" ON coach_profiles FOR SELECT USING (true);

CREATE POLICY "coach_profiles_owner_write" ON coach_profiles FOR INSERT WITH CHECK (
  player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

CREATE POLICY "coach_profiles_owner_update" ON coach_profiles FOR UPDATE USING (
  player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

-- ── Coaching relationships ───────────────────────────────────────────────
-- Section 4 (connect via T-Tag/invite, coach must accept) + Section 31
-- (player can remove at any time; history is retained, not deleted) +
-- Section 32 (schema allows multiple coaches per player in future — no
-- uniqueness constraint on player_id alone; Phase 1's "one primary coach"
-- rule is enforced by request_coach_connection below refusing a second
-- pending/active request, not by a DB constraint that would need loosening
-- later).
CREATE TABLE IF NOT EXISTS coaching_relationships (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  coach_id      UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'removed')),
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at   TIMESTAMPTZ,
  removed_at    TIMESTAMPTZ,
  CONSTRAINT coaching_relationships_not_self CHECK (player_id <> coach_id)
);

CREATE INDEX IF NOT EXISTS coaching_relationships_player_idx ON coaching_relationships(player_id, status);
CREATE INDEX IF NOT EXISTS coaching_relationships_coach_idx  ON coaching_relationships(coach_id, status);

ALTER TABLE coaching_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaching_relationships_participants_read" ON coaching_relationships FOR SELECT USING (
  player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  OR coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

-- No client-side INSERT/UPDATE policy — every state transition goes through
-- the SECURITY DEFINER RPCs below, which enforce who can do what.

-- ── Swing submissions ─────────────────────────────────────────────────────
-- Section 6-10: a player's swing sent for review.
CREATE TABLE IF NOT EXISTS coaching_submissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id   UUID NOT NULL REFERENCES coaching_relationships(id) ON DELETE CASCADE,
  player_id         UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  coach_id          UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  shot_type         TEXT NOT NULL CHECK (shot_type IN ('driver', 'fairway_wood', 'hybrid', 'iron', 'wedge', 'pitch', 'chip', 'bunker', 'putting', 'other')),
  camera_angle      TEXT CHECK (camera_angle IN ('down_the_line', 'face_on', 'both')),
  player_note       TEXT,
  player_note_audio_path TEXT,
  status            TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'awaiting_review', 'reviewing', 'feedback_ready', 'completed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coaching_submissions_player_idx ON coaching_submissions(player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coaching_submissions_coach_idx  ON coaching_submissions(coach_id, status);

ALTER TABLE coaching_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaching_submissions_participants_read" ON coaching_submissions FOR SELECT USING (
  player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  OR coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

CREATE POLICY "coaching_submissions_player_insert" ON coaching_submissions FOR INSERT WITH CHECK (
  player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

-- Coach advances status (awaiting_review → reviewing → feedback_ready/completed).
CREATE POLICY "coaching_submissions_coach_update" ON coaching_submissions FOR UPDATE USING (
  coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

-- ── Drills ────────────────────────────────────────────────────────────────
-- Section 20-21.
CREATE TABLE IF NOT EXISTS coaching_drills (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id UUID NOT NULL REFERENCES coaching_relationships(id) ON DELETE CASCADE,
  player_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  coach_id        UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  lesson_id       UUID, -- FK added below, after coaching_lessons exists
  name            TEXT NOT NULL,
  area            TEXT CHECK (area IN ('driver', 'iron', 'short_game', 'putting', 'bunker', 'general')),
  purpose         TEXT,
  instructions    TEXT,
  repetitions     INTEGER,
  frequency       TEXT,
  review_date     DATE,
  status          TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'progress_sent', 'completed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coaching_drills_player_idx ON coaching_drills(player_id, status);
CREATE INDEX IF NOT EXISTS coaching_drills_coach_idx  ON coaching_drills(coach_id, status);

ALTER TABLE coaching_drills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaching_drills_participants_read" ON coaching_drills FOR SELECT USING (
  player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  OR coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

CREATE POLICY "coaching_drills_coach_insert" ON coaching_drills FOR INSERT WITH CHECK (
  coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

-- Player advances status as they work the drill (not_started → in_progress
-- → progress_sent); coach can mark completed after reviewing progress.
CREATE POLICY "coaching_drills_participants_update" ON coaching_drills FOR UPDATE USING (
  player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  OR coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

-- ── Lessons ───────────────────────────────────────────────────────────────
-- Section 19: the permanent record created when a coach sends feedback on a
-- submission. Never edited after creation (no UPDATE policy) — "must not
-- disappear when the conversation continues".
CREATE TABLE IF NOT EXISTS coaching_lessons (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id         UUID NOT NULL REFERENCES coaching_relationships(id) ON DELETE CASCADE,
  submission_id           UUID REFERENCES coaching_submissions(id) ON DELETE SET NULL,
  player_id               UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  coach_id                UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  shot_type               TEXT CHECK (shot_type IN ('driver', 'fairway_wood', 'hybrid', 'iron', 'wedge', 'pitch', 'chip', 'bunker', 'putting', 'other')),
  coach_feedback_text     TEXT,
  coach_feedback_audio_path TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coaching_lessons_player_idx ON coaching_lessons(player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coaching_lessons_coach_idx  ON coaching_lessons(coach_id, created_at DESC);

ALTER TABLE coaching_lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaching_lessons_participants_read" ON coaching_lessons FOR SELECT USING (
  player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  OR coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

CREATE POLICY "coaching_lessons_coach_insert" ON coaching_lessons FOR INSERT WITH CHECK (
  coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

ALTER TABLE coaching_drills ADD CONSTRAINT coaching_drills_lesson_fkey
  FOREIGN KEY (lesson_id) REFERENCES coaching_lessons(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS coaching_drills_lesson_idx ON coaching_drills(lesson_id);

-- ── Drill progress ────────────────────────────────────────────────────────
-- Section 22-23: a drill can receive many progress submissions over time.
CREATE TABLE IF NOT EXISTS drill_progress (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drill_id                UUID NOT NULL REFERENCES coaching_drills(id) ON DELETE CASCADE,
  relationship_id         UUID NOT NULL REFERENCES coaching_relationships(id) ON DELETE CASCADE,
  player_id               UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  coach_id                UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player_note             TEXT,
  coach_status            TEXT CHECK (coach_status IN ('improving', 'continue', 'needs_adjustment', 'completed')),
  coach_feedback_text     TEXT,
  coach_feedback_audio_path TEXT,
  reviewed_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drill_progress_drill_idx ON drill_progress(drill_id, created_at DESC);
CREATE INDEX IF NOT EXISTS drill_progress_coach_idx ON drill_progress(coach_id, reviewed_at);

ALTER TABLE drill_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drill_progress_participants_read" ON drill_progress FOR SELECT USING (
  player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  OR coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

CREATE POLICY "drill_progress_player_insert" ON drill_progress FOR INSERT WITH CHECK (
  player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

CREATE POLICY "drill_progress_coach_update" ON drill_progress FOR UPDATE USING (
  coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

-- ── Videos ────────────────────────────────────────────────────────────────
-- Section 37: every video in the system (swing submission, coach feedback,
-- drill instruction, progress) is one row here rather than a column on its
-- parent, because a single submission can carry two videos (down-the-line +
-- face-on) — genuinely one-to-many, not one-to-one.
CREATE TABLE IF NOT EXISTS coaching_videos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id   UUID NOT NULL REFERENCES coaching_relationships(id) ON DELETE CASCADE,
  uploader_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player_id         UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  coach_id          UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  submission_id     UUID REFERENCES coaching_submissions(id) ON DELETE CASCADE,
  lesson_id         UUID REFERENCES coaching_lessons(id) ON DELETE CASCADE,
  drill_id          UUID REFERENCES coaching_drills(id) ON DELETE CASCADE,
  drill_progress_id UUID REFERENCES drill_progress(id) ON DELETE CASCADE,
  video_type        TEXT NOT NULL CHECK (video_type IN ('swing_submission', 'coach_feedback', 'drill_instruction', 'progress')),
  camera_angle      TEXT CHECK (camera_angle IN ('down_the_line', 'face_on')),
  shot_type         TEXT CHECK (shot_type IN ('driver', 'fairway_wood', 'hybrid', 'iron', 'wedge', 'pitch', 'chip', 'bunker', 'putting', 'other')),
  storage_path      TEXT NOT NULL,
  duration_seconds  NUMERIC,
  processing_status TEXT NOT NULL DEFAULT 'ready' CHECK (processing_status IN ('uploading', 'processing', 'ready', 'failed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coaching_videos_exactly_one_parent CHECK (
    (submission_id IS NOT NULL)::int + (lesson_id IS NOT NULL)::int
    + (drill_id IS NOT NULL)::int + (drill_progress_id IS NOT NULL)::int = 1
  )
);

CREATE INDEX IF NOT EXISTS coaching_videos_submission_idx ON coaching_videos(submission_id);
CREATE INDEX IF NOT EXISTS coaching_videos_lesson_idx     ON coaching_videos(lesson_id);
CREATE INDEX IF NOT EXISTS coaching_videos_drill_idx      ON coaching_videos(drill_id);
CREATE INDEX IF NOT EXISTS coaching_videos_progress_idx   ON coaching_videos(drill_progress_id);

ALTER TABLE coaching_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaching_videos_participants_read" ON coaching_videos FOR SELECT USING (
  player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  OR coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

CREATE POLICY "coaching_videos_participants_insert" ON coaching_videos FOR INSERT WITH CHECK (
  uploader_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  AND (
    player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
    OR coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  )
);

-- ── Video annotations ─────────────────────────────────────────────────────
-- Section 15: drawing tools, attached to a frame/time on a specific video.
-- shape_data is client-defined (points, colour, stroke width) — the shape
-- vocabulary (line/angle/circle/arrow/freehand) is the only thing enforced
-- server-side; rendering detail stays flexible for the drawing UI to evolve.
CREATE TABLE IF NOT EXISTS coaching_video_annotations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id      UUID NOT NULL REFERENCES coaching_videos(id) ON DELETE CASCADE,
  created_by    UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  timestamp_ms  INTEGER NOT NULL DEFAULT 0,
  shape_type    TEXT NOT NULL CHECK (shape_type IN ('line', 'angle', 'circle', 'arrow', 'freehand')),
  shape_data    JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coaching_video_annotations_video_idx ON coaching_video_annotations(video_id, timestamp_ms);

ALTER TABLE coaching_video_annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaching_video_annotations_participants_read" ON coaching_video_annotations FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM coaching_videos v
    WHERE v.id = coaching_video_annotations.video_id
    AND (
      v.player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
      OR v.coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
    )
  )
);

CREATE POLICY "coaching_video_annotations_author_write" ON coaching_video_annotations FOR INSERT WITH CHECK (
  created_by IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

CREATE POLICY "coaching_video_annotations_author_update" ON coaching_video_annotations FOR UPDATE USING (
  created_by IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

CREATE POLICY "coaching_video_annotations_author_delete" ON coaching_video_annotations FOR DELETE USING (
  created_by IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

-- ── Messages ──────────────────────────────────────────────────────────────
-- Section 25-26: private player/coach messaging, optionally tagged with
-- which submission/drill/lesson/progress item it's about. At most one
-- context reference per message (a message is about one thing or nothing).
CREATE TABLE IF NOT EXISTS coaching_messages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id       UUID NOT NULL REFERENCES coaching_relationships(id) ON DELETE CASCADE,
  sender_id             UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  content               TEXT,
  audio_path            TEXT,
  image_path            TEXT,
  video_path            TEXT,
  context_submission_id UUID REFERENCES coaching_submissions(id) ON DELETE SET NULL,
  context_drill_id      UUID REFERENCES coaching_drills(id) ON DELETE SET NULL,
  context_lesson_id     UUID REFERENCES coaching_lessons(id) ON DELETE SET NULL,
  context_progress_id   UUID REFERENCES drill_progress(id) ON DELETE SET NULL,
  read_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coaching_messages_has_content CHECK (
    content IS NOT NULL OR audio_path IS NOT NULL OR image_path IS NOT NULL OR video_path IS NOT NULL
  ),
  CONSTRAINT coaching_messages_at_most_one_context CHECK (
    (context_submission_id IS NOT NULL)::int + (context_drill_id IS NOT NULL)::int
    + (context_lesson_id IS NOT NULL)::int + (context_progress_id IS NOT NULL)::int <= 1
  )
);

CREATE INDEX IF NOT EXISTS coaching_messages_relationship_idx ON coaching_messages(relationship_id, created_at DESC);

ALTER TABLE coaching_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaching_messages_participants_read" ON coaching_messages FOR SELECT USING (
  relationship_id IN (
    SELECT id FROM coaching_relationships
    WHERE player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
    OR coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  )
);

CREATE POLICY "coaching_messages_participants_insert" ON coaching_messages FOR INSERT WITH CHECK (
  sender_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  AND relationship_id IN (
    SELECT id FROM coaching_relationships
    WHERE player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
    OR coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  )
);

-- Recipient marks read — same pattern as direct_messages.
CREATE POLICY "coaching_messages_recipient_mark_read" ON coaching_messages FOR UPDATE USING (
  relationship_id IN (
    SELECT id FROM coaching_relationships
    WHERE player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
    OR coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  )
);

-- ── Private coach notes ───────────────────────────────────────────────────
-- Section 27: "completely invisible to the player" — the one table in this
-- whole module with no participants_read policy. Only the coach who owns
-- the relationship can ever see or write these.
CREATE TABLE IF NOT EXISTS coaching_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id UUID NOT NULL REFERENCES coaching_relationships(id) ON DELETE CASCADE,
  coach_id        UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  note            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coaching_notes_relationship_idx ON coaching_notes(relationship_id, created_at DESC);

ALTER TABLE coaching_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaching_notes_coach_only" ON coaching_notes FOR ALL USING (
  coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
) WITH CHECK (
  coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

-- ── Notifications ─────────────────────────────────────────────────────────
-- Section 36: a persisted feed backing "Recent Activity" (coach dashboard,
-- Section 11) as well as the push notifications sent via the existing
-- sendPushNotification() — this table is the queryable record, the push
-- itself still goes through the app's existing notification plumbing.
-- Loosely-typed context (unlike coaching_messages) since this is a
-- disposable activity feed, not a source of coaching truth.
CREATE TABLE IF NOT EXISTS coaching_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id UUID NOT NULL REFERENCES coaching_relationships(id) ON DELETE CASCADE,
  recipient_id    UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN (
    'swing_reviewed', 'drill_assigned', 'progress_reviewed', 'new_message',
    'swing_submitted', 'progress_submitted', 'coach_request', 'coach_accepted'
  )),
  context_type    TEXT CHECK (context_type IN ('submission', 'drill', 'lesson', 'progress', 'message')),
  context_id      UUID,
  title           TEXT NOT NULL,
  body            TEXT,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coaching_notifications_recipient_idx ON coaching_notifications(recipient_id, read_at, created_at DESC);

ALTER TABLE coaching_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaching_notifications_recipient_read" ON coaching_notifications FOR SELECT USING (
  recipient_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

CREATE POLICY "coaching_notifications_recipient_mark_read" ON coaching_notifications FOR UPDATE USING (
  recipient_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

-- ── Relationship lifecycle RPCs ──────────────────────────────────────────
-- Section 4: request must not create the relationship until the coach
-- accepts. Section 32: refuse a second pending/active request so Phase 1
-- stays "one primary coach" without a schema constraint that would need
-- loosening once multiple coaches are actually supported.
CREATE OR REPLACE FUNCTION request_coach_connection(p_coach_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id UUID;
  v_existing UUID;
  v_new_id UUID;
BEGIN
  SELECT id INTO v_player_id FROM players WHERE auth_uid = auth.uid();
  IF v_player_id IS NULL THEN RAISE EXCEPTION 'no player for current user'; END IF;
  IF v_player_id = p_coach_id THEN RAISE EXCEPTION 'cannot connect to yourself'; END IF;
  IF NOT EXISTS (SELECT 1 FROM coach_profiles WHERE player_id = p_coach_id AND is_active) THEN
    RAISE EXCEPTION 'target player is not an active coach';
  END IF;

  SELECT id INTO v_existing FROM coaching_relationships
    WHERE player_id = v_player_id AND status IN ('pending', 'active') LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'you already have a pending or active coach connection';
  END IF;

  INSERT INTO coaching_relationships (player_id, coach_id, status)
    VALUES (v_player_id, p_coach_id, 'pending')
    RETURNING id INTO v_new_id;
  RETURN v_new_id;
END;
$$;

CREATE OR REPLACE FUNCTION accept_coach_connection(p_relationship_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_coach_id UUID;
BEGIN
  SELECT id INTO v_coach_id FROM players WHERE auth_uid = auth.uid();
  UPDATE coaching_relationships
    SET status = 'active', accepted_at = now()
    WHERE id = p_relationship_id AND coach_id = v_coach_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'no pending request found for this coach'; END IF;
END;
$$;

-- Either party can end the relationship (Section 31 — player removes coach
-- at any time; a coach declining a pending request uses this same path).
-- Historical lessons/drills/messages are untouched (no cascade on removal).
CREATE OR REPLACE FUNCTION remove_coach_connection(p_relationship_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_my_id UUID;
BEGIN
  SELECT id INTO v_my_id FROM players WHERE auth_uid = auth.uid();
  UPDATE coaching_relationships
    SET status = 'removed', removed_at = now()
    WHERE id = p_relationship_id
    AND (player_id = v_my_id OR coach_id = v_my_id)
    AND status IN ('pending', 'active');
  IF NOT FOUND THEN RAISE EXCEPTION 'no active/pending relationship found'; END IF;
END;
$$;

-- ── Video storage ─────────────────────────────────────────────────────────
-- Private bucket, path convention `{relationship_id}/{video_id}.<ext>` — RLS
-- checks relationship membership rather than a single owner id (unlike the
-- photos bucket) since both the player and coach need to read/write into
-- the same relationship's folder. Deliberately no DELETE policy: coaching
-- history is permanent (Section 19); only a service-role admin action could
-- remove a video file.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('coaching-videos', 'coaching-videos', false, 209715200, ARRAY['video/mp4', 'video/quicktime'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "coaching_videos_bucket_insert" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'coaching-videos'
  AND (storage.foldername(name))[1]::uuid IN (
    SELECT id FROM coaching_relationships
    WHERE player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
    OR coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  )
);

CREATE POLICY "coaching_videos_bucket_read" ON storage.objects FOR SELECT USING (
  bucket_id = 'coaching-videos'
  AND (storage.foldername(name))[1]::uuid IN (
    SELECT id FROM coaching_relationships
    WHERE player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
    OR coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  )
);

-- Voice notes and coaching chat images/videos share the same relationship-
-- scoped access rule, so they reuse this one bucket under a `messages/`
-- prefix rather than provisioning a second bucket.
CREATE POLICY "coaching_videos_bucket_insert_messages" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'coaching-videos'
  AND (storage.foldername(name))[1] = 'messages'
  AND (storage.foldername(name))[2]::uuid IN (
    SELECT id FROM coaching_relationships
    WHERE player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
    OR coach_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  )
);
