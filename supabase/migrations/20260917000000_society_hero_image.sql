-- Society hero banner image (Dave, 2026-09-08) — separate from logo_url.
-- Home's hero section already falls back from "society logo in a box" to a
-- static Titan course photo when no logo is set; this adds a genuine
-- per-society replacement for that photo rather than forcing every society
-- with a logo to lose the landscape treatment entirely.
ALTER TABLE societies ADD COLUMN IF NOT EXISTS hero_url TEXT;
