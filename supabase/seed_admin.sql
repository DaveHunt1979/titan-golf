-- ── Dave Hunt — Society Owner ─────────────────────────────────
-- Run once to link your Supabase auth account to Titan Tour

INSERT INTO players (id, auth_uid, display_name, email, handicap_index)
VALUES (
  '30000000-0000-0000-0000-000000000001',
  'eac54d88-8837-4a86-aed0-a250bc99d4f3',
  'Dave Hunt',
  'davehunt79@gmail.com',
  7.0
)
ON CONFLICT (auth_uid) DO NOTHING;

INSERT INTO society_members (society_id, player_id, role)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'owner'
)
ON CONFLICT (society_id, player_id) DO NOTHING;
