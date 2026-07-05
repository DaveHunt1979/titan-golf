-- ============================================================
-- TITAN GOLF — Seed Data
-- Titan Tour Society + 2025/2026 Wall of Champions
-- Run AFTER schema.sql
-- ============================================================

-- ── Titan Tour Society ───────────────────────────────────────
INSERT INTO societies (id, name, slug, primary_color) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Titan Tour', 'titan-tour', '#D4AF37')
ON CONFLICT (slug) DO NOTHING;

-- ── Teams ────────────────────────────────────────────────────
INSERT INTO teams (id, society_id, name, accent_color, sort_order) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'MOB',          '#3b82f6', 1),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Destroyers',   '#ef4444', 2),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Legion Six',   '#a855f7', 3),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Renegades',    '#f97316', 4),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'Elite',        '#10b981', 5),
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'Instigators',  '#D4AF37', 6)
ON CONFLICT DO NOTHING;

-- ── Course Holes — West Cliffs ───────────────────────────────
INSERT INTO course_holes (course_name, hole_number, par, stroke_index, yardage) VALUES
  ('West Cliffs',  1,  4, 17, 323),
  ('West Cliffs',  2,  3, 15, 130),
  ('West Cliffs',  3,  4,  1, 354),
  ('West Cliffs',  4,  4,  5, 379),
  ('West Cliffs',  5,  3,  7, 145),
  ('West Cliffs',  6,  5, 11, 476),
  ('West Cliffs',  7,  5,  3, 510),
  ('West Cliffs',  8,  4, 13, 313),
  ('West Cliffs',  9,  4,  9, 333),
  ('West Cliffs', 10,  4, 10, 313),
  ('West Cliffs', 11,  4, 14, 334),
  ('West Cliffs', 12,  3, 18, 136),
  ('West Cliffs', 13,  5,  8, 460),
  ('West Cliffs', 14,  4,  2, 348),
  ('West Cliffs', 15,  5, 16, 420),
  ('West Cliffs', 16,  3, 12, 157),
  ('West Cliffs', 17,  4,  6, 373),
  ('West Cliffs', 18,  4,  4, 385)
ON CONFLICT (course_name, hole_number) DO NOTHING;

-- ── Course Holes — Praia D'El Rey ───────────────────────────
INSERT INTO course_holes (course_name, hole_number, par, stroke_index, yardage, hole_name) VALUES
  ('Praia D''El Rey',  1, 4,  8, 323, 'Pluma'),
  ('Praia D''El Rey',  2, 5, 14, 398, 'Verbasco'),
  ('Praia D''El Rey',  3, 3, 18, 124, 'Junco'),
  ('Praia D''El Rey',  4, 4, 12, 274, 'Estorno'),
  ('Praia D''El Rey',  5, 4,  2, 396, 'Acendalho'),
  ('Praia D''El Rey',  6, 4,  6, 338, 'Pinheiro Bravo'),
  ('Praia D''El Rey',  7, 5, 10, 465, 'Acácia'),
  ('Praia D''El Rey',  8, 3, 16, 113, 'Eucalipto'),
  ('Praia D''El Rey',  9, 4,  4, 352, 'Tojo de Bico'),
  ('Praia D''El Rey', 10, 5,  7, 445, 'Atabúa'),
  ('Praia D''El Rey', 11, 3, 13, 135, 'Zimbreiro'),
  ('Praia D''El Rey', 12, 5, 11, 422, 'Feto'),
  ('Praia D''El Rey', 13, 4, 15, 256, 'Arméria'),
  ('Praia D''El Rey', 14, 3, 17, 137, 'Chorão'),
  ('Praia D''El Rey', 15, 4,  3, 352, 'Trebisco'),
  ('Praia D''El Rey', 16, 4,  5, 356, 'Samanilha'),
  ('Praia D''El Rey', 17, 5,  1, 485, 'Camarinha'),
  ('Praia D''El Rey', 18, 4,  9, 345, 'Pinheiro Manso')
ON CONFLICT (course_name, hole_number) DO NOTHING;

-- ── Wall of Champions ─────────────────────────────────────────
INSERT INTO champions (society_id, year, award_name, winner_name, winner_type, detail) VALUES
  ('00000000-0000-0000-0000-000000000001', 2025, 'Titan Tour',    'Instigators',   'team',   NULL),
  ('00000000-0000-0000-0000-000000000001', 2025, 'Kronos Trophy', 'George Lings',  'player', NULL),
  ('00000000-0000-0000-0000-000000000001', 2026, 'Titan Tour',    'Elite',         'team',   'Portugal 2026'),
  ('00000000-0000-0000-0000-000000000001', 2026, 'Kronos Trophy', 'Ian Henderson', 'player', '140 pts — The Instigators')
ON CONFLICT (society_id, year, award_name) DO NOTHING;
