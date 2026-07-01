-- Society records — all-time bests per record type
CREATE TABLE IF NOT EXISTS society_records (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id   UUID NOT NULL,
  record_type  TEXT NOT NULL CHECK (record_type IN (
    'best_gross_18', 'best_stableford_18', 'most_birdies_round', 'most_eagles_round'
  )),
  player_id    UUID,
  player_name  TEXT NOT NULL DEFAULT '',
  value        NUMERIC NOT NULL,
  match_id     UUID,
  course_name  TEXT,
  achieved_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (society_id, record_type)
);

ALTER TABLE society_records ENABLE ROW LEVEL SECURITY;

-- All society members can read records
CREATE POLICY "society_records_select" ON society_records FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM society_members sm
      JOIN players p ON p.id = sm.player_id
      WHERE p.auth_uid = auth.uid()
        AND sm.society_id = society_records.society_id
    )
  );

-- All society members can upsert (record check happens client-side before write)
CREATE POLICY "society_records_upsert" ON society_records FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM society_members sm
      JOIN players p ON p.id = sm.player_id
      WHERE p.auth_uid = auth.uid()
        AND sm.society_id = society_records.society_id
    )
  );
