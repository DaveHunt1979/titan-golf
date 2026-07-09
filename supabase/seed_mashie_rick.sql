-- ============================================================
-- Mashie Golf — create Rick's login
-- Run in Supabase SQL Editor.
-- ============================================================

DO $$
DECLARE
  v_society_id  UUID := '40000000-0000-0000-0000-000000000001';
  v_player_id   UUID := '40000000-0000-0000-0000-000000000007';
  v_uid         UUID;
  v_email       TEXT := 'ricky@mashiegolf.co.uk';
  v_password    TEXT := 'mashie2027';
BEGIN

  -- Clean up any partial previous attempt
  DELETE FROM auth.identities WHERE provider_id = v_email;
  DELETE FROM auth.users WHERE email = v_email;

  -- Generate a fresh UUID for the auth user
  v_uid := gen_random_uuid();

  -- 1. Auth user (matches proven seed_mashie_auth.sql format)
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_uid,
    'authenticated',
    'authenticated',
    v_email,
    crypt(v_password, gen_salt('bf')),
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    false,
    '', '', '', ''
  );

  -- 2. Identity record
  INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    v_uid,
    v_uid,
    v_email,
    json_build_object('sub', v_uid::text, 'email', v_email),
    'email',
    now(),
    now(),
    now()
  );

  -- 3. Player record
  INSERT INTO players (id, auth_uid, display_name, email, handicap_index)
  VALUES (v_player_id, v_uid, 'Rick', v_email, 10.0)
  ON CONFLICT (id) DO UPDATE SET auth_uid = v_uid, email = v_email;

  -- 4. Society membership — admin so Rick can create games
  INSERT INTO society_members (society_id, player_id, role)
  VALUES (v_society_id, v_player_id, 'admin')
  ON CONFLICT (society_id, player_id) DO UPDATE SET role = 'admin';

  RAISE NOTICE 'Done. Login: % / %', v_email, v_password;
  RAISE NOTICE 'Auth UID: %', v_uid;

END $$;
