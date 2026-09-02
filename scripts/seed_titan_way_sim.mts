// One-off seed script: builds a fully-played, complete Titan Way simulation
// tournament directly in the DB (via service-role key) so Dave can browse a
// finished tournament end-to-end and verify the scoring engine. Reuses the
// app's own real scoring/draw functions (src/lib/scoring.ts,
// src/lib/titanWayDraw.ts) rather than re-deriving results by hand — this is
// a verification exercise, not decorative fake data. Additive only: creates
// new players/competition/teams-links, never touches existing tournaments.
//
// Run with: node scripts/seed_titan_way_sim.mts

import { createClient } from '@supabase/supabase-js';
import {
  calcStrokesReceived, calcStablefordPoints, calcHoles, getStandings,
  calcSweepBonus, buildKronosTieBreakMaps, rankPlayersByKronos, playerCourseHcp,
} from '../src/lib/scoring.ts';
import { computeRoundRobinMatchups, generateTitanWaySchedule } from '../src/lib/titanWayDraw.ts';
import fs from 'node:fs';

const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const env: Record<string, string> = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const SUPABASE_URL = env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const SOCIETY_ID = '00000000-0000-0000-0000-000000000001'; // Titan Tour (Dave's real society)
const TEAM_NAMES = ['MOB', 'Destroyers', 'Legion Six', 'Renegades', 'Elite', 'Instigators'];

function rnd(seed: { v: number }) {
  // Deterministic-ish PRNG (mulberry32) so a re-run is reproducible if needed.
  seed.v |= 0; seed.v = (seed.v + 0x6D2B79F5) | 0;
  let t = Math.imul(seed.v ^ (seed.v >>> 15), 1 | seed.v);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const seed = { v: 20260901 };
function randInt(min: number, max: number) { return Math.floor(rnd(seed) * (max - min + 1)) + min; }
function pick<T>(arr: T[]): T { return arr[randInt(0, arr.length - 1)]; }
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = randInt(0, i); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Plausible gross score for one hole given a player's course handicap
// (expected strokes-over-par per hole = hcp/18) — weighted toward
// par/bogey with occasional birdies and blow-up holes, shifted by skill.
function simulateGross(par: number, courseHcp: number): number {
  const expected = courseHcp / 18;
  const table = [-2, -1, -1, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3];
  const shift = expected > 2 ? 1 : expected > 0.7 ? (rnd(seed) < 0.4 ? 1 : 0) : 0;
  const delta = pick(table) + shift;
  return Math.max(1, par + delta);
}

async function insert<T>(table: string, rows: any[], chunkSize = 500): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { data, error } = await sb.from(table).insert(chunk).select();
    if (error) throw new Error(`insert ${table} failed: ${error.message}`);
    out.push(...(data as T[]));
  }
  return out;
}

async function main() {
  console.log('Fetching teams...');
  const { data: teamsRaw, error: teamsErr } = await sb
    .from('teams').select('id,name,accent_color').eq('society_id', SOCIETY_ID).in('name', TEAM_NAMES);
  if (teamsErr) throw teamsErr;
  const teams = TEAM_NAMES.map(n => teamsRaw!.find((t: any) => t.name === n)).filter(Boolean) as any[];
  if (teams.length !== 6) throw new Error(`expected 6 teams, found ${teams.length}`);
  console.log('Teams:', teams.map(t => t.name).join(', '));

  // ── Courses ──
  const COURSES = [
    { name: 'Chart Hills Golf Club', courseRating: 76.2, slopeRating: 153 },
    { name: 'Darenth Valley Golf Course', courseRating: 70.6, slopeRating: 115 },
  ];
  const courseHolesByName: Record<string, { hole_number: number; par: number; stroke_index: number }[]> = {};
  for (const c of COURSES) {
    const { data, error } = await sb.from('course_holes').select('hole_number,par,stroke_index')
      .eq('course_name', c.name).order('hole_number');
    if (error) throw error;
    courseHolesByName[c.name] = data as any[];
  }
  const parSumByName: Record<string, number> = {};
  for (const c of COURSES) parSumByName[c.name] = courseHolesByName[c.name].reduce((s, h) => s + h.par, 0);

  // ── Fake players — fun clearly-synthetic names, 4 per team, hcp <= 18 ──
  // Dave: "oh you should of used members" — use each team's REAL current
  // roster (society_members.team_id) rather than synthetic players. Titan
  // Way requires exactly 4/team; teams with >4 keep the 4 lowest handicaps
  // (dropped players logged below), teams with <4 would be padded from the
  // synthetic bank (unused here — every team already has >=4 real members).
  console.log('Fetching real team rosters from society_members...');
  const { data: smRows, error: smErr } = await sb
    .from('society_members').select('player_id,team_id')
    .eq('society_id', SOCIETY_ID).in('team_id', teams.map(t => t.id));
  if (smErr) throw smErr;
  const { data: realPlayers, error: rpErr } = await sb
    .from('players').select('id,display_name,handicap_index')
    .in('id', smRows!.map((r: any) => r.player_id));
  if (rpErr) throw rpErr;
  const realPlayerById: Record<string, any> = {};
  realPlayers!.forEach((p: any) => { realPlayerById[p.id] = p; });

  const rosterByTeam: Record<string, string[]> = {};
  const hcpByPlayer: Record<string, number> = {};
  const droppedLog: string[] = [];
  teams.forEach(t => {
    const roster = smRows!.filter((r: any) => r.team_id === t.id).map((r: any) => realPlayerById[r.player_id]);
    roster.sort((a, b) => (a.handicap_index ?? 0) - (b.handicap_index ?? 0));
    const kept = roster.slice(0, 4);
    const dropped = roster.slice(4);
    if (dropped.length > 0) droppedLog.push(`${t.name}: dropped ${dropped.map((p: any) => `${p.display_name} (${p.handicap_index})`).join(', ')} — kept lowest 4`);
    if (kept.length < 4) throw new Error(`${t.name} only has ${kept.length} real members — synthetic padding needed but NAME_BANK was removed; re-add padding logic`);
    rosterByTeam[t.id] = kept.map((p: any) => p.id);
    kept.forEach((p: any) => { hcpByPlayer[p.id] = p.handicap_index ?? 0; });
  });
  const players = teams.flatMap(t => rosterByTeam[t.id].map(pid => ({ id: pid, display_name: realPlayerById[pid].display_name })));
  const overCap = players.filter((p: any) => hcpByPlayer[p.id] > 18);
  console.log('Real rosters used (4/team, lowest handicaps where a team had a surplus):');
  teams.forEach(t => console.log(`  ${t.name}: ${rosterByTeam[t.id].map(pid => `${realPlayerById[pid].display_name} (${hcpByPlayer[pid]})`).join(', ')}`));
  if (droppedLog.length) console.log('Dropped for surplus (>4 real members):\n  ' + droppedLog.join('\n  '));
  if (overCap.length) console.log('NOTE: exceeds the originally-requested 18 max handicap (kept anyway — real roster takes priority per Dave):', overCap.map((p: any) => `${p.display_name} (${hcpByPlayer[p.id]})`).join(', '));
  const teamIds = teams.map(t => t.id);

  // ── Competition ──
  console.log('Creating competition...');
  const pin = String(randInt(1000, 9999));
  const [comp] = await insert<any>('competitions', [{
    society_id: SOCIETY_ID,
    name: 'Titan Tour SIM 2026',
    year: 2026,
    format: 'titan_way',
    tournament_type: 'titan_tour',
    status: 'active',
    settings: { num_teams: 6, format_type: 'titan_way', voice_enabled: false, track_stats_enabled: true },
    pin,
    pts_win: 1, pts_half: 0.5, opening_rounds: 3, bonus_points: 2,
    include_in_kronos: true,
    max_handicap: 18,
    start_date: '2026-09-01', end_date: '2026-09-04',
    prize_pool: 4800, prize_split: [60, 25, 15],
    kronos_overall_prize: 1500,
    description: 'Full simulation run — synthetic players/results, seeded to verify Titan Way scoring end-to-end.',
  }]);
  console.log('Competition id:', comp.id, 'PIN:', pin);

  // ── Days: 3 team rounds (four_bbb, alternating courses) + 1 singles final ──
  const dayDefs = [
    { day_number: 1, course: COURSES[0], format: 'four_bbb', hcp_pct: 85 },
    { day_number: 2, course: COURSES[1], format: 'four_bbb', hcp_pct: 85 },
    { day_number: 3, course: COURSES[0], format: 'four_bbb', hcp_pct: 85 },
    { day_number: 4, course: COURSES[1], format: 'singles_stableford', hcp_pct: 100 },
  ];
  const dayRows = dayDefs.map(d => ({
    competition_id: comp.id,
    day_number: d.day_number,
    course_name: d.course.name,
    course_par: parSumByName[d.course.name],
    course_rating: d.course.courseRating,
    slope_rating: d.course.slopeRating,
    whs_enabled: false,
    day_format: d.format,
    hcp_pct: d.hcp_pct,
    play_date: `2026-09-0${d.day_number + 1}`,
  }));
  const days = await insert<any>('competition_days', dayRows);
  days.sort((a, b) => a.day_number - b.day_number);
  console.log('Days created:', days.map((d: any) => `#${d.day_number} ${d.course_name} (${d.day_format})`).join(' | '));

  // ── Competition players ──
  const compPlayerRows = teams.flatMap(t => rosterByTeam[t.id].map(pid => ({
    competition_id: comp.id, player_id: pid, team_id: t.id,
    handicap_index: hcpByPlayer[pid], status: 'enrolled',
  })));
  await insert('competition_players', compPlayerRows);
  console.log('24 players enrolled across 6 teams.');

  // ── Whole-tournament partnership schedule (real Titan Way engine) ──
  const schedule = generateTitanWaySchedule({ teamIds, rosterByTeam, qualifyingDayNumbers: [1, 2, 3] });
  console.log('Titan Way partnership schedule score (0=no repeats):', schedule.score);

  // helper: strokes-received-based main-game handicap per player for a match
  function matchHcp(pid: string, day: any, allowance: number, groupIds: string[], relativeLow: boolean): number {
    const base = playerCourseHcp(hcpByPlayer[pid], day, allowance);
    if (!relativeLow) return base;
    const groupBases = groupIds.map(id => playerCourseHcp(hcpByPlayer[id], day, allowance));
    return Math.max(0, base - Math.min(...groupBases));
  }

  // Simulates one full match (matchplay, stableford-best-ball comparator),
  // writes match_holes for every hole actually played, returns final state.
  async function simulateAndInsertMatch(opts: {
    competition_id: string; day_id: string; day: any; match_number: number;
    home_team_id: string | null; away_team_id: string | null;
    home_player_ids: string[]; away_player_ids: string[];
    is_singles: boolean; handicap_method: string; hcp_allowance: number;
  }) {
    const { day, home_player_ids, away_player_ids, hcp_allowance, handicap_method } = opts;
    const relativeLow = handicap_method === 'relative_low_stableford' || handicap_method === 'relative_low';
    const allIds = [...home_player_ids, ...away_player_ids];
    const holes = courseHolesByName[day.course_name];

    let holesStr = '';
    const holeRows: any[] = [];
    const stablefordByPlayer: Record<string, number> = {};

    for (const h of holes) {
      const grossByPlayer: Record<string, number> = {};
      const ptsByPlayer: Record<string, number> = {};
      for (const pid of allIds) {
        const chcp = matchHcp(pid, day, hcp_allowance, allIds, relativeLow);
        const gross = simulateGross(h.par, playerCourseHcp(hcpByPlayer[pid], day, 100));
        const shots = calcStrokesReceived(chcp, h.stroke_index);
        const pts = calcStablefordPoints(gross, h.par, shots);
        grossByPlayer[pid] = gross;
        ptsByPlayer[pid] = pts;
        stablefordByPlayer[pid] = (stablefordByPlayer[pid] ?? 0) + pts;
      }
      const homeBest = Math.max(...home_player_ids.map(id => ptsByPlayer[id]));
      const awayBest = Math.max(...away_player_ids.map(id => ptsByPlayer[id]));
      const result: 'h' | 'a' | 'f' = homeBest > awayBest ? 'h' : awayBest > homeBest ? 'a' : 'f';
      holesStr += result;

      for (const pid of allIds) {
        const chcp = matchHcp(pid, day, hcp_allowance, allIds, relativeLow);
        const shots = calcStrokesReceived(chcp, h.stroke_index);
        holeRows.push({
          match_id: null, // filled in after match insert
          player_id: pid, hole_number: h.hole_number,
          score: result, gross_score: grossByPlayer[pid],
          net_score: grossByPlayer[pid] - shots,
          stableford_pts: ptsByPlayer[pid],
        });
      }

      const { concluded } = calcHoles(holesStr, 18, 1);
      if (concluded) break;
    }

    const { homeUp, played, remaining, concluded } = calcHoles(holesStr, 18, 1);
    let winner: string; let result_str: string;
    if (concluded) {
      winner = homeUp > 0 ? 'home' : 'away';
      result_str = `${Math.abs(homeUp)}&${remaining}`;
    } else {
      winner = homeUp === 0 ? 'half' : homeUp > 0 ? 'home' : 'away';
      result_str = homeUp === 0 ? 'Halved' : `${Math.abs(homeUp)}UP`;
    }

    const [match] = await insert<any>('matches', [{
      competition_id: opts.competition_id, day_id: opts.day_id, match_number: opts.match_number,
      home_team_id: opts.home_team_id, away_team_id: opts.away_team_id,
      home_player_ids: opts.home_player_ids, away_player_ids: opts.away_player_ids,
      round_format: 'matchplay', is_singles: opts.is_singles,
      hcp_allowance: opts.hcp_allowance, handicap_method: opts.handicap_method,
      status: 'complete', winner, result_str, holes_string: holesStr.padEnd(18, '.'),
      holes_to_play: 18, start_hole: 1,
      started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
    }]);
    holeRows.forEach(r => { r.match_id = match.id; });
    await insert('match_holes', holeRows);

    return { match, played, stablefordByPlayer };
  }

  // ── Days 1-3: team round-robin, real Titan Way pairings ──
  const allMatches: any[] = [];
  const stablefordTotals: Record<string, number> = {};
  const matchIdsByDay: Record<number, string[]> = {};

  for (const day of days.filter((d: any) => d.day_format === 'four_bbb')) {
    const teamPairs = computeRoundRobinMatchups(teamIds, day.day_number);
    let matchNum = 1;
    matchIdsByDay[day.day_number] = [];
    for (const [tH, tA] of teamPairs) {
      const pairH = schedule.pairingsByDay[day.day_number]?.[tH];
      const pairA = schedule.pairingsByDay[day.day_number]?.[tA];
      if (!pairH || !pairA) continue;
      for (const [homePair, awayPair] of [[pairH.pair1, pairA.pair1], [pairH.pair2, pairA.pair2]] as const) {
        const { match, stablefordByPlayer } = await simulateAndInsertMatch({
          competition_id: comp.id, day_id: day.id, day, match_number: matchNum++,
          home_team_id: tH, away_team_id: tA,
          home_player_ids: [...homePair], away_player_ids: [...awayPair],
          is_singles: false, handicap_method: 'relative_low_stableford', hcp_allowance: day.hcp_pct,
        });
        allMatches.push(match);
        matchIdsByDay[day.day_number].push(match.id);
        Object.entries(stablefordByPlayer).forEach(([pid, pts]) => {
          stablefordTotals[pid] = (stablefordTotals[pid] ?? 0) + pts;
        });
      }
    }
    console.log(`Day ${day.day_number} (${day.course_name}) — ${matchNum - 1} matches simulated.`);
  }

  // ── Day 4: Kronos-seeded singles final ──
  const day4 = days.find((d: any) => d.day_format === 'singles_stableford');
  const teamStableford: Record<string, number> = {};
  teams.forEach(t => {
    teamStableford[t.id] = rosterByTeam[t.id].reduce((s, pid) => s + (stablefordTotals[pid] ?? 0), 0);
  });
  const standings = getStandings(allMatches, comp.pts_win, comp.pts_half, teamStableford, {});
  const bracket = standings.map(s => s.teamId);
  console.log('Standings after 3 team rounds:', standings.map(s => `${teams.find(t => t.id === s.teamId)?.name} (${s.pts}pts, ${s.stableford}sf)`).join(' | '));

  const finalDayMatchIds = new Set(matchIdsByDay[3]);
  const { data: day3HoleRows } = await sb.from('match_holes')
    .select('player_id,match_id,hole_number,stableford_pts').in('match_id', matchIdsByDay[3]);
  const kronosMaps = buildKronosTieBreakMaps((day3HoleRows ?? []) as any, finalDayMatchIds);

  let singlesMatchNum = 1;
  const day4Results: string[] = [];
  for (let i = 0; i < bracket.length - 1; i += 2) {
    const tH = bracket[i]; const tA = bracket[i + 1];
    const rosterH = rankPlayersByKronos(rosterByTeam[tH], stablefordTotals, kronosMaps);
    const rosterA = rankPlayersByKronos(rosterByTeam[tA], stablefordTotals, kronosMaps);
    for (let j = 0; j < 4; j++) {
      const { match } = await simulateAndInsertMatch({
        competition_id: comp.id, day_id: day4.id, day: day4, match_number: singlesMatchNum++,
        home_team_id: tH, away_team_id: tA,
        home_player_ids: [rosterH[j]], away_player_ids: [rosterA[j]],
        is_singles: true, handicap_method: 'individual_stableford', hcp_allowance: day4.hcp_pct,
      });
      allMatches.push(match);
      day4Results.push(`${teams.find(t => t.id === tH)?.name}#${j + 1} vs ${teams.find(t => t.id === tA)?.name}#${j + 1}: ${match.result_str} (${match.winner})`);
    }
  }
  console.log('Day 4 singles results:\n' + day4Results.join('\n'));

  // ── Final standings (include day 4) ──
  const finalStableford: Record<string, number> = { ...teamStableford };
  // add day4 per-player pts already folded into stablefordTotals via simulateAndInsertMatch return values not captured above for day4 — recompute team totals from match_holes we just wrote.
  const { data: allHoleRows } = await sb.from('match_holes').select('player_id,match_id,hole_number,stableford_pts')
    .in('match_id', allMatches.map((m: any) => m.id));
  const finalPlayerTotals: Record<string, number> = {};
  (allHoleRows ?? []).forEach((r: any) => { finalPlayerTotals[r.player_id] = (finalPlayerTotals[r.player_id] ?? 0) + (r.stableford_pts ?? 0); });
  teams.forEach(t => { finalStableford[t.id] = rosterByTeam[t.id].reduce((s, pid) => s + (finalPlayerTotals[pid] ?? 0), 0); });
  const finalBonus = calcSweepBonus(allMatches, new Set([day4.id]), comp.bonus_points);
  const finalStandings = getStandings(allMatches, comp.pts_win, comp.pts_half, finalStableford, finalBonus);
  console.log('FINAL team standings:', finalStandings.map((s, i) => `${i + 1}. ${teams.find(t => t.id === s.teamId)?.name} — ${s.pts}pts`).join(' | '));

  const kronosSorted = Object.entries(finalPlayerTotals).sort((a, b) => b[1] - a[1]);
  const nameByPlayerId: Record<string, string> = {};
  players.forEach((p: any) => { nameByPlayerId[p.id] = p.display_name; });
  console.log('Kronos leaderboard top 5:', kronosSorted.slice(0, 5).map(([pid, pts]) => `${nameByPlayerId[pid]} (${pts})`).join(' | '));

  // ── Prize categories (fake, "go full out") ──
  const [cat1, cat2, cat3] = await insert<any>('prize_categories', [
    { competition_id: comp.id, name: 'Winning Team', display_order: 1 },
    { competition_id: comp.id, name: 'Kronos Individual Champion', display_order: 2 },
    { competition_id: comp.id, name: 'Runner-Up Team', display_order: 3 },
  ]);
  await insert('prize_payouts', [
    { category_id: cat1.id, position: 1, prize_money: 2400 },
    { category_id: cat2.id, position: 1, prize_money: 1500 },
    { category_id: cat3.id, position: 1, prize_money: 900 },
  ]);

  // ── Mark complete ──
  await sb.from('competitions').update({ status: 'complete' }).eq('id', comp.id);

  console.log('\n=== DONE ===');
  console.log('Competition:', comp.name, comp.id);
  console.log('Champion team:', teams.find(t => t.id === finalStandings[0].teamId)?.name);
  console.log('Kronos champion:', nameByPlayerId[kronosSorted[0][0]], kronosSorted[0][1], 'pts');
}

main().catch(e => { console.error('SEED FAILED:', e); process.exit(1); });
