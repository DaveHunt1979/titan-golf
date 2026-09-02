-- Titan Season Mode — News Engine integration (spec §14, Dave, 2026-09-06:
-- "DO NOT BUILD A SECOND NEWS ENGINE"). titan_news already supports
-- competition_id/match_id; this adds season_id as a third, equally-nullable
-- alternative so Season stories reuse the exact same table, edge function,
-- and admin review flow — no new news infrastructure.
ALTER TABLE titan_news ADD COLUMN IF NOT EXISTS season_id UUID REFERENCES seasons(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_titan_news_season ON titan_news(season_id);
