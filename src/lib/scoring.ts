// Scoring engine — ported from Titan Tour 2026 (index.html)
// All logic verified against the 2026 fixture corpus

export type HoleResult = 'h' | 'a' | 'f' | null;

export function calcHoles(holesStr: string): {
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
  const remaining = 18 - played;
  const concluded = remaining > 0 && Math.abs(homeUp) > remaining;
  return { homeUp, played, remaining, concluded };
}

export function getEffectiveWinner(
  status: 'upcoming' | 'in_progress' | 'complete',
  winner: string | null,
  holesStr: string
): 'home' | 'away' | 'half' | null {
  if (status === 'complete') return winner as 'home' | 'away' | 'half' | null;
  if (status === 'in_progress') {
    const { homeUp, played, remaining, concluded } = calcHoles(holesStr);
    if (concluded) return homeUp > 0 ? 'home' : 'away';
    if (played === 18) return homeUp === 0 ? 'half' : homeUp > 0 ? 'home' : 'away';
  }
  return null;
}

export function matchLabel(
  status: 'upcoming' | 'in_progress' | 'complete',
  winner: string | null,
  resultStr: string | null,
  holesStr: string
): string {
  if (status === 'complete') return resultStr ?? 'Complete';
  if (status === 'upcoming') return 'Upcoming';
  const { homeUp, played, remaining, concluded } = calcHoles(holesStr);
  if (played === 0) return 'In Progress';
  if (concluded) return `${Math.abs(homeUp)}&${remaining}`;
  if (played === 18) return homeUp === 0 ? 'AS' : `${Math.abs(homeUp)}UP`;
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
  w: number;
  h: number;
  l: number;
  played: number;
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
  }>
): TeamStanding[] {
  const teamMap = new Map<string, TeamStanding>();
  const ensure = (id: string) => {
    if (!teamMap.has(id)) teamMap.set(id, { teamId: id, pts: 0, w: 0, h: 0, l: 0, played: 0 });
    return teamMap.get(id)!;
  };

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

    const winPts  = m.is_singles ? 3 : 2;
    const halfPts = m.is_singles ? 1 : 1;

    if (winner === 'half') {
      home.pts += halfPts; home.h++;
      away.pts += halfPts; away.h++;
    } else if (winner === 'home') {
      home.pts += winPts; home.w++;
      away.l++;
    } else {
      away.pts += winPts; away.w++;
      home.l++;
    }
  }

  return Array.from(teamMap.values()).sort(
    (a, b) => b.pts - a.pts || b.w - a.w
  );
}
