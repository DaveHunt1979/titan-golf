-- admin_create_login: creates a Supabase auth account for a player.
-- Called from the admin app after adding a player with an email.
-- Safe to call multiple times — skips if the email already exists.
-- Also links the new auth_uid back to the player record.

CREATE OR REPLACE FUNCTION admin_create_login(
  p_email    TEXT,
  p_password TEXT DEFAULT 'Titan2027'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email TEXT := lower(trim(p_email));
  v_uid   UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
    RETURN NULL;
  END IF;

  v_uid := gen_random_uuid();

  INSERT INTO auth.users (
    id, email, encrypted_password,
    email_confirmed_at, role, aud,
    created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin
  ) VALUES (
    v_uid, v_email,
    crypt(p_password, gen_salt('bf')),
    now(), 'authenticated', 'authenticated',
    now(), now(),
    '{"provider":"email","providers":["email"]}',
    '{}', false
  );

  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    v_uid, v_uid, v_email,
    json_build_object('sub', v_uid::text, 'email', v_email),
    'email', now(), now(), now()
  );

  -- Link to the player record
  UPDATE players SET auth_uid = v_uid WHERE email = v_email AND auth_uid IS NULL;

  RETURN v_uid;
END;
$$;
