// Titan Way is the only tournament format that uses "Kronos" branding for the
// individual standings board — every other format shows the exact same
// underlying board, just labelled "Individual" (Rick's brief, 2026-08-22,
// section 4.4). One system, dynamic label — never a second leaderboard.
export function individualBoardLabel(format: string | null | undefined): 'Kronos' | 'Individual' {
  return format === 'titan_way' ? 'Kronos' : 'Individual';
}
