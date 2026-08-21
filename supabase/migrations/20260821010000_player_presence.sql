-- Minimal online-presence for T-Card's live green dot (Dave, 2026-08-21).
-- No existing presence tracking in the app at all — this is a plain
-- heartbeat timestamp, not Realtime Presence channels: the app layout
-- calls touch_my_presence() every ~60s while foregrounded (see
-- app/(app)/_layout.tsx), and a player counts as "online" if that
-- timestamp is recent. Good enough for a card glance, not meant to be
-- sub-second-accurate.

ALTER TABLE players ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

-- players RLS is strict self-read-only ("Players read own", see
-- 20260813_t_tag.sql's comment) — both RPCs below must be SECURITY DEFINER
-- so a viewer can update their own heartbeat and read someone else's
-- online/offline status without RLS blocking either direction. Only a
-- boolean is exposed, never the raw timestamp, so this can't be used to
-- infer exactly when someone was last active.

CREATE OR REPLACE FUNCTION touch_my_presence()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE players SET last_active_at = now() WHERE auth_uid = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION is_player_online(p_player_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT last_active_at > now() - interval '5 minutes'
  FROM players WHERE id = p_player_id;
$$;
