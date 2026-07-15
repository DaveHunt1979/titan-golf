import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert, Platform, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';

const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const RED    = '#f87171';
const PURPLE = '#a78bfa';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

interface SwindleGame {
  id: string;
  name: string;
  game_date: string;
  course_name: string | null;
  entry_fee: number;
  currency: string;
  prize_split: number[];
  status: string;
  format: string;
  entryCount: number;
  pot: number;
  topPlayers: { name: string; pts: number; payout: number }[];
}

interface MoneyEntry {
  player_id: string;
  name: string;
  games: number;
  earnings: number;
  wins: number;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function SwindleAdminScreen() {
  const router = useRouter();
  useDynamicColors();

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab]               = useState<'games' | 'money'>('games');
  const [games, setGames]           = useState<SwindleGame[]>([]);
  const [moneyList, setMoneyList]   = useState<MoneyEntry[]>([]);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    const { data: gamesData } = await supabase
      .from('swindle_games')
      .select(`
        id, name, game_date, course_name, entry_fee, currency,
        prize_split, status, format,
        swindle_entries(player_id, players(display_name)),
        swindle_scores(player_id, stableford_pts)
      `)
      .order('game_date', { ascending: false });

    if (!gamesData) { setLoading(false); setRefreshing(false); return; }

    const built: SwindleGame[] = (gamesData as any[]).map(g => {
      const entries: any[] = g.swindle_entries ?? [];
      const scores: any[]  = g.swindle_scores ?? [];
      const entryCount = entries.length;
      const pot = entryCount * (g.entry_fee ?? 0);

      const totals: Record<string, { name: string; pts: number }> = {};
      for (const e of entries) {
        totals[e.player_id] = { name: e.players?.display_name ?? 'Unknown', pts: 0 };
      }
      for (const sc of scores) {
        if (totals[sc.player_id]) totals[sc.player_id].pts += sc.stableford_pts ?? 0;
      }

      const ranked = Object.entries(totals)
        .sort(([, a], [, b]) => b.pts - a.pts)
        .slice(0, 3);

      const split: number[] = g.prize_split ?? [50, 30, 20];
      const topPlayers = ranked.map(([, v], i) => ({
        name: v.name.split(' ')[0],
        pts: v.pts,
        payout: Math.round(pot * (split[i] ?? 0) / 100 * 100) / 100,
      }));

      return { ...g, entryCount, pot, topPlayers };
    });

    setGames(built);

    const earningsMap: Record<string, MoneyEntry> = {};
    for (const g of built) {
      if (g.status !== 'complete') continue;
      g.topPlayers.forEach((p, rank) => {
        const key = p.name;
        if (!earningsMap[key]) earningsMap[key] = { player_id: key, name: p.name, games: 0, earnings: 0, wins: 0 };
        earningsMap[key].earnings += p.payout;
        earningsMap[key].games += 1;
        if (rank === 0) earningsMap[key].wins += 1;
      });
    }

    setMoneyList(Object.values(earningsMap).sort((a, b) => b.earnings - a.earnings));
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function markComplete(gameId: string) {
    await supabase.from('swindle_games').update({ status: 'complete' }).eq('id', gameId);
    load();
  }

  async function deleteGame(gameId: string, name: string) {
    Alert.alert('Delete Game', `Delete "${name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await supabase.from('swindle_games').delete().eq('id', gameId);
          load();
        },
      },
    ]);
  }

  async function exportCSV() {
    setDownloading(true);
    try {
      // Fetch all hole scores
      const { data: allScores } = await supabase
        .from('swindle_scores')
        .select('game_id, player_id, hole_number, stableford_pts');

      // Fetch all entries with player names so we can resolve player_id -> display_name
      const { data: allEntries } = await supabase
        .from('swindle_entries')
        .select('game_id, player_id, players(display_name)');

      // Build player name lookup: player_id -> display_name
      const playerNames: Record<string, string> = {};
      for (const e of (allEntries ?? []) as any[]) {
        playerNames[e.player_id] = e.players?.display_name ?? e.player_id;
      }

      // Group scores: game_id -> player_id -> hole_number -> pts
      const scoreMap: Record<string, Record<string, Record<number, number>>> = {};
      for (const row of (allScores ?? []) as any[]) {
        if (!scoreMap[row.game_id]) scoreMap[row.game_id] = {};
        if (!scoreMap[row.game_id][row.player_id]) scoreMap[row.game_id][row.player_id] = {};
        scoreMap[row.game_id][row.player_id][row.hole_number] = row.stableford_pts ?? 0;
      }

      const lines: string[] = [];
      const exportDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      lines.push('TITAN GOLF - SWINDLE RESULTS');
      lines.push(`Exported: ${exportDate}`);
      lines.push('');

      for (const g of games) {
        lines.push(`=== ${g.name} - ${formatDate(g.game_date)}${g.course_name ? ` - ${g.course_name}` : ''} ===`);
        lines.push('Pos,Player,Front 9,Back 9,Total,Eagles,Birdies,Pars,Blobs,Entry Fee,Prize');

        const gamePlayers = scoreMap[g.id] ?? {};
        const playerScores: { name: string; front9: number; back9: number; total: number; eagles: number; birdies: number; pars: number; blobs: number }[] = [];

        for (const [playerId, holeMap] of Object.entries(gamePlayers)) {
          const name = playerNames[playerId] ?? playerId;
          let front9 = 0, back9 = 0, eagles = 0, birdies = 0, pars = 0, blobs = 0;
          for (let h = 1; h <= 18; h++) {
            const pts = holeMap[h] ?? 0;
            if (h <= 9) front9 += pts; else back9 += pts;
            if (pts >= 4) eagles++;
            else if (pts === 3) birdies++;
            else if (pts === 2) pars++;
            else if (pts === 0) blobs++;
          }
          playerScores.push({ name, front9, back9, total: front9 + back9, eagles, birdies, pars, blobs });
        }

        playerScores.sort((a, b) => b.total - a.total);

        const split: number[] = g.prize_split ?? [50, 30, 20];
        playerScores.forEach((p, i) => {
          const prize = Math.round(g.pot * (split[i] ?? 0) / 100 * 100) / 100;
          const entryFee = `${g.currency}${Number(g.entry_fee).toFixed(2)}`;
          const prizeStr = prize > 0 ? `${g.currency}${prize.toFixed(2)}` : '';
          lines.push(`${i + 1},${p.name},${p.front9},${p.back9},${p.total},${p.eagles},${p.birdies},${p.pars},${p.blobs},${entryFee},${prizeStr}`);
        });

        lines.push('');
      }

      // Determine currency from first game (fallback to £)
      const currency = games[0]?.currency ?? '£';
      lines.push('=== SEASON MONEY LIST ===');
      lines.push('Pos,Player,Total Winnings,Wins,Games');
      moneyList.forEach((m, i) => {
        lines.push(`${i + 1},${m.name},${currency}${m.earnings.toFixed(2)},${m.wins},${m.games}`);
      });

      const csv = lines.join('\n');
      const path = (FileSystem.documentDirectory ?? '') + 'swindle-results.csv';
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export Swindle Results' });
    } catch (e) {
      Alert.alert('Export failed', String(e));
    } finally {
      setDownloading(false);
    }
  }

  const statusColor = (s: string) =>
    s === 'complete' ? GREEN : s === 'in_progress' ? GOLD : '#6b7280';

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header — three-column */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={s.back}>‹ Admin</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.logo} resizeMode="contain" />
          <Text style={s.title}>SWINDLE</Text>
          <Text style={s.subtitle}>manager</Text>
        </View>
        <TouchableOpacity
          onPress={exportCSV}
          disabled={downloading}
          style={{ width: 70, alignItems: 'flex-end' }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="download-outline" size={22} color={PURPLE} />
          {downloading && <ActivityIndicator size="small" color={PURPLE} style={{ marginTop: 4 }} />}
        </TouchableOpacity>
      </View>

      {/* Tab bar */}
      <View style={s.tabBar}>
        {(['games', 'money'] as const).map(t => (
          <TouchableOpacity
            key={t}
            style={[s.tabItem, tab === t && s.tabItemActive]}
            onPress={() => setTab(t)}
            activeOpacity={0.7}
          >
            <Text style={[s.tabLabel, tab === t && s.tabLabelActive]}>
              {t === 'games' ? 'All Games' : 'Money List'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={PURPLE} />}
        showsVerticalScrollIndicator={false}
      >
        {tab === 'games' && (
          <>
            {games.length === 0 && (
              <Text style={s.empty}>No swindle games yet.</Text>
            )}
            {games.map(g => (
              <View key={g.id} style={s.gameCard}>
                {/* Purple left accent */}
                <View style={s.purpleAccent} />
                <View style={{ flex: 1 }}>
                  <View style={s.gameCardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.gameName}>{g.name}</Text>
                      <Text style={s.gameMeta}>{formatDate(g.game_date)}{g.course_name ? ` · ${g.course_name}` : ''}</Text>
                    </View>
                    <View style={[s.statusChip, { borderColor: statusColor(g.status) }]}>
                      <Text style={[s.statusText, { color: statusColor(g.status) }]}>{g.status.toUpperCase()}</Text>
                    </View>
                  </View>

                  <View style={s.potRow}>
                    <View style={s.potCell}>
                      <Text style={s.potNum}>{g.entryCount}</Text>
                      <Text style={s.potLbl}>ENTRIES</Text>
                    </View>
                    <View style={s.potCell}>
                      <Text style={s.potNum}>{g.currency}{g.pot.toFixed(2)}</Text>
                      <Text style={s.potLbl}>POT</Text>
                    </View>
                    <View style={s.potCell}>
                      <Text style={s.potNum}>{g.entry_fee}{g.currency}</Text>
                      <Text style={s.potLbl}>ENTRY</Text>
                    </View>
                    <View style={s.potCell}>
                      <Text style={s.potNum}>{(g.prize_split ?? []).join('/')}%</Text>
                      <Text style={s.potLbl}>SPLIT</Text>
                    </View>
                  </View>

                  {g.topPlayers.length > 0 && (
                    <View style={s.resultsBlock}>
                      {g.topPlayers.map((p, i) => (
                        <View key={i} style={s.resultRow}>
                          <Text style={s.resultPos}>{i + 1}</Text>
                          <Text style={s.resultName}>{p.name}</Text>
                          <Text style={s.resultPts}>{p.pts}pts</Text>
                          <Text style={s.resultPayout}>{g.currency}{p.payout.toFixed(2)}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {g.status !== 'complete' && (
                    <View style={s.gameActions}>
                      <TouchableOpacity style={s.actionBtn} onPress={() => markComplete(g.id)} activeOpacity={0.8}>
                        <Text style={s.actionBtnText}>Mark Complete</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.actionBtn, s.actionBtnDanger]}
                        onPress={() => deleteGame(g.id, g.name)}
                        activeOpacity={0.8}
                      >
                        <Text style={[s.actionBtnText, { color: RED }]}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </>
        )}

        {tab === 'money' && (
          <>
            <Text style={s.moneySubtitle}>Season earnings from completed swindles</Text>
            {moneyList.length === 0 && (
              <Text style={s.empty}>No completed games yet.</Text>
            )}
            {moneyList.map((m, i) => (
              <View key={m.player_id} style={[s.moneyRow, i === 0 && s.moneyRowFirst]}>
                <Text style={s.moneyPos}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.moneyName}>{m.name}</Text>
                  <Text style={s.moneyDetail}>{m.wins} win{m.wins !== 1 ? 's' : ''} · {m.games} game{m.games !== 1 ? 's' : ''}</Text>
                </View>
                <Text style={s.moneyEarnings}>£{m.earnings.toFixed(2)}</Text>
              </View>
            ))}
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* + FAB — create new swindle */}
      <TouchableOpacity
        style={s.fab}
        onPress={() => router.push('/(app)/swindle/create' as any)}
        activeOpacity={0.85}
      >
        <Text style={s.fabIcon}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  fab: {
    position: 'absolute', bottom: 32, right: 20,
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: PURPLE,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: PURPLE, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  fabIcon: { fontSize: 32, color: '#fff', lineHeight: 36 },

  header: {
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1c',
  },
  back: { fontSize: 15, fontFamily: FFB, color: GOLD, width: 70 },
  headerCenter: { alignItems: 'center', gap: 2 },
  logo: { width: 28, height: 28, marginBottom: 2 },
  title: { fontSize: 14, fontFamily: FFB, color: '#fff', letterSpacing: 1.5 },
  subtitle: { fontSize: 9, fontFamily: FFB, color: '#fff' },

  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
    paddingHorizontal: 16, paddingVertical: 10, gap: 8,
  },
  tabItem: {
    paddingHorizontal: 16, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: '#1c1c1c',
    backgroundColor: '#111',
  },
  tabItemActive: { borderColor: PURPLE, backgroundColor: 'rgba(167,139,250,0.12)' },
  tabLabel:      { fontSize: 13, fontFamily: FFB, color: '#fff' },
  tabLabelActive: { color: PURPLE },

  scroll: { padding: 16 },
  empty:  { fontFamily: FFB, color: '#fff', textAlign: 'center', paddingVertical: 40, fontSize: 13 },

  gameCard: {
    flexDirection: 'row',
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c',
    marginBottom: 12, overflow: 'hidden',
  },
  purpleAccent: { width: 4, backgroundColor: PURPLE },
  gameCardHeader: {
    flexDirection: 'row', alignItems: 'flex-start',
    padding: 16, gap: 10,
  },
  gameName: { fontSize: 15, fontFamily: FFB, color: '#fff', marginBottom: 3 },
  gameMeta: { fontSize: 11, fontFamily: FFB, color: '#fff' },
  statusChip: {
    borderRadius: 6, borderWidth: 1,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  statusText: { fontSize: 9, fontFamily: FFB, letterSpacing: 1 },

  potRow: {
    flexDirection: 'row',
    borderTopWidth: 1, borderTopColor: '#1c1c1c',
    paddingVertical: 10,
  },
  potCell: { flex: 1, alignItems: 'center' },
  potNum:  { fontSize: 14, fontFamily: FFB, color: PURPLE },
  potLbl:  { fontSize: 9, fontFamily: FFB, color: '#fff', letterSpacing: 1, marginTop: 2 },

  resultsBlock: {
    borderTopWidth: 1, borderTopColor: '#1c1c1c',
    padding: 10,
  },
  resultRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 6, gap: 10,
  },
  resultPos:    { width: 20, fontSize: 13, fontFamily: FFB, color: '#fff', textAlign: 'center' },
  resultName:   { flex: 1, fontSize: 13, fontFamily: FFB, color: '#fff' },
  resultPts:    { fontSize: 13, fontFamily: FFB, color: '#fff', width: 50, textAlign: 'right' },
  resultPayout: { fontSize: 13, fontFamily: FFB, color: PURPLE, width: 56, textAlign: 'right' },

  gameActions: {
    flexDirection: 'row', gap: 10,
    borderTopWidth: 1, borderTopColor: '#1c1c1c',
    padding: 10,
  },
  actionBtn: {
    flex: 1, borderRadius: 12, borderWidth: 1,
    borderColor: '#1c1c1c', paddingVertical: 8,
    alignItems: 'center', backgroundColor: '#111',
  },
  actionBtnDanger: { borderColor: '#f8717155' },
  actionBtnText: { fontSize: 13, fontFamily: FFB, color: '#fff' },

  moneySubtitle: { fontSize: 11, fontFamily: FFB, color: '#fff', marginBottom: 16 },
  moneyRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#111', borderRadius: 12,
    borderWidth: 1, borderColor: '#1c1c1c',
    padding: 16, marginBottom: 8, gap: 12,
  },
  moneyRowFirst: { borderColor: `${PURPLE}55`, backgroundColor: 'rgba(167,139,250,0.08)' },
  moneyPos:      { width: 24, fontSize: 15, fontFamily: FFB, color: '#fff', textAlign: 'center' },
  moneyName:     { fontSize: 15, fontFamily: FFB, color: '#fff', marginBottom: 2 },
  moneyDetail:   { fontSize: 11, fontFamily: FFB, color: '#fff' },
  moneyEarnings: { fontSize: 18, fontFamily: FFB, color: PURPLE },
});
