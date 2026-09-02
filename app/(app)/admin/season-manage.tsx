import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Image, Share, Clipboard, Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { titanLogo } from '../../../src/lib/assets';
import { goBack } from '../../../src/lib/navigation';
import { publishDivisions } from '../../../src/lib/seasonDivisions';
import { closeSeason } from '../../../src/lib/seasonClose';

const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', registration_open: 'Registration Open', registration_closed: 'Registration Closed',
  divisions_preview: 'Divisions Preview', published: 'Published', active: 'Active',
  verification_grace: 'Verification Grace', finalising: 'Finalising', locked: 'Locked', archived: 'Archived',
};

interface SeasonRow {
  id: string; name: string; season_year: number; status: string; join_pin: string | null;
  start_at: string | null; end_at: string | null;
  division_count: number; pending_requests: number;
}

export default function SeasonManageScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { localLogo, logoUrl } = useSocietyTheme();
  const { societyId, loading: societyLoading } = useAdminSociety();
  const [seasons, setSeasons]   = useState<SeasonRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [closingId, setClosingId]       = useState<string | null>(null);
  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const load = useCallback(async () => {
    if (!societyId) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('seasons')
      .select('id, name, season_year, status, join_pin, start_at, end_at, season_divisions(count)')
      .eq('society_id', societyId)
      .order('created_at', { ascending: false });
    const rows = (data ?? []) as any[];

    const seasonIds = rows.map(r => r.id);
    const { data: pendingRows } = seasonIds.length
      ? await supabase.from('season_join_requests').select('season_id').eq('status', 'pending_approval').in('season_id', seasonIds)
      : { data: [] as any[] };
    const pendingBySeasonId: Record<string, number> = {};
    for (const r of (pendingRows ?? []) as any[]) pendingBySeasonId[r.season_id] = (pendingBySeasonId[r.season_id] ?? 0) + 1;

    setSeasons(rows.map(r => ({
      id: r.id, name: r.name, season_year: r.season_year, status: r.status, join_pin: r.join_pin,
      start_at: r.start_at, end_at: r.end_at,
      division_count: r.season_divisions?.[0]?.count ?? 0,
      pending_requests: pendingBySeasonId[r.id] ?? 0,
    })));
    setLoading(false);
  }, [societyId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!fontsLoaded) return <View style={[s.container, { backgroundColor: dc.bg }]} />;

  async function sharePin(pin: string, name: string) {
    const formatted = `${pin.slice(0, 3)} ${pin.slice(3)}`;
    try {
      await Share.share({ message: `Join "${name}" on Titan Golf — Season PIN: ${formatted}` });
    } catch {
      Clipboard.setString(pin);
    }
  }

  async function handlePublish(season: SeasonRow) {
    setPublishingId(season.id);
    try {
      const result = await publishDivisions(season.id);
      if (result.assignedCount === 0) {
        Alert.alert('Nothing to Publish', 'No approved players are waiting to be placed into divisions yet.');
      } else {
        Alert.alert('Divisions Published', `${result.assignedCount} player${result.assignedCount === 1 ? '' : 's'} placed into divisions by handicap.`);
      }
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not publish divisions');
    } finally {
      setPublishingId(null);
    }
  }

  function confirmClose(season: SeasonRow) {
    const notEndedYet = season.end_at && new Date(season.end_at) > new Date();
    Alert.alert(
      'Close Season',
      (notEndedYet ? `This Season's end date hasn't passed yet (${new Date(season.end_at!).toLocaleDateString('en-GB')}). ` : '')
        + 'This finalizes final standings, confirms champions, and applies promotion/relegation. This cannot be undone from the app.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Close Season', style: 'destructive', onPress: () => handleClose(season) },
      ],
    );
  }

  async function handleClose(season: SeasonRow) {
    setClosingId(season.id);
    try {
      const result = await closeSeason(season.id);
      const championLines = result.champions.map(c => `${c.divisionName}: ${c.playerName}`).join('\n');
      Alert.alert('Season Closed', `${result.divisionsClosed} division${result.divisionsClosed === 1 ? '' : 's'} finalized.${championLines ? `\n\nChampions:\n${championLines}` : ''}`);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not close Season');
    } finally {
      setClosingId(null);
    }
  }

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />
      <View style={[s.header, { borderBottomColor: dc.border }]}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/admin/hub-season')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={[s.back, { color: dc.gold }]}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)} style={s.headerLogo} resizeMode="contain" />
          <Text style={[s.headerSub, { color: GREEN }]}>SEASONS</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/(app)/admin/season-create' as any)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="add-circle-outline" size={24} color={GREEN} />
        </TouchableOpacity>
      </View>

      {(loading || societyLoading) ? (
        <View style={s.centered}><ActivityIndicator color={GREEN} size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {seasons.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="trophy-outline" size={40} color="#333" />
              <Text style={s.emptyTitle}>No Seasons yet</Text>
              <Text style={s.emptySub}>Create one to start building your league</Text>
              <TouchableOpacity style={s.emptyBtn} onPress={() => router.push('/(app)/admin/season-create' as any)} activeOpacity={0.85}>
                <Text style={s.emptyBtnText}>Create Season</Text>
              </TouchableOpacity>
            </View>
          ) : (
            seasons.map(season => (
              <View key={season.id} style={s.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={s.cardName}>{season.name}</Text>
                  <View style={s.statusPill}>
                    <Text style={s.statusPillText}>{STATUS_LABEL[season.status] ?? season.status}</Text>
                  </View>
                </View>
                <Text style={s.cardMeta}>{season.season_year} · {season.division_count} division{season.division_count === 1 ? '' : 's'}</Text>
                {season.join_pin && (
                  <View style={s.pinRow}>
                    <Text style={s.pinValue}>{season.join_pin.slice(0, 3)} {season.join_pin.slice(3)}</Text>
                    <TouchableOpacity style={s.pinShareBtn} onPress={() => sharePin(season.join_pin!, season.name)} activeOpacity={0.8}>
                      <Ionicons name="share-outline" size={14} color={GREEN} />
                      <Text style={s.pinShareBtnText}>Share PIN</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {season.status === 'locked' ? (
                  <View style={s.lockedRow}>
                    <Ionicons name="lock-closed" size={13} color="#666" />
                    <Text style={s.lockedText}>Final — Season Closed</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                    <TouchableOpacity
                      style={[s.publishBtn, { flex: 1, marginTop: 0 }]}
                      onPress={() => handlePublish(season)}
                      disabled={publishingId === season.id || closingId === season.id}
                      activeOpacity={0.8}
                    >
                      {publishingId === season.id
                        ? <ActivityIndicator color={GREEN} size="small" />
                        : <Text style={s.publishBtnText}>{season.status === 'draft' ? 'Publish Divisions' : 'Re-Publish'}</Text>
                      }
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.closeBtn, { flex: 1 }]}
                      onPress={() => confirmClose(season)}
                      disabled={publishingId === season.id || closingId === season.id}
                      activeOpacity={0.8}
                    >
                      {closingId === season.id
                        ? <ActivityIndicator color={RED} size="small" />
                        : <Text style={s.closeBtnText}>Close Season</Text>
                      }
                    </TouchableOpacity>
                  </View>
                )}
                <TouchableOpacity
                  style={s.requestsRow}
                  onPress={() => router.push({ pathname: '/(app)/admin/season-requests' as any, params: { seasonId: season.id, seasonName: season.name } })}
                  activeOpacity={0.7}
                >
                  <Text style={s.requestsText}>Join Requests</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {season.pending_requests > 0 && (
                      <View style={s.requestsBadge}><Text style={s.requestsBadgeText}>{season.pending_requests}</Text></View>
                    )}
                    <Ionicons name="chevron-forward" size={14} color="#666" />
                  </View>
                </TouchableOpacity>
              </View>
            ))
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

  card: { backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c', borderRadius: 14, padding: 16, marginBottom: 12 },
  cardName: { fontFamily: FFB, fontSize: 16, color: '#fff' },
  cardMeta: { fontFamily: FFB, fontSize: 12, color: '#888', marginTop: 4 },
  statusPill: { backgroundColor: `${GREEN}18`, borderWidth: 1, borderColor: `${GREEN}40`, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 },
  statusPillText: { fontFamily: FFB, fontSize: 10, color: GREEN, letterSpacing: 0.5 },

  pinRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#1c1c1c' },
  pinValue: { fontFamily: FFB, fontSize: 18, color: '#fff', letterSpacing: 3 },
  pinShareBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: `${GREEN}18`, borderWidth: 1, borderColor: `${GREEN}40`, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  pinShareBtnText: { fontFamily: FFB, fontSize: 11, color: GREEN },

  publishBtn: { marginTop: 12, backgroundColor: `${GREEN}18`, borderWidth: 1, borderColor: `${GREEN}40`, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  publishBtnText: { fontFamily: FFB, fontSize: 12, color: GREEN },
  closeBtn: { backgroundColor: `${RED}18`, borderWidth: 1, borderColor: `${RED}40`, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  closeBtnText: { fontFamily: FFB, fontSize: 12, color: RED },
  lockedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  lockedText: { fontFamily: FFB, fontSize: 12, color: '#666' },

  requestsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#1c1c1c' },
  requestsText: { fontFamily: FFB, fontSize: 12, color: '#ccc' },
  requestsBadge: { backgroundColor: GREEN, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  requestsBadgeText: { fontFamily: FFB, fontSize: 11, color: '#000' },

  empty: { alignItems: 'center', paddingTop: 80, gap: 8 },
  emptyTitle: { fontFamily: FFB, fontSize: 16, color: '#fff', marginTop: 8 },
  emptySub:   { fontFamily: FF, fontSize: 12, color: '#666' },
  emptyBtn:   { marginTop: 16, backgroundColor: GREEN, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 },
  emptyBtnText: { fontFamily: FFB, fontSize: 14, color: '#000' },
});
