import { ninesAllocation, calcNines, summariseNines, splitPence, NinesPlayer } from './swindleNines';

const holesOf = (pts: number[], start = 1): Record<number, number> =>
  Object.fromEntries(pts.map((p, i) => [start + i, p]));
const player = (id: string, pts: number[]): NinesPlayer => ({ id, name: id, holes: holesOf(pts) });
const flat = (n: number) => Array(18).fill(n);

describe('ninesAllocation', () => {
  it('fixed: £20 entry, £5/£5/£5 leaves £5 for the main swindle', () => {
    const a = ninesAllocation({ enabled: true, mode: 'fixed', front: 5, back: 5, overall: 5 }, 20);
    expect(a).toMatchObject({ front: 500, back: 500, overall: 500, total: 1500, main: 500, overAllocated: false });
  });
  it('percent: 25% of £20 is £5', () => {
    const a = ninesAllocation({ enabled: true, mode: 'percent', front: 25, back: 25, overall: 25 }, 20);
    expect(a.front).toBe(500);
    expect(a.main).toBe(500);
  });
  it('flags over-allocation', () => {
    const a = ninesAllocation({ enabled: true, mode: 'fixed', front: 10, back: 10, overall: 10 }, 20);
    expect(a.overAllocated).toBe(true);
  });
  it('disabled leaves the whole entry for the main swindle', () => {
    const a = ninesAllocation({ enabled: false, mode: 'fixed', front: 5, back: 5, overall: 5 }, 20);
    expect(a).toMatchObject({ total: 0, main: 2000 });
  });
});

describe('splitPence', () => {
  it('never loses or invents pence', () => {
    expect(splitPence(1000, 3)).toEqual([334, 333, 333]);
    expect(splitPence(1000, 3).reduce((a, b) => a + b, 0)).toBe(1000);
  });
});

describe('calcNines', () => {
  it('clear front 9 winner takes the whole pot', () => {
    const a = player('A', [...Array(9).fill(3), ...Array(9).fill(1)]);
    const b = player('B', [...Array(9).fill(2), ...Array(9).fill(2)]);
    const r = calcNines('front', [a, b], 500, 2);
    expect(r.winners.map(w => w.id)).toEqual(['A']);
    expect(r.winners[0].sharePence).toBe(1000);
    expect(r.decidedBy).toBeNull();
  });

  it('front 9: tie decided on the last 6 holes', () => {
    // Both 18 on the front. A is stronger on 4–9.
    const a = player('A', [0, 0, 0, 3, 3, 3, 3, 3, 3, ...flat(0).slice(9)]);
    const b = player('B', [3, 3, 3, 0, 0, 0, 3, 3, 3, ...flat(0).slice(9)]);
    const r = calcNines('front', [a, b], 500, 2);
    expect(r.winners.map(w => w.id)).toEqual(['A']);
    expect(r.decidedBy).toBe('Last 6 holes (4–9)');
  });

  it('front 9: falls through to hole 9, then 8 individually', () => {
    // Identical on 4–9 and 7–9 totals, differ only on hole 9 vs 8.
    const a = player('A', [1, 1, 1, 1, 1, 1, 2, 1, 3, ...flat(0).slice(9)]);
    const b = player('B', [1, 1, 1, 1, 1, 1, 2, 3, 1, ...flat(0).slice(9)]);
    const r = calcNines('front', [a, b], 500, 2);
    expect(r.winners.map(w => w.id)).toEqual(['A']);
    expect(r.decidedBy).toBe('Hole 9');
  });

  it('back 9 uses the last 6 / 3 / 18th', () => {
    const a = player('A', [...flat(0).slice(0, 9), 0, 0, 0, 0, 0, 0, 3, 3, 3]);
    const b = player('B', [...flat(0).slice(0, 9), 3, 3, 3, 0, 0, 0, 0, 0, 0]);
    const r = calcNines('back', [a, b], 500, 2);
    expect(r.winners.map(w => w.id)).toEqual(['A']);
    expect(r.decidedBy).toBe('Last 6 holes (13–18)');
  });

  it('overall countback starts with the back 9', () => {
    const a = player('A', [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
    const b = player('B', [2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const r = calcNines('overall', [a, b], 500, 2);
    expect(r.winners.map(w => w.id)).toEqual(['A']);
    expect(r.decidedBy).toBe('Last 9 holes (10–18)');
  });

  it('complete dead heat splits the prize with exact pence', () => {
    const players = ['A', 'B', 'C'].map(id => player(id, flat(2)));
    const r = calcNines('overall', players, 500, 3);
    expect(r.deadHeat).toBe(true);
    expect(r.winners.map(w => w.sharePence)).toEqual([500, 500, 500]);
    const odd = calcNines('overall', players, 333, 3);
    expect(odd.winners.reduce((t, w) => t + w.sharePence, 0)).toBe(999);
  });

  it('a player with an incomplete nine does not qualify', () => {
    const full = player('A', [...Array(9).fill(1), ...Array(9).fill(1)]);
    const partial: NinesPlayer = { id: 'B', name: 'B', holes: holesOf([4, 4, 4, 4, 4, 4, 4, 4]) };
    const r = calcNines('front', [full, partial], 500, 2);
    expect(r.qualified).toBe(1);
    expect(r.winners.map(w => w.id)).toEqual(['A']);
  });

  it('overall needs a full 18 even if the front 9 is complete', () => {
    const partial: NinesPlayer = { id: 'B', name: 'B', holes: holesOf(Array(9).fill(4)) };
    expect(calcNines('overall', [partial], 500, 1).winners).toEqual([]);
  });

  it('works for a group that started on the 10th (hole numbers are course holes)', () => {
    const a: NinesPlayer = { id: 'A', name: 'A', holes: { ...holesOf(Array(9).fill(1), 10), ...holesOf(Array(9).fill(2), 1) } };
    const b: NinesPlayer = { id: 'B', name: 'B', holes: { ...holesOf(Array(9).fill(2), 10), ...holesOf(Array(9).fill(1), 1) } };
    expect(calcNines('front', [a, b], 500, 2).winners[0].id).toBe('A');
    expect(calcNines('back', [a, b], 500, 2).winners[0].id).toBe('B');
  });

  it('zero allocation produces no winners', () => {
    expect(calcNines('front', [player('A', flat(2))], 0, 1).winners).toEqual([]);
  });
});

describe('summariseNines', () => {
  it('totals a player who wins two prizes', () => {
    const a = player('A', [...Array(9).fill(3), ...Array(9).fill(3)]);
    const b = player('B', [...Array(9).fill(1), ...Array(9).fill(1)]);
    const s = summariseNines({ enabled: true, mode: 'fixed', front: 5, back: 5, overall: 5 }, 20, [a, b], 2);
    expect(s.winnings).toEqual([{ id: 'A', name: 'A', pence: 3000 }]);
  });
});
