// Admin visibility into every round ingested into a Season (Dave, 2026-09-16
// — "as we have been testing, it has been adding rounds, so we need to
// remove them and not counted"). Real, non-simulation test matches (e.g. a
// tournament an admin builds just to try the app out) are legitimately
// eligible per seasonRoundIngestion's rules if a real co-player is involved
// — is_simulation exclusion only catches Admin > Simulate runs, not this —
// so admin needs a manual way to pull a specific round back out.
//
// Voids rather than deletes: season_rounds.status already has a 'void'
// value, and recalculateSeasonEntry (seasonRoundIngestion.ts) already
// excludes void/rejected/disputed rounds from counting-rounds/points — this
// reuses that existing exclusion path instead of a new one, and keeps the
// round on record (source_match_id etc.) rather than losing it entirely.
import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Image, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { titanLogo } from '../../../src/lib/assets';
import { goBack } from '../../../src/lib/navigation';
import { recalculateSeasonEntry } from '../../../src/lib/seasonRoundIngestion';

const GREEN = '#4ade80';
const GOLD  = '#D4AF37';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';

interface RoundRow {
  id: string; season_entry_id: string; player_name: string; course_name: string;
  played_at: string | null; final_round_points: number | null; status: string; is_counting: boolean;
}

export default function SeasonRoundsScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { localLogo, logoUrl } = useSocietyTheme();
  const { id: seasonId } = useLocalSearchParams<{ id: string }>();
  const [seasonName, setSeasonName] = useState('');
  const [countingLimit, setCountingLimit] = useState(20);
  const [minQualifying, setMinQualifying] = useState(20);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const load = useCallback(async () => {
    if (!seasonId) { setLoading(false); return; }
    setLoading(true);
    const [{ data: season }, { data: roundRows }] = await Promise.all([
      supabase.from('seasons').select('name, counting_round_limit, minimum_qualifying_rounds').eq('id', seasonId).maybeSingle(),
      supabase.from('season_rounds')
        .select('id, season_entry_id, course_name, played_at, final_round_points, status, is_counting, season_entries(player_id, players(display_name))')
        .eq('season_id', seasonId)
        .order('played_at', { ascending: false }),
    ]);
    setSeasonName((season as any)?.name ?? '');
    setCountingLimit((season as any)?.counting_round_limit ?? 20);
    setMinQualifying((season as any)?.minimum_qualifying_rounds ?? 20);
    setRounds(((roundRows ?? []) as any[]).map(r => ({
      id: r.id, season_entry_id: r.season_entry_id,
      player_name: r.season_entries?.players?.display_name ?? 'Unknown',
      course_name: r.course_name, played_at: r.played_at,
      final_round_points: r.final_round_points, status: r.status, is_counting: r.is_counting,
    })));
    setLoading(false);
  }, [seasonId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!fontsLoaded) return <View style={[s.container, { backgroundColor: dc.bg }]} />;

  function confirmToggleVoid(round: RoundRow) {
    const voiding = round.status !== 'void';
    Alert.alert(
      voiding ? 'Void this round?' : 'Restore this round?',
      voiding
        ? `${round.player_name}'s round at ${round.course_name} will stop counting toward the season. It stays on record and can be restored later.`
        : `${round.player_name}'s round at ${round.course_name} will count toward the season again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: voiding ? 'Void' : 'Restore', style: voiding ? 'destructive' : 'default', onPress: () => toggleVoid(round, voiding) },
      ],
    );
  }

  async function toggleVoid(round: RoundRow, voiding: boolean) {
    setBusyId(round.id);
    try {
      await supabase.from('season_rounds').update({ status: voiding ? 'void' : 'scored' } as any).eq('id', round.id);
      await recalculateSeasonEntry(round.season_entry_id, seasonId as string, countingLimit, minQualifying);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not update this round');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />
      <View style={[s.header, { borderBottomColor: dc.border }]}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/admin/season-manage')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={[s.back, { color: dc.gold }]}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)} style={s.headerLogo} resizeMode="contain" />
          <Text style={[s.headerSub, { color: GREEN }]}>{seasonName ? seasonName.toUpperCase() : 'SEASON ROUNDS'}</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={s.centered}><ActivityIndicator color={GREEN} size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <Text style={s.intro}>Every round ingested into this season. Void anything that shouldn't count — test rounds, mistakes — without losing the record.</Text>

          {rounds.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="golf-outline" size={40} color="#333" />
              <Text style={s.emptyTitle}>No rounds yet</Text>
            </View>
          ) : (
            rounds.map(round => {
              const isVoid = round.status === 'void';
              return (
                <View key={round.id} style={[s.card, isVoid && { opacity: 0.5 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardName}>{round.player_name}</Text>
                    <Text style={s.cardMeta}>{round.course_name}{round.played_at ? ` · ${new Date(round.played_at).toLocaleDateString('en-GB')}` : ''}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <Text style={[s.pts, { color: GOLD }]}>{round.final_round_points ?? '—'} pts</Text>
                      {isVoid && <Text style={s.voidTag}>VOIDED</Text>}
                      {!isVoid && round.is_counting && <Text style={s.countingTag}>COUNTING</Text>}
                    </View>
                  </View>
                  {busyId === round.id ? <ActivityIndicator color={GREEN} /> : (
                    <TouchableOpacity
                      style={[s.voidBtn, isVoid ? { backgroundColor: `${GREEN}18`, borderColor: `${GREEN}40` } : { backgroundColor: `${RED}18`, borderColor: `${RED}40` }]}
                      onPress={() => confirmToggleVoid(round)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.voidBtnText, { color: isVoid ? GREEN : RED }]}>{isVoid ? 'Restore' : 'Void'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerCenter: { alignItems: 'center' },
  headerLogo:   { width: 36, height: 36 },
  headerSub:    { fontFamily: FFB, fontSize: 10, letterSpacing: 2, marginTop: 2 },
  back:         { fontFamily: FFB, fontSize: 14 },

  scroll: { padding: 20, paddingBottom: 60 },
  intro:  { fontFamily: FF, fontSize: 13, color: '#888', lineHeight: 20, marginBottom: 16 },

  card: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c', borderRadius: 14, padding: 14, marginBottom: 10,
  },
  cardName: { fontFamily: FFB, fontSize: 15, color: '#fff' },
  cardMeta: { fontFamily: FFB, fontSize: 11, color: '#888', marginTop: 2 },
  pts:      { fontFamily: FFB, fontSize: 12 },
  voidTag:      { fontFamily: FFB, fontSize: 9, color: RED, letterSpacing: 1 },
  countingTag:  { fontFamily: FFB, fontSize: 9, color: GREEN, letterSpacing: 1 },

  voidBtn:     { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  voidBtnText: { fontFamily: FFB, fontSize: 11 },

  empty: { alignItems: 'center', paddingTop: 80, gap: 8 },
  emptyTitle: { fontFamily: FFB, fontSize: 16, color: '#fff', marginTop: 8 },
});
