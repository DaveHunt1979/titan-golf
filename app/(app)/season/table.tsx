import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { goBack } from '../../../src/lib/navigation';
import { rankDivisionEntries, type RankedSeasonEntry } from '../../../src/lib/seasonLeaderboard';

const GREEN = '#4ade80';
const GOLD  = '#D4AF37';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';

const STATUS_COLOR: Record<string, string> = { champion: GOLD, promotion: GREEN, safe: '#888', relegation: RED };
const STATUS_LABEL: Record<string, string> = { champion: 'CHAMPION', promotion: 'PROMOTION', safe: 'SAFE', relegation: 'RELEGATION' };

interface Row extends RankedSeasonEntry {
  displayName: string;
  playedCount: number;
  isMe: boolean;
}

type ScreenState = 'loading' | 'no_entry' | 'no_division' | 'ready';

export default function SeasonTableScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const [state, setState]       = useState<ScreenState>('loading');
  const [divisionName, setDivisionName] = useState('');
  const [rows, setRows]         = useState<Row[]>([]);
  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    setState('loading');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setState('no_entry'); return; }
    const { data: me } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
    if (!me) { setState('no_entry'); return; }

    const { data: myEntry } = await supabase
      .from('season_entries')
      .select('id, division_id')
      .eq('player_id', (me as any).id)
      .order('created_at', { ascending: false })
      .maybeSingle();
    if (!myEntry) { setState('no_entry'); return; }
    if (!(myEntry as any).division_id) { setState('no_division'); return; }
    const divisionId = (myEntry as any).division_id as string;

    const [{ data: division }, { data: entries }] = await Promise.all([
      supabase.from('season_divisions').select('name, promotion_places, relegation_places').eq('id', divisionId).maybeSingle(),
      supabase.from('season_entries')
        .select('id, player_id, season_points, qualification_status, qualifying_rounds_count, players(display_name)')
        .eq('division_id', divisionId),
    ]);

    const entryRows = (entries ?? []) as any[];
    const entryIds = entryRows.map(r => r.id);
    const { data: countingRounds } = entryIds.length
      ? await supabase.from('season_rounds').select('season_entry_id, final_round_points').in('season_entry_id', entryIds).eq('is_counting', true)
      : { data: [] as any[] };
    const pointsByEntry: Record<string, number[]> = {};
    for (const r of (countingRounds ?? []) as any[]) (pointsByEntry[r.season_entry_id] ??= []).push(r.final_round_points);

    const ranked = rankDivisionEntries(
      entryRows.map(r => ({
        entryId: r.id, seasonPoints: r.season_points, qualificationStatus: r.qualification_status,
        countingRoundPoints: pointsByEntry[r.id] ?? [],
      })),
      (division as any)?.promotion_places ?? 0,
      (division as any)?.relegation_places ?? 0,
    );

    const byId = new Map(entryRows.map(r => [r.id, r]));
    setRows(ranked.map(r => {
      const src = byId.get(r.entryId);
      return { ...r, displayName: src?.players?.display_name ?? 'Unknown', playedCount: src?.qualifying_rounds_count ?? 0, isMe: r.entryId === (myEntry as any).id };
    }));
    setDivisionName((division as any)?.name ?? '');
    setState('ready');
  }

  if (!fontsLoaded) return <View style={[s.container, { backgroundColor: dc.bg }]} />;

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/season')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={22} color={GREEN} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{divisionName ? divisionName.toUpperCase() : 'TABLE'}</Text>
        <View style={{ width: 22 }} />
      </View>

      {state === 'loading' && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={GREEN} /></View>
      )}
      {state === 'no_entry' && (
        <View style={s.centeredMsg}>
          <Ionicons name="trophy-outline" size={40} color="#333" />
          <Text style={s.msgTitle}>Not in a Season yet</Text>
          <Text style={s.msgSub}>Join with a PIN from the Season tab first.</Text>
        </View>
      )}
      {state === 'no_division' && (
        <View style={s.centeredMsg}>
          <Ionicons name="layers-outline" size={40} color="#333" />
          <Text style={s.msgTitle}>Divisions Not Published Yet</Text>
          <Text style={s.msgSub}>Your society admin hasn't published divisions for this Season.</Text>
        </View>
      )}
      {state === 'ready' && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
          <View style={s.tableHead}>
            <Text style={[s.th, { width: 28 }]}>#</Text>
            <Text style={[s.th, { flex: 1 }]}>PLAYER</Text>
            <Text style={[s.th, { width: 44, textAlign: 'center' }]}>PLD</Text>
            <Text style={[s.th, { width: 56, textAlign: 'right' }]}>PTS</Text>
          </View>
          {rows.map(r => (
            <View key={r.entryId} style={[s.row, r.isMe && s.rowMe]}>
              <View style={[s.zoneBar, { backgroundColor: STATUS_COLOR[r.movementStatus] }]} />
              <Text style={[s.pos, { width: 28 }]}>{r.position}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.name} numberOfLines={1}>{r.displayName}{r.isMe ? ' (you)' : ''}</Text>
                {r.qualificationStatus !== 'qualified' && <Text style={s.provisional}>PROVISIONAL</Text>}
              </View>
              <Text style={[s.cell, { width: 44, textAlign: 'center' }]}>{r.playedCount}</Text>
              <Text style={[s.pts, { width: 56, textAlign: 'right' }]}>{r.seasonPoints}</Text>
            </View>
          ))}
          <View style={s.legend}>
            {(['champion', 'promotion', 'relegation'] as const).map(k => (
              <View key={k} style={s.legendItem}>
                <View style={[s.legendDot, { backgroundColor: STATUS_COLOR[k] }]} />
                <Text style={s.legendText}>{STATUS_LABEL[k]}</Text>
              </View>
            ))}
          </View>
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

  tableHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, marginBottom: 8, gap: 8 },
  th: { fontFamily: FFB, fontSize: 9, color: '#666', letterSpacing: 1 },

  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6, gap: 8, overflow: 'hidden',
  },
  rowMe: { borderWidth: 1, borderColor: `${GREEN}50` },
  zoneBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  pos: { fontFamily: FFB, fontSize: 13, color: '#888' },
  name: { fontFamily: FFB, fontSize: 13, color: '#fff' },
  provisional: { fontFamily: FFB, fontSize: 8, color: '#666', letterSpacing: 0.5, marginTop: 2 },
  cell: { fontFamily: FFB, fontSize: 12, color: '#888' },
  pts: { fontFamily: FFB, fontSize: 14, color: GREEN },

  legend: { flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontFamily: FFB, fontSize: 9, color: '#666', letterSpacing: 0.5 },
});
