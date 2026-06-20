-- Course metadata table for lat/lng (populated when importing from UK Golf API)

CREATE TABLE IF NOT EXISTS courses (
  name TEXT PRIMARY KEY,
  lat  DOUBLE PRECISION,
  lng  DOUBLE PRECISION
);

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'courses' AND policyname = 'Auth select courses') THEN
    CREATE POLICY "Auth select courses" ON courses FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'courses' AND policyname = 'Auth insert courses') THEN
    CREATE POLICY "Auth insert courses" ON courses FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'courses' AND policyname = 'Auth update courses') THEN
    CREATE POLICY "Auth update courses" ON courses FOR UPDATE USING (auth.uid() IS NOT NULL);
  END IF;
END $$;
