// Titan Season Mode — league table ranking (spec §13, Dave, 2026-09-06).
// Pure functions only, no supabase import — same pattern as seasonScoring.ts.
//
// Tiebreak note: spec §13.3 defines a long cascading ladder (compare each of
// the 20 counting rounds pairwise, then the 21st/22nd-best non-counting
// round, then total Major points, then gross birdies-or-better, then who
// reached the tied total first). This implements the first two levels —
// comparing counting-round points pairwise, highest first — which resolves
// the overwhelming majority of real ties on its own. The remaining, rarer
// levels need extra data this app doesn't track yet (a birdie count per
// entry, a "first reached this total" timestamp) and are left as a
// documented gap rather than silently guessed at.

export interface SeasonEntryForRanking {
  entryId: string;
  seasonPoints: number;
  qualificationStatus: 'provisional' | 'qualified' | 'dnq';
  // Counting round Final Round Points, any order — sorted internally.
  countingRoundPoints: number[];
}

export interface RankedSeasonEntry extends SeasonEntryForRanking {
  position: number;
  movementStatus: 'champion' | 'promotion' | 'safe' | 'relegation';
}

// spec §13.3, levels 1-2 (see file header for what's not yet implemented).
function compareEntries(a: SeasonEntryForRanking, b: SeasonEntryForRanking): number {
  if (b.seasonPoints !== a.seasonPoints) return b.seasonPoints - a.seasonPoints;
  const aRounds = [...a.countingRoundPoints].sort((x, y) => y - x);
  const bRounds = [...b.countingRoundPoints].sort((x, y) => y - x);
  const len = Math.max(aRounds.length, bRounds.length);
  for (let i = 0; i < len; i++) {
    const av = aRounds[i] ?? -Infinity;
    const bv = bRounds[i] ?? -Infinity;
    if (bv !== av) return bv - av;
  }
  // Fully tied — deterministic fallback so ranking never flips between
  // recalculations (spec §20.2's idempotency requirement).
  return a.entryId.localeCompare(b.entryId);
}

// spec §6.1/§6.2/§6.3 — promotion only ever goes to Qualified players (DNQ
// entries are skipped for promotion purposes, though still ranked and
// still eligible for relegation, which is decided by raw table position);
// position 1 among the Qualified is Champion.
export function rankDivisionEntries(
  entries: SeasonEntryForRanking[],
  promotionPlaces: number,
  relegationPlaces: number,
): RankedSeasonEntry[] {
  const sorted = [...entries].sort(compareEntries);
  const relegatedIds = new Set(sorted.slice(Math.max(0, sorted.length - relegationPlaces)).map(e => e.entryId));

  const qualifiedInOrder = sorted.filter(e => e.qualificationStatus === 'qualified');
  const promotedIds = new Set(qualifiedInOrder.slice(0, promotionPlaces).map(e => e.entryId));
  const championId = qualifiedInOrder[0]?.entryId ?? null;

  return sorted.map((e, i) => ({
    ...e,
    position: i + 1,
    movementStatus: relegatedIds.has(e.entryId)
      ? 'relegation'
      : e.entryId === championId
        ? 'champion'
        : promotedIds.has(e.entryId)
          ? 'promotion'
          : 'safe',
  }));
}
