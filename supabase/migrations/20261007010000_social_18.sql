-- Social 18 (Dave/Rick, 2026-10-07): a single-day golf gathering. Host
-- announces + invites, players accept/decline into a waiting room, host
-- builds groups from the accepted players on the day. Additive only.

CREATE TABLE IF NOT EXISTS social_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id         UUID NOT NULL REFERENCES societies(id),
  host_player_id     UUID NOT NULL REFERENCES players(id),
  name               TEXT NOT NULL,
  event_date         DATE NOT NULL,
  tee_time           TEXT,
  course_name        TEXT,
  entry_fee          NUMERIC NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL DEFAULT '£',
  money_method       TEXT NOT NULL DEFAULT 'none' CHECK (money_method IN ('collector', 'winners', 'none')),
  collector_player_id UUID REFERENCES players(id),
  prize_split        NUMERIC[] NOT NULL DEFAULT '{100}',
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'started', 'complete', 'cancelled')),
  day_id             UUID REFERENCES competition_days(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_social_events_society_date ON social_events (society_id, event_date);

CREATE TABLE IF NOT EXISTS social_event_players (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID NOT NULL REFERENCES social_events(id) ON DELETE CASCADE,
  player_id  UUID NOT NULL REFERENCES players(id),
  status     TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'accepted', 'declined', 'removed')),
  source     TEXT NOT NULL DEFAULT 'invite' CHECK (source IN ('invite', 'chat')),
  paid       BOOLEAN NOT NULL DEFAULT false,
  paid_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_social_event_players_event ON social_event_players (event_id);
CREATE INDEX IF NOT EXISTS idx_social_event_players_player ON social_event_players (player_id);

ALTER TABLE social_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_event_players ENABLE ROW LEVEL SECURITY;

-- "me" = the players row for the signed-in auth user; "my societies" = where I'm a member.
DROP POLICY IF EXISTS "social_events_select" ON social_events;
CREATE POLICY "social_events_select" ON social_events FOR SELECT USING (
  society_id IN (
    SELECT sm.society_id FROM society_members sm
    JOIN players p ON p.id = sm.player_id WHERE p.auth_uid = auth.uid()
  )
);
DROP POLICY IF EXISTS "social_events_insert" ON social_events;
CREATE POLICY "social_events_insert" ON social_events FOR INSERT WITH CHECK (
  host_player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  AND society_id IN (
    SELECT sm.society_id FROM society_members sm
    JOIN players p ON p.id = sm.player_id WHERE p.auth_uid = auth.uid()
  )
);
DROP POLICY IF EXISTS "social_events_update" ON social_events;
CREATE POLICY "social_events_update" ON social_events FOR UPDATE USING (
  host_player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
) WITH CHECK (
  host_player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
  AND society_id IN (
    SELECT sm.society_id FROM society_members sm
    JOIN players p ON p.id = sm.player_id WHERE p.auth_uid = auth.uid()
  )
);
DROP POLICY IF EXISTS "social_events_delete" ON social_events;
CREATE POLICY "social_events_delete" ON social_events FOR DELETE USING (
  host_player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
);

DROP POLICY IF EXISTS "social_event_players_select" ON social_event_players;
CREATE POLICY "social_event_players_select" ON social_event_players FOR SELECT USING (
  event_id IN (SELECT id FROM social_events)  -- inherits social_events' society RLS
);
-- Host invites society members (status 'invited', unpaid); a player may add
-- THEMSELVES only to an open event via the chat "I'm in" button.
DROP POLICY IF EXISTS "social_event_players_insert" ON social_event_players;
CREATE POLICY "social_event_players_insert" ON social_event_players FOR INSERT WITH CHECK (
  (
    event_id IN (SELECT id FROM social_events WHERE host_player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid()))
    AND paid = false
    AND (
      status = 'invited'
      -- the host's own row, created as 'accepted' with the event
      OR (status = 'accepted' AND player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid()))
    )
    AND player_id IN (
      SELECT sm.player_id FROM society_members sm
      WHERE sm.society_id = (SELECT se.society_id FROM social_events se WHERE se.id = event_id)
    )
  )
  OR (
    player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
    AND event_id IN (SELECT id FROM social_events WHERE status = 'open')
    AND status = 'accepted' AND source = 'chat' AND paid = false
  )
);
-- A player updates their own row only while it isn't 'removed' and the event
-- is open; the host updates any row of their events.
DROP POLICY IF EXISTS "social_event_players_update" ON social_event_players;
CREATE POLICY "social_event_players_update" ON social_event_players FOR UPDATE USING (
  (
    player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid())
    AND status <> 'removed'
    AND event_id IN (SELECT id FROM social_events WHERE status = 'open')
  )
  OR event_id IN (SELECT id FROM social_events WHERE host_player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid()))
);
DROP POLICY IF EXISTS "social_event_players_delete" ON social_event_players;
CREATE POLICY "social_event_players_delete" ON social_event_players FOR DELETE USING (
  event_id IN (SELECT id FROM social_events WHERE host_player_id IN (SELECT id FROM players WHERE auth_uid = auth.uid()))
);

-- Non-hosts may never touch money fields or re-point a row.
CREATE OR REPLACE FUNCTION social_event_players_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE host_uid UUID;
BEGIN
  SELECT p.auth_uid INTO host_uid
  FROM social_events se JOIN players p ON p.id = se.host_player_id
  WHERE se.id = NEW.event_id;
  IF host_uid IS NOT NULL AND host_uid = auth.uid() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.paid := false;
    NEW.paid_at := NULL;
  ELSE
    IF NEW.paid IS DISTINCT FROM OLD.paid
       OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
       OR NEW.event_id IS DISTINCT FROM OLD.event_id
       OR NEW.player_id IS DISTINCT FROM OLD.player_id
       OR NEW.source IS DISTINCT FROM OLD.source THEN
      RAISE EXCEPTION 'Only the host can change payment or ownership fields';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS social_event_players_guard_trg ON social_event_players;
CREATE TRIGGER social_event_players_guard_trg
  BEFORE INSERT OR UPDATE ON social_event_players
  FOR EACH ROW EXECUTE FUNCTION social_event_players_guard();

-- Invite DM card.
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS social_event_id UUID REFERENCES social_events(id) ON DELETE CASCADE;
ALTER TABLE direct_messages DROP CONSTRAINT IF EXISTS direct_messages_message_type_check;
ALTER TABLE direct_messages ADD CONSTRAINT direct_messages_message_type_check
  CHECK (message_type IN ('text', 'tournament_invite', 'newsreel', 'swindle_settlement', 'match_report', 'swindle_records', 'social_invite'));

-- Society chat announcement + per-event chat.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS social_event_id UUID REFERENCES social_events(id) ON DELETE CASCADE;
DO $$
DECLARE c TEXT;
BEGIN
  -- The original channel CHECK was added inline (auto-named); drop whatever
  -- check mentions "channel" rather than guessing its name.
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'messages'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%channel%'
  LOOP
    EXECUTE format('ALTER TABLE messages DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE messages ADD CONSTRAINT messages_channel_check CHECK (channel IN ('general', 'swindle', 'tour', 'social'));
CREATE INDEX IF NOT EXISTS messages_social_event_idx ON messages (social_event_id, created_at DESC) WHERE social_event_id IS NOT NULL;
