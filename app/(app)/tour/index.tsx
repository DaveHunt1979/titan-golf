import { useEffect, useRef, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Image, RefreshControl, TextInput,
  KeyboardAvoidingView, Platform, Alert, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../../src/lib/supabase';
import { getStandings } from '../../../src/lib/scoring';
import { fonts, spacing, radius } from '../../../src/lib/theme';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { teamLogos } from '../../../src/lib/assets';
import type { Competition, CompetitionDay, Match, Team, Champion, Notification } from '../../../src/types';

const STORAGE_KEY = 'tour_joined_competition_id';
const SOCIETY_ID  = '00000000-0000-0000-0000-000000000001';

type TourTab = 'teams' | 'scores' | 'kronos' | 'honours' | 'info' | 'live' | 'instagram';

const TABS: { id: TourTab; label: string }[] = [
  { id: 'teams',     label: 'Teams' },
  { id: 'scores',    label: 'Scores' },
  { id: 'kronos',    label: 'Kronos' },
  { id: 'honours',   label: 'Honours' },
  { id: 'info',      label: 'Info Pack' },
  { id: 'live',      label: 'Live' },
  { id: 'instagram', label: '📷' },
];

// ── Info section types (mirrors feed/index) ──────────────────────────
export type SectionType = 'text' | 'schedule' | 'travel' | 'location' | 'contacts' | 'rules';
export interface ScheduleItem { time: string; label: string; note?: string; }
export interface TravelItem   { label: string; detail: string; }
export interface ContactItem  { name: string; role?: string; phone?: string; }
export interface TextSection     { id: string; type: 'text';     title: string; content: string; }
export interface ScheduleSection { id: string; type: 'schedule'; title: string; items: ScheduleItem[]; }
export interface TravelSection   { id: string; type: 'travel';   title: string; items: TravelItem[]; }
export interface LocationSection { id: string; type: 'location'; title: string; name: string; address?: string; phone?: string; notes?: string; }
export interface ContactsSection { id: string; type: 'contacts'; title: string; items: ContactItem[]; }
export interface RulesSection    { id: string; type: 'rules';    title: string; items: string[]; }
export type InfoSection = TextSection | ScheduleSection | TravelSection | LocationSection | ContactsSection | RulesSection;

const NOTIF_LABELS: Record<string, string> = {
  birdie: 'Birdie', eagle: 'Eagle', hole_in_one: 'Hole in One!',
  match_result: 'Match Result', draw: 'Draw Published',
  tournament_winner: 'Tournament Winner', kronos_champ: 'Kronos Champion',
  admin: 'Announcement',
};

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
  const [sections, setSections]         = useState<InfoSection[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [instagramUrl, setInstagramUrl] = useState<string | null>(null);

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

    const [{ data: comp }, { data: notifs }, { data: soc }] = await Promise.all([
      supabase.from('competitions').select('*').eq('status', 'active').limit(1).single(),
      supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('societies').select('instagram_url').eq('id', SOCIETY_ID).single(),
    ]);

    if (notifs) setNotifications(notifs);
    if (soc)    setInstagramUrl((soc as any).instagram_url ?? null);

    if (!comp) {
      setCompetition(null);
      setJoinedId(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setCompetition(comp as unknown as Competition);
    setSections(((comp as any).info_sections ?? []) as InfoSection[]);
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

      {/* Top tab bar — scrollable for 7 tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={{ flexDirection: 'row' }}
      >
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
      </ScrollView>

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

        {/* ── Info Pack ── */}
        {activeTab === 'info' && (
          <View>
            {competition && (
              <View style={infoStyles.heroBanner}>
                <Text style={infoStyles.heroLabel}>COMPETITION INFO PACK</Text>
                <Text style={infoStyles.heroName}>{competition.name}</Text>
              </View>
            )}
            {sections.length === 0 && (
              <View style={infoStyles.empty}>
                <Text style={infoStyles.emptyTitle}>No info pack yet</Text>
                <Text style={infoStyles.emptySub}>Society leaders can add the tour schedule, flights, accommodation and more.</Text>
                <TouchableOpacity style={infoStyles.emptyBtn} onPress={() => router.push('/(app)/admin/info' as any)} activeOpacity={0.8}>
                  <Text style={infoStyles.emptyBtnText}>Add Info Pack →</Text>
                </TouchableOpacity>
              </View>
            )}
            {sections.map(section => <SectionView key={section.id} section={section} />)}
          </View>
        )}

        {/* ── Live Feed ── */}
        {activeTab === 'live' && (
          <View>
            {notifications.length === 0 && (
              <View style={infoStyles.empty}>
                <Text style={infoStyles.emptyTitle}>Nothing yet</Text>
                <Text style={infoStyles.emptySub}>Birdies, match results and announcements will appear here.</Text>
              </View>
            )}
            {notifications.map(n => <TourFeedCard key={n.id} n={n} />)}
          </View>
        )}

      </ScrollView>

      {/* ── Instagram (full screen, outside scroll) ── */}
      {activeTab === 'instagram' && (
        <TourInstagramView
          url={instagramUrl}
          onGoAdmin={() => router.push('/(app)/admin' as any)}
        />
      )}
    </View>
  );
}

// ── Info section renderer ─────────────────────────────────────────────
function SectionView({ section }: { section: InfoSection }) {
  switch (section.type) {
    case 'text':     return <TextCard s={section} />;
    case 'schedule': return <ScheduleCard s={section} />;
    case 'travel':   return <TravelCard s={section} />;
    case 'location': return <LocationCard s={section} />;
    case 'contacts': return <ContactsCard s={section} />;
    case 'rules':    return <RulesCard s={section} />;
    default:         return null;
  }
}

function CardShell({ title, accent, children }: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <View style={[cardSt.shell, accent ? { borderLeftColor: accent, borderLeftWidth: 3 } : {}]}>
      <Text style={cardSt.title}>{title}</Text>
      {children}
    </View>
  );
}
function TextCard({ s }: { s: TextSection }) {
  return <CardShell title={s.title}><Text style={cardSt.body}>{s.content}</Text></CardShell>;
}
function ScheduleCard({ s }: { s: ScheduleSection }) {
  return (
    <CardShell title={s.title} accent='#d4af37'>
      {s.items.map((item, i) => (
        <View key={i} style={schedSt.row}>
          <View style={schedSt.timeCol}>
            <Text style={schedSt.time}>{item.time}</Text>
            {i < s.items.length - 1 && <View style={schedSt.line} />}
          </View>
          <View style={schedSt.content}>
            <Text style={schedSt.label}>{item.label}</Text>
            {item.note ? <Text style={schedSt.note}>{item.note}</Text> : null}
          </View>
        </View>
      ))}
    </CardShell>
  );
}
function TravelCard({ s }: { s: TravelSection }) {
  return (
    <CardShell title={s.title}>
      {s.items.map((item, i) => (
        <View key={i} style={travelSt.row}>
          <View style={travelSt.dot} />
          <View style={{ flex: 1 }}>
            <Text style={travelSt.label}>{item.label}</Text>
            <Text style={travelSt.detail}>{item.detail}</Text>
          </View>
        </View>
      ))}
    </CardShell>
  );
}
function LocationCard({ s }: { s: LocationSection }) {
  return (
    <CardShell title={s.title}>
      <Text style={locSt.name}>{s.name}</Text>
      {s.address ? <Text style={locSt.detail}>{s.address}</Text> : null}
      {s.phone ? <Text style={locSt.detail}><Text style={{ color: '#6b7280' }}>T  </Text>{s.phone}</Text> : null}
      {s.notes ? <Text style={[locSt.detail, { marginTop: 4, fontStyle: 'italic' }]}>{s.notes}</Text> : null}
    </CardShell>
  );
}
function ContactsCard({ s }: { s: ContactsSection }) {
  return (
    <CardShell title={s.title}>
      {s.items.map((item, i) => (
        <View key={i} style={[contactSt.row, i < s.items.length - 1 && contactSt.rowBorder]}>
          <View style={contactSt.avatar}><Text style={contactSt.initial}>{item.name[0] ?? '?'}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={contactSt.name}>{item.name}</Text>
            {item.role ? <Text style={contactSt.role}>{item.role}</Text> : null}
          </View>
          {item.phone ? <Text style={contactSt.phone}>{item.phone}</Text> : null}
        </View>
      ))}
    </CardShell>
  );
}
function RulesCard({ s }: { s: RulesSection }) {
  return (
    <CardShell title={s.title}>
      {s.items.map((rule, i) => (
        <View key={i} style={rulesSt.row}>
          <View style={rulesSt.numBadge}><Text style={rulesSt.num}>{i + 1}</Text></View>
          <Text style={rulesSt.text}>{rule}</Text>
        </View>
      ))}
    </CardShell>
  );
}

// ── Live feed card ────────────────────────────────────────────────────
function TourFeedCard({ n }: { n: Notification }) {
  const label = NOTIF_LABELS[n.type] ?? n.type;
  const payload = (n.payload as any) ?? {};
  const time = new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <View style={feedSt.container}>
      <View style={feedSt.dot} />
      <View style={{ flex: 1 }}>
        <View style={feedSt.top}>
          <Text style={feedSt.label}>{label}</Text>
          <Text style={feedSt.time}>{time}</Text>
        </View>
        {payload.message
          ? <Text style={feedSt.body}>{payload.message}</Text>
          : payload.player_name
          ? <Text style={feedSt.body}>{payload.player_name}{payload.hole ? ` · Hole ${payload.hole}` : ''}</Text>
          : null}
      </View>
    </View>
  );
}

// ── Instagram view ────────────────────────────────────────────────────
function extractHandle(url: string): string {
  const match = url.match(/instagram\.com\/([^/?#]+)/);
  return match ? match[1] : url.replace(/^@/, '');
}

function TourInstagramView({ url, onGoAdmin }: { url: string | null; onGoAdmin: () => void }) {
  if (!url) {
    return (
      <View style={igSt.centered}>
        <Text style={igSt.emptyTitle}>No Instagram connected</Text>
        <Text style={igSt.emptySub}>Society admins can link the Instagram page in Society Admin settings.</Text>
        <TouchableOpacity style={igSt.emptyBtn} onPress={onGoAdmin} activeOpacity={0.8}>
          <Text style={igSt.emptyBtnText}>Go to Society Admin →</Text>
        </TouchableOpacity>
      </View>
    );
  }
  const handle = extractHandle(url);
  async function openInApp() {
    const appUrl = `instagram://user?username=${handle}`;
    const canOpen = await Linking.canOpenURL(appUrl);
    Linking.openURL(canOpen ? appUrl : `https://www.instagram.com/${handle}/`);
  }
  return (
    <View style={[igSt.centered, { gap: 24 }]}>
      <View style={igSt.iconWrap}><Text style={igSt.iconText}>📷</Text></View>
      <View style={{ alignItems: 'center' }}>
        <Text style={igSt.handle}>@{handle}</Text>
        <Text style={igSt.sub}>Tap below to view on Instagram</Text>
      </View>
      <TouchableOpacity style={igSt.openBtn} onPress={openInApp} activeOpacity={0.85}>
        <Text style={igSt.openBtnText}>Open Instagram Profile</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => Linking.openURL(`https://www.instagram.com/${handle}/`)} activeOpacity={0.7}>
        <Text style={igSt.webLink}>Open in browser instead</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Info Pack / Live / Instagram styles ───────────────────────────────
const infoStyles = StyleSheet.create({
  heroBanner: { backgroundColor: '#1c1c1e', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)' },
  heroLabel:  { fontSize: 10, fontWeight: '800', color: '#d4af37', letterSpacing: 2, marginBottom: 4 },
  heroName:   { fontSize: 18, fontWeight: '800', color: '#ffffff' },
  empty:      { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#6b7280', marginBottom: 8 },
  emptySub:   { fontSize: 14, color: '#4b5563', textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  emptyBtn:   { backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)' },
  emptyBtnText: { fontSize: 14, fontWeight: '700', color: '#d4af37' },
});
const cardSt = StyleSheet.create({
  shell:  { backgroundColor: '#1c1c1e', borderRadius: 12, borderWidth: 1, borderColor: '#2c2c2e', padding: 16, marginBottom: 12 },
  title:  { fontSize: 10, fontWeight: '800', color: '#6b7280', letterSpacing: 2, marginBottom: 12, textTransform: 'uppercase' },
  body:   { fontSize: 14, color: '#9ca3af', lineHeight: 22 },
});
const schedSt = StyleSheet.create({
  row:     { flexDirection: 'row', marginBottom: 0 },
  timeCol: { width: 52, alignItems: 'flex-end', marginRight: 12 },
  time:    { fontSize: 14, fontWeight: '700', color: '#d4af37', lineHeight: 22 },
  line:    { width: 1, flex: 1, backgroundColor: 'rgba(212,175,55,0.2)', alignSelf: 'center', marginTop: 2, marginBottom: 2, minHeight: 20 },
  content: { flex: 1, paddingBottom: 12 },
  label:   { fontSize: 14, fontWeight: '600', color: '#ffffff', lineHeight: 22 },
  note:    { fontSize: 12, color: '#6b7280', marginTop: 1 },
});
const travelSt = StyleSheet.create({
  row:    { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  dot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: '#d4af37', marginTop: 6 },
  label:  { fontSize: 14, fontWeight: '700', color: '#ffffff', marginBottom: 2 },
  detail: { fontSize: 14, color: '#9ca3af' },
});
const locSt = StyleSheet.create({
  name:   { fontSize: 16, fontWeight: '700', color: '#ffffff', marginBottom: 6 },
  detail: { fontSize: 14, color: '#9ca3af', lineHeight: 20 },
});
const contactSt = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#2c2c2e' },
  avatar:    { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2c2c2e', alignItems: 'center', justifyContent: 'center' },
  initial:   { fontSize: 16, fontWeight: '800', color: '#d4af37' },
  name:      { fontSize: 14, fontWeight: '700', color: '#ffffff' },
  role:      { fontSize: 12, color: '#6b7280' },
  phone:     { fontSize: 12, color: '#9ca3af', fontWeight: '600' },
});
const rulesSt = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  numBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(212,175,55,0.1)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.2)', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  num:      { fontSize: 10, fontWeight: '800', color: '#d4af37' },
  text:     { flex: 1, fontSize: 14, color: '#9ca3af', lineHeight: 22 },
});
const feedSt = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#1c1c1e', borderRadius: 12, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: '#2c2c2e' },
  dot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: '#d4af37', marginTop: 5 },
  top:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label:     { fontSize: 14, fontWeight: '700', color: '#ffffff' },
  time:      { fontSize: 12, color: '#6b7280' },
  body:      { fontSize: 14, color: '#9ca3af' },
});
const igSt = StyleSheet.create({
  centered:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#9ca3af', marginBottom: 8, textAlign: 'center' },
  emptySub:   { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20, marginBottom: 20, paddingHorizontal: 16 },
  emptyBtn:   { backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)' },
  emptyBtnText: { fontSize: 14, fontWeight: '700', color: '#d4af37' },
  iconWrap:   { width: 96, height: 96, borderRadius: 28, backgroundColor: '#833AB4', alignItems: 'center', justifyContent: 'center' },
  iconText:   { fontSize: 44 },
  handle:     { fontSize: 20, fontWeight: '800', color: '#ffffff', marginBottom: 4 },
  sub:        { fontSize: 14, color: '#6b7280' },
  openBtn:    { backgroundColor: '#833AB4', borderRadius: 10, paddingVertical: 14, paddingHorizontal: 32 },
  openBtnText:{ fontSize: 16, fontWeight: '800', color: '#ffffff', letterSpacing: 0.5 },
  webLink:    { fontSize: 14, color: '#6b7280', textDecorationLine: 'underline' },
});
