import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../src/lib/SocietyThemeContext';

const GOLD = '#D4AF37';
const FFB  = 'JUSTSans-ExBold';

type Member = {
  playerId: string;
  name: string;
  courseName: string | null;
  hole: number | null;
  pts: number | null;
  matchId: string | null;
};

function InitialAvatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${GOLD}15`, borderWidth: 1.5, borderColor: `${GOLD}30`, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: FFB, fontSize: size * 0.38, color: GOLD }}>{(name || '?')[0].toUpperCase()}</Text>
    </View>
  );
}

export default function FriendsScreen() {
  const router  = useRouter();
  const dc      = useDynamicColors();
  const { societyId } = useSocietyTheme();

  const [fontsLoaded] = useFonts({
    'JUSTSans-ExBold': require('../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [members,    setMembers]    = useState<Member[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myId,       setMyId]       = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!societyId) { setLoading(false); setRefreshing(false); return; }

    const { data: { user } } = await supabase.auth.getUser();
    let pid: string | null = null;
    if (user) {
      const { data: p } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (p) { pid = (p as any).id; setMyId(pid); }
    }

    // All society members
    const { data: memberRows } = await supabase
      .from('society_members').select('player_id')
      .eq('society_id', societyId);

    const allMemberIds: string[] = (memberRows ?? []).map((m: any) => m.player_id);
    if (!allMemberIds.length) { setLoading(false); setRefreshing(false); return; }

    const { data: playersData } = await supabase
      .from('players').select('id,display_name')
      .in('id', allMemberIds);

    const nameMap: Record<string, string> = {};
    for (const p of (playersData ?? []) as any[]) nameMap[p.id] = p.display_name ?? 'Unknown';

    // Active matches for any member
    const { data: activeMatches } = await supabase
      .from('matches').select('id,course_name,home_player_ids,away_player_ids')
      .eq('status', 'in_progress').limit(100);

    const memberSet = new Set(allMemberIds);
    const relevantMatches = (activeMatches ?? []).filter((m: any) => {
      const ids: string[] = [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])];
      return ids.some(id => memberSet.has(id));
    });

    const matchIds = relevantMatches.map((m: any) => m.id);
    const { data: holesData } = matchIds.length
      ? await supabase.from('match_holes').select('player_id,stableford_pts,hole_number,match_id').in('match_id', matchIds)
      : { data: [] };

    // Build per-player stats
    const stats: Record<string, { pts: number; maxHole: number; matchId: string; courseName: string }> = {};
    for (const m of relevantMatches) {
      const ids: string[] = [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])];
      for (const id of ids) {
        if (memberSet.has(id) && !stats[id]) {
          stats[id] = { pts: 0, maxHole: 0, matchId: m.id, courseName: m.course_name ?? 'Course' };
        }
      }
    }
    for (const h of (holesData ?? []) as any[]) {
      if (stats[h.player_id]) {
        stats[h.player_id].pts += h.stableford_pts ?? 0;
        if (h.hole_number > stats[h.player_id].maxHole) stats[h.player_id].maxHole = h.hole_number;
      }
    }

    const result: Member[] = allMemberIds
      .filter(id => id !== pid)
      .map(id => {
        const s = stats[id];
        return {
          playerId: id,
          name: nameMap[id] ?? 'Unknown',
          courseName: s?.courseName ?? null,
          hole: s ? Math.min(s.maxHole + 1, 18) : null,
          pts: s ? s.pts : null,
          matchId: s?.matchId ?? null,
        };
      })
      // playing members first, then alphabetical
      .sort((a, b) => {
        if (a.matchId && !b.matchId) return -1;
        if (!a.matchId && b.matchId) return 1;
        return a.name.localeCompare(b.name);
      });

    setMembers(result);
    setLoading(false);
    setRefreshing(false);
  }, [societyId]);

  useEffect(() => { load(); }, [load]);

  if (!fontsLoaded || loading) {
    return (
      <View style={[s.root, { backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={GOLD} size="large" />
      </View>
    );
  }

  const playing = members.filter(m => m.matchId);
  const offline = members.filter(m => !m.matchId);

  return (
    <View style={[s.root, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.title}>MEMBERS</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 8 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={GOLD} />}
      >
        {playing.length > 0 && (
          <Text style={s.sectionLabel}>ON A ROUND · {playing.length}</Text>
        )}
        {playing.map(m => <MemberRow key={m.playerId} member={m} dc={dc} onPress={() => router.push(`/(app)/score/${m.matchId}` as any)} />)}

        {offline.length > 0 && (
          <Text style={[s.sectionLabel, { marginTop: playing.length > 0 ? 8 : 0 }]}>NOT PLAYING · {offline.length}</Text>
        )}
        {offline.map(m => <MemberRow key={m.playerId} member={m} dc={dc} />)}

        {members.length === 0 && (
          <Text style={s.empty}>No members found</Text>
        )}
      </ScrollView>
    </View>
  );
}

function MemberRow({ member, dc, onPress }: { member: Member; dc: any; onPress?: () => void }) {
  const isPlaying = !!member.matchId;
  const Wrap = onPress ? TouchableOpacity : View;
  return (
    <Wrap
      style={[s.row, { backgroundColor: dc.card, borderColor: isPlaying ? `${GOLD}40` : dc.border }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <InitialAvatar name={member.name} size={42} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[s.rowName, { color: dc.cardText }]}>{member.name}</Text>
        {isPlaying ? (
          <Text style={s.rowCourse} numberOfLines={1}>{member.courseName} · Hole {member.hole}</Text>
        ) : (
          <Text style={s.rowOffline}>Not on a round</Text>
        )}
      </View>
      {isPlaying && member.pts != null && (
        <View style={s.ptsBlock}>
          <Text style={s.ptsValue}>{member.pts}</Text>
          <Text style={s.ptsLabel}>pts</Text>
        </View>
      )}
      {isPlaying && <Ionicons name="chevron-forward" size={16} color={GOLD} style={{ marginLeft: 4 }} />}
    </Wrap>
  );
}

const s = StyleSheet.create({
  root:       { flex: 1 },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 56, paddingHorizontal: 16, paddingBottom: 16 },
  backBtn:    { width: 36, alignItems: 'center' },
  title:      { fontFamily: FFB, fontSize: 13, color: '#fff', letterSpacing: 2 },
  sectionLabel: { fontFamily: FFB, fontSize: 9, color: '#555', letterSpacing: 1.5, paddingTop: 4 },
  empty:      { fontFamily: FFB, fontSize: 14, color: '#444', textAlign: 'center', paddingVertical: 40 },

  row:        { flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, padding: 14 },
  rowName:    { fontFamily: FFB, fontSize: 14, color: '#fff' },
  rowCourse:  { fontFamily: FFB, fontSize: 11, color: GOLD, marginTop: 2 },
  rowOffline: { fontFamily: FFB, fontSize: 11, color: '#444', marginTop: 2 },

  ptsBlock:   { alignItems: 'center', marginLeft: 8 },
  ptsValue:   { fontFamily: FFB, fontSize: 22, color: GOLD },
  ptsLabel:   { fontFamily: FFB, fontSize: 9, color: '#555', letterSpacing: 1 },
});
