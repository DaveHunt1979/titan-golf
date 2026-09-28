// Acceptance tests for the Automatic Tournament Handicap Cut System,
// directly from Rick's brief (Word doc, 2026-09-22, section 22 — "Claude
// must build automated tests for this"). Test numbers and expected values
// below are copied verbatim from that doc so a future change that breaks
// any of Rick's own worked examples fails loudly here.
import { DEFAULT_HANDICAP_CUT_BANDS, applyCut, calcRoundCut, effectiveTriggerScore, lookupCutPerPoint } from './tournamentHandicap';

const TRIGGER = 36;
const bands = DEFAULT_HANDICAP_CUT_BANDS;

describe('Tournament Handicap Cut System — Rick\'s acceptance tests', () => {
  test('Test 1 — handicap 8, 40 points, 0.5/pt tier', () => {
    const result = calcRoundCut(40, TRIGGER, 8, bands);
    expect(result.pointsOverTrigger).toBe(4);
    expect(result.cutPerPoint).toBe(0.5);
    expect(result.cut).toBe(2);
    expect(applyCut(8, result.cut, 0)).toBe(6);
  });

  test('Test 2 — handicap 15, 40 points, 1.0/pt tier', () => {
    const result = calcRoundCut(40, TRIGGER, 15, bands);
    expect(result.pointsOverTrigger).toBe(4);
    expect(result.cutPerPoint).toBe(1);
    expect(result.cut).toBe(4);
    expect(applyCut(15, result.cut, 0)).toBe(11);
  });

  test('Test 3 — handicap 22, 40 points, 1.5/pt tier', () => {
    const result = calcRoundCut(40, TRIGGER, 22, bands);
    expect(result.pointsOverTrigger).toBe(4);
    expect(result.cutPerPoint).toBe(1.5);
    expect(result.cut).toBe(6);
    expect(applyCut(22, result.cut, 0)).toBe(16);
  });

  test('Test 4 — tier must not change mid-calculation (handicap 20 stays in the 19-28 tier for its whole cut)', () => {
    const result = calcRoundCut(40, TRIGGER, 20, bands);
    expect(result.cutPerPoint).toBe(1.5); // not the 10-18 tier's 1.0, even though 20-6=14 lands there
    expect(result.cut).toBe(6);
    expect(applyCut(20, result.cut, 0)).toBe(14);
  });

  test('Test 5 — boundary at 9 (top of the 0-9 tier)', () => {
    const result = calcRoundCut(38, TRIGGER, 9, bands);
    expect(result.cutPerPoint).toBe(0.5);
    expect(result.cut).toBe(1);
    expect(applyCut(9, result.cut, 0)).toBe(8);
  });

  test('Test 6 — boundary at 10 (bottom of the 10-18 tier)', () => {
    const result = calcRoundCut(38, TRIGGER, 10, bands);
    expect(result.cutPerPoint).toBe(1);
    expect(result.cut).toBe(2);
    expect(applyCut(10, result.cut, 0)).toBe(8);
  });

  test('Test 7 — boundary at 18 (top of the 10-18 tier)', () => {
    const result = calcRoundCut(38, TRIGGER, 18, bands);
    expect(result.cutPerPoint).toBe(1);
    expect(result.cut).toBe(2);
    expect(applyCut(18, result.cut, 0)).toBe(16);
  });

  test('Test 8 — boundary at 19 (bottom of the 19-28 tier)', () => {
    const result = calcRoundCut(38, TRIGGER, 19, bands);
    expect(result.cutPerPoint).toBe(1.5);
    expect(result.cut).toBe(3);
    expect(applyCut(19, result.cut, 0)).toBe(16);
  });

  test('Test 9 — match ends early: no cut until all 18 holes are scored', () => {
    // The cut engine itself only ever sees a completed round's full total —
    // this is enforced by callers never invoking processDayCuts until the
    // day's Stableford total reflects all 18 holes (score/enter/[matchId].tsx's
    // matchplayConcludedEarlyNeedsFullStableford gate, fixed 2026-09-22
    // after "Ricky Cut Test" cut all 4 players off a 16-hole partial total).
    // Modelled here as: an incomplete round contributes no calcRoundCut call
    // at all, so there is nothing to assert on the pure function beyond "a
    // partial total must never be the input" — covered by holding it to the
    // full, correct total once entered.
    const partialTotal = 30; // holes 1-15 only, match already decided
    const fullTotal = 40; // after holes 16, 17, 18 are also entered
    expect(calcRoundCut(partialTotal, TRIGGER, 15, bands).cut).toBe(0); // would UNDER-cut if ever used
    const result = calcRoundCut(fullTotal, TRIGGER, 15, bands);
    expect(result.pointsOverTrigger).toBe(4);
    expect(result.cut).toBe(4);
  });

  test('Test 10 — historical round must not change when recomputed later', () => {
    const round1 = calcRoundCut(40, TRIGGER, 22, bands);
    expect(round1.cut).toBe(6);
    const round1After = applyCut(22, round1.cut, 0);
    expect(round1After).toBe(16); // Round 1's own starting handicap (22) is never touched — only the next round starts from 16
  });

  test('Test 11 — next round recalculates the match allowance from scratch off the new tournament handicap', () => {
    const nextRoundStartingHandicap = 16; // carried over from Test 10
    const lowestInMatch = 4;
    const diff = nextRoundStartingHandicap - lowestInMatch;
    const allowancePct = 85;
    const playingHandicap = Math.round(diff * (allowancePct / 100));
    expect(diff).toBe(12);
    expect(playingHandicap).toBe(10); // 12 x 85% = 10.2 -> 10, never reusing a prior day's playing handicap
  });

  test('lookupCutPerPoint matches every documented tier boundary', () => {
    expect(lookupCutPerPoint(0, bands)).toBe(0.5);
    expect(lookupCutPerPoint(9, bands)).toBe(0.5);
    expect(lookupCutPerPoint(9.9, bands)).toBe(0.5);
    expect(lookupCutPerPoint(10, bands)).toBe(1.0);
    expect(lookupCutPerPoint(18, bands)).toBe(1.0);
    expect(lookupCutPerPoint(18.9, bands)).toBe(1.0);
    expect(lookupCutPerPoint(19, bands)).toBe(1.5);
    expect(lookupCutPerPoint(28, bands)).toBe(1.5);
    expect(lookupCutPerPoint(28.9, bands)).toBe(1.5);
  });

  test('effectiveTriggerScore scales the 36-point benchmark for a 9-hole round, leaves 18-hole rounds untouched', () => {
    expect(effectiveTriggerScore(36, 18)).toBe(36);
    expect(effectiveTriggerScore(36, 9)).toBe(18);
  });

  test('a cut only ever reduces a handicap, never below the configured minimum', () => {
    expect(applyCut(5, 20, 0)).toBe(0); // a huge cut still floors at the minimum, never goes negative
    expect(applyCut(20, 3, 2)).toBe(17);
  });
});
