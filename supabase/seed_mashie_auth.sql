-- Run this in Supabase SQL Editor to create the Mashie demo login
-- Check Authentication > Users after running to confirm it appears

DO $$
DECLARE
  v_uid  UUID := '40000000-0000-0000-0000-000000000003';
  v_email TEXT := 'dave@mashiegolf.co.uk';
BEGIN

  -- Remove any partial previous attempt
  DELETE FROM auth.identities WHERE provider_id = v_email;
  DELETE FROM auth.users WHERE email = v_email OR id = v_uid;

  -- Create auth user
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
    crypt('mashie2027', gen_salt('bf')),
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    false,
    '', '', '', ''
  );

  -- Create identity record
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

  RAISE NOTICE 'Auth user created: % (id: %)', v_email, v_uid;

END $$;
