-- Chip & Birdie Coaching: per-course, multi-round AI coaching report.
-- Same "Titan calculates, AI only writes" split as titan_news — every hole
-- stat here is computed in src/lib/coachingInsights.ts, Claude only turns
-- the snapshot into Chip & Birdie's write-up (see supabase/functions/
-- coaching-report). One row per player+course, overwritten on regenerate.
CREATE TABLE ai_coaching_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id        uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  course_name      text NOT NULL,
  rounds_analyzed  integer NOT NULL,
  headline         text,
  summary          text,
  body             text,
  strongest_holes  jsonb NOT NULL DEFAULT '[]'::jsonb,
  problem_holes    jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggestions      jsonb NOT NULL DEFAULT '[]'::jsonb,
  banter_speaker   text CHECK (banter_speaker IN ('chip', 'birdie')),
  banter_text      text,
  ai_model         text,
  input_snapshot   jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, course_name)
);

CREATE INDEX idx_ai_coaching_reports_player ON ai_coaching_reports(player_id);

ALTER TABLE ai_coaching_reports ENABLE ROW LEVEL SECURITY;

-- Same player-ownership idiom as player_library (20260813010000) — the edge
-- function writes via the service-role key so this only actually gates
-- client-side reads, but FOR ALL keeps the policy consistent with every
-- other player-owned table in this schema.
CREATE POLICY "Player full access to own coaching reports" ON ai_coaching_reports
  FOR ALL
  USING     (player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid()))
  WITH CHECK (player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid()));
