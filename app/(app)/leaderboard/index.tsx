import { useEffect, useState, useMemo } from 'react';
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
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { getStandings } from '../../../src/lib/scoring';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { teamLogos } from '../../../src/lib/assets';
import type { Match, Team, Champion } from '../../../src/types';
import type { TeamStanding } from '../../../src/lib/scoring';

const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

type Tab = 'standings' | 'kronos' | 'champions';

interface TeamWithStanding extends TeamStanding {
  name: string;
  accent_color: string;
}

export default function LeaderboardScreen() {
  const colors = useDynamicColors();

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const styles = useMemo(() => StyleSheet.create({
    container:     { flex: 1, backgroundColor: colors.bg },
    centered:      { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },

    // ── Header ───────────────────────────────────────────────────────────
    header: {
      paddingTop: 56,
      paddingBottom: 0,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    headerSide:   { width: 40 },
    headerCenter: { alignItems: 'center', gap: 4 },
    headerLogo:   { width: 28, height: 28 },
    headerSub: {
      fontFamily: FFB,
      fontSize: 9,
      color: colors.gold,
      letterSpacing: 2.5,
    },

    // ── Tab bar ───────────────────────────────────────────────────────────
    tabs: {
      flexDirection: 'row',
      marginHorizontal: 16,
      marginTop: 4,
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    tabActive:     { borderBottomColor: colors.gold },
    tabText: {
      fontFamily: FFB,
      fontSize: 10,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      color: '#444',
    },
    tabTextActive: { color: colors.gold },

    // ── Scroll ────────────────────────────────────────────────────────────
    scroll: { padding: 16, paddingBottom: 48 },

    // ── Table header ──────────────────────────────────────────────────────
    tableHeader: {
      flexDirection: 'row',
      paddingVertical: 6,
      paddingHorizontal: 12,
      marginBottom: 6,
    },
    headerText: {
      fontFamily: FFB,
      fontSize: 9,
      color: '#fff',
      letterSpacing: 1.5,
    },

    // ── Standings row ─────────────────────────────────────────────────────
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#111',
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 12,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: '#1c1c1c',
    },
    rowFirst: { borderColor: `${colors.gold}30` },

    cell:     { flex: 1, textAlign: 'center', fontFamily: FFB, fontSize: 13, color: '#fff' },
    cellTeam: { flex: 4, textAlign: 'left' },
    cellPts:  { flex: 1.5 },

    pos: {
      fontFamily: FFB,
      fontSize: 16,
      color: '#333',
      width: 20,
      textAlign: 'center',
    },
    dot:      { width: 8, height: 8, borderRadius: 4 },
    teamLogo: { width: 28, height: 28 },
    teamName: { fontFamily: FFB, fontSize: 14, color: '#ffffff' },
    pts:      { fontFamily: FFB, fontSize: 16, color: colors.gold },

    teamCell: {
      flex: 4,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },

    // ── Champions ─────────────────────────────────────────────────────────
    champYear:      { marginBottom: 24 },
    champYearLabel: {
      fontFamily: FFB,
      fontSize: 10,
      color: '#fff',
      letterSpacing: 2,
      marginBottom: 10,
    },
    champCard: {
      backgroundColor: '#111',
      borderRadius: 14,
      padding: 16,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: colors.goldBorder,
    },
    champAward: {
      fontFamily: FFB,
      fontSize: 10,
      color: colors.gold,
      letterSpacing: 1.5,
      marginBottom: 4,
    },
    champWinner: {
      fontFamily: FFB,
      fontSize: 22,
      color: '#ffffff',
    },
    champDetail: {
      fontFamily: FFB,
      fontSize: 13,
      color: '#fff',
      marginTop: 4,
    },

    // ── Empty state ───────────────────────────────────────────────────────
    empty:     { alignItems: 'center', paddingVertical: 48 },
    emptyIcon: { marginBottom: 12 },
    emptyText: {
      fontFamily: FFB,
      fontSize: 16,
      color: '#fff',
      textAlign: 'center',
    },
    emptySub: {
      fontFamily: FFB,
      fontSize: 13,
      color: '#334455',
      marginTop: 6,
      textAlign: 'center',
      paddingHorizontal: 24,
    },
  }), [colors, fontsLoaded]);

  const [tab, setTab]           = useState<Tab>('standings');
  const [teams, setTeams]       = useState<Team[]>([]);
  const [matches, setMatches]   = useState<Match[]>([]);
  const [champions, setChampions] = useState<Champion[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [kronosRows, setKronosRows] = useState<
    { playerId: string; name: string; total: number; holes: number }[]
  >([]);

  async function load() {
    const [
      { data: teamsData },
      { data: matchesData },
      { data: champsData },
      { data: holesData },
      { data: playersData },
      { data: kronosComps },
    ] = await Promise.all([
      supabase.from('teams').select('*').order('sort_order'),
      supabase.from('matches').select('*'),
      supabase.from('champions').select('*').order('year', { ascending: false }),
      supabase.from('match_holes').select('player_id,stableford_pts,match_id'),
      supabase.from('players').select('id,display_name'),
      supabase.from('competitions').select('id').eq('include_in_kronos', true),
    ]);

    if (teamsData)   setTeams(teamsData);
    if (matchesData) setMatches(matchesData);
    if (champsData)  setChampions(champsData);

    if (holesData && playersData) {
      const kronosCompIds = new Set((kronosComps ?? []).map((c: any) => c.id));
      const titanMatchIds = new Set(
        (matchesData as any[])
          .filter(m => m.competition_id && kronosCompIds.has(m.competition_id))
          .map(m => m.id)
      );
      const totals: Record<string, { total: number; holes: number }> = {};
      (holesData as any[]).forEach(h => {
        if (h.stableford_pts != null && titanMatchIds.has(h.match_id)) {
          if (!totals[h.player_id]) totals[h.player_id] = { total: 0, holes: 0 };
          totals[h.player_id].total += h.stableford_pts;
          totals[h.player_id].holes += 1;
        }
      });
      const rows = Object.entries(totals)
        .map(([pid, v]) => {
          const p = (playersData as any[]).find(x => x.id === pid);
          return { playerId: pid, name: p?.display_name ?? '—', total: v.total, holes: v.holes };
        })
        .sort((a, b) => b.total - a.total);
      setKronosRows(rows);
    }

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

  const standings = getStandings(
    (matches as any[]).filter((m: any) => m.home_team_id && m.away_team_id)
  );
  const enriched: TeamWithStanding[] = standings.map(s => {
    const t = teams.find(t => t.id === s.teamId);
    return { ...s, name: t?.name ?? '—', accent_color: t?.accent_color ?? '#556677' };
  });

  const titanChamps  = champions.filter(c => c.award_name === 'Titan Tour');
  const kronosChamps = champions.filter(c => c.award_name === 'Kronos Trophy');

  if (loading || !fontsLoaded) {
    return (
      <View style={styles.centered}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.headerSide} />
          <View style={styles.headerCenter}>
            <Image source={titanLogo} style={styles.headerLogo} resizeMode="contain" />
            <Text style={styles.headerSub}>LEADERBOARD</Text>
          </View>
          <View style={styles.headerSide} />
        </View>

        {/* ── Tab bar ── */}
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

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.gold}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* ── Teams / Standings ── */}
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
                <View style={styles.teamCell}>
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

            {enriched.length === 0 && (
              <EmptyState
                text="No matches played yet."
                styles={styles}
              />
            )}
          </View>
        )}

        {/* ── Kronos ── */}
        {tab === 'kronos' && (
          <View>
            <View style={styles.tableHeader}>
              <Text style={[styles.cell, styles.cellTeam, styles.headerText]}>PLAYER</Text>
              <Text style={[styles.cell, styles.headerText]}>HLS</Text>
              <Text style={[styles.cell, styles.cellPts, styles.headerText]}>PTS</Text>
            </View>

            {kronosRows.map((r, i) => (
              <View key={r.playerId} style={[styles.row, i === 0 && styles.rowFirst]}>
                <View style={styles.teamCell}>
                  <Text style={styles.pos}>{i + 1}</Text>
                  <Text style={styles.teamName}>{r.name}</Text>
                </View>
                <Text style={styles.cell}>{r.holes}</Text>
                <Text style={[styles.cell, styles.cellPts, styles.pts]}>{r.total}</Text>
              </View>
            ))}

            {kronosRows.length === 0 && (
              <EmptyState
                text="No Stableford scores yet."
                sub="Individual totals will appear here once rounds begin."
                styles={styles}
              />
            )}
          </View>
        )}

        {/* ── Champions ── */}
        {tab === 'champions' && (
          <View>
            {[2026, 2025].map(year => {
              const titan  = titanChamps.find(c => c.year === year);
              const kronos = kronosChamps.find(c => c.year === year);
              if (!titan && !kronos) return null;
              return (
                <View key={year} style={styles.champYear}>
                  <Text style={styles.champYearLabel}>{year}</Text>

                  {titan && (
                    <View style={styles.champCard}>
                      <Text style={styles.champAward}>TITAN TOUR CHAMPION</Text>
                      <Text style={styles.champWinner}>{titan.winner_name}</Text>
                      {titan.detail && <Text style={styles.champDetail}>{titan.detail}</Text>}
                    </View>
                  )}

                  {kronos && (
                    <View style={styles.champCard}>
                      <Text style={styles.champAward}>KRONOS TROPHY</Text>
                      <Text style={styles.champWinner}>{kronos.winner_name}</Text>
                      {kronos.detail && <Text style={styles.champDetail}>{kronos.detail}</Text>}
                    </View>
                  )}
                </View>
              );
            })}

            {titanChamps.length === 0 && kronosChamps.length === 0 && (
              <EmptyState
                text="No champions yet."
                sub="Winners will be recorded here at the end of each season."
                styles={styles}
                icon="trophy-outline"
              />
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function EmptyState({
  text,
  sub,
  styles,
  icon = 'golf-outline',
}: {
  text: string;
  sub?: string;
  styles: any;
  icon?: string;
}) {
  return (
    <View style={styles.empty}>
      <Ionicons
        name={icon as any}
        size={32}
        color="#334455"
        style={styles.emptyIcon}
      />
      <Text style={styles.emptyText}>{text}</Text>
      {sub && <Text style={styles.emptySub}>{sub}</Text>}
    </View>
  );
}
