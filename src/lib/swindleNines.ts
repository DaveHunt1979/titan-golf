// Swindle "Nines Prizes" side game: Front 9, Back 9 and Overall Stableford
// prizes carved out of each player's entry fee, with automatic countback.
// Pure functions only — the Swindle screen, the share/chat results and the AI
// report all read the same output so they can never disagree.
// All money is handled in whole pence to avoid rounding drift.

export type NinesMode = 'fixed' | 'percent';
export type NinesKey = 'front' | 'back' | 'overall';

export interface NinesConfig {
  enabled: boolean;
  mode: NinesMode;
  front: number;    // £ per player if mode=fixed, % of entry fee if mode=percent
  back: number;
  overall: number;
}

export interface NinesAllocation {
  front: number;    // pence per player
  back: number;
  overall: number;
  total: number;    // front + back + overall
  main: number;     // what is left for the main swindle, pence per player
  overAllocated: boolean;
}

const toPence = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100);

export function ninesAllocation(cfg: NinesConfig, entryFee: number): NinesAllocation {
  const entry = toPence(entryFee);
  if (!cfg.enabled) return { front: 0, back: 0, overall: 0, total: 0, main: entry, overAllocated: false };
  const one = (v: number) => Math.max(0, cfg.mode === 'percent' ? Math.round(entry * (Number.isFinite(v) ? v : 0) / 100) : toPence(v));
  const front = one(cfg.front), back = one(cfg.back), overall = one(cfg.overall);
  const total = front + back + overall;
  return { front, back, overall, total, main: entry - total, overAllocated: total > entry };
}

// Hole sets compared in order until one player is strictly ahead. The label is
// what the results screen shows as the deciding countback.
interface Step { label: string; holes: number[] }
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const singles = (from: number, to: number): Step[] => {
  const out: Step[] = [];
  for (let h = from; h >= to; h--) out.push({ label: `Hole ${h}`, holes: [h] });
  return out;
};

const STEPS: Record<NinesKey, Step[]> = {
  front: [
    { label: 'Last 6 holes (4–9)', holes: range(4, 9) },
    { label: 'Last 3 holes (7–9)', holes: range(7, 9) },
    ...singles(9, 1),
  ],
  back: [
    { label: 'Last 6 holes (13–18)', holes: range(13, 18) },
    { label: 'Last 3 holes (16–18)', holes: range(16, 18) },
    ...singles(18, 10),
  ],
  overall: [
    { label: 'Last 9 holes (10–18)', holes: range(10, 18) },
    { label: 'Last 6 holes (13–18)', holes: range(13, 18) },
    { label: 'Last 3 holes (16–18)', holes: range(16, 18) },
    ...singles(18, 1),
  ],
};

const HOLES: Record<NinesKey, number[]> = {
  front: range(1, 9), back: range(10, 18), overall: range(1, 18),
};

export const NINES_LABEL: Record<NinesKey, string> = {
  front: 'Front 9', back: 'Back 9', overall: 'Overall',
};

export interface NinesPlayer {
  id: string;
  name: string;
  // course hole number -> Stableford points for that hole (any start hole)
  holes: Record<number, number>;
}

export interface NinesResult {
  key: NinesKey;
  label: string;
  potPence: number;
  qualified: number;                     // players with a complete card for this prize
  winners: { id: string; name: string; points: number; sharePence: number }[];
  decidedBy: string | null;              // countback step that split a tie, null if clear win/dead heat
  countback: { id: string; name: string; score: number }[];  // scores at the deciding step
  deadHeat: boolean;                     // still level after every step — prize split equally
}

const sum = (p: NinesPlayer, holes: number[]) => holes.reduce((t, h) => t + (p.holes[h] ?? 0), 0);

// Splits pence exactly: any odd pence go one each to the first winners, so the
// shares always add back up to the pot.
export function splitPence(pot: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(pot / n);
  const extra = pot - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

export function calcNines(
  key: NinesKey, players: NinesPlayer[], perPlayerPence: number, entrants: number,
): NinesResult {
  const potPence = perPlayerPence * entrants;
  const base: NinesResult = {
    key, label: NINES_LABEL[key], potPence, qualified: 0, winners: [],
    decidedBy: null, countback: [], deadHeat: false,
  };
  if (perPlayerPence <= 0) return base;

  // A player needs every hole of the nine (or all 18) to qualify.
  const eligible = players.filter(p => HOLES[key].every(h => p.holes[h] != null));
  base.qualified = eligible.length;
  if (eligible.length === 0) return base;

  const top = Math.max(...eligible.map(p => sum(p, HOLES[key])));
  let tied = eligible.filter(p => sum(p, HOLES[key]) === top);
  let decidedBy: string | null = null;
  let countback: NinesResult['countback'] = [];

  if (tied.length > 1) {
    for (const step of STEPS[key]) {
      const best = Math.max(...tied.map(p => sum(p, step.holes)));
      const next = tied.filter(p => sum(p, step.holes) === best);
      countback = tied.map(p => ({ id: p.id, name: p.name, score: sum(p, step.holes) }));
      if (next.length < tied.length) {
        tied = next;
        decidedBy = step.label;
        if (tied.length === 1) break;
      }
    }
  }

  const shares = splitPence(potPence, tied.length);
  return {
    ...base,
    winners: tied.map((p, i) => ({ id: p.id, name: p.name, points: top, sharePence: shares[i] })),
    decidedBy,
    countback: decidedBy || tied.length > 1 ? countback : [],
    deadHeat: tied.length > 1,
  };
}

export interface NinesSummary {
  allocation: NinesAllocation;
  results: NinesResult[];
  // pence won per player across all three prizes
  winnings: { id: string; name: string; pence: number }[];
}

export function summariseNines(
  cfg: NinesConfig, entryFee: number, players: NinesPlayer[], entrants: number,
): NinesSummary {
  const allocation = ninesAllocation(cfg, entryFee);
  if (!cfg.enabled) return { allocation, results: [], winnings: [] };
  const results = (['front', 'back', 'overall'] as NinesKey[])
    .map(k => calcNines(k, players, allocation[k], entrants));
  const totals = new Map<string, { id: string; name: string; pence: number }>();
  for (const r of results) for (const w of r.winners) {
    const cur = totals.get(w.id) ?? { id: w.id, name: w.name, pence: 0 };
    cur.pence += w.sharePence;
    totals.set(w.id, cur);
  }
  return { allocation, results, winnings: [...totals.values()].sort((a, b) => b.pence - a.pence) };
}

export const fmtMoney = (pence: number, currency = '£') =>
  `${currency}${(pence / 100).toFixed(pence % 100 === 0 ? 0 : 2)}`;
