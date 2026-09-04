// Titan Season Mode — the two one-shot admin actions, ported from the mobile
// app's src/lib/seasonDivisions.ts and src/lib/seasonClose.ts so the web
// Command Deck writes exactly the same rows the app does. Logic is kept
// line-for-line equivalent; the only difference is that the supabase client
// is passed in (the web has no module-level singleton).
import type { SupabaseClient } from '@supabase/supabase-js';
import { rankDivisionEntries } from './ranking';

// The web supabase client carries no generated DB types, so every row shape
// below is asserted at the call site the same way the mobile lib does.
type Db = SupabaseClient;

/** Fire-and-forget — a failed story/push must never block the admin action. */
async function invokeQuietly(supabase: Db, fn: string, body: Record<string, unknown>) {
  try {
    await supabase.functions.invoke(fn, { body });
  } catch { /* ignore */ }
}

// ── Publish Divisions (spec §5.2) ───────────────────────────────────────────

export interface PublishDivisionsResult {
  assignedCount: number;
  divisionCounts: Record<string, number>; // division_id -> player count
}

/**
 * Sorts every approved entry by Entry Handicap Index (lowest first, players
 * with no handicap on file sent to the back), fills each division to its
 * target size in display_order, drops any overflow into the bottom division,
 * and flips the season to 'active'.
 *
 * Deliberately re-runnable and NOT idempotent-guarded — matching mobile,
 * "Re-Publish" simply re-sorts and re-slices everyone currently approved.
 */
export async function publishDivisions(supabase: Db, seasonId: string): Promise<PublishDivisionsResult> {
  const [{ data: season }, { data: entries }, { data: divisions }] = await Promise.all([
    supabase.from('seasons').select('name').eq('id', seasonId).maybeSingle(),
    supabase.from('season_entries').select('id, entry_handicap_index').eq('season_id', seasonId).eq('join_status', 'approved'),
    supabase.from('season_divisions').select('id, name, target_player_count').eq('season_id', seasonId).order('display_order', { ascending: true }),
  ]);

  const entryRows = (entries ?? []) as { id: string; entry_handicap_index: number | null }[];
  const divisionRows = (divisions ?? []) as { id: string; name: string; target_player_count: number }[];
  if (entryRows.length === 0 || divisionRows.length === 0) return { assignedCount: 0, divisionCounts: {} };

  const sorted = [...entryRows].sort((a, b) => {
    if (a.entry_handicap_index == null) return b.entry_handicap_index == null ? 0 : 1;
    if (b.entry_handicap_index == null) return -1;
    return a.entry_handicap_index - b.entry_handicap_index;
  });

  const assignments: { id: string; division_id: string }[] = [];
  const divisionCounts: Record<string, number> = {};
  let cursor = 0;
  for (const division of divisionRows) {
    const slice = sorted.slice(cursor, cursor + division.target_player_count);
    for (const entry of slice) assignments.push({ id: entry.id, division_id: division.id });
    divisionCounts[division.id] = slice.length;
    cursor += division.target_player_count;
  }
  // Anyone left over once every division is filled to its target goes into the
  // last (bottom) division rather than being silently dropped.
  if (cursor < sorted.length) {
    const bottomDivision = divisionRows[divisionRows.length - 1];
    for (const entry of sorted.slice(cursor)) {
      assignments.push({ id: entry.id, division_id: bottomDivision.id });
      divisionCounts[bottomDivision.id] = (divisionCounts[bottomDivision.id] ?? 0) + 1;
    }
  }

  const writes = await Promise.all(assignments.map(a =>
    supabase.from('season_entries').update({ division_id: a.division_id }).eq('id', a.id)
  ));
  const failed = (writes as { error?: { message?: string } | null }[]).find(w => w?.error);
  if (failed?.error) throw new Error(failed.error.message ?? 'Could not assign divisions');

  const { error: statusError } = await supabase.from('seasons').update({ status: 'active' }).eq('id', seasonId);
  if (statusError) throw new Error(statusError.message);

  if (assignments.length > 0 && (season as { name?: string } | null)?.name) {
    invokeQuietly(supabase, 'titan-news', {
      dedupeKey: `season_divisions_published:${seasonId}`,
      seasonId,
      storyType: 'season_divisions_published',
      snapshot: {
        storyType: 'season_divisions_published',
        season: { name: (season as { name: string }).name },
        divisions: divisionRows.map(d => ({ name: d.name, playerCount: divisionCounts[d.id] ?? 0 })),
      },
    });
  }

  return { assignedCount: assignments.length, divisionCounts };
}

// ── Close Season (spec §21.1) ───────────────────────────────────────────────

export interface CloseSeasonResult {
  divisionsClosed: number;
  champions: { divisionName: string; playerName: string }[];
}

interface CloseEntryRow {
  id: string;
  player_id: string;
  season_points: number;
  qualifying_rounds_count: number;
  players: { display_name: string | null } | null;
}

/**
 * Finalizes every division: ranks entries, writes final position /
 * movement_status / qualification_status back onto each entry, then locks
 * the season. Anyone still short of the minimum qualifying rounds at close
 * is finalized as DNQ (spec §10.1/§22).
 */
export async function closeSeason(supabase: Db, seasonId: string): Promise<CloseSeasonResult> {
  const { data: season } = await supabase
    .from('seasons').select('name, minimum_qualifying_rounds').eq('id', seasonId).maybeSingle();
  const minRounds = (season as { minimum_qualifying_rounds?: number } | null)?.minimum_qualifying_rounds ?? 20;

  const { data: divisions } = await supabase
    .from('season_divisions').select('id, name, promotion_places, relegation_places')
    .eq('season_id', seasonId).order('display_order', { ascending: true });
  const divisionRows = (divisions ?? []) as { id: string; name: string; promotion_places: number; relegation_places: number }[];

  const champions: { divisionName: string; playerName: string }[] = [];
  const divisionResults: {
    divisionName: string; champion: string | null; promoted: string[]; relegated: string[];
  }[] = [];
  let divisionsClosed = 0;

  for (const division of divisionRows) {
    const { data: entries } = await supabase
      .from('season_entries')
      .select('id, player_id, season_points, qualifying_rounds_count, players(display_name)')
      .eq('division_id', division.id);
    // `players(display_name)` is a to-one embed — supabase-js widens it to an
    // array in the type only, so the assert goes through `unknown`.
    const entryRows = (entries ?? []) as unknown as CloseEntryRow[];
    if (entryRows.length === 0) continue;

    const entryIds = entryRows.map(e => e.id);
    const { data: countingRounds } = await supabase
      .from('season_rounds').select('season_entry_id, final_round_points')
      .in('season_entry_id', entryIds).eq('is_counting', true);
    const pointsByEntry: Record<string, number[]> = {};
    for (const r of (countingRounds ?? []) as { season_entry_id: string; final_round_points: number }[]) {
      (pointsByEntry[r.season_entry_id] ??= []).push(r.final_round_points);
    }

    const finalQualification: Record<string, 'qualified' | 'dnq'> = {};
    for (const e of entryRows) finalQualification[e.id] = e.qualifying_rounds_count >= minRounds ? 'qualified' : 'dnq';

    const ranked = rankDivisionEntries(
      entryRows.map(e => ({
        entryId: e.id,
        seasonPoints: e.season_points,
        qualificationStatus: finalQualification[e.id],
        countingRoundPoints: pointsByEntry[e.id] ?? [],
      })),
      division.promotion_places, division.relegation_places,
    );

    const writes = await Promise.all(ranked.map(r => supabase.from('season_entries').update({
      current_position: r.position,
      movement_status: r.movementStatus,
      qualification_status: finalQualification[r.entryId],
    }).eq('id', r.entryId)));
    const failed = (writes as { error?: { message?: string } | null }[]).find(w => w?.error);
    if (failed?.error) throw new Error(failed.error.message ?? 'Could not finalize standings');

    divisionsClosed++;
    const nameOf = (entryId: string) => entryRows.find(e => e.id === entryId)?.players?.display_name ?? 'Unknown';
    const champ = ranked.find(r => r.movementStatus === 'champion');
    if (champ) champions.push({ divisionName: division.name, playerName: nameOf(champ.entryId) });

    divisionResults.push({
      divisionName: division.name,
      champion: champ ? nameOf(champ.entryId) : null,
      promoted: ranked.filter(r => r.movementStatus === 'promotion').map(r => nameOf(r.entryId)),
      relegated: ranked.filter(r => r.movementStatus === 'relegation').map(r => nameOf(r.entryId)),
    });

    // spec §15 "Season result: Promotion / relegation / champion confirmed."
    // Mobile sends one invoke per player; the body only ever varies by
    // movement status, so the web batches players by status — same messages
    // land on the same phones, four invokes instead of twenty.
    const bodyFor = (status: string) =>
      status === 'champion'   ? `You're the ${division.name} Champion! 🏆`
      : status === 'promotion'  ? `Promoted from ${division.name}!`
      : status === 'relegation' ? `Relegated from ${division.name}.`
      : `${division.name} finished — you're safe.`;
    const byStatus: Record<string, string[]> = {};
    for (const r of ranked) {
      const playerId = entryRows.find(e => e.id === r.entryId)?.player_id;
      if (!playerId) continue;
      (byStatus[r.movementStatus] ??= []).push(playerId);
    }
    for (const [status, playerIds] of Object.entries(byStatus)) {
      invokeQuietly(supabase, 'send-push', { title: 'Titan Season — Final', body: bodyFor(status), playerIds });
    }
  }

  const { error: lockError } = await supabase
    .from('seasons').update({ status: 'locked', locked_at: new Date().toISOString() }).eq('id', seasonId);
  if (lockError) throw new Error(lockError.message);

  if (divisionsClosed > 0 && (season as { name?: string } | null)?.name) {
    invokeQuietly(supabase, 'titan-news', {
      dedupeKey: `season_finished:${seasonId}`,
      seasonId,
      storyType: 'season_finished',
      snapshot: {
        storyType: 'season_finished',
        season: { name: (season as { name: string }).name },
        divisionResults,
      },
    });
  }

  return { divisionsClosed, champions };
}
