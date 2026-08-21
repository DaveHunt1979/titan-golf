-- Drop the old restrictive constraint and replace with one that covers all supported formats
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_round_format_check;

ALTER TABLE matches
  ADD CONSTRAINT matches_round_format_check
  CHECK (round_format IN (
    'matchplay',
    'stableford',
    'medal',
    'skins',
    'nassau',
    'wolf',
    'scramble',
    'greensome',
    'foursomes',
    'bbb',
    'modified_stableford',
    'par_bogey',
    'chacha',
    'team_stableford'
  ));
