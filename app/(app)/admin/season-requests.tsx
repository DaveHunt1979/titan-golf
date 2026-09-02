import { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { titanLogo } from '../../../src/lib/assets';
import { goBack } from '../../../src/lib/navigation';

const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';

interface RequestRow {
  id: string; playerId: string; displayName: string; handicapIndex: number | null; requestedAt: string;
}

export default function SeasonRequestsScreen() {
  const router = useRouter();
  const { seasonId, seasonName } = useLocalSearchParams<{ seasonId: string; seasonName?: string }>();
  const dc = useDynamicColors();
  const { localLogo, logoUrl } = useSocietyTheme();
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [busyId, setBusyId]     = useState<string | null>(null);
  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const load = useCallback(async () => {
    if (!seasonId) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('season_join_requests')
      .select('id, requested_at, player_id, players(display_name, handicap_index)')
      .eq('season_id', seasonId).eq('status', 'pending_approval')
      .order('requested_at', { ascending: true });
    setRequests(((data ?? []) as any[]).map(r => ({
      id: r.id, playerId: r.player_id,
      displayName: r.players?.display_name ?? 'Unknown', handicapIndex: r.players?.handicap_index ?? null,
      requestedAt: r.requested_at,
    })));
    setLoading(false);
  }, [seasonId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!fontsLoaded) return <View style={[s.container, { backgroundColor: dc.bg }]} />;

  async function decide(req: RequestRow, approve: boolean) {
    setBusyId(req.id);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: admin } = user ? await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle() : { data: null };

    if (approve) {
      const { error } = await supabase.from('season_entries').insert({
        season_id: seasonId, player_id: req.playerId,
        entry_handicap_index: req.handicapIndex, join_status: 'approved', qualification_status: 'provisional',
      } as any);
      if (error && (error as any).code !== '23505') { setBusyId(null); return; }
    }

    await supabase.from('season_join_requests').update({
      status: approve ? 'approved' : 'declined',
      decided_at: new Date().toISOString(),
      decided_by: (admin as any)?.id ?? null,
    } as any).eq('id', req.id);

    setRequests(prev => prev.filter(r => r.id !== req.id));
    setBusyId(null);
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
          <Text style={[s.headerSub, { color: GREEN }]}>{seasonName ? String(seasonName).toUpperCase() : 'REQUESTS'}</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={s.centered}><ActivityIndicator color={GREEN} size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {requests.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="checkmark-done-outline" size={40} color="#333" />
              <Text style={s.emptyTitle}>No pending requests</Text>
            </View>
          ) : (
            requests.map(req => (
              <View key={req.id} style={s.card}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardName}>{req.displayName}</Text>
                  <Text style={s.cardMeta}>{req.handicapIndex != null ? `HI ${req.handicapIndex}` : 'No handicap on file'}</Text>
                </View>
                {busyId === req.id ? <ActivityIndicator color={GREEN} /> : (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity style={[s.actionBtn, { backgroundColor: `${RED}18`, borderColor: `${RED}40` }]} onPress={() => decide(req, false)} activeOpacity={0.8}>
                      <Ionicons name="close" size={16} color={RED} />
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.actionBtn, { backgroundColor: `${GREEN}18`, borderColor: `${GREEN}40` }]} onPress={() => decide(req, true)} activeOpacity={0.8}>
                      <Ionicons name="checkmark" size={16} color={GREEN} />
                    </TouchableOpacity>
                  </View>
                )}
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

  card: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c', borderRadius: 14, padding: 14, marginBottom: 10,
  },
  cardName: { fontFamily: FFB, fontSize: 15, color: '#fff' },
  cardMeta: { fontFamily: FFB, fontSize: 11, color: '#888', marginTop: 2 },
  actionBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },

  empty: { alignItems: 'center', paddingTop: 80, gap: 8 },
  emptyTitle: { fontFamily: FFB, fontSize: 15, color: '#fff', marginTop: 8 },
});
