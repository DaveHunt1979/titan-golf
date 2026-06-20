-- Add Instagram URL to societies
ALTER TABLE societies ADD COLUMN IF NOT EXISTS instagram_url TEXT;
