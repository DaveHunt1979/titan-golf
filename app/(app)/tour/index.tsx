import { useEffect, useRef, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Image, RefreshControl, TextInput,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../../src/lib/supabase';
import { getStandings } from '../../../src/lib/scoring';
import { fonts, spacing, radius } from '../../../src/lib/theme';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { teamLogos } from '../../../src/lib/assets';
import type { Competition, CompetitionDay, Match, Team, Champion } from '../../../src/types';

const STORAGE_KEY = 'tour_joined_competition_id';
type TourTab = 'teams' | 'scores' | 'kronos' | 'honours';

const TABS: { id: TourTab; label: string }[] = [
  { id: 'teams',   label: 'Teams' },
  { id: 'scores',  label: 'Scores' },
  { id: 'kronos',  label: 'Kronos' },
  { id: 'honours', label: 'Honours' },
];

function luminance(hex: string): number {
  const c = hex.replace('#', '');
  if (c.length < 6) return 0;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function formatDate(s: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function TourScreen() {
  const colors = useDynamicColors();
  const { palette } = useSocietyTheme();

  const router = useRouter();
  const pinRef = useRef<TextInput>(null);

  const [competition, setCompetition] = useState<Competition | null>(null);
  const [joinedId, setJoinedId]       = useState<string | null>(null);
  const [days, setDays]               = useState<CompetitionDay[]>([]);
  const [matches, setMatches]         = useState<Match[]>([]);
  const [teams, setTeams]             = useState<Team[]>([]);
  const [players, setPlayers]         = useState<{ id: string; display_name: string }[]>([]);
  const [kronosRows, setKronosRows]   = useState<{ playerId: string; name: string; total: number; holes: number }[]>([]);
  const [champions, setChampions]     = useState<Champion[]>([]);
  const [myPlayerId, setMyPlayerId]   = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [activeTab, setActiveTab]     = useState<TourTab>('teams');
  const [pin, setPin]                 = useState('');
  const [verifying, setVerifying]     = useState(false);

  const styles = useMemo(() => {
    const isDark  = luminance(palette.accent) > 160;
    const aText   = isDark ? 'rgba(0,0,0,0.85)' : '#ffffff';
    const aMuted  = isDark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.55)';
    const aUnder  = isDark ? 'rgba(0,0,0,0.75)' : '#ffffff';
    const aSep    = 'rgba(0,0,0,0.15)';

    return StyleSheet.create({
      container: { flex: 1, backgroundColor: colors.bg },
      centered:  { flex: 1, alignItems: 'center', justifyContent: 'center' },

      // ── Branded header ──────────────────────────────────────────────
      accentHeader: {
        backgroundColor: palette.accent,
        paddingTop: Platform.OS === 'ios' ? 56 : 32,
        paddingHorizontal: spacing.lg,
        paddingBottom: 0,
      },
      headerTopRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: spacing.xs,
      },
      headerLabel:   { fontSize: fonts.xs, fontWeight: '800', letterSpacing: 2, color: aMuted },
      headerTitle:   { fontSize: 28, fontWeight: '900', letterSpacing: 0.2, color: aText, marginBottom: spacing.xs },
      liveBadge: {
        alignSelf: 'flex-start', marginBottom: spacing.md,
        backgroundColor: 'rgba(34,197,94,0.2)', paddingHorizontal: spacing.sm, paddingVertical: 2,
        borderRadius: radius.sm, borderWidth: 1, borderColor: 'rgba(34,197,94,0.5)',
      },
      liveBadgeText: { fontSize: fonts.xs, color: '#22c55e', fontWeight: '700', letterSpacing: 1 },
      leaveBtn:      { paddingVertical: 4, paddingLeft: spacing.sm },
      leaveBtnText:  { fontSize: fonts.xs, fontWeight: '700', letterSpacing: 1, color: aMuted },

      // ── Top tab bar (same accent bg) ────────────────────────────────
      tabBar: {
        backgroundColor: palette.accent,
        flexDirection: 'row',
        borderBottomWidth: 1, borderBottomColor: aSep,
      },
      tabItem: {
        paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2,
        alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent',
      },
      tabItemActive: { borderBottomColor: aUnder },
      tabLabel:      { fontSize: fonts.sm, fontWeight: '700', letterSpacing: 0.5, color: aMuted },
      tabLabelActive: { color: aText },

      scroll: { padding: spacing.md, paddingBottom: 48 },

      // ── Teams / standings ───────────────────────────────────────────
      tableHeader: {
        flexDirection: 'row', paddingVertical: spacing.xs,
        paddingHorizontal: spacing.sm, marginBottom: spacing.xs,
      },
      th:       { fontSize: fonts.xs, color: colors.textMuted, fontWeight: '700', letterSpacing: 1 },
      row: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
        borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.sm,
        marginBottom: spacing.xs, borderWidth: 1, borderColor: colors.border,
      },
      rowFirst:  { borderColor: colors.goldBorder, backgroundColor: colors.cardAlt },
      cell:      { flex: 1, textAlign: 'center', fontSize: fonts.sm, color: colors.textSecondary, fontWeight: '500' },
      cellTeam:  { flex: 4, textAlign: 'left' },
      cellPts:   { flex: 1.5 },
      pos:       { fontSize: fonts.sm, color: colors.textMuted, width: 18, textAlign: 'center' },
      dot:       { width: 8, height: 8, borderRadius: 4 },
      teamLogo:  { width: 28, height: 28 },
      teamName:  { fontSize: fonts.sm, fontWeight: '700', color: colors.white },
      pts:       { fontSize: fonts.md, fontWeight: '800', color: colors.gold },

      // ── Scores tab ──────────────────────────────────────────────────
      daySection: { marginBottom: spacing.lg },
      dayHeaderWrap: {
        flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
        marginBottom: spacing.sm,
      },
      dayHeaderLeft: { flex: 1 },
      dayNum: { fontSize: fonts.xs, fontWeight: '800', color: colors.gold, letterSpacing: 1.5, marginBottom: 2 },
      dayCourseName: { fontSize: fonts.md, fontWeight: '700', color: colors.white },
      dayDate: { fontSize: fonts.xs, color: colors.textMuted, marginTop: 1 },
      dayStatusBadge: {
        paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm,
        backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
        marginBottom: 2,
      },
      dayStatusBadgeLive: {
        backgroundColor: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.35)',
      },
      dayStatusText: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5 },
      dayStatusTextLive: { color: '#22c55e' },

      matchRow: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: colors.card, borderRadius: radius.md,
        paddingVertical: 10, paddingHorizontal: spacing.md,
        marginBottom: 6, borderWidth: 1, borderColor: colors.border,
      },
      matchRowLive: { borderColor: 'rgba(34,197,94,0.35)' },
      matchSide: { flex: 1 },
      matchSideHome: { alignItems: 'flex-start' },
      matchSideAway: { alignItems: 'flex-end' },
      matchSideTeam: { flexDirection: 'row', alignItems: 'center', gap: 5 },
      matchSideTeamAway: { flexDirection: 'row-reverse' },
      matchTeamDot: { width: 7, height: 7, borderRadius: 4 },
      matchName: { fontSize: fonts.sm, fontWeight: '700', color: colors.white },
      matchMid: { alignItems: 'center', paddingHorizontal: spacing.sm, minWidth: 52 },
      matchVs: { fontSize: fonts.xs, color: colors.textMuted, fontWeight: '700' },
      matchResult: { fontSize: fonts.xs, fontWeight: '800', color: colors.gold, textAlign: 'center' },
      matchLiveDot: {
        width: 7, height: 7, borderRadius: 4,
        backgroundColor: '#22c55e', marginBottom: 2,
      },
      matchChevron: { fontSize: 18, color: colors.textMuted, marginLeft: spacing.xs },

      // ── Kronos ──────────────────────────────────────────────────────
      kronosRow: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
        borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.sm,
        marginBottom: spacing.xs, borderWidth: 1, borderColor: colors.border,
      },
      kronosRowFirst: { borderColor: colors.goldBorder, backgroundColor: colors.cardAlt },

      // ── Honours / Champions ─────────────────────────────────────────
      champYear: { marginBottom: spacing.lg },
      champYearLabel: {
        fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted,
        letterSpacing: 2, marginBottom: spacing.sm,
      },
      champCard: {
        backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md,
        marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.goldBorder,
      },
      champAward:  { fontSize: fonts.xs, color: colors.gold, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
      champWinner: { fontSize: fonts.xl, fontWeight: '800', color: colors.white },
      champDetail: { fontSize: fonts.sm, color: colors.textSecondary, marginTop: 4 },

      noResults: { fontSize: fonts.sm, color: colors.textMuted, textAlign: 'center', padding: spacing.lg, lineHeight: 22 },

      // ── Play Your Match banner ──────────────────────────────────────
      playBanner: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: colors.gold, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
        borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.15)',
        gap: spacing.md,
      },
      playBannerLabel: { fontSize: 9, fontWeight: '800', color: 'rgba(0,0,0,0.5)', letterSpacing: 1.5, marginBottom: 2 },
      playBannerTitle: { fontSize: fonts.md, fontWeight: '800', color: colors.bg },
      playBannerBtn:   { backgroundColor: colors.bg, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
      playBannerBtnText: { fontSize: fonts.sm, fontWeight: '800', color: colors.gold },

      // ── PIN entry ───────────────────────────────────────────────────
      pinScroll: { alignItems: 'center', paddingTop: 80, paddingHorizontal: spacing.lg, paddingBottom: 60 },
      pinIcon:    { fontSize: 56, marginBottom: spacing.lg },
      pinHeading: { fontSize: fonts.xxl, fontWeight: '800', color: colors.white, marginBottom: spacing.xs, textAlign: 'center' },
      pinSub: {
        fontSize: fonts.sm, color: colors.textMuted, textAlign: 'center',
        lineHeight: 20, marginBottom: spacing.xl,
      },
      pinBoxes: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
      pinBox: {
        width: 56, height: 68, borderRadius: radius.md,
        backgroundColor: colors.card, borderWidth: 2, borderColor: colors.border,
        alignItems: 'center', justifyContent: 'center',
      },
      pinBoxActive: { borderColor: colors.gold },
      pinChar:      { fontSize: 32, fontWeight: '800', color: colors.white },
      pinOverlay:   { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0 },
      pinVerifying: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
      pinVerifyingText: { fontSize: fonts.sm, color: colors.textMuted },
      clearBtn:  { marginTop: spacing.md },
      clearText: { fontSize: fonts.sm, color: colors.textMuted, textDecorationLine: 'underline' },

      // ── No tournament ───────────────────────────────────────────────
      noTourWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
      noTourIcon:  { fontSize: 56, marginBottom: spacing.lg },
      noTourTitle: { fontSize: fonts.xl, fontWeight: '800', color: colors.textSecondary, marginBottom: spacing.xs, textAlign: 'center' },
      noTourSub:   { fontSize: fonts.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
    });
  }, [colors, palette.accent]);

  // ── Data loading ────────────────────────────────────────────────────

  async function loadTournamentData(compId: string) {
    const [
      { data: daysData },
      { data: matchesData },
      { data: teamsData },
      { data: holesData },
      { data: playersData },
      { data: kronosComps },
      { data: champsData },
    ] = await Promise.all([
      supabase.from('competition_days').select('*').eq('competition_id', compId).order('day_number'),
      supabase.from('matches').select('*').eq('competition_id', compId).order('match_number'),
      supabase.from('teams').select('*').order('sort_order'),
      supabase.from('match_holes').select('player_id,stableford_pts,match_id'),
      supabase.from('players').select('id,display_name'),
      supabase.from('competitions').select('id').eq('include_in_kronos', true),
      supabase.from('champions').select('*').order('year', { ascending: false }),
    ]);

    if (daysData)    setDays(daysData as CompetitionDay[]);
    if (matchesData) setMatches(matchesData as Match[]);
    if (teamsData)   setTeams(teamsData as Team[]);
    if (champsData)  setChampions(champsData as Champion[]);
    if (playersData) setPlayers(playersData as any[]);

    if (holesData && playersData) {
      const kronosIds = new Set((kronosComps ?? []).map((c: any) => c.id));
      const kronosMatchIds = new Set(
        (matchesData as any[] ?? [])
          .filter(m => kronosIds.has(m.competition_id))
          .map(m => m.id),
      );
      const totals: Record<string, { total: number; holes: number }> = {};
      (holesData as any[]).forEach(h => {
        if (h.stableford_pts != null && kronosMatchIds.has(h.match_id)) {
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
  }

  async function load() {
    // Resolve current player once
    if (!myPlayerId) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: p } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
        if (p) setMyPlayerId(p.id);
      }
    }

    const { data: comp } = await supabase
      .from('competitions').select('*').eq('status', 'active').limit(1).single();

    if (!comp) {
      setCompetition(null);
      setJoinedId(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setCompetition(comp as unknown as Competition);
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    setJoinedId(stored);
    if (stored === comp.id) await loadTournamentData(comp.id);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    load();
    const sub = supabase.channel('tour-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, load)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, []);

  useEffect(() => {
    if (pin.length === 4) verifyPin(pin);
  }, [pin]);

  async function verifyPin(p: string) {
    setVerifying(true);
    const { data } = await supabase
      .from('competitions').select('*').eq('pin', p).eq('status', 'active').limit(1).single();
    setVerifying(false);
    if (!data) {
      Alert.alert('Wrong PIN', 'No active tournament matches that PIN. Ask your admin for the correct code.', [
        { text: 'Try again', onPress: () => setPin('') },
      ]);
      return;
    }
    setCompetition(data as unknown as Competition);
    await AsyncStorage.setItem(STORAGE_KEY, data.id);
    setJoinedId(data.id);
    await loadTournamentData(data.id);
  }

  function leaveTournament() {
    Alert.alert('Leave Tournament', 'You will need to re-enter the PIN to rejoin.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive', onPress: async () => {
          await AsyncStorage.removeItem(STORAGE_KEY);
          setJoinedId(null);
          setPin('');
        },
      },
    ]);
  }

  // ── Derived data ────────────────────────────────────────────────────

  const standings = getStandings((matches as any[]).filter((m: any) => m.home_team_id && m.away_team_id));
  const enriched  = standings.map(s => {
    const t = teams.find(t => t.id === s.teamId);
    return { ...s, name: t?.name ?? '—', accent_color: t?.accent_color ?? colors.textMuted };
  });

  function matchNames(m: Match): { home: string; away: string } {
    if (m.home_team_id && m.away_team_id) {
      return {
        home: teams.find(t => t.id === m.home_team_id)?.name ?? '—',
        away: teams.find(t => t.id === m.away_team_id)?.name ?? '—',
      };
    }
    return {
      home: players.find(p => p.id === m.home_player_ids[0])?.display_name ?? '—',
      away: players.find(p => p.id === m.away_player_ids[0])?.display_name ?? '—',
    };
  }

  function matchColors(m: Match): { home: string; away: string } {
    return {
      home: teams.find(t => t.id === m.home_team_id)?.accent_color ?? colors.textMuted,
      away: teams.find(t => t.id === m.away_team_id)?.accent_color ?? colors.textMuted,
    };
  }

  const champYears = [...new Set(champions.map(c => c.year))].sort((a, b) => b - a);

  // My match in this tournament
  const myMatch = myPlayerId
    ? (matches as any[]).find(m =>
        (m.home_player_ids ?? []).includes(myPlayerId) ||
        (m.away_player_ids ?? []).includes(myPlayerId)
      ) ?? null
    : null;
  const myMatchActive = myMatch && (myMatch.status === 'upcoming' || myMatch.status === 'in_progress');

  // ── Loading ─────────────────────────────────────────────────────────
  if (loading) return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.centered}><ActivityIndicator color={colors.gold} size="large" /></View>
    </View>
  );

  // ── No active tournament ────────────────────────────────────────────
  if (!competition) return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.noTourWrap}>
        <Text style={styles.noTourIcon}>⛳</Text>
        <Text style={styles.noTourTitle}>No Tournament Running</Text>
        <Text style={styles.noTourSub}>
          Ask your admin to create and activate{'\n'}a competition to unlock this tab.
        </Text>
      </View>
    </View>
  );

  // ── PIN entry ───────────────────────────────────────────────────────
  if (joinedId !== competition.id) return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.pinScroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.pinIcon}>🏆</Text>
        <Text style={styles.pinHeading}>Enter Tournament PIN</Text>
        <Text style={styles.pinSub}>
          A tournament is live.{'\n'}Enter the 4-digit PIN your admin shared with you.
        </Text>

        <View style={{ position: 'relative', marginBottom: spacing.lg }}>
          <View style={styles.pinBoxes}>
            {Array.from({ length: 4 }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.pinBox,
                  pin.length === i && styles.pinBoxActive,
                  pin[i] && { borderColor: colors.gold },
                ]}
              >
                <Text style={styles.pinChar}>{pin[i] ?? ''}</Text>
              </View>
            ))}
          </View>
          <TextInput
            ref={pinRef}
            style={styles.pinOverlay}
            value={pin}
            onChangeText={v => setPin(v.replace(/\D/g, '').slice(0, 4))}
            keyboardType="number-pad"
            maxLength={4}
            autoFocus
            caretHidden
          />
        </View>

        {verifying && (
          <View style={styles.pinVerifying}>
            <ActivityIndicator color={colors.gold} size="small" />
            <Text style={styles.pinVerifyingText}>Checking PIN…</Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.clearBtn}
          onPress={() => setPin('')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.clearText}>{pin.length > 0 ? 'Clear' : ' '}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  // ── Tournament hub ──────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Branded header */}
      <View style={styles.accentHeader}>
        <View style={styles.headerTopRow}>
          <Text style={styles.headerLabel}>TOURNAMENT</Text>
          <TouchableOpacity style={styles.leaveBtn} onPress={leaveTournament} activeOpacity={0.7}>
            <Text style={styles.leaveBtnText}>LEAVE</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.headerTitle}>{competition.name}</Text>
        <View style={styles.liveBadge}>
          <Text style={styles.liveBadgeText}>● LIVE</Text>
        </View>
      </View>

      {/* Top tab bar */}
      <View style={styles.tabBar}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.id}
            style={[styles.tabItem, activeTab === t.id && styles.tabItemActive]}
            onPress={() => setActiveTab(t.id)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabLabel, activeTab === t.id && styles.tabLabelActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Play Your Match banner */}
      {myMatchActive && (
        <TouchableOpacity
          style={styles.playBanner}
          onPress={() => router.push(
            myMatch.status === 'in_progress'
              ? `/(app)/score/enter/${myMatch.id}` as any
              : `/(app)/score/preview/${myMatch.id}` as any
          )}
          activeOpacity={0.88}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.playBannerLabel}>YOUR MATCH</Text>
            <Text style={styles.playBannerTitle}>
              {(() => {
                const names = matchNames(myMatch as Match);
                return `${names.home} vs ${names.away}`;
              })()}
            </Text>
          </View>
          <View style={styles.playBannerBtn}>
            <Text style={styles.playBannerBtnText}>
              {myMatch.status === 'in_progress' ? '▶ Resume' : '⛳ Play'}
            </Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Content */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.gold}
          />
        }
        showsVerticalScrollIndicator={false}
        key={activeTab}
      >

        {/* ── Teams ── */}
        {activeTab === 'teams' && (
          <View>
            <View style={styles.tableHeader}>
              <Text style={[styles.cell, styles.cellTeam, styles.th]}>TEAM</Text>
              <Text style={[styles.cell, styles.th]}>P</Text>
              <Text style={[styles.cell, styles.th]}>W</Text>
              <Text style={[styles.cell, styles.th]}>H</Text>
              <Text style={[styles.cell, styles.th]}>L</Text>
              <Text style={[styles.cell, styles.cellPts, styles.th]}>PTS</Text>
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
            {enriched.length === 0 && (
              <Text style={styles.noResults}>No matches played yet.{'\n'}Results will appear here as games complete.</Text>
            )}
          </View>
        )}

        {/* ── Scores ── */}
        {activeTab === 'scores' && (
          <View>
            {days.length === 0 && (
              <Text style={styles.noResults}>No days scheduled yet.</Text>
            )}
            {days.map(day => {
              const dayMatches = matches.filter(m => m.day_id === day.id);
              const live     = dayMatches.filter(m => m.status === 'in_progress').length;
              const complete = dayMatches.filter(m => m.status === 'complete').length;
              const isLive   = live > 0;
              const isDone   = complete === dayMatches.length && dayMatches.length > 0;

              return (
                <View key={day.id} style={styles.daySection}>
                  <View style={styles.dayHeaderWrap}>
                    <View style={styles.dayHeaderLeft}>
                      <Text style={styles.dayNum}>DAY {day.day_number}</Text>
                      <Text style={styles.dayCourseName}>{day.course_name ?? 'TBC'}</Text>
                      {day.play_date && <Text style={styles.dayDate}>{formatDate(day.play_date)}</Text>}
                    </View>
                    <View style={[styles.dayStatusBadge, isLive && styles.dayStatusBadgeLive]}>
                      <Text style={[styles.dayStatusText, isLive && styles.dayStatusTextLive]}>
                        {isDone ? 'COMPLETE' : isLive ? 'LIVE' : 'UPCOMING'}
                      </Text>
                    </View>
                  </View>

                  {dayMatches.map(m => {
                    const { home, away } = matchNames(m);
                    const mc = matchColors(m);
                    const isTeamMatch = !!(m.home_team_id && m.away_team_id);
                    return (
                      <TouchableOpacity
                        key={m.id}
                        style={[styles.matchRow, m.status === 'in_progress' && styles.matchRowLive]}
                        onPress={() => router.push(`/(app)/score/${m.id}` as any)}
                        activeOpacity={0.75}
                      >
                        {/* Home side */}
                        <View style={[styles.matchSide, styles.matchSideHome]}>
                          <View style={styles.matchSideTeam}>
                            {isTeamMatch && <View style={[styles.matchTeamDot, { backgroundColor: mc.home }]} />}
                            <Text style={styles.matchName} numberOfLines={1}>{home}</Text>
                          </View>
                        </View>

                        {/* Middle: vs / result / live */}
                        <View style={styles.matchMid}>
                          {m.status === 'in_progress' && <View style={styles.matchLiveDot} />}
                          {m.status === 'complete' && m.result_str ? (
                            <Text style={styles.matchResult}>{m.result_str}</Text>
                          ) : (
                            <Text style={styles.matchVs}>vs</Text>
                          )}
                        </View>

                        {/* Away side */}
                        <View style={[styles.matchSide, styles.matchSideAway]}>
                          <View style={[styles.matchSideTeam, styles.matchSideTeamAway]}>
                            {isTeamMatch && <View style={[styles.matchTeamDot, { backgroundColor: mc.away }]} />}
                            <Text style={styles.matchName} numberOfLines={1}>{away}</Text>
                          </View>
                        </View>

                        <Text style={styles.matchChevron}>›</Text>
                      </TouchableOpacity>
                    );
                  })}

                  {dayMatches.length === 0 && (
                    <Text style={[styles.noResults, { paddingVertical: spacing.sm }]}>No matches yet.</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* ── Kronos ── */}
        {activeTab === 'kronos' && (
          <View>
            <View style={styles.tableHeader}>
              <Text style={[styles.cell, styles.cellTeam, styles.th]}>PLAYER</Text>
              <Text style={[styles.cell, styles.th]}>HLS</Text>
              <Text style={[styles.cell, styles.cellPts, styles.th]}>PTS</Text>
            </View>
            {kronosRows.map((r, i) => (
              <View key={r.playerId} style={[styles.row, i === 0 && styles.rowFirst]}>
                <View style={[styles.cell, styles.cellTeam, { flexDirection: 'row', alignItems: 'center', gap: spacing.xs }]}>
                  <Text style={styles.pos}>{i + 1}</Text>
                  <Text style={styles.teamName}>{r.name}</Text>
                </View>
                <Text style={styles.cell}>{r.holes}</Text>
                <Text style={[styles.cell, styles.cellPts, styles.pts]}>{r.total}</Text>
              </View>
            ))}
            {kronosRows.length === 0 && (
              <Text style={styles.noResults}>No Stableford scores yet.{'\n'}Individual totals appear here once rounds begin.</Text>
            )}
          </View>
        )}

        {/* ── Honours ── */}
        {activeTab === 'honours' && (
          <View>
            {champYears.map(year => {
              const yearChamps = champions.filter(c => c.year === year);
              return (
                <View key={year} style={styles.champYear}>
                  <Text style={styles.champYearLabel}>{year}</Text>
                  {yearChamps.map(c => (
                    <View key={c.id} style={styles.champCard}>
                      <Text style={styles.champAward}>{c.award_name.toUpperCase()}</Text>
                      <Text style={styles.champWinner}>{c.winner_name}</Text>
                      {c.detail && <Text style={styles.champDetail}>{c.detail}</Text>}
                    </View>
                  ))}
                </View>
              );
            })}
            {champYears.length === 0 && (
              <Text style={styles.noResults}>No champions recorded yet.</Text>
            )}
          </View>
        )}

      </ScrollView>
    </View>
  );
}
