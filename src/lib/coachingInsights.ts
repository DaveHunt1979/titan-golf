// McFadey & Driver Coaching — snapshot builder + report fetch/generate.
//
// Same "Titan calculates, AI only writes" split as titanNews.ts: every
// number here comes straight from match_holes/course_holes, nothing
// inferred. The coaching-report edge function's only job is to turn the
// snapshot into Davey McFadey & Rick Driver's write-up.

import { supabase, fetchAllRows } from './supabase';
import { scoreVsPar } from './scoring';

export interface EligibleCourse {
  courseName: string;
  roundsPlayed: number;
  lastPlayed: string | null;
}

export interface HoleStat {
  holeNumber: number;
  par: number | null;
  roundsPlayed: number;
  avgScore: number;
  avgVsPar: number;
  bestScore: number;
  worstScore: number;
  birdiesOrBetter: number;
  bogeysOrWorse: number;
}

export interface CoachingSnapshot {
  courseName: string;
  roundsAnalyzed: number;
  holeStats: HoleStat[];
  strongestHoles: HoleStat[];
  problemHoles: HoleStat[];
  trend: 'improving' | 'declining' | 'steady';
  roundHistory: { playDate: string | null; vsPar: number }[];
}

export interface CoachingReport {
  id: string;
  player_id: string;
  course_name: string;
  rounds_analyzed: number;
  headline: string | null;
  summary: string | null;
  body: string | null;
  strongest_holes: HoleStat[];
  problem_holes: HoleStat[];
  suggestions: string[];
  banter_speaker: 'mcfadey' | 'driver' | null;
  banter_text: string | null;
  updated_at: string;
}

const MIN_ROUNDS_TO_UNLOCK = 3;
const MAX_ROUNDS_ANALYZED = 10;
const MIN_HOLE_SAMPLE = 2;

// competition_days carries play_date on tournament-created days and
// day_date on ones stamped by create_game_day_with_code — same fallback
// camera/index.tsx already relies on (2026-08-xx), needed here to order
// casual rounds by when they were actually played.
function dayDate(day: { play_date?: string | null; day_date?: string | null } | null | undefined): string | null {
  return day?.play_date ?? day?.day_date ?? null;
}

async function loadPlayerHoleRows(playerId: string) {
  return fetchAllRows<any>((from, to) => supabase
    .from('match_holes')
    .select('match_id, hole_number, gross_score, matches(day:day_id(course_name, play_date, day_date))')
    .eq('player_id', playerId)
    .not('gross_score', 'is', null)
    .order('id')
    .range(from, to));
}

// Every course this player has played at least MIN_ROUNDS_TO_UNLOCK rounds
// at — a smaller sample can't tell a strong hole from a lucky one.
export async function listEligibleCourses(playerId: string): Promise<EligibleCourse[]> {
  const rows = await loadPlayerHoleRows(playerId);

  const byCourse = new Map<string, { matchIds: Set<string>; lastPlayed: string | null }>();
  for (const r of rows) {
    const courseName = r.matches?.day?.course_name;
    if (!courseName) continue;
    if (!byCourse.has(courseName)) byCourse.set(courseName, { matchIds: new Set(), lastPlayed: null });
    const entry = byCourse.get(courseName)!;
    entry.matchIds.add(r.match_id);
    const played = dayDate(r.matches?.day);
    if (played && (!entry.lastPlayed || played > entry.lastPlayed)) entry.lastPlayed = played;
  }

  return [...byCourse.entries()]
    .map(([courseName, v]) => ({ courseName, roundsPlayed: v.matchIds.size, lastPlayed: v.lastPlayed }))
    .filter(c => c.roundsPlayed >= MIN_ROUNDS_TO_UNLOCK)
    .sort((a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? ''));
}

export async function buildCoachingSnapshot(playerId: string, courseName: string): Promise<CoachingSnapshot> {
  const rows = await loadPlayerHoleRows(playerId);
  const courseRows = rows.filter(r => r.matches?.day?.course_name === courseName);

  const matchDates = new Map<string, string | null>();
  courseRows.forEach(r => {
    if (!matchDates.has(r.match_id)) matchDates.set(r.match_id, dayDate(r.matches?.day));
  });
  // Most recent MAX_ROUNDS_ANALYZED rounds only — a report meant to guide
  // the player's next round at this course should reflect current form,
  // not a stale slice from years back.
  const recentMatchIds = new Set(
    [...matchDates.entries()]
      .sort((a, b) => (b[1] ?? '').localeCompare(a[1] ?? ''))
      .slice(0, MAX_ROUNDS_ANALYZED)
      .map(([id]) => id)
  );
  const usedRows = courseRows.filter(r => recentMatchIds.has(r.match_id));

  const { data: courseHoles } = await supabase
    .from('course_holes').select('hole_number, par').eq('course_name', courseName);
  const parByHole = new Map<number, number>((courseHoles ?? []).map((h: any) => [h.hole_number, h.par]));

  const holeAgg = new Map<number, { scores: number[]; vsParSum: number; birdiesPlus: number; bogeysPlus: number }>();
  usedRows.forEach(r => {
    const par = parByHole.get(r.hole_number);
    if (par == null) return;
    if (!holeAgg.has(r.hole_number)) holeAgg.set(r.hole_number, { scores: [], vsParSum: 0, birdiesPlus: 0, bogeysPlus: 0 });
    const agg = holeAgg.get(r.hole_number)!;
    agg.scores.push(r.gross_score);
    agg.vsParSum += r.gross_score - par;
    // Gross-vs-par categorisation, never Stableford points (Rick's brief,
    // 2026-08-25 section 10) — same convention profile/stats.tsx uses.
    const category = scoreVsPar(r.gross_score, par);
    if (category === 'eagle' || category === 'birdie') agg.birdiesPlus++;
    if (category === 'bogey' || category === 'double')  agg.bogeysPlus++;
  });

  const holeStats: HoleStat[] = [...holeAgg.entries()]
    .map(([holeNumber, agg]) => ({
      holeNumber,
      par: parByHole.get(holeNumber) ?? null,
      roundsPlayed: agg.scores.length,
      avgScore: Math.round((agg.scores.reduce((s, v) => s + v, 0) / agg.scores.length) * 10) / 10,
      avgVsPar: Math.round((agg.vsParSum / agg.scores.length) * 10) / 10,
      bestScore: Math.min(...agg.scores),
      worstScore: Math.max(...agg.scores),
      birdiesOrBetter: agg.birdiesPlus,
      bogeysOrWorse: agg.bogeysPlus,
    }))
    .sort((a, b) => a.holeNumber - b.holeNumber);

  const eligibleHoles = holeStats.filter(h => h.roundsPlayed >= MIN_HOLE_SAMPLE);
  const strongestHoles = [...eligibleHoles].sort((a, b) => a.avgVsPar - b.avgVsPar).slice(0, 3);
  const problemHoles = [...eligibleHoles].sort((a, b) => b.avgVsPar - a.avgVsPar).slice(0, 3);

  // Round-level trend: total strokes-vs-par per round, oldest to newest,
  // first half of the sample compared to the second half. A >1-shot swing
  // either way is called out; anything smaller is noise, not a trend.
  const roundHistory = [...recentMatchIds]
    .map(matchId => {
      const holeRows = usedRows.filter(r => r.match_id === matchId);
      let vsPar = 0, counted = 0;
      holeRows.forEach(r => {
        const par = parByHole.get(r.hole_number);
        if (par == null) return;
        vsPar += r.gross_score - par;
        counted++;
      });
      return { playDate: matchDates.get(matchId) ?? null, vsPar, counted };
    })
    .filter(r => r.counted > 0)
    .sort((a, b) => (a.playDate ?? '').localeCompare(b.playDate ?? ''));

  const half = Math.floor(roundHistory.length / 2);
  const earlierAvg = half > 0 ? roundHistory.slice(0, half).reduce((s, r) => s + r.vsPar, 0) / half : null;
  const laterCount = roundHistory.length - half;
  const laterAvg = laterCount > 0 ? roundHistory.slice(half).reduce((s, r) => s + r.vsPar, 0) / laterCount : null;
  const trend: CoachingSnapshot['trend'] =
    earlierAvg != null && laterAvg != null
      ? (laterAvg < earlierAvg - 1 ? 'improving' : laterAvg > earlierAvg + 1 ? 'declining' : 'steady')
      : 'steady';

  return {
    courseName,
    roundsAnalyzed: recentMatchIds.size,
    holeStats,
    strongestHoles,
    problemHoles,
    trend,
    roundHistory: roundHistory.map(r => ({ playDate: r.playDate, vsPar: r.vsPar })),
  };
}

export async function getCachedReport(playerId: string, courseName: string): Promise<CoachingReport | null> {
  const { data } = await supabase
    .from('ai_coaching_reports')
    .select('*')
    .eq('player_id', playerId)
    .eq('course_name', courseName)
    .maybeSingle();
  return (data as any) ?? null;
}

// Builds the snapshot, hands it to the coaching-report edge function, and
// returns the saved row. Regeneration overwrites the same player+course row
// (see the UNIQUE constraint in 20260918050000_ai_coaching_reports.sql)
// rather than piling up history — this is a "how am I doing right now"
// report, not an archive.
export async function generateCoachingReport(playerId: string, courseName: string): Promise<CoachingReport> {
  const snapshot = await buildCoachingSnapshot(playerId, courseName);
  const { data, error } = await supabase.functions.invoke('coaching-report', {
    body: { playerId, courseName, snapshot },
  });
  // The edge function always returns HTTP 200, even on failure (Anthropic
  // error, unparseable report, DB save failure) — same convention as
  // titan-news, so a transport-level `error` alone can't see it.
  if (error || data?.error) throw new Error(data?.error ?? error?.message ?? 'Report generation failed');
  return data as CoachingReport;
}
