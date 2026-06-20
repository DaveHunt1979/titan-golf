-- ============================================================
-- Create Supabase auth accounts for all unlinked Titan players
-- and link them to their existing player records.
--
-- Emails are generated as: firstname.lastname@titantour.co.uk
--   (spaces → dots, lowercase)
-- Password: set at the top — share via WhatsApp before running.
--
-- Safe to re-run: skips players already linked (auth_uid IS NOT NULL)
-- and skips emails that already exist in auth.users.
--
-- Run in Supabase SQL Editor.
-- ============================================================

DO $$
DECLARE
  v_player   RECORD;
  v_email    TEXT;
  v_uid      UUID;
  v_password TEXT := 'Titan2027';   -- ← change this before running
BEGIN
  FOR v_player IN
    SELECT id, display_name
    FROM players
    WHERE auth_uid IS NULL
    ORDER BY display_name
  LOOP
    -- Build email: "Dave Hunt" → "dave.hunt@titantour.co.uk"
    v_email := lower(replace(trim(v_player.display_name), ' ', '.')) || '@titantour.co.uk';

    -- Skip if this email is already registered
    IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
      RAISE NOTICE 'SKIPPED (email exists): %', v_email;
      CONTINUE;
    END IF;

    v_uid := gen_random_uuid();

    -- Create the auth user (email pre-confirmed, no invite email sent)
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

    -- Create the identity record (required for email login)
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

    -- Link auth account → existing player record
    UPDATE players
    SET auth_uid = v_uid,
        email    = v_email
    WHERE id = v_player.id;

    RAISE NOTICE 'CREATED: % → %', v_player.display_name, v_email;
  END LOOP;

  RAISE NOTICE 'Done. Players can now sign in with their @titantour.co.uk email and the shared password.';
END $$;
