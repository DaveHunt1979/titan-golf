-- Round photos in Titan News reports (Dave, 2026-09-03 — "photos taken with
-- good framing during a round should make it into that round's news report").
--
-- The photos table (20260823000000_photos.sql) has always tagged each shot
-- with the match/day/competition it was taken in, but it was write-only: the
-- only readers allowed were the photographer themselves, so a report shown to
-- the whole group could never show anyone else's photos. This adds the read
-- side and nothing else — purely additive policies, every existing policy is
-- left exactly as it was, and no column or bucket setting changes.
--
-- Scope deliberately mirrors who the report itself is shown to:
--   • casual round  → the players who were in that match / on that day
--   • tournament    → members of the society running the competition
-- so a photo is never visible to anyone who couldn't already read the article
-- it appears in (see 20260820020000_casual_news.sql for the same split).

CREATE OR REPLACE FUNCTION photo_round_visible(
  p_match_id       UUID,
  p_day_id         UUID,
  p_competition_id UUID
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM matches m, players me
      WHERE me.auth_uid = auth.uid()
        AND (m.id = p_match_id OR (p_day_id IS NOT NULL AND m.day_id = p_day_id))
        AND (me.id = ANY(m.home_player_ids) OR me.id = ANY(m.away_player_ids))
    )
    OR EXISTS (
      SELECT 1 FROM competitions c
      WHERE c.id = p_competition_id AND is_society_member(c.society_id)
    );
$$;

-- Storage objects can't join back to photos under photos' own RLS, so the
-- path → visibility check gets its own SECURITY DEFINER wrapper.
CREATE OR REPLACE FUNCTION photo_storage_visible(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM photos p
    WHERE p.storage_path = p_name
      AND photo_round_visible(p.match_id, p.day_id, p.competition_id)
  );
$$;

DROP POLICY IF EXISTS "Round players read round photos" ON photos;
CREATE POLICY "Round players read round photos" ON photos FOR SELECT
  USING (photo_round_visible(match_id, day_id, competition_id));

DROP POLICY IF EXISTS "Round players read round photo files" ON storage.objects;
CREATE POLICY "Round players read round photo files" ON storage.objects FOR SELECT
  USING (bucket_id = 'photos' AND photo_storage_visible(name));

-- The report pulls a round's photos by match_id (casual) or day_id
-- (tournament round report); competition_id covers the final report.
CREATE INDEX IF NOT EXISTS photos_match_id_idx       ON photos (match_id);
CREATE INDEX IF NOT EXISTS photos_day_id_idx         ON photos (day_id);
CREATE INDEX IF NOT EXISTS photos_competition_id_idx ON photos (competition_id);
CREATE INDEX IF NOT EXISTS photos_storage_path_idx   ON photos (storage_path);
