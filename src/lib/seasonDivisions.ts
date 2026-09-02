// Titan Season Mode — division seeding (spec §5.2, Dave, 2026-09-06).
// Sorts every approved entry by their Entry Handicap Index (captured at
// approval, never recalculated after the fact — spec §5.2 note 2/§5.3),
// fills each division to its target size in display_order, and publishes.
//
// Simplification: the spec's full lifecycle (DRAFT → REGISTRATION_OPEN →
// ... → DIVISIONS_PREVIEW → PUBLISHED → ACTIVE) has several intermediate
// states with their own admin UI this app doesn't have yet. This collapses
// straight from 'draft' to 'active' in one admin action — a real yearly
// cadence with a registration window and an admin preview step before
// publishing is a later refinement, not built here.
import { supabase } from './supabase';
import { publishDivisionsPublishedStory } from './seasonNews';

export interface PublishDivisionsResult {
  assignedCount: number;
  divisionCounts: Record<string, number>; // division_id -> player count
}

export async function publishDivisions(seasonId: string): Promise<PublishDivisionsResult> {
  const [{ data: season }, { data: entries }, { data: divisions }] = await Promise.all([
    supabase.from('seasons').select('name').eq('id', seasonId).maybeSingle(),
    supabase.from('season_entries').select('id, entry_handicap_index').eq('season_id', seasonId).eq('join_status', 'approved'),
    supabase.from('season_divisions').select('id, name, target_player_count').eq('season_id', seasonId).order('display_order', { ascending: true }),
  ]);

  const entryRows = (entries ?? []) as { id: string; entry_handicap_index: number | null }[];
  const divisionRows = (divisions ?? []) as { id: string; name: string; target_player_count: number }[];
  if (entryRows.length === 0 || divisionRows.length === 0) return { assignedCount: 0, divisionCounts: {} };

  // Lowest handicap first, nulls (no handicap on file) sent to the back —
  // spec §5.2 doesn't say what to do with a missing handicap, so this is
  // the safest reading: never guess a rating for someone, place them last.
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
  // Anyone left over once every division is filled to its target goes into
  // the last (bottom) division rather than being silently dropped.
  if (cursor < sorted.length && divisionRows.length > 0) {
    const bottomDivision = divisionRows[divisionRows.length - 1];
    for (const entry of sorted.slice(cursor)) {
      assignments.push({ id: entry.id, division_id: bottomDivision.id });
      divisionCounts[bottomDivision.id] = (divisionCounts[bottomDivision.id] ?? 0) + 1;
    }
  }

  await Promise.all(assignments.map(a => supabase.from('season_entries').update({ division_id: a.division_id } as any).eq('id', a.id)));
  await supabase.from('seasons').update({ status: 'active' } as any).eq('id', seasonId);

  if (assignments.length > 0 && (season as any)?.name) {
    publishDivisionsPublishedStory(seasonId, (season as any).name, divisionRows.map(d => ({
      name: d.name, playerCount: divisionCounts[d.id] ?? 0,
    }))); // fire-and-forget — never block Publish Divisions on the news story
  }

  return { assignedCount: assignments.length, divisionCounts };
}
