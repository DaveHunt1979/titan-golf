import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Image, RefreshControl, TextInput,
  KeyboardAvoidingView, Platform, Alert, Linking,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../../src/lib/supabase';
import { getStandings, getEffectiveWinner, calcSweepBonus } from '../../../src/lib/scoring';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { teamLogos, resolveAvatar } from '../../../src/lib/assets';
import { useChatUnread } from '../../../src/lib/useChatUnread';
import Leaderboard, { type LeaderboardRow } from '../../../src/components/Leaderboard';
import type { Competition, CompetitionDay, Match, Team, Champion, Notification } from '../../../src/types';

// ── TITAN constants ───────────────────────────────────────────────────
const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

const STORAGE_KEY = 'tour_joined_competition_id';

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

interface PrizeCat {
  id: string; name: string; hcp_min: number | null; hcp_max: number | null; display_order: number;
  prize_payouts: { position: number; prize_money: number }[];
}
interface IndivEntry {
  player_id: string; display_name: string; handicap_index: number | null;
  stableford_total: number; category_id: string | null; category_name: string | null;
  category_position: number | null; prize_money: number | null; is_overall_winner: boolean;
}

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

function ordinalLabel(n: number): string {
  if (n === 1) return '1st'; if (n === 2) return '2nd'; if (n === 3) return '3rd'; return `${n}th`;
}

function formatDate(s: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function TourScreen() {
  const dc = useDynamicColors();
  const { palette, societyId: SOCIETY_ID, localLogo, logoUrl } = useSocietyTheme();

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const router = useRouter();
  const pinRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  useFocusEffect(useCallback(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); }, []));

  const [competition, setCompetition] = useState<Competition | null>(null);
  const [joinedId, setJoinedId]       = useState<string | null>(null);
  const [days, setDays]               = useState<CompetitionDay[]>([]);
  const [matches, setMatches]         = useState<Match[]>([]);
  const [teams, setTeams]             = useState<Team[]>([]);
  const [players, setPlayers]         = useState<{ id: string; display_name: string; avatar_url?: string | null }[]>([]);
  const [kronosRows, setKronosRows] = useState<{
    playerId: string; name: string; total: number; holes: number;
    avatarUrl: string | null; teamName: string | null; teamAccentColor: string | null;
    teamLogoUrl: string | null; isCaptain: boolean; byDay: (number | null)[];
  }[]>([]);
  const [leaderboardTab, setLeaderboardTab] = useState<'group' | 'team' | 'kronos' | 'honours'>('group');
  const [champions, setChampions]     = useState<Champion[]>([]);
  const [myPlayerId, setMyPlayerId]   = useState<string | null>(null);
  const chatUnread = useChatUnread('tour', SOCIETY_ID, myPlayerId);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [selectedSection, setSelectedSection] = useState<'standings' | 'info' | 'social' | 'players' | null>(null);
  const [pin, setPin]                 = useState('');
  const [verifying, setVerifying]     = useState(false);
  const [sections, setSections]         = useState<InfoSection[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [instagramUrl, setInstagramUrl] = useState<string | null>(null);
  const [prizeCats, setPrizeCats]       = useState<PrizeCat[]>([]);
  const [indivBoard, setIndivBoard]     = useState<IndivEntry[]>([]);
  const [teamStableford, setTeamStableford] = useState<Record<string, number>>({});
  // Per-day team Stableford — feeds the Team tab's per-round (R1/R2/R3)
  // point columns, computed the same way as the cumulative total below,
  // just scoped to one day's holes at a time.
  const [teamStablefordByDay, setTeamStablefordByDay] = useState<Record<string, Record<string, number>>>({});
  // Bumped on every load() call; a run only commits its results if it's
  // still the latest one by the time its awaits resolve — stops a slow,
  // stale reload (e.g. triggered while a fresher one is still in flight)
  // from clobbering more current data with an older snapshot.
  const loadSeq = useRef(0);

  useEffect(() => { load(); }, []);

  // Scoped to this tournament's own matches — previously had no filter at
  // all, so ANY match update anywhere in the app (casual rounds, other
  // societies, everything) triggered a full reload here. That flood of
  // irrelevant reloads is what was intermittently bouncing spectators back
  // to the PIN screen and leaving standings mid-refresh, especially right
  // when a day's matches were finishing up together.
  useEffect(() => {
    if (!competition?.id) return;
    const sub = supabase.channel(`tour-live-${competition.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `competition_id=eq.${competition.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [competition?.id]);

  useEffect(() => {
    if (pin.length === 4) verifyPin(pin);
  }, [pin]);

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: dc.bg, alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" />
      <ActivityIndicator color={dc.gold} size="large" />
    </View>
  );

  // ── Data loading ────────────────────────────────────────────────────

  async function loadTournamentData(compId: string, includeInKronos: boolean, mySeq: number) {
    const [
      { data: daysData },
      { data: matchesData },
      { data: teamsData },
      { data: champsData },
      { data: cpData },
      { data: catsData },
    ] = await Promise.all([
      supabase.from('competition_days').select('*').eq('competition_id', compId).order('day_number'),
      supabase.from('matches').select('*').eq('competition_id', compId).order('match_number'),
      supabase.from('teams').select('*').eq('society_id', SOCIETY_ID ?? '').order('sort_order'),
      supabase.from('champions').select('*').order('year', { ascending: false }),
      supabase.from('competition_players')
        .select('player_id,team_id,handicap_index,is_captain,players(display_name,avatar_url)')
        .eq('competition_id', compId),
      supabase.from('prize_categories')
        .select('id,name,hcp_min,hcp_max,display_order,prize_payouts(position,prize_money)')
        .eq('competition_id', compId)
        .order('display_order'),
    ]);

    // A newer load() started while these were in flight — bail before
    // committing anything so this stale snapshot can't clobber fresher
    // data (this was very likely the "leaderboard wasn't populating" bug:
    // an earlier, slower reload landing its results after a newer one).
    if (mySeq !== loadSeq.current) return;

    if (daysData)    setDays(daysData as CompetitionDay[]);
    if (matchesData) setMatches(matchesData as Match[]);
    if (teamsData)   setTeams(teamsData as Team[]);
    if (champsData)  setChampions(champsData as Champion[]);
    const cats = (catsData ?? []) as unknown as PrizeCat[];
    setPrizeCats(cats);

    // match_holes/players were previously fetched with no scope at all (every
    // hole ever played, every player in the app) — scope to this
    // tournament's own matches/enrollment now that we know their IDs.
    const matchIds = (matchesData as any[] ?? []).map(m => m.id);
    const allPlayerIds = [...new Set([
      ...(matchesData as any[] ?? []).flatMap(m => [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])]),
      ...((cpData as any[] ?? []).map(cp => cp.player_id)),
    ])];
    const [{ data: holesData }, { data: playersData }] = await Promise.all([
      matchIds.length
        ? supabase.from('match_holes').select('player_id,stableford_pts,match_id,hole_number').in('match_id', matchIds)
        : Promise.resolve({ data: [] as any[] }),
      allPlayerIds.length
        ? supabase.from('players').select('id,display_name,avatar_url').in('id', allPlayerIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    if (playersData) setPlayers(playersData as any[]);

    // Kronos is this tournament's own individual championship — cumulative
    // Stableford across only this tournament's rounds, not a season-wide
    // Order of Merit across other tournaments. include_in_kronos is just an
    // on/off flag for whether this tournament counts toward Kronos at all.
    if (holesData && playersData && includeInKronos) {
      const matchDayMap: Record<string, string> = {};
      (matchesData as any[] ?? []).forEach(m => { matchDayMap[m.id] = m.day_id; });
      const kronosMatchIds = new Set(Object.keys(matchDayMap));
      const nameFor = (pid: string) => (playersData as any[]).find(x => x.id === pid)?.display_name ?? '—';
      const cpFor = (pid: string) => (cpData as any[] ?? []).find(cp => cp.player_id === pid);
      const sortedKronosDays = ((daysData as CompetitionDay[] | null) ?? []).slice().sort((a, b) => a.day_number - b.day_number);

      const totals: Record<string, { total: number; holes: number }> = {};
      const perDay: Record<string, Record<string, { total: number; holes: number }>> = {};
      (holesData as any[]).forEach(h => {
        if (h.stableford_pts == null || !kronosMatchIds.has(h.match_id)) return;
        if (!totals[h.player_id]) totals[h.player_id] = { total: 0, holes: 0 };
        totals[h.player_id].total += h.stableford_pts;
        totals[h.player_id].holes += 1;

        const dayId = matchDayMap[h.match_id];
        if (!perDay[dayId]) perDay[dayId] = {};
        if (!perDay[dayId][h.player_id]) perDay[dayId][h.player_id] = { total: 0, holes: 0 };
        perDay[dayId][h.player_id].total += h.stableford_pts;
        perDay[dayId][h.player_id].holes += 1;
      });

      const rows = Object.entries(totals)
        .map(([pid, v]) => {
          const cp = cpFor(pid);
          const team = cp?.team_id ? (teamsData as any[] ?? []).find(t => t.id === cp.team_id) : null;
          return {
            playerId: pid, name: nameFor(pid), total: v.total, holes: v.holes,
            avatarUrl: (playersData as any[]).find(x => x.id === pid)?.avatar_url ?? null,
            teamName: team?.name ?? null,
            teamAccentColor: team?.accent_color ?? null,
            teamLogoUrl: team?.logo_url ?? null,
            isCaptain: !!cp?.is_captain,
            byDay: sortedKronosDays.map(day => perDay[day.id]?.[pid]?.total ?? null),
          };
        })
        .sort((a, b) => b.total - a.total);
      setKronosRows(rows);
    } else {
      setKronosRows([]);
    }

    // Individual tournament leaderboard with prize positions
    if (holesData && cpData) {
      const thisMatchIds = new Set((matchesData as any[] ?? []).map((m: any) => m.id));
      // Tie-break ladder (spec): 1) best final round, 2) best back 9, 3) best
      // back 6, 4) best back 3, 5) 18th hole — all measured within the last
      // competition day only, each rung a narrower slice of that same round.
      const sortedDays = (daysData as CompetitionDay[] | null) ?? [];
      const finalDay = sortedDays[sortedDays.length - 1] ?? null;
      const finalDayMatchIds = new Set(
        (matchesData as any[] ?? []).filter(m => finalDay && m.day_id === finalDay.id).map((m: any) => m.id)
      );

      const totals: Record<string, number> = {};
      const perDayTotals: Record<string, Record<string, number>> = {};
      const matchDayMap2: Record<string, string> = {};
      (matchesData as any[] ?? []).forEach(m => { matchDayMap2[m.id] = m.day_id; });
      const finalRound: Record<string, number> = {};
      const back9:  Record<string, number> = {};
      const back6:  Record<string, number> = {};
      const back3:  Record<string, number> = {};
      const hole18: Record<string, number> = {};
      (holesData as any[]).forEach(h => {
        if (h.stableford_pts == null || !thisMatchIds.has(h.match_id)) return;
        totals[h.player_id] = (totals[h.player_id] ?? 0) + h.stableford_pts;
        const dId = matchDayMap2[h.match_id];
        if (dId) {
          if (!perDayTotals[dId]) perDayTotals[dId] = {};
          perDayTotals[dId][h.player_id] = (perDayTotals[dId][h.player_id] ?? 0) + h.stableford_pts;
        }
        if (finalDayMatchIds.has(h.match_id)) {
          finalRound[h.player_id] = (finalRound[h.player_id] ?? 0) + h.stableford_pts;
          if (h.hole_number >= 10) back9[h.player_id] = (back9[h.player_id] ?? 0) + h.stableford_pts;
          if (h.hole_number >= 13) back6[h.player_id] = (back6[h.player_id] ?? 0) + h.stableford_pts;
          if (h.hole_number >= 16) back3[h.player_id] = (back3[h.player_id] ?? 0) + h.stableford_pts;
          if (h.hole_number === 18) hole18[h.player_id] = h.stableford_pts;
        }
      });

      const cpMap: Record<string, { display_name: string; handicap_index: number | null }> = {};
      (cpData as any[]).forEach(cp => {
        cpMap[cp.player_id] = { display_name: cp.players?.display_name ?? '—', handicap_index: cp.handicap_index };
      });

      // Combined Stableford per team — feeds getStandings' tie-break rung 1.
      const teamTotals: Record<string, number> = {};
      (cpData as any[]).forEach(cp => {
        if (!cp.team_id) return;
        teamTotals[cp.team_id] = (teamTotals[cp.team_id] ?? 0) + (totals[cp.player_id] ?? 0);
      });
      setTeamStableford(teamTotals);

      const teamTotalsByDay: Record<string, Record<string, number>> = {};
      Object.entries(perDayTotals).forEach(([dId, playerTotals]) => {
        const teamTotalsThisDay: Record<string, number> = {};
        (cpData as any[]).forEach(cp => {
          if (!cp.team_id) return;
          teamTotalsThisDay[cp.team_id] = (teamTotalsThisDay[cp.team_id] ?? 0) + (playerTotals[cp.player_id] ?? 0);
        });
        teamTotalsByDay[dId] = teamTotalsThisDay;
      });
      setTeamStablefordByDay(teamTotalsByDay);

      const tieBreak = (a: string, b: string) =>
        (finalRound[b] ?? 0) - (finalRound[a] ?? 0)
        || (back9[b]  ?? 0) - (back9[a]  ?? 0)
        || (back6[b]  ?? 0) - (back6[a]  ?? 0)
        || (back3[b]  ?? 0) - (back3[a]  ?? 0)
        || (hole18[b] ?? 0) - (hole18[a] ?? 0);

      const sorted = Object.entries(totals)
        .map(([pid, total]) => ({
          player_id: pid,
          display_name: cpMap[pid]?.display_name ?? '—',
          handicap_index: cpMap[pid]?.handicap_index ?? null,
          stableford_total: total,
          category_id: null as string | null,
          category_name: null as string | null,
          category_position: null as number | null,
          prize_money: null as number | null,
          is_overall_winner: false,
        }))
        .sort((a, b) => (b.stableford_total - a.stableford_total) || tieBreak(a.player_id, b.player_id));

      // The Overall Kronos Winner can't also collect a division prize — that
      // prize rolls down to the next eligible player instead. Only meaningful
      // when this tournament actually runs a Kronos board at all.
      const overallWinnerId = includeInKronos && sorted.length > 0 ? sorted[0].player_id : null;
      if (overallWinnerId) sorted[0].is_overall_winner = true;

      // Assign each player to their prize category. A player with no
      // handicap on record shouldn't be silently defaulted into the highest
      // (or any) division — leave them uncategorized rather than guessing.
      const localCats = (catsData ?? []) as unknown as PrizeCat[];
      sorted.forEach(entry => {
        if (entry.handicap_index == null) return;
        const hcp = entry.handicap_index;
        const cat = localCats.find(c => {
          const okMin = c.hcp_min == null || hcp >= c.hcp_min;
          const okMax = c.hcp_max == null || hcp <= c.hcp_max;
          return okMin && okMax;
        });
        if (cat) { entry.category_id = cat.id; entry.category_name = cat.name; }
      });

      // Rank within each category — the overall winner is skipped so their
      // slot rolls down to the next player in that category.
      const catGroups: Record<string, typeof sorted> = {};
      sorted.forEach(e => {
        if (e.category_id) {
          if (!catGroups[e.category_id]) catGroups[e.category_id] = [];
          catGroups[e.category_id].push(e);
        }
      });
      Object.entries(catGroups).forEach(([catId, players]) => {
        const catDef = localCats.find(c => c.id === catId);
        let rank = 0;
        players
          .sort((a, b) => (b.stableford_total - a.stableford_total) || tieBreak(a.player_id, b.player_id))
          .forEach(p => {
            if (p.player_id === overallWinnerId) return;
            rank++;
            p.category_position = rank;
            const payout = catDef?.prize_payouts?.find(pp => pp.position === rank);
            p.prize_money = payout ? Number(payout.prize_money) : null;
          });
      });

      setIndivBoard(sorted);
    }
  }

  async function load() {
    const mySeq = ++loadSeq.current;

    // Resolve current player once
    if (!myPlayerId) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: p } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
        if (p) setMyPlayerId(p.id);
      }
    }

    // Scoped to this society and using maybeSingle (not single) — this used
    // to have no society_id filter at all and used .single(), so it hard-
    // failed the moment more than one society had an active tournament at
    // once, which reset `competition` to null and bounced every viewer
    // (players and spectators alike) back to the "no tournament running"
    // screen. That's very likely what "ended day one and kicked everyone
    // out" actually was — a burst of match-completion events at day's end
    // re-triggering this fragile lookup under load.
    //
    // Prefer whichever tournament the player already joined (stored PIN)
    // over "any active tournament in the society" — with two active
    // tournaments running at once (real scenario, not hypothetical: e.g.
    // one live test alongside a real one), the old .limit(1) lookup would
    // non-deterministically return either one on every reload, so a plain
    // pull-to-refresh could silently swap `competition` to a tournament the
    // player never joined and bounce them to "Enter PIN" — reported by Dave
    // 2026-08-19 as "pull to refresh kicks you out of the tournament."
    const alreadyJoinedId = await AsyncStorage.getItem(STORAGE_KEY);
    const [{ data: joinedComp }, { data: anyActiveComp }, { data: notifs }, { data: soc }] = await Promise.all([
      alreadyJoinedId
        ? supabase.from('competitions').select('*').eq('id', alreadyJoinedId).eq('status', 'active').maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('competitions').select('*').eq('status', 'active').eq('society_id', SOCIETY_ID ?? '').limit(1).maybeSingle(),
      supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('societies').select('instagram_url').eq('id', SOCIETY_ID).single(),
    ]);
    const comp = joinedComp ?? anyActiveComp;

    if (mySeq !== loadSeq.current) return; // a newer load() has since started — don't let this stale one commit

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
    setJoinedId(alreadyJoinedId);
    if (alreadyJoinedId === comp.id) await loadTournamentData(comp.id, !!(comp as any).include_in_kronos, mySeq);
    if (mySeq !== loadSeq.current) return;
    setLoading(false);
    setRefreshing(false);
  }

  async function verifyPin(p: string) {
    setVerifying(true);
    const { data } = await supabase
      .from('competitions').select('*').eq('pin', p).eq('status', 'active').limit(1).maybeSingle();
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
    await loadTournamentData(data.id, !!(data as any).include_in_kronos, ++loadSeq.current);
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

  // ── No active tournament ────────────────────────────────────────────
  // Must come before any derived data below, since that block dereferences
  // `competition` directly — this used to sit after it and crash the moment
  // the active tournament completed (competition briefly null).
  if (!competition) return (
    <View style={{ flex: 1, backgroundColor: dc.bg }}>
      <StatusBar style="light" />
      <View style={[st.titanHeader, { backgroundColor: dc.bg, borderBottomColor: dc.border }]}>
        <Image source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)} style={st.titanLogoImg} resizeMode="contain" />
        <Text style={st.titanSubtitle}>THE TOUR</Text>
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Ionicons name="trophy-outline" size={56} color={GOLD} style={{ marginBottom: 20 }} />
        <Text style={{ fontSize: 28, fontFamily: FFB, color: '#fff', marginBottom: 10, textAlign: 'center' }}>
          Coming Soon
        </Text>
        <Text style={{ fontSize: 14, fontFamily: FF, color: '#555', textAlign: 'center', lineHeight: 22 }}>
          No tournament is running right now.{'\n'}Check back when your next event is live.
        </Text>
      </View>
    </View>
  );

  // ── Derived data ────────────────────────────────────────────────────

  // Bonus points for sweeping every singles match on a day — shared with
  // admin/draw.tsx's final-day knockout seeding so they can't disagree.
  const singlesDayIds = new Set(days.filter(d => d.day_format === 'singles').map(d => d.id));
  const bonusPts = calcSweepBonus(matches as Match[], singlesDayIds, (competition as any).bonus_points ?? 2);

  const standings = getStandings(
    (matches as any[]).filter((m: any) => m.home_team_id && m.away_team_id),
    (competition as any).pts_win  ?? 1,
    (competition as any).pts_half ?? 0.5,
    teamStableford,
    bonusPts,
  );
  const enriched  = standings.map(s => {
    const t = teams.find(t => t.id === s.teamId);
    return { ...s, name: t?.name ?? '—', accent_color: t?.accent_color ?? '#555', logo_url: t?.logo_url ?? null };
  });
  const isTeamTournament = competition?.tournament_type === 'ryder_cup' || competition?.tournament_type === 'titan_tour';

  // Per-round columns for the Team leaderboard (R1/R2/R3/...) — same
  // getStandings()/calcSweepBonus() math as the cumulative total above,
  // just called once per day with that day's matches only, so each column
  // shows points earned that round rather than a running total.
  const sortedDays = [...days].sort((a, b) => a.day_number - b.day_number);
  const dayPtsByTeam: Record<string, number[]> = {};
  sortedDays.forEach(day => {
    const dayMatches = (matches as any[]).filter((m: any) => m.day_id === day.id && m.home_team_id && m.away_team_id);
    const daySinglesIds = day.day_format === 'singles' ? new Set([day.id]) : new Set<string>();
    const dayBonus = calcSweepBonus(dayMatches as Match[], daySinglesIds, (competition as any)?.bonus_points ?? 2);
    const dayStandings = getStandings(
      dayMatches,
      (competition as any)?.pts_win ?? 1,
      (competition as any)?.pts_half ?? 0.5,
      teamStablefordByDay[day.id] ?? {},
      dayBonus,
    );
    dayStandings.forEach(ds => {
      if (!dayPtsByTeam[ds.teamId]) dayPtsByTeam[ds.teamId] = [];
      dayPtsByTeam[ds.teamId][sortedDays.indexOf(day)] = ds.pts;
    });
  });

  const teamLeaderboardRows: LeaderboardRow[] = enriched.map(s => ({
    id: s.teamId,
    sortKey: s.pts,
    name: s.name,
    subtitle: `${s.w}W ${s.h}H ${s.l}L`,
    teamName: s.name,
    teamLogoUrl: s.logo_url,
    teamAccentColor: s.accent_color,
    columns: sortedDays.map((_, i) => dayPtsByTeam[s.teamId]?.[i] ?? '–'),
    totalDisplay: String(s.pts),
  }));
  const teamPointsKey = [
    { label: 'Match Win', value: `${(competition as any)?.pts_win ?? 1}pt${((competition as any)?.pts_win ?? 1) === 1 ? '' : 's'}` },
    { label: 'Match Half', value: `${(competition as any)?.pts_half ?? 0.5}pts` },
    { label: 'Clean Sweep bonus', value: `+${(competition as any)?.bonus_points ?? 2}pts` },
  ];

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
      home: teams.find(t => t.id === m.home_team_id)?.accent_color ?? '#555',
      away: teams.find(t => t.id === m.away_team_id)?.accent_color ?? '#555',
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

  // ── PIN entry ───────────────────────────────────────────────────────
  if (joinedId !== competition.id) return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: dc.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      {/* TITAN header */}
      <View style={[st.titanHeader, { backgroundColor: dc.bg, borderBottomColor: dc.border }]}>
        <Image source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)} style={st.titanLogoImg} resizeMode="contain" />
        <Text style={st.titanSubtitle}>THE TOUR</Text>
      </View>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 24, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        <Ionicons name="trophy-outline" size={56} color={GOLD} style={{ marginBottom: 24 }} />
        <Text style={{ fontSize: 26, fontFamily: FFB, color: '#fff', marginBottom: 8, textAlign: 'center' }}>
          Enter Tournament PIN
        </Text>
        <Text style={{ fontSize: 14, fontFamily: FFB, color: '#fff', textAlign: 'center', lineHeight: 20, marginBottom: 32 }}>
          A tournament is live.{'\n'}Enter the 4-digit PIN your admin shared with you.
        </Text>

        <View style={{ position: 'relative', marginBottom: 24 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <View
                key={i}
                style={[
                  st.pinBox,
                  pin.length === i && st.pinBoxActive,
                  pin[i] ? { borderColor: GOLD } : {},
                ]}
              >
                <Text style={{ fontSize: 32, fontFamily: FFB, color: '#fff' }}>{pin[i] ?? ''}</Text>
              </View>
            ))}
          </View>
          <TextInput
            ref={pinRef}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0 }}
            value={pin}
            onChangeText={v => setPin(v.replace(/\D/g, '').slice(0, 4))}
            keyboardType="number-pad"
            maxLength={4}
            autoFocus
            caretHidden
          />
        </View>

        {verifying && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <ActivityIndicator color={GOLD} size="small" />
            <Text style={{ fontSize: 14, fontFamily: FFB, color: '#fff' }}>Checking PIN…</Text>
          </View>
        )}

        <TouchableOpacity
          style={{ marginTop: 16 }}
          onPress={() => setPin('')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={{ fontSize: 14, fontFamily: FFB, color: '#fff', textDecorationLine: 'underline' }}>
            {pin.length > 0 ? 'Clear' : ' '}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  // ── Tournament hub ──────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: dc.bg }}>
      <StatusBar style="light" />

      {/* TITAN header — logo centred, leave button right */}
      <View style={[st.titanHeader, { backgroundColor: dc.bg, borderBottomColor: dc.border }]}>
        <View style={{ position: 'absolute', right: 16, bottom: 10 }}>
          <TouchableOpacity onPress={leaveTournament} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ fontSize: 10, fontFamily: FFB, color: dc.cardText, letterSpacing: 1.5 }}>LEAVE</Text>
          </TouchableOpacity>
        </View>
        <Image source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)} style={st.titanLogoImg} resizeMode="contain" />
        <Text style={st.titanSubtitle}>THE TOUR</Text>
      </View>

      {/* Tournament name + LIVE badge */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: dc.border }}>
        <Text style={{ fontSize: 22, fontFamily: FFB, color: dc.cardText, marginBottom: 6 }}>{competition.name}</Text>
        <View style={{
          alignSelf: 'flex-start',
          backgroundColor: 'rgba(74,222,128,0.1)',
          paddingHorizontal: 10, paddingVertical: 3,
          borderRadius: 6, borderWidth: 1, borderColor: 'rgba(74,222,128,0.35)',
        }}>
          <Text style={{ fontSize: 10, fontFamily: FFB, color: GREEN, letterSpacing: 1 }}>● LIVE</Text>
        </View>
      </View>

      {/* Section back button — shown when inside a section */}
      {selectedSection !== null && (
        <TouchableOpacity
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingHorizontal: 16, paddingVertical: 10,
            borderBottomWidth: 1, borderBottomColor: dc.border,
            backgroundColor: dc.bg,
          }}
          onPress={() => setSelectedSection(null)}
          activeOpacity={0.7}
        >
          <Text style={{ fontSize: 14, fontFamily: FFB, color: '#fff' }}>‹ Back</Text>
          <Text style={{ fontSize: 16, fontFamily: FFB, color: '#fff' }}>
            {selectedSection === 'standings' ? 'Leaderboard' : selectedSection === 'players' ? 'Players' : selectedSection === 'info' ? 'Info Pack' : 'Live & Social'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Play Your Match banner */}
      {myMatchActive && (
        <TouchableOpacity
          style={{
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: GOLD, paddingHorizontal: 16, paddingVertical: 10,
            borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.15)',
            gap: 12,
          }}
          onPress={() => router.push(
            myMatch.status === 'in_progress'
              ? ((myMatch as any).round_format === 'team_stableford' ? `/(app)/score/teamstableford/${myMatch.id}` : `/(app)/score/enter/${myMatch.id}`) as any
              : `/(app)/score/preview/${myMatch.id}` as any
          )}
          activeOpacity={0.88}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 9, fontFamily: FFB, color: 'rgba(0,0,0,0.5)', letterSpacing: 1.5, marginBottom: 2 }}>
              YOUR MATCH
            </Text>
            <Text style={{ fontSize: 15, fontFamily: FFB, color: '#000' }}>
              {(() => {
                const names = matchNames(myMatch as Match);
                return `${names.home} vs ${names.away}`;
              })()}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#000', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 }}>
            <Ionicons name={myMatch.status === 'in_progress' ? 'play' : 'golf-outline'} size={14} color={GOLD} />
            <Text style={{ fontSize: 13, fontFamily: FFB, color: GOLD }}>
              {myMatch.status === 'in_progress' ? 'Resume' : 'Play'}
            </Text>
          </View>
        </TouchableOpacity>
      )}

      {/* 2×2 section grid — shown when no section selected */}
      {selectedSection === null && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={GOLD}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <TouchableOpacity
              style={[st.sectionTile, { backgroundColor: dc.card, borderColor: dc.border }]}
              onPress={() => { setLeaderboardTab('group'); setSelectedSection('standings'); }}
              activeOpacity={0.82}
            >
              <View style={[st.sectionTileIconBox, { backgroundColor: dc.iconBoxBg, borderColor: dc.iconBoxBorder }]}>
                <Ionicons name="trophy-outline" size={22} color={dc.iconBoxIcon} />
              </View>
              <Text style={[st.sectionTileLabel, { color: dc.cardText }]} numberOfLines={1}>Leaderboard</Text>
              <Text style={[st.sectionTileSub, { color: dc.cardText }]} numberOfLines={2}>Group, team, Kronos & honours</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.sectionTile, { backgroundColor: dc.card, borderColor: dc.border }]} onPress={() => setSelectedSection('info')} activeOpacity={0.82}>
              <View style={[st.sectionTileIconBox, { backgroundColor: dc.iconBoxBg, borderColor: dc.iconBoxBorder }]}>
                <Ionicons name="document-text-outline" size={22} color={dc.iconBoxIcon} />
              </View>
              <Text style={[st.sectionTileLabel, { color: dc.cardText }]} numberOfLines={1}>Info Pack</Text>
              <Text style={[st.sectionTileSub, { color: dc.cardText }]} numberOfLines={2}>Schedule & travel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.sectionTile, { backgroundColor: dc.card, borderColor: dc.border }]} onPress={() => setSelectedSection('social')} activeOpacity={0.82}>
              <View style={[st.sectionTileIconBox, { backgroundColor: dc.iconBoxBg, borderColor: dc.iconBoxBorder }]}>
                <Ionicons name="images-outline" size={22} color={dc.iconBoxIcon} />
              </View>
              <Text style={[st.sectionTileLabel, { color: dc.cardText }]} numberOfLines={1}>Live & Social</Text>
              <Text style={[st.sectionTileSub, { color: dc.cardText }]} numberOfLines={2}>Feed & Instagram</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.sectionTile, { backgroundColor: dc.card, borderColor: dc.border }]} onPress={() => setSelectedSection('players')} activeOpacity={0.82}>
              <View style={[st.sectionTileIconBox, { backgroundColor: dc.iconBoxBg, borderColor: dc.iconBoxBorder }]}>
                <Ionicons name="people-outline" size={22} color={dc.iconBoxIcon} />
              </View>
              <Text style={[st.sectionTileLabel, { color: dc.cardText }]} numberOfLines={1}>Players</Text>
              <Text style={[st.sectionTileSub, { color: dc.cardText }]} numberOfLines={2}>Scores & prize positions</Text>
            </TouchableOpacity>
            {!!competition && (
              <TouchableOpacity
                style={[st.sectionTile, { backgroundColor: dc.card, borderColor: dc.border }]}
                onPress={() => router.push(`/(app)/news?competitionId=${competition.id}` as any)}
                activeOpacity={0.82}
              >
                <View style={[st.sectionTileIconBox, { backgroundColor: dc.iconBoxBg, borderColor: dc.iconBoxBorder }]}>
                  <Ionicons name="newspaper-outline" size={22} color={dc.iconBoxIcon} />
                </View>
                <Text style={[st.sectionTileLabel, { color: dc.cardText }]} numberOfLines={1}>Titan News</Text>
                <Text style={[st.sectionTileSub, { color: dc.cardText }]} numberOfLines={2}>AI reports & previews</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      )}

      {/* Content — shown when a section is selected */}
      <ScrollView
        style={{ flex: 1, display: selectedSection !== null && selectedSection !== 'social' ? 'flex' : 'none' }}
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={GOLD}
          />
        }
        showsVerticalScrollIndicator={false}
        key={selectedSection ?? 'grid'}
      >

        {/* ── Standings (teams + kronos + honours combined) ── */}
        {selectedSection === 'standings' && (
          <View>
            {/* Leaderboard tabs — Team/Kronos only appear when relevant */}
            <View style={st.lbTabRow}>
              <TouchableOpacity style={[st.lbTab, leaderboardTab === 'group' && st.lbTabOn]} onPress={() => setLeaderboardTab('group')} activeOpacity={0.8}>
                <Text style={[st.lbTabText, leaderboardTab === 'group' && st.lbTabTextOn]}>Group</Text>
              </TouchableOpacity>
              {isTeamTournament && (
                <TouchableOpacity style={[st.lbTab, leaderboardTab === 'team' && st.lbTabOn]} onPress={() => setLeaderboardTab('team')} activeOpacity={0.8}>
                  <Text style={[st.lbTabText, leaderboardTab === 'team' && st.lbTabTextOn]}>Team</Text>
                </TouchableOpacity>
              )}
              {competition?.include_in_kronos && (
                <TouchableOpacity style={[st.lbTab, leaderboardTab === 'kronos' && st.lbTabOn]} onPress={() => setLeaderboardTab('kronos')} activeOpacity={0.8}>
                  <Text style={[st.lbTabText, leaderboardTab === 'kronos' && st.lbTabTextOn]}>Kronos</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[st.lbTab, leaderboardTab === 'honours' && st.lbTabOn]} onPress={() => setLeaderboardTab('honours')} activeOpacity={0.8}>
                <Text style={[st.lbTabText, leaderboardTab === 'honours' && st.lbTabTextOn]}>Honours</Text>
              </TouchableOpacity>
            </View>

            {/* ── Group: day-by-day fixtures/results ── */}
            {leaderboardTab === 'group' && (
              <View>
                {days.length === 0 && (
                  <Text style={st.noResults}>No days scheduled yet.</Text>
                )}
                {days.map(day => {
                  const dayMatches = matches.filter(m => m.day_id === day.id);
                  const live     = dayMatches.filter(m => m.status === 'in_progress').length;
                  const complete = dayMatches.filter(m => m.status === 'complete').length;
                  const isLive   = live > 0;
                  const isDone   = complete === dayMatches.length && dayMatches.length > 0;

                  return (
                    <View key={day.id} style={{ marginBottom: 20 }}>
                      {/* Day header */}
                      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 10 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 10, fontFamily: FFB, color: dc.gold, letterSpacing: 1.5, marginBottom: 2 }}>
                            DAY {day.day_number}
                          </Text>
                          <Text style={{ fontSize: 15, fontFamily: FFB, color: dc.cardText }}>{day.course_name ?? 'TBC'}</Text>
                          {day.play_date && (
                            <Text style={{ fontSize: 11, fontFamily: FFB, color: dc.cardText, marginTop: 1 }}>
                              {formatDate(day.play_date)}
                            </Text>
                          )}
                        </View>
                        <View style={[
                          st.dayStatusBadge,
                          { backgroundColor: dc.card, borderColor: dc.border },
                          isLive && { backgroundColor: 'rgba(74,222,128,0.1)', borderColor: 'rgba(74,222,128,0.35)' },
                        ]}>
                          <Text style={[
                            { fontSize: 10, fontFamily: FFB, color: dc.cardText, letterSpacing: 0.5 },
                            isLive && { color: GREEN },
                          ]}>
                            {isDone ? 'COMPLETE' : isLive ? 'LIVE' : 'UPCOMING'}
                          </Text>
                        </View>
                      </View>

                      {dayMatches.map(m => {
                        const { home, away } = matchNames(m);
                        const mc = matchColors(m);
                        const isTeamMatch = !!(m.home_team_id && m.away_team_id);
                        // A true singles round has no opponent at all — showing
                        // "Player vs —" read as broken/half-finished (Dave,
                        // 2026-08-20: individual-tournament rows needed their
                        // own design, not the team head-to-head layout with a
                        // dash where the away side would be).
                        const isSingles = !isTeamMatch && (m.away_player_ids ?? []).length === 0;
                        const homePlayer = players.find(p => p.id === m.home_player_ids[0]);
                        const isMatchLive = m.status === 'in_progress';
                        const isComplete  = m.status === 'complete';
                        const isMyMatch = !!myPlayerId && ((m.home_player_ids ?? []).includes(myPlayerId) || (m.away_player_ids ?? []).includes(myPlayerId));
                        const matchDest = isMyMatch
                          ? ((m as any).round_format === 'team_stableford'
                              ? `/(app)/score/teamstableford/${m.id}`
                              : (m.away_player_ids ?? []).length === 0 && (m.home_player_ids ?? []).length === 1 ? `/(app)/score/solo/${m.id}` : `/(app)/score/enter/${m.id}`)
                          : `/(app)/spectate/${m.id}`;
                        const statusLabel = isComplete && m.result_str ? m.result_str : isMatchLive ? 'Live' : 'Upcoming';
                        return (
                          <TouchableOpacity
                            key={m.id}
                            style={[
                              st.matchRow,
                              { backgroundColor: dc.card, borderColor: dc.border },
                              isMatchLive && { borderColor: 'rgba(74,222,128,0.35)' },
                            ]}
                            onPress={() => router.push(matchDest as any)}
                            activeOpacity={0.75}
                          >
                            {isSingles ? (
                              <>
                                <Image
                                  source={resolveAvatar(homePlayer?.id ?? '', homePlayer?.avatar_url ?? null) ?? undefined}
                                  style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: dc.iconBoxBg }}
                                />
                                <Text style={[st.matchName, { color: dc.cardText, flex: 1, marginLeft: 10 }]} numberOfLines={1}>{home}</Text>
                                {isMatchLive && (
                                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: GREEN, marginRight: 6 }} />
                                )}
                                <Text style={{ fontSize: 12, fontFamily: FFB, color: isComplete ? dc.gold : dc.cardText }} numberOfLines={1}>
                                  {statusLabel}
                                </Text>
                              </>
                            ) : (
                              <>
                                {/* Home side */}
                                <View style={{ flex: 1, alignItems: 'flex-start' }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                    {isTeamMatch && (
                                      teamLogos[home]
                                        ? <Image source={teamLogos[home]} style={{ width: 22, height: 22 }} resizeMode="contain" />
                                        : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: mc.home }} />
                                    )}
                                    <Text style={[st.matchName, { color: dc.cardText }]} numberOfLines={1}>{home}</Text>
                                  </View>
                                </View>

                                {/* Middle: vs / result / live */}
                                <View style={{ alignItems: 'center', paddingHorizontal: 10, minWidth: 52 }}>
                                  {isMatchLive && (
                                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: GREEN, marginBottom: 2 }} />
                                  )}
                                  {isComplete && m.result_str ? (
                                    <Text style={{ fontSize: 11, fontFamily: FFB, color: dc.gold, textAlign: 'center' }}>
                                      {m.result_str}
                                    </Text>
                                  ) : (
                                    <Text style={{ fontSize: 10, fontFamily: FFB, color: dc.cardText }}>vs</Text>
                                  )}
                                </View>

                                {/* Away side */}
                                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                                    {isTeamMatch && (
                                      teamLogos[away]
                                        ? <Image source={teamLogos[away]} style={{ width: 22, height: 22 }} resizeMode="contain" />
                                        : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: mc.away }} />
                                    )}
                                    <Text style={[st.matchName, { color: dc.cardText }]} numberOfLines={1}>{away}</Text>
                                  </View>
                                </View>
                              </>
                            )}

                            <Ionicons name="chevron-forward" size={18} color={dc.cardText} style={{ marginLeft: 6 }} />
                          </TouchableOpacity>
                        );
                      })}

                      {dayMatches.length === 0 && (
                        <Text style={[st.noResults, { paddingVertical: 8 }]}>No matches yet.</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {/* ── Team: combined standings across every day ── */}
            {leaderboardTab === 'team' && (
              <Leaderboard
                rows={[...teamLeaderboardRows].sort((a, b) => b.sortKey - a.sortKey)}
                columnLabels={sortedDays.map((_, i) => `R${i + 1}`)}
                totalLabel="TOTAL"
                pointsKey={teamPointsKey}
                emptyMessage="No matches played yet. Results will appear here as games complete."
              />
            )}

            {/* ── Kronos: one row per player, D1-D4 columns + total ── */}
            {leaderboardTab === 'kronos' && (
              <Leaderboard
                title="KRONOS"
                rows={kronosRows.map(r => ({
                  id: r.playerId,
                  sortKey: r.total,
                  name: r.name,
                  subtitle: r.teamName ?? undefined,
                  playerId: r.playerId,
                  avatarUrl: r.avatarUrl,
                  isCaptain: r.isCaptain,
                  columns: r.byDay,
                  totalDisplay: String(r.total),
                }))}
                columnLabels={sortedDays.map((_, i) => `D${i + 1}`)}
                totalLabel="TOT"
                emptyMessage="No Stableford scores yet."
              />
            )}

            {/* ── Honours: past champions ── */}
            {leaderboardTab === 'honours' && (
              <View>
                {champYears.map(year => {
                  const yearChamps = champions.filter(c => c.year === year);
                  return (
                    <View key={year} style={{ marginBottom: 20 }}>
                      <Text style={{
                        fontSize: 10, fontFamily: FFB, color: dc.cardText,
                        letterSpacing: 2, marginBottom: 10,
                      }}>
                        {year}
                      </Text>
                      {yearChamps.map(c => (
                        <View key={c.id} style={[st.champCard, { backgroundColor: dc.card, borderColor: dc.border }]}>
                          <Text style={{ fontSize: 10, fontFamily: FFB, color: dc.gold, letterSpacing: 1, marginBottom: 4 }}>
                            {c.award_name.toUpperCase()}
                          </Text>
                          <Text style={{ fontSize: 18, fontFamily: FFB, color: dc.cardText }}>{c.winner_name}</Text>
                          {c.detail && (
                            <Text style={{ fontSize: 13, fontFamily: FFB, color: dc.cardText, marginTop: 4 }}>{c.detail}</Text>
                          )}
                        </View>
                      ))}
                    </View>
                  );
                })}
                {champYears.length === 0 && (
                  <Text style={st.noResults}>No champions recorded yet.</Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* ── Players (individual leaderboard + prize positions) ── */}
        {selectedSection === 'players' && (
          <View>
            <Text style={st.sectionHeader}>INDIVIDUAL LEADERBOARD</Text>
            <Text style={{ fontFamily: 'JUSTSans-ExBold', fontSize: 11, color: '#555', marginBottom: 12, lineHeight: 18 }}>
              Stableford points from all rounds. Prize positions update live as scores come in.
            </Text>
            <View>
              <View style={st.tableHeader}>
                <Text style={[st.cell, st.cellTeam, st.th]}>PLAYER</Text>
                <Text style={[st.cell, st.th]}>PTS</Text>
                <Text style={[st.cell, { flex: 2 }, st.th]}>PRIZE</Text>
              </View>
              {indivBoard.map((entry, i) => {
                const isMe = entry.player_id === myPlayerId;
                const hasPrize = entry.prize_money != null && entry.prize_money > 0;
                return (
                  <View
                    key={entry.player_id}
                    style={[
                      st.row,
                      { backgroundColor: dc.card, borderColor: dc.border },
                      isMe && { borderColor: 'rgba(212,175,55,0.5)', backgroundColor: 'rgba(212,175,55,0.05)' },
                    ]}
                  >
                    <View style={[st.cell, st.cellTeam, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                      <Text style={st.pos}>{i + 1}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[st.teamName, isMe && { color: GOLD }]} numberOfLines={1}>{entry.display_name}</Text>
                        {entry.is_overall_winner ? (
                          <Text style={{ fontFamily: 'JUSTSans-ExBold', fontSize: 10, color: GOLD, marginTop: 1 }}>
                            OVERALL KRONOS WINNER · division prize rolls down
                          </Text>
                        ) : entry.category_name && (
                          <Text style={{ fontFamily: 'JUSTSans-ExBold', fontSize: 10, color: '#555', marginTop: 1 }}>
                            {entry.category_name}{entry.category_position != null ? ` · ${ordinalLabel(entry.category_position)} in cat` : ''}
                          </Text>
                        )}
                      </View>
                    </View>
                    <Text style={[st.cell, st.pts]}>{entry.stableford_total}</Text>
                    <View style={[st.cell, { flex: 2, alignItems: 'flex-end', paddingRight: 4 }]}>
                      {hasPrize ? (
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ fontFamily: 'JUSTSans-ExBold', fontSize: 14, color: GOLD }}>
                            £{Number(entry.prize_money).toLocaleString('en-GB', { minimumFractionDigits: 0 })}
                          </Text>
                          <Text style={{ fontFamily: 'JUSTSans-ExBold', fontSize: 9, color: '#4ade80', letterSpacing: 0.5 }}>
                            IN THE MONEY
                          </Text>
                        </View>
                      ) : entry.category_position != null ? (
                        <Text style={{ fontFamily: 'JUSTSans-ExBold', fontSize: 11, color: '#555' }}>
                          {ordinalLabel(entry.category_position)}
                        </Text>
                      ) : (
                        <Text style={{ fontFamily: 'JUSTSans-ExBold', fontSize: 11, color: '#333' }}>—</Text>
                      )}
                    </View>
                  </View>
                );
              })}
              {indivBoard.length === 0 && (
                <Text style={st.noResults}>No Stableford scores yet.{'\n'}Scores will appear as players complete holes.</Text>
              )}
            </View>

            {prizeCats.length > 0 && (
              <>
                <Text style={[st.sectionHeader, { marginTop: 24 }]}>PRIZE CATEGORIES</Text>
                {prizeCats.map(cat => {
                  const inCat = indivBoard.filter(e => e.category_id === cat.id);
                  const sortedPayouts = [...cat.prize_payouts].sort((a, b) => a.position - b.position);
                  return (
                    <View key={cat.id} style={[st.champCard, { backgroundColor: dc.card, borderColor: dc.border, marginBottom: 10 }]}>
                      <Text style={{ fontFamily: 'JUSTSans-ExBold', fontSize: 10, color: dc.gold, letterSpacing: 1.5, marginBottom: 6 }}>
                        {cat.name.toUpperCase()}
                        {(cat.hcp_min != null || cat.hcp_max != null) && (
                          <Text style={{ color: '#555' }}>
                            {'  '}HCP {cat.hcp_min ?? '—'} – {cat.hcp_max ?? '—'}
                          </Text>
                        )}
                      </Text>
                      {sortedPayouts.map(pp => {
                        const leader = inCat[pp.position - 1];
                        return (
                          <View key={pp.position} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderTopWidth: pp.position > 1 ? 1 : 0, borderTopColor: '#1c1c1c' }}>
                            <Text style={{ fontFamily: 'JUSTSans-ExBold', fontSize: 12, color: '#555', width: 32 }}>
                              {pp.position === 1 ? '1st' : pp.position === 2 ? '2nd' : pp.position === 3 ? '3rd' : `${pp.position}th`}
                            </Text>
                            <Text style={{ flex: 1, fontFamily: 'JUSTSans-ExBold', fontSize: 14, color: dc.cardText }}>
                              {leader?.display_name ?? '—'}
                            </Text>
                            <Text style={{ fontFamily: 'JUSTSans-ExBold', fontSize: 14, color: GOLD }}>
                              £{Number(pp.prize_money).toLocaleString('en-GB', { minimumFractionDigits: 0 })}
                            </Text>
                          </View>
                        );
                      })}
                      {sortedPayouts.length === 0 && (
                        <Text style={{ fontFamily: 'JUSTSans-ExBold', fontSize: 12, color: '#555' }}>No prize amounts set</Text>
                      )}
                    </View>
                  );
                })}
              </>
            )}
          </View>
        )}

        {/* ── Info Pack ── */}
        {selectedSection === 'info' && (
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
                <Text style={infoStyles.emptySub}>
                  Society leaders can add the tour schedule, flights, accommodation and more.
                </Text>
                <TouchableOpacity style={infoStyles.emptyBtn} onPress={() => router.push('/(app)/admin/info' as any)} activeOpacity={0.8}>
                  <Text style={infoStyles.emptyBtnText}>Add Info Pack →</Text>
                </TouchableOpacity>
              </View>
            )}
            {sections.map(section => <SectionView key={section.id} section={section} />)}
          </View>
        )}

      </ScrollView>

      {/* ── Live & Social (outside scroll — Live feed + Instagram) ── */}
      {selectedSection === 'social' && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={GOLD}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity
            style={[st.chatBanner, { backgroundColor: dc.card, borderColor: dc.border }]}
            onPress={() => router.push('/(app)/chat/tour' as any)}
            activeOpacity={0.8}
          >
            <Ionicons name="chatbubbles-outline" size={22} color={dc.gold} />
            <View style={{ flex: 1 }}>
              <Text style={[st.chatBannerLabel, { color: dc.cardText }]}>Tournament Chat</Text>
              <Text style={[st.chatBannerSub, { color: dc.textSecondary }]}>Message everyone in the tour</Text>
            </View>
            {chatUnread > 0 && (
              <View style={st.chatBannerBadge}>
                <Text style={st.chatBannerBadgeText}>{chatUnread > 9 ? '9+' : chatUnread}</Text>
              </View>
            )}
            <Text style={{ fontSize: 20, color: dc.textSecondary, fontFamily: 'JUSTSans-ExBold', fontWeight: '300' }}>›</Text>
          </TouchableOpacity>

          <Text style={st.sectionHeader}>LIVE FEED</Text>
          {notifications.length === 0 && (
            <View style={infoStyles.empty}>
              <Text style={infoStyles.emptyTitle}>Nothing yet</Text>
              <Text style={infoStyles.emptySub}>
                Birdies, match results and announcements will appear here.
              </Text>
            </View>
          )}
          {notifications.map(n => <TourFeedCard key={n.id} n={n} />)}

          {instagramUrl && (
            <>
              <Text style={[st.sectionHeader, { marginTop: 20 }]}>INSTAGRAM</Text>
              <TourInstagramView
                url={instagramUrl}
                onGoAdmin={() => router.push('/(app)/admin' as any)}
              />
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ── Shared static styles ──────────────────────────────────────────────
const st = StyleSheet.create({
  // Leaderboard tabs
  lbTabRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  lbTab: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center', backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c' },
  lbTabOn: { backgroundColor: 'rgba(212,175,55,0.12)', borderColor: GOLD },
  lbTabText: { fontFamily: 'JUSTSans-ExBold', fontSize: 12, color: '#888' },
  lbTabTextOn: { color: GOLD },

  // TITAN header
  titanHeader: {
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingBottom: 10,
    backgroundColor: '#000',
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1c',
  },
  titanLogoImg: { width: 120, height: 36 },
  titanSubtitle: { fontSize: 9, fontFamily: 'JUSTSans-ExBold', color: '#fff', letterSpacing: 2, marginTop: 2 },

  // PIN
  pinBox: {
    width: 56, height: 68, borderRadius: 10,
    backgroundColor: '#111', borderWidth: 2, borderColor: '#1c1c1c',
    alignItems: 'center', justifyContent: 'center',
  },
  pinBoxActive: { borderColor: '#D4AF37' },

  // Section grid tiles
  sectionTile: {
    width: '48%', backgroundColor: '#111',
    borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c',
    padding: 16, paddingVertical: 22,
  },
  sectionTileIconBox: {
    width: 44, height: 44, borderRadius: 12,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  sectionTileLabel: { fontSize: 15, fontFamily: 'JUSTSans-ExBold', color: '#fff', marginBottom: 4, letterSpacing: -0.2 },
  sectionTileSub:   { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: '#fff', lineHeight: 17 },

  // Section headings
  sectionHeader: {
    fontSize: 10, fontFamily: 'JUSTSans-ExBold', letterSpacing: 1.5,
    color: '#fff', paddingVertical: 10, marginTop: 8,
  },

  chatBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 4,
  },
  chatBannerLabel: { fontSize: 14, fontFamily: 'JUSTSans-ExBold' },
  chatBannerSub:   { fontSize: 11, fontFamily: 'JUSTSans-ExBold', marginTop: 2 },
  chatBannerBadge: {
    minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: '#D4AF37', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  chatBannerBadgeText: { fontFamily: 'JUSTSans-ExBold', fontSize: 10, color: '#000' },

  // Table
  tableHeader: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8, marginBottom: 6 },
  th:       { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: '#fff', letterSpacing: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#111',
    borderRadius: 10, paddingVertical: 12, paddingHorizontal: 8,
    marginBottom: 6, borderWidth: 1, borderColor: '#1c1c1c',
  },
  rowFirst:  { borderColor: 'rgba(212,175,55,0.35)', backgroundColor: '#111' },
  cell:      { flex: 1, textAlign: 'center', fontSize: 13, fontFamily: 'JUSTSans-ExBold', color: '#fff' },
  cellTeam:  { flex: 4, textAlign: 'left' },
  cellPts:   { flex: 1.5 },
  pos:       { fontSize: 13, fontFamily: 'JUSTSans-ExBold', color: '#fff', width: 18, textAlign: 'center' },
  teamName:  { fontSize: 13, fontFamily: 'JUSTSans-ExBold', color: '#fff' },
  pts:       { fontSize: 15, fontFamily: 'JUSTSans-ExBold', color: '#D4AF37' },

  // Honours
  champCard: {
    backgroundColor: '#111', borderRadius: 10, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },

  // Day status badge
  dayStatusBadge: {
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6,
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c',
    marginBottom: 2,
  },

  // Match row
  matchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#111', borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 14,
    marginBottom: 6, borderWidth: 1, borderColor: '#1c1c1c',
  },
  matchName: { fontSize: 13, fontFamily: 'JUSTSans-ExBold', color: '#fff' },

  // No results
  noResults: { fontSize: 13, fontFamily: 'JUSTSans-ExBold', color: '#fff', textAlign: 'center', padding: 20, lineHeight: 22 },
});

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
    <CardShell title={s.title} accent='#D4AF37'>
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
      {s.phone ? <Text style={locSt.detail}><Text style={{ color: '#fff' }}>T  </Text>{s.phone}</Text> : null}
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
      <View style={igSt.iconWrap}><Ionicons name="logo-instagram" size={44} color="#fff" /></View>
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
  heroBanner: { backgroundColor: '#111', borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)' },
  heroLabel:  { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: '#D4AF37', letterSpacing: 2, marginBottom: 4 },
  heroName:   { fontSize: 18, fontFamily: 'JUSTSans-ExBold', color: '#ffffff' },
  empty:      { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 18, fontFamily: 'JUSTSans-ExBold', color: '#fff', marginBottom: 8 },
  emptySub:   { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#444', textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  emptyBtn:   { backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)' },
  emptyBtnText: { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#D4AF37' },
});
const cardSt = StyleSheet.create({
  shell:  { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 16, marginBottom: 12 },
  title:  { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: '#fff', letterSpacing: 2, marginBottom: 12, textTransform: 'uppercase' },
  body:   { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#fff', lineHeight: 22 },
});
const schedSt = StyleSheet.create({
  row:     { flexDirection: 'row', marginBottom: 0 },
  timeCol: { width: 52, alignItems: 'flex-end', marginRight: 12 },
  time:    { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#D4AF37', lineHeight: 22 },
  line:    { width: 1, flex: 1, backgroundColor: 'rgba(212,175,55,0.2)', alignSelf: 'center', marginTop: 2, marginBottom: 2, minHeight: 20 },
  content: { flex: 1, paddingBottom: 12 },
  label:   { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#ffffff', lineHeight: 22 },
  note:    { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: '#fff', marginTop: 1 },
});
const travelSt = StyleSheet.create({
  row:    { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  dot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D4AF37', marginTop: 6 },
  label:  { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#ffffff', marginBottom: 2 },
  detail: { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#fff' },
});
const locSt = StyleSheet.create({
  name:   { fontSize: 16, fontFamily: 'JUSTSans-ExBold', color: '#ffffff', marginBottom: 6 },
  detail: { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#fff', lineHeight: 20 },
});
const contactSt = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  avatar:    { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1c1c1c', alignItems: 'center', justifyContent: 'center' },
  initial:   { fontSize: 16, fontFamily: 'JUSTSans-ExBold', color: '#D4AF37' },
  name:      { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#ffffff' },
  role:      { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: '#fff' },
  phone:     { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: '#fff' },
});
const rulesSt = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  numBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(212,175,55,0.1)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.2)', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  num:      { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: '#D4AF37' },
  text:     { flex: 1, fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#fff', lineHeight: 22 },
});
const feedSt = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#111', borderRadius: 14, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: '#1c1c1c' },
  dot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D4AF37', marginTop: 5 },
  top:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label:     { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#ffffff' },
  time:      { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: '#fff' },
  body:      { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#fff' },
});
const igSt = StyleSheet.create({
  centered:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { fontSize: 18, fontFamily: 'JUSTSans-ExBold', color: '#fff', marginBottom: 8, textAlign: 'center' },
  emptySub:   { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#444', textAlign: 'center', lineHeight: 20, marginBottom: 20, paddingHorizontal: 16 },
  emptyBtn:   { backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)' },
  emptyBtnText: { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#D4AF37' },
  iconWrap:   { width: 96, height: 96, borderRadius: 28, backgroundColor: '#833AB4', alignItems: 'center', justifyContent: 'center' },
  iconText:   { fontSize: 44 },
  handle:     { fontSize: 20, fontFamily: 'JUSTSans-ExBold', color: '#ffffff', marginBottom: 4 },
  sub:        { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#fff' },
  openBtn:    { backgroundColor: '#833AB4', borderRadius: 10, paddingVertical: 14, paddingHorizontal: 32 },
  openBtnText:{ fontSize: 16, fontFamily: 'JUSTSans-ExBold', color: '#ffffff', letterSpacing: 0.5 },
  webLink:    { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#fff', textDecorationLine: 'underline' },
});
