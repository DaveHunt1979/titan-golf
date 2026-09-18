// Season roster management (Dave, 2026-09-16) — "within the society they
// are doing a season, auto enroll everyone and admin can remove if the
// player doesn't want in." One-time bulk enroll (not an ongoing trigger on
// every future society join — Dave's own call) plus a way to remove anyone
// who opts out. Reuses season/join.tsx's exact insert shape so an
// auto-enrolled entry is indistinguishable from someone who joined by PIN.
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
import { recalculateSeasonEntry, syncSeasonRoundsForEntry } from '../../../src/lib/seasonRoundIngestion';

const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';

interface EntryRow {
  entryId: string; playerId: string; name: string; handicapIndex: number | null;
  qualifyingRoundsCount: number; seasonPoints: number;
}

export default function SeasonEntriesScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { localLogo, logoUrl } = useSocietyTheme();
  const { id: seasonId } = useLocalSearchParams<{ id: string }>();
  const [seasonName, setSeasonName] = useState('');
  const [societyId, setSocietyId] = useState<string | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [syncingRounds, setSyncingRounds] = useState(false);
  const [countingLimit, setCountingLimit] = useState(20);
  const [minQualifying, setMinQualifying] = useState(20);
  const [seasonStartAt, setSeasonStartAt] = useState<string | null>(null);
  const [seasonEndAt, setSeasonEndAt] = useState<string | null>(null);
  const [hcpAllowancePercent, setHcpAllowancePercent] = useState(100);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const load = useCallback(async () => {
    if (!seasonId) { setLoading(false); return; }
    setLoading(true);
    const { data: season } = await supabase.from('seasons').select('name, society_id, counting_round_limit, minimum_qualifying_rounds, start_at, end_at, handicap_allowance_percent').eq('id', seasonId).maybeSingle();
    setSeasonName((season as any)?.name ?? '');
    setSocietyId((season as any)?.society_id ?? null);
    setCountingLimit((season as any)?.counting_round_limit ?? 20);
    setMinQualifying((season as any)?.minimum_qualifying_rounds ?? 20);
    setSeasonStartAt((season as any)?.start_at ?? null);
    setSeasonEndAt((season as any)?.end_at ?? null);
    setHcpAllowancePercent((season as any)?.handicap_allowance_percent ?? 100);

    const { data } = await supabase
      .from('season_entries')
      .select('id, player_id, entry_handicap_index, qualifying_rounds_count, season_points, players(display_name)')
      .eq('season_id', seasonId)
      .order('players(display_name)', { ascending: true });
    setEntries(((data ?? []) as any[]).map(r => ({
      entryId: r.id, playerId: r.player_id, name: r.players?.display_name ?? 'Unknown',
      handicapIndex: r.entry_handicap_index, qualifyingRoundsCount: r.qualifying_rounds_count ?? 0,
      seasonPoints: r.season_points ?? 0,
    })));
    setLoading(false);
  }, [seasonId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!fontsLoaded) return <View style={[s.container, { backgroundColor: dc.bg }]} />;

  async function autoEnroll() {
    if (!seasonId || !societyId) return;
    setEnrolling(true);
    try {
      const [{ data: members }, { data: existing }] = await Promise.all([
        supabase.from('society_members').select('player_id').eq('society_id', societyId),
        supabase.from('season_entries').select('player_id').eq('season_id', seasonId),
      ]);
      const alreadyIn = new Set(((existing ?? []) as any[]).map(e => e.player_id));
      const missingIds = ((members ?? []) as any[]).map(m => m.player_id).filter(pid => !alreadyIn.has(pid));
      if (missingIds.length === 0) {
        Alert.alert('Already enrolled', 'Every current society member is already in this season.');
        return;
      }
      const { data: playerRows } = await supabase.from('players').select('id, handicap_index').in('id', missingIds);
      const hcpByPlayer: Record<string, number | null> = {};
      ((playerRows ?? []) as any[]).forEach(p => { hcpByPlayer[p.id] = p.handicap_index ?? null; });

      const rows = missingIds.map(pid => ({
        season_id: seasonId, player_id: pid,
        entry_handicap_index: hcpByPlayer[pid] ?? null,
        join_status: 'approved', qualification_status: 'provisional',
      }));
      const { error } = await supabase.from('season_entries').insert(rows as any);
      if (error) throw error;
      Alert.alert('Enrolled', `${missingIds.length} player${missingIds.length === 1 ? '' : 's'} added to the season.`);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not auto-enroll the society');
    } finally {
      setEnrolling(false);
    }
  }

  // Dave, 2026-09-16: "Rick has played 4 rounds and 273 points... but in
  // admin it only shows 44" — a season_entries row's cached counts can drift
  // from the real season_rounds data (e.g. an Admin > Simulate test that
  // used a real player's account got cleaned up, cascade-deleting the
  // season_rounds it created, but nothing re-ran recalculateSeasonEntry
  // afterward). The standalone scripts/backfill_season_rounds.mts already
  // fixes this from a terminal; this button is the same fix from inside the
  // app, since Dave can't run scripts himself.
  async function recalculateAll() {
    if (!seasonId) return;
    setRecalculating(true);
    try {
      for (const entry of entries) {
        await recalculateSeasonEntry(entry.entryId, seasonId, countingLimit, minQualifying);
      }
      await load();
      Alert.alert('Recalculated', 'Every entry\'s counts now match the real rounds on record.');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not recalculate entries');
    } finally {
      setRecalculating(false);
    }
  }

  // Dave, 2026-09-17: a round only ever gets ingested for a player when THEY
  // open the Season tab (syncSeasonRoundsForEntry's one caller, season/
  // index.tsx) — so a player who was genuinely in a qualifying round but
  // hasn't opened Season since is invisible to admin, nothing there to void
  // ("it didnt pick up Mike or Ollie who was in the game"). This runs the
  // exact same sync every entrant already gets, for everyone at once, so
  // admin doesn't have to wait on each player to open the app themselves.
  async function syncAllRounds() {
    if (!seasonId || !societyId || !seasonStartAt || !seasonEndAt) return;
    setSyncingRounds(true);
    try {
      let totalIngested = 0;
      for (const entry of entries) {
        const { ingested } = await syncSeasonRoundsForEntry(entry.entryId, entry.playerId, {
          id: seasonId, societyId, startAt: seasonStartAt, endAt: seasonEndAt,
          handicapAllowancePercent: hcpAllowancePercent, countingRoundLimit: countingLimit,
          minimumQualifyingRounds: minQualifying,
        });
        totalIngested += ingested;
      }
      await load();
      Alert.alert('Synced', totalIngested > 0
        ? `${totalIngested} round${totalIngested === 1 ? '' : 's'} newly added across the roster.`
        : 'Every entrant is already up to date — nothing new to add.');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not sync rounds for the roster');
    } finally {
      setSyncingRounds(false);
    }
  }

  function confirmRemove(entry: EntryRow) {
    Alert.alert(
      'Remove from season?',
      `${entry.name} will be removed from this season, along with any rounds/points already recorded for them. This can't be undone — they'd need to rejoin from scratch.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => remove(entry) },
      ],
    );
  }

  async function remove(entry: EntryRow) {
    setRemovingId(entry.entryId);
    try {
      const { error } = await supabase.from('season_entries').delete().eq('id', entry.entryId);
      if (error) throw error;
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not remove this player');
    } finally {
      setRemovingId(null);
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
          <Text style={[s.headerSub, { color: GREEN }]}>{seasonName ? seasonName.toUpperCase() : 'SEASON ROSTER'}</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={s.centered}><ActivityIndicator color={GREEN} size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <TouchableOpacity style={s.enrollBtn} onPress={autoEnroll} disabled={enrolling} activeOpacity={0.85}>
            {enrolling ? <ActivityIndicator color="#000" /> : <Text style={s.enrollBtnText}>Auto-Enroll Whole Society</Text>}
          </TouchableOpacity>
          <Text style={s.hint}>Adds every current society member not already in this season. Safe to run more than once — already-enrolled players are skipped.</Text>

          <TouchableOpacity style={s.recalcBtn} onPress={syncAllRounds} disabled={syncingRounds || entries.length === 0} activeOpacity={0.85}>
            {syncingRounds ? <ActivityIndicator color={GREEN} /> : <Text style={s.recalcBtnText}>Sync All Entries&apos; Rounds</Text>}
          </TouchableOpacity>
          <Text style={s.hint}>Pulls in any qualifying round a player hasn't had added yet — normally this only happens when they open Season themselves. Run this to catch everyone up at once, including anyone who was in a round but didn't personally score (added as 0 points so it can be voided). Safe to run any time.</Text>

          <TouchableOpacity style={s.recalcBtn} onPress={recalculateAll} disabled={recalculating || entries.length === 0} activeOpacity={0.85}>
            {recalculating ? <ActivityIndicator color={GREEN} /> : <Text style={s.recalcBtnText}>Recalculate All Rounds &amp; Points</Text>}
          </TouchableOpacity>
          <Text style={s.hint}>Fixes a player's rounds/points if they look wrong or out of date (e.g. after deleting an Admin &gt; Simulate test) — recalculates from what's actually on record. Safe to run any time.</Text>

          <Text style={[s.sectionLabel, { marginTop: 20 }]}>{entries.length} ENROLLED</Text>
          {entries.map(entry => (
            <View key={entry.entryId} style={s.card}>
              <View style={{ flex: 1 }}>
                <Text style={s.cardName}>{entry.name}</Text>
                <Text style={s.cardMeta}>
                  {entry.handicapIndex != null ? `HI ${entry.handicapIndex}` : 'No handicap on file'} · {entry.qualifyingRoundsCount} rounds · {entry.seasonPoints} pts
                </Text>
              </View>
              {removingId === entry.entryId ? <ActivityIndicator color={RED} /> : (
                <TouchableOpacity style={s.removeBtn} onPress={() => confirmRemove(entry)} activeOpacity={0.8}>
                  <Text style={s.removeBtnText}>Remove</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
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
  sectionLabel: { fontFamily: FFB, fontSize: 11, color: GREEN, letterSpacing: 2, marginBottom: 10 },
  hint: { fontFamily: FF, fontSize: 11, color: '#666', lineHeight: 15, marginTop: 8 },

  enrollBtn: { backgroundColor: GREEN, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  enrollBtnText: { fontFamily: FFB, fontSize: 14, color: '#000' },

  recalcBtn: {
    marginTop: 16, backgroundColor: `${GREEN}18`, borderWidth: 1, borderColor: `${GREEN}40`,
    borderRadius: 12, paddingVertical: 14, alignItems: 'center',
  },
  recalcBtnText: { fontFamily: FFB, fontSize: 13, color: GREEN },

  card: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c', borderRadius: 14, padding: 14, marginBottom: 10,
  },
  cardName: { fontFamily: FFB, fontSize: 15, color: '#fff' },
  cardMeta: { fontFamily: FFB, fontSize: 11, color: '#888', marginTop: 2 },
  removeBtn: { backgroundColor: `${RED}18`, borderWidth: 1, borderColor: `${RED}40`, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  removeBtnText: { fontFamily: FFB, fontSize: 11, color: RED },
});
