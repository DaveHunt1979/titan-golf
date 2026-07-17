import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Share,
  StyleSheet, RefreshControl, ActivityIndicator, Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../../src/lib/supabase';
import { calcHoles } from '../../../../src/lib/scoring';

const GOLD = '#D4AF37';
const FF   = 'JUSTSans';
const FFB  = 'JUSTSans-ExBold';
const titanLogo = require('../../../../assets/TitanAppLogo.png');

type DayInfo   = { id: string; join_code: string; course_name: string; course_par: number; day_date: string };
type PlayerRow = { player_id: string; name: string; match_id: string; pts: number; holes: number; hcp: number };
type GroupRow  = { match_id: string; format: string; player_names: string[]; status: string; holes_string: string; winner: string | null; result_str: string | null; home_player_ids: string[]; away_player_ids: string[]; home_pts: number; away_pts: number; };

function InitialAvatar({ name, size = 38 }: { name: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${GOLD}15`, borderWidth: 1.5, borderColor: `${GOLD}30`, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: FFB, fontSize: size * 0.38, color: GOLD }}>{(name || '?')[0].toUpperCase()}</Text>
    </View>
  );
}

export default function DayLobby() {
  const { dayId }  = useLocalSearchParams<{ dayId: string }>();
  const router     = useRouter();

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [day,        setDay]        = useState<DayInfo | null>(null);
  const [players,    setPlayers]    = useState<PlayerRow[]>([]);
  const [groups,     setGroups]     = useState<GroupRow[]>([]);
  const [myId,       setMyId]       = useState<string | null>(null);
  const [myMatchId,  setMyMatchId]  = useState<string | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab,        setTab]        = useState<'leaderboard' | 'scores'>('scores');

  useEffect(() => { init(); }, [dayId]);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: p } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (p) setMyId(p.id);
    }
    await load();
  }

  const load = useCallback(async () => {
    const { data: dayData } = await supabase
      .from('competition_days').select('id,join_code,course_name,course_par,day_date').eq('id', dayId).single();
    if (!dayData) { setLoading(false); setRefreshing(false); return; }
    setDay(dayData as DayInfo);

    const { data: matches } = await supabase
      .from('matches')
      .select('id,home_player_ids,away_player_ids,round_format,hcp_allowance,status,holes_string,winner,result_str')
      .eq('day_id', dayId)
      .neq('status', 'cancelled');

    if (!matches) { setLoading(false); setRefreshing(false); return; }

    const allPlayerIds = [...new Set((matches as any[]).flatMap(m => [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])]))];

    const [{ data: playersData }, { data: holesData }] = await Promise.all([
      allPlayerIds.length
        ? supabase.from('players').select('id,display_name,handicap_index').in('id', allPlayerIds)
        : Promise.resolve({ data: [] }),
      supabase.from('match_holes')
        .select('match_id,player_id,stableford_pts,hole_number')
        .in('match_id', (matches as any[]).map(m => m.id)),
    ]);

    const playerMap: Record<string, { name: string; hcp: number }> = {};
    for (const p of (playersData ?? []) as any[]) {
      playerMap[p.id] = { name: p.display_name, hcp: p.handicap_index ?? 0 };
    }

    const holesByPlayer: Record<string, { pts: number; count: number }> = {};
    for (const h of (holesData ?? []) as any[]) {
      if (!holesByPlayer[h.player_id]) holesByPlayer[h.player_id] = { pts: 0, count: 0 };
      holesByPlayer[h.player_id].pts   += h.stableford_pts ?? 0;
      holesByPlayer[h.player_id].count += 1;
    }

    const playerMatchMap: Record<string, string> = {};
    for (const m of (matches as any[])) {
      for (const id of [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])]) {
        playerMatchMap[id] = m.id;
      }
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: myPlayer } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (myPlayer) setMyMatchId(playerMatchMap[myPlayer.id] ?? null);
    }

    const rows: PlayerRow[] = allPlayerIds.map(id => ({
      player_id: id,
      name:      playerMap[id]?.name ?? 'Unknown',
      match_id:  playerMatchMap[id] ?? '',
      hcp:       playerMap[id]?.hcp ?? 0,
      pts:       holesByPlayer[id]?.pts ?? 0,
      holes:     holesByPlayer[id]?.count ?? 0,
    })).sort((a, b) => b.pts - a.pts || b.holes - a.holes);

    const grps: GroupRow[] = (matches as any[]).map(m => {
      const homeIds: string[] = m.home_player_ids ?? [];
      const awayIds: string[] = m.away_player_ids ?? [];
      const homePts = homeIds.reduce((s, id) => s + (holesByPlayer[id]?.pts ?? 0), 0);
      const awayPts = awayIds.reduce((s, id) => s + (holesByPlayer[id]?.pts ?? 0), 0);
      return {
        match_id:       m.id,
        format:         m.round_format ?? 'stableford',
        player_names:   [...homeIds, ...awayIds].map(id => playerMap[id]?.name?.split(' ')[0] ?? '?'),
        status:         m.status ?? 'upcoming',
        holes_string:   m.holes_string ?? '..................',
        winner:         m.winner ?? null,
        result_str:     m.result_str ?? null,
        home_player_ids: homeIds,
        away_player_ids: awayIds,
        home_pts: homePts,
        away_pts: awayPts,
      };
    });

    setPlayers(rows);
    setGroups(grps);
    setLoading(false);
    setRefreshing(false);
  }, [dayId]);

  function shareCode() {
    if (!day) return;
    Share.share({ message: `Join our game at ${day.course_name}!\nEnter code ${day.join_code} in Titan Golf → Score tab → Join Game Day` });
  }

  if (loading || !fontsLoaded || !day) {
    return <View style={s.loading}><ActivityIndicator color={GOLD} size="large" /></View>;
  }

  const dateStr = new Date(day.day_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerSide} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerSub}>GAME DAY</Text>
        </View>
        <TouchableOpacity style={s.codeBtn} onPress={shareCode} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="share-outline" size={13} color={GOLD} />
          <Text style={s.codeBtnText}>{day.join_code}</Text>
        </TouchableOpacity>
      </View>

      {/* Course info card */}
      <View style={s.courseCard}>
        <View style={{ flex: 1 }}>
          <Text style={s.courseName}>{day.course_name}</Text>
          <Text style={s.courseDate}>{dateStr}</Text>
        </View>
        <View style={s.parChip}>
          <Text style={s.parChipText}>Par {day.course_par}</Text>
        </View>
      </View>

      {/* Tab bar */}
      <View style={s.tabBar}>
        {(['scores', 'leaderboard'] as const).map(t => (
          <TouchableOpacity
            key={t}
            style={[s.tabItem, tab === t && s.tabItemActive]}
            onPress={() => setTab(t)}
            activeOpacity={0.7}
          >
            <Text style={[s.tabLabel, tab === t && s.tabLabelActive]}>
              {t === 'scores' ? `MATCHES · ${groups.length}` : `STABLEFORD · ${players.length}`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 110, gap: 8 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={GOLD} />}
        key={tab}
      >
        {tab === 'leaderboard' && (
          players.length === 0
            ? <Text style={s.empty}>No scores yet — get playing!</Text>
            : players.map((p, rank) => {
                const isMe      = p.player_id === myId;
                const isFirst   = rank === 0;
                const rankColor = rank === 0 ? GOLD : rank === 1 ? '#C0C0C0' : rank === 2 ? '#CD7F32' : '#444';
                return (
                  <View key={p.player_id} style={[s.lbCard, isFirst && s.lbCardFirst, isMe && s.lbCardMe]}>
                    <Text style={[s.lbRank, { color: rankColor }]}>{rank + 1}</Text>
                    <InitialAvatar name={p.name} size={38} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={[s.lbName, isFirst && { color: GOLD }]}>{p.name.split(' ')[0]}</Text>
                        {isMe && <View style={s.youBadge}><Text style={s.youBadgeText}>YOU</Text></View>}
                      </View>
                      <Text style={s.lbSub}>{p.holes} holes · hcp {p.hcp.toFixed(0)}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[s.lbPts, isFirst && { color: GOLD }]}>{p.pts}</Text>
                      <Text style={s.lbPtsLabel}>pts</Text>
                    </View>
                  </View>
                );
              })
        )}

        {tab === 'scores' && (
          groups.length === 0
            ? <Text style={s.empty}>No groups yet.</Text>
            : groups.map((g, i) => {
                const isMatchplay = g.format === 'nassau' || g.format === 'matchplay';
                const hasTeams    = g.away_player_ids.length > 0;
                const homeNames   = g.player_names.slice(0, g.home_player_ids.length);
                const awayNames   = g.player_names.slice(g.home_player_ids.length);

                let statusLabel = '';
                let statusColor = GOLD;
                if (isMatchplay && hasTeams) {
                  if (g.status === 'complete' && g.result_str) {
                    statusLabel = g.result_str;
                    statusColor = '#4ade80';
                  } else {
                    const { homeUp } = calcHoles(g.holes_string);
                    if (homeUp === 0) { statusLabel = 'A/S'; statusColor = '#888'; }
                    else if (homeUp > 0) statusLabel = `${homeUp} UP`;
                    else { statusLabel = `${Math.abs(homeUp)} DN`; statusColor = '#f87171'; }
                  }
                }

                return (
                  <TouchableOpacity
                    key={g.match_id}
                    style={[s.groupCard, g.match_id === myMatchId && s.groupCardMe]}
                    onPress={() => router.push(`/(app)/score/${g.match_id}` as any)}
                    activeOpacity={0.8}
                  >
                    {g.match_id === myMatchId && <View style={s.groupAccent} />}
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <Text style={s.groupNum}>GROUP {i + 1}</Text>
                        <View style={s.formatChip}>
                          <Text style={s.formatChipText}>{g.format.replace(/_/g, ' ').toUpperCase()}</Text>
                        </View>
                        {g.match_id === myMatchId && (
                          <View style={s.yourGroupBadge}><Text style={s.yourGroupText}>YOUR GROUP</Text></View>
                        )}
                      </View>

                      {hasTeams ? (
                        <View style={s.matchRow}>
                          <Text style={[s.groupPlayers, { flex: 1 }]}>{homeNames.join(' & ')}</Text>
                          {isMatchplay ? (
                            <View style={[s.statusChip, { borderColor: `${statusColor}50`, backgroundColor: `${statusColor}15` }]}>
                              <Text style={[s.statusChipText, { color: statusColor }]}>{statusLabel}</Text>
                            </View>
                          ) : (
                            <View style={s.ptsScoreChip}>
                              <Text style={s.ptsScoreText}>{g.home_pts} - {g.away_pts}</Text>
                            </View>
                          )}
                          <Text style={[s.groupPlayers, { flex: 1, textAlign: 'right' }]}>{awayNames.join(' & ')}</Text>
                        </View>
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={s.groupPlayers}>{g.player_names.join(' · ')}</Text>
                          {g.home_pts > 0 && <Text style={s.groupSoloPts}>{g.home_pts} pts</Text>}
                        </View>
                      )}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={g.match_id === myMatchId ? GOLD : '#444'} style={{ marginLeft: 8 }} />
                  </TouchableOpacity>
                );
              })
        )}
      </ScrollView>

      {/* Footer action */}
      <View style={s.footer}>
        {myMatchId ? (
          <TouchableOpacity
            style={s.actionBtn}
            onPress={() => router.push(`/(app)/score/${myMatchId}` as any)}
            activeOpacity={0.85}
          >
            <Text style={s.actionBtnText}>Score My Group</Text>
            <Ionicons name="chevron-forward" size={20} color="#000" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={s.actionBtn}
            onPress={() => router.push(`/(app)/games/new?existingDayId=${dayId}&course=${encodeURIComponent(day.course_name)}` as any)}
            activeOpacity={0.85}
          >
            <Ionicons name="add-circle-outline" size={20} color="#000" />
            <Text style={s.actionBtnText}>Add My Group</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#000' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },

  header:       { flexDirection: 'row', alignItems: 'center', paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12 },
  headerSide:   { width: 40, alignItems: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', gap: 2 },
  headerLogo:   { width: 28, height: 28 },
  headerSub:    { fontFamily: FFB, fontSize: 9, color: GOLD, letterSpacing: 2.5 },
  codeBtn:      { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: `${GOLD}15`, borderWidth: 1, borderColor: `${GOLD}30`, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  codeBtnText:  { fontFamily: FFB, fontSize: 11, color: GOLD, letterSpacing: 1.5 },

  courseCard:  { marginHorizontal: 16, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 14 },
  courseName:  { fontFamily: FFB, fontSize: 16, color: '#fff' },
  courseDate:  { fontFamily: FFB, fontSize: 12, color: '#fff', marginTop: 2 },
  parChip:     { backgroundColor: `${GOLD}15`, borderWidth: 1, borderColor: `${GOLD}30`, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  parChipText: { fontFamily: FFB, fontSize: 12, color: GOLD, letterSpacing: 1 },

  tabBar:         { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1c1c1c', marginHorizontal: 16, marginBottom: 4 },
  tabItem:        { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabItemActive:  { borderBottomColor: GOLD },
  tabLabel:       { fontFamily: FFB, fontSize: 10, color: '#444', letterSpacing: 1.5 },
  tabLabelActive: { color: GOLD },

  empty: { fontFamily: FFB, fontSize: 14, color: '#444', textAlign: 'center', paddingVertical: 40 },

  lbCard:      { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 14, flexDirection: 'row', alignItems: 'center' },
  lbCardFirst: { borderColor: `${GOLD}30`, backgroundColor: `${GOLD}08` },
  lbCardMe:    { borderColor: `${GOLD}50` },
  lbRank:      { fontFamily: FFB, fontSize: 20, width: 32, textAlign: 'center', marginRight: 4 },
  lbName:      { fontFamily: FFB, fontSize: 15, color: '#fff' },
  lbSub:       { fontFamily: FFB, fontSize: 11, color: '#fff', marginTop: 2 },
  lbPts:       { fontFamily: FFB, fontSize: 26, color: '#fff' },
  lbPtsLabel:  { fontFamily: FFB, fontSize: 10, color: '#444', textAlign: 'right', letterSpacing: 1 },
  youBadge:    { backgroundColor: `${GOLD}20`, borderWidth: 1, borderColor: `${GOLD}40`, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  youBadgeText:{ fontFamily: FFB, fontSize: 9, color: GOLD, letterSpacing: 1 },

  groupCard:     { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 14, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  groupCardMe:   { borderColor: `${GOLD}40` },
  groupAccent:   { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: GOLD, borderTopLeftRadius: 14, borderBottomLeftRadius: 14 },
  groupNum:      { fontFamily: FFB, fontSize: 11, color: '#fff', letterSpacing: 1.5 },
  groupPlayers:  { fontFamily: FFB, fontSize: 14, color: '#ccc' },
  formatChip:    { backgroundColor: '#1c1c1c', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  formatChipText:{ fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 1 },
  yourGroupBadge:{ backgroundColor: `${GOLD}15`, borderWidth: 1, borderColor: `${GOLD}30`, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  yourGroupText: { fontFamily: FFB, fontSize: 9, color: GOLD, letterSpacing: 1 },

  matchRow:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusChip:    { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, alignItems: 'center', minWidth: 46 },
  statusChipText:{ fontFamily: FFB, fontSize: 10, letterSpacing: 1 },
  ptsScoreChip:  { backgroundColor: '#1c1c1c', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  ptsScoreText:  { fontFamily: FFB, fontSize: 12, color: GOLD, letterSpacing: 1 },
  groupSoloPts:  { fontFamily: FFB, fontSize: 12, color: GOLD },

  footer:        { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, paddingBottom: 36, backgroundColor: '#000', borderTopWidth: 1, borderTopColor: '#111' },
  actionBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16 },
  actionBtnText: { fontFamily: FFB, fontSize: 16, color: '#000' },
});
