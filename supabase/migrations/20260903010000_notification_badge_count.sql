-- App icon badge count (Dave, 2026-09-03) — incremented server-side by
-- send-push each time a push actually goes out, so a killed/backgrounded
-- app still shows the right number on the icon (APNs sets the badge from
-- the push payload itself, not from anything the client does at delivery
-- time). Cleared back to 0 by the client when the app is opened.
ALTER TABLE players ADD COLUMN IF NOT EXISTS badge_count INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION reset_my_badge_count()
RETURNS VOID LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE players SET badge_count = 0 WHERE auth_uid = auth.uid();
$$;
