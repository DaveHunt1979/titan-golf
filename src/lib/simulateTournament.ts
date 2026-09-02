// In-app tournament simulator (Dave, 2026-09-02): "we want to set something
// up with all variations and run full simulations... when we go big, we
// want to see where it breaks." Ports scripts/seed_titan_way_sim.mts (which
// ran once via the service-role key, off-device) into a normal authenticated
// client action — every write here goes through the same RLS every other
// admin action in this app goes through. No service-role key, ever, in
// this file.
//
// Extended 2026-09-02 to cover every available format, not just Titan Way:
// titan_way/odd_titan reuse the whole-tournament partnership optimizer;
// team_matchplay/ryder_cup reuse the plain day-by-day round-robin
// admin/draw.tsx's generateDraw() already does for those formats; stableford/
// medal reuse draw.tsx's isIndividual grouping. knockout is skipped — it's
// `available: false`, not a real format to simulate yet.
import { supabase } from './supabase';
import {
  calcStrokesReceived, calcStablefordPoints, calcHoles, getStandings,
  calcSweepBonus, buildKronosTieBreakMaps, rankPlayersByKronos, playerCourseHcp,
  scoreVsPar,
} from './scoring';
import { computeRoundRobinMatchups, generateTitanWaySchedule } from './titanWayDraw';
import { FORMAT_RULES, type FormatId } from './tournamentFormat';

const INDIVIDUAL_GROUP_SIZE = 4;

export interface SimulateTournamentOptions {
  societyId: string;
  formatId: FormatId;
  numTeams: number;        // ignored for stableford/medal
  numPlayers: number;      // ignored for team formats — used by stableford/medal only
  onProgress?: (msg: string) => void;
}

export interface SimulateTournamentResult {
  competitionId: string;
  competitionName: string;
  championName: string;    // team name for team formats, player name for individual
  kronosChampionName: string | null;
  syntheticPlayerCount: number;
  syntheticTeamCount: number;
}

function rnd(seed: { v: number }) {
  seed.v |= 0; seed.v = (seed.v + 0x6D2B79F5) | 0;
  let t = Math.imul(seed.v ^ (seed.v >>> 15), 1 | seed.v);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function makeRandom() {
  const seed = { v: Date.now() & 0xffffffff };
  return {
    int: (min: number, max: number) => Math.floor(rnd(seed) * (max - min + 1)) + min,
    pick: <T,>(arr: T[]): T => arr[Math.floor(rnd(seed) * arr.length)],
  };
}

function simulateGross(par: number, courseHcp: number, r: ReturnType<typeof makeRandom>): number {
  const expected = courseHcp / 18;
  const table = [-2, -1, -1, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3];
  const shift = expected > 2 ? 1 : expected > 0.7 ? (r.int(0, 9) < 4 ? 1 : 0) : 0;
  return Math.max(1, par + r.pick(table) + shift);
}

async function insertAll<T>(table: string, rows: any[], chunkSize = 400): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const { data, error } = await supabase.from(table).insert(rows.slice(i, i + chunkSize)).select();
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as T[]));
  }
  return out;
}

// Shared by the tournament and swindle simulators — a course whose
// course_holes/course_tees data is known-clean, not one of this DB's known
// corrupted rows (see project memory: 3 real corrupted-course fixes found
// 2026-08-26 by exactly this kind of par-sum/SI-permutation check).
export async function pickSimulationCourse(): Promise<{ name: string; par: number; rating: number; slope: number; holes: any[] }> {
  const { data: candidateCourses } = await supabase.from('courses').select('name').limit(30);
  for (const c of (candidateCourses ?? []) as any[]) {
    const { data: holes } = await supabase.from('course_holes').select('hole_number,par,stroke_index')
      .eq('course_name', c.name).order('hole_number');
    if (!holes || holes.length !== 18) continue;
    const parSum = holes.reduce((s, h: any) => s + h.par, 0);
    const sis = new Set(holes.map((h: any) => h.stroke_index));
    if (parSum < 68 || parSum > 74 || sis.size !== 18) continue;
    const { data: tees } = await supabase.from('course_tees').select('course_rating,slope_rating').eq('course_name', c.name).limit(1);
    const tee = (tees ?? [])[0];
    if (!tee?.course_rating || !tee?.slope_rating) continue;
    return { name: c.name, par: parSum, rating: tee.course_rating, slope: tee.slope_rating, holes };
  }
  throw new Error('No course found with clean 18-hole par/SI + rating data to simulate against.');
}

// Real society roster first, then synthetic fill (clearly named, no
// auth_uid so they can't ever log in) — exceeding what Dave's real groups
// have on hand is the entire point of this tool.
export async function buildRoster(societyId: string, needed: number, onProgress?: (m: string) => void) {
  const { data: smRows, error } = await supabase
    .from('society_members').select('player_id').eq('society_id', societyId);
  if (error) throw error;
  const realIds = [...new Set((smRows ?? []).map((r: any) => r.player_id))];
  const { data: realPlayers } = realIds.length
    ? await supabase.from('players').select('id,display_name,handicap_index').in('id', realIds)
    : { data: [] as any[] };
  const pool = (realPlayers ?? []).map((p: any) => ({ id: p.id, display_name: p.display_name, handicap_index: p.handicap_index ?? 12 }));

  const shortfall = needed - pool.length;
  if (shortfall > 0) {
    onProgress?.(`Creating ${shortfall} synthetic players (society only has ${pool.length})...`);
    const rows = Array.from({ length: shortfall }, (_, i) => ({
      display_name: `Sim Player ${pool.length + i + 1}`,
      handicap_index: [4, 8, 12, 14, 16, 18, 20, 24][i % 8],
    }));
    const created = await insertAll<any>('players', rows);
    pool.push(...created.map((p: any) => ({ id: p.id, display_name: p.display_name, handicap_index: p.handicap_index })));
  }
  return pool.slice(0, needed);
}

function matchHcp(hcpByPlayer: Record<string, number>, pid: string, day: any, allowance: number, groupIds: string[], relativeLow: boolean): number {
  const base = playerCourseHcp(hcpByPlayer[pid], day, allowance);
  if (!relativeLow) return base;
  return Math.max(0, base - Math.min(...groupIds.map(id => playerCourseHcp(hcpByPlayer[id], day, allowance))));
}

// ── Titan Way / Odd Titan — whole-tournament optimizer + either a
// knockout-bracket final round (titan_way) or a Stableford-into-team-points
// final round (odd_titan, no bracket possible with an odd team count) ──

async function runTitanFamilySimulation(opts: SimulateTournamentOptions): Promise<SimulateTournamentResult> {
  const { societyId, formatId, numTeams, onProgress } = opts;
  const rules = FORMAT_RULES[formatId];
  if (rules.minTeams != null && numTeams < rules.minTeams) throw new Error(`${rules.label} needs at least ${rules.minTeams} teams.`);
  if (rules.maxTeams != null && numTeams > rules.maxTeams) throw new Error(`${rules.label} allows at most ${rules.maxTeams} teams.`);
  if (rules.requiresEvenTeams && numTeams % 2 !== 0) throw new Error(`${rules.label} requires an even number of teams.`);
  if (rules.requiresOddTeams && numTeams % 2 === 0) throw new Error(`${rules.label} requires an odd number of teams.`);
  const playersPerTeam = 4;
  const totalPlayers = numTeams * playersPerTeam;

  onProgress?.('Checking course data...');
  const course = await pickSimulationCourse();
  onProgress?.(`Using ${course.name} for every round.`);

  const roster = await buildRoster(societyId, totalPlayers, onProgress);
  const syntheticPlayerCount = roster.filter(p => p.display_name.startsWith('Sim Player')).length;
  const hcpByPlayer: Record<string, number> = {};
  roster.forEach(p => { hcpByPlayer[p.id] = p.handicap_index; });

  onProgress?.(`Creating ${numTeams} teams...`);
  const teamColors = ['#D4AF37', '#f87171', '#60a5fa', '#4ade80', '#a855f7', '#fb923c', '#38bdf8', '#f472b6', '#facc15', '#94a3b8', '#34d399', '#c084fc'];
  const teamRows = Array.from({ length: numTeams }, (_, i) => ({
    society_id: societyId, name: `Sim Team ${i + 1}`, accent_color: teamColors[i % teamColors.length],
  }));
  const teams = await insertAll<any>('teams', teamRows);
  const teamIds = teams.map((t: any) => t.id);
  const rosterByTeam: Record<string, string[]> = {};
  teams.forEach((t: any, i: number) => { rosterByTeam[t.id] = roster.slice(i * 4, i * 4 + 4).map(p => p.id); });

  onProgress?.('Creating competition...');
  const pin = String(Math.floor(1000 + Math.random() * 9000));
  const [comp] = await insertAll<any>('competitions', [{
    society_id: societyId, name: `Simulation — ${rules.label} — ${numTeams} teams — ${new Date().toLocaleDateString('en-GB')}`,
    year: new Date().getFullYear(), format: formatId, tournament_type: 'titan_tour', status: 'active',
    settings: { num_teams: numTeams, format_type: formatId }, pin,
    pts_win: rules.defaultPtsWin, pts_half: rules.defaultPtsHalf, opening_rounds: 3, bonus_points: 2, include_in_kronos: true,
    is_simulation: true,
  }]);

  const dayDefs = [
    { day_number: 1, format: 'four_bbb' }, { day_number: 2, format: 'four_bbb' },
    { day_number: 3, format: 'four_bbb' }, { day_number: 4, format: 'singles_stableford' },
  ];
  const dayRows = dayDefs.map(d => ({
    competition_id: comp.id, day_number: d.day_number, course_name: course.name,
    course_par: course.par, course_rating: course.rating, slope_rating: course.slope,
    day_format: d.format, hcp_pct: d.format === 'four_bbb' ? 85 : 100,
  }));
  const days = (await insertAll<any>('competition_days', dayRows)).sort((a: any, b: any) => a.day_number - b.day_number);

  await insertAll('competition_players', teams.flatMap((t: any) => rosterByTeam[t.id].map(pid => ({
    competition_id: comp.id, player_id: pid, team_id: t.id, handicap_index: hcpByPlayer[pid], status: 'enrolled',
  }))));

  onProgress?.('Generating whole-tournament draw...');
  const schedule = generateTitanWaySchedule({ teamIds, rosterByTeam, qualifyingDayNumbers: [1, 2, 3] });

  const r = makeRandom();

  async function simulateAndInsertMatch(o: {
    day_id: string; day: any; match_number: number; home_team_id: string | null; away_team_id: string | null;
    home_player_ids: string[]; away_player_ids: string[]; is_singles: boolean; handicap_method: string; hcp_allowance: number;
  }) {
    const relativeLow = o.handicap_method === 'relative_low_stableford';
    const allIds = [...o.home_player_ids, ...o.away_player_ids];
    let holesStr = '';
    const holeRows: any[] = [];
    const stablefordByPlayer: Record<string, number> = {};
    for (const h of course.holes) {
      const ptsByPlayer: Record<string, number> = {};
      const grossByPlayer: Record<string, number> = {};
      for (const pid of allIds) {
        const gross = simulateGross(h.par, playerCourseHcp(hcpByPlayer[pid], o.day, 100), r);
        const shots = calcStrokesReceived(matchHcp(hcpByPlayer, pid, o.day, o.hcp_allowance, allIds, relativeLow), h.stroke_index);
        grossByPlayer[pid] = gross;
        ptsByPlayer[pid] = calcStablefordPoints(gross, h.par, shots);
        stablefordByPlayer[pid] = (stablefordByPlayer[pid] ?? 0) + ptsByPlayer[pid];
      }
      const homeBest = Math.max(...o.home_player_ids.map(id => ptsByPlayer[id]));
      const awayBest = Math.max(...o.away_player_ids.map(id => ptsByPlayer[id]));
      const result: 'h' | 'a' | 'f' = homeBest > awayBest ? 'h' : awayBest > homeBest ? 'a' : 'f';
      holesStr += result;
      for (const pid of allIds) {
        const shots = calcStrokesReceived(matchHcp(hcpByPlayer, pid, o.day, o.hcp_allowance, allIds, relativeLow), h.stroke_index);
        holeRows.push({ match_id: null, player_id: pid, hole_number: h.hole_number, score: result, gross_score: grossByPlayer[pid], net_score: grossByPlayer[pid] - shots, stableford_pts: ptsByPlayer[pid] });
      }
      if (calcHoles(holesStr, 18, 1).concluded) break;
    }
    const { homeUp, remaining, concluded } = calcHoles(holesStr, 18, 1);
    const winner = concluded ? (homeUp > 0 ? 'home' : 'away') : (homeUp === 0 ? 'half' : homeUp > 0 ? 'home' : 'away');
    const result_str = concluded ? `${Math.abs(homeUp)}&${remaining}` : (homeUp === 0 ? 'Halved' : `${Math.abs(homeUp)}UP`);
    const [match] = await insertAll<any>('matches', [{
      competition_id: comp.id, day_id: o.day_id, match_number: o.match_number,
      home_team_id: o.home_team_id, away_team_id: o.away_team_id,
      home_player_ids: o.home_player_ids, away_player_ids: o.away_player_ids,
      round_format: 'matchplay', is_singles: o.is_singles, hcp_allowance: o.hcp_allowance, handicap_method: o.handicap_method,
      status: 'complete', winner, result_str, holes_string: holesStr.padEnd(18, '.'),
      holes_to_play: 18, start_hole: 1, started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
    }]);
    holeRows.forEach(row => { row.match_id = match.id; });
    await insertAll('match_holes', holeRows);
    return { match, stablefordByPlayer };
  }

  const allMatches: any[] = [];
  const stablefordTotals: Record<string, number> = {};
  const matchIdsByDay: Record<number, string[]> = {};
  for (const day of days.filter((d: any) => d.day_format === 'four_bbb')) {
    onProgress?.(`Simulating day ${day.day_number}...`);
    matchIdsByDay[day.day_number] = [];
    let matchNum = 1;
    for (const [tH, tA] of computeRoundRobinMatchups(teamIds, day.day_number)) {
      const pairH = schedule.pairingsByDay[day.day_number]?.[tH];
      const pairA = schedule.pairingsByDay[day.day_number]?.[tA];
      if (!pairH || !pairA) continue;
      for (const [homePair, awayPair] of [[pairH.pair1, pairA.pair1], [pairH.pair2, pairA.pair2]] as const) {
        const { match, stablefordByPlayer } = await simulateAndInsertMatch({
          day_id: day.id, day, match_number: matchNum++, home_team_id: tH, away_team_id: tA,
          home_player_ids: [...homePair], away_player_ids: [...awayPair],
          is_singles: false, handicap_method: 'relative_low_stableford', hcp_allowance: day.hcp_pct,
        });
        allMatches.push(match);
        matchIdsByDay[day.day_number].push(match.id);
        Object.entries(stablefordByPlayer).forEach(([pid, pts]) => { stablefordTotals[pid] = (stablefordTotals[pid] ?? 0) + pts; });
      }
    }
  }

  const day4 = days.find((d: any) => d.day_format === 'singles_stableford');
  const teamStableford: Record<string, number> = {};
  teams.forEach((t: any) => { teamStableford[t.id] = rosterByTeam[t.id].reduce((s, pid) => s + (stablefordTotals[pid] ?? 0), 0); });
  const qualifyingStandings = getStandings(allMatches, comp.pts_win, comp.pts_half, teamStableford, {});

  let championName = '—';
  let kronosChampionName: string | null = null;

  if (!rules.finalRoundStablefordTeamPoints) {
    // Titan Way: lock qualifying standings, bracket by finishing position,
    // Kronos ranks each bracket's singles order.
    onProgress?.('Seeding playoff from qualifying standings...');
    const bracket = qualifyingStandings.map(s => s.teamId);
    const { data: day3HoleRows } = await supabase.from('match_holes').select('player_id,match_id,hole_number,stableford_pts')
      .in('match_id', matchIdsByDay[3] ?? []);
    const kronosMaps = buildKronosTieBreakMaps((day3HoleRows ?? []) as any, new Set(matchIdsByDay[3] ?? []));

    onProgress?.('Simulating playoff...');
    let singlesMatchNum = 1;
    for (let i = 0; i < bracket.length - 1; i += 2) {
      const tH = bracket[i]; const tA = bracket[i + 1];
      const rosterH = rankPlayersByKronos(rosterByTeam[tH], stablefordTotals, kronosMaps);
      const rosterA = rankPlayersByKronos(rosterByTeam[tA], stablefordTotals, kronosMaps);
      for (let j = 0; j < 4; j++) {
        const { match } = await simulateAndInsertMatch({
          day_id: day4.id, day: day4, match_number: singlesMatchNum++, home_team_id: tH, away_team_id: tA,
          home_player_ids: [rosterH[j]], away_player_ids: [rosterA[j]], is_singles: true,
          handicap_method: 'individual_stableford', hcp_allowance: day4.hcp_pct,
        });
        allMatches.push(match);
      }
    }

    onProgress?.('Finalising standings...');
    const { data: allHoleRows } = await supabase.from('match_holes').select('player_id,match_id,hole_number,stableford_pts')
      .in('match_id', allMatches.map((m: any) => m.id));
    const finalPlayerTotals: Record<string, number> = {};
    (allHoleRows ?? []).forEach((rw: any) => { finalPlayerTotals[rw.player_id] = (finalPlayerTotals[rw.player_id] ?? 0) + (rw.stableford_pts ?? 0); });
    const finalStableford: Record<string, number> = {};
    teams.forEach((t: any) => { finalStableford[t.id] = rosterByTeam[t.id].reduce((s, pid) => s + (finalPlayerTotals[pid] ?? 0), 0); });
    const finalBonus = calcSweepBonus(allMatches, new Set([day4.id]), comp.bonus_points);
    const finalStandings = getStandings(allMatches, comp.pts_win, comp.pts_half, finalStableford, finalBonus);
    const championTeam = teams.find((t: any) => t.id === finalStandings[0]?.teamId);
    championName = championTeam?.name ?? '—';
    const kronosSorted = Object.entries(finalPlayerTotals).sort((a, b) => b[1] - a[1]);
    const nameByPlayerId: Record<string, string> = {};
    roster.forEach(p => { nameByPlayerId[p.id] = p.display_name; });
    kronosChampionName = kronosSorted[0] ? nameByPlayerId[kronosSorted[0][0]] : '—';
  } else {
    // Odd Titan: no bracket possible with an odd team count — the final
    // round is a plain round-robin day (bye-rotation-aware, same engine as
    // the qualifying days), paired cross-team by roster index (Dave,
    // 2026-09-02: "cross-team, avoid same-team pairs", no Kronos seeding
    // needed since this round doesn't decide a knockout). Its Stableford
    // points are summed per team and added onto the qualifying total.
    onProgress?.('Simulating final round...');
    let singlesMatchNum = 1;
    const finalRoundStableford: Record<string, number> = {};
    for (const [tH, tA] of computeRoundRobinMatchups(teamIds, 4)) {
      const rosterH = rosterByTeam[tH]; const rosterA = rosterByTeam[tA];
      for (let j = 0; j < 4; j++) {
        const { match, stablefordByPlayer } = await simulateAndInsertMatch({
          day_id: day4.id, day: day4, match_number: singlesMatchNum++, home_team_id: tH, away_team_id: tA,
          home_player_ids: [rosterH[j]], away_player_ids: [rosterA[j]], is_singles: true,
          handicap_method: 'individual_stableford', hcp_allowance: day4.hcp_pct,
        });
        allMatches.push(match);
        Object.entries(stablefordByPlayer).forEach(([pid, pts]) => {
          const tid = rosterByTeam[tH].includes(pid) ? tH : tA;
          finalRoundStableford[tid] = (finalRoundStableford[tid] ?? 0) + pts;
        });
      }
    }
    const combinedStandings = getStandings(allMatches.filter(m => m.day_id !== day4.id), comp.pts_win, comp.pts_half, teamStableford, finalRoundStableford);
    const championTeam = teams.find((t: any) => t.id === combinedStandings[0]?.teamId);
    championName = championTeam?.name ?? '—';
    const kronosSorted = Object.entries(stablefordTotals).sort((a, b) => b[1] - a[1]);
    // Final round Stableford counts toward Kronos too — recompute totals
    // including it for the reported champion, same as the live Kronos board would.
    const { data: allHoleRows } = await supabase.from('match_holes').select('player_id,stableford_pts')
      .in('match_id', allMatches.map((m: any) => m.id));
    const kronosTotals: Record<string, number> = {};
    (allHoleRows ?? []).forEach((rw: any) => { kronosTotals[rw.player_id] = (kronosTotals[rw.player_id] ?? 0) + (rw.stableford_pts ?? 0); });
    const kronosFinalSorted = Object.entries(kronosTotals).sort((a, b) => b[1] - a[1]);
    const nameByPlayerId: Record<string, string> = {};
    roster.forEach(p => { nameByPlayerId[p.id] = p.display_name; });
    kronosChampionName = kronosFinalSorted[0] ? nameByPlayerId[kronosFinalSorted[0][0]] : (kronosSorted[0] ? nameByPlayerId[kronosSorted[0][0]] : '—');
  }

  await supabase.from('competitions').update({ status: 'complete' }).eq('id', comp.id);

  return {
    competitionId: comp.id,
    competitionName: comp.name,
    championName,
    kronosChampionName,
    syntheticPlayerCount,
    syntheticTeamCount: numTeams,
  };
}

// ── Multi-Team Tour / Ryder Cup — plain day-by-day round-robin, no
// whole-tournament optimizer, no captain rotation, no knockout bracket.
// Same fixed pairing (roster index 0+1, 2+3) every 4BBB day — the generic
// admin/draw.tsx generateDraw() these formats actually use doesn't vary
// partnerships day-to-day either; only Titan Way's optimizer does that. ──

async function runRoundRobinTeamSimulation(opts: SimulateTournamentOptions): Promise<SimulateTournamentResult> {
  const { societyId, formatId, numTeams, onProgress } = opts;
  const rules = FORMAT_RULES[formatId];
  const effectiveTeams = formatId === 'ryder_cup' ? 2 : numTeams;
  if (effectiveTeams < 2) throw new Error(`${rules.label} needs at least 2 teams.`);
  const playersPerTeam = 4;
  const totalPlayers = effectiveTeams * playersPerTeam;

  onProgress?.('Checking course data...');
  const course = await pickSimulationCourse();

  const roster = await buildRoster(societyId, totalPlayers, onProgress);
  const syntheticPlayerCount = roster.filter(p => p.display_name.startsWith('Sim Player')).length;
  const hcpByPlayer: Record<string, number> = {};
  roster.forEach(p => { hcpByPlayer[p.id] = p.handicap_index; });

  onProgress?.(`Creating ${effectiveTeams} teams...`);
  const teamColors = ['#D4AF37', '#f87171', '#60a5fa', '#4ade80', '#a855f7', '#fb923c', '#38bdf8', '#f472b6'];
  const teams = await insertAll<any>('teams', Array.from({ length: effectiveTeams }, (_, i) => ({
    society_id: societyId, name: formatId === 'ryder_cup' ? (i === 0 ? 'Sim Home' : 'Sim Away') : `Sim Team ${i + 1}`,
    accent_color: teamColors[i % teamColors.length],
  })));
  const teamIds = teams.map((t: any) => t.id);
  const rosterByTeam: Record<string, string[]> = {};
  teams.forEach((t: any, i: number) => { rosterByTeam[t.id] = roster.slice(i * 4, i * 4 + 4).map(p => p.id); });

  onProgress?.('Creating competition...');
  const pin = String(Math.floor(1000 + Math.random() * 9000));
  const [comp] = await insertAll<any>('competitions', [{
    society_id: societyId, name: `Simulation — ${rules.label} — ${effectiveTeams} teams — ${new Date().toLocaleDateString('en-GB')}`,
    year: new Date().getFullYear(), format: formatId, tournament_type: 'titan_tour', status: 'active',
    settings: { num_teams: effectiveTeams, format_type: formatId }, pin,
    pts_win: rules.defaultPtsWin, pts_half: rules.defaultPtsHalf, opening_rounds: 0, bonus_points: 2, include_in_kronos: rules.individualBoardDefaultOn,
    is_simulation: true,
  }]);

  const numDays = rules.defaultDays;
  const dayRows = Array.from({ length: numDays }, (_, i) => {
    const dayNumber = i + 1;
    const isLast = dayNumber === numDays;
    const df = isLast && rules.lastDaySinglesOverride ? 'singles' : rules.defaultDayFormat;
    return {
      competition_id: comp.id, day_number: dayNumber, course_name: course.name,
      course_par: course.par, course_rating: course.rating, slope_rating: course.slope,
      day_format: df, hcp_pct: rules.defaultHcpPct,
    };
  });
  const days = (await insertAll<any>('competition_days', dayRows)).sort((a: any, b: any) => a.day_number - b.day_number);

  await insertAll('competition_players', teams.flatMap((t: any) => rosterByTeam[t.id].map(pid => ({
    competition_id: comp.id, player_id: pid, team_id: t.id, handicap_index: hcpByPlayer[pid], status: 'enrolled',
  }))));

  const r = makeRandom();
  const allMatches: any[] = [];
  const stablefordTotals: Record<string, number> = {};

  for (const day of days) {
    onProgress?.(`Simulating day ${day.day_number}...`);
    const isSinglesDay = day.day_format === 'singles' || day.day_format === 'singles_stableford';
    const ppm = isSinglesDay ? 1 : 2;
    let matchNum = 1;
    for (const [tH, tA] of computeRoundRobinMatchups(teamIds, day.day_number)) {
      const pH = rosterByTeam[tH]; const pA = rosterByTeam[tA];
      const n = Math.floor(Math.min(pH.length, pA.length) / ppm);
      for (let j = 0; j < n; j++) {
        const homeIds = ppm === 2 ? [pH[j * 2], pH[j * 2 + 1]] : [pH[j]];
        const awayIds = ppm === 2 ? [pA[j * 2], pA[j * 2 + 1]] : [pA[j]];
        const allIds = [...homeIds, ...awayIds];
        let holesStr = '';
        const holeRows: any[] = [];
        for (const h of course.holes) {
          const ptsByPlayer: Record<string, number> = {};
          const grossByPlayer: Record<string, number> = {};
          for (const pid of allIds) {
            const gross = simulateGross(h.par, playerCourseHcp(hcpByPlayer[pid], day, 100), r);
            const shots = calcStrokesReceived(playerCourseHcp(hcpByPlayer[pid], day, day.hcp_pct), h.stroke_index);
            grossByPlayer[pid] = gross;
            ptsByPlayer[pid] = calcStablefordPoints(gross, h.par, shots);
            stablefordTotals[pid] = (stablefordTotals[pid] ?? 0) + ptsByPlayer[pid];
          }
          const homeBest = Math.max(...homeIds.map(id => ptsByPlayer[id]));
          const awayBest = Math.max(...awayIds.map(id => ptsByPlayer[id]));
          const result: 'h' | 'a' | 'f' = homeBest > awayBest ? 'h' : awayBest > homeBest ? 'a' : 'f';
          holesStr += result;
          for (const pid of allIds) {
            const shots = calcStrokesReceived(playerCourseHcp(hcpByPlayer[pid], day, day.hcp_pct), h.stroke_index);
            holeRows.push({ match_id: null, player_id: pid, hole_number: h.hole_number, score: result, gross_score: grossByPlayer[pid], net_score: grossByPlayer[pid] - shots, stableford_pts: ptsByPlayer[pid] });
          }
          if (calcHoles(holesStr, 18, 1).concluded) break;
        }
        const { homeUp, remaining, concluded } = calcHoles(holesStr, 18, 1);
        const winner = concluded ? (homeUp > 0 ? 'home' : 'away') : (homeUp === 0 ? 'half' : homeUp > 0 ? 'home' : 'away');
        const result_str = concluded ? `${Math.abs(homeUp)}&${remaining}` : (homeUp === 0 ? 'Halved' : `${Math.abs(homeUp)}UP`);
        const [match] = await insertAll<any>('matches', [{
          competition_id: comp.id, day_id: day.id, match_number: matchNum++,
          home_team_id: tH, away_team_id: tA, home_player_ids: homeIds, away_player_ids: awayIds,
          round_format: 'matchplay', is_singles: isSinglesDay, hcp_allowance: day.hcp_pct, handicap_method: isSinglesDay ? 'individual_stableford' : 'relative_low_stableford',
          status: 'complete', winner, result_str, holes_string: holesStr.padEnd(18, '.'),
          holes_to_play: 18, start_hole: 1, started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
        }]);
        holeRows.forEach(row => { row.match_id = match.id; });
        await insertAll('match_holes', holeRows);
        allMatches.push(match);
      }
    }
  }

  onProgress?.('Finalising standings...');
  const teamStableford: Record<string, number> = {};
  teams.forEach((t: any) => { teamStableford[t.id] = rosterByTeam[t.id].reduce((s, pid) => s + (stablefordTotals[pid] ?? 0), 0); });
  const finalStandings = getStandings(allMatches, comp.pts_win, comp.pts_half, teamStableford, {});
  const championTeam = teams.find((t: any) => t.id === finalStandings[0]?.teamId);
  const kronosSorted = Object.entries(stablefordTotals).sort((a, b) => b[1] - a[1]);
  const nameByPlayerId: Record<string, string> = {};
  roster.forEach(p => { nameByPlayerId[p.id] = p.display_name; });

  await supabase.from('competitions').update({ status: 'complete' }).eq('id', comp.id);

  return {
    competitionId: comp.id,
    competitionName: comp.name,
    championName: championTeam?.name ?? '—',
    kronosChampionName: rules.individualBoardDefaultOn && kronosSorted[0] ? nameByPlayerId[kronosSorted[0][0]] : null,
    syntheticPlayerCount,
    syntheticTeamCount: effectiveTeams,
  };
}

// ── Individual Stableford / Stroke Play — no teams, groups of 4, same
// grouping admin/draw.tsx's isIndividual branch already uses. ──

async function runIndividualSimulation(opts: SimulateTournamentOptions): Promise<SimulateTournamentResult> {
  const { societyId, formatId, numPlayers, onProgress } = opts;
  const rules = FORMAT_RULES[formatId];
  if (numPlayers < 4) throw new Error(`${rules.label} needs at least 4 players.`);

  onProgress?.('Checking course data...');
  const course = await pickSimulationCourse();

  const roster = await buildRoster(societyId, numPlayers, onProgress);
  const syntheticPlayerCount = roster.filter(p => p.display_name.startsWith('Sim Player')).length;
  const hcpByPlayer: Record<string, number> = {};
  roster.forEach(p => { hcpByPlayer[p.id] = p.handicap_index; });

  onProgress?.('Creating competition...');
  const pin = String(Math.floor(1000 + Math.random() * 9000));
  const [comp] = await insertAll<any>('competitions', [{
    society_id: societyId, name: `Simulation — ${rules.label} — ${numPlayers} players — ${new Date().toLocaleDateString('en-GB')}`,
    year: new Date().getFullYear(), format: formatId, tournament_type: 'titan_tour', status: 'active',
    settings: { format_type: formatId }, pin,
    pts_win: rules.defaultPtsWin, pts_half: rules.defaultPtsHalf, opening_rounds: 0, bonus_points: 0, include_in_kronos: false,
    is_simulation: true,
  }]);

  const numDays = rules.defaultDays;
  const dayRows = Array.from({ length: numDays }, (_, i) => ({
    competition_id: comp.id, day_number: i + 1, course_name: course.name,
    course_par: course.par, course_rating: course.rating, slope_rating: course.slope,
    day_format: rules.defaultDayFormat, hcp_pct: rules.defaultHcpPct,
  }));
  const days = (await insertAll<any>('competition_days', dayRows)).sort((a: any, b: any) => a.day_number - b.day_number);

  await insertAll('competition_players', roster.map(p => ({
    competition_id: comp.id, player_id: p.id, team_id: null, handicap_index: p.handicap_index, status: 'enrolled',
  })));

  const r = makeRandom();
  const isMedal = formatId === 'medal';
  const grossVsParTotals: Record<string, number> = {};
  const stablefordTotals: Record<string, number> = {};

  for (const day of days) {
    onProgress?.(`Simulating day ${day.day_number}...`);
    const shuffled = [...roster].sort(() => rnd({ v: Date.now() + Math.floor(Math.random() * 1000) }) - 0.5);
    const groups: typeof roster[] = [];
    for (let i = 0; i < shuffled.length; i += INDIVIDUAL_GROUP_SIZE) groups.push(shuffled.slice(i, i + INDIVIDUAL_GROUP_SIZE));

    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];
      const holeRows: any[] = [];
      for (const p of group) {
        const courseHcp = playerCourseHcp(hcpByPlayer[p.id], day, day.hcp_pct);
        let vsPar = 0;
        for (const h of course.holes) {
          const gross = simulateGross(h.par, courseHcp, r);
          const shots = calcStrokesReceived(courseHcp, h.stroke_index);
          const pts = calcStablefordPoints(gross, h.par, shots);
          vsPar += gross - h.par;
          stablefordTotals[p.id] = (stablefordTotals[p.id] ?? 0) + pts;
          holeRows.push({ match_id: null, player_id: p.id, hole_number: h.hole_number, gross_score: gross, net_score: gross - shots, stableford_pts: pts });
        }
        grossVsParTotals[p.id] = (grossVsParTotals[p.id] ?? 0) + vsPar;
      }
      const [match] = await insertAll<any>('matches', [{
        competition_id: comp.id, day_id: day.id, match_number: gi + 1,
        home_team_id: null, away_team_id: null, home_player_ids: group.map(p => p.id), away_player_ids: [],
        round_format: isMedal ? 'medal' : 'stableford', is_singles: false, hcp_allowance: day.hcp_pct, handicap_method: null,
        status: 'complete', winner: null, result_str: null, holes_string: '.'.repeat(18),
        holes_to_play: 18, start_hole: 1, started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
      }]);
      holeRows.forEach(row => { row.match_id = match.id; });
      await insertAll('match_holes', holeRows);
    }
  }

  await supabase.from('competitions').update({ status: 'complete' }).eq('id', comp.id);

  const nameByPlayerId: Record<string, string> = {};
  roster.forEach(p => { nameByPlayerId[p.id] = p.display_name; });
  const championId = isMedal
    ? Object.entries(grossVsParTotals).sort((a, b) => a[1] - b[1])[0]?.[0]
    : Object.entries(stablefordTotals).sort((a, b) => b[1] - a[1])[0]?.[0];

  return {
    competitionId: comp.id,
    competitionName: comp.name,
    championName: championId ? nameByPlayerId[championId] : '—',
    kronosChampionName: null,
    syntheticPlayerCount,
    syntheticTeamCount: 0,
  };
}

export async function runTournamentSimulation(opts: SimulateTournamentOptions): Promise<SimulateTournamentResult> {
  const rules = FORMAT_RULES[opts.formatId];
  if (!rules.available) throw new Error(`${rules.label} isn't available yet.`);
  if (!rules.isTeamFormat) return runIndividualSimulation(opts);
  if (rules.wholeTournamentDraw) return runTitanFamilySimulation(opts);
  return runRoundRobinTeamSimulation(opts);
}

// Cascades: matches -> match_holes (ON DELETE CASCADE per schema), same for
// competition_days/competition_players via competition_id. Synthetic
// players/teams are left in place deliberately — cheap to leave, and
// deleting a `players` row that later got referenced elsewhere (a repeat
// run using the same society) is a sharper edge than it's worth for a
// dev-only cleanup action.
export async function deleteSimulation(competitionId: string) {
  const { error } = await supabase.from('competitions').delete().eq('id', competitionId).eq('is_simulation', true);
  if (error) throw error;
}
