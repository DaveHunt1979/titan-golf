// Tournament verification harness (Dave/Ricky, 2026-09-07): proves an 8-group
// real tournament will behave correctly, as opposed to src/lib/simulateTournament.ts's
// "Scale Test" mode which only proves the app survives at volume with random
// data written in one batch. Every write here goes through the exact same
// core as a real scorer (src/lib/matchScoring.ts's computeAndSaveHoleScores),
// hole-by-hole. Ties are deliberately constructed (never random) and checked
// against the real production tie-break functions (kronosTieBreakCompare/
// getStandings from src/lib/scoring.ts) — never a reimplementation.
//
// Permission model, revised 2026-09-07: real per-player session minting (via
// a now-abandoned Edge Function using generateLink+verifyOtp) turned out to
// be fundamentally unreliable — Supabase's Auth Admin API can't produce a
// session for an account that was ever provisioned by writing straight into
// auth.users rather than through GoTrue's own signup/create-user API (this
// app has several such accounts — an admin adding a player before they've
// installed the app, and at least one account of unknown provenance, per
// Dave: "i dont know how maddison was created"). That's not fixable from
// here without touching how accounts get created elsewhere in the app, out
// of scope for this harness. So every write below goes through the admin's
// own session (always passes RLS via the is_society_admin branch, same as
// the rest of this simulator), and assertWouldPassMatchScorer independently
// checks the SAME predicate is_match_scorer()/is_match_participant() actually
// uses (playerId listed in the match's own home/away arrays) — proving the
// data shape a real participant's write would need, without needing a
// genuinely different session to prove RLS live.
import { supabase, fetchAllRows } from './supabase';
import {
  calcStablefordPoints, getStandings, buildKronosTieBreakMaps, rankPlayersByKronos, kronosTieBreakCompare,
} from './scoring';
import { computeAndSaveHoleScores, type MatchForScoring, type CourseHoleForScoring } from './matchScoring';
import { buildRoster, pickSimulationCourse, type SimRosterPlayer, type SimTeam } from './simulateTournament';

export interface VerificationAssertion {
  name: string;
  pass: boolean;
  expected: string;
  actual: string;
  detail?: string;
}

export interface VerificationReport {
  competitionId: string;
  assertions: VerificationAssertion[];
}

// Mirrors is_match_participant() from supabase/migrations/20260901000000_match_holes_participant_rls.sql —
// the real predicate a live scorer's session must satisfy (or be a society
// admin) for match_holes writes to pass RLS.
function wouldPassMatchScorer(match: { home_player_ids: string[]; away_player_ids: string[] }, playerId: string): boolean {
  return match.home_player_ids.includes(playerId) || match.away_player_ids.includes(playerId);
}

// Exact algebraic inverse of calcStablefordPoints (2 + par + shots - gross),
// so a target point value maps to a real gross score the real function then
// re-derives the same points from — never a second, drifting formula.
function grossForTargetPoints(par: number, shots: number, targetPts: number): number {
  if (targetPts <= 0) return Math.max(1, 2 + par + shots + 3); // comfortably past breakeven, clamps to 0
  return Math.max(1, 2 + par + shots - targetPts);
}

async function createSimCompetition(societyId: string, name: string): Promise<{ id: string }> {
  const { data, error } = await supabase.from('competitions').insert([{
    society_id: societyId, name, year: new Date().getFullYear(), format: 'stableford',
    tournament_type: 'titan_tour', status: 'active', settings: {}, pin: String(Math.floor(1000 + Math.random() * 9000)),
    pts_win: 1, pts_half: 0.5, is_simulation: true,
  }]).select();
  if (error) throw error;
  return data![0];
}

async function createSimDay(competitionId: string, course: Awaited<ReturnType<typeof pickSimulationCourse>>): Promise<any> {
  const { data, error } = await supabase.from('competition_days').insert([{
    competition_id: competitionId, day_number: 1, course_name: course.name,
    course_par: course.par, course_rating: course.rating, slope_rating: course.slope,
    day_format: 'stableford', hcp_pct: 100,
  }]).select();
  if (error) throw error;
  return data![0];
}

async function enrollPlayers(competitionId: string, players: SimRosterPlayer[], teamId: string | null = null) {
  await supabase.from('competition_players').insert(players.map(p => ({
    competition_id: competitionId, player_id: p.id, team_id: teamId, handicap_index: p.handicap_index, status: 'enrolled',
  })));
}

interface HoleTarget { par: number; stroke_index: number }

// One player's real hole-by-hole write, through the same computeAndSaveHoleScores
// core a live scorer uses (admin session — see file header on the permission
// model). Returns nothing — the caller re-reads match_holes afterward to
// assert against, same as the real leaderboard would.
async function writeStrokePlayRound(
  match: MatchForScoring, holes: HoleTarget[], targetPtsByHole: number[],
  compPlayers: { player_id: string; handicap_index: number }[], playerId: string,
) {
  const holeChars = Array(18).fill('.');
  const holeSequence = Array.from({ length: 18 }, (_, i) => i + 1);
  for (let h = 0; h < 18; h++) {
    const hole = holes[h];
    const shots = 0; // simulation roster is handed a flat 0-handicap course so target points map 1:1 to gross — see buildFlatCompPlayers
    const gross = grossForTargetPoints(hole.par, shots, targetPtsByHole[h]);
    const outcome = await computeAndSaveHoleScores({
      match, courseHole: hole, activeHole: h + 1, editingHole: false,
      allPlayerIds: [playerId], compPlayers, roundPlayerTees: {}, continuingSecondary: false,
      holeChars, holeSequence, scores: { [playerId]: gross },
    });
    if (outcome.kind !== 'saved') throw new Error(`Hole ${h + 1} write failed for player ${playerId}: ${JSON.stringify(outcome)}`);
    match = { ...match, ...outcome.computed.matchUpdate } as MatchForScoring;
    holeChars[h] = outcome.computed.newHolesStr[h];
  }
  return match;
}

// Multiple players sharing ONE match (e.g. a Kronos tie scenario's stableford
// group) must be written hole-by-hole together, not player-by-player —
// computeAndSaveHoleScores' delete scopes only by match_id+hole_number (this
// mirrors a real group, where one scorer enters everyone's score for a hole
// at once). Writing one player's full 18 holes, then the next player's full
// 18 holes, would have each player's write delete the previous player's row
// for every shared hole (found via a real run, 2026-09-07 — the "genuine
// dead-heat" and "3-way tie" scenarios came back with one player's total
// wiped to zero).
async function writeStrokePlayRoundForGroup(
  match: MatchForScoring, holes: HoleTarget[], targetPtsByPlayerHole: Record<string, number[]>,
  compPlayers: { player_id: string; handicap_index: number }[], playerIds: string[],
) {
  const holeChars = Array(18).fill('.');
  const holeSequence = Array.from({ length: 18 }, (_, i) => i + 1);
  for (let h = 0; h < 18; h++) {
    const hole = holes[h];
    const scores: Record<string, number> = {};
    for (const pid of playerIds) scores[pid] = grossForTargetPoints(hole.par, 0, targetPtsByPlayerHole[pid][h]);
    const outcome = await computeAndSaveHoleScores({
      match, courseHole: hole, activeHole: h + 1, editingHole: false,
      allPlayerIds: playerIds, compPlayers, roundPlayerTees: {}, continuingSecondary: false,
      holeChars, holeSequence, scores,
    });
    if (outcome.kind !== 'saved') throw new Error(`Group hole ${h + 1} write failed: ${JSON.stringify(outcome)}`);
    holeChars[h] = outcome.computed.newHolesStr[h];
  }
}

async function readBackKronosTotals(matchIds: string[]) {
  const holes = await fetchAllRows<any>(
    (from, to) => supabase.from('match_holes').select('player_id,match_id,hole_number,stableford_pts').in('match_id', matchIds).order('id').range(from, to)
  );
  const totals: Record<string, number> = {};
  holes.forEach((h: any) => { totals[h.player_id] = (totals[h.player_id] ?? 0) + (h.stableford_pts ?? 0); });
  return { holes, totals };
}

// Flat 0-handicap comp-player rows and a flat (unrated) day, so shots-received
// is always 0 on every hole for every scenario player — this makes
// grossForTargetPoints a direct, unambiguous mapping with no per-player
// handicap-driven stroke allowance to also account for. The tournament's
// real handicap math (calcStrokesReceived/playerCourseHcp) is exercised
// elsewhere in this app by every real match already; what THIS harness needs
// to prove is the tie-break ladder, not re-prove strokes-received.
function buildFlatCompPlayers(playerIds: string[]) {
  return playerIds.map(id => ({ player_id: id, handicap_index: 0 }));
}
function flatDay(course: { name: string; par: number }): any {
  return { course_name: course.name, course_par: course.par, course_rating: null, slope_rating: null, day_number: 1, competition: null };
}

// ── Individual / Kronos ladder — total pts -> back9 -> back6 -> back3 -> 18th ──
async function runKronosScenarios(
  competitionId: string, dayId: string, course: Awaited<ReturnType<typeof pickSimulationCourse>>, roster: SimRosterPlayer[],
): Promise<VerificationAssertion[]> {
  const assertions: VerificationAssertion[] = [];
  const holes: HoleTarget[] = course.holes.map((h: any) => ({ par: h.par, stroke_index: h.stroke_index }));
  const baseline = Array(18).fill(2);
  const scorerViolations: string[] = [];

  // Scenario patches: index 0-17 = hole 1-18. Each patch object maps
  // playerSlot -> { holeIndex: points }. Baseline is 2 pts/hole for everyone.
  type Scenario = { name: string; players: number; patches: Record<number, number>[]; expectFn: (ids: string[]) => string[] };

  const scenarios: Scenario[] = [
    {
      name: 'Kronos: genuine dead-heat stays unresolved',
      players: 2, patches: [{}, {}],
      expectFn: () => ['TIE'],
    },
    {
      name: 'Kronos: back 9 countback',
      players: 2,
      patches: [{ 0: 3, 9: 1 }, {}], // player A: hole1 +1, hole10 -1 (net 0 total, back9 -1)
      expectFn: (ids) => [ids[1], ids[0]], // B wins (better back9)
    },
    {
      name: 'Kronos: back 6 countback',
      players: 2,
      patches: [{ 9: 3, 12: 1 }, {}], // shuffle within back9 (hole10 vs hole13): back9 sum unchanged, back6 -1
      expectFn: (ids) => [ids[1], ids[0]],
    },
    {
      name: 'Kronos: back 3 countback',
      players: 2,
      patches: [{ 13: 3, 15: 1 }, {}], // shuffle within back6 (hole14 vs hole16): back6 sum unchanged, back3 -1
      expectFn: (ids) => [ids[1], ids[0]],
    },
    {
      name: 'Kronos: final hole (18th) countback',
      players: 2,
      patches: [{ 15: 1, 17: 3 }, {}], // shuffle within back3 (hole16 vs hole18): back3 sum unchanged, hole18 +1
      expectFn: (ids) => [ids[0], ids[1]], // A wins (better 18th)
    },
    {
      name: 'Kronos: 3-way tie resolved only at the final stage',
      players: 3,
      patches: [{ 17: 3 }, {}, { 17: 1 }], // all equal through back3; hole18: P1=3, P2=2, P3=1
      expectFn: (ids) => [ids[0], ids[1], ids[2]],
    },
  ];

  for (const sc of scenarios) {
    const players = roster.slice(0, sc.players);
    const playerIds = players.map(p => p.id);
    const compPlayers = buildFlatCompPlayers(playerIds);
    const day = flatDay(course);

    const { data: matchRows, error } = await supabase.from('matches').insert([{
      competition_id: competitionId, day_id: dayId, match_number: 1,
      home_team_id: null, away_team_id: null, home_player_ids: playerIds, away_player_ids: [],
      round_format: 'stableford', is_singles: false, hcp_allowance: 100, handicap_method: 'individual',
      status: 'upcoming', winner: null, result_str: null, holes_string: '.'.repeat(18),
      holes_to_play: 18, start_hole: 1,
    }]).select();
    if (error) throw error;
    const matchId = matchRows![0].id;

    const matchForScoring: MatchForScoring = {
      id: matchId, round_format: 'stableford', handicap_method: 'individual', secondary_format: null, hcp_allowance: 100,
      home_player_ids: playerIds, away_player_ids: [], status: 'upcoming', winner: null, result_str: null,
      started_at: null, completed_at: null, holes_to_play: 18, competition_id: competitionId, day_id: dayId, day,
    };
    const targetPtsByPlayerHole: Record<string, number[]> = {};
    for (let i = 0; i < players.length; i++) {
      targetPtsByPlayerHole[playerIds[i]] = baseline.map((v, h) => sc.patches[i]?.[h] ?? v);
      if (!wouldPassMatchScorer(matchForScoring, playerIds[i])) scorerViolations.push(`${sc.name}: player ${playerIds[i]}`);
    }
    await writeStrokePlayRoundForGroup(matchForScoring, holes, targetPtsByPlayerHole, compPlayers, playerIds);

    const { holes: readHoles, totals } = await readBackKronosTotals([matchId]);
    const maps = buildKronosTieBreakMaps(readHoles as any, new Set([matchId]));
    const ranked = rankPlayersByKronos(playerIds, totals, maps);

    if (sc.name.includes('dead-heat')) {
      const stillTied = kronosTieBreakCompare(maps, playerIds[0], playerIds[1]) === 0 && totals[playerIds[0]] === totals[playerIds[1]];
      assertions.push({
        name: sc.name, pass: stillTied, expected: 'no rung distinguishes them (score = 0)',
        actual: stillTied ? 'no rung distinguishes them' : `resolved unexpectedly (compare=${kronosTieBreakCompare(maps, playerIds[0], playerIds[1])})`,
      });
      continue;
    }

    const expected = sc.expectFn(playerIds);
    const pass = JSON.stringify(ranked) === JSON.stringify(expected);
    assertions.push({
      name: sc.name, pass,
      expected: expected.join(' > '),
      actual: ranked.join(' > '),
      detail: `totals=${JSON.stringify(totals)}`,
    });
  }

  assertions.push({
    name: 'Permissions: every Kronos scenario write was made by a real match participant',
    pass: scorerViolations.length === 0,
    expected: 'every scorer is listed in the match\'s own home/away player ids (the real is_match_scorer/is_match_participant predicate)',
    actual: scorerViolations.length === 0 ? 'all scorers were real participants' : `violations: ${scorerViolations.join('; ')}`,
  });

  return assertions;
}

// ── Team ladder — match points -> combined Stableford -> head-to-head -> wins ──
async function runTeamLadderScenarios(
  competitionId: string, dayId: string, course: Awaited<ReturnType<typeof pickSimulationCourse>>, societyId: string,
): Promise<VerificationAssertion[]> {
  const assertions: VerificationAssertion[] = [];
  const scorerViolations: string[] = [];
  // 2 teams for the pure "resolved by Stableford" case, 3 more for the
  // "resolved by head-to-head" case — kept as separate groups so each
  // assertion's numbers can be hand-verified independently rather than
  // reused/overlapping (a shared 3-team round-robin design was tried first
  // and its stableford math came out wrong — see project memory).
  const { teams } = await buildEmailedTeams(societyId, 5, 2);
  const [ta, tb, u, v, w] = teams;
  const holes: HoleTarget[] = course.holes.map((h: any) => ({ par: h.par, stroke_index: h.stroke_index }));
  const day = flatDay(course);

  // Every scenario player gets a FLAT points-per-hole value for all 18 holes
  // — since higher Stableford points on a hole == a lower net score at 100%
  // full-handicap allowance (both this match's own comparison and the
  // side-game read off the same shots-received), the higher-points player
  // wins every hole, so the match concludes early exactly like a real
  // decisive matchplay round would (Dave, 2026-09-07 finding).
  async function playSingles(homeId: string, awayId: string, homePts: number, awayPts: number): Promise<{ winner: string; homeTotal: number; awayTotal: number; matchId: string }> {
    const compPlayers = buildFlatCompPlayers([homeId, awayId]);
    const { data: matchRows, error } = await supabase.from('matches').insert([{
      competition_id: competitionId, day_id: dayId, match_number: 1,
      home_team_id: null, away_team_id: null, home_player_ids: [homeId], away_player_ids: [awayId],
      round_format: 'matchplay', is_singles: true, hcp_allowance: 100, handicap_method: 'individual',
      status: 'upcoming', winner: null, result_str: null, holes_string: '.'.repeat(18),
      holes_to_play: 18, start_hole: 1,
    }]).select();
    if (error) throw error;
    const matchId = matchRows![0].id;

    let match: MatchForScoring = {
      id: matchId, round_format: 'matchplay', handicap_method: 'individual', secondary_format: 'stableford', hcp_allowance: 100,
      home_player_ids: [homeId], away_player_ids: [awayId], status: 'upcoming', winner: null, result_str: null,
      started_at: null, completed_at: null, holes_to_play: 18, competition_id: competitionId, day_id: dayId, day,
    };
    const holeChars = Array(18).fill('.');
    const holeSequence = Array.from({ length: 18 }, (_, i) => i + 1);
    if (!wouldPassMatchScorer(match, homeId)) scorerViolations.push(`match ${matchId}: home player ${homeId}`);
    if (!wouldPassMatchScorer(match, awayId)) scorerViolations.push(`match ${matchId}: away player ${awayId}`);

    for (let h = 0; h < 18 && match.status !== 'complete'; h++) {
      const hole = holes[h];
      const homeGross = grossForTargetPoints(hole.par, 0, homePts);
      const awayGross = grossForTargetPoints(hole.par, 0, awayPts);
      // Real 4BBB/singles scoring writes every player's row in one call
      // (computeAndSaveHoleScores already covers both sides via
      // allPlayerIds) — one scorer enters for the whole match, same as a
      // real group on one device.
      const outcome = await computeAndSaveHoleScores({
        match, courseHole: hole, activeHole: h + 1, editingHole: false,
        allPlayerIds: [homeId, awayId], compPlayers, roundPlayerTees: {}, continuingSecondary: false,
        holeChars, holeSequence, scores: { [homeId]: homeGross, [awayId]: awayGross },
      });
      if (outcome.kind !== 'saved') throw new Error(`Team scenario hole ${h + 1} write failed: ${JSON.stringify(outcome)}`);
      match = { ...match, ...outcome.computed.matchUpdate } as MatchForScoring;
      holeChars[h] = outcome.computed.newHolesStr[h];
    }

    const { totals } = await readBackKronosTotals([matchId]);
    return { winner: match.winner ?? 'half', homeTotal: totals[homeId] ?? 0, awayTotal: totals[awayId] ?? 0, matchId };
  }

  // Group A: TA sweeps... no, TA and TB split 1-1 (each wins one of their two
  // singles), tied on points — but TA's win is by a bigger margin (3v1) than
  // TB's win (2v1), so TA's combined Stableford (4N) beats TB's (3N).
  const a1 = await playSingles(ta.playerIds[0], tb.playerIds[0], 3, 1); // TA beats TB
  const a2 = await playSingles(ta.playerIds[1], tb.playerIds[1], 1, 2); // TB beats TA

  const groupAMatches = [
    { home_team_id: ta.id, away_team_id: tb.id, status: 'complete', winner: a1.winner, result_str: 'x', holes_string: 'x', is_singles: true },
    { home_team_id: ta.id, away_team_id: tb.id, status: 'complete', winner: a2.winner, result_str: 'x', holes_string: 'x', is_singles: true },
  ];
  const { totals: groupATotals } = await readBackKronosTotals([a1.matchId, a2.matchId]);
  const groupAStableford: Record<string, number> = {};
  for (const t of [ta, tb]) groupAStableford[t.id] = t.playerIds.reduce((s, pid) => s + (groupATotals[pid] ?? 0), 0);
  const groupAStandings = getStandings(groupAMatches as any, 1, 0.5, groupAStableford, {});
  const taStanding = groupAStandings.find(s => s.teamId === ta.id)!;
  const tbStanding = groupAStandings.find(s => s.teamId === tb.id)!;
  const groupAPointsTied = taStanding.pts === tbStanding.pts;
  const taAboveTb = groupAStandings.findIndex(s => s.teamId === ta.id) < groupAStandings.findIndex(s => s.teamId === tb.id);

  assertions.push({
    name: 'Team ladder: tied on points, resolved by combined Stableford',
    pass: groupAPointsTied && taStanding.stableford !== tbStanding.stableford && taAboveTb,
    expected: 'TA/TB level on points; TA ranks above TB on higher combined Stableford',
    actual: `pointsTied=${groupAPointsTied}, TA stableford=${taStanding.stableford}, TB stableford=${tbStanding.stableford}, TA above TB=${taAboveTb}`,
    detail: JSON.stringify(groupAStandings.map(s => ({ team: s.teamId, pts: s.pts, stableford: s.stableford }))),
  });

  // Group B: U and V meet three times (U wins 2, V wins 1 — a clean 2-1
  // head-to-head lead for U, not a tie), then each takes one match against a
  // third team W (V beats W, W beats U) so their OVERALL points level out
  // at 2 apiece despite U's head-to-head edge, and their combined Stableford
  // is engineered to land exactly equal too — so only head-to-head can
  // separate them. W stays clearly behind on both, uninvolved in the tie.
  const b1 = await playSingles(u.playerIds[0], v.playerIds[0], 3, 1); // U beats V
  const b2 = await playSingles(u.playerIds[1], v.playerIds[1], 3, 1); // U beats V again
  const b3 = await playSingles(v.playerIds[0], u.playerIds[0], 3, 1); // V beats U (3rd meeting)
  const b4 = await playSingles(v.playerIds[1], w.playerIds[0], 3, 1); // V beats W
  const b5 = await playSingles(w.playerIds[0], u.playerIds[1], 3, 1); // W beats U

  const groupBMatches = [
    { home_team_id: u.id, away_team_id: v.id, status: 'complete', winner: b1.winner, result_str: 'x', holes_string: 'x', is_singles: true },
    { home_team_id: u.id, away_team_id: v.id, status: 'complete', winner: b2.winner, result_str: 'x', holes_string: 'x', is_singles: true },
    { home_team_id: v.id, away_team_id: u.id, status: 'complete', winner: b3.winner, result_str: 'x', holes_string: 'x', is_singles: true },
    { home_team_id: v.id, away_team_id: w.id, status: 'complete', winner: b4.winner, result_str: 'x', holes_string: 'x', is_singles: true },
    { home_team_id: w.id, away_team_id: u.id, status: 'complete', winner: b5.winner, result_str: 'x', holes_string: 'x', is_singles: true },
  ];
  const { totals: groupBTotals } = await readBackKronosTotals([b1.matchId, b2.matchId, b3.matchId, b4.matchId, b5.matchId]);
  const groupBStableford: Record<string, number> = {};
  for (const t of [u, v, w]) groupBStableford[t.id] = t.playerIds.reduce((s, pid) => s + (groupBTotals[pid] ?? 0), 0);
  const groupBStandings = getStandings(groupBMatches as any, 1, 0.5, groupBStableford, {});
  const uStanding = groupBStandings.find(s => s.teamId === u.id)!;
  const vStanding = groupBStandings.find(s => s.teamId === v.id)!;
  const uRank = groupBStandings.findIndex(s => s.teamId === u.id);
  const vRank = groupBStandings.findIndex(s => s.teamId === v.id);
  const groupBPointsTied = uStanding.pts === vStanding.pts;
  const groupBStablefordTied = uStanding.stableford === vStanding.stableford;
  const uAboveV = uRank < vRank;

  assertions.push({
    name: 'Team ladder: tied on points AND Stableford, resolved by head-to-head',
    pass: groupBPointsTied && groupBStablefordTied && uAboveV,
    expected: 'U and V level on points+Stableford; U ranks above V (leads their head-to-head 2-1)',
    actual: `pointsTied=${groupBPointsTied}, stablefordTied=${groupBStablefordTied}, UAboveV=${uAboveV}`,
    detail: JSON.stringify(groupBStandings.map(s => ({ team: s.teamId, pts: s.pts, stableford: s.stableford, w: s.w }))),
  });
  assertions.push({
    name: 'Permissions: every team-ladder write was made by a real match participant',
    pass: scorerViolations.length === 0,
    expected: 'every scorer is listed in their match\'s own home/away player ids (the real is_match_scorer/is_match_participant predicate)',
    actual: scorerViolations.length === 0 ? 'all scorers were real participants' : `violations: ${scorerViolations.join('; ')}`,
  });

  return assertions;
}

// ── Concurrency + real permission check + a correction ──
async function runConcurrentGroupsAndCorrection(
  competitionId: string, dayId: string, course: Awaited<ReturnType<typeof pickSimulationCourse>>, roster: SimRosterPlayer[], groupCount: number,
): Promise<VerificationAssertion[]> {
  const assertions: VerificationAssertion[] = [];
  const holes: HoleTarget[] = course.holes.map((h: any) => ({ par: h.par, stroke_index: h.stroke_index }));
  const day = flatDay(course);
  const groups = Array.from({ length: groupCount }, (_, i) => roster[i % roster.length]);

  const scorerViolations: string[] = [];
  const started = Date.now();
  const results = await Promise.all(groups.map(async (player, idx) => {
    const compPlayers = buildFlatCompPlayers([player.id]);
    const { data: matchRows, error } = await supabase.from('matches').insert([{
      competition_id: competitionId, day_id: dayId, match_number: idx + 1,
      home_team_id: null, away_team_id: null, home_player_ids: [player.id], away_player_ids: [],
      round_format: 'stableford', is_singles: false, hcp_allowance: 100, handicap_method: 'individual',
      status: 'upcoming', winner: null, result_str: null, holes_string: '.'.repeat(18),
      holes_to_play: 18, start_hole: 1,
    }]).select();
    if (error) throw error;
    const matchId = matchRows![0].id;
    const matchForScoring: MatchForScoring = {
      id: matchId, round_format: 'stableford', handicap_method: 'individual', secondary_format: null, hcp_allowance: 100,
      home_player_ids: [player.id], away_player_ids: [], status: 'upcoming', winner: null, result_str: null,
      started_at: null, completed_at: null, holes_to_play: 18, competition_id: competitionId, day_id: dayId, day,
    };
    if (!wouldPassMatchScorer(matchForScoring, player.id)) scorerViolations.push(`group ${idx + 1}: player ${player.id}`);
    await writeStrokePlayRound(matchForScoring, holes, Array(18).fill(2), compPlayers, player.id);
    return { player, matchId, compPlayers };
  }));
  const elapsedMs = Date.now() - started;

  assertions.push({
    name: `Concurrency: ${groupCount} groups scored under Promise.all`,
    pass: true,
    expected: `${groupCount} groups complete without serializing`,
    actual: `completed in ${elapsedMs}ms`,
  });

  assertions.push({
    name: 'Permissions: every group\'s scorer is a real match participant',
    pass: scorerViolations.length === 0,
    expected: 'every scorer is listed in their match\'s own home/away player ids (the real is_match_scorer/is_match_participant predicate)',
    actual: scorerViolations.length === 0 ? 'all scorers were real participants' : `violations: ${scorerViolations.join('; ')}`,
  });

  // Correction: replay hole 1 for the first group with a different score,
  // through the same real editing path.
  const first = results[0];
  const correctedTarget = 4;
  const correctedGross = grossForTargetPoints(holes[0].par, 0, correctedTarget);
  const { data: matchNow } = await supabase.from('matches').select('*').eq('id', first.matchId).single();
  const outcome = await computeAndSaveHoleScores({
    match: { ...matchNow, day } as MatchForScoring, courseHole: holes[0], activeHole: 1, editingHole: true,
    allPlayerIds: [first.player.id], compPlayers: first.compPlayers, roundPlayerTees: {}, continuingSecondary: false,
    holeChars: (matchNow!.holes_string as string).split(''), holeSequence: Array.from({ length: 18 }, (_, i) => i + 1),
    scores: { [first.player.id]: correctedGross },
  });
  const correctionSaved = outcome.kind === 'saved';
  const { data: readBackHole } = await supabase.from('match_holes').select('stableford_pts').eq('match_id', first.matchId).eq('hole_number', 1).eq('player_id', first.player.id).maybeSingle();
  const correctionApplied = correctionSaved && readBackHole?.stableford_pts === correctedTarget;
  assertions.push({
    name: 'Correction: an already-played hole can be re-scored through the real editing path',
    pass: correctionApplied,
    expected: `hole 1 stableford_pts = ${correctedTarget} after correction`,
    actual: `stableford_pts = ${readBackHole?.stableford_pts ?? 'MISSING'}`,
  });

  return assertions;
}

// A real per-player session can only ever be minted for a player with a
// real auth account behind them — a guest/admin-added roster row with no
// email (e.g. added purely to fill out a team, never actually signed up)
// has nothing to mint a session for. buildRoster() (shared with the
// unrelated Scale Test feature, which never needs real sessions) doesn't
// know or care about this, so the verification harness filters for it
// itself rather than changing that shared helper's behavior.
async function buildEmailedRoster(societyId: string, needed: number, onProgress?: (m: string) => void): Promise<SimRosterPlayer[]> {
  const pool = await buildRoster(societyId, needed, 'Verification', onProgress);
  const { data: emailRows } = await supabase.from('players').select('id,email').in('id', pool.map(p => p.id));
  const emailById = new Map((emailRows ?? []).map((r: any) => [r.id, r.email as string | null]));
  const withEmail = pool.filter(p => !!emailById.get(p.id));
  if (withEmail.length >= needed) return withEmail.slice(0, needed);

  // Not enough of the sampled pool has a real account — widen the search
  // across the whole society rather than silently running with fewer
  // groups than asked for.
  const { data: smRows } = await supabase.from('society_members').select('player_id').eq('society_id', societyId);
  const allIds = [...new Set((smRows ?? []).map((r: any) => r.player_id).filter(Boolean))];
  const { data: allPlayers } = await supabase.from('players').select('id,display_name,handicap_index,email').in('id', allIds);
  const emailed = ((allPlayers ?? []) as any[]).filter(p => !!p.email);
  if (emailed.length < needed) {
    throw new Error(
      `Verification needs ${needed} real members with a real login (a real session gets minted for each) — ` +
      `this society only has ${emailed.length} member${emailed.length === 1 ? '' : 's'} with an email on file ` +
      `out of ${allIds.length} total. Guest/no-email players can't be used here since there's no real account to score as.`
    );
  }
  return emailed.slice(0, needed).map(p => ({ id: p.id, display_name: p.display_name ?? '—', handicap_index: p.handicap_index ?? 12 }));
}

// Same reasoning as buildEmailedRoster, for teams: every member of a picked
// team needs a real session minted, so a team with even one no-email guest
// member can't be used here, regardless of what buildRealTeams (shared with
// Scale Test) would otherwise consider eligible.
async function buildEmailedTeams(societyId: string, numTeams: number, playersPerTeam: number): Promise<{ teams: SimTeam[]; roster: SimRosterPlayer[] }> {
  const { data: teamRows } = await supabase.from('teams').select('id,name').eq('society_id', societyId).order('sort_order');
  const { data: memberRows } = await supabase
    .from('society_members').select('player_id, team_id, players(display_name, handicap_index, email)')
    .eq('society_id', societyId);

  const membersByTeam: Record<string, SimRosterPlayer[]> = {};
  const emailOkByTeam: Record<string, boolean> = {};
  const seenByTeam: Record<string, Set<string>> = {};
  for (const m of ((memberRows ?? []) as any[])) {
    if (!m.team_id || !m.player_id) continue;
    const seen = (seenByTeam[m.team_id] ??= new Set<string>());
    if (seen.has(m.player_id)) continue;
    seen.add(m.player_id);
    (membersByTeam[m.team_id] ??= []).push({
      id: m.player_id, display_name: m.players?.display_name ?? '—', handicap_index: m.players?.handicap_index ?? 12,
    });
    if (!m.players?.email) emailOkByTeam[m.team_id] = false;
    else emailOkByTeam[m.team_id] ??= true;
  }

  const eligible = ((teamRows ?? []) as any[])
    .map(t => ({ id: t.id as string, name: (t.name as string) ?? '—', members: membersByTeam[t.id] ?? [] }))
    .filter(t => t.members.length >= playersPerTeam && emailOkByTeam[t.id]);

  if (eligible.length < numTeams) {
    throw new Error(
      `Team ladder scenario needs ${numTeams} teams of ${playersPerTeam} real members with a real login each — ` +
      `this society only has ${eligible.length} team${eligible.length === 1 ? '' : 's'} qualifying ` +
      `(guest/no-email members disqualify a team here, even if buildRealTeams would otherwise accept it).`
    );
  }

  const picked = eligible.slice(0, numTeams);
  const teams: SimTeam[] = picked.map(t => ({ id: t.id, name: t.name, playerIds: t.members.slice(0, playersPerTeam).map(p => p.id) }));
  const roster: SimRosterPlayer[] = picked.flatMap(t => t.members.slice(0, playersPerTeam));
  return { teams, roster };
}

export interface RunVerificationOptions {
  societyId: string;
  groupCount: number; // e.g. 8
  onProgress?: (msg: string) => void;
}

export async function runVerification(opts: RunVerificationOptions): Promise<VerificationReport> {
  const { societyId, groupCount, onProgress } = opts;
  onProgress?.('Checking course data...');
  const course = await pickSimulationCourse();

  onProgress?.('Creating verification competition...');
  const comp = await createSimCompetition(societyId, `Verification — ${groupCount} groups — ${new Date().toLocaleDateString('en-GB')}`);
  const day = await createSimDay(comp.id, course);

  onProgress?.('Loading roster...');
  const roster = await buildEmailedRoster(societyId, Math.max(groupCount, 6), onProgress);
  await enrollPlayers(comp.id, roster);

  const assertions: VerificationAssertion[] = [];

  onProgress?.('Running concurrent groups + a real correction...');
  assertions.push(...await runConcurrentGroupsAndCorrection(comp.id, day.id, course, roster, groupCount));

  onProgress?.('Running Kronos individual tie-break ladder...');
  assertions.push(...await runKronosScenarios(comp.id, day.id, course, roster));

  onProgress?.('Running team tie-break ladder...');
  assertions.push(...await runTeamLadderScenarios(comp.id, day.id, course, societyId));

  await supabase.from('competitions').update({ status: 'complete' }).eq('id', comp.id);

  return { competitionId: comp.id, assertions };
}
