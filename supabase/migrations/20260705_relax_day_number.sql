-- competition_days.day_number was capped at 10, which breaks casual
-- rounds once a society plays more than 10 game days.
ALTER TABLE competition_days
  DROP CONSTRAINT IF EXISTS competition_days_day_number_check;

ALTER TABLE competition_days
  ADD CONSTRAINT competition_days_day_number_check
  CHECK (day_number BETWEEN 1 AND 9999);
