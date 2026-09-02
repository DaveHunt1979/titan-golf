-- Bulk atomic badge-count increment for send-push (one push batch can target
-- many recipients at once — a group chat message pushes the whole society)
-- returning each player's push_token alongside their new count so the edge
-- function can build one Expo push message per recipient with the right
-- number, in a single round trip rather than N.
CREATE OR REPLACE FUNCTION increment_badge_counts(p_player_ids UUID[])
RETURNS TABLE(id UUID, push_token TEXT, badge_count INTEGER)
LANGUAGE sql AS $$
  UPDATE players
  SET badge_count = players.badge_count + 1
  WHERE players.id = ANY(p_player_ids) AND players.push_token IS NOT NULL
  RETURNING players.id, players.push_token, players.badge_count;
$$;

-- Server-side (send-push edge function, service_role) only — never a
-- client-callable RPC, or any authenticated user could bump a stranger's
-- badge count for no reason.
REVOKE EXECUTE ON FUNCTION increment_badge_counts(UUID[]) FROM PUBLIC, anon, authenticated;
