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
