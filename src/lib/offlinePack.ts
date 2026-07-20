import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const PREFIX = 'titan:pack:v1:';
const TTL = 14 * 60 * 60 * 1000; // 14 hours — covers a full day's golf

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
    const compPlayers: MatchPack['compPlayers'] = [];
    const fallback: { player_id: string; handicap_index: number }[] = [];

    for (const p of (playersRes.data ?? []) as any[]) {
      players[p.id] = { display_name: p.display_name, handicap_index: p.handicap_index ?? 0, avatar_url: p.avatar_url ?? null };
      fallback.push({ player_id: p.id, handicap_index: p.handicap_index ?? 0 });
    }

    const comp = compRes.data as any[] | null;
    const resolvedCompPlayers = comp && comp.length > 0 ? comp : fallback;

    const pack: MatchPack = {
      matchId,
      downloadedAt: Date.now(),
      match: matchData,
      courseHoles: (holesRes.data ?? []) as any[],
      players,
      compPlayers: resolvedCompPlayers,
    };

    await AsyncStorage.setItem(`${PREFIX}${matchId}`, JSON.stringify(pack));
  } catch (e) {
    console.warn('offlinePack.download failed:', e);
  }
}

export async function getMatchPack(matchId: string): Promise<MatchPack | null> {
  try {
    const raw = await AsyncStorage.getItem(`${PREFIX}${matchId}`);
    if (!raw) return null;
    const pack: MatchPack = JSON.parse(raw);
    if (Date.now() - pack.downloadedAt > TTL) return null;
    return pack;
  } catch {
    return null;
  }
}

export async function refreshMatchPack(matchId: string): Promise<void> {
  await downloadMatchPack(matchId);
}

export async function clearMatchPack(matchId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(`${PREFIX}${matchId}`);
  } catch {
    // ignore
  }
}
