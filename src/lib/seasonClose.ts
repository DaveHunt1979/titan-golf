// Titan Season Mode — Season Close (spec §21.1, Dave, 2026-09-06). Admin-
// triggered (this app has no background cron to fire it automatically at
// end_at), same one-shot-action pattern as publishDivisions.
//
// Simplification: spec §21.1 has 13 steps including a VERIFICATION_GRACE
// wait and a separate admin preview before confirming. Since this app's
// anti-cheat model has no pending-verification state to begin with (see
// seasonRoundIngestion.ts — a round scores itself the moment it's
// ingested), there's nothing to wait out; this runs the whole close in one
// action. Also NOT built: automatically creating next-season provisional
// division assignments (spec §6.4 steps 8-15) — that's a big enough
// feature (seeding a season that doesn't exist yet from this one's
// results) to be its own slice later.
import { supabase, fetchAllRows } from './supabase';
import { rankDivisionEntries } from './seasonLeaderboard';
import { publishSeasonFinishedStory, type SeasonFinishedDivisionResult } from './seasonNews';
import { sendPushNotification } from './notifications';

export interface CloseSeasonResult {
  divisionsClosed: number;
  champions: { divisionName: string; playerName: string }[];
}

export async function closeSeason(seasonId: string): Promise<CloseSeasonResult> {
  const { data: season } = await supabase.from('seasons').select('name, minimum_qualifying_rounds').eq('id', seasonId).maybeSingle();
  const minRounds = (season as any)?.minimum_qualifying_rounds ?? 20;

  const { data: divisions } = await supabase
    .from('season_divisions').select('id, name, promotion_places, relegation_places')
    .eq('season_id', seasonId).order('display_order', { ascending: true });
  const divisionRows = (divisions ?? []) as { id: string; name: string; promotion_places: number; relegation_places: number }[];

  const champions: { divisionName: string; playerName: string }[] = [];
  const divisionResults: SeasonFinishedDivisionResult[] = [];
  let divisionsClosed = 0;

  for (const division of divisionRows) {
    const { data: entries } = await supabase
      .from('season_entries')
      .select('id, player_id, season_points, qualifying_rounds_count, players(display_name)')
      .eq('division_id', division.id);
    const entryRows = (entries ?? []) as any[];
    if (entryRows.length === 0) continue;

    const entryIds = entryRows.map(e => e.id);
    // counting_round_limit defaults to 20 per entry, so a division of only
    // ~50 players already hits PostgREST's 1000-row default cap. This read
    // decides promotion/relegation at Season Close, so a truncated one would
    // permanently write the wrong final standings.
    const countingRounds = await fetchAllRows<any>(
      (from, to) => supabase
        .from('season_rounds').select('season_entry_id, final_round_points')
        .in('season_entry_id', entryIds).eq('is_counting', true)
        .order('id').range(from, to)
    );
    const pointsByEntry: Record<string, number[]> = {};
    for (const r of countingRounds as any[]) (pointsByEntry[r.season_entry_id] ??= []).push(r.final_round_points);

    // spec §10.1/§22 — "Player has 19 rounds at close → DNQ": anyone still
    // short of the minimum at close is finalized as DNQ, never "provisional"
    // again (provisional only ever meant "still mid-season").
    const finalQualification: Record<string, 'qualified' | 'dnq'> = {};
    for (const e of entryRows) finalQualification[e.id] = e.qualifying_rounds_count >= minRounds ? 'qualified' : 'dnq';

    const ranked = rankDivisionEntries(
      entryRows.map(e => ({
        entryId: e.id, seasonPoints: e.season_points,
        qualificationStatus: finalQualification[e.id], countingRoundPoints: pointsByEntry[e.id] ?? [],
      })),
      division.promotion_places, division.relegation_places,
    );

    await Promise.all(ranked.map(r => supabase.from('season_entries').update({
      current_position: r.position,
      movement_status: r.movementStatus,
      qualification_status: finalQualification[r.entryId],
    } as any).eq('id', r.entryId)));

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
    for (const r of ranked) {
      const playerId = entryRows.find(e => e.id === r.entryId)?.player_id;
      if (!playerId) continue;
      const body = r.movementStatus === 'champion' ? `You're the ${division.name} Champion! 🏆`
        : r.movementStatus === 'promotion' ? `Promoted from ${division.name}!`
        : r.movementStatus === 'relegation' ? `Relegated from ${division.name}.`
        : `${division.name} finished — you're safe.`;
      sendPushNotification('Titan Season — Final', body, [playerId]); // fire-and-forget
    }
  }

  await supabase.from('seasons').update({ status: 'locked', locked_at: new Date().toISOString() } as any).eq('id', seasonId);

  if (divisionsClosed > 0 && (season as any)?.name) {
    publishSeasonFinishedStory(seasonId, (season as any).name, divisionResults); // fire-and-forget
  }

  return { divisionsClosed, champions };
}
