-- Batched counterpart to is_player_online() (20260821010000_player_presence.sql)
-- — friends.tsx needs online status for a whole member list, and calling the
-- single-player RPC once per member would mean N round-trips for a screen
-- that's otherwise entirely batch-fetched (Dave, 2026-08-25). Same
-- SECURITY DEFINER reasoning as the original: players RLS is strict
-- self-read-only, so reading anyone else's presence needs to bypass it, and
-- only a boolean is ever exposed, never the raw timestamp.
CREATE OR REPLACE FUNCTION players_online_status(p_player_ids UUID[])
RETURNS TABLE(player_id UUID, online BOOLEAN)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id, last_active_at > now() - interval '5 minutes'
  FROM players WHERE id = ANY(p_player_ids);
$$;
