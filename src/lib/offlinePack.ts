import { ensureDb } from './localDb';
import { supabase } from './supabase';

const TTL = 14 * 60 * 60 * 1000; // 14 hours

export interface MatchPack {
  matchId: string;
  downloadedAt: number;
  match: any;
  courseHoles: any[];
  players: Record<string, { display_name: string; handicap_index: number; avatar_url: string | null }>;
  compPlayers: { player_id: string; handicap_index: number }[];
}

export async function downloadMatchPack(matchId: string): Promise<void> {
  try {
    const { data: matchData } = await supabase
      .from('matches')
      .select('*, home_team:home_team_id(name,accent_color), away_team:away_team_id(name,accent_color), day:day_id(course_name,course_par,course_rating,slope_rating,day_number,competition:competition_id(format))')
      .eq('id', matchId)
      .single();

    if (!matchData) return;

    const allIds = [...(matchData.home_player_ids ?? []), ...(matchData.away_player_ids ?? [])];
    const courseName = (matchData as any).day?.course_name;

    const [holesRes, compRes, playersRes] = await Promise.all([
      courseName
        ? supabase.from('course_holes').select('hole_number,par,stroke_index,yardage,tee_yardages').eq('course_name', courseName).order('hole_number')
        : Promise.resolve({ data: [] }),
      matchData.competition_id && allIds.length
        ? supabase.from('competition_players').select('player_id,handicap_index').eq('competition_id', matchData.competition_id).in('player_id', allIds)
        : Promise.resolve({ data: [] }),
      allIds.length
        ? supabase.from('players').select('id,display_name,handicap_index,avatar_url').in('id', allIds)
        : Promise.resolve({ data: [] }),
    ]);

    const players: MatchPack['players'] = {};
    const fallback: { player_id: string; handicap_index: number }[] = [];

    for (const p of (playersRes.data ?? []) as any[]) {
      players[p.id] = { display_name: p.display_name, handicap_index: p.handicap_index ?? 0, avatar_url: p.avatar_url ?? null };
      fallback.push({ player_id: p.id, handicap_index: p.handicap_index ?? 0 });
    }

    const comp = compRes.data as any[] | null;
    const compPlayers = comp && comp.length > 0 ? comp : fallback;

    const db = await ensureDb();
    await db.runAsync(
      `INSERT OR REPLACE INTO match_pack
         (match_id, downloaded_at, match_json, holes_json, players_json, comp_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        matchId,
        Date.now(),
        JSON.stringify(matchData),
        JSON.stringify(holesRes.data ?? []),
        JSON.stringify(players),
        JSON.stringify(compPlayers),
      ]
    );
  } catch (e) {
    console.warn('offlinePack.download failed:', e);
  }
}

export async function getMatchPack(matchId: string): Promise<MatchPack | null> {
  try {
    const db = await ensureDb();
    const row = await db.getFirstAsync<{
      downloaded_at: number;
      match_json: string;
      holes_json: string;
      players_json: string;
      comp_json: string;
    }>('SELECT * FROM match_pack WHERE match_id = ?', [matchId]);

    if (!row) return null;
    if (Date.now() - row.downloaded_at > TTL) return null;

    return {
      matchId,
      downloadedAt: row.downloaded_at,
      match: JSON.parse(row.match_json),
      courseHoles: JSON.parse(row.holes_json),
      players: JSON.parse(row.players_json),
      compPlayers: JSON.parse(row.comp_json),
    };
  } catch {
    return null;
  }
}

export async function refreshMatchPack(matchId: string): Promise<void> {
  await downloadMatchPack(matchId);
}

export async function clearMatchPack(matchId: string): Promise<void> {
  try {
    const db = await ensureDb();
    await db.runAsync('DELETE FROM match_pack WHERE match_id = ?', [matchId]);
  } catch {
    // ignore
  }
}
