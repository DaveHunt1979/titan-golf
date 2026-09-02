-- courses.region already holds fine county/state/province detail from the
-- 2026-09-03 course rebuild (e.g. "Surrey", "Bavaria", "Marrakech-Safi") —
-- useful, but too granular to tab by. A separate country field lets the
-- course picker group into a handful of top-level tabs (UK/Europe/USA/
-- Africa/Middle East) without losing the finer region detail.
ALTER TABLE courses ADD COLUMN IF NOT EXISTS country TEXT;
