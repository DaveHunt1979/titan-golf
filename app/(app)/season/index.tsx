import { useCallback, useState } from 'react';
import { useFonts } from 'expo-font';
import { useRouter, useFocusEffect } from 'expo-router';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { goBack } from '../../../src/lib/navigation';
import { syncSeasonRoundsForEntry } from '../../../src/lib/seasonRoundIngestion';

const GREEN = '#4ade80';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';

// Still a landing page for anyone not entered in a Season — the full
// football-style table/position/history views (spec §16.1-16.2) are a
// later phase. What's real now: PIN join (season/join.tsx) and, once
// approved, an automatic sync of qualifying rounds into a live Season
// Points total (Dave, 2026-09-06 — "keep building it all").
const HIGHLIGHTS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  { icon: 'layers-outline',    title: 'Divisions',              body: 'A football-style league pyramid — Premier League down to League Two, seeded by handicap.' },
  { icon: 'stats-chart-outline', title: 'Best 20',               body: 'Play unlimited qualifying rounds. Only your best 20 verified Stableford scores count.' },
  { icon: 'trending-up-outline', title: 'Promotion & Relegation', body: 'Top 3 go up, bottom 3 go down at Season close — automatically, no manual sorting.' },
  { icon: 'ribbon-outline',    title: '4 Majors',                body: 'Titan Masters, Championship, Open and Season Championship — each with a 1.5× multiplier.' },
];

interface MyEntry {
  entryId: string; seasonName: string; qualifyingRoundsCount: number; countingRoundsCount: number;
  seasonPoints: number; qualificationStatus: string; minimumQualifyingRounds: number;
}

export default function SeasonIndex() {
  const router = useRouter();
  const dc = useDynamicColors();
  const [loading, setLoading] = useState(true);
  const [entry, setEntry]     = useState<MyEntry | null>(null);
  const [pendingSeasonName, setPendingSeasonName] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: me } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
    if (!me) { setLoading(false); return; }

    const { data: entryRow } = await supabase
      .from('season_entries')
      .select('id, qualifying_rounds_count, counting_rounds_count, season_points, qualification_status, seasons(id, name, society_id, start_at, end_at, handicap_allowance_percent, counting_round_limit, minimum_qualifying_rounds)')
      .eq('player_id', (me as any).id)
      .order('created_at', { ascending: false })
      .maybeSingle();

    if (entryRow) {
      const season = (entryRow as any).seasons;
      setEntry({
        entryId: (entryRow as any).id, seasonName: season.name,
        qualifyingRoundsCount: (entryRow as any).qualifying_rounds_count,
        countingRoundsCount: (entryRow as any).counting_rounds_count,
        seasonPoints: (entryRow as any).season_points,
        qualificationStatus: (entryRow as any).qualification_status,
        minimumQualifyingRounds: season.minimum_qualifying_rounds,
      });
      setPendingSeasonName(null);
      setLoading(false);

      if (season.start_at && season.end_at) {
        setSyncing(true);
        try {
          await syncSeasonRoundsForEntry((entryRow as any).id, (me as any).id, {
            id: season.id, societyId: season.society_id, startAt: season.start_at, endAt: season.end_at,
            handicapAllowancePercent: season.handicap_allowance_percent, countingRoundLimit: season.counting_round_limit,
            minimumQualifyingRounds: season.minimum_qualifying_rounds,
          });
          // Re-read the entry after sync so any newly-ingested rounds show immediately.
          const { data: refreshed } = await supabase
            .from('season_entries').select('qualifying_rounds_count, counting_rounds_count, season_points, qualification_status')
            .eq('id', (entryRow as any).id).maybeSingle();
          if (refreshed) {
            setEntry(prev => prev ? {
              ...prev,
              qualifyingRoundsCount: (refreshed as any).qualifying_rounds_count,
              countingRoundsCount: (refreshed as any).counting_rounds_count,
              seasonPoints: (refreshed as any).season_points,
              qualificationStatus: (refreshed as any).qualification_status,
            } : prev);
          }
        } finally {
          setSyncing(false);
        }
      }
      return;
    }

    const { data: pending } = await supabase
      .from('season_join_requests')
      .select('status, seasons(name)')
      .eq('player_id', (me as any).id).eq('status', 'pending_approval')
      .order('requested_at', { ascending: false })
      .maybeSingle();
    setPendingSeasonName(pending ? (pending as any).seasons?.name ?? null : null);
    setEntry(null);
    setLoading(false);
  }

  if (!fontsLoaded) return <View style={[s.container, { backgroundColor: dc.bg }]} />;

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/clubhouse')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={22} color={GREEN} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>SEASON</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={GREEN} /></View>
      ) : (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        {entry ? (
          <View style={s.hero}>
            <View style={s.heroIconWrap}><Ionicons name="trophy" size={32} color={GREEN} /></View>
            <Text style={s.heroTitle}>{entry.seasonName}</Text>
            <View style={s.statsRow}>
              <View style={s.statBlock}><Text style={s.statValue}>{entry.seasonPoints}</Text><Text style={s.statLabel}>SEASON PTS</Text></View>
              <View style={s.statBlock}><Text style={s.statValue}>{entry.countingRoundsCount}/{entry.minimumQualifyingRounds}</Text><Text style={s.statLabel}>COUNTING</Text></View>
              <View style={s.statBlock}><Text style={s.statValue}>{entry.qualifyingRoundsCount}</Text><Text style={s.statLabel}>PLAYED</Text></View>
            </View>
            <View style={s.comingSoonPill}>
              <Text style={s.comingSoonText}>{entry.qualificationStatus === 'qualified' ? 'QUALIFIED' : 'PROVISIONAL'}</Text>
            </View>
            {syncing && <Text style={s.syncingText}>Syncing your latest rounds…</Text>}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <TouchableOpacity style={s.tableBtn} onPress={() => router.push('/(app)/season/table' as any)} activeOpacity={0.85}>
                <Ionicons name="list-outline" size={15} color="#000" />
                <Text style={s.tableBtnText}>Table</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.tableBtn} onPress={() => router.push('/(app)/season/majors' as any)} activeOpacity={0.85}>
                <Ionicons name="ribbon-outline" size={15} color="#000" />
                <Text style={s.tableBtnText}>Majors</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : pendingSeasonName ? (
          <View style={s.hero}>
            <View style={s.heroIconWrap}><Ionicons name="time-outline" size={32} color={GREEN} /></View>
            <Text style={s.heroTitle}>Request Pending</Text>
            <Text style={s.heroSub}>Waiting for approval to join {pendingSeasonName}.</Text>
          </View>
        ) : (
          <View style={s.hero}>
            <View style={s.heroIconWrap}><Ionicons name="trophy" size={32} color={GREEN} /></View>
            <Text style={s.heroTitle}>Titan Season</Text>
            <Text style={s.heroSub}>
              A year-long league. Climb the divisions, chase promotion, survive relegation, and win the Majors.
            </Text>
            <TouchableOpacity style={s.joinBtn} onPress={() => router.push('/(app)/season/join' as any)} activeOpacity={0.85}>
              <Text style={s.joinBtnText}>Join with PIN</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={s.sectionLabel}>{entry ? 'HOW ROUNDS COUNT' : "WHAT'S COMING"}</Text>
        {entry ? (
          <View style={s.card}>
            <View style={s.cardIconWrap}><Ionicons name="shield-checkmark-outline" size={20} color={GREEN} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>Automatic — no separate entry</Text>
              <Text style={s.cardBody}>Any casual round, Titan Tour round, or Swindle round you finish with another real app player from your society counts automatically. Solo rounds never count.</Text>
            </View>
          </View>
        ) : (
          HIGHLIGHTS.map(h => (
            <View key={h.title} style={s.card}>
              <View style={s.cardIconWrap}>
                <Ionicons name={h.icon} size={20} color={GREEN} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>{h.title}</Text>
                <Text style={s.cardBody}>{h.body}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingTop: 56 },

  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 },
  headerTitle: { fontFamily: FFB, fontSize: 13, color: '#fff', letterSpacing: 2 },

  scroll: { paddingHorizontal: 16, paddingBottom: 48 },

  hero: {
    alignItems: 'center', paddingVertical: 28,
    borderRadius: 18, borderWidth: 1, borderColor: `${GREEN}30`, backgroundColor: `${GREEN}0d`,
    marginBottom: 24, paddingHorizontal: 20,
  },
  heroIconWrap: {
    width: 60, height: 60, borderRadius: 18, backgroundColor: `${GREEN}20`, borderWidth: 1, borderColor: `${GREEN}40`,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  heroTitle: { fontFamily: FFB, fontSize: 22, color: GREEN, marginBottom: 8, textAlign: 'center' },
  heroSub:   { fontFamily: FF, fontSize: 13, color: '#9ca3af', textAlign: 'center', lineHeight: 19, marginBottom: 16 },
  comingSoonPill:  { backgroundColor: GREEN, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5 },
  comingSoonText:  { fontFamily: FFB, fontSize: 10, color: '#000', letterSpacing: 1.5 },
  syncingText: { fontFamily: FFB, fontSize: 10, color: '#666', marginTop: 10 },

  joinBtn: { backgroundColor: GREEN, borderRadius: 12, paddingHorizontal: 28, paddingVertical: 14 },
  joinBtnText: { fontFamily: FFB, fontSize: 14, color: '#000' },
  tableBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: GREEN, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  tableBtnText: { fontFamily: FFB, fontSize: 12, color: '#000' },

  statsRow: { flexDirection: 'row', gap: 28, marginBottom: 16 },
  statBlock: { alignItems: 'center' },
  statValue: { fontFamily: FFB, fontSize: 20, color: '#fff' },
  statLabel: { fontFamily: FFB, fontSize: 9, color: '#666', letterSpacing: 1, marginTop: 2 },

  sectionLabel: { fontFamily: FFB, fontSize: 10, color: '#666', letterSpacing: 1.5, marginBottom: 10 },

  card: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c',
    padding: 14, marginBottom: 10,
  },
  cardIconWrap: {
    width: 38, height: 38, borderRadius: 10, backgroundColor: `${GREEN}15`, borderWidth: 1, borderColor: `${GREEN}30`,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontFamily: FFB, fontSize: 14, color: '#fff', marginBottom: 3 },
  cardBody:  { fontFamily: FF, fontSize: 12, color: '#9ca3af', lineHeight: 17 },
});
