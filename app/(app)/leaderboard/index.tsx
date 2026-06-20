import { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Image,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { getStandings } from '../../../src/lib/scoring';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';
import { teamLogos } from '../../../src/lib/assets';
import type { Match, Team, Champion } from '../../../src/types';
import type { TeamStanding } from '../../../src/lib/scoring';

type Tab = 'standings' | 'kronos' | 'champions';

interface TeamWithStanding extends TeamStanding {
  name: string;
  accent_color: string;
}

export default function LeaderboardScreen() {
  const [tab, setTab] = useState<Tab>('standings');
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [champions, setChampions] = useState<Champion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    const [{ data: teamsData }, { data: matchesData }, { data: champsData }] = await Promise.all([
      supabase.from('teams').select('*').order('sort_order'),
      supabase.from('matches').select('*'),
      supabase.from('champions').select('*').order('year', { ascending: false }),
    ]);
    if (teamsData) setTeams(teamsData);
    if (matchesData) setMatches(matchesData);
    if (champsData) setChampions(champsData);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    load();
    const sub = supabase
      .channel('lb-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, load)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, []);

  const standings = getStandings(matches as any[]);
  const enriched: TeamWithStanding[] = standings.map(s => {
    const t = teams.find(t => t.id === s.teamId);
    return { ...s, name: t?.name ?? '—', accent_color: t?.accent_color ?? colors.textMuted };
  });

  const titanChamps = champions.filter(c => c.award_name === 'Titan Tour');
  const kronosChamps = champions.filter(c => c.award_name === 'Kronos Trophy');

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Text style={styles.title}>Leaderboard</Text>

        <View style={styles.tabs}>
          {(['standings', 'kronos', 'champions'] as Tab[]).map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.tab, tab === t && styles.tabActive]}
              onPress={() => setTab(t)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'standings' ? 'Teams' : t === 'kronos' ? 'Kronos' : 'Champions'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.gold} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />}
          showsVerticalScrollIndicator={false}
        >
          {tab === 'standings' && (
            <View>
              <View style={styles.tableHeader}>
                <Text style={[styles.cell, styles.cellTeam, styles.headerText]}>TEAM</Text>
                <Text style={[styles.cell, styles.headerText]}>P</Text>
                <Text style={[styles.cell, styles.headerText]}>W</Text>
                <Text style={[styles.cell, styles.headerText]}>H</Text>
                <Text style={[styles.cell, styles.headerText]}>L</Text>
                <Text style={[styles.cell, styles.cellPts, styles.headerText]}>PTS</Text>
              </View>
              {enriched.map((s, i) => (
                <View key={s.teamId} style={[styles.row, i === 0 && styles.rowFirst]}>
                  <View style={[styles.cell, styles.cellTeam, { flexDirection: 'row', alignItems: 'center', gap: spacing.xs }]}>
                    <Text style={styles.pos}>{i + 1}</Text>
                    {teamLogos[s.name]
                      ? <Image source={teamLogos[s.name]} style={styles.teamLogo} resizeMode="contain" />
                      : <View style={[styles.dot, { backgroundColor: s.accent_color }]} />
                    }
                    <Text style={styles.teamName}>{s.name}</Text>
                  </View>
                  <Text style={styles.cell}>{s.played}</Text>
                  <Text style={styles.cell}>{s.w}</Text>
                  <Text style={styles.cell}>{s.h}</Text>
                  <Text style={styles.cell}>{s.l}</Text>
                  <Text style={[styles.cell, styles.cellPts, styles.pts]}>{s.pts}</Text>
                </View>
              ))}
              {enriched.length === 0 && <EmptyState text="No matches played yet." />}
            </View>
          )}

          {tab === 'kronos' && (
            <EmptyState text="Kronos Trophy scores coming soon." sub="Individual Stableford totals will appear here once Day 1 begins." />
          )}

          {tab === 'champions' && (
            <View>
              {[2026, 2025].map(year => {
                const titan = titanChamps.find(c => c.year === year);
                const kronos = kronosChamps.find(c => c.year === year);
                if (!titan && !kronos) return null;
                return (
                  <View key={year} style={styles.champYear}>
                    <Text style={styles.champYearLabel}>{year}</Text>
                    {titan && (
                      <View style={styles.champCard}>
                        <Text style={styles.champAward}>Titan Tour Champion</Text>
                        <Text style={styles.champWinner}>{titan.winner_name}</Text>
                        {titan.detail && <Text style={styles.champDetail}>{titan.detail}</Text>}
                      </View>
                    )}
                    {kronos && (
                      <View style={styles.champCard}>
                        <Text style={styles.champAward}>Kronos Trophy</Text>
                        <Text style={styles.champWinner}>{kronos.winner_name}</Text>
                        {kronos.detail && <Text style={styles.champDetail}>{kronos.detail}</Text>}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function EmptyState({ text, sub }: { text: string; sub?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
      {sub && <Text style={styles.emptySub}>{sub}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
    paddingBottom: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: fonts.xxl, fontWeight: '800', color: colors.white, letterSpacing: 1, marginBottom: spacing.md },
  tabs: { flexDirection: 'row', gap: spacing.sm },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: colors.gold },
  tabText: { fontSize: fonts.sm, fontWeight: '600', color: colors.textMuted },
  tabTextActive: { color: colors.gold },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  tableHeader: { flexDirection: 'row', paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, marginBottom: spacing.xs },
  headerText: { fontSize: fonts.xs, color: colors.textMuted, fontWeight: '700', letterSpacing: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowFirst: { borderColor: colors.goldBorder, backgroundColor: colors.cardAlt },
  cell: { flex: 1, textAlign: 'center', fontSize: fonts.sm, color: colors.textSecondary, fontWeight: '500' },
  cellTeam: { flex: 4, textAlign: 'left' },
  cellPts: { flex: 1.5 },
  pos: { fontSize: fonts.sm, color: colors.textMuted, width: 18, textAlign: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  teamLogo: { width: 28, height: 28 },
  teamName: { fontSize: fonts.sm, fontWeight: '700', color: colors.white },
  pts: { fontSize: fonts.md, fontWeight: '800', color: colors.gold },
  champYear: { marginBottom: spacing.lg },
  champYearLabel: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 2, marginBottom: spacing.sm },
  champCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.goldBorder,
  },
  champAward: { fontSize: fonts.xs, color: colors.gold, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  champWinner: { fontSize: fonts.xl, fontWeight: '800', color: colors.white },
  champDetail: { fontSize: fonts.sm, color: colors.textSecondary, marginTop: 4 },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyText: { fontSize: fonts.lg, color: colors.textSecondary, fontWeight: '600', textAlign: 'center' },
  emptySub: { fontSize: fonts.sm, color: colors.textMuted, marginTop: spacing.xs, textAlign: 'center', paddingHorizontal: spacing.lg },
});
