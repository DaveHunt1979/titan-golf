// Titan News AI — snapshot builders.
//
// These functions compute nothing new. They query the same tables and call
// the same getStandings/calcSweepBonus functions the live Tour leaderboard
// uses (see app/(app)/tour/index.tsx), then package the results into the
// plain-facts JSON the titan-news edge function hands to Claude. Titan
// calculates, AI only writes — this file is the "Titan calculates" half.

import { supabase } from './supabase';
import { getStandings, calcSweepBonus } from './scoring';

interface Core {
  competition: any;
  days: any[];
  matches: any[];
  teams: any[];
  cpData: any[];
  holes: any[];
}

async function loadCore(competitionId: string): Promise<Core> {
  const { data: competition, error } = await supabase
    .from('competitions').select('*').eq('id', competitionId).single();
  if (error || !competition) throw new Error('Competition not found');

  const [{ data: days }, { data: matches }, { data: teams }, { data: cpData }] = await Promise.all([
    supabase.from('competition_days').select('*').eq('competition_id', competitionId).order('day_number'),
    supabase.from('matches').select('*').eq('competition_id', competitionId).order('match_number'),
    supabase.from('teams').select('*').eq('society_id', (competition as any).society_id).order('sort_order'),
    supabase.from('competition_players')
      .select('player_id,team_id,handicap_index,players(display_name)')
      .eq('competition_id', competitionId),
  ]);

  const matchIds = ((matches ?? []) as any[]).map(m => m.id);
  const { data: holes } = matchIds.length
    ? await supabase.from('match_holes').select('player_id,stableford_pts,match_id,hole_number').in('match_id', matchIds)
    : { data: [] as any[] };

  return {
    competition, days: (days ?? []) as any[], matches: (matches ?? []) as any[],
    teams: (teams ?? []) as any[], cpData: (cpData ?? []) as any[], holes: (holes ?? []) as any[],
  };
}

function playerName(cpData: any[], playerId: string): string {
  return cpData.find(cp => cp.player_id === playerId)?.players?.display_name ?? '—';
}

function teamName(teams: any[], teamId: string): string {
  return teams.find(t => t.id === teamId)?.name ?? '—';
}

// Individual Stableford totals, restricted to matches whose day_number <= throughDayNumber.
// This IS the Kronos number in this data model (see tour/index.tsx comment: Kronos is just
// this tournament's own cumulative Stableford total) — one calculation, used for both.
function individualTotals(core: Core, throughDayNumber: number): Record<string, number> {
  const dayNumberByDayId = new Map(core.days.map(d => [d.id, d.day_number]));
  const eligibleMatchIds = new Set(
    core.matches.filter(m => (dayNumberByDayId.get(m.day_id) ?? 0) <= throughDayNumber).map(m => m.id)
  );
  const totals: Record<string, number> = {};
  core.holes.forEach(h => {
    if (h.stableford_pts == null || !eligibleMatchIds.has(h.match_id)) return;
    totals[h.player_id] = (totals[h.player_id] ?? 0) + h.stableford_pts;
  });
  return totals;
}

function individualRanking(core: Core, throughDayNumber: number) {
  const totals = individualTotals(core, throughDayNumber);
  return Object.entries(totals)
    .map(([playerId, pts]) => ({ playerId, name: playerName(core.cpData, playerId), pts }))
    .sort((a, b) => b.pts - a.pts);
}

// Team standings through a given day, reusing getStandings/calcSweepBonus exactly
// as the live leaderboard does — no team standings section if this tournament
// doesn't use teams at all (singles/individual-only formats).
function teamRanking(core: Core, throughDayNumber: number) {
  const usesTeams = core.matches.some(m => m.home_team_id && m.away_team_id);
  if (!usesTeams) return null;

  const dayNumberByDayId = new Map(core.days.map(d => [d.id, d.day_number]));
  const eligibleMatches = core.matches.filter(m => (dayNumberByDayId.get(m.day_id) ?? 0) <= throughDayNumber);
  const eligibleDayIds = new Set(core.days.filter(d => d.day_number <= throughDayNumber).map(d => d.id));

  const individualPts = individualTotals(core, throughDayNumber);
  const teamStableford: Record<string, number> = {};
  core.cpData.forEach(cp => {
    if (!cp.team_id) return;
    teamStableford[cp.team_id] = (teamStableford[cp.team_id] ?? 0) + (individualPts[cp.player_id] ?? 0);
  });

  const singlesDayIds = new Set(core.days.filter(d => eligibleDayIds.has(d.id) && d.day_format === 'singles').map(d => d.id));
  const bonusPts = calcSweepBonus(eligibleMatches, singlesDayIds, core.competition.bonus_points ?? 2);
  const standings = getStandings(
    eligibleMatches, core.competition.pts_win ?? 1, core.competition.pts_half ?? 0.5, teamStableford, bonusPts
  );
  return standings.map(s => ({ teamId: s.teamId, teamName: teamName(core.teams, s.teamId), pts: s.pts, wins: s.w, halved: s.h, losses: s.l, played: s.played }));
}

// Position deltas: rank now vs rank as of the previous day. Computed here in
// plain code, never left for the AI to work out (per Rick's brief section 5).
function withPositionDeltas<T extends { playerId?: string; teamId?: string }>(current: T[], previous: T[]) {
  const prevRank = new Map(previous.map((row, i) => [(row as any).playerId ?? (row as any).teamId, i + 1]));
  return current.map((row, i) => {
    const id = (row as any).playerId ?? (row as any).teamId;
    const previousPosition = prevRank.get(id) ?? null;
    const currentPosition = i + 1;
    return { ...row, currentPosition, previousPosition, positionChange: previousPosition ? previousPosition - currentPosition : null };
  });
}

function dayMatchSummaries(core: Core, dayId: string) {
  return core.matches.filter(m => m.day_id === dayId).map(m => ({
    homeTeam: m.home_team_id ? teamName(core.teams, m.home_team_id) : null,
    awayTeam: m.away_team_id ? teamName(core.teams, m.away_team_id) : null,
    homePlayers: (m.home_player_ids ?? []).map((id: string) => playerName(core.cpData, id)),
    awayPlayers: (m.away_player_ids ?? []).map((id: string) => playerName(core.cpData, id)),
    status: m.status,
    resultStr: m.result_str,
    winner: m.winner,
  }));
}

function tournamentInfo(core: Core, currentDay: any | null) {
  return {
    tournamentName: core.competition.name,
    format: core.competition.format,
    tournamentType: core.competition.tournament_type,
    totalRounds: core.days.length,
    currentRound: currentDay?.day_number ?? null,
    course: currentDay?.course_name ?? null,
    date: currentDay?.play_date ?? null,
    status: core.competition.status,
  };
}

export async function buildPreviewSnapshot(competitionId: string, upcomingDayId: string) {
  const core = await loadCore(competitionId);
  const upcomingDay = core.days.find(d => d.id === upcomingDayId);
  if (!upcomingDay) throw new Error('Day not found on this competition');
  const throughDayNumber = upcomingDay.day_number - 1;

  return {
    storyType: 'preview',
    tournament: tournamentInfo(core, upcomingDay),
    currentIndividualLeaderboard: individualRanking(core, throughDayNumber).slice(0, 10),
    currentTeamStandings: teamRanking(core, throughDayNumber),
    todaysMatches: dayMatchSummaries(core, upcomingDayId),
    roundsRemainingAfterToday: core.days.filter(d => d.day_number >= upcomingDay.day_number).length,
  };
}

export async function buildRoundReportSnapshot(competitionId: string, dayId: string) {
  const core = await loadCore(competitionId);
  const day = core.days.find(d => d.id === dayId);
  if (!day) throw new Error('Day not found on this competition');

  const individualNow  = individualRanking(core, day.day_number);
  const individualPrev = individualRanking(core, day.day_number - 1);
  const teamNow  = teamRanking(core, day.day_number);
  const teamPrev = teamRanking(core, day.day_number - 1);

  return {
    storyType: 'round_report',
    tournament: tournamentInfo(core, day),
    individualLeaderboard: withPositionDeltas(individualNow, individualPrev).slice(0, 10),
    teamStandings: teamNow ? withPositionDeltas(teamNow, teamPrev ?? []) : null,
    kronosLeaderboard: core.competition.include_in_kronos ? withPositionDeltas(individualNow, individualPrev).slice(0, 5) : null,
    thisRoundMatches: dayMatchSummaries(core, dayId),
    roundsRemaining: core.days.filter(d => d.day_number > day.day_number).length,
  };
}

export async function buildFinalReportSnapshot(competitionId: string) {
  const core = await loadCore(competitionId);
  const finalDayNumber = Math.max(0, ...core.days.map(d => d.day_number));
  const penultimateDayNumber = Math.max(0, ...core.days.filter(d => d.day_number < finalDayNumber).map(d => d.day_number));

  const individualFinal = individualRanking(core, finalDayNumber);
  const individualPrev  = individualRanking(core, penultimateDayNumber);
  const teamFinal = teamRanking(core, finalDayNumber);
  const teamPrev  = teamRanking(core, penultimateDayNumber);

  return {
    storyType: 'final_report',
    tournament: tournamentInfo(core, null),
    finalIndividualLeaderboard: withPositionDeltas(individualFinal, individualPrev).slice(0, 10),
    finalTeamStandings: teamFinal ? withPositionDeltas(teamFinal, teamPrev ?? []) : null,
    finalKronosLeaderboard: core.competition.include_in_kronos ? withPositionDeltas(individualFinal, individualPrev).slice(0, 5) : null,
    winner: teamFinal?.[0] ?? individualFinal[0] ?? null,
    runnerUp: teamFinal?.[1] ?? individualFinal[1] ?? null,
    finalDayMatches: core.days.length ? dayMatchSummaries(core, core.days[core.days.length - 1].id) : [],
  };
}
