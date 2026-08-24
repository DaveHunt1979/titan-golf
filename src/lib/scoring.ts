// Scoring engine — ported from Titan Tour 2026 (index.html)
// All logic verified against the 2026 fixture corpus

export type HoleResult = 'h' | 'a' | 'f' | null;

export type ScoreCategory = 'eagle' | 'birdie' | 'par' | 'bogey' | 'double';

// holes_string is indexed by absolute hole number (position 0 = hole 1),
// but a shifted (shotgun) start plays holes in wrapped order starting from
// start_hole. Reordering into actual play order before scanning for the
// first '.' is what lets an in-progress shifted-start match be recognised as
// "some holes played" instead of reading as 0 — without this, holes_string[0]
// (hole 1, not yet reached) breaks the scan immediately.
function playOrderChars(holesStr: string, startHole: number): string[] {
  const chars = holesStr.split('');
  if (startHole <= 1) return chars;
  const startIdx = startHole - 1;
  return [...chars.slice(startIdx), ...chars.slice(0, startIdx)];
}

export function calcHoles(holesStr: string, totalHoles = 18, startHole = 1): {
  homeUp: number;
  played: number;
  remaining: number;
  concluded: boolean;
} {
  const chars = playOrderChars(holesStr, startHole);
  let homeUp = 0, played = 0;
  for (const c of chars) {
    if (c === '.') break;
    if (c === 'h') homeUp++;
    else if (c === 'a') homeUp--;
    played++;
  }
  const remaining = totalHoles - played;
  const concluded = remaining > 0 && Math.abs(homeUp) > remaining;
  return { homeUp, played, remaining, concluded };
}

export function getEffectiveWinner(
  status: 'upcoming' | 'in_progress' | 'complete',
  winner: string | null,
  holesStr: string,
  totalHoles = 18,
  startHole = 1
): 'home' | 'away' | 'half' | null {
  if (status === 'complete') return winner as 'home' | 'away' | 'half' | null;
  if (status === 'in_progress') {
    const { homeUp, played, remaining, concluded } = calcHoles(holesStr, totalHoles, startHole);
    if (concluded) return homeUp > 0 ? 'home' : 'away';
    if (played === totalHoles) return homeUp === 0 ? 'half' : homeUp > 0 ? 'home' : 'away';
  }
  return null;
}

export function matchLabel(
  status: 'upcoming' | 'in_progress' | 'complete',
  winner: string | null,
  resultStr: string | null,
  holesStr: string,
  totalHoles = 18,
  startHole = 1
): string {
  if (status === 'complete') return resultStr ?? 'Complete';
  if (status === 'upcoming') return 'Upcoming';
  const { homeUp, played, remaining, concluded } = calcHoles(holesStr, totalHoles, startHole);
  if (played === 0) return 'In Progress';
  if (concluded) return `${Math.abs(homeUp)}&${remaining}`;
  if (isDormie(homeUp, remaining)) return 'Dormie';
  if (played === totalHoles) return homeUp === 0 ? 'AS' : `${Math.abs(homeUp)}UP`;
  if (homeUp === 0) return `AS (${played})`;
  return `${Math.abs(homeUp)}UP (${played})`;
}

// The leader only needs to halve every remaining hole to win — the classic
// match-play "dormie" state. Only meaningful before the match has actually
// concluded (calcHoles' `concluded` already covers "won by more than what's
// left"), and only while holes remain to play.
export function isDormie(homeUp: number, remaining: number): boolean {
  return remaining > 0 && Math.abs(homeUp) === remaining;
}

// Handicap calculations (WHS formula)
export function calcCourseHandicap(
  handicapIndex: number,
  slopeRating: number,
  courseRating: number,
  par: number
): number {
  return Math.round(handicapIndex * (slopeRating / 113) + (courseRating - par));
}

export function calcStrokesReceived(
  courseHandicap: number,
  strokeIndex: number  // 1-18
): number {
  if (courseHandicap < 0) {
    return strokeIndex > 18 + courseHandicap ? -1 : 0;
  }
  return Math.floor(courseHandicap / 18) + (strokeIndex <= courseHandicap % 18 ? 1 : 0);
}

// Which physical holes a player gets a stroke on, for display on the
// matchplay screen (e.g. "Holes 1-8, 11") instead of raw Stableford points.
export function formatStrokeHoles(
  courseHandicap: number,
  courseHoles: { hole_number: number; stroke_index: number }[]
): string {
  if (courseHoles.length === 0) return '';
  // Grouped by exact stroke count so handicaps above 36 (a third stroke on
  // the hardest holes) still render correctly instead of capping at "×2".
  const byCount = new Map<number, number[]>();
  for (const h of courseHoles) {
    const strokes = calcStrokesReceived(courseHandicap, h.stroke_index);
    if (strokes < 1) continue;
    if (!byCount.has(strokes)) byCount.set(strokes, []);
    byCount.get(strokes)!.push(h.hole_number);
  }
  if (byCount.size === 0) return 'Off Scratch';

  const rangify = (nums: number[]) => {
    const sorted = [...nums].sort((a, b) => a - b);
    const ranges: string[] = [];
    let start = sorted[0], prev = sorted[0];
    for (let i = 1; i <= sorted.length; i++) {
      const cur = sorted[i];
      if (cur === prev + 1) { prev = cur; continue; }
      ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = cur; prev = cur;
    }
    return ranges.join(', ');
  };

  const allHoles = [...byCount.values()].flat();
  let out = `Holes ${rangify(allHoles)}`;
  const extras = [...byCount.entries()].filter(([count]) => count >= 2).sort((a, b) => a[0] - b[0]);
  if (extras.length > 0) {
    out += ` (${extras.map(([count, holes]) => `×${count}: ${rangify(holes)}`).join(', ')})`;
  }
  return out;
}

export function calcStablefordPoints(
  gross: number | null,
  par: number,
  strokesReceived: number
): number {
  if (gross === null) return 0;
  return Math.max(0, 2 + par + strokesReceived - gross);
}

// Handicap differential for 4BBB matchplay (75% or 85%)
export function calcMatchplayHandicap(
  player1Hcp: number,
  player2Hcp: number,
  opponentHcp: number,
  allowancePct: number  // 0.75 or 0.85
): number {
  const teamBetter = Math.min(player1Hcp, player2Hcp);
  const diff = Math.abs(teamBetter - opponentHcp);
  return Math.round(diff * allowancePct);
}

export interface TeamStanding {
  teamId: string;
  pts: number;
  bonus: number;
  w: number;
  h: number;
  l: number;
  played: number;
  stableford: number;
}

export function getStandings(
  matches: Array<{
    home_team_id: string;
    away_team_id: string;
    status: string;
    winner: string | null;
    result_str: string | null;
    holes_string: string;
    is_singles: boolean;
    holes_to_play?: number | null;
    start_hole?: number | null;
  }>,
  ptsWin = 1,
  ptsHalf = 0.5,
  // Combined Stableford total per team — tie-break rung 1. Optional so
  // existing callers that don't have it yet still work (falls back to 0,
  // which just skips straight to the head-to-head rung below).
  teamStableford: Record<string, number> = {},
  // Bonus points (e.g. sweeping all singles on a day) — baked into `pts`
  // up front so they affect sort order, not just a display add-on.
  bonusPts: Record<string, number> = {},
): TeamStanding[] {
  const teamMap = new Map<string, TeamStanding>();
  const ensure = (id: string) => {
    if (!teamMap.has(id)) teamMap.set(id, {
      teamId: id, pts: bonusPts[id] ?? 0, bonus: bonusPts[id] ?? 0,
      w: 0, h: 0, l: 0, played: 0, stableford: teamStableford[id] ?? 0,
    });
    return teamMap.get(id)!;
  };

  // Tie-break rung 2 ("team placed above opponent"): if two teams are still
  // level after points + combined Stableford, whoever won more head-to-head
  // matches between them ranks above the other. Aggregated across every match
  // between the pair (not just whichever happened to run last), since a
  // 2-team tournament plays the same fixture repeatedly across days.
  const h2hKey = (a: string, b: string) => [a, b].sort().join('|');
  const h2hWins = new Map<string, Map<string, number>>();
  const recordH2h = (pairKey: string, winnerId: string) => {
    if (!h2hWins.has(pairKey)) h2hWins.set(pairKey, new Map());
    const rec = h2hWins.get(pairKey)!;
    rec.set(winnerId, (rec.get(winnerId) ?? 0) + 1);
  };

  for (const m of matches) {
    const winner = getEffectiveWinner(
      m.status as 'upcoming' | 'in_progress' | 'complete',
      m.winner,
      m.holes_string ?? '..................',
      m.holes_to_play ?? 18,
      m.start_hole ?? 1
    );
    if (!winner) continue;

    const home = ensure(m.home_team_id);
    const away = ensure(m.away_team_id);
    home.played++;
    away.played++;

    if (winner === 'half') {
      home.pts += ptsHalf; home.h++;
      away.pts += ptsHalf; away.h++;
    } else if (winner === 'home') {
      home.pts += ptsWin; home.w++;
      away.l++;
      recordH2h(h2hKey(m.home_team_id, m.away_team_id), m.home_team_id);
    } else {
      away.pts += ptsWin; away.w++;
      home.l++;
      recordH2h(h2hKey(m.home_team_id, m.away_team_id), m.away_team_id);
    }
  }

  return Array.from(teamMap.values()).sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.stableford !== a.stableford) return b.stableford - a.stableford;
    const rec = h2hWins.get(h2hKey(a.teamId, b.teamId));
    if (rec) {
      const aWins = rec.get(a.teamId) ?? 0;
      const bWins = rec.get(b.teamId) ?? 0;
      if (aWins !== bWins) return bWins - aWins;
    }
    return b.w - a.w;
  });
}

// Bonus points for sweeping every singles match on a day (e.g. winning all 4
// singles matches) — shared by the Tour leaderboard and the tournament draw
// screen's final-day knockout seeding, which must never compute this
// differently or the two screens can show contradictory team positions.
export function calcSweepBonus(
  matches: Array<{
    day_id: string | null;
    home_team_id: string | null;
    away_team_id: string | null;
    status: string;
    winner: string | null;
    holes_string: string;
    holes_to_play?: number | null;
    start_hole?: number | null;
  }>,
  singlesDayIds: Set<string>,
  bonusPoints: number,
): Record<string, number> {
  const bonusPts: Record<string, number> = {};
  const singlesByDay: Record<string, typeof matches> = {};
  matches.forEach(m => {
    if (!m.day_id || !singlesDayIds.has(m.day_id) || !m.home_team_id || !m.away_team_id) return;
    (singlesByDay[m.day_id] ??= []).push(m);
  });
  Object.values(singlesByDay).forEach(dayMatches => {
    const homeTeam = dayMatches[0].home_team_id!;
    const awayTeam = dayMatches[0].away_team_id!;
    const sameFixture = dayMatches.every(m => m.home_team_id === homeTeam && m.away_team_id === awayTeam);
    if (!sameFixture) return;
    const winners = dayMatches.map(m => getEffectiveWinner(
      m.status as 'upcoming' | 'in_progress' | 'complete',
      m.winner,
      m.holes_string ?? '..................',
      m.holes_to_play ?? 18,
      m.start_hole ?? 1
    ));
    if (winners.some(w => !w || w === 'half')) return;
    if (winners.every(w => w === 'home')) bonusPts[homeTeam] = (bonusPts[homeTeam] ?? 0) + bonusPoints;
    else if (winners.every(w => w === 'away')) bonusPts[awayTeam] = (bonusPts[awayTeam] ?? 0) + bonusPoints;
  });
  return bonusPts;
}

// Rick's brief, section 10 (2026-08-24) — "Calculation Engine" consolidation.
// scoreVsPar/formatVsPar/SCORE_COLORS/ptsColor/playerCourseHcp were each
// independently copied into 4-9 screens; the copies drifted (one screen's
// bug fix didn't propagate to the others) and, worse, two screens computed
// "birdie" from Stableford points instead of gross-vs-par — visibly wrong,
// and one of those persisted into the shared society_records table. Classify
// by GROSS score only — handicap shots affect Stableford points, never the
// eagle/birdie/par/bogey label (Rick: "points and stroke should remain
// separate").
export function scoreVsPar(gross: number, par: number): ScoreCategory {
  const diff = gross - par;
  if (diff <= -2) return 'eagle';
  if (diff === -1) return 'birdie';
  if (diff === 0)  return 'par';
  if (diff === 1)  return 'bogey';
  return 'double';
}

export function formatVsPar(n: number): string {
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `${n}`;
}

// Default palette — most screens use this as-is. Spectate mode's grid needs
// `par` to render as a mid-grey rather than white (white-on-solid is
// invisible in its layout); that screen spreads `{ ...SCORE_COLORS, par:
// '#4b5563' }` rather than forking the whole table.
export const SCORE_COLORS: Record<ScoreCategory, string> = {
  eagle:  '#D4AF37',
  birdie: '#f87171',
  par:    '#ffffff',
  bogey:  '#3b82f6',
  double: '#1e3a8a',
};

export function ptsColor(pts: number): string {
  if (pts >= 4) return SCORE_COLORS.eagle;
  if (pts === 3) return SCORE_COLORS.birdie;
  if (pts === 2) return SCORE_COLORS.par;
  if (pts === 1) return SCORE_COLORS.bogey;
  return SCORE_COLORS.double;
}

// Playing handicap for a round — WHS course handicap converted from a
// player's handicap index, scaled by the round's handicap allowance. Same
// formula everywhere it's used; what has historically differed (and caused
// real bugs) is which handicap INDEX gets fed in — that's each call site's
// responsibility, not this function's.
export function playerCourseHcp(
  hcpIndex: number,
  day: { slope_rating?: number | null; course_rating?: number | null; course_par?: number | null } | null | undefined,
  allowance = 100,
): number {
  const raw = (!day?.slope_rating || !day?.course_rating || !day?.course_par)
    ? Math.round(hcpIndex)
    : calcCourseHandicap(hcpIndex, day.slope_rating, day.course_rating, day.course_par);
  return Math.round(raw * (allowance / 100));
}

// A single "higher is better" comparable value for individual leaderboards —
// Stableford (and other points-based formats) sort on points; Medal (stroke
// play) sorts ascending on gross-vs-par, so it's negated here to keep every
// caller's sort direction the same ("higher sortValue wins"). Before this,
// four separate leaderboards (the live entry screen's all-groups panel, the
// tournament day leaderboard, the Tour Individual/Kronos board including its
// tie-break ladder, and the AI News report) each hardcoded a Stableford-
// points sort — silently wrong for Medal, whose own round-complete banner
// was already fixed to rank by gross-vs-par, so the two disagreed within a
// single screen.
export function individualScoreValue(
  roundFormat: string | null | undefined,
  points: number,
  vsPar: number,
): number {
  return roundFormat === 'medal' ? -vsPar : points;
}

// One gross-based eagle/birdie/par/bogey/double counter for a player's
// holes — replaces two independent counters that classified by Stableford
// points instead (`pts === 3` => "birdie"), which is wrong (a bogey player
// on a stroke hole scores 3 points without hitting a birdie) and had
// persisted into the shared society_records table.
export function countScoreBreakdown(
  holes: Array<{ hole_number: number; gross_score: number | null }>,
  courseHoles: Array<{ hole_number: number; par: number }>,
): Record<ScoreCategory, number> {
  const parByHole = new Map(courseHoles.map(h => [h.hole_number, h.par]));
  const out: Record<ScoreCategory, number> = { eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0 };
  for (const h of holes) {
    if (h.gross_score == null) continue;
    const par = parByHole.get(h.hole_number);
    if (par == null) continue;
    out[scoreVsPar(h.gross_score, par)]++;
  }
  return out;
}
