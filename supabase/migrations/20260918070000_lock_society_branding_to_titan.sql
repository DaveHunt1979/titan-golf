-- Lock every society to the fixed Titan black/gold branding.
--
-- Societies could previously pick their own primary/secondary colour, which
-- reskinned large parts of the app via a derived dark palette. That has been
-- removed from the app — admins now only customise their logo and hero image.
-- Reset every society that drifted from Titan's colours back to them so
-- existing societies match the new locked branding, not just new ones.
--
-- The primary_color / secondary_color columns are deliberately KEPT (the app
-- and the web admin still read them); only the data is reset.
-- logo_url / hero_url are untouched.

UPDATE societies
SET primary_color   = '#D4AF37',
    secondary_color = '#1B3A5C'
WHERE primary_color   IS DISTINCT FROM '#D4AF37'
   OR secondary_color IS DISTINCT FROM '#1B3A5C';
