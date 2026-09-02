import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { goBack } from '../../../src/lib/navigation';

const GREEN = '#4ade80';
const GOLD  = '#D4AF37';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';

type MajorStatus = 'upcoming' | 'live' | 'finished';

interface LeaderRow { entryId: string; displayName: string; points: number; }
interface MajorRow {
  id: string; sequence: number; name: string; startAt: string; endAt: string; multiplier: number;
  status: MajorStatus; leaders: LeaderRow[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function SeasonMajorsScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const [loading, setLoading] = useState(true);
  const [hasEntry, setHasEntry] = useState(true);
  const [majors, setMajors]   = useState<MajorRow[]>([]);
  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setHasEntry(false); setLoading(false); return; }
    const { data: me } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
    if (!me) { setHasEntry(false); setLoading(false); return; }

    const { data: myEntry } = await supabase
      .from('season_entries').select('id, season_id').eq('player_id', (me as any).id)
      .order('created_at', { ascending: false }).maybeSingle();
    if (!myEntry) { setHasEntry(false); setLoading(false); return; }
    setHasEntry(true);

    const { data: majorRows } = await supabase
      .from('season_majors').select('id, sequence, name, start_at, end_at, multiplier')
      .eq('season_id', (myEntry as any).season_id).order('sequence', { ascending: true });
    const rows = (majorRows ?? []) as any[];
    if (rows.length === 0) { setMajors([]); setLoading(false); return; }

    const majorIds = rows.map(r => r.id);
    const { data: winnerRounds } = await supabase
      .from('season_rounds')
      .select('major_id, final_round_points, season_entries(id, players(display_name))')
      .in('major_id', majorIds).not('major_multiplier', 'is', null);

    const leadersByMajor: Record<string, LeaderRow[]> = {};
    for (const r of (winnerRounds ?? []) as any[]) {
      const entry = r.season_entries;
      if (!entry) continue;
      (leadersByMajor[r.major_id] ??= []).push({
        entryId: entry.id, displayName: entry.players?.display_name ?? 'Unknown', points: r.final_round_points,
      });
    }
    for (const majorId of Object.keys(leadersByMajor)) {
      leadersByMajor[majorId].sort((a, b) => b.points - a.points);
    }

    const now = new Date();
    setMajors(rows.map(r => {
      const start = new Date(r.start_at);
      const end = new Date(r.end_at);
      const status: MajorStatus = now < start ? 'upcoming' : now > end ? 'finished' : 'live';
      return {
        id: r.id, sequence: r.sequence, name: r.name, startAt: r.start_at, endAt: r.end_at, multiplier: Number(r.multiplier),
        status, leaders: (leadersByMajor[r.id] ?? []).slice(0, 5),
      };
    }));
    setLoading(false);
  }

  if (!fontsLoaded) return <View style={[s.container, { backgroundColor: dc.bg }]} />;

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/season')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={22} color={GREEN} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>MAJORS</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={GREEN} /></View>
      ) : !hasEntry ? (
        <View style={s.centeredMsg}>
          <Ionicons name="ribbon-outline" size={40} color="#333" />
          <Text style={s.msgTitle}>Not in a Season yet</Text>
          <Text style={s.msgSub}>Join with a PIN from the Season tab first.</Text>
        </View>
      ) : majors.length === 0 ? (
        <View style={s.centeredMsg}>
          <Ionicons name="ribbon-outline" size={40} color="#333" />
          <Text style={s.msgTitle}>No Majors configured</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
          {majors.map(m => (
            <View key={m.id} style={s.card}>
              <View style={s.cardTop}>
                <View>
                  <Text style={s.majorNum}>MAJOR {m.sequence}</Text>
                  <Text style={s.majorName}>{m.name}</Text>
                  <Text style={s.majorDates}>{formatDate(m.startAt)} – {formatDate(m.endAt)} · {m.multiplier}× multiplier</Text>
                </View>
                <View style={[s.statusPill, m.status === 'live' && s.statusPillLive]}>
                  <Text style={[s.statusPillText, m.status === 'live' && { color: '#000' }]}>{m.status.toUpperCase()}</Text>
                </View>
              </View>

              {m.leaders.length === 0 ? (
                <Text style={s.noLeaders}>No qualifying rounds played in this window yet</Text>
              ) : (
                <View style={s.leaderList}>
                  {m.leaders.map((l, i) => (
                    <View key={l.entryId} style={s.leaderRow}>
                      <Text style={[s.leaderPos, i === 0 && { color: GOLD }]}>{i + 1}</Text>
                      <Text style={s.leaderName} numberOfLines={1}>{l.displayName}</Text>
                      <Text style={[s.leaderPts, i === 0 && { color: GOLD }]}>{l.points}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingTop: 56 },

  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 },
  headerTitle: { fontFamily: FFB, fontSize: 13, color: '#fff', letterSpacing: 2 },

  centeredMsg: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 },
  msgTitle: { fontFamily: FFB, fontSize: 15, color: '#fff', marginTop: 8, textAlign: 'center' },
  msgSub:   { fontFamily: FF, fontSize: 12, color: '#666', textAlign: 'center' },

  scroll: { paddingHorizontal: 16, paddingBottom: 40 },

  card: { backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c', borderRadius: 16, padding: 16, marginBottom: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 },
  majorNum: { fontFamily: FFB, fontSize: 9, color: GREEN, letterSpacing: 1.5, marginBottom: 4 },
  majorName: { fontFamily: FFB, fontSize: 17, color: '#fff', marginBottom: 4 },
  majorDates: { fontFamily: FF, fontSize: 11, color: '#888' },

  statusPill: { backgroundColor: '#1c1c1c', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  statusPillLive: { backgroundColor: GREEN },
  statusPillText: { fontFamily: FFB, fontSize: 9, color: '#888', letterSpacing: 0.5 },

  noLeaders: { fontFamily: FF, fontSize: 12, color: '#555', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#1c1c1c' },

  leaderList: { paddingTop: 10, borderTopWidth: 1, borderTopColor: '#1c1c1c', gap: 8 },
  leaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  leaderPos: { fontFamily: FFB, fontSize: 12, color: '#666', width: 16 },
  leaderName: { fontFamily: FFB, fontSize: 13, color: '#fff', flex: 1 },
  leaderPts: { fontFamily: FFB, fontSize: 13, color: GREEN },
});
