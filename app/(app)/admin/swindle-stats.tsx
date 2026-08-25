import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Image, Alert, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { sendMatchNotification } from '../../../src/lib/notifications';
import { titanLogo } from '../../../src/lib/assets';
import { goBack } from '../../../src/lib/navigation';
import { computeSwindleSeasonStats, SwindleSeasonStats } from '../../../src/lib/swindleStats';

const PURPLE = '#a78bfa';
const GOLD   = '#D4AF37';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';

// Same base URL admin/news.tsx uses for the Newsreel share link — the
// Next.js web app deployment, not the mobile app itself.
const WEB_BASE_URL = 'https://titangolf-web.vercel.app';

const RECORD_CARDS: { key: keyof SwindleSeasonStats; label: string; unit: string; color: string }[] = [
  { key: 'bestStableford',  label: 'Best Stableford',  unit: 'pts', color: GOLD },
  { key: 'worstStableford', label: 'Worst Stableford',  unit: 'pts', color: '#f87171' },
  { key: 'bestFront9',      label: 'Best Front 9',      unit: 'pts', color: PURPLE },
  { key: 'bestBack9',       label: 'Best Back 9',       unit: 'pts', color: PURPLE },
  { key: 'worstFront9',     label: 'Worst Front 9',     unit: 'pts', color: '#f87171' },
  { key: 'worstBack9',      label: 'Worst Back 9',      unit: 'pts', color: '#f87171' },
  { key: 'bestMedal',       label: 'Best Medal Round',  unit: '',    color: '#4ade80' },
  { key: 'worstMedal',      label: 'Worst Medal Round', unit: '',    color: '#f87171' },
];

const COUNT_BOARDS: { key: 'eagles' | 'birdies' | 'pars' | 'blobs'; label: string; color: string }[] = [
  { key: 'eagles',  label: 'Eagles',  color: GOLD },
  { key: 'birdies', label: 'Birdies', color: '#4ade80' },
  { key: 'pars',    label: 'Pars',    color: '#60a5fa' },
  { key: 'blobs',   label: 'Blobs',   color: '#f87171' },
];

export default function SwindleStatsScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { localLogo, logoUrl, societyId } = useSocietyTheme() as any;

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pushing, setPushing]       = useState(false);
  const [stats, setStats]           = useState<SwindleSeasonStats | null>(null);

  const load = useCallback(async () => {
    if (!societyId) { setLoading(false); setRefreshing(false); return; }
    const data = await computeSwindleSeasonStats(societyId);
    setStats(data);
    setLoading(false);
    setRefreshing(false);
  }, [societyId]);

  useEffect(() => { load(); }, [load]);

  async function pushToMembers() {
    if (!societyId || pushing) return;
    setPushing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: me } = await supabase.from('players').select('id').eq('auth_uid', user?.id ?? '').maybeSingle();
      const { data: memberRows } = await supabase
        .from('society_members').select('player_id, membership_types')
        .eq('society_id', societyId);
      const recipientIds = (memberRows ?? [])
        .filter((m: any) => ((m.membership_types ?? []) as string[]).includes('swindle'))
        .map((m: any) => m.player_id)
        .filter((id: string) => id !== (me as any)?.id);

      const link = `${WEB_BASE_URL}/swindle/${societyId}`;
      if (recipientIds.length) {
        const rows = recipientIds.map((recipient_id: string) => ({
          sender_id: (me as any)?.id, recipient_id,
          content: '🏆 The Swindle Season Stats are up to date — check the leaderboard',
          message_type: 'swindle_records' as const, link_url: link,
        }));
        const { error } = await supabase.from('direct_messages').insert(rows);
        if (error) { Alert.alert('Error', error.message); return; }
        await sendMatchNotification('', '🏆 Swindle Season Stats', 'The leaderboard has just been updated', recipientIds);
      }

      Alert.alert('Sent', `Season stats pushed to ${recipientIds.length} member${recipientIds.length === 1 ? '' : 's'}.`);
    } finally {
      setPushing(false);
    }
  }

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={PURPLE} size="large" />
    </View>
  );

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/admin/hub-swindle')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={s.back}>‹ Swindle</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)} style={s.logo} resizeMode="contain" />
          <Text style={s.title}>SEASON STATS</Text>
        </View>
        <View style={{ width: 70 }} />
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={PURPLE} />}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity style={s.pushBtn} onPress={pushToMembers} disabled={pushing || !stats?.gamesPlayed} activeOpacity={0.85}>
          {pushing
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.pushBtnText}>📣 Push Season Stats to Members</Text>}
        </TouchableOpacity>

        {!stats?.gamesPlayed ? (
          <Text style={s.empty}>No swindle scores yet this season.</Text>
        ) : (
          <>
            {/* Order of Merit */}
            <Text style={s.sectionLabel}>Order of Merit</Text>
            <Text style={s.sectionSub}>Eagle +4 · Birdie +3 · Par +2 · Blob −1</Text>
            <View style={s.card}>
              {stats.orderOfMerit.slice(0, 15).map((p, i) => (
                <View key={p.playerId} style={[s.rankRow, i === 0 && s.rankRowFirst]}>
                  <Text style={s.rankPos}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rankName}>{p.name}</Text>
                    <Text style={s.rankSub}>{p.appearances} round{p.appearances !== 1 ? 's' : ''} · avg {p.average}</Text>
                  </View>
                  <Text style={s.rankValue}>{p.points}</Text>
                </View>
              ))}
            </View>

            {/* Money List */}
            <Text style={s.sectionLabel}>Money List</Text>
            <View style={s.card}>
              {stats.moneyList.length === 0 && <Text style={s.emptySmall}>No completed games yet.</Text>}
              {stats.moneyList.slice(0, 15).map((p, i) => (
                <View key={p.playerId} style={[s.rankRow, i === 0 && s.rankRowFirst]}>
                  <Text style={s.rankPos}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rankName}>{p.name}</Text>
                    <Text style={s.rankSub}>{p.wins} win{p.wins !== 1 ? 's' : ''} · {p.games} game{p.games !== 1 ? 's' : ''}</Text>
                  </View>
                  <Text style={[s.rankValue, { color: GOLD }]}>£{p.earnings.toFixed(2)}</Text>
                </View>
              ))}
            </View>

            {/* Eagles / Birdies / Pars / Blobs */}
            <Text style={s.sectionLabel}>Season Counts</Text>
            <View style={s.countGrid}>
              {COUNT_BOARDS.map(board => {
                const list = stats[board.key];
                return (
                  <View key={board.key} style={s.countCard}>
                    <Text style={[s.countTitle, { color: board.color }]}>{board.label}</Text>
                    {list.length === 0 && <Text style={s.emptySmall}>—</Text>}
                    {list.slice(0, 5).map((p, i) => (
                      <View key={p.playerId} style={s.countRow}>
                        <Text style={s.countName} numberOfLines={1}>{i + 1}. {p.name}</Text>
                        <Text style={[s.countValue, { color: board.color }]}>{p.value}</Text>
                      </View>
                    ))}
                  </View>
                );
              })}
            </View>

            {/* Records */}
            <Text style={s.sectionLabel}>Records</Text>
            <View style={s.recordGrid}>
              {RECORD_CARDS.map(rc => {
                const rec = stats[rc.key] as SwindleSeasonStats['bestStableford'];
                return (
                  <View key={rc.key} style={[s.recordCard, { borderColor: rec ? `${rc.color}44` : '#1c1c1c' }]}>
                    <Text style={[s.recordValue, { color: rc.color }]}>{rec ? `${rec.value}${rc.unit ? ` ${rc.unit}` : ''}` : '—'}</Text>
                    <Text style={s.recordLabel}>{rc.label}</Text>
                    <Text style={s.recordHolder} numberOfLines={1}>{rec ? rec.name : '—'}</Text>
                  </View>
                );
              })}
            </View>
          </>
        )}

        <View style={{ height: 60 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  header: {
    paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  back:         { fontSize: 15, fontFamily: FFB, color: GOLD, width: 70 },
  headerCenter: { alignItems: 'center', gap: 2 },
  logo:         { width: 28, height: 28, marginBottom: 2 },
  title:        { fontSize: 13, fontFamily: FFB, color: '#fff', letterSpacing: 1.5 },

  scroll: { padding: 16 },
  empty:  { fontFamily: FFB, color: '#fff', textAlign: 'center', paddingVertical: 60, fontSize: 13 },
  emptySmall: { fontFamily: FFB, color: '#555', fontSize: 12, padding: 12, textAlign: 'center' },

  pushBtn: {
    backgroundColor: PURPLE, borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', marginBottom: 24,
    shadowColor: PURPLE, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
  },
  pushBtnText: { fontFamily: FFB, fontSize: 14, color: '#fff' },

  sectionLabel: { fontFamily: FFB, fontSize: 12, color: PURPLE, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  sectionSub:   { fontFamily: FFB, fontSize: 10, color: '#555', marginBottom: 10 },

  card: {
    backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c',
    marginBottom: 24, overflow: 'hidden',
  },
  rankRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12, borderTopWidth: 1, borderTopColor: '#1c1c1c' },
  rankRowFirst: { borderTopWidth: 0, backgroundColor: 'rgba(167,139,250,0.06)' },
  rankPos:   { width: 22, fontFamily: FFB, fontSize: 14, color: '#fff', textAlign: 'center' },
  rankName:  { fontFamily: FFB, fontSize: 14, color: '#fff' },
  rankSub:   { fontFamily: FFB, fontSize: 11, color: '#555', marginTop: 2 },
  rankValue: { fontFamily: FFB, fontSize: 16, color: '#fff' },

  countGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  countCard: {
    flexBasis: '48%', flexGrow: 1, backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c', padding: 14,
  },
  countTitle: { fontFamily: FFB, fontSize: 12, letterSpacing: 0.5, marginBottom: 8 },
  countRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  countName:  { flex: 1, fontFamily: FFB, fontSize: 12, color: '#ccc', marginRight: 6 },
  countValue: { fontFamily: FFB, fontSize: 12 },

  recordGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  recordCard: {
    flexBasis: '48%', flexGrow: 1, backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, padding: 16, alignItems: 'center',
  },
  recordValue:  { fontFamily: FFB, fontSize: 22 },
  recordLabel:  { fontFamily: FFB, fontSize: 10, color: '#888', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 6 },
  recordHolder: { fontFamily: FFB, fontSize: 13, color: '#fff', marginTop: 4 },
});
