-- ============================================================
-- Info Board — competition info pack + society notices
-- Run in Supabase SQL Editor
-- ============================================================

-- Competition info pack (sections stored as JSONB)
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS info_sections JSONB DEFAULT '[]';

-- Society notices (pinned announcements, general news)
CREATE TABLE IF NOT EXISTS society_posts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id  UUID NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT,
  pinned      BOOLEAN DEFAULT FALSE,
  author_id   UUID REFERENCES players(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE society_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read society posts" ON society_posts
  FOR SELECT USING (is_society_member(society_id));

CREATE POLICY "Admins manage society posts" ON society_posts
  FOR ALL USING (is_society_admin(society_id));
