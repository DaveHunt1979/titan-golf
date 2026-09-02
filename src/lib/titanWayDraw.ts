// Titan Way whole-tournament draw engine (Rick's brief, 2026-08-25). All
// qualifying 4BBB rounds are generated TOGETHER as one schedule, not day by
// day — this is the core rule the rest of this file exists to satisfy.
//
// Team-vs-team pairings per day reuse the exact circle-method rotation
// already used by admin/draw.tsx's round-robin branch (extracted here
// verbatim as computeRoundRobinMatchups, no behaviour change) — that part
// already handles team-level opponent variety correctly. The genuinely new
// problem this file solves is WHICH 2 of a team's 4 players partner
// together each day: a 4-player roster has exactly 3 ways to split into 2
// pairs (AB/CD, AC/BD, AD/BC), so rather than a general constraint solver
// this runs a bounded randomized multi-restart search over that small
// space, scoring each candidate whole-tournament schedule by how many
// repeat partnerships/opponents it produces, and keeps the best.
import type { FormatRules } from './tournamentFormat';

// ── Team-vs-team scheduling (unchanged logic, made reusable) ──

export function computeRoundRobinMatchups(
  teamIds: string[],
  dayNumber: number,
): [string, string][] {
  const hasBye = teamIds.length % 2 !== 0;
  const scheduleIds: (string | null)[] = hasBye ? [...teamIds, null] : [...teamIds];
  const rot = (dayNumber - 1) % Math.max(1, scheduleIds.length - 1);
  const inner = [...scheduleIds.slice(1)];
  for (let r = 0; r < rot; r++) inner.push(inner.shift()!);
  const rotated = [scheduleIds[0], ...inner];

  const pairs: [string, string][] = [];
  for (let i = 0; i < Math.floor(rotated.length / 2); i++) {
    const tH = rotated[i];
    const tA = rotated[rotated.length - 1 - i];
    if (!tH || !tA) continue; // one side is the bye this day
    pairs.push([tH, tA]);
  }
  return pairs;
}

// ── Hard/optimisation constraint shape (v1: structural only — see §5 of the
// plan; a future organiser-configurable required/prohibited-matchup UI can
// add new `kind` values and score terms without touching the core loop
// below, since that loop only ever consumes "is this candidate valid" +
// "how much does this candidate cost", never branching on `kind` itself) ──

export type TitanWayConstraintKind =
  | 'exact_team_size'
  | 'even_teams'
  | 'odd_teams'
  | 'min_teams'
  | 'max_teams'
  | 'captain_rotation';

export interface TitanWayConstraint {
  kind: TitanWayConstraintKind;
  severity: 'hard' | 'optimisation';
  describe(): string;
}

export function buildTitanWayConstraints(rules: FormatRules): TitanWayConstraint[] {
  const constraints: TitanWayConstraint[] = [
    { kind: 'min_teams', severity: 'hard', describe: () => `At least ${rules.minTeams} teams` },
    { kind: 'max_teams', severity: 'hard', describe: () => `At most ${rules.maxTeams} teams` },
  ];
  if (rules.requiresEvenTeams) constraints.push({ kind: 'even_teams', severity: 'hard', describe: () => 'An even number of teams' });
  if (rules.requiresOddTeams) constraints.push({ kind: 'odd_teams', severity: 'hard', describe: () => 'An odd number of teams' });
  constraints.push(
    { kind: 'exact_team_size', severity: 'hard', describe: () => `Exactly ${rules.exactPlayersPerTeam} players per team` },
    { kind: 'captain_rotation', severity: 'optimisation', describe: () => 'Spread each captain across different partners in opening rounds' },
  );
  return constraints;
}

// ── Whole-tournament partnership-split optimizer ──

export interface TeamDayPairing { pair1: [string, string]; pair2: [string, string]; }

export interface TitanWayInputs {
  teamIds: string[];
  rosterByTeam: Record<string, string[]>;       // exactly 4 players each
  qualifyingDayNumbers: number[];                 // every day except the final
}

// The 3 ways to split a 4-player roster into 2 unordered pairs.
function partnershipSplits(roster: [string, string, string, string]): TeamDayPairing[] {
  const [a, b, c, d] = roster;
  return [
    { pair1: [a, b], pair2: [c, d] },
    { pair1: [a, c], pair2: [b, d] },
    { pair1: [a, d], pair2: [b, c] },
  ];
}

function randomPairingKey(pair: [string, string]): string {
  return [...pair].sort().join('|');
}

export interface TitanWaySchedule {
  pairingsByDay: Record<number, Record<string, TeamDayPairing>>;
  score: number; // lower is better; 0 = no repeats at all
}

// Bounded multi-restart random search. Search space per team is only 3
// choices^(qualifying days) — trivially small even at 12 teams × 6 rounds —
// so this stays well under the time budget on any real device without
// needing a Web Worker or async chunking.
//
// Captain Rotation (the existing opening-rounds captain-partner-spread
// feature) is deliberately NOT special-cased here: minimising repeat
// partnerships tournament-wide already produces "captain partners with
// someone new" as a natural consequence, since a captain is just another
// player in the pool being optimised against the same objective. Adding a
// separate captain-specific rule would duplicate what the general
// objective already achieves.
export function generateTitanWaySchedule(inputs: TitanWayInputs): TitanWaySchedule {
  const { teamIds, rosterByTeam, qualifyingDayNumbers } = inputs;
  const nCandidates = Math.min(2000, 200 * Math.max(1, qualifyingDayNumbers.length));
  const timeBudgetMs = 800;
  const startedAt = Date.now();

  let best: TitanWaySchedule | null = null;

  for (let attempt = 0; attempt < nCandidates; attempt++) {
    if (attempt % 100 === 0 && Date.now() - startedAt > timeBudgetMs) break;

    const pairingsByDay: Record<number, Record<string, TeamDayPairing>> = {};
    const partnerSeen = new Map<string, number>();
    const opponentSeen = new Map<string, number>();
    let repeatPartnerships = 0;
    let repeatOpponents = 0;

    for (const dayNumber of qualifyingDayNumbers) {
      pairingsByDay[dayNumber] = {};
      const dayMatchups = computeRoundRobinMatchups(teamIds, dayNumber);

      for (const tid of teamIds) {
        const roster = rosterByTeam[tid];
        if (!roster || roster.length !== 4) continue; // structural validation should already reject this — defensive only
        const splits = partnershipSplits(roster as [string, string, string, string]);
        const choice = splits[Math.floor(Math.random() * splits.length)];
        pairingsByDay[dayNumber][tid] = choice;

        [choice.pair1, choice.pair2].forEach(pair => {
          const key = randomPairingKey(pair);
          const count = partnerSeen.get(key) ?? 0;
          if (count > 0) repeatPartnerships += count;
          partnerSeen.set(key, count + 1);
        });
      }

      for (const [teamH, teamA] of dayMatchups) {
        const pairingH = pairingsByDay[dayNumber][teamH];
        const pairingA = pairingsByDay[dayNumber][teamA];
        if (!pairingH || !pairingA) continue;
        const playersH = [...pairingH.pair1, ...pairingH.pair2];
        const playersA = [...pairingA.pair1, ...pairingA.pair2];
        for (const pH of playersH) for (const pA of playersA) {
          const key = randomPairingKey([pH, pA]);
          const count = opponentSeen.get(key) ?? 0;
          if (count > 0) repeatOpponents += count;
          opponentSeen.set(key, count + 1);
        }
      }
    }

    // Partnership repeats weighted higher than opponent repeats — a repeat
    // partner is a stronger "boring draw" signal than a repeat opponent.
    const score = repeatPartnerships * 3 + repeatOpponents;
    if (!best || score < best.score) best = { pairingsByDay, score };
    if (score === 0) break; // can't do better than zero repeats
  }

  return best ?? { pairingsByDay: {}, score: Infinity };
}
