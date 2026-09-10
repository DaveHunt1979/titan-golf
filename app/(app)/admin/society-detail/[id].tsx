import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../../src/lib/supabase';
import { goBack } from '../../../../src/lib/navigation';
import { titanLogo, getSocietyLogo } from '../../../../src/lib/assets';
import { usePlatformAdmin } from '../../../../src/lib/usePlatformAdmin';

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';

interface TournamentRow { id: string; name: string; format: string; status: string; }

export default function SocietyDetailScreen() {
  const { id: societyId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isPlatformAdmin, loading: platformLoading } = usePlatformAdmin();

  const [loading, setLoading]           = useState(true);
  const [societyName, setSocietyName]   = useState('');
  const [primaryColor, setPrimaryColor] = useState(GOLD);
  const [memberCount, setMemberCount]   = useState(0);
  const [tournaments, setTournaments]   = useState<TournamentRow[]>([]);
  const [casualRoundCount, setCasualRoundCount] = useState(0);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const load = useCallback(async () => {
    if (!societyId) return;
    const [{ data: soc }, { data: members }, { data: comps }] = await Promise.all([
      supabase.from('societies').select('name, primary_color').eq('id', societyId).single(),
      supabase.from('society_members').select('player_id').eq('society_id', societyId),
      supabase.from('competitions').select('id,name,format,status,is_simulation').eq('society_id', societyId),
    ]);
    if (soc) {
      setSocietyName((soc as any).name ?? '');
      setPrimaryColor((soc as any).primary_color ?? GOLD);
    }
    setMemberCount((members as any[] ?? []).length);

    const allComps = (comps as any[] ?? []);
    const realTournaments = allComps.filter(c => c.format !== 'casual' && !c.is_simulation);
    setTournaments(realTournaments.map(c => ({ id: c.id, name: c.name, format: c.format, status: c.status })));

    const casualComp = allComps.find(c => c.format === 'casual');
    if (casualComp) {
      const { count } = await supabase
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('competition_id', casualComp.id)
        .neq('status', 'upcoming');
      setCasualRoundCount(count ?? 0);
    }
    setLoading(false);
  }, [societyId]);

  useEffect(() => { if (isPlatformAdmin) load(); }, [isPlatformAdmin, load]);

  if (!fontsLoaded || platformLoading) {
    return (
      <View style={[s.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={GOLD} size="large" />
      </View>
    );
  }

  if (!isPlatformAdmin) {
    return (
      <View style={[s.container, { alignItems: 'center', justifyContent: 'center', padding: 30 }]}>
        <StatusBar style="light" />
        <Text style={s.emptyTitle}>Not available</Text>
        <Text style={s.emptyHint}>This is a Dave/Rick-only screen.</Text>
        <TouchableOpacity style={s.emptyBtn} onPress={() => goBack(router, '/(app)/admin/societies')} activeOpacity={0.8}>
          <Text style={s.emptyBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const logo = getSocietyLogo(societyName);

  return (
    <View style={s.container}>
      <StatusBar style="light" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/admin/societies')} hitSlop={hit} style={s.headerLeft}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={logo ?? titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerTitle} numberOfLines={1}>{societyName || '—'}</Text>
          <Text style={s.headerSub}>god admin</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={GOLD} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          <View style={s.statsRow}>
            <View style={s.statCard}>
              <Text style={[s.statValue, { color: primaryColor }]}>{memberCount}</Text>
              <Text style={s.statLabel}>MEMBERS</Text>
            </View>
            <View style={s.statCard}>
              <Text style={[s.statValue, { color: GOLD }]}>{tournaments.length}</Text>
              <Text style={s.statLabel}>TOURNAMENTS</Text>
            </View>
            <View style={s.statCard}>
              <Text style={[s.statValue, { color: GREEN }]}>{casualRoundCount}</Text>
              <Text style={s.statLabel}>CASUAL ROUNDS</Text>
            </View>
          </View>

          <Text style={s.sectionLabel}>TOURNAMENTS</Text>
          {tournaments.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyHint}>No tournaments created yet.</Text>
            </View>
          ) : tournaments.map(t => (
            <View key={t.id} style={s.card}>
              <View style={{ flex: 1 }}>
                <Text style={s.tName}>{t.name}</Text>
                <Text style={s.tMeta}>{t.format}</Text>
              </View>
              <Text style={[s.statusTag, { color: t.status === 'active' ? GREEN : t.status === 'complete' ? '#888' : GOLD }]}>
                {t.status.toUpperCase()}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const hit = { top: 12, bottom: 12, left: 12, right: 12 };

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  headerLeft:   { flex: 1, alignItems: 'flex-start' },
  headerCenter: { flex: 2, alignItems: 'center' },
  headerLogo:   { width: 24, height: 24, marginBottom: 2 },
  back:         { fontSize: 14, color: GOLD, fontFamily: FFB },
  headerTitle:  { fontSize: 15, color: '#fff', fontFamily: FFB, letterSpacing: 0.5, maxWidth: 200 },
  headerSub:    { fontSize: 9, color: GOLD, fontFamily: FFB },

  scroll: { padding: 20, paddingBottom: 60 },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  statCard: {
    flex: 1, backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c',
    paddingVertical: 16, alignItems: 'center',
  },
  statValue: { fontSize: 26, fontFamily: FFB },
  statLabel: { fontSize: 9, fontFamily: FFB, color: '#888', letterSpacing: 1, marginTop: 4 },

  sectionLabel: { fontSize: 10, fontFamily: FFB, color: '#fff', letterSpacing: 2, marginBottom: 10 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c',
    padding: 16, marginBottom: 8,
  },
  tName: { fontSize: 14, fontFamily: FFB, color: '#fff' },
  tMeta: { fontSize: 11, fontFamily: FFB, color: '#888', marginTop: 2, textTransform: 'capitalize' },
  statusTag: { fontSize: 10, fontFamily: FFB, letterSpacing: 1 },

  empty: { paddingVertical: 20 },
  emptyTitle: { fontSize: 18, fontFamily: FFB, color: '#fff', marginBottom: 8 },
  emptyHint: { fontSize: 13, fontFamily: FFB, color: '#888', textAlign: 'center' },
  emptyBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, marginTop: 16 },
  emptyBtnText: { fontSize: 14, fontFamily: FFB, color: '#000' },
});
