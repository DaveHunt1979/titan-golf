// Scoring engine — ported from Titan Tour 2026 (index.html)
// All logic verified against the 2026 fixture corpus

export type HoleResult = 'h' | 'a' | 'f' | null;

export function calcHoles(holesStr: string, totalHoles = 18): {
  homeUp: number;
  played: number;
  remaining: number;
  concluded: boolean;
} {
  const chars = holesStr.split('');
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
  totalHoles = 18
): 'home' | 'away' | 'half' | null {
  if (status === 'complete') return winner as 'home' | 'away' | 'half' | null;
  if (status === 'in_progress') {
    const { homeUp, played, remaining, concluded } = calcHoles(holesStr, totalHoles);
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
  totalHoles = 18
): string {
  if (status === 'complete') return resultStr ?? 'Complete';
  if (status === 'upcoming') return 'Upcoming';
  const { homeUp, played, remaining, concluded } = calcHoles(holesStr, totalHoles);
  if (played === 0) return 'In Progress';
  if (concluded) return `${Math.abs(homeUp)}&${remaining}`;
  if (played === totalHoles) return homeUp === 0 ? 'AS' : `${Math.abs(homeUp)}UP`;
  if (homeUp === 0) return `AS (${played})`;
  return `${Math.abs(homeUp)}UP (${played})`;
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
  // level after points + combined Stableford, whoever won the head-to-head
  // match between them ranks above the other.
  const h2hKey = (a: string, b: string) => [a, b].sort().join('|');
  const h2hWinner = new Map<string, string>();

  for (const m of matches) {
    const winner = getEffectiveWinner(
      m.status as 'upcoming' | 'in_progress' | 'complete',
      m.winner,
      m.holes_string ?? '..................'
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
      h2hWinner.set(h2hKey(m.home_team_id, m.away_team_id), m.home_team_id);
    } else {
      away.pts += ptsWin; away.w++;
      home.l++;
      h2hWinner.set(h2hKey(m.home_team_id, m.away_team_id), m.away_team_id);
    }
  }

  return Array.from(teamMap.values()).sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.stableford !== a.stableford) return b.stableford - a.stableford;
    const h2h = h2hWinner.get(h2hKey(a.teamId, b.teamId));
    if (h2h === a.teamId) return -1;
    if (h2h === b.teamId) return 1;
    return b.w - a.w;
  });
}
