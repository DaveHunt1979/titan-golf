// Titan Season Mode — News Engine integration (spec §14, Dave, 2026-09-06:
// "DO NOT BUILD A SECOND NEWS ENGINE"). Same pattern as
// generateCasualMatchReport in titanNews.ts: build a structured facts
// snapshot client-side, hand it to the existing 'titan-news' edge function,
// which calls Claude to write the actual prose and saves it to the same
// titan_news table every other story type already uses. Season Mode
// calculates the facts; the News Engine decides how to tell the story.
//
// Scope: spec §14.1 lists 18 distinct Season news events. This wires up the
// two highest-value, lowest-noise ones — the season kickoff and the season
// finale — both fire-and-forget from the natural one-shot admin actions
// that already exist (publishDivisions, closeSeason). The remaining 16
// (live position changes, promotion/relegation-zone entry, Major
// leader changes, etc.) are a documented gap, not silently skipped —
// they're much noisier to get right (need de-duplication against a
// player's last-known state) and are a natural next slice.
import { supabase } from './supabase';

async function publishSeasonNewsEvent(seasonId: string, dedupeKey: string, storyType: string, snapshot: Record<string, unknown>): Promise<void> {
  try {
    await supabase.functions.invoke('titan-news', { body: { dedupeKey, seasonId, storyType, snapshot } });
  } catch { /* fire-and-forget — a failed story should never block the admin action that triggered it */ }
}

export async function publishDivisionsPublishedStory(
  seasonId: string,
  seasonName: string,
  divisions: { name: string; playerCount: number }[],
): Promise<void> {
  await publishSeasonNewsEvent(seasonId, `season_divisions_published:${seasonId}`, 'season_divisions_published', {
    storyType: 'season_divisions_published',
    season: { name: seasonName },
    divisions,
  });
}

export interface SeasonFinishedDivisionResult {
  divisionName: string;
  champion: string | null;
  promoted: string[];
  relegated: string[];
}

export async function publishSeasonFinishedStory(
  seasonId: string,
  seasonName: string,
  divisionResults: SeasonFinishedDivisionResult[],
): Promise<void> {
  await publishSeasonNewsEvent(seasonId, `season_finished:${seasonId}`, 'season_finished', {
    storyType: 'season_finished',
    season: { name: seasonName },
    divisionResults,
  });
}

// ── Season Summary (Dave, 2026-09-16) ───────────────────────────────────────
// "a new news feature that after every round or once a week depending on
// what we set it, a summary of the season, this can be as witty as Rick
// Driver and Davey McFadey like." No cron infra exists in this project (see
// admin/season-rounds.tsx etc. — every recurring job here is a manual admin
// button, not a scheduled trigger), so cadence is real but manual: admin
// taps "Post Season Summary" whenever they like (weekly, after a big round,
// whatever), and each tap is its own dated edition — unlike the one-shot
// kickoff/finale stories above, dedupe_key includes a timestamp so editions
// stack up in the feed as history rather than overwriting each other.
//
// Titan calculates every number here from season_entries/season_rounds —
// same "Titan calculates, AI only writes" split as titanNews.ts — the AI's
// only job is turning it into Rick/Davey banter.
export async function buildSeasonSummarySnapshot(seasonId: string) {
  const [{ data: season }, { data: lastSummary }, { data: divisions }] = await Promise.all([
    supabase.from('seasons').select('name, start_at').eq('id', seasonId).maybeSingle(),
    supabase.from('titan_news').select('created_at').eq('season_id', seasonId).eq('story_type', 'season_summary').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('season_divisions').select('id, name').eq('season_id', seasonId).order('display_order', { ascending: true }),
  ]);
  const seasonName = (season as any)?.name ?? 'Titan Season';
  const since = (lastSummary as any)?.created_at ?? (season as any)?.start_at ?? new Date(0).toISOString();
  const divisionRows = (divisions ?? []) as { id: string; name: string }[];

  const leadersByDivision = await Promise.all(divisionRows.map(async d => {
    const { data: entries } = await supabase
      .from('season_entries')
      .select('season_points, current_position, previous_position, movement_status, qualification_status, players(display_name)')
      .eq('division_id', d.id)
      .order('current_position', { ascending: true, nullsFirst: false })
      .limit(3);
    return {
      division: d.name,
      top3: ((entries ?? []) as any[]).map(e => ({
        name: e.players?.display_name ?? 'Unknown', position: e.current_position,
        seasonPoints: e.season_points, movementStatus: e.movement_status,
        qualified: e.qualification_status === 'qualified',
      })),
    };
  }));

  // Movers: anyone whose position changed since the LAST recalculation (not
  // necessarily since the last summary — season_entries only ever stores its
  // single most recent snapshot) — the best proxy available without a
  // separate position-history table, and still a real, Titan-computed fact.
  const { data: moverRows } = await supabase
    .from('season_entries')
    .select('current_position, previous_position, movement_status, players(display_name), season_divisions(name)')
    .eq('season_id', seasonId)
    .not('previous_position', 'is', null)
    .not('current_position', 'is', null);
  const movers = ((moverRows ?? []) as any[])
    .filter(e => e.current_position !== e.previous_position)
    .map(e => ({
      name: e.players?.display_name ?? 'Unknown', division: e.season_divisions?.name ?? null,
      from: e.previous_position, to: e.current_position, movementStatus: e.movement_status,
    }));

  const [{ data: roundRows }, { count: roundsPlayedCount }] = await Promise.all([
    supabase.from('season_rounds')
      .select('final_round_points, course_name, played_at, is_counting, major_id, season_entries(players(display_name), season_divisions(name))')
      .eq('season_id', seasonId)
      .not('status', 'in', '(void,rejected,disputed)')
      .gte('played_at', since)
      .order('final_round_points', { ascending: false })
      .limit(8),
    supabase.from('season_rounds')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', seasonId)
      .not('status', 'in', '(void,rejected,disputed)')
      .gte('played_at', since),
  ]);
  const bigRounds = ((roundRows ?? []) as any[]).map(r => ({
    name: r.season_entries?.players?.display_name ?? 'Unknown', division: r.season_entries?.season_divisions?.name ?? null,
    course: r.course_name, points: r.final_round_points, countedTowardBest: r.is_counting, wasMajorRound: !!r.major_id,
  }));

  return {
    storyType: 'season_summary',
    season: { name: seasonName },
    periodSinceLastSummary: since === ((season as any)?.start_at ?? null) ? 'season start' : since,
    leadersByDivision,
    movers,
    bigRounds,
    qualifyingRoundsPlayedThisPeriod: roundsPlayedCount ?? 0,
  };
}

export async function publishSeasonSummaryStory(seasonId: string, snapshot: Record<string, unknown>): Promise<{ ok: boolean; headline?: string; error?: string }> {
  const dedupeKey = `season_summary:${seasonId}:${Date.now()}`;
  try {
    const { data, error } = await supabase.functions.invoke('titan-news', {
      body: { dedupeKey, seasonId, storyType: 'season_summary', snapshot },
    });
    // The edge function always returns HTTP 200, even on failure — the
    // problem lands in `data.error`, not the response status (see
    // generateCasualMatchReport's identical check in titanNews.ts).
    if (error || data?.error) return { ok: false, error: data?.error ?? error?.message ?? 'Unknown error' };
    return { ok: true, headline: data?.headline };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Unknown error' };
  }
}
