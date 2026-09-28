// Pure handicap-division math shared by PrizeCategoriesEditor's "Auto-Split
// into 3 Divisions" button and the tournament simulator's prize-money
// fail-safe coverage (Dave, 2026-09-18) — one implementation so a sim run
// and a real admin's manual split can never disagree on where the band
// boundaries fall for the same set of enrolled handicaps.
export interface HandicapDivisions { div1Max: number; div2Max: number }

// Needs at least 3 distinct handicap values to produce 3 meaningful bands —
// returns null otherwise, same fail-safe the live editor already enforces
// before letting an admin split with too little handicap variety.
export function computeHandicapDivisions(distinctSortedHcps: number[]): HandicapDivisions | null {
  const dn = distinctSortedHcps.length;
  if (dn < 3) return null;
  return {
    div1Max: distinctSortedHcps[Math.floor(dn / 3) - 1],
    div2Max: distinctSortedHcps[Math.floor((2 * dn) / 3) - 1],
  };
}
