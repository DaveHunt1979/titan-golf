-- ============================================================
-- Create George Lings as a Titan user
-- Player ID: 20000000-0000-0000-0000-000000000025
-- Email:     george.lings@titantour.co.uk
-- Password:  Titan2027
--
-- Run in Supabase SQL Editor.
-- ============================================================

DO $$
DECLARE
  v_player_id  UUID := '20000000-0000-0000-0000-000000000025';
  v_email      TEXT := 'george.lings@titantour.co.uk';
  v_password   TEXT := 'Titan2027';
  v_uid        UUID;
  v_society_id UUID;
BEGIN
  -- Look up the society to add George to
  SELECT id INTO v_society_id FROM societies LIMIT 1;

  IF v_society_id IS NULL THEN
    RAISE EXCEPTION 'No society found — cannot add George.';
  END IF;

  -- 1. Create player record (skip if already exists)
  IF NOT EXISTS (SELECT 1 FROM players WHERE id = v_player_id) THEN
    INSERT INTO players (id, display_name, handicap_index, created_at)
    VALUES (v_player_id, 'George Lings', 0, now());
    RAISE NOTICE 'Created player record for George Lings';
  ELSE
    RAISE NOTICE 'Player record already exists — skipping insert';
  END IF;

  -- 2. Create society membership (skip if already a member)
  IF NOT EXISTS (SELECT 1 FROM society_members WHERE player_id = v_player_id AND society_id = v_society_id) THEN
    INSERT INTO society_members (society_id, player_id, role, joined_at)
    VALUES (v_society_id, v_player_id, 'member', now());
    RAISE NOTICE 'Added George Lings to society %', v_society_id;
  ELSE
    RAISE NOTICE 'George Lings already a member — skipping';
  END IF;

  -- 3. Create auth account (skip if email already registered)
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
    RAISE NOTICE 'Auth account already exists for % — linking only', v_email;
    SELECT id INTO v_uid FROM auth.users WHERE email = v_email;
  ELSE
    v_uid := gen_random_uuid();

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
      now(),
      'authenticated',
      'authenticated',
      now(),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{}',
      false
    );

    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
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

    RAISE NOTICE 'Created auth account: % (uid: %)', v_email, v_uid;
  END IF;

  -- 4. Link auth account to player record
  UPDATE players
  SET auth_uid = v_uid,
      email    = v_email
  WHERE id = v_player_id;

  RAISE NOTICE 'Done! George Lings can now sign in with george.lings@titantour.co.uk / Titan2027';
END $$;
