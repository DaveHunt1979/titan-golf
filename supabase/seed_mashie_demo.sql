-- ============================================================
-- Mashie Golf Society — demo seed
--
-- Creates:
--   • Mashie society (primary colour #000035, white text)
--   • Auth login: dave@mashiegolf.co.uk / mashie2027
--   • Player record: Dave (Mashie)
--   • society_members row linking player → Mashie as admin
--
-- Safe to re-run: uses ON CONFLICT DO NOTHING / IF NOT EXISTS guards.
-- Run in Supabase SQL Editor.
-- ============================================================

DO $$
DECLARE
  v_society_id  UUID := '40000000-0000-0000-0000-000000000001';
  v_player_id   UUID := '40000000-0000-0000-0000-000000000002';
  v_uid         UUID := '40000000-0000-0000-0000-000000000003';
  v_email       TEXT := 'dave@mashiegolf.co.uk';
  v_password    TEXT := 'mashie2027';
BEGIN

  -- 1. Society
  INSERT INTO societies (id, name, slug, tagline, primary_color, secondary_color, logo_url)
  VALUES (
    v_society_id,
    'Mashie Golf',
    'mashie-golf',
    'Play More. Play Better.',
    '#000035',
    '#ffffff',
    null
  )
  ON CONFLICT (id) DO UPDATE SET
    primary_color   = '#000035',
    secondary_color = '#ffffff';

  RAISE NOTICE 'Society ready: Mashie Golf (%)', v_society_id;

  -- 2. Auth user
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
    INSERT INTO auth.users (
      id, email, encrypted_password,
      email_confirmed_at, role, aud,
      created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      is_super_admin
    ) VALUES (
      v_uid,
      v_email,
      crypt(v_password, gen_salt('bf')),
      now(), 'authenticated', 'authenticated',
      now(), now(),
      '{"provider":"email","providers":["email"]}',
      '{}',
      false
    );

    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      v_uid, v_uid, v_email,
      json_build_object('sub', v_uid::text, 'email', v_email),
      'email', now(), now(), now()
    );

    RAISE NOTICE 'Auth user created: %', v_email;
  ELSE
    -- Grab the existing uid so we can still link the player below
    SELECT id INTO v_uid FROM auth.users WHERE email = v_email;
    RAISE NOTICE 'Auth user already exists: % (%)', v_email, v_uid;
  END IF;

  -- 3. Player record
  INSERT INTO players (id, auth_uid, display_name, email, handicap_index)
  VALUES (v_player_id, v_uid, 'Dave', v_email, 10.0)
  ON CONFLICT (id) DO UPDATE SET auth_uid = v_uid;

  RAISE NOTICE 'Player ready: Dave (%)', v_player_id;

  -- 4. Society membership (admin so the Admin tab is visible)
  INSERT INTO society_members (society_id, player_id, role)
  VALUES (v_society_id, v_player_id, 'admin')
  ON CONFLICT (society_id, player_id) DO UPDATE SET role = 'admin';

  RAISE NOTICE 'Membership ready: Dave → Mashie Golf (admin)';
  RAISE NOTICE 'Login: % / %', v_email, v_password;

END $$;
