import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Image, RefreshControl, TextInput,
  KeyboardAvoidingView, Platform, Alert, Linking, Modal,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, fetchAllRows } from '../../../src/lib/supabase';
import { getStandings, getEffectiveWinner, calcSweepBonus, individualScoreValue, formatVsPar, buildKronosTieBreakMaps, kronosTieBreakCompare, scoreVsPar, SCORE_COLORS } from '../../../src/lib/scoring';
import { individualBoardLabel, getFormatRules } from '../../../src/lib/tournamentFormat';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { teamLogos, resolveAvatar } from '../../../src/lib/assets';
import { useChatUnread } from '../../../src/lib/useChatUnread';
import Leaderboard, { type LeaderboardRow } from '../../../src/components/Leaderboard';
import TCardSheet from '../../../src/components/TCardSheet';
import type { EditablePlayer } from '../../../src/components/PlayerEditSheet';
import type { Competition, CompetitionDay, Match, Team, Champion, Notification } from '../../../src/types';
import {
  InfoPackView, hasInfoPackContent, emptyInfoPack,
  type InfoPack, type RoundInfo, type RosterPlayer,
} from '../feed/index';

// ── TITAN constants ───────────────────────────────────────────────────
const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

const STORAGE_KEY = 'tour_joined_competition_id';

interface PrizeCat {
  id: string; name: string; hcp_min: number | null; hcp_max: number | null; display_order: number;
  prize_payouts: { position: number; prize_money: number }[];
}
interface IndivEntry {
  player_id: string; display_name: string; handicap_index: number | null; avatar_url: string | null;
  current_tournament_handicap: number | null; total_tournament_cut: number;
  stableford_total: number; vs_par_total: number; category_id: string | null; category_name: string | null;
  category_position: number | null; prize_money: number | null; is_overall_winner: boolean;
}

const NOTIF_LABELS: Record<string, string> = {
  birdie: 'Birdie', eagle: 'Eagle', hole_in_one: 'Hole in One!',
  match_result: 'Match Result', draw: 'Draw Published',
  tournament_winner: 'Tournament Winner',
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
    playerId: string; name: string; total: number; holes: number; vsParTotal: number;
    avatarUrl: string | null; teamName: string | null; teamAccentColor: string | null;
    teamLogoUrl: string | null; isCaptain: boolean; byDay: (number | null)[];
  }[]>([]);
  const [leaderboardTab, setLeaderboardTab] = useState<'group' | 'team' | 'playoff' | 'kronos' | 'money' | 'honours'>('group');
  // Per-player, per-day hole-by-hole detail — feeds the scorecard modal
  // opened by tapping a Kronos row. Keyed by player_id then day_id so the
  // modal's round tabs (1/2/3/4) can pull one day's 18 holes at a time
  // instead of the whole tournament in one scroll.
  type ScorecardHole = { hole: number; par?: number; strokeIndex?: number | null; gross: number | null; pts: number | null };
  const [scorecardsByPlayer, setScorecardsByPlayer] = useState<Record<string, Record<string, ScorecardHole[]>>>({});
  const [scorecardPlayerId, setScorecardPlayerId] = useState<string | null>(null);
  const [scorecardDayIdx, setScorecardDayIdx] = useState(0);
  const [champions, setChampions]     = useState<Champion[]>([]);
  const [myPlayerId, setMyPlayerId]   = useState<string | null>(null);
  const [tcardMember, setTcardMember] = useState<EditablePlayer | null>(null);
  const chatUnread = useChatUnread('tour', SOCIETY_ID, myPlayerId);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [selectedSection, setSelectedSection] = useState<'standings' | 'info' | 'social' | 'players' | null>(null);
  const [pin, setPin]                 = useState('');
  const [verifying, setVerifying]     = useState(false);
  const [infoPack, setInfoPack]         = useState<InfoPack>(emptyInfoPack());
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

  async function loadTournamentData(compId: string, includeInKronos: boolean, mySeq: number, kronosOverallPrize: number | null = null) {
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
        .select('player_id,team_id,handicap_index,is_captain,current_tournament_handicap,total_tournament_cut,players(display_name,avatar_url)')
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
    // PostgREST caps an unbounded .select() at 1000 rows — a Titan Way
    // tournament's match_holes easily exceeds that (24+ players x up to 4
    // rounds x 18 holes), which was silently truncating Kronos, dropping
    // whichever days landed past row 1000 (surfaced 2026-09-01: a 30-match
    // sim tournament had 1,520 match_holes rows and Day 4 showed zero
    // Kronos points because its rows never made it into holesData).
    const [holesData, { data: playersData }] = await Promise.all([
      matchIds.length
        ? fetchAllRows<{ player_id: string; stableford_pts: number | null; gross_score: number | null; match_id: string; hole_number: number }>(
            (from, to) => supabase.from('match_holes').select('player_id,stableford_pts,gross_score,match_id,hole_number').in('match_id', matchIds).range(from, to)
          )
        : Promise.resolve([] as any[]),
      allPlayerIds.length
        ? supabase.from('players').select('id,display_name,avatar_url').in('id', allPlayerIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    if (playersData) setPlayers(playersData as any[]);

    // Medal (stroke play) tournaments rank ascending by gross-vs-par, never
    // by the Stableford points sum every other format uses (Rick's brief,
    // section 10) — only meaningful when every round in the tournament is
    // itself Medal; a tour that mixes Medal with 4BBB/Stableford rounds has
    // no well-defined single "higher is better" combination, so that mixed
    // case is left on the existing points-based ranking rather than guessed.
    const allDaysMedal = (daysData as CompetitionDay[] ?? []).length > 0
      && (daysData as CompetitionDay[]).every(d => d.day_format === 'medal');
    const courseNames = [...new Set((daysData as CompetitionDay[] ?? []).map(d => d.course_name).filter(Boolean))] as string[];
    // Was gated on allDaysMedal (only fetched for all-Medal tournaments) —
    // but the Kronos scorecard needs par/SI for every format, not just
    // Medal, so a Titan Way tournament (never Medal) was silently showing
    // blank Par/SI on every scorecard (found 2026-09-02 building that
    // feature). Fetch whenever there's a course to look up, regardless of
    // format.
    const { data: courseHolesData } = courseNames.length
      ? await supabase.from('course_holes').select('course_name,hole_number,par,stroke_index').in('course_name', courseNames)
      : { data: [] as any[] };
    const holeInfoByCourseHole = new Map<string, Map<number, { par: number; strokeIndex: number | null }>>();
    (courseHolesData ?? []).forEach((h: any) => {
      if (!holeInfoByCourseHole.has(h.course_name)) holeInfoByCourseHole.set(h.course_name, new Map());
      holeInfoByCourseHole.get(h.course_name)!.set(h.hole_number, { par: h.par, strokeIndex: h.stroke_index ?? null });
    });
    const dayCourseByMatch: Record<string, string | null> = {};
    (matchesData as any[] ?? []).forEach(m => {
      const day = (daysData as CompetitionDay[] ?? []).find(d => d.id === m.day_id);
      dayCourseByMatch[m.id] = day?.course_name ?? null;
    });
    const holeInfoForHole = (matchId: string, holeNumber: number): { par: number; strokeIndex: number | null } | undefined => {
      const courseName = dayCourseByMatch[matchId];
      return courseName ? holeInfoByCourseHole.get(courseName)?.get(holeNumber) : undefined;
    };
    const parForHole = (matchId: string, holeNumber: number): number | undefined => holeInfoForHole(matchId, holeNumber)?.par;

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
      // Medal tournaments still accumulate stableford_pts (side-calculated
      // purely for Kronos purposes — see score/enter's needsStablefordPts),
      // but the number that actually decides a medal round is gross-vs-par.
      // Track both so this board can rank the same way the Players/Individual
      // board does — otherwise the two screens can crown two different
      // "overall winners" for the same trophy (Rick's brief, section 13).
      const vsParTotals: Record<string, number> = {};
      (holesData as any[]).forEach(h => {
        if (!kronosMatchIds.has(h.match_id)) return;
        if (allDaysMedal && h.gross_score != null) {
          const par = parForHole(h.match_id, h.hole_number);
          if (par != null) vsParTotals[h.player_id] = (vsParTotals[h.player_id] ?? 0) + (h.gross_score - par);
        }
        if (h.stableford_pts == null) return;
        if (!totals[h.player_id]) totals[h.player_id] = { total: 0, holes: 0 };
        totals[h.player_id].total += h.stableford_pts;
        totals[h.player_id].holes += 1;

        const dayId = matchDayMap[h.match_id];
        if (!perDay[dayId]) perDay[dayId] = {};
        if (!perDay[dayId][h.player_id]) perDay[dayId][h.player_id] = { total: 0, holes: 0 };
        perDay[dayId][h.player_id].total += h.stableford_pts;
        perDay[dayId][h.player_id].holes += 1;
      });

      const kronosPids = new Set([...Object.keys(totals), ...(allDaysMedal ? Object.keys(vsParTotals) : [])]);
      const rows = Array.from(kronosPids)
        .map(pid => {
          const cp = cpFor(pid);
          const team = cp?.team_id ? (teamsData as any[] ?? []).find(t => t.id === cp.team_id) : null;
          const v = totals[pid] ?? { total: 0, holes: 0 };
          return {
            playerId: pid, name: nameFor(pid), total: v.total, holes: v.holes,
            vsParTotal: vsParTotals[pid] ?? 0,
            avatarUrl: (playersData as any[]).find(x => x.id === pid)?.avatar_url ?? null,
            teamName: team?.name ?? null,
            teamAccentColor: team?.accent_color ?? null,
            teamLogoUrl: team?.logo_url ?? null,
            isCaptain: !!cp?.is_captain,
            byDay: sortedKronosDays.map(day => perDay[day.id]?.[pid]?.total ?? null),
          };
        })
        .sort((a, b) =>
          individualScoreValue(allDaysMedal ? 'medal' : 'stableford', b.total, b.vsParTotal)
          - individualScoreValue(allDaysMedal ? 'medal' : 'stableford', a.total, a.vsParTotal)
        );
      setKronosRows(rows);

      const cards: Record<string, Record<string, ScorecardHole[]>> = {};
      (holesData as any[]).forEach(h => {
        if (!kronosMatchIds.has(h.match_id)) return;
        const dayId = matchDayMap[h.match_id];
        (cards[h.player_id] ??= {})[dayId] ??= [];
        const info = holeInfoForHole(h.match_id, h.hole_number);
        cards[h.player_id][dayId].push({
          hole: h.hole_number,
          par: info?.par,
          strokeIndex: info?.strokeIndex ?? null,
          gross: h.gross_score ?? null,
          pts: h.stableford_pts ?? null,
        });
      });
      Object.values(cards).forEach(byDay => Object.values(byDay).forEach(holes => holes.sort((a, b) => a.hole - b.hole)));
      setScorecardsByPlayer(cards);
    } else {
      setKronosRows([]);
      setScorecardsByPlayer({});
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
      const vsPars: Record<string, number> = {};
      const perDayTotals: Record<string, Record<string, number>> = {};
      const matchDayMap2: Record<string, string> = {};
      (matchesData as any[] ?? []).forEach(m => { matchDayMap2[m.id] = m.day_id; });
      (holesData as any[]).forEach(h => {
        if (!thisMatchIds.has(h.match_id)) return;
        const par = parForHole(h.match_id, h.hole_number);
        const vsPar = allDaysMedal && h.gross_score != null && par != null ? h.gross_score - par : null;
        if (vsPar != null) vsPars[h.player_id] = (vsPars[h.player_id] ?? 0) + vsPar;
        if (h.stableford_pts == null) return;
        totals[h.player_id] = (totals[h.player_id] ?? 0) + h.stableford_pts;
        const dId = matchDayMap2[h.match_id];
        if (dId) {
          if (!perDayTotals[dId]) perDayTotals[dId] = {};
          perDayTotals[dId][h.player_id] = (perDayTotals[dId][h.player_id] ?? 0) + h.stableford_pts;
        }
      });

      // Shared with titanNews.ts's AI report and admin/draw.tsx's Titan Way
      // singles-playoff seeding (src/lib/scoring.ts) — one tie-break
      // implementation so a tie can never resolve differently on different
      // screens (Rick's brief, 2026-08-25).
      const kronosMaps = buildKronosTieBreakMaps(
        (holesData as any[]).filter(h => thisMatchIds.has(h.match_id)),
        finalDayMatchIds,
        h => {
          if (!allDaysMedal) return h.stableford_pts ?? null;
          const par = parForHole(h.match_id, h.hole_number);
          return h.gross_score != null && par != null ? h.gross_score - par : null;
        },
      );

      const cpMap: Record<string, { display_name: string; handicap_index: number | null; avatar_url: string | null; currentTournamentHcp: number | null; totalTournamentCut: number }> = {};
      (cpData as any[]).forEach(cp => {
        cpMap[cp.player_id] = {
          display_name: cp.players?.display_name ?? '—', handicap_index: cp.handicap_index,
          avatar_url: cp.players?.avatar_url ?? null,
          currentTournamentHcp: cp.current_tournament_handicap ?? null,
          totalTournamentCut: Number(cp.total_tournament_cut ?? 0),
        };
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

      // Medal's rungs store gross-vs-par (lower wins); every other format
      // stores Stableford points (higher wins) — the comparison direction
      // flips accordingly rather than negating the stored values, so the
      // per-rung numbers themselves stay directly displayable if ever shown.
      const tieBreak = (a: string, b: string) => kronosTieBreakCompare(kronosMaps, a, b, allDaysMedal);

      const allPidsForBoard = allDaysMedal ? Object.keys(vsPars) : Object.keys(totals);
      const sorted = allPidsForBoard
        .map(pid => ({
          player_id: pid,
          display_name: cpMap[pid]?.display_name ?? '—',
          handicap_index: cpMap[pid]?.handicap_index ?? null,
          avatar_url: cpMap[pid]?.avatar_url ?? null,
          current_tournament_handicap: cpMap[pid]?.currentTournamentHcp ?? null,
          total_tournament_cut: cpMap[pid]?.totalTournamentCut ?? 0,
          stableford_total: totals[pid] ?? 0,
          vs_par_total: vsPars[pid] ?? 0,
          category_id: null as string | null,
          category_name: null as string | null,
          category_position: null as number | null,
          prize_money: null as number | null,
          is_overall_winner: false,
        }))
        .sort((a, b) =>
          (individualScoreValue(allDaysMedal ? 'medal' : 'stableford', b.stableford_total, b.vs_par_total)
            - individualScoreValue(allDaysMedal ? 'medal' : 'stableford', a.stableford_total, a.vs_par_total))
          || tieBreak(a.player_id, b.player_id)
        );

      // The Overall Kronos Winner can't also collect a division prize — that
      // prize rolls down to the next eligible player instead. Only meaningful
      // when this tournament actually runs a Kronos board at all.
      const overallWinnerId = includeInKronos && sorted.length > 0 ? sorted[0].player_id : null;
      if (overallWinnerId) {
        sorted[0].is_overall_winner = true;
        if (kronosOverallPrize != null && kronosOverallPrize > 0) sorted[0].prize_money = kronosOverallPrize;
      }

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
          .sort((a, b) =>
            (individualScoreValue(allDaysMedal ? 'medal' : 'stableford', b.stableford_total, b.vs_par_total)
              - individualScoreValue(allDaysMedal ? 'medal' : 'stableford', a.stableford_total, a.vs_par_total))
            || tieBreak(a.player_id, b.player_id)
          )
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
    // A completed tournament stays visible to whoever already joined it (or
    // is the society's most recent completion, for a player who never had a
    // remembered PIN) — completing a tournament used to filter it out of
    // every one of these lookups, permanently bouncing every player back to
    // "Enter PIN" the moment an admin tapped Complete Tournament, contrary
    // to that action's own confirmation copy (Rick's brief, section 12).
    // Active always wins over complete when both exist, so a genuinely live
    // tournament is never masked by an old completed one.
    const [{ data: joinedComp }, { data: activeComp }, { data: completeComp }, { data: notifs }, { data: soc }] = await Promise.all([
      alreadyJoinedId
        ? supabase.from('competitions').select('*').eq('id', alreadyJoinedId).in('status', ['active', 'complete']).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('competitions').select('*').eq('status', 'active').eq('society_id', SOCIETY_ID ?? '').limit(1).maybeSingle(),
      supabase.from('competitions').select('*').eq('status', 'complete').eq('society_id', SOCIETY_ID ?? '').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('societies').select('instagram_url').eq('id', SOCIETY_ID).single(),
    ]);
    const comp = joinedComp ?? activeComp ?? completeComp;

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
    setInfoPack({ ...emptyInfoPack(), ...((comp as any).info_pack ?? {}) });
    setJoinedId(alreadyJoinedId);
    if (alreadyJoinedId === comp.id) await loadTournamentData(comp.id, !!(comp as any).include_in_kronos, mySeq, (comp as any).kronos_overall_prize ?? null);
    if (mySeq !== loadSeq.current) return;
    setLoading(false);
    setRefreshing(false);
  }

  async function verifyPin(p: string) {
    setVerifying(true);
    const { data } = await supabase
      .from('competitions').select('*').eq('pin', p).in('status', ['active', 'complete']).limit(1).maybeSingle();
    setVerifying(false);
    if (!data) {
      Alert.alert('Wrong PIN', 'No tournament matches that PIN. Ask your admin for the correct code.', [
        { text: 'Try again', onPress: () => setPin('') },
      ]);
      return;
    }
    setCompetition(data as unknown as Competition);
    await AsyncStorage.setItem(STORAGE_KEY, data.id);
    setJoinedId(data.id);
    await loadTournamentData(data.id, !!(data as any).include_in_kronos, ++loadSeq.current, (data as any).kronos_overall_prize ?? null);
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

  // ── PIN entry ───────────────────────────────────────────────────────
  // Covers BOTH "no active tournament at all" (competition is null — used
  // to show a dead-end "Coming Soon" message, no way to act on it) and
  // "there's one but you haven't joined it" — same screen either way now,
  // since verifyPin() does its own fresh PIN lookup and never actually
  // depended on `competition` being pre-fetched (Dave, 2026-08-21: "we
  // just want the enter code screen to come up when the newsreel hits the
  // inbox" — i.e. once a tournament closes out, don't dead-end, just ask
  // for the next one's PIN). Must come before any derived data below,
  // since that section dereferences `competition` directly.
  if (!competition || joinedId !== competition.id) return (
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
          {competition
            ? <>A tournament is live.{'\n'}Enter the 4-digit PIN your admin shared with you.</>
            : <>Enter the 4-digit PIN when your next tournament goes live.</>}
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

  // ── Derived data ────────────────────────────────────────────────────

  // "Kronos" is Titan Way-exclusive branding for the individual standings
  // board — every other format shows the identical system labelled
  // "Individual" (Rick's brief, section 4.4). One board, dynamic label.
  const individualLabel = individualBoardLabel(competition?.format);

  // Bonus points for sweeping every singles match on a day — shared with
  // admin/draw.tsx's final-day knockout seeding so they can't disagree.
  const singlesDayIds = new Set(days.filter(d => d.day_format === 'singles' || d.day_format === 'singles_stableford').map(d => d.id));
  // Titan Way's whole structure is "qualifying rounds decide final position,
  // then the playoff is a fixed-position showdown" (Rick, 2026-09-02) — the
  // singles/playoff day must never feed team points or it can re-shuffle a
  // position the format promises is already locked (e.g. a low seed sweeping
  // their bracket and leapfrogging into 1st). Only exclude it for formats
  // that actually define a knockout playoff; a plain Multi-Team Tour's
  // singles day is a normal scoring round like any other.
  const excludePlayoffFromPoints = getFormatRules(competition?.format).finalDayKnockout;
  // Odd Titan (Dave, 2026-09-02): an odd number of teams can't be bracketed
  // 1v2/3v4 the way Titan Way locks final position, so instead the final
  // round's team points are each team's summed player Stableford for that
  // round — added straight onto the Rounds 1-3 match-play total rather than
  // deciding position via a knockout. Still needs the final round excluded
  // from the normal match-play win/half/loss tally below, same as Titan
  // Way's playoff exclusion, just for a different reason.
  const finalRoundStablefordTeamPoints = getFormatRules(competition?.format).finalRoundStablefordTeamPoints;
  const excludeFinalRoundFromMatchPoints = excludePlayoffFromPoints || finalRoundStablefordTeamPoints;
  const qualifyingMatches = excludeFinalRoundFromMatchPoints
    ? (matches as any[]).filter((m: any) => !singlesDayIds.has(m.day_id))
    : (matches as any[]);
  const finalRoundDayId = finalRoundStablefordTeamPoints ? [...singlesDayIds][0] : undefined;
  const finalRoundTeamStableford = finalRoundDayId ? (teamStablefordByDay[finalRoundDayId] ?? {}) : {};
  const bonusPts = finalRoundStablefordTeamPoints
    ? finalRoundTeamStableford
    : calcSweepBonus(qualifyingMatches as Match[], singlesDayIds, (competition as any).bonus_points ?? 2);

  const standings = getStandings(
    qualifyingMatches.filter((m: any) => m.home_team_id && m.away_team_id),
    (competition as any).pts_win  ?? 1,
    (competition as any).pts_half ?? 0.5,
    teamStableford,
    bonusPts,
  );
  const enriched  = standings.map(s => {
    const t = teams.find(t => t.id === s.teamId);
    return { ...s, name: t?.name ?? '—', accent_color: t?.accent_color ?? '#555', logo_url: t?.logo_url ?? null };
  });

  // Playoff: the knockout day shown as team-vs-team brackets, not a scoring
  // round — grouped by (day, home team, away team) since several brackets
  // run at once, seeded by the same locked qualifying-round `standings`
  // used for the Team tab above (so a bracket's "1st vs 2nd" label always
  // matches the position that decided it).
  const playoffSeeds: Record<string, number> = {};
  standings.forEach((s, i) => { playoffSeeds[s.teamId] = i + 1; });
  const playoffBracketMap: Record<string, any[]> = {};
  if (excludePlayoffFromPoints) {
    (matches as any[])
      .filter((m: any) => singlesDayIds.has(m.day_id) && m.home_team_id && m.away_team_id)
      .forEach((m: any) => {
        const key = `${m.day_id}:${m.home_team_id}:${m.away_team_id}`;
        (playoffBracketMap[key] ??= []).push(m);
      });
  }
  const playoffBrackets = Object.values(playoffBracketMap).map(bracketMatches => {
    const first = bracketMatches[0];
    const winners = bracketMatches.map(m => getEffectiveWinner(
      m.status, m.winner, m.holes_string ?? '..................', m.holes_to_play ?? 18, m.start_hole ?? 1
    ));
    const homeWins = winners.filter(w => w === 'home').length;
    const awayWins = winners.filter(w => w === 'away').length;
    const halves = winners.filter(w => w === 'half').length;
    return {
      key: `${first.day_id}:${first.home_team_id}:${first.away_team_id}`,
      homeTeam: teams.find(t => t.id === first.home_team_id),
      awayTeam: teams.find(t => t.id === first.away_team_id),
      homeSeed: playoffSeeds[first.home_team_id] ?? null,
      awaySeed: playoffSeeds[first.away_team_id] ?? null,
      homeWins, awayWins, halves,
      swept: (homeWins === bracketMatches.length || awayWins === bracketMatches.length) && winners.every(w => !!w),
      matches: bracketMatches.slice().sort((a, b) => (a.match_number ?? 0) - (b.match_number ?? 0)),
    };
  }).sort((a, b) => (a.homeSeed ?? 99) - (b.homeSeed ?? 99));

  // Final table: the playoff decides overall position, it doesn't just add
  // points (Dave, 2026-09-02) — winning your bracket moves you to the
  // higher slot within your qualifying pair (1v2's winner takes 1st, loser
  // takes 2nd; 3v4's winner takes 3rd, and so on). A team can never jump
  // out of its own pair regardless of margin — a 3rd/4th seed's ceiling is
  // 3rd, a 5th/6th seed's ceiling is 5th. Falls back to the qualifying seed
  // order for any pair whose bracket isn't decided yet (not generated, or
  // still in progress) so the table degrades gracefully before/during the
  // playoff.
  const finalPositionByTeam: Record<string, number> = {};
  if (excludePlayoffFromPoints) {
    for (let i = 0; i < standings.length; i += 2) {
      const upperSeedId = standings[i]?.teamId;
      const lowerSeedId = standings[i + 1]?.teamId;
      if (!upperSeedId) continue;
      if (!lowerSeedId) { finalPositionByTeam[upperSeedId] = i + 1; continue; } // odd one out, no pair
      const bracket = playoffBrackets.find(b =>
        (b.homeTeam?.id === upperSeedId && b.awayTeam?.id === lowerSeedId) ||
        (b.homeTeam?.id === lowerSeedId && b.awayTeam?.id === upperSeedId)
      );
      const decided = bracket && bracket.matches.length > 0 && bracket.matches.every((m: any) => m.status === 'complete');
      let winnerId = upperSeedId; // undecided/tied fallback: higher qualifying seed keeps the upper slot
      if (decided && bracket) {
        if (bracket.homeWins !== bracket.awayWins) {
          winnerId = (bracket.homeWins > bracket.awayWins ? bracket.homeTeam?.id : bracket.awayTeam?.id) ?? upperSeedId;
        }
      }
      const loserId = winnerId === upperSeedId ? lowerSeedId : upperSeedId;
      finalPositionByTeam[winnerId] = i + 1;
      finalPositionByTeam[loserId] = i + 2;
    }
  }

  // Money: team prize (competitions.prize_pool split by prize_split% per
  // final position — real fields, added 2026-08-19, previously unused
  // anywhere in this screen) ordered by finalPositionByTeam where the
  // playoff decides it, falling back to the plain (already points-sorted)
  // `enriched` order otherwise.
  const prizePool = (competition as any)?.prize_pool ?? null;
  const prizeSplit: number[] = (competition as any)?.prize_split ?? [];
  const teamsInFinalOrder = enriched
    .map((s, i) => ({ ...s, finalPos: finalPositionByTeam[s.teamId] ?? (i + 1) }))
    .sort((a, b) => a.finalPos - b.finalPos);
  const kronosChampion = indivBoard.find(e => e.is_overall_winner) ?? null;
  const hasMoney = (prizePool != null && prizeSplit.length > 0) || kronosChampion?.prize_money != null || prizeCats.length > 0;

  // Read off the format registry, not the legacy tournament_type column
  // (which collapses Titan Way and Multi-Team Tour into the same value and
  // can't be used to tell them apart — Rick's brief, section 9).
  const isTeamTournament = getFormatRules(competition?.format).isTeamFormat;

  // Per-round columns for the Team leaderboard (R1/R2/R3/...) — same
  // getStandings()/calcSweepBonus() math as the cumulative total above,
  // just called once per day with that day's matches only, so each column
  // shows points earned that round rather than a running total.
  const sortedDays = [...days].sort((a, b) => a.day_number - b.day_number);
  // Team-only: the playoff day gets its own tab (below), not an R-column
  // here, when the format locks position before it — otherwise a knockout
  // day would show up as a normal scoring round in the Team table. Kronos
  // (below) deliberately keeps using the unfiltered `sortedDays` — its D1-D4
  // columns legitimately span the playoff day too.
  const teamSortedDays = sortedDays.filter(d => !excludePlayoffFromPoints || !singlesDayIds.has(d.id));
  // Odd Titan shows the final round as a normal R-column (unlike Titan Way,
  // which hides it into its own Playoff tab) — teamSortedDays above already
  // keeps it since excludePlayoffFromPoints is false for this format; the
  // dayPtsByTeam loop below just needs to fill that column from summed
  // Stableford rather than match-play win/half/loss.
  // Same "every round is Medal" check loadTournamentData used to decide
  // vs-par vs Stableford ranking — kept in sync so the Kronos tab and the
  // Players/Individual board never rank the same tournament two different
  // ways (Rick's brief, section 13).
  const daysAllMedal = days.length > 0 && days.every(d => d.day_format === 'medal');
  const dayPtsByTeam: Record<string, number[]> = {};
  teamSortedDays.forEach(day => {
    const dayIdx = teamSortedDays.indexOf(day);
    if (finalRoundStablefordTeamPoints && singlesDayIds.has(day.id)) {
      Object.entries(teamStablefordByDay[day.id] ?? {}).forEach(([teamId, pts]) => {
        if (!dayPtsByTeam[teamId]) dayPtsByTeam[teamId] = [];
        dayPtsByTeam[teamId][dayIdx] = pts;
      });
      return;
    }
    const dayMatches = (matches as any[]).filter((m: any) => m.day_id === day.id && m.home_team_id && m.away_team_id);
    const daySinglesIds = (day.day_format === 'singles' || day.day_format === 'singles_stableford') ? new Set([day.id]) : new Set<string>();
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
      dayPtsByTeam[ds.teamId][dayIdx] = ds.pts;
    });
  });

  const teamLeaderboardRows: LeaderboardRow[] = enriched.map(s => ({
    id: s.teamId,
    // For a knockout-playoff format, rank by finalPositionByTeam (which
    // already mirrors qualifying order before the playoff, then reflects
    // each bracket's winner once played) rather than raw points — otherwise
    // the row order could contradict the very playoff result shown one tab
    // over. Negated so a better (lower-numbered) position sorts first under
    // the existing descending `sort((a,b) => b.sortKey - a.sortKey)` below.
    // Non-knockout formats have no entries in finalPositionByTeam at all,
    // so they fall through to the original points-based order, unchanged.
    sortKey: finalPositionByTeam[s.teamId] != null ? -finalPositionByTeam[s.teamId] : s.pts,
    name: s.name,
    subtitle: `${s.w}W ${s.h}H ${s.l}L`,
    teamName: s.name,
    teamLogoUrl: s.logo_url,
    teamAccentColor: s.accent_color,
    columns: teamSortedDays.map((_, i) => dayPtsByTeam[s.teamId]?.[i] ?? '–'),
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

  // "LIVE" badge should say FINISHED the moment every round's matches are
  // actually done, not wait for the admin to separately close the
  // tournament out (Dave, 2026-08-21 — "when all rounds are done ... can we
  // have the little green live to say finished"). Same completeness check
  // admin/news.tsx already uses to decide when the final report is ready.
  const allDaysComplete = days.length > 0 && days.every(d => {
    const dayMatches = (matches as any[]).filter(m => m.day_id === d.id);
    return dayMatches.length > 0 && dayMatches.every(m => m.status === 'complete');
  });

  // My match in this tournament — across a multi-day tournament a player
  // has one match PER DAY, and matches are ordered by match_number (which
  // increases day-over-day). A plain .find() always returns the earliest
  // one regardless of status, so once day 1's match completes, the banner
  // vanished for day 2's genuinely live match instead of showing it (Dave,
  // 2026-08-21 — "we have lost the little play now button... if you are in
  // a game you have to go into leaderboard and find your game"). Prefer an
  // in_progress match over an upcoming one, and never surface a completed
  // one here — this button is specifically for jumping into a live/next
  // match, not a done one.
  const myOwnMatches = myPlayerId
    ? (matches as any[]).filter(m =>
        (m.home_player_ids ?? []).includes(myPlayerId) ||
        (m.away_player_ids ?? []).includes(myPlayerId)
      )
    : [];
  // A day only counts as playable once every match in every EARLIER day is
  // complete — not just this player's own match. Without this, a player
  // whose own Day 1 group finished quickly could jump straight into a Day 2
  // match via this banner while the rest of Day 1 was still being played
  // (Dave, 2026-08-21 — tapped into Round 2 before Round 1 had finished).
  const dayNumberByDayId = new Map(days.map(d => [d.id, d.day_number]));
  const isDayUnlocked = (dayId: string) => {
    const dn = dayNumberByDayId.get(dayId);
    if (dn == null) return true;
    return days.filter(d => d.day_number < dn).every(pd => {
      const pdMatches = matches.filter(m => m.day_id === pd.id);
      return pdMatches.length > 0 && pdMatches.every(m => m.status === 'complete');
    });
  };

  const myMatch = myOwnMatches.find(m => m.status === 'in_progress')
    ?? myOwnMatches.find(m => m.status === 'upcoming' && isDayUnlocked(m.day_id))
    ?? null;
  const myMatchActive = !!myMatch;

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
          backgroundColor: allDaysComplete ? 'rgba(212,175,55,0.1)' : 'rgba(74,222,128,0.1)',
          paddingHorizontal: 10, paddingVertical: 3,
          borderRadius: 6, borderWidth: 1, borderColor: allDaysComplete ? 'rgba(212,175,55,0.35)' : 'rgba(74,222,128,0.35)',
        }}>
          <Text style={{ fontSize: 10, fontFamily: FFB, color: allDaysComplete ? GOLD : GREEN, letterSpacing: 1 }}>
            {allDaysComplete ? 'FINISHED' : '● LIVE'}
          </Text>
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
            {selectedSection === 'standings' ? 'Leaderboard' : selectedSection === 'players' ? 'Prize Positions' : selectedSection === 'info' ? 'Info Pack' : 'Live & Social'}
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
              <Text style={[st.sectionTileSub, { color: dc.cardText }]} numberOfLines={2}>Group, team, {individualLabel} & honours</Text>
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
              <Text style={[st.sectionTileLabel, { color: dc.cardText }]} numberOfLines={1}>Prize Positions</Text>
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
              {excludePlayoffFromPoints && playoffBrackets.length > 0 && (
                <TouchableOpacity style={[st.lbTab, leaderboardTab === 'playoff' && st.lbTabOn]} onPress={() => setLeaderboardTab('playoff')} activeOpacity={0.8}>
                  <Text style={[st.lbTabText, leaderboardTab === 'playoff' && st.lbTabTextOn]}>Playoff</Text>
                </TouchableOpacity>
              )}
              {competition?.include_in_kronos && (
                <TouchableOpacity style={[st.lbTab, leaderboardTab === 'kronos' && st.lbTabOn]} onPress={() => setLeaderboardTab('kronos')} activeOpacity={0.8}>
                  <Text style={[st.lbTabText, leaderboardTab === 'kronos' && st.lbTabTextOn]}>{individualLabel}</Text>
                </TouchableOpacity>
              )}
              {hasMoney && (
                <TouchableOpacity style={[st.lbTab, leaderboardTab === 'money' && st.lbTabOn]} onPress={() => setLeaderboardTab('money')} activeOpacity={0.8}>
                  <Text style={[st.lbTabText, leaderboardTab === 'money' && st.lbTabTextOn]}>Money</Text>
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
                  const dayLocked = !isDayUnlocked(day.id);

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
                            {isDone ? 'COMPLETE' : isLive ? 'LIVE' : dayLocked ? 'LOCKED' : 'UPCOMING'}
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
                        const isLockedMatch = dayLocked && m.status === 'upcoming';
                        const matchDest = isLockedMatch
                          ? null
                          : isMyMatch
                            ? ((m as any).round_format === 'team_stableford'
                                ? `/(app)/score/teamstableford/${m.id}`
                                : (m.away_player_ids ?? []).length === 0 && (m.home_player_ids ?? []).length === 1 ? `/(app)/score/solo/${m.id}` : `/(app)/score/enter/${m.id}`)
                            : `/(app)/spectate/${m.id}`;
                        const statusLabel = isComplete && m.result_str ? m.result_str : isMatchLive ? 'Live' : isLockedMatch ? 'Locked' : 'Upcoming';
                        const winner = getEffectiveWinner(m.status, m.winner, m.holes_string ?? '..................', m.holes_to_play ?? 18);
                        const showWinner = isComplete && winner !== 'half';
                        const homeWon = showWinner && winner === 'home';
                        const awayWon = showWinner && winner === 'away';
                        return (
                          <TouchableOpacity
                            key={m.id}
                            style={[
                              st.matchRow,
                              { backgroundColor: dc.card, borderColor: dc.border },
                              isMatchLive && { borderColor: 'rgba(74,222,128,0.35)' },
                              isLockedMatch && { opacity: 0.5 },
                            ]}
                            onPress={matchDest ? () => router.push(matchDest as any) : undefined}
                            disabled={!matchDest}
                            activeOpacity={matchDest ? 0.75 : 1}
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
                                    <Text style={[st.matchName, { color: homeWon ? dc.gold : showWinner ? 'rgba(255,255,255,0.5)' : dc.cardText }]} numberOfLines={1}>{home}</Text>
                                  </View>
                                  {/* Who's actually playing in this match, not
                                      just which teams — same info the draw
                                      screen already shows under each team
                                      (Dave, 2026-08-21). */}
                                  {isTeamMatch && (
                                    <Text style={st.matchPlayers} numberOfLines={1}>
                                      {(m.home_player_ids ?? []).map(id => players.find(p => p.id === id)?.display_name?.split(' ')[0] ?? '?').join(' & ')}
                                    </Text>
                                  )}
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
                                    <Text style={[st.matchName, { color: awayWon ? dc.gold : showWinner ? 'rgba(255,255,255,0.5)' : dc.cardText }]} numberOfLines={1}>{away}</Text>
                                  </View>
                                  {isTeamMatch && (
                                    <Text style={[st.matchPlayers, { textAlign: 'right' }]} numberOfLines={1}>
                                      {(m.away_player_ids ?? []).map(id => players.find(p => p.id === id)?.display_name?.split(' ')[0] ?? '?').join(' & ')}
                                    </Text>
                                  )}
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
              <View>
                {excludePlayoffFromPoints && playoffBrackets.length > 0 && (
                  <Text style={{ fontSize: 12, fontFamily: FF, color: dc.cardText, opacity: 0.6, marginBottom: 12, lineHeight: 17 }}>
                    Final position reflects the Playoff result — see the Playoff tab. Points/W-L below are from the qualifying rounds only.
                  </Text>
                )}
                <Leaderboard
                  rows={[...teamLeaderboardRows].sort((a, b) => b.sortKey - a.sortKey)}
                  columnLabels={teamSortedDays.map((_, i) => `R${i + 1}`)}
                  totalLabel="TOTAL"
                  pointsKey={teamPointsKey}
                  emptyMessage="No matches played yet. Results will appear here as games complete."
                />
              </View>
            )}

            {/* ── Playoff: Titan Way's locked-position knockout, shown as
                brackets — never folds back into the Team points above. */}
            {leaderboardTab === 'playoff' && (
              <View>
                <Text style={{ fontSize: 12, fontFamily: FF, color: dc.cardText, opacity: 0.6, marginBottom: 16, lineHeight: 17 }}>
                  Final team positions are locked from the qualifying rounds above — this is a straight knockout for pride between fixed positions, and doesn't change the Team standings.
                </Text>
                {playoffBrackets.map(b => (
                  <View key={b.key} style={[st.champCard, { backgroundColor: dc.card, borderColor: dc.border, marginBottom: 16 }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {b.homeTeam?.name && teamLogos[b.homeTeam.name] && (
                          <Image source={teamLogos[b.homeTeam.name]} style={{ width: 20, height: 20 }} resizeMode="contain" />
                        )}
                        <Text style={{ fontSize: 14, fontFamily: FFB, color: b.homeTeam?.accent_color ?? dc.cardText, flexShrink: 1 }} numberOfLines={1}>
                          {b.homeSeed ? `${ordinalLabel(b.homeSeed)} ` : ''}{b.homeTeam?.name ?? '—'}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 11, fontFamily: FFB, color: dc.cardText, opacity: 0.5, marginHorizontal: 8 }}>VS</Text>
                      <View style={{ flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                        {b.awayTeam?.name && teamLogos[b.awayTeam.name] && (
                          <Image source={teamLogos[b.awayTeam.name]} style={{ width: 20, height: 20 }} resizeMode="contain" />
                        )}
                        <Text style={{ fontSize: 14, fontFamily: FFB, color: b.awayTeam?.accent_color ?? dc.cardText, flexShrink: 1, textAlign: 'right' }} numberOfLines={1}>
                          {b.awaySeed ? `${ordinalLabel(b.awaySeed)} ` : ''}{b.awayTeam?.name ?? '—'}
                        </Text>
                      </View>
                    </View>

                    <Text style={{ fontSize: 22, fontFamily: FFB, color: dc.gold, textAlign: 'center', marginVertical: 8 }}>
                      {b.homeWins} – {b.awayWins}{b.halves > 0 ? `  (${b.halves} halved)` : ''}
                    </Text>
                    {b.swept && (
                      <Text style={{ fontSize: 10, fontFamily: FFB, color: GREEN, textAlign: 'center', letterSpacing: 1, marginBottom: 8 }}>
                        CLEAN SWEEP
                      </Text>
                    )}

                    {b.matches.map((m: any) => {
                      const homePlayer = players.find(p => p.id === m.home_player_ids[0]);
                      const awayPlayer = players.find(p => p.id === m.away_player_ids[0]);
                      const statusLabel = m.status === 'complete' ? (m.result_str ?? '—') : m.status === 'in_progress' ? 'LIVE' : 'UPCOMING';
                      return (
                        <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, borderTopWidth: 1, borderTopColor: dc.border }}>
                          <Text style={{ fontSize: 12, fontFamily: FF, color: dc.cardText, flex: 1 }} numberOfLines={1}>{homePlayer?.display_name ?? '—'}</Text>
                          <Text style={{ fontSize: 11, fontFamily: FFB, color: m.status === 'complete' ? dc.gold : m.status === 'in_progress' ? GREEN : dc.cardText, marginHorizontal: 8 }}>
                            {statusLabel}
                          </Text>
                          <Text style={{ fontSize: 12, fontFamily: FF, color: dc.cardText, flex: 1, textAlign: 'right' }} numberOfLines={1}>{awayPlayer?.display_name ?? '—'}</Text>
                        </View>
                      );
                    })}
                  </View>
                ))}
                {playoffBrackets.length === 0 && (
                  <Text style={st.noResults}>Playoff bracket not generated yet.</Text>
                )}
              </View>
            )}

            {/* ── Kronos: one row per player, D1-D4 columns + total ── */}
            {leaderboardTab === 'kronos' && (
              <Leaderboard
                title={individualLabel.toUpperCase()}
                rows={kronosRows.map(r => ({
                  id: r.playerId,
                  sortKey: individualScoreValue(daysAllMedal ? 'medal' : 'stableford', r.total, r.vsParTotal),
                  name: r.name,
                  subtitle: r.teamName ?? undefined,
                  playerId: r.playerId,
                  avatarUrl: r.avatarUrl,
                  isCaptain: r.isCaptain,
                  columns: r.byDay,
                  totalDisplay: daysAllMedal ? formatVsPar(r.vsParTotal) : String(r.total),
                }))}
                columnLabels={sortedDays.map((_, i) => `D${i + 1}`)}
                totalLabel="TOT"
                emptyMessage="No Stableford scores yet."
                onRowPress={row => { setScorecardPlayerId(row.playerId ?? null); setScorecardDayIdx(0); }}
              />
            )}

            {/* ── Money: every payout in the tournament, together ── */}
            {leaderboardTab === 'money' && (
              <View>
                {prizePool != null && prizeSplit.length > 0 && (
                  <>
                    <Text style={st.sectionHeader}>TEAM PRIZE — £{Number(prizePool).toLocaleString('en-GB')}</Text>
                    {teamsInFinalOrder.slice(0, prizeSplit.length).map((s, i) => (
                      <View key={s.teamId} style={[st.champCard, { backgroundColor: dc.card, borderColor: dc.border, marginBottom: 10, flexDirection: 'row', alignItems: 'center' }]}>
                        <Text style={{ width: 40, fontSize: 13, fontFamily: FFB, color: dc.textSecondary }}>{ordinalLabel(i + 1)}</Text>
                        {teamLogos[s.name] && <Image source={teamLogos[s.name]} style={{ width: 24, height: 24, marginRight: 8 }} resizeMode="contain" />}
                        <Text style={{ flex: 1, fontSize: 15, fontFamily: FFB, color: s.accent_color ?? dc.cardText }} numberOfLines={1}>{s.name}</Text>
                        <Text style={{ fontSize: 15, fontFamily: FFB, color: GOLD }}>
                          £{Number(prizePool * prizeSplit[i] / 100).toLocaleString('en-GB', { minimumFractionDigits: 0 })}
                        </Text>
                      </View>
                    ))}
                  </>
                )}

                {kronosChampion?.prize_money != null && (
                  <>
                    <Text style={[st.sectionHeader, { marginTop: prizePool != null ? 20 : 0 }]}>{individualLabel.toUpperCase()} CHAMPION</Text>
                    <View style={[st.champCard, { backgroundColor: dc.card, borderColor: dc.border, marginBottom: 10, flexDirection: 'row', alignItems: 'center' }]}>
                      <Text style={{ flex: 1, fontSize: 15, fontFamily: FFB, color: dc.cardText }} numberOfLines={1}>{kronosChampion.display_name}</Text>
                      <Text style={{ fontSize: 15, fontFamily: FFB, color: GOLD }}>
                        £{Number(kronosChampion.prize_money).toLocaleString('en-GB', { minimumFractionDigits: 0 })}
                      </Text>
                    </View>
                  </>
                )}

                {prizeCats.length > 0 && (
                  <Text style={{ fontSize: 12, fontFamily: FF, color: dc.cardText, opacity: 0.6, marginTop: 20, lineHeight: 17 }}>
                    Individual handicap-category prizes are in Players → Prize Categories, further down.
                  </Text>
                )}

                {!hasMoney && <Text style={st.noResults}>No prize money set for this tournament.</Text>}
              </View>
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
              {daysAllMedal ? 'Score vs par from all rounds.' : 'Stableford points from all rounds.'} Prize positions update live as scores come in.
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
                const cutsOn = !!(competition as any)?.handicap_cuts_enabled && entry.current_tournament_handicap != null;
                return (
                  <TouchableOpacity
                    key={entry.player_id}
                    activeOpacity={0.7}
                    onPress={() => setTcardMember({
                      role: 'member', committee_role: null, membership_types: [],
                      player: { id: entry.player_id, display_name: entry.display_name, email: null, handicap_index: entry.handicap_index, avatar_url: entry.avatar_url },
                    })}
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
                            OVERALL {individualLabel.toUpperCase()} WINNER · division prize rolls down
                          </Text>
                        ) : entry.category_name && (
                          <Text style={{ fontFamily: 'JUSTSans-ExBold', fontSize: 10, color: '#555', marginTop: 1 }}>
                            {entry.category_name}{entry.category_position != null ? ` · ${ordinalLabel(entry.category_position)} in cat` : ''}
                          </Text>
                        )}
                        {cutsOn && (
                          <Text style={{ fontFamily: 'JUSTSans-ExBold', fontSize: 10, color: '#555', marginTop: 1 }}>
                            H'cap {entry.current_tournament_handicap!.toFixed(1)}{entry.total_tournament_cut > 0 ? ` (-${entry.total_tournament_cut.toFixed(1)})` : ''}
                          </Text>
                        )}
                      </View>
                    </View>
                    <Text style={[st.cell, st.pts]}>
                      {daysAllMedal ? formatVsPar(entry.vs_par_total) : entry.stableford_total}
                    </Text>
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
                  </TouchableOpacity>
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
                  // category_position is computed once in loadTournamentData
                  // with the overall winner already skipped (their slot rolls
                  // down) — indexing inCat by raw array position instead would
                  // put the overall winner back in 1st here even though the
                  // leaderboard rows above have already rolled them past it
                  // (Rick's brief, section 13).
                  const inCat = indivBoard.filter(e => e.category_id === cat.id && e.category_position != null);
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
                        const leader = inCat.find(e => e.category_position === pp.position);
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
            {(() => {
              const infoRounds: RoundInfo[] = days.map(d => ({ id: d.id, dayNumber: d.day_number, courseName: d.course_name }));
              const infoRoster: RosterPlayer[] = players.map(p => ({ id: p.id, name: p.display_name, avatarUrl: p.avatar_url ?? null }));
              return (
                <>
                  {!hasInfoPackContent(infoPack, infoRounds) && (
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
                  <InfoPackView
                    pack={infoPack}
                    startDate={competition?.start_date ?? null}
                    endDate={competition?.end_date ?? null}
                    rounds={infoRounds}
                    roster={infoRoster}
                  />
                </>
              );
            })()}
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
          {notifications.map(n => <TourFeedCard key={n.id} n={n} individualLabel={individualLabel} />)}

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

      <TCardSheet
        visible={tcardMember !== null}
        member={tcardMember}
        tTag={null}
        playingNow={null}
        isAdmin={false}
        societyId={SOCIETY_ID ?? ''}
        myRole="member"
        onClose={() => setTcardMember(null)}
        onSaved={() => {}}
        competitionId={competition?.id}
      />

      {/* Scorecard — opened by tapping a Kronos row. Round tabs (1/2/3/4)
          instead of one long scroll of every hole in the tournament. */}
      <Modal visible={scorecardPlayerId !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setScorecardPlayerId(null)}>
        <View style={{ flex: 1, backgroundColor: dc.bg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 56 : 24, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: dc.border }}>
            <Text style={{ fontSize: 16, fontFamily: FFB, color: dc.cardText }} numberOfLines={1}>
              {players.find(p => p.id === scorecardPlayerId)?.display_name ?? 'Scorecard'}
            </Text>
            <TouchableOpacity onPress={() => setScorecardPlayerId(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={{ fontSize: 15, fontFamily: FFB, color: GOLD }}>Done</Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 8 }}>
            {sortedDays.map((day, i) => (
              <TouchableOpacity
                key={day.id}
                onPress={() => setScorecardDayIdx(i)}
                style={[st.lbTab, { flex: 0, paddingHorizontal: 18 }, scorecardDayIdx === i && st.lbTabOn]}
                activeOpacity={0.8}
              >
                <Text style={[st.lbTabText, scorecardDayIdx === i && st.lbTabTextOn]}>{i + 1}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            {(() => {
              const day = sortedDays[scorecardDayIdx];
              const holes = (scorecardPlayerId && day) ? (scorecardsByPlayer[scorecardPlayerId]?.[day.id] ?? []) : [];
              if (holes.length === 0) {
                return <Text style={st.noResults}>No scores recorded for this round.</Text>;
              }
              const totalGross = holes.reduce((sum, h) => sum + (h.gross ?? 0), 0);
              const totalPts = holes.reduce((sum, h) => sum + (h.pts ?? 0), 0);
              // Same grid grammar as RoundScorecard (score/enter, spectate,
              // profile/round) — HOLE/PAR/SI header rows, one 9-hole block
              // at a time, colored score pill — so this looks like the rest
              // of the app's scorecards, not a bespoke list (Dave, 2026-09-02
              // — "can it be more appealing... I like the PGA style we have").
              const nines = [holes.filter(h => h.hole <= 9), holes.filter(h => h.hole > 9)].filter(n => n.length > 0);
              return (
                <>
                  {day.course_name && (
                    <Text style={{ fontSize: 12, fontFamily: FFB, color: dc.cardText, opacity: 0.6, marginBottom: 12 }}>{day.course_name}</Text>
                  )}
                  {nines.map((nine, ni) => {
                    const ninePar = nine.reduce((a, h) => a + (h.par ?? 0), 0);
                    const nineGross = nine.reduce((a, h) => a + (h.gross ?? 0), 0);
                    const ninePts = nine.reduce((a, h) => a + (h.pts ?? 0), 0);
                    return (
                      <View key={ni} style={sc.container}>
                        <Text style={sc.title}>{nine[0].hole <= 9 ? 'FRONT 9' : 'BACK 9'}</Text>

                        <View style={sc.headerRow}>
                          <Text allowFontScaling={false} style={[sc.cell, sc.labelCell, { color: '#fff' }]}>HOLE</Text>
                          {nine.map(h => <Text allowFontScaling={false} key={h.hole} style={[sc.cell, sc.holeCell, { color: '#fff' }]}>{h.hole}</Text>)}
                          <Text allowFontScaling={false} style={[sc.cell, sc.totalCell, { color: '#fff' }]}>TOT</Text>
                        </View>

                        <View style={[sc.row, { backgroundColor: '#0a0a0a' }]}>
                          <Text allowFontScaling={false} style={[sc.cell, sc.labelCell, { color: GOLD }]}>PAR</Text>
                          {nine.map(h => <Text allowFontScaling={false} key={h.hole} style={[sc.cell, sc.holeCell, { color: GOLD }]}>{h.par ?? '—'}</Text>)}
                          <Text allowFontScaling={false} style={[sc.cell, sc.totalCell, { color: GOLD }]}>{ninePar || '—'}</Text>
                        </View>

                        <View style={sc.row}>
                          <Text allowFontScaling={false} style={[sc.cell, sc.labelCell, { color: '#fff' }]}>SI</Text>
                          {nine.map(h => <Text allowFontScaling={false} key={h.hole} style={[sc.cell, sc.holeCell, { color: '#fff', fontSize: 9 }]}>{h.strokeIndex ?? '—'}</Text>)}
                          <Text allowFontScaling={false} style={[sc.cell, sc.totalCell, { color: '#fff' }]}>—</Text>
                        </View>

                        <View style={[sc.row, { borderBottomWidth: 0 }]}>
                          <Text allowFontScaling={false} style={[sc.cell, sc.labelCell, { color: '#fff' }]} numberOfLines={1}>SCORE</Text>
                          {nine.map(h => {
                            const cat = (h.gross != null && h.par != null) ? scoreVsPar(h.gross, h.par) : null;
                            const cellColor = cat ? SCORE_COLORS[cat] : '#333';
                            return (
                              <View key={h.hole} style={[sc.cell, sc.holeCell, { gap: 2 }]}>
                                {h.gross != null ? (
                                  <>
                                    <View style={[sc.scorePill, { borderColor: `${cellColor}50`, backgroundColor: `${cellColor}12` }]}>
                                      <Text allowFontScaling={false} style={[sc.scorePillText, { color: cellColor }]}>{h.gross}</Text>
                                    </View>
                                    {h.pts != null && (
                                      <Text allowFontScaling={false} style={[sc.ptsText, { color: GOLD }]}>{h.pts}pt</Text>
                                    )}
                                  </>
                                ) : (
                                  <Text style={{ fontFamily: FFB, fontSize: 10, color: '#444' }}>—</Text>
                                )}
                              </View>
                            );
                          })}
                          <Text allowFontScaling={false} style={[sc.cell, sc.totalCell, { color: nineGross > 0 ? '#ffffff' : '#333' }]}>
                            {nineGross > 0 ? nineGross : '—'}
                          </Text>
                        </View>
                        {ninePts > 0 && (
                          <Text style={{ fontFamily: FFB, fontSize: 10, color: GOLD, textAlign: 'right', paddingHorizontal: 12, paddingBottom: 8 }}>
                            {ninePts} pts this 9
                          </Text>
                        )}
                      </View>
                    );
                  })}

                  <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, marginTop: 4, borderTopWidth: 2, borderTopColor: GOLD }}>
                    <Text style={{ flex: 1, fontSize: 13, fontFamily: FFB, color: dc.cardText }}>ROUND TOTAL</Text>
                    <Text style={{ fontSize: 18, fontFamily: FFB, color: dc.cardText, marginRight: 12 }}>{totalGross || '–'}</Text>
                    <Text style={{ fontSize: 14, fontFamily: FFB, color: GOLD }}>{totalPts} pts</Text>
                  </View>
                </>
              );
            })()}
          </ScrollView>
        </View>
      </Modal>
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
  matchPlayers: { fontSize: 11, fontFamily: 'JUSTSans', color: '#9ca3af', marginTop: 1 },

  // No results
  noResults: { fontSize: 13, fontFamily: 'JUSTSans-ExBold', color: '#fff', textAlign: 'center', padding: 20, lineHeight: 22 },
});

// ── Live feed card ────────────────────────────────────────────────────
function TourFeedCard({ n, individualLabel }: { n: Notification; individualLabel: string }) {
  const label = n.type === 'kronos_champ' ? `${individualLabel} Champion` : (NOTIF_LABELS[n.type] ?? n.type);
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

// Kronos player-scorecard grid — same tokens as src/components/RoundScorecard.tsx
// (score/enter, spectate, profile/round) so this reads as the same scorecard
// everywhere in the app rather than a one-off list.
const sc = StyleSheet.create({
  container:    { backgroundColor: '#111111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden', marginBottom: 16 },
  title:        { fontFamily: 'JUSTSans-ExBold', fontSize: 10, color: GOLD, letterSpacing: 2, padding: 12, paddingBottom: 4 },
  headerRow:    { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', backgroundColor: '#0a0a0a' },
  row:          { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#141414' },
  cell:         { alignItems: 'center', justifyContent: 'center' },
  labelCell:    { width: 56, paddingLeft: 10, alignItems: 'flex-start' },
  holeCell:     { flex: 1, fontFamily: 'JUSTSans-ExBold', fontSize: 11, color: '#fff', textAlign: 'center' },
  totalCell:    { width: 34, fontFamily: 'JUSTSans-ExBold', fontSize: 11, color: '#ffffff', textAlign: 'center' },
  scorePill:    { borderWidth: 1, borderRadius: 5, paddingHorizontal: 4, paddingVertical: 1, minWidth: 20, alignItems: 'center' },
  scorePillText:{ fontFamily: 'JUSTSans-ExBold', fontSize: 11 },
  ptsText:      { fontFamily: 'JUSTSans-ExBold', fontSize: 9, textAlign: 'center' },
});
