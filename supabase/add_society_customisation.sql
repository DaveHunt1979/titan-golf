-- ============================================================
-- Society Customisation — branding fields + team logos
-- Run in Supabase SQL Editor
-- ============================================================

-- Add branding columns to societies
ALTER TABLE societies ADD COLUMN IF NOT EXISTS secondary_color TEXT;
ALTER TABLE societies ADD COLUMN IF NOT EXISTS tagline TEXT;

-- Add uploaded logo URL to teams (logo_key remains for local assets)
ALTER TABLE teams ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- ============================================================
-- society-assets storage bucket (logos, team crests)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'society-assets',
  'society-assets',
  true,
  10485760,   -- 10 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Any authenticated user can upload (admin check is at application layer)
CREATE POLICY "Authenticated upload society assets" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'society-assets' AND auth.uid() IS NOT NULL);

CREATE POLICY "Public read society assets" ON storage.objects
  FOR SELECT USING (bucket_id = 'society-assets');

CREATE POLICY "Authenticated update society assets" ON storage.objects
  FOR UPDATE USING (bucket_id = 'society-assets' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated delete society assets" ON storage.objects
  FOR DELETE USING (bucket_id = 'society-assets' AND auth.uid() IS NOT NULL);
