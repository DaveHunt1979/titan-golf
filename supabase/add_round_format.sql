-- Add round_format to matches so solo stableford/medal rounds can be distinguished from matchplay
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS round_format TEXT DEFAULT 'matchplay'
    CHECK (round_format IN ('matchplay', 'stableford', 'medal'));
