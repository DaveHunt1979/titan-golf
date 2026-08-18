-- ── Titan News AI — Phase 1 ──────────────────────────────────────────────────
-- AI-generated tournament journalism (preview / round report / final report).
-- Titan computes every fact ahead of time (input_snapshot); the edge function
-- only turns that snapshot into prose. This table never stores anything the
-- golf engine itself is the source of truth for.

CREATE TABLE IF NOT EXISTS titan_news (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id      UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  day_id              UUID REFERENCES competition_days(id) ON DELETE CASCADE,  -- null for tournament-level stories
  story_type          TEXT NOT NULL CHECK (story_type IN ('preview', 'round_report', 'final_report')),
  headline            TEXT,
  summary             TEXT,
  body                TEXT,
  featured_players    TEXT[] DEFAULT '{}',
  featured_teams      TEXT[] DEFAULT '{}',
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'rejected')),
  ai_model            TEXT,
  generation_version  INTEGER NOT NULL DEFAULT 1,
  input_snapshot      JSONB,          -- exact facts package sent to Claude — audit trail
  dedupe_key          TEXT NOT NULL UNIQUE,   -- competition_id:day_id:story_type — regenerate overwrites, never duplicates
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  published_at        TIMESTAMPTZ
);

ALTER TABLE titan_news ENABLE ROW LEVEL SECURITY;

-- Members read only published stories; admins/owners can also see drafts to review before publishing.
CREATE POLICY "Members read published titan_news" ON titan_news FOR SELECT
  USING (
    status = 'published' AND EXISTS (
      SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_member(c.society_id)
    )
  );
CREATE POLICY "Admins read all titan_news" ON titan_news FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_admin(c.society_id)
  ));

-- Article content (headline/body/etc.) is written only by the edge function via
-- the service role, which bypasses RLS entirely — there's no INSERT policy for
-- regular users at all. This UPDATE policy is row-level, not column-level: the
-- app only ever sends {status, published_at} in practice, but an admin's
-- Postgres role could technically update any column on a row they administer.
CREATE POLICY "Admins publish titan_news" ON titan_news FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_admin(c.society_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_admin(c.society_id)
  ));
CREATE POLICY "Admins delete titan_news" ON titan_news FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM competitions c WHERE c.id = competition_id AND is_society_admin(c.society_id)
  ));
