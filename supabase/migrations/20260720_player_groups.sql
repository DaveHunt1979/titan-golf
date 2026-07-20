-- Player groups: saved 4-balls / squads that can be quickly loaded when creating a game
CREATE TABLE IF NOT EXISTS player_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id  UUID NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  player_ids  UUID[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_groups_society_idx ON player_groups(society_id);

ALTER TABLE player_groups ENABLE ROW LEVEL SECURITY;

-- Society members can read groups for their society
CREATE POLICY "society members read groups"
  ON player_groups FOR SELECT
  USING (
    society_id IN (
      SELECT society_id FROM players WHERE auth_uid = auth.uid()
    )
  );

-- Society admins can insert / update / delete
CREATE POLICY "society admins manage groups"
  ON player_groups FOR ALL
  USING (
    society_id IN (
      SELECT id FROM societies WHERE admin_uid = auth.uid()
    )
  )
  WITH CHECK (
    society_id IN (
      SELECT id FROM societies WHERE admin_uid = auth.uid()
    )
  );
