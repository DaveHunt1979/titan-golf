// Titan Way is the only tournament format that uses "Kronos" branding for the
// individual standings board — every other format shows the exact same
// underlying board, just labelled "Individual" (Rick's brief, 2026-08-22,
// section 4.4). One system, dynamic label — never a second leaderboard.
export function individualBoardLabel(format: string | null | undefined): 'Kronos' | 'Individual' {
  return format === 'titan_way' ? 'Kronos' : 'Individual';
}

// Canonical match format naming (Rick's brief, section 8, 2026-08-24) —
// before this, the same match could be labelled "Singles" / "Singles
// Matchplay" / "Matchplay" / "MATCHPLAY" depending on which screen you were
// on, and 3 of those screens couldn't even tell Singles from 4BBB apart
// since they only read round_format (always 'matchplay' for all 4 formats).
// Every surface that shows a match/round format name should call this
// instead of deriving its own label.
export function matchFormatLabel(
  roundFormat: string | null | undefined,
  isSingles: boolean | null | undefined,
  handicapMethod: string | null | undefined,
): string {
  if (roundFormat === 'stableford') return 'Stableford';
  if (roundFormat === 'medal') return 'Stroke Play';
  if (roundFormat !== 'matchplay') return roundFormat ?? '';
  const stableford = handicapMethod === 'relative_low_stableford' || handicapMethod === 'individual_stableford';
  if (isSingles) return stableford ? 'Singles Match Play – Stableford' : 'Singles Match Play – Stroke Play';
  return stableford ? '4BBB Match Play – Stableford' : '4BBB Match Play – Stroke Play';
}
