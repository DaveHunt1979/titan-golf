-- admin_update_player never covered avatar_url, so admin/players.tsx's photo
-- picker fell back to a raw `players` table update — which RLS silently
-- drops to 0 rows affected (no error) whenever the admin edits someone
-- else's photo, since only the row's own owner can update it directly.
CREATE OR REPLACE FUNCTION admin_update_player(
  p_society_id   UUID,
  p_player_id    UUID,
  p_display_name TEXT    DEFAULT NULL,
  p_email        TEXT    DEFAULT NULL,
  p_handicap     NUMERIC DEFAULT NULL,
  p_avatar_url   TEXT    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_society_admin(p_society_id) THEN
    RAISE EXCEPTION 'Not authorized — must be society admin';
  END IF;

  UPDATE players
  SET
    display_name   = COALESCE(p_display_name,   display_name),
    email          = COALESCE(p_email,           email),
    handicap_index = COALESCE(p_handicap,        handicap_index),
    avatar_url     = COALESCE(p_avatar_url,      avatar_url)
  WHERE id = p_player_id;
END;
$$;
