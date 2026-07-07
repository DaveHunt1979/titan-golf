import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';

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
  useDynamicColors(); // ensure theme context is available

  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab]             = useState<'games' | 'money'>('games');
  const [games, setGames]         = useState<SwindleGame[]>([]);
  const [moneyList, setMoneyList] = useState<MoneyEntry[]>([]);

  const load = useCallback(async () => {

    // Load all swindle games for this society
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
      const scores: any[] = g.swindle_scores ?? [];
      const entryCount = entries.length;
      const pot = entryCount * (g.entry_fee ?? 0);

      // Sum stableford pts per player
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

    // Build season money list from complete games
    const earningsMap: Record<string, MoneyEntry> = {};
    for (const g of built) {
      if (g.status !== 'complete') continue;
      g.topPlayers.forEach((p, rank) => {
        const id = Object.keys({}).find(() => false) ?? `${p.name}-${rank}`; // approximate key
        const key = p.name;
        if (!earningsMap[key]) earningsMap[key] = { player_id: key, name: p.name, games: 0, earnings: 0, wins: 0 };
        earningsMap[key].earnings += p.payout;
        earningsMap[key].games += 1;
        if (rank === 0) earningsMap[key].wins += 1;
      });
    }

    setMoneyList(
      Object.values(earningsMap)
        .sort((a, b) => b.earnings - a.earnings)
    );

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

  const statusColor = (s: string) =>
    s === 'complete' ? '#22c55e' : s === 'in_progress' ? colors.gold : '#6b7280';

  if (loading) return (
    <View style={s.container}>
      <StatusBar style="light" />
      <View style={s.center}><ActivityIndicator color="#a78bfa" size="large" /></View>
    </View>
  );

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={s.back}>‹ Admin</Text>
        </TouchableOpacity>
        <Text style={s.title}>Swindle Manager</Text>
        <View style={{ width: 60 }} />
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#a78bfa" />}
        showsVerticalScrollIndicator={false}
      >
        {tab === 'games' && (
          <>
            {games.length === 0 && (
              <Text style={s.empty}>No swindle games yet.</Text>
            )}
            {games.map(g => (
              <View key={g.id} style={s.gameCard}>
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
                    <TouchableOpacity
                      style={s.actionBtn}
                      onPress={() => markComplete(g.id)}
                      activeOpacity={0.8}
                    >
                      <Text style={s.actionBtnText}>Mark Complete</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.actionBtn, s.actionBtnDanger]}
                      onPress={() => deleteGame(g.id, g.name)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.actionBtnText, { color: '#ef4444' }]}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                )}
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

        <View style={{ height: 48 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back:  { fontSize: fonts.sm, fontWeight: '600', color: colors.textMuted },
  title: { fontSize: fonts.md, fontWeight: '800', color: colors.white },

  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1, borderBottomColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs,
  },
  tabItem: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.card,
  },
  tabItemActive: { borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,0.12)' },
  tabLabel:      { fontSize: fonts.sm, fontWeight: '700', color: colors.textMuted },
  tabLabelActive: { color: '#a78bfa' },

  scroll: { padding: spacing.md },
  empty:  { color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.xl, fontSize: fonts.sm },

  gameCard: {
    backgroundColor: colors.card, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.sm, overflow: 'hidden',
  },
  gameCardHeader: {
    flexDirection: 'row', alignItems: 'flex-start',
    padding: spacing.md, gap: spacing.sm,
  },
  gameName: { fontSize: fonts.md, fontWeight: '800', color: colors.white, marginBottom: 3 },
  gameMeta: { fontSize: fonts.xs, color: colors.textMuted },
  statusChip: {
    borderRadius: radius.sm, borderWidth: 1,
    paddingHorizontal: spacing.xs + 2, paddingVertical: 2,
  },
  statusText: { fontSize: 9, fontWeight: '800', letterSpacing: 1 },

  potRow: {
    flexDirection: 'row',
    borderTopWidth: 1, borderTopColor: colors.border,
    paddingVertical: spacing.sm,
  },
  potCell:  { flex: 1, alignItems: 'center' },
  potNum:   { fontSize: fonts.md, fontWeight: '800', color: '#a78bfa' },
  potLbl:   { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginTop: 2 },

  resultsBlock: {
    borderTopWidth: 1, borderTopColor: colors.border,
    padding: spacing.sm,
  },
  resultRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 6, gap: spacing.sm,
  },
  resultPos:    { width: 20, fontSize: fonts.sm, fontWeight: '800', color: colors.textMuted, textAlign: 'center' },
  resultName:   { flex: 1, fontSize: fonts.sm, fontWeight: '700', color: colors.white },
  resultPts:    { fontSize: fonts.sm, color: colors.textMuted, width: 50, textAlign: 'right' },
  resultPayout: { fontSize: fonts.sm, fontWeight: '800', color: '#a78bfa', width: 56, textAlign: 'right' },

  gameActions: {
    flexDirection: 'row', gap: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border,
    padding: spacing.sm,
  },
  actionBtn: {
    flex: 1, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, paddingVertical: spacing.xs + 2,
    alignItems: 'center',
  },
  actionBtnDanger: { borderColor: '#ef444455' },
  actionBtnText: { fontSize: fonts.sm, fontWeight: '700', color: colors.white },

  moneySubtitle: { fontSize: fonts.xs, color: colors.textMuted, marginBottom: spacing.md },
  moneyRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.xs, gap: spacing.sm,
  },
  moneyRowFirst: { borderColor: '#a78bfa55', backgroundColor: 'rgba(167,139,250,0.08)' },
  moneyPos:      { width: 24, fontSize: fonts.md, fontWeight: '800', color: colors.textMuted, textAlign: 'center' },
  moneyName:     { fontSize: fonts.md, fontWeight: '800', color: colors.white, marginBottom: 2 },
  moneyDetail:   { fontSize: fonts.xs, color: colors.textMuted },
  moneyEarnings: { fontSize: fonts.xl, fontWeight: '900', color: '#a78bfa' },
});
