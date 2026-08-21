-- Chip & Birdie banter on Titan News reports (Dave, 2026-08-21 — "add Chip
-- and Birdie into it, with some comedy commentary"). Same "Titan calculates,
-- AI only narrates" split as the rest of titan-news: the AI picks which
-- speaker and which pre-made scene image fits the story, it never generates
-- new facts. banter_scene is a free-text key (e.g. 'bunker', 'trees') that
-- the client maps to one of a small fixed set of images Dave supplies
-- himself — never AI-generated per-report, see project memory on why.
ALTER TABLE titan_news ADD COLUMN IF NOT EXISTS banter_speaker TEXT CHECK (banter_speaker IN ('chip', 'birdie'));
ALTER TABLE titan_news ADD COLUMN IF NOT EXISTS banter_text    TEXT;
ALTER TABLE titan_news ADD COLUMN IF NOT EXISTS banter_scene   TEXT;
