// Titan Season Mode — league table ranking, ported verbatim from the mobile
// app's src/lib/seasonLeaderboard.ts so the web shows the same order the app
// does. Pure functions only — no supabase import.
//
// Same documented gap as mobile: spec §13.3's tiebreak ladder is implemented
// to levels 1-2 (season points, then counting-round points pairwise); the
// deeper levels need data this app doesn't track yet.

export interface SeasonEntryForRanking {
  entryId: string;
  seasonPoints: number;
  qualificationStatus: 'provisional' | 'qualified' | 'dnq';
  /** Counting round Final Round Points, any order — sorted internally. */
  countingRoundPoints: number[];
}

export type MovementStatus = 'champion' | 'promotion' | 'safe' | 'relegation';

export interface RankedSeasonEntry extends SeasonEntryForRanking {
  position: number;
  movementStatus: MovementStatus;
}

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
// entries are skipped for promotion, though still ranked and still eligible
// for relegation, which is decided by raw table position); position 1 among
// the Qualified is Champion.
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
