import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Image,
  Platform, TextInput, ScrollView, useWindowDimensions, Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../../src/lib/supabase';
import {
  calcHoles, matchLabel, calcCourseHandicap,
  calcStrokesReceived, calcStablefordPoints, formatStrokeHoles,
} from '../../../../src/lib/scoring';
import { getPlayerAvatar } from '../../../../src/lib/assets';
import { speakHole, speakPressure } from '../../../../src/lib/caddie';
import * as Location from 'expo-location';
import ShotLogger from '../../../../src/components/ShotLogger';
import RecordCelebration from '../../../../src/components/RecordCelebration';
import { checkAndUpdateRecords, type BrokenRecord } from '../../../../src/lib/records';
import { sendMatchNotification } from '../../../../src/lib/notifications';
import { generateCasualMatchReport } from '../../../../src/lib/titanNews';
import { sendMatchToWatch, clearMatchFromWatch, onWatchScoreEntry, onWatchRequestsState } from '../../../../src/lib/watch';
import { startLiveActivity, updateLiveActivity, endLiveActivity } from '../../../../src/lib/liveActivity';
import { enqueueHole, isNetworkError } from '../../../../src/lib/offlineQueue';
import { useSyncStatus } from '../../../../src/lib/useSyncStatus';
import { getMatchPack } from '../../../../src/lib/offlinePack';
import SyncBar from '../../../../src/components/SyncBar';
import ConflictSheet from '../../../../src/components/ConflictSheet';
import { dedupeInitials } from '../../../../src/lib/playerDisplay';
import { formatRoundDuration } from '../../../../src/lib/roundTimer';
import EagleAlert, { type EagleType } from '../../../../src/components/EagleAlert';
import { IS_PAD } from '../../../../src/lib/useDeviceLayout';
import GPSPanel from '../../../../src/components/ipad/GPSPanel';
import LeaderboardPanel from '../../../../src/components/ipad/LeaderboardPanel';

// ── Design tokens ──────────────────────────────────────────────
const GOLD     = '#D4AF37';
const GREEN    = '#4ade80';
const RED      = '#f87171';
const BLUE     = '#3b82f6';
const ORANGE   = '#f97316';
const DARKBLUE = '#1e3a8a';
const PLAIN    = '#ffffff';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';
const { width: W } = Dimensions.get('window');
const titanLogo = require('../../../../assets/TitanAppLogo.png');

const SCORE_COLORS: Record<string, string> = { eagle: GOLD, birdie: RED, par: PLAIN, bogey: BLUE, double: DARKBLUE };

const TEE_OPTIONS = [
  { label: 'Yellow', color: '#EAB308' },
  { label: 'White',  color: '#D1D5DB' },
  { label: 'Red',    color: '#EF4444' },
  { label: 'Blue',   color: '#3B82F6' },
  { label: 'Black',  color: '#6B7280' },
];

function formatVsPar(n: number): string {
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `${n}`;
}

function scoreVsPar(gross: number, par: number, _shots: number): string {
  // Classified by gross strokes vs par only — handicap shots affect stableford
  // points, not the eagle/birdie/par/bogey label (Rick: "points and stroke
  // should remain separate").
  const diff = gross - par;
  if (diff <= -2) return 'eagle';
  if (diff === -1) return 'birdie';
  if (diff === 0)  return 'par';
  if (diff === 1)  return 'bogey';
  return 'double';
}

function isMissingMatchError(err: any): boolean {
  return err?.code === '23503' || /foreign key/i.test(String(err?.message ?? ''));
}

function ptsColor(pts: number): string {
  if (pts >= 4) return GOLD;
  if (pts === 3) return RED;
  if (pts === 2) return PLAIN;
  if (pts === 1) return BLUE;
  return DARKBLUE;
}

function Avatar({ name, color, size = 36, source }: { name: string; color: string; size?: number; source?: any }) {
  if (source) {
    const imgSrc = typeof source === 'string' ? { uri: source } : source;
    return <Image source={imgSrc} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${color}20`, borderWidth: 1.5, borderColor: `${color}60`, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: FFB, fontSize: size * 0.4, color }}>{(name || '?').charAt(0).toUpperCase()}</Text>
    </View>
  );
}

// ── Interfaces ─────────────────────────────────────────────────
interface MatchInfo {
  id: string;
  match_number: number;
  competition_id: string;
  status: 'upcoming' | 'in_progress' | 'complete';
  winner: string | null;
  result_str: string | null;
  holes_string: string;
  start_hole: number | null;
  holes_to_play: number | null;
  round_format: 'matchplay' | 'stableford' | 'medal';
  is_singles: boolean;
  home_player_ids: string[];
  away_player_ids: string[];
  home_team: { name: string; accent_color: string } | null;
  away_team: { name: string; accent_color: string } | null;
  side_games: string[] | null;
  secondary_format: string | null;
  hcp_allowance: number | null;
  handicap_method: string | null;
  player_overrides: Record<string, { hcp?: number; tee?: string }> | null;
  started_at: string | null;
  completed_at: string | null;
  day_id: string | null;
  day: {
    course_name: string;
    course_par: number;
    course_rating: number;
    slope_rating: number;
    day_number: number;
    competition: { format: string; include_in_kronos: boolean } | null;
  } | null;
}

interface CourseHole { hole_number: number; par: number; stroke_index: number; yardage: number | null; tee_yardages: Record<string, number> | null; }
interface CompPlayer { player_id: string; handicap_index: number; }

function playerCourseHcp(playerId: string, compPlayers: CompPlayer[], day: MatchInfo['day'], hcpAllowance: number = 100): number {
  const cp = compPlayers.find(c => c.player_id === playerId);
  const hcpIndex = cp?.handicap_index ?? 0;
  const raw = (!day?.slope_rating || !day?.course_rating || !day?.course_par)
    ? Math.round(hcpIndex)
    : calcCourseHandicap(hcpIndex, day.slope_rating, day.course_rating, day.course_par);
  return Math.round(raw * (hcpAllowance / 100));
}

export default function EnterScoresScreen() {
  const { matchId, startHole: startHoleParam, teeColor } = useLocalSearchParams<{ matchId: string; startHole?: string; teeColor?: string }>();
  const startHole = Math.max(1, Math.min(18, parseInt(startHoleParam ?? '1', 10) || 1));
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [courseHoles, setCourseHoles] = useState<CourseHole[]>([]);
  const [compPlayers, setCompPlayers] = useState<CompPlayer[]>([]);
  const baseCompRef = useRef<CompPlayer[]>([]);
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [playerAvatars, setPlayerAvatars] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [saving, setSaving] = useState(false);
  // generateCasualMatchReport runs fire-and-forget in the background (a
  // Claude API round-trip, a few seconds) so the round-complete screen
  // itself shows instantly — but that means the "Read Match Report" button
  // can appear before the report actually exists yet. Track the in-flight
  // promise so the button can await it and show it's still writing, instead
  // of navigating straight to an empty "No stories published" screen (Dave,
  // 2026-08-20 — tapped it within the same ~2s and got exactly that).
  const newsReportPromiseRef = useRef<Promise<void> | null>(null);
  const [openingReport, setOpeningReport] = useState(false);

  const [editPlayerId, setEditPlayerId] = useState<string | null>(null);
  const [editHcp, setEditHcp] = useState('');
  const [editTee, setEditTee] = useState<string | null>(null);
  const [recordsBroken, setRecordsBroken] = useState<BrokenRecord[]>([]);

  const [modalVisible, setModalVisible] = useState(false);
  const [modalPlayerIdx, setModalPlayerIdx] = useState(0);
  const [modalStartIdx, setModalStartIdx] = useState(0);
  const [holeScores, setHoleScores] = useState<Record<string, number>>({});
  const [selectedScore, setSelectedScore] = useState<number | null>(null);
  const [selectedFairway, setSelectedFairway] = useState<'left' | 'centre' | 'right' | null>(null);
  const [selectedPutts, setSelectedPutts]     = useState<number | null>(null);
  const [selectedBunker, setSelectedBunker]   = useState(0);
  const [selectedPenalty, setSelectedPenalty] = useState(0);
  const [selectedChips, setSelectedChips]     = useState(0);
  const [holeStatMap, setHoleStatMap] = useState<Record<string, {
    fairway: 'left' | 'centre' | 'right' | null;
    putts: number | null;
    bunker: number;
    penalty: number;
    chips: number;
  }>>({});
  const [sideGameModal, setSideGameModal] = useState<{ type: string; hole: number } | null>(null);
  const [sideGameResult, setSideGameResult] = useState('');
  const [sideGameWinner, setSideGameWinner] = useState<string | null>(null);
  const [showShotLogger, setShowShotLogger] = useState(false);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [playerTotals, setPlayerTotals] = useState<Record<string, number>>({});
  const [holeData, setHoleData] = useState<Record<string, Record<number, { gross: number | null; pts: number | null }>>>({});
  const [editingHole, setEditingHole] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const syncStatus = useSyncStatus();
  const pendingCount = syncStatus.pendingCount;
  const [showConflicts, setShowConflicts] = useState(false);
  const [eagleAlert, setEagleAlert] = useState<{ type: EagleType; playerName: string; hole: number } | null>(null);
  const [continuingSecondary, setContinuingSecondary] = useState(false);
  const [broadcastMode, setBroadcastMode] = useState(false);
  const { width: screenWidth } = useWindowDimensions();
  const pagerRef = useRef<ScrollView>(null);
  const holeStripRef = useRef<ScrollView>(null);
  const gpsRef = useRef<{ lat: number; lng: number } | null>(null);
  const skipNextLoad = useRef(false);
  const liveActivityStarted = useRef(false);
  const [dayBoard, setDayBoard] = useState<{ playerId: string; name: string; pts: number }[]>([]);

  // Passive GPS — used only for tagging shot locations
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 5 },
        loc => { gpsRef.current = { lat: loc.coords.latitude, lng: loc.coords.longitude }; },
      );
    })();
    return () => { sub?.remove(); };
  }, []);

  useEffect(() => {
    async function load() {
      console.log('[enter.load] start', { matchId });
      let hadPack = false;
      try {
        // Local pack gives an instant paint on a slow/offline connection, but
        // it can be hours stale (14h TTL) and another device may have moved
        // the round on since — e.g. someone else picked up scoring after you
        // logged out. Never trust it as the final state: always follow up
        // with a live network fetch below, which overwrites it once it lands.
        const pack = await getMatchPack(matchId);
        if (pack) {
          hadPack = true;
          console.log('[enter.load] local pack found — instant paint');
          setMatch(pack.match as unknown as MatchInfo);
          setCourseHoles(pack.courseHoles);
          setCompPlayers(pack.compPlayers);
          const names: Record<string, string> = {};
          const avatars: Record<string, string | null> = {};
          Object.entries(pack.players).forEach(([id, p]) => {
            names[id] = p.display_name;
            avatars[id] = p.avatar_url ?? null;
          });
          setPlayerNames(names);
          setPlayerAvatars(avatars);
          setLoading(false);
        } else {
          console.log('[enter.load] no local pack — cold load');
        }

        // Always hit the network for the live, authoritative state.
        console.log('[enter.load] fetching match from network...');
        const { data: matchData, error: matchErr } = await supabase
          .from('matches')
          .select(`
            *,
            home_team:home_team_id(name,accent_color),
            away_team:away_team_id(name,accent_color),
            day:day_id(course_name,course_par,course_rating,slope_rating,day_number,competition:competition_id(format,include_in_kronos))
          `)
          .eq('id', matchId)
          .single();

        if (matchErr) throw matchErr;
        if (!matchData) { console.warn('[enter.load] no match found', { matchId }); setLoading(false); return; }
        console.log('[enter.load] match fetched', { matchId, status: matchData.status, round_format: matchData.round_format, handicap_method: (matchData as any).handicap_method });
        setMatch(matchData as unknown as MatchInfo);
        // Detect secondary stableford continuation after a reload
        if (matchData.round_format === 'matchplay' && matchData.secondary_format && matchData.status === 'in_progress') {
          const { concluded } = calcHoles(matchData.holes_string ?? '..................', matchData.holes_to_play ?? 18);
          if (concluded) setContinuingSecondary(true);
        }

        const allIds = [...(matchData.home_player_ids ?? []), ...(matchData.away_player_ids ?? [])];

        console.log('[enter.load] fetching holes + competition_players + players...', { playerCount: allIds.length });
        const [{ data: holesData }, { data: compData }, { data: playersData }] = await Promise.all([
          matchData.day?.course_name
            ? supabase.from('course_holes').select('hole_number,par,stroke_index,yardage,tee_yardages').eq('course_name', matchData.day.course_name).order('hole_number')
            : Promise.resolve({ data: [] }),
          matchData.competition_id && allIds.length
            ? supabase.from('competition_players').select('player_id,handicap_index').eq('competition_id', matchData.competition_id).in('player_id', allIds)
            : Promise.resolve({ data: [] }),
          allIds.length
            ? supabase.from('players').select('id,display_name,handicap_index,avatar_url').in('id', allIds)
            : Promise.resolve({ data: [] }),
        ]);

        if (holesData) setCourseHoles(holesData);
        if (playersData) {
          const names: Record<string, string> = {};
          const avatars: Record<string, string | null> = {};
          const fallback: CompPlayer[] = [];
          (playersData as any[]).forEach(p => {
            names[p.id] = p.display_name;
            avatars[p.id] = p.avatar_url ?? null;
            fallback.push({ player_id: p.id, handicap_index: p.handicap_index ?? 0 });
          });
          setPlayerNames(names);
          setPlayerAvatars(avatars);
          // Merge per-player rather than all-or-nothing: a player in the
          // match but not enrolled in competition_players (or with a null
          // handicap there) must still fall back to their own raw index,
          // not silently play off scratch just because SOME other player in
          // the match has a competition_players row.
          const comp = compData as CompPlayer[] | null;
          const compMap = new Map((comp ?? []).map(cp => [cp.player_id, cp]));
          const rawComp = fallback.map(f => compMap.get(f.player_id) ?? f);
          baseCompRef.current = rawComp;
          const povs = (matchData as any).player_overrides ?? {};
          const effectiveComp = rawComp.map(cp => {
            const ov = povs[cp.player_id];
            return ov?.hcp != null ? { ...cp, handicap_index: ov.hcp } : cp;
          });
          setCompPlayers(effectiveComp);
          console.log('[enter.load] holes/players/handicaps resolved', { holes: holesData?.length ?? 0, players: (playersData as any[]).length });
        }
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: playerRow } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
          if (playerRow) setMyPlayerId(playerRow.id);
        }
        console.log('[enter.load] done', { matchId });
      } catch (e) {
        console.error('[enter.load] failed', { matchId }, e);
        // If we already painted a cached pack, keep showing it rather than
        // replacing a perfectly good view with an error screen just because
        // this follow-up network refresh failed.
        if (!hadPack) setLoadError(true);
      } finally {
        console.log('[enter.load] finally — clearing loading', { matchId });
        setLoading(false);
      }
    }
    console.log('[enter] matchId changed, (re)loading', { matchId, retryTick });
    setLoading(true);
    setLoadError(false);
    load();
  }, [matchId, retryTick]);

  // Keep this screen live even while it's already open, so a hole entered
  // from another device (or the other phone picking up scoring) shows up
  // without needing to leave and reopen the round. This refreshes `match`
  // directly (silently — no spinner) rather than going through the full
  // load(), since re-running that on every hole save — including our own —
  // would flash the whole screen to a loading state mid-interaction.
  useEffect(() => {
    async function refreshMatchSilently() {
      const { data, error } = await supabase
        .from('matches')
        .select(`
          *,
          home_team:home_team_id(name,accent_color),
          away_team:away_team_id(name,accent_color),
          day:day_id(course_name,course_par,course_rating,slope_rating,day_number,competition:competition_id(format,include_in_kronos))
        `)
        .eq('id', matchId)
        .single();
      if (!error && data) setMatch(data as unknown as MatchInfo);
    }
    const sub = supabase
      .channel(`enter-${matchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches',    filter: `id=eq.${matchId}` },       refreshMatchSilently)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_holes', filter: `match_id=eq.${matchId}` }, refreshMatchSilently)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [matchId]);

  // ── Apple Watch sync ────────────────────────────────────────────
  useEffect(() => {
    if (!match) return;
    const homeLabel = match.home_team?.name ?? match.home_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
    const awayLabel = match.away_team?.name ?? match.away_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
    const holesStr = (match.holes_string ?? '..................').padEnd(18, '.').slice(0, 18);
    const currentHoleForWatch = holesStr.split('').findIndex(c => c === '.') + 1 || 19;
    sendMatchToWatch({
      matchId: match.id,
      matchNumber: match.match_number,
      homeLabel,
      awayLabel,
      homeColor: match.home_team?.accent_color ?? '#D4AF37',
      awayColor: match.away_team?.accent_color ?? '#6366f1',
      currentHole: currentHoleForWatch,
      holesString: holesStr,
    });
  }, [match?.holes_string]);

  // Start Live Activity once data is loaded
  useEffect(() => {
    if (loading || liveActivityStarted.current || !match || Object.keys(playerNames).length === 0) return;
    if (match.status !== 'in_progress') return;
    liveActivityStarted.current = true;
    const hs = (match.holes_string ?? '..................').padEnd(18, '.').slice(0, 18);
    const firstDot = hs.indexOf('.');
    const startHoleNum = firstDot >= 0 ? firstDot + 1 : 1;
    const holeInfo = courseHoles.find(h => h.hole_number === startHoleNum);
    const allIds = [...match.home_player_ids, ...match.away_player_ids];
    const sorted = [...allIds].sort((a, b) => (playerTotals[b] ?? 0) - (playerTotals[a] ?? 0));
    startLiveActivity({
      matchId: match.id,
      courseName: match.day?.course_name ?? 'Golf Course',
      hole: startHoleNum,
      par: holeInfo?.par ?? 4,
      holesLeft: hs.split('').filter(c => c === '.').length,
      format: match.round_format,
      players: allIds.map(id => ({
        name: (playerNames[id] ?? '').split(' ')[0],
        pts: playerTotals[id] ?? 0,
        isLeader: sorted[0] === id,
      })),
    });
  }, [loading, match?.id]);

  useEffect(() => {
    const unsub = onWatchScoreEntry(async (entry) => {
      if (!match || entry.matchId !== matchId) return;
      await processWatchScore(entry.hole, entry.result);
    });
    return () => unsub();
  }, [match]);

  // Clear watch only when leaving the scoring screen, not on every hole change
  useEffect(() => {
    return () => { clearMatchFromWatch(); };
  }, []);

  // Auto-scroll to Front 9 scorecard if game is already in progress
  useEffect(() => {
    if (!match || match.holes_string === '..................') return;
    const timer = setTimeout(() => {
      pagerRef.current?.scrollTo({ x: screenWidth, animated: false });
      setCurrentPage(1);
    }, 100);
    return () => clearTimeout(timer);
  }, [match?.id, screenWidth]);

  // Load running totals per player whenever a hole is scored
  useEffect(() => {
    if (!match) return;
    if (skipNextLoad.current) { skipNextLoad.current = false; return; }
    async function loadTotals() {
      const { data } = await supabase
        .from('match_holes')
        .select('player_id,hole_number,stableford_pts,gross_score')
        .eq('match_id', matchId);
      if (!data) return;
      const totals: Record<string, number> = {};
      const holes: Record<string, Record<number, { gross: number | null; pts: number | null }>> = {};
      for (const row of data as any[]) {
        const id = row.player_id;
        totals[id] = (totals[id] ?? 0) + (row.stableford_pts ?? 0);
        if (!holes[id]) holes[id] = {};
        holes[id][row.hole_number] = { gross: row.gross_score ?? null, pts: row.stableford_pts ?? null };
      }
      setPlayerTotals(totals);
      setHoleData(holes);
    }
    loadTotals();
  }, [match?.holes_string, matchId]);

  // Resend match data when Watch app opens and requests fresh state
  useEffect(() => {
    const unsub = onWatchRequestsState(() => {
      if (!match) return;
      const homeLabel = match.home_team?.name ?? match.home_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
      const awayLabel = match.away_team?.name ?? match.away_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
      const holesStr = (match.holes_string ?? '..................').padEnd(18, '.').slice(0, 18);
      const currentHoleForWatch = holesStr.split('').findIndex(c => c === '.') + 1 || 19;
      sendMatchToWatch({
        matchId: match.id,
        matchNumber: match.match_number,
        homeLabel,
        awayLabel,
        homeColor: match.home_team?.accent_color ?? '#D4AF37',
        awayColor: match.away_team?.accent_color ?? '#6366f1',
        currentHole: currentHoleForWatch,
        holesString: holesStr,
      });
    });
    return unsub;
  }, [match, playerNames]);

  async function processWatchScore(hole: number, holeResult: 'h' | 'f' | 'a') {
    if (!match) return;
    const chars = (match.holes_string ?? '..................').padEnd(18, '.').slice(0, 18).split('');
    chars[hole - 1] = holeResult;
    const newHolesStr = chars.join('');
    const watchSeqStr = holeSequence.map(h => newHolesStr[h - 1] ?? '.').join('');
    const { homeUp, played, remaining, concluded } = calcHoles(watchSeqStr, holesToPlay);

    let newStatus: 'upcoming' | 'in_progress' | 'complete' = 'in_progress';
    let winner: string | null = null;
    let result_str: string | null = null;

    if (concluded) {
      newStatus = 'complete';
      winner = homeUp > 0 ? 'home' : 'away';
      result_str = `${Math.abs(homeUp)}&${remaining}`;
    } else if (played === holesToPlay) {
      newStatus = 'complete';
      if (homeUp === 0) { winner = 'half'; result_str = 'Halved'; }
      else { winner = homeUp > 0 ? 'home' : 'away'; result_str = `${Math.abs(homeUp)}UP`; }
    }

    const timerFields: { started_at?: string; completed_at?: string } = {};
    if (!match.started_at) timerFields.started_at = new Date().toISOString();
    if (newStatus === 'complete' && !match.completed_at) timerFields.completed_at = new Date().toISOString();

    await supabase.from('matches')
      .update({ holes_string: newHolesStr, status: newStatus, winner, result_str, ...timerFields })
      .eq('id', match.id);

    setMatch({ ...match, holes_string: newHolesStr, status: newStatus, winner, result_str, ...timerFields });

    if (match.competition_id && newStatus !== 'complete' && [9, 12, 15].includes(hole)) {
      const homeTeam = match.home_team?.name ?? match.home_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
      const awayTeam = match.away_team?.name ?? match.away_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
      const at = hole === 9 ? 'the turn' : `hole ${hole}`;
      const scoreBody = homeUp > 0 ? `${homeTeam} ${homeUp}UP at ${at}` : homeUp < 0 ? `${awayTeam} ${Math.abs(homeUp)}UP at ${at}` : `All Square at ${at}`;
      sendMatchNotification(match.competition_id, `⛳ Match ${match.match_number}`, scoreBody);
    }

    if (newStatus === 'complete') {
      const homeDisplayName = match.home_team?.name ?? match.home_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
      const awayDisplayName = match.away_team?.name ?? match.away_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
      const winTeam = winner === 'home' ? homeDisplayName : winner === 'away' ? awayDisplayName : null;
      const msg = winner === 'half' ? 'Match Halved!' : `${winTeam} win ${result_str}!`;
      if (match.competition_id) {
        sendMatchNotification(match.competition_id, '🏆 Match Complete', msg, [...match.home_player_ids, ...match.away_player_ids]);
      }
      clearMatchFromWatch();
      Alert.alert('Match Complete', msg, [{ text: 'View Scorecard' }]);
    }
  }

  // ── Derived values ──────────────────────────────────────────────
  const holesStr = (match?.holes_string ?? '..................').padEnd(18, '.').slice(0, 18);
  const holeChars = holesStr.split('');
  // Infer start hole from first played hole in holes_string (fallback when URL param not present on re-entry)
  const inferredStartHole = (() => { const i = holeChars.findIndex(c => c !== '.'); return i >= 0 ? i + 1 : 1; })();
  const effectiveStartHole = startHole > 1 ? startHole : Math.max(1, match?.start_hole ?? inferredStartHole);
  const fullHoleSequence = effectiveStartHole > 1
    ? [...Array.from({ length: 19 - effectiveStartHole }, (_, i) => effectiveStartHole + i), ...Array.from({ length: effectiveStartHole - 1 }, (_, i) => i + 1)]
    : Array.from({ length: 18 }, (_, i) => i + 1);
  // A 9-hole round (front or back) only plays the first N holes of the
  // sequence — the rest are never meant to be scored, so completion and
  // "next hole" must stop there instead of wrapping into the unplayed 9.
  const holesToPlay = match?.holes_to_play ?? 18;
  const holeSequence = fullHoleSequence.slice(0, holesToPlay);
  // Reorder hole results to match play sequence so calcHoles reads them correctly
  const sequencedHolesStr = holeSequence.map(h => holeChars[h - 1] ?? '.').join('');
  const lastSequenceHole = holeSequence[holeSequence.length - 1] ?? 18;
  const currentHole = holeSequence.find(h => holeChars[h - 1] === '.') ?? (lastSequenceHole + 1);
  const activeHole = editingHole ?? currentHole;
  // Not `currentHole > lastSequenceHole` — lastSequenceHole is the literal
  // hole NUMBER at the last position of the play order, which is smaller
  // than currentHole for any wrapped (start hole > 1) sequence (e.g. a
  // hole-5 start plays ...17,18,1,2,3,4 — last position is hole 4, a lower
  // number than the 5-18 holes played earlier). Comparing raw hole numbers
  // there made every shifted-start round look complete from the first hole.
  // Also not `!holeSequence.includes(currentHole)` — the "all done" fallback
  // value (lastSequenceHole + 1) can coincidentally equal the sequence's own
  // start hole (e.g. start hole 5 wraps to last-position hole 4, fallback 5),
  // which IS in holeSequence, so that check would wrongly say "not filled"
  // for a genuinely complete round starting on hole 5. Count directly instead.
  const allHolesFilled = holeSequence.every(h => holeChars[h - 1] !== '.');
  const safeCurrentHole = Math.min(currentHole, 18);
  const isComplete = match?.status === 'complete';

  let lastPlayedHole = 0;
  for (let i = holeChars.length - 1; i >= 0; i--) {
    if (holeChars[i] !== '.') { lastPlayedHole = i + 1; break; }
  }

  const allPlayerIds = match ? [...match.home_player_ids, ...match.away_player_ids] : [];
  const shotAllocationInitials = Object.fromEntries(
    dedupeInitials(allPlayerIds.map(id => playerNames[id] ?? '?')).map((initials, i) => [allPlayerIds[i], initials])
  );
  const courseHole = courseHoles.find(h => h.hole_number === activeHole);
  // For the stroke-allocation panel: a front-9/back-9 round never plays the
  // other 9, so those holes shouldn't appear in a player's stroke list.
  const playedCourseHoles = courseHoles.filter(h => holeSequence.includes(h.hole_number));
  const holeYardage = courseHole
    ? ((teeColor && courseHole.tee_yardages?.[teeColor]) || courseHole.yardage || null)
    : null;

  const sideGameByHole = (match?.side_games ?? []).reduce((acc, sg) => {
    const [type, hole] = sg.split(':');
    if (hole) acc[parseInt(hole)] = type;
    return acc;
  }, {} as Record<number, string>);
  const currentSideGame = sideGameByHole[activeHole] ?? null;

  const [coachLoading, setCoachLoading] = useState(false);
  const voiceOff = !match?.side_games?.includes('voice:on');
  const statsOff = !!match?.side_games?.includes('stats:off');

  async function onCoachMe() {
    if (coachLoading || voiceOff) return;
    setCoachLoading(true);
    const firstNames = Object.values(playerNames).map(n => n.split(' ')[0]);
    try {
      await speakHole(safeCurrentHole, courseHole?.par ?? null, holeYardage, courseHole?.stroke_index ?? null, firstNames);
    } catch (e) {
      console.error('speakHole failed:', e);
    } finally {
      setCoachLoading(false);
    }
  }

  // Effective handicap used for matchplay stroke allocation. Standard method
  // is just the %-cut course handicap; 4BBB Stroke Matchplay and 4BBB
  // Stableford (main game only) instead play the lowest cut handicap in the
  // fourball off scratch and give everyone else shots relative to that
  // (Rick's spec — never applies to the Stableford side game, which always
  // stays on each player's own full handicap).
  function matchplayHcp(id: string): number {
    const base = playerCourseHcp(id, compPlayers, match?.day ?? null, match?.hcp_allowance ?? 100);
    if (match?.handicap_method !== 'relative_low' && match?.handicap_method !== 'relative_low_stableford') return base;
    const groupHcps = allPlayerIds.map(pid => playerCourseHcp(pid, compPlayers, match?.day ?? null, match?.hcp_allowance ?? 100));
    return Math.max(0, base - Math.min(...groupHcps));
  }

  // Players receiving a shot on the current hole
  const shotPlayerIds = courseHole
    ? allPlayerIds.filter(id => calcStrokesReceived(matchplayHcp(id), courseHole.stroke_index) >= 1)
    : [];

  const modalPlayerId = allPlayerIds[modalPlayerIdx] ?? null;
  const isHomePlayer = modalPlayerId ? match?.home_player_ids.includes(modalPlayerId) : false;
  const modalPlayerName = modalPlayerId ? (playerNames[modalPlayerId] ?? '?') : '';
  const modalTeamColor = isHomePlayer
    ? (match?.home_team?.accent_color ?? GOLD)
    : (match?.away_team?.accent_color ?? '#6366f1');
  const modalTeamName = isHomePlayer ? match?.home_team?.name : match?.away_team?.name;
  const modalPlayerAvatar = modalPlayerId
    ? (playerAvatars[modalPlayerId] ?? getPlayerAvatar(modalPlayerId, 'normal'))
    : null;
  const modalPlayerGetsShot = modalPlayerId && courseHole
    ? shotPlayerIds.includes(modalPlayerId)
    : false;

  // ── Score entry modal ───────────────────────────────────────────
  function openScoreModal(forHole?: number) {
    const hole = forHole ?? editingHole;
    const preScores: Record<string, number> = {};
    if (hole) {
      for (const id of allPlayerIds) {
        const g = holeData[id]?.[hole]?.gross;
        if (g != null) preScores[id] = g;
      }
    }
    const myIdx = myPlayerId ? allPlayerIds.indexOf(myPlayerId) : -1;
    const startIdx = !hole && myIdx >= 0 ? myIdx : 0;
    const firstId = allPlayerIds[startIdx];
    setHoleScores(preScores);
    setHoleStatMap({});
    setSelectedScore(hole && firstId ? (holeData[firstId]?.[hole]?.gross ?? null) : null);
    setSelectedFairway(null);
    setSelectedPutts(null);
    setSelectedBunker(0);
    setSelectedPenalty(0);
    setSelectedChips(0);
    setModalStartIdx(startIdx);
    setModalPlayerIdx(startIdx);
    setModalVisible(true);
  }

  function submitPlayerScore() {
    if (selectedScore === null || !modalPlayerId) return;

    const newScores = { ...holeScores, [modalPlayerId]: selectedScore };
    const newStats = {
      ...holeStatMap,
      [modalPlayerId]: {
        fairway: selectedFairway,
        putts: selectedPutts,
        bunker: selectedBunker,
        penalty: selectedPenalty,
        chips: selectedChips,
      },
    };
    setHoleScores(newScores);
    setHoleStatMap(newStats);
    const nextIdx = (modalPlayerIdx + 1) % allPlayerIds.length;
    if (nextIdx !== modalStartIdx) {
      const nextId = allPlayerIds[nextIdx];
      const nextExisting = editingHole ? (holeData[nextId]?.[editingHole]?.gross ?? null) : null;
      setSelectedScore(nextExisting);
      setSelectedFairway(null);
      setSelectedPutts(null);
      setSelectedBunker(0);
      setSelectedPenalty(0);
      setSelectedChips(0);
      setModalPlayerIdx(nextIdx);
    } else {
      setSelectedScore(null);
      setSelectedFairway(null);
      setSelectedPutts(null);
      setSelectedBunker(0);
      setSelectedPenalty(0);
      setSelectedChips(0);
      setModalVisible(false);
      processHoleScores(newScores, newStats);
    }
  }

  // ── Eagle/albatross/hole-in-one detection ──────────────────────
  function checkEagle(scores: Record<string, number>, par: number, hole: number) {
    let best: { type: EagleType; playerName: string } | null = null;
    for (const [id, gross] of Object.entries(scores)) {
      if (!gross) continue;
      const name = (playerNames[id] ?? 'Player').split(' ')[0];
      if (gross === 1) {
        best = { type: 'hole_in_one', playerName: name };
        break;
      } else if (gross <= par - 3 && best?.type !== 'hole_in_one') {
        best = { type: 'albatross', playerName: name };
      } else if (gross <= par - 2 && !best) {
        best = { type: 'eagle', playerName: name };
      }
    }
    if (best) setEagleAlert({ ...best, hole });
  }

  // ── Calculate and save hole result ──────────────────────────────
  async function processHoleScores(scores: Record<string, number>, stats: Record<string, { fairway: 'left' | 'centre' | 'right' | null; putts: number | null; bunker?: number; penalty?: number; chips?: number }> = {}) {
    if (!match || !courseHole) return;
    setSaving(true);
    const wasAlreadyComplete = match.status === 'complete';

    const si = courseHole.stroke_index;
    const par = courseHole.par;
    const day = match.day;

    const isStrokePlay = match.round_format === 'stableford' || match.round_format === 'medal';

    if (isStrokePlay) {
      // Compute all data first so we can queue offline if needed
      const spRows = allPlayerIds.map(id => {
        const hcp = playerCourseHcp(id, compPlayers, day, match.hcp_allowance ?? 100);
        const shots = calcStrokesReceived(hcp, si);
        const gross = scores[id] ?? null;
        const net = gross !== null ? gross - shots : null;
        // Medal with the Stableford side game switched off (secondary_format
        // null) shouldn't compute Stableford points at all — Rick: "clicked
        // off Stableford and it is running the side game" — the side game
        // itself (when it IS on) keeps this exact calculation, untouched.
        // Kronos is a separate, tournament-wide concern from that per-match
        // side game though — its individual totals are just a sum of this
        // same stableford_pts column (see src/lib/titanNews.ts), so a
        // Kronos-enabled tournament must always populate it regardless of
        // whether this particular day also has its own side game on
        // (Dave, 2026-08-19 — Kronos wasn't updating for a team day alongside it).
        const needsStablefordPts = match.round_format === 'stableford' || !!match.secondary_format || !!match.day?.competition?.include_in_kronos;
        return {
          match_id: matchId,
          player_id: id,
          hole_number: activeHole,
          score: 'd',
          gross_score: gross,
          net_score: net,
          stableford_pts: needsStablefordPts ? calcStablefordPoints(gross, par, shots) : null,
        };
      });

      const spStatRows = allPlayerIds
        .map(id => ({
          match_id: matchId,
          player_id: id,
          hole_number: activeHole,
          fairway_hit: courseHole.par >= 4 ? (stats[id]?.fairway != null ? stats[id]?.fairway === 'centre' : null) : null,
          fairway_direction: courseHole.par >= 4 ? (stats[id]?.fairway ?? null) : null,
          putts: stats[id]?.putts ?? null,
          bunker_shots:    (stats[id]?.bunker ?? 0) > 0 ? stats[id]!.bunker! : null,
          penalty_strokes: (stats[id]?.penalty ?? 0) > 0 ? stats[id]!.penalty! : null,
          chip_shots:      (stats[id]?.chips ?? 0) > 0 ? stats[id]!.chips! : null,
        }))
        .filter(r => r.fairway_direction !== null || r.putts !== null || r.bunker_shots !== null || r.penalty_strokes !== null || r.chip_shots !== null);

      const spChars = [...holeChars];
      spChars[activeHole - 1] = 'd';
      const newHolesStr = spChars.join('');
      const holesPlayed = newHolesStr.split('').filter(c => c !== '.').length;
      const isAlreadyComplete = match.status === 'complete';
      const newStatus: 'upcoming' | 'in_progress' | 'complete' = isAlreadyComplete ? 'complete' : 'in_progress';
      const startedAtField = !match.started_at ? { started_at: new Date().toISOString() } : {};
      const matchUpdate = isAlreadyComplete
        ? { holes_string: newHolesStr, status: 'complete' as const, winner: match.winner, result_str: match.result_str, ...startedAtField }
        : { holes_string: newHolesStr, status: 'in_progress' as const, winner: null as null, result_str: null as null, ...startedAtField };

      // Try drain before saving
      if (pendingCount > 0) await syncStatus.syncNow();

      let savedOffline = false;
      try {
        await supabase.from('match_holes').delete().eq('match_id', matchId).eq('hole_number', activeHole);
        const { error: insErr } = await supabase.from('match_holes').insert(spRows);
        if (insErr) throw insErr;
        if (spStatRows.length > 0) {
          await supabase.from('hole_stats').upsert(spStatRows, { onConflict: 'match_id,player_id,hole_number' });
        }
        const { error: updErr } = await supabase.from('matches').update(matchUpdate).eq('id', match.id);
        if (updErr) throw updErr;
      } catch (err: any) {
        if (isMissingMatchError(err)) {
          setSaving(false);
          Alert.alert('Round no longer exists', 'This round has been deleted and can\'t be scored. Head back and start a new one.', [
            { text: 'OK', onPress: () => router.replace('/(app)/' as any) },
          ]);
          return;
        }
        if (!isNetworkError(err)) {
          setSaving(false);
          Alert.alert('Error', String(err.message ?? err));
          return;
        }
        savedOffline = true;
        await enqueueHole({ matchId: matchId as string, holeNumber: activeHole, insertRows: spRows, statRows: spStatRows, matchUpdate });
        syncStatus.syncNow();
      }

      // Optimistic local update (same path online or offline)
      setSaving(false);
      skipNextLoad.current = true;
      setHoleData(prev => {
        const next: typeof prev = {};
        for (const [pid, holes] of Object.entries(prev)) next[pid] = { ...holes };
        for (const row of spRows) {
          if (!next[row.player_id]) next[row.player_id] = {};
          next[row.player_id][row.hole_number] = { gross: row.gross_score ?? null, pts: row.stableford_pts ?? null };
        }
        return next;
      });
      setPlayerTotals(prev => {
        const next = { ...prev };
        for (const row of spRows) {
          const oldPts = editingHole ? (holeData[row.player_id]?.[activeHole]?.pts ?? 0) : 0;
          next[row.player_id] = (prev[row.player_id] ?? 0) - oldPts + (row.stableford_pts ?? 0);
        }
        return next;
      });
      setMatch({ ...match, ...matchUpdate });
      setEditingHole(null);
      if (!editingHole) checkEagle(scores, par, activeHole);

      // Live Activity update
      {
        const newTotals: Record<string, number> = {};
        for (const id of allPlayerIds) {
          const old = editingHole ? (holeData[id]?.[activeHole]?.pts ?? 0) : 0;
          const row = spRows.find(r => r.player_id === id);
          newTotals[id] = (playerTotals[id] ?? 0) - old + (row?.stableford_pts ?? 0);
        }
        {
          const nextDot = newHolesStr.indexOf('.');
          const nextHole = nextDot >= 0 ? nextDot + 1 : activeHole;
          const nextPar = courseHoles.find(h => h.hole_number === nextHole)?.par ?? par;
          const sortedIds = [...allPlayerIds].sort((a, b) => (newTotals[b] ?? 0) - (newTotals[a] ?? 0));
          updateLiveActivity({
            hole: nextHole,
            par: nextPar,
            holesLeft: newHolesStr.split('').filter(c => c === '.').length,
            format: match.round_format,
            players: allPlayerIds.map(id => ({
              name: (playerNames[id] ?? '').split(' ')[0],
              pts: newTotals[id] ?? 0,
              isLeader: sortedIds[0] === id,
            })),
          });
        }
      }

      if (!savedOffline) {
        if (!editingHole && !wasAlreadyComplete && [6, 9, 12, 15, 16, 17, 18].includes(holeSequence.indexOf(activeHole) + 1)) {
          const updatedTotals = { ...playerTotals };
          for (const row of spRows) {
            updatedTotals[row.player_id] = (updatedTotals[row.player_id] ?? 0) + (row.stableford_pts ?? 0);
          }
          const standings = allPlayerIds.map(id => ({
            name: (playerNames[id] ?? 'Player').split(' ')[0],
            pts: updatedTotals[id] ?? 0,
          }));
          if (!voiceOff) speakPressure({ standings, holeNumber: activeHole, holesLeft: 18 - holesPlayed, format: 'stableford' });
        }

        // Notify other groups in the same day when this group scores their first hole
        if (!editingHole && holesPlayed === 1 && match.day_id) {
          supabase
            .from('matches')
            .select('home_player_ids, away_player_ids')
            .eq('day_id', match.day_id)
            .neq('id', match.id)
            .neq('status', 'cancelled')
            .then(({ data: dayMatches }) => {
              const otherIds = (dayMatches ?? []).flatMap(m => [
                ...(m.home_player_ids ?? []),
                ...(m.away_player_ids ?? []),
              ]);
              if (otherIds.length > 0) {
                sendMatchNotification(null as any, '⛳ Score update', 'Another group has started scoring — open Titan Golf to score your round.', otherIds);
              }
            });
        }
      }
      return;
    }

    // ── Match play branch ────────────────────────────────────────────
    const getNetScore = (id: string) => {
      const shots = calcStrokesReceived(matchplayHcp(id), si);
      return (scores[id] ?? 99) - shots;
    };

    // Main 4BBB Stableford (best-ball, points-based — not 4BBB Stroke
    // Matchplay, which stays net-strokes) decides the hole winner by each
    // side's best individual Stableford points at the MAIN game's own
    // handicap allowance — never the 100%-handicap background side game
    // (Rick: "two independent scoring calculations"). Comparing points this
    // way also automatically satisfies "a 0-point score can never win a
    // hole": points can't go negative, so 0 vs anything >0 always loses,
    // and 0-0 halves like any other tie.
    const isStablefordBestBall = match.round_format === 'matchplay' && !match.is_singles && match.handicap_method !== 'relative_low';

    let holeResult: 'h' | 'a' | 'f';
    if (isStablefordBestBall) {
      const getMainPts = (id: string) => {
        const shots = calcStrokesReceived(matchplayHcp(id), si);
        return calcStablefordPoints(scores[id] ?? 99, par, shots);
      };
      const homeBestPts = Math.max(...match.home_player_ids.map(getMainPts));
      const awayBestPts = Math.max(...match.away_player_ids.map(getMainPts));
      holeResult = homeBestPts > awayBestPts ? 'h' : awayBestPts > homeBestPts ? 'a' : 'f';
    } else {
      const homeNet = Math.min(...match.home_player_ids.map(getNetScore));
      const awayNet = Math.min(...match.away_player_ids.map(getNetScore));
      holeResult = homeNet < awayNet ? 'h' : awayNet < homeNet ? 'a' : 'f';
    }

    const rows = allPlayerIds.map(id => {
      const gross = scores[id] ?? null;
      // The background Stableford side game always runs off full handicap —
      // it's independent of whatever % allowance the primary matchplay match
      // is using (Rick: "Side game should always be 100%").
      const fullHcp = playerCourseHcp(id, compPlayers, day, 100);
      const sideShots = calcStrokesReceived(fullHcp, si);
      // Same as the stroke-play write path: only compute this when the
      // side game is actually switched on (secondary_format set) — toggling
      // it off must mean it stops running, not just stops being shown.
      // Kronos rides on this same column tournament-wide though, so a
      // Kronos-enabled competition needs it populated even when this
      // specific team match has no side game of its own switched on.
      const needsStablefordPts = !!match.secondary_format || !!match.day?.competition?.include_in_kronos;
      return {
        match_id: matchId,
        player_id: id,
        hole_number: activeHole,
        score: holeResult,
        gross_score: gross,
        stableford_pts: needsStablefordPts ? calcStablefordPoints(gross, par, sideShots) : null,
      };
    });

    const statRows = allPlayerIds
      .map(id => ({
        match_id: matchId,
        player_id: id,
        hole_number: activeHole,
        fairway_hit: courseHole.par >= 4 ? (stats[id]?.fairway != null ? stats[id]?.fairway === 'centre' : null) : null,
        fairway_direction: courseHole.par >= 4 ? (stats[id]?.fairway ?? null) : null,
        putts: stats[id]?.putts ?? null,
        bunker_shots:    (stats[id]?.bunker ?? 0) > 0 ? stats[id]!.bunker! : null,
        penalty_strokes: (stats[id]?.penalty ?? 0) > 0 ? stats[id]!.penalty! : null,
        chip_shots:      (stats[id]?.chips ?? 0) > 0 ? stats[id]!.chips! : null,
      }))
      .filter(r => r.fairway_direction !== null || r.putts !== null || r.bunker_shots !== null || r.penalty_strokes !== null || r.chip_shots !== null);

    const chars = [...holeChars];
    chars[activeHole - 1] = holeResult;
    const newHolesStr = chars.join('');
    const seqStr = holeSequence.map(h => newHolesStr[h - 1] ?? '.').join('');
    const { homeUp, played, remaining, concluded } = calcHoles(seqStr, holesToPlay);

    let newStatus: 'upcoming' | 'in_progress' | 'complete' = 'in_progress';
    let winner: string | null = null;
    let result_str: string | null = null;

    if (concluded) {
      newStatus = 'complete';
      winner = homeUp > 0 ? 'home' : 'away';
      result_str = `${Math.abs(homeUp)}&${remaining}`;
    } else if (played === holesToPlay) {
      newStatus = 'complete';
      if (homeUp === 0) { winner = 'half'; result_str = 'Halved'; }
      else { winner = homeUp > 0 ? 'home' : 'away'; result_str = `${Math.abs(homeUp)}UP`; }
    }

    if (continuingSecondary) {
      // Secondary stableford phase always continues to a full 18 regardless
      // of the primary format's hole count — that's the point of "continue".
      newStatus = played === 18 ? 'complete' : 'in_progress';
      winner = match.winner;
      result_str = match.result_str;
    }

    const timerFields2: { started_at?: string; completed_at?: string } = {};
    if (!match.started_at) timerFields2.started_at = new Date().toISOString();
    if (newStatus === 'complete' && !match.completed_at) timerFields2.completed_at = new Date().toISOString();
    const matchUpdate = { holes_string: newHolesStr, status: newStatus, winner, result_str, ...timerFields2 };

    // Try drain before saving
    if (pendingCount > 0) await syncStatus.syncNow();

    let savedOffline = false;
    try {
      await supabase.from('match_holes').delete().eq('match_id', matchId).eq('hole_number', activeHole);
      const { error: insErr } = await supabase.from('match_holes').insert(rows);
      if (insErr) throw insErr;
      if (statRows.length > 0) {
        await supabase.from('hole_stats').upsert(statRows, { onConflict: 'match_id,player_id,hole_number' });
      }
      const { error: updErr } = await supabase.from('matches').update(matchUpdate).eq('id', match.id);
      if (updErr) throw updErr;
    } catch (err: any) {
      if (isMissingMatchError(err)) {
        setSaving(false);
        Alert.alert('Round no longer exists', 'This round has been deleted and can\'t be scored. Head back and start a new one.', [
          { text: 'OK', onPress: () => router.replace('/(app)/' as any) },
        ]);
        return;
      }
      if (!isNetworkError(err)) {
        setSaving(false);
        Alert.alert('Error', String(err.message ?? err));
        return;
      }
      savedOffline = true;
      await enqueueHole({ matchId: matchId as string, holeNumber: activeHole, insertRows: rows, statRows, matchUpdate });
      syncStatus.syncNow();
    }

    // Optimistic local update
    setSaving(false);
    skipNextLoad.current = true;
    setHoleData(prev => {
      const next: typeof prev = {};
      for (const [pid, holes] of Object.entries(prev)) next[pid] = { ...holes };
      for (const row of rows) {
        if (!next[row.player_id]) next[row.player_id] = {};
        next[row.player_id][row.hole_number] = { gross: row.gross_score ?? null, pts: row.stableford_pts ?? null };
      }
      return next;
    });
    setPlayerTotals(prev => {
      const next = { ...prev };
      for (const row of rows) {
        const oldPts = editingHole ? (holeData[row.player_id]?.[activeHole]?.pts ?? 0) : 0;
        next[row.player_id] = (prev[row.player_id] ?? 0) - oldPts + (row.stableford_pts ?? 0);
      }
      return next;
    });
    setMatch({ ...match, ...matchUpdate });
    setEditingHole(null);

    // Live Activity update
    {
      const mpHolesLeft = newHolesStr.split('').filter(c => c === '.').length;
      if (newStatus === 'complete' && !continuingSecondary) {
        endLiveActivity();
      } else {
        const nextDot = newHolesStr.indexOf('.');
        const nextHole = nextDot >= 0 ? nextDot + 1 : activeHole;
        const nextPar = courseHoles.find(h => h.hole_number === nextHole)?.par ?? par;
        const mpHomeLabel = match.home_team?.name ?? match.home_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
        const mpAwayLabel = match.away_team?.name ?? match.away_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
        const mpScore = homeUp > 0
          ? `${mpHomeLabel} ${homeUp}UP`
          : homeUp < 0
          ? `${mpAwayLabel} ${Math.abs(homeUp)}UP`
          : 'All Square';
        updateLiveActivity({
          hole: nextHole,
          par: nextPar,
          holesLeft: mpHolesLeft,
          format: 'matchplay',
          players: [],
          matchScore: mpScore,
        });
      }
    }

    if (!savedOffline) {
      if (!editingHole) {
        if (match.competition_id && newStatus !== 'complete' && [9, 12, 15].includes(holeSequence.indexOf(activeHole) + 1)) {
          const homeTeam = match.home_team?.name ?? match.home_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
          const awayTeam = match.away_team?.name ?? match.away_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
          const { homeUp: newHomeUp } = calcHoles(seqStr, holesToPlay);
          const at = holeSequence.indexOf(activeHole) + 1 === 9 ? 'the turn' : `hole ${activeHole}`;
          const scoreBody = newHomeUp > 0
            ? `${homeTeam} ${newHomeUp}UP at ${at}`
            : newHomeUp < 0
              ? `${awayTeam} ${Math.abs(newHomeUp)}UP at ${at}`
              : `All Square at ${at}`;
          sendMatchNotification(match.competition_id, `⛳ Match ${match.match_number}`, scoreBody);
        }

        if (currentSideGame) {
          setSideGameResult('');
          setSideGameWinner(null);
          setSideGameModal({ type: currentSideGame, hole: activeHole });
        }

        if (match.competition_id) {
          for (const id of allPlayerIds) {
            const gross = scores[id];
            if (!gross) continue;
            const firstName = (playerNames[id] ?? '').split(' ')[0];
            const pids = [...(match.home_player_ids ?? []), ...(match.away_player_ids ?? [])];
            if (gross === 1) {
              sendMatchNotification(match.competition_id, '⛳ HOLE IN ONE!', `${firstName} just made a hole in one on hole ${activeHole}!`, pids);
            } else if (gross <= par - 2) {
              sendMatchNotification(match.competition_id, '🦅 Eagle!', `${firstName} just made an eagle on hole ${activeHole}!`, pids);
            } else if (gross === par - 1) {
              sendMatchNotification(match.competition_id, '🐦 Birdie!', `${firstName} is on fire — birdie on hole ${activeHole}!`, pids);
            }
          }
        }
        if (!editingHole) checkEagle(scores, par, activeHole);
      }

      if (newStatus === 'complete' && !wasAlreadyComplete) {
        const homeDisplayName = match.home_team?.name ?? match.home_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
        const awayDisplayName = match.away_team?.name ?? match.away_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
        const winTeam = winner === 'home' ? homeDisplayName : winner === 'away' ? awayDisplayName : null;
        const msg = winner === 'half' ? 'Match Halved!' : `${winTeam} win ${result_str}!`;
        if (match.competition_id) {
          const pids = [...(match.home_player_ids ?? []), ...(match.away_player_ids ?? [])];
          sendMatchNotification(match.competition_id, '🏆 Match Complete', msg, pids);
        }
        const allBroken = await Promise.all(allPlayerIds.map(id => checkAndUpdateRecords(matchId as string, id)));
        const broken = allBroken.flat();
        if (broken.length > 0) {
          setRecordsBroken(broken);
        } else if (continuingSecondary) {
          setContinuingSecondary(false);
        } else if (match.secondary_format && match.round_format === 'matchplay') {
          const secLabel = match.secondary_format === 'stableford' ? 'Stableford' : 'Stroke Play';
          Alert.alert(
            'Matchplay Complete',
            `${msg}\n\nYou have a ${secLabel} secondary game running — continue to finish all 18 holes.`,
            [
              { text: 'Finish Now', style: 'cancel' },
              { text: `Continue ${secLabel}`, onPress: () => {
                  setContinuingSecondary(true);
                  setMatch(prev => prev ? { ...prev, status: 'in_progress' } : prev);
                  supabase.from('matches').update({ status: 'in_progress' }).eq('id', matchId as string);
                } },
            ]
          );
        }
      }

      if (!editingHole && !wasAlreadyComplete && [9, 12, 15].includes(holeSequence.indexOf(activeHole) + 1)) {
        const homeTeam = match.home_team?.name ?? match.home_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
        const awayTeam = match.away_team?.name ?? match.away_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
        const { homeUp: newHomeUp, remaining: newRemaining } = calcHoles(seqStr, holesToPlay);
        if (!voiceOff) speakPressure({
          holeNumber: activeHole,
          holesLeft: newRemaining,
          format: 'matchplay',
          matchplay: { homeTeam, awayTeam, homeUp: newHomeUp, remaining: newRemaining },
        });
      }
    }
  }

  // Cross-group day leaderboard
  useEffect(() => {
    if (!match?.day_id) return;
    const dayId = match.day_id;

    async function loadDayBoard() {
      const { data: dayMatches } = await supabase
        .from('matches')
        .select('id, home_player_ids, away_player_ids, round_format')
        .eq('day_id', dayId)
        .neq('status', 'cancelled');

      if (!dayMatches || dayMatches.length < 2) return;

      const allMatchIds = dayMatches.map((m: any) => m.id);
      const allPlayerIds: string[] = [
        ...new Set(dayMatches.flatMap((m: any) => [
          ...(m.home_player_ids ?? []),
          ...(m.away_player_ids ?? []),
        ])) as any,
      ];

      const [{ data: playersData }, { data: holesData }] = await Promise.all([
        supabase.from('players').select('id, display_name').in('id', allPlayerIds),
        supabase.from('match_holes').select('player_id, stableford_pts').in('match_id', allMatchIds),
      ]);

      const nameMap: Record<string, string> = {};
      (playersData ?? []).forEach((p: any) => { nameMap[p.id] = p.display_name; });

      const totals: Record<string, number> = {};
      (holesData ?? []).forEach((h: any) => {
        if (h.stableford_pts != null) {
          totals[h.player_id] = (totals[h.player_id] ?? 0) + h.stableford_pts;
        }
      });

      const board = allPlayerIds
        .map(pid => ({
          playerId: pid,
          name: (nameMap[pid] ?? '?').split(' ')[0],
          pts: totals[pid] ?? 0,
        }))
        .sort((a, b) => b.pts - a.pts);

      setDayBoard(board);
    }

    loadDayBoard();

    console.log('[enter.dayBoardRealtime] subscribing', { channel: `day-lb-${dayId}` });
    const sub = supabase
      .channel(`day-lb-${dayId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_holes' }, () => {
        loadDayBoard();
      })
      .subscribe();

    return () => {
      console.log('[enter.dayBoardRealtime] unsubscribing', { channel: `day-lb-${dayId}` });
      supabase.removeChannel(sub);
    };
  }, [match?.day_id]);

  // ── Undo last hole ──────────────────────────────────────────────
  async function undoHole() {
    if (!match || saving || lastPlayedHole === 0) return;
    setSaving(true);

    await supabase.from('match_holes').delete()
      .eq('match_id', matchId)
      .eq('hole_number', lastPlayedHole);

    const chars = [...holeChars];
    chars[lastPlayedHole - 1] = '.';
    const newHolesStr = chars.join('');
    const { played } = calcHoles(newHolesStr);
    const newStatus = played === 0 ? 'upcoming' : 'in_progress';

    const { error } = await supabase.from('matches')
      .update({ holes_string: newHolesStr, status: newStatus, winner: null, result_str: null })
      .eq('id', match.id);

    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setMatch({ ...match, holes_string: newHolesStr, status: newStatus, winner: null, result_str: null });
  }

  async function saveSideGameResult() {
    if (!sideGameModal || !match) return;
    const { type, hole } = sideGameModal;
    const winnerName = sideGameWinner ? (playerNames[sideGameWinner] ?? '').split(' ')[0] : null;
    const existing = (match as any).side_game_results ?? {};
    const updated = { ...existing, [type]: { hole, result: sideGameResult, player: winnerName } };
    await supabase.from('matches').update({ side_game_results: updated } as any).eq('id', match.id);
    if (match.competition_id && sideGameResult) {
      const icon = type === 'Longest Drive' ? '🏌️' : '📍';
      const unit = type === 'Longest Drive' ? 'yards' : '';
      const body = winnerName
        ? `${winnerName} wins with ${sideGameResult}${unit ? ' ' + unit : ''} on hole ${hole}!`
        : `Result on hole ${hole}: ${sideGameResult}${unit ? ' ' + unit : ''}`;
      const pids = [...(match.home_player_ids ?? []), ...(match.away_player_ids ?? [])];
      sendMatchNotification(match.competition_id, `${icon} ${type}`, body, pids);
    }
    setSideGameModal(null);
  }

  async function handleReopenMatch() {
    if (!match || saving) return;
    setSaving(true);
    try {
      const update = { status: 'in_progress' as const, winner: null, result_str: null };
      const { error } = await supabase.from('matches').update(update).eq('id', match.id);
      if (error) throw error;
      setMatch({ ...match, ...update });
    } catch (err: any) {
      Alert.alert('Error', String(err?.message ?? err));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!editPlayerId || !match) return;
    const ov = (match.player_overrides ?? {})[editPlayerId];
    const base = baseCompRef.current.find(c => c.player_id === editPlayerId);
    setEditHcp(String(ov?.hcp ?? base?.handicap_index ?? ''));
    setEditTee(ov?.tee ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editPlayerId]);

  async function savePlayerOverride() {
    if (!editPlayerId || !match) return;
    const parsedHcp = parseFloat(editHcp);
    const base = baseCompRef.current.find(c => c.player_id === editPlayerId);
    const hcpChanged = !isNaN(parsedHcp) && parsedHcp !== (base?.handicap_index ?? 0);
    const existing = match.player_overrides ?? {};
    const newOvs: Record<string, any> = { ...existing };
    if (hcpChanged || editTee !== null) {
      newOvs[editPlayerId] = { hcp: hcpChanged ? parsedHcp : null, tee: editTee };
    } else {
      delete newOvs[editPlayerId];
    }
    await supabase.from('matches').update({ player_overrides: newOvs } as any).eq('id', match.id);
    setMatch({ ...match, player_overrides: newOvs });
    const updated = baseCompRef.current.map(cp => {
      const ov = newOvs[cp.player_id];
      return ov?.hcp != null ? { ...cp, handicap_index: ov.hcp } : cp;
    });
    setCompPlayers(updated);
    setEditPlayerId(null);
  }

  async function handleDeleteMatch() {
    Alert.alert('Delete Game?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await supabase.from('matches').delete().eq('id', matchId as string);
          router.replace('/(app)/' as any);
        },
      },
    ]);
  }

  async function handleCompleteRound() {
    if (!match || saving) return;
    setSaving(true);
    try {
      const matchUpdate = {
        status: 'complete' as const, winner: null, result_str: 'Complete',
        ...(match.completed_at ? {} : { completed_at: new Date().toISOString() }),
      };
      const { error } = await supabase.from('matches').update(matchUpdate).eq('id', match.id);
      if (error) throw error;
      setMatch({ ...match, ...matchUpdate });
      endLiveActivity();
      // Casual Golf's one final match report, auto-generated the moment the
      // round completes — no preview/day-1 reports like Tournament News,
      // and no admin review step since the player who just finished isn't
      // necessarily an admin (Dave, 2026-08-20, TODO item 5). Tournament
      // matches (competition_id set) already get their own News via the
      // admin-triggered flow in admin/news.tsx — skip here to avoid a
      // second, unwanted report on those.
      if (!match.competition_id) newsReportPromiseRef.current = generateCasualMatchReport(matchId as string);
      const allBroken = await Promise.all(allPlayerIds.map(id => checkAndUpdateRecords(matchId as string, id)));
      const broken = allBroken.flat();
      if (broken.length > 0) {
        setRecordsBroken(broken);
      }
    } catch (err: any) {
      Alert.alert('Error', String(err?.message ?? err));
    } finally {
      setSaving(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────
  if (loadError) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000', gap: 16, padding: 24 }}>
      <Text style={{ fontFamily: FFB, color: '#fff', fontSize: 16 }}>Couldn't load this round.</Text>
      <TouchableOpacity style={s.ctaBtn} onPress={() => setRetryTick(t => t + 1)} activeOpacity={0.85}>
        <Text style={s.ctaText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' }}>
      <ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  if (!match) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' }}>
      <Text style={{ fontFamily: FFB, color: '#fff' }}>Match not found.</Text>
    </View>
  );

  const isStrokePlay = match.round_format === 'stableford' || match.round_format === 'medal';
  const homeColor = match.home_team?.accent_color ?? GOLD;
  const awayColor = match.away_team?.accent_color ?? '#6366f1';
  const homeLabel = match.home_team?.name ?? match.home_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
  const awayLabel = match.away_team?.name ?? match.away_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
  const isMatchplay = match.round_format === 'matchplay';
  const isMedal = match.round_format === 'medal';
  const roundDuration = formatRoundDuration(match.started_at, match.completed_at);
  // Rick: the detailed player-by-player shot panel (this is the reference
  // "4BBB" look) should show for every multi-player format, not just
  // matchplay — Stableford/Medal groups were falling back to the simplified
  // "Gets a shot: X, Y" banner below instead, which he doesn't want anymore.
  // On a multi-group tournament day (dayBoard.length > 1) the ALL GROUPS
  // panel still wins instead, so that banner still covers that one case.
  const showInlineShots = dayBoard.length <= 1 && allPlayerIds.length > 1;

  const sortedLeaders = [...allPlayerIds].sort((a, b) => (playerTotals[b] ?? 0) - (playerTotals[a] ?? 0));
  const leaderId = sortedLeaders[0];
  const leaderPts = leaderId ? (playerTotals[leaderId] ?? 0) : 0;
  const leaderName = leaderId ? (playerNames[leaderId] ?? '').split(' ')[0] : null;
  // Single-player Stableford: "Ricky leads · 16pts" doesn't make sense with
  // nobody to lead against — just the points, the sub-line below already
  // shows "N holes to play". Stableford only.
  const isSinglePlayerStableford = match.round_format === 'stableford' && allPlayerIds.length === 1;

  // Medal is stroke play — ranked by gross-vs-par, never by the
  // stableford_pts sum `playerTotals` holds (that column always exists for
  // the independent side game/stats, main-game vs side-game, same
  // distinction the Scorecard and score-entry modal below make). Adding
  // more players must not turn Medal into a Stableford-scored game.
  const medalParByHole: Record<number, number> = {};
  courseHoles.forEach(h => { medalParByHole[h.hole_number] = h.par; });
  const medalStats: Record<string, { vsPar: number; played: number }> = {};
  for (const id of allPlayerIds) {
    const entries = Object.entries(holeData[id] ?? {}).filter(([, d]) => d.gross != null);
    medalStats[id] = {
      vsPar: entries.reduce((sum, [h, d]) => sum + ((d.gross ?? 0) - (medalParByHole[Number(h)] ?? 0)), 0),
      played: entries.length,
    };
  }
  const medalPlayedIds = allPlayerIds.filter(id => (medalStats[id]?.played ?? 0) > 0);
  const medalLeaderId = medalPlayedIds.length
    ? medalPlayedIds.reduce((best, id) => (medalStats[id].vsPar < medalStats[best].vsPar ? id : best), medalPlayedIds[0])
    : null;
  const medalLeaderName = medalLeaderId ? (playerNames[medalLeaderId] ?? '').split(' ')[0] : null;
  const medalLeaderText = medalLeaderId
    ? (allPlayerIds.length === 1
        ? formatVsPar(medalStats[medalLeaderId].vsPar)
        : `${medalLeaderName} leads · ${formatVsPar(medalStats[medalLeaderId].vsPar)}`)
    : null;

  const leaderStatusText = isMedal
    ? medalLeaderText
    : (leaderPts > 0 && (isStrokePlay || match.secondary_format)
        ? (isSinglePlayerStableford ? `${leaderPts}pts` : `${leaderName} leads · ${leaderPts}pts`)
        : null);
  const { homeUp: liveHomeUp } = calcHoles(sequencedHolesStr);
  const holesLeft = sequencedHolesStr.split('').filter(c => c === '.').length;

  const statusBannerText = isMatchplay
    ? (liveHomeUp === 0 ? 'All Square' : liveHomeUp > 0 ? `${homeLabel}  ${Math.abs(liveHomeUp)} Up` : `${awayLabel}  ${Math.abs(liveHomeUp)} Up`)
    : (leaderStatusText ?? `Hole ${currentHole}`);
  const statusBannerColor = isMatchplay ? (liveHomeUp >= 0 ? homeColor : awayColor) : GOLD;
  const statusBannerSub = isComplete ? 'Match complete' : holesLeft > 0 ? `${holesLeft} holes to play` : 'Last hole';

  const modalStatusText = editingHole
    ? `Editing Hole ${editingHole}`
    : isStrokePlay
      ? (leaderStatusText ?? `Hole ${currentHole} · ${holeChars.filter(c => c !== '.').length} played`)
      : liveHomeUp === 0 ? 'All Square'
        : liveHomeUp > 0 ? `${homeLabel} lead ${Math.abs(liveHomeUp)}UP`
        : `${awayLabel} lead ${Math.abs(liveHomeUp)}UP`;

  const formatLabel = isMatchplay ? 'Matchplay' : match.round_format === 'stableford' ? 'Stableford' : 'Stroke Play';

  // holeData[...].pts is the background 100%-handicap Stableford Side Game
  // value — it must stay untouched everywhere it already feeds playerTotals/
  // the "2nd Game" banner and final leaderboard above. This is a MAIN-GAME-
  // only copy, recomputed off the same stored gross scores at the match's
  // own handicap allowance, purely for the live Scorecard's pts cells below
  // (Rick: "Side Game must never visually overwrite the main game").
  const mainPtsHoleData = isStrokePlay ? holeData : (() => {
    const out: typeof holeData = {};
    for (const id of allPlayerIds) {
      out[id] = {};
      for (const [holeStr, rec] of Object.entries(holeData[id] ?? {})) {
        const h = Number(holeStr);
        const ch = courseHoles.find(c => c.hole_number === h);
        const mainPts = (rec.gross != null && ch)
          ? calcStablefordPoints(rec.gross, ch.par, calcStrokesReceived(matchplayHcp(id), ch.stroke_index))
          : null;
        out[id][h] = { gross: rec.gross, pts: mainPts };
      }
    }
    return out;
  })();

  return (
    <View style={(IS_PAD && broadcastMode) ? { flex: 1, flexDirection: 'row', backgroundColor: '#000' } : s.root}>
      <View style={(IS_PAD && broadcastMode) ? { width: 360, backgroundColor: '#000000', overflow: 'hidden' } : { flex: 1 }}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => {
            // router.back() pops whatever's on top of the native stack,
            // which differs by how this screen was reached (Day screen
            // pushes straight in; Preview replaces itself with this
            // screen) — same round_format, different exit depending on
            // setup flow. Go to an explicit destination instead so the
            // exit path is identical for every format, same as the
            // "Done Editing" CTA below.
            const dayId = match?.day_id ?? (match as any)?.day?.id;
            if (dayId) {
              router.replace(`/(app)/score/day/${dayId}` as any);
            } else {
              router.replace('/(app)/' as any);
            }
          }}
          style={s.headerSide}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerSub} numberOfLines={1}>
            {match.day?.course_name ? `${match.day.course_name} · ${formatLabel}` : formatLabel}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity onPress={handleDeleteMatch} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="trash-outline" size={20} color="#ffffff" />
          </TouchableOpacity>
          {IS_PAD && (
            <TouchableOpacity
              onPress={() => setBroadcastMode(b => !b)}
              activeOpacity={0.8}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                backgroundColor: broadcastMode ? '#D4AF37' : 'rgba(212,175,55,0.15)',
                borderWidth: 1,
                borderColor: '#D4AF37',
                borderRadius: 20,
                paddingHorizontal: 12,
                paddingVertical: 5,
              }}
            >
              <Ionicons name="tv-outline" size={13} color={broadcastMode ? '#000' : '#D4AF37'} />
              <Text style={{
                fontFamily: 'JUSTSans-ExBold',
                fontSize: 9,
                color: broadcastMode ? '#000' : '#D4AF37',
                letterSpacing: 1.5,
              }}>
                BROADCAST
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={s.headerSide}
            onPress={() => router.push(`/(app)/rangefinder?courseName=${encodeURIComponent(match?.day?.course_name ?? '')}&holeNumber=${safeCurrentHole}&fromMatchId=${matchId}` as any)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="scan-outline" size={22} color={GOLD} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Sync status ── */}
      <SyncBar status={syncStatus} onConflictsPress={() => setShowConflicts(true)} />
      <ConflictSheet
        visible={showConflicts}
        conflicts={syncStatus.conflicts}
        playerNames={playerNames}
        onResolve={async (id, useServer) => { await syncStatus.resolveAndRefresh(id, useServer); }}
        onClose={() => setShowConflicts(false)}
      />

      {/* ── Status banner ── */}
      <View style={s.statusBanner}>
        <Text style={[s.statusMain, { color: statusBannerColor }]}>{statusBannerText}</Text>
        {match.secondary_format && match.round_format === 'matchplay' && leaderPts > 0 && (
          <Text style={s.statusSecondary}>2nd Game: {leaderName} leads · {leaderPts}pts</Text>
        )}
        <Text style={s.statusSub}>{statusBannerSub}</Text>
      </View>

      {/* ── Hole strip ── */}
      <ScrollView
        ref={holeStripRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.holeStrip}
        style={s.holeStripWrap}
      >
        {Array.from({ length: 18 }, (_, i) => {
          const h = i + 1;
          const c = holeChars[h - 1] ?? '.';
          const isActive = h === activeHole;
          const isPlayed = c !== '.';
          const isCurrent = h === currentHole;
          const ch = courseHoles.find(x => x.hole_number === h);
          let resultColor = 'transparent';
          if (c === 'h') resultColor = homeColor;
          else if (c === 'a') resultColor = awayColor;
          else if (c === 'f') resultColor = '#4b5563';
          else if (c === 'd') {
            const grosses = allPlayerIds.map(id => holeData[id]?.[h]?.gross).filter((g): g is number => g != null);
            const bestGross = grosses.length ? Math.min(...grosses) : null;
            resultColor = bestGross !== null && ch ? SCORE_COLORS[scoreVsPar(bestGross, ch.par, 0)] : PLAIN;
          }
          return (
            <TouchableOpacity
              key={h}
              style={[
                s.holeTile,
                isActive && s.holeTileActive,
                isPlayed && { backgroundColor: `${resultColor}22`, borderColor: `${resultColor}60` },
              ]}
              onPress={() => {
                if (isPlayed) { setEditingHole(h); openScoreModal(h); }
              }}
              activeOpacity={0.7}
            >
              <Text allowFontScaling={false} style={[s.holeTileNum, isActive && { color: GOLD }]}>{h}</Text>
              <Text allowFontScaling={false} style={[s.holeTilePar, isActive && { color: `${GOLD}80` }]}>P{ch?.par ?? '?'}</Text>
              {isPlayed && isStrokePlay && (() => {
                const bestPts = Math.max(0, ...allPlayerIds.map(id => holeData[id]?.[h]?.pts ?? 0));
                return bestPts > 0 ? <Text allowFontScaling={false} style={[s.holeTilePts, { color: resultColor }]}>{bestPts}</Text> : null;
              })()}
              {isPlayed && !isStrokePlay && (
                <Text allowFontScaling={false} style={[s.holeTilePts, { color: resultColor }]}>
                  {c === 'h' ? 'H' : c === 'a' ? 'A' : '='}
                </Text>
              )}
              {isCurrent && !isPlayed && (
                <View style={[s.holeTileDot, { backgroundColor: GOLD, opacity: 0.6 }]} />
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View style={s.halfLabels}>
        <Text style={s.halfLabel}>FRONT 9</Text>
        <Text style={s.halfLabel}>BACK 9</Text>
      </View>

      {!isComplete ? (
        <>
          {/* ── Page swiper ── */}
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={e => setCurrentPage(Math.round(e.nativeEvent.contentOffset.x / screenWidth))}
            style={{ flex: 1 }}
          >
            {/* Page 0: current hole info */}
            <ScrollView
              style={{ width: screenWidth }}
              contentContainerStyle={s.pageContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {pendingCount > 0 && (
                <View style={s.offlineBanner}>
                  <Ionicons name="cloud-offline-outline" size={13} color="#fff" />
                  <Text style={s.offlineBannerText}>{pendingCount} score{pendingCount !== 1 ? 's' : ''} saved offline — will sync when connected</Text>
                </View>
              )}

              {/* Hole card */}
              <View style={s.holeCard}>
                <View style={s.holeCardTop}>
                  {/* Hole number block */}
                  <View style={[s.holeNumberBlock, isSinglePlayerStableford && { width: 170 }]}>
                    {allHolesFilled && !editingHole ? (
                      <>
                        <Ionicons name="trophy" size={48} color={GOLD} style={{ marginBottom: 6 }} />
                        <Text style={[s.holeWord, { fontSize: 14 }]}>GAME ENDED</Text>
                      </>
                    ) : (
                      <>
                        <Text style={s.holeWord}>HOLE</Text>
                        {/* Force one line regardless of the device's text-
                            size/zoom setting — without this, a 2-digit hole
                            number can wrap into a digit stacked on a digit
                            when Dynamic Type is scaled up. */}
                        <Text
                          style={[s.holeBig, isSinglePlayerStableford && s.holeBigSolo]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.5}
                          allowFontScaling={false}
                        >
                          {activeHole}
                        </Text>
                      </>
                    )}
                    <View style={s.holeChips}>
                      {courseHole && (
                        <>
                          <View style={[s.holeChip, isSinglePlayerStableford && s.holeChipSolo]}><Text style={[s.holeChipText, isSinglePlayerStableford && s.holeChipTextSolo]}>Par {courseHole.par}</Text></View>
                          <View style={[s.holeChip, isSinglePlayerStableford && s.holeChipSolo]}><Text style={[s.holeChipText, isSinglePlayerStableford && s.holeChipTextSolo]}>SI {courseHole.stroke_index}</Text></View>
                          {holeYardage ? <View style={[s.holeChip, isSinglePlayerStableford && s.holeChipSolo]}><Text style={[s.holeChipText, isSinglePlayerStableford && s.holeChipTextSolo]}>{holeYardage} YARDS</Text></View> : null}
                        </>
                      )}
                    </View>
                  </View>

                  <View style={s.holeCardDivider} />

                  {/* Leaderboard — cross-group (day_id) or single-group */}
                  {dayBoard.length > 1 ? (
                    <View style={s.leaderboard}>
                      <Text style={s.lbGroupHeader}>ALL GROUPS</Text>
                      {dayBoard.slice(0, 6).map((entry, rank) => {
                        const isLeader = rank === 0 && entry.pts > 0;
                        return (
                          <View key={entry.playerId} style={s.lbRow}>
                            <Text style={[s.lbRank, { color: isLeader ? GOLD : '#555' }]}>{rank + 1}</Text>
                            <Text style={[s.lbName, !isLeader && { opacity: 0.5 }]} numberOfLines={1}>{entry.name}</Text>
                            <Text style={[s.lbPts, { color: isLeader ? GOLD : '#fff' }]}>{entry.pts > 0 ? `${entry.pts}pts` : '—'}</Text>
                          </View>
                        );
                      })}
                      {dayBoard.length > 6 && (
                        <Text style={s.lbMore}>+{dayBoard.length - 6} more</Text>
                      )}
                    </View>
                  ) : showInlineShots ? (
                    <View style={s.leaderboard}>
                      <Text style={s.lbGroupHeader}>HOLES WITH EXTRA SHOTS</Text>
                      {allPlayerIds.map(id => {
                        const isHome = match.home_player_ids.includes(id);
                        const teamColor = isHome ? homeColor : awayColor;
                        const src = playerAvatars[id] ?? getPlayerAvatar(id, 'normal');
                        const firstName = (playerNames[id] ?? '?').split(' ')[0];
                        const shortName = shotAllocationInitials[id];
                        const hcp = matchplayHcp(id);
                        const getsShotHere = shotPlayerIds.includes(id);
                        return (
                          <TouchableOpacity key={id} style={s.lbRow} onPress={() => setEditPlayerId(id)} activeOpacity={0.7}>
                            <Avatar name={firstName} color={teamColor} size={32} source={src} />
                            {/* Fixed-width initials (not flex, unlike the
                                other s.lbName rows) — always 2 characters,
                                so the freed width goes to the stroke-holes
                                text instead. */}
                            <Text style={[s.lbName, { flex: 0, width: 32 }]} numberOfLines={1}>{shortName}</Text>
                            {getsShotHere && (
                              <View style={s.shotPill}>
                                <Text style={s.shotPillText}>SHOT</Text>
                              </View>
                            )}
                            <Text style={s.lbStrokes} numberOfLines={3}>{formatStrokeHoles(hcp, playedCourseHoles)}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : isSinglePlayerStableford ? (
                    <View style={s.soloStatBlock}>
                      <Avatar
                        name={playerNames[allPlayerIds[0]] ?? '?'}
                        color={homeColor}
                        size={44}
                        source={playerAvatars[allPlayerIds[0]] ?? getPlayerAvatar(allPlayerIds[0], 'normal')}
                      />
                      <Text style={s.soloStatName} numberOfLines={1}>
                        {(playerNames[allPlayerIds[0]] ?? '?').split(' ')[0].toUpperCase()}
                      </Text>
                      <Text style={s.soloStatPts}>{playerTotals[allPlayerIds[0]] ?? 0}</Text>
                      <Text style={s.soloStatPtsLabel}>PTS</Text>
                    </View>
                  ) : null}
                </View>

                {/* Mini leaderboard — Rick: this used to show here before the
                    SHOT-badge panel took over; wants it back underneath as
                    its own compact table (not replacing the SHOT panel),
                    which naturally pushes RANGE/SHOTS/LEADERS down. */}
                {showInlineShots && (() => {
                  const isStablefordScoreMode = match.round_format === 'stableford';
                  // Matchplay's main game (Singles/4BBB/4BBB Stroke all share
                  // this mechanic) is decided by holes up/down between the
                  // two sides, never a per-player stroke score — showing
                  // vsPar here was borrowed from Medal and read as "stroke
                  // play" on a 4BBB scoreboard. Each player's row now mirrors
                  // their own side's live status, same signed value already
                  // driving the status banner above (liveHomeUp).
                  const isVsParMode = !isStablefordScoreMode && !isMatchplay;
                  const matchplayStatus = (id: string) =>
                    match.home_player_ids.includes(id) ? liveHomeUp : -liveHomeUp;
                  const sorted = [...allPlayerIds].sort((a, b) => {
                    if (isMatchplay) return matchplayStatus(b) - matchplayStatus(a);
                    if (isVsParMode) {
                      const aPlayed = medalStats[a]?.played ?? 0;
                      const bPlayed = medalStats[b]?.played ?? 0;
                      if (aPlayed === 0 && bPlayed === 0) return 0;
                      if (aPlayed === 0) return 1;
                      if (bPlayed === 0) return -1;
                      return (medalStats[a]?.vsPar ?? 0) - (medalStats[b]?.vsPar ?? 0);
                    }
                    return (playerTotals[b] ?? 0) - (playerTotals[a] ?? 0);
                  });
                  const topScore = playerTotals[sorted[0]] ?? 0;
                  return (
                    <View style={s.miniLb}>
                      <Text style={s.lbGroupHeader}>LEADERBOARD</Text>
                      {sorted.map((id, rank) => {
                        const isHome = match.home_player_ids.includes(id);
                        const teamColor = isHome ? homeColor : awayColor;
                        const src = playerAvatars[id] ?? getPlayerAvatar(id, 'normal');
                        const firstName = (playerNames[id] ?? '?').split(' ')[0];
                        const total = playerTotals[id] ?? 0;
                        const status = matchplayStatus(id);
                        const scoreStr = isMatchplay
                          ? (status === 0 ? 'AS' : status > 0 ? `${status}UP` : `${Math.abs(status)}DN`)
                          : isVsParMode
                            ? ((medalStats[id]?.played ?? 0) > 0 ? formatVsPar(medalStats[id].vsPar) : '—')
                            : (total > 0 ? `${total}pts` : '—');
                        const isLeader = isMatchplay
                          ? status > 0
                          : isVsParMode
                            ? rank === 0 && (medalStats[id]?.played ?? 0) > 0
                            : rank === 0 && topScore > 0;
                        return (
                          <TouchableOpacity key={id} style={s.lbRow} onPress={() => setEditPlayerId(id)} activeOpacity={0.7}>
                            <Text style={[s.lbRank, { color: isLeader ? GOLD : '#555' }]}>{rank + 1}</Text>
                            <Avatar name={firstName} color={teamColor} size={28} source={src} />
                            <Text style={[s.lbName, !isLeader && { opacity: 0.5 }]} numberOfLines={1}>{firstName}</Text>
                            <Text style={[s.lbPts, { color: isLeader ? GOLD : '#fff' }]}>{scoreStr}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                })()}

                {/* Gets a shot — shown here whenever the inline SHOT-badge panel
                    above isn't the one rendering (non-Matchplay formats, or a
                    multi-group tournament day where ALL GROUPS wins instead). */}
                {shotPlayerIds.length > 0 && !showInlineShots && (
                  <View style={s.shotRow}>
                    <View style={s.shotBadge}>
                      <Ionicons name="golf-outline" size={12} color={GOLD} />
                      <Text style={s.shotText}>
                        Gets a shot: {shotPlayerIds.map(id => (playerNames[id] ?? '?').split(' ')[0]).join(', ')}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Quick actions */}
                <View style={s.actionsRow}>
                  <TouchableOpacity
                    style={s.actionBtn}
                    onPress={() => router.push(`/(app)/rangefinder?courseName=${encodeURIComponent(match?.day?.course_name ?? '')}&holeNumber=${safeCurrentHole}&fromMatchId=${matchId}` as any)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="scan-outline" size={20} color={GOLD} />
                    <Text style={s.actionLabel}>RANGE</Text>
                  </TouchableOpacity>
                  <View style={s.actionSep} />
                  <TouchableOpacity style={s.actionBtn} onPress={() => setShowShotLogger(true)} activeOpacity={0.7}>
                    <Ionicons name="analytics-outline" size={20} color={GOLD} />
                    <Text style={s.actionLabel}>SHOTS</Text>
                  </TouchableOpacity>
                  <View style={s.actionSep} />
                  <TouchableOpacity
                    style={s.actionBtn}
                    onPress={() => match.day_id && router.push(`/(app)/score/day/${match.day_id}` as any)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="trophy-outline" size={20} color={GOLD} />
                    <Text style={s.actionLabel}>LEADERS</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Side game banner */}
              {currentSideGame && (
                <View style={s.sideGameBanner}>
                  <Ionicons name={currentSideGame === 'Longest Drive' ? 'flag-outline' : 'locate-outline'} size={28} color={GOLD} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.sideGameBannerTitle}>{currentSideGame.toUpperCase()}</Text>
                    <Text style={s.sideGameBannerSub}>
                      {currentSideGame === 'Longest Drive'
                        ? 'Record your best drive in yards after scoring'
                        : 'Record the closest distance after scoring'}
                    </Text>
                  </View>
                </View>
              )}

              {/* Undo / edit */}
              {editingHole ? (
                <TouchableOpacity style={s.undoBtn} onPress={() => setEditingHole(null)} disabled={saving} activeOpacity={0.7}>
                  <Ionicons name="close-outline" size={16} color="#fff" />
                  <Text style={s.undoBtnText}>Cancel edit · Hole {editingHole}</Text>
                </TouchableOpacity>
              ) : lastPlayedHole > 0 ? (
                <TouchableOpacity style={s.undoBtn} onPress={undoHole} disabled={saving} activeOpacity={0.7}>
                  <Ionicons name="arrow-undo-outline" size={16} color="#fff" />
                  <Text style={s.undoBtnText}>Undo · Hole {lastPlayedHole}</Text>
                </TouchableOpacity>
              ) : null}

              {/* Page dots */}
              <View style={s.pageHint}>
                <View style={[s.pageDot, currentPage === 0 && s.pageDotActive]} />
                <View style={[s.pageDot, currentPage === 1 && s.pageDotActive]} />
                <View style={[s.pageDot, currentPage === 2 && s.pageDotActive]} />
              </View>
            </ScrollView>

            {/* Page 1: Front 9 scorecard */}
            <Scorecard
              startHole={1}
              allPlayerIds={allPlayerIds}
              playerNames={playerNames}
              holeData={mainPtsHoleData}
              courseHoles={courseHoles}
              matchHomeIds={match.home_player_ids}
              holeChars={holeChars}
              homeColor={homeColor}
              awayColor={awayColor}
              isStrokePlay={isStrokePlay}
              roundFormat={match.round_format}
              secondaryFormat={match.secondary_format}
              onUndo={undoHole}
              lastPlayedHole={lastPlayedHole}
              saving={saving}
              screenWidth={screenWidth}
            />

            {/* Page 2: Back 9 scorecard */}
            <Scorecard
              startHole={10}
              allPlayerIds={allPlayerIds}
              playerNames={playerNames}
              holeData={mainPtsHoleData}
              courseHoles={courseHoles}
              matchHomeIds={match.home_player_ids}
              holeChars={holeChars}
              homeColor={homeColor}
              awayColor={awayColor}
              isStrokePlay={isStrokePlay}
              roundFormat={match.round_format}
              secondaryFormat={match.secondary_format}
              onUndo={undoHole}
              lastPlayedHole={lastPlayedHole}
              saving={saving}
              screenWidth={screenWidth}
            />
          </ScrollView>

          {/* ── Enter score / Complete Round / Done Editing CTA ── */}
          <View style={s.ctaWrap}>
            {match.status === 'complete' ? (
              <TouchableOpacity
                style={s.ctaBtn}
                onPress={() => {
                  const dayId = match?.day_id ?? (match as any)?.day?.id;
                  if (dayId) {
                    router.replace(`/(app)/score/day/${dayId}` as any);
                  } else {
                    router.replace('/(app)/' as any);
                  }
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="checkmark-outline" size={20} color="#000000" />
                <Text style={s.ctaText}>Done Editing</Text>
              </TouchableOpacity>
            ) : allHolesFilled && !editingHole ? (
              <TouchableOpacity
                style={[s.ctaBtn, saving && { opacity: 0.5 }]}
                onPress={handleCompleteRound}
                disabled={saving}
                activeOpacity={0.85}
              >
                <Ionicons name="checkmark-circle-outline" size={20} color="#000000" />
                <Text style={s.ctaText}>Complete Round</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity
                  style={[s.ctaBtn, saving && { opacity: 0.5 }]}
                  onPress={() => openScoreModal()}
                  disabled={saving}
                  activeOpacity={0.85}
                >
                  <Ionicons name="create-outline" size={20} color="#000000" />
                  <Text style={s.ctaText}>
                    {editingHole ? `Edit Score · Hole ${editingHole}` : `Enter Score · Hole ${currentHole}`}
                  </Text>
                </TouchableOpacity>
                {!editingHole && (
                  <TouchableOpacity
                    style={[s.undoBtn, { marginTop: 10, marginBottom: 0 }]}
                    // replace, not push: spectate/[matchId] lives on a
                    // different root tab than this screen, so a push here
                    // is really a cross-tab jump — React Navigation keeps
                    // the score tab (this screen included, live realtime
                    // subscription and all) mounted in the background
                    // rather than unmounting it, since that's normal
                    // tab-persistence behavior. Confirmed live: the
                    // subscription's cleanup never ran after navigating
                    // away this way. Later re-entering the score tab fresh
                    // (e.g. the Home "Play" tile) then collides with that
                    // still-alive instance — Dave/Ross, 2026-08-20, "back
                    // out of spectate then Play crashes the app". replace()
                    // properly tears the screen down instead.
                    onPress={() => router.replace(`/(app)/spectate/${matchId}` as any)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="eye-outline" size={16} color="#6b7280" />
                    <Text style={s.undoBtnText}>Spectator — just watch, don't score</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </>
      ) : (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
          {/* Winner announcement */}
          <View style={s.completeHero}>
            <Ionicons name="trophy" size={48} color={GOLD} style={{ marginBottom: 12 }} />
            <Text style={s.completeTitle}>MATCH COMPLETE</Text>
            <Text
              style={s.completeResult}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
            >
              {match.result_str ?? 'Done'}
            </Text>
            <Text style={s.completeWinner}>
              {match.winner === 'half'
                ? 'Match Halved'
                : `${match.winner === 'home' ? homeLabel : awayLabel} Win`}
            </Text>
            {roundDuration && <Text style={s.completeDuration}>Round time: {roundDuration}</Text>}
            {!match.competition_id && (
              <TouchableOpacity
                style={[s.newsLinkBtn, openingReport && { opacity: 0.6 }]}
                disabled={openingReport}
                onPress={async () => {
                  setOpeningReport(true);
                  // Wait for the same generation call handleCompleteRound
                  // already kicked off — it may still be mid Claude-API
                  // round-trip. Already-resolved promises await instantly.
                  if (newsReportPromiseRef.current) await newsReportPromiseRef.current;
                  setOpeningReport(false);
                  router.push(`/(app)/news?matchId=${matchId}` as any);
                }}
                activeOpacity={0.85}
              >
                {openingReport
                  ? <ActivityIndicator size="small" color={GOLD} />
                  : <Ionicons name="newspaper-outline" size={16} color={GOLD} />}
                <Text style={s.newsLinkBtnText}>{openingReport ? 'Writing your report…' : 'Read Match Report'}</Text>
              </TouchableOpacity>
            )}
          </View>

          {(match.round_format === 'stableford' || match.secondary_format) && allPlayerIds.length > 0 && (
            <View style={s.summaryCard}>
              <Text style={s.summaryTitle}>
                {match.secondary_format ? '2ND GAME · STABLEFORD FINAL' : 'STABLEFORD FINAL'}
              </Text>
              {[...allPlayerIds]
                .sort((a, b) => (playerTotals[b] ?? 0) - (playerTotals[a] ?? 0))
                .map((id, i) => (
                  <View key={id} style={s.summaryRow}>
                    <Text style={[s.summaryRank, { color: i === 0 ? GOLD : '#6b7280' }]}>{i + 1}</Text>
                    <Text style={[s.summaryName, { color: i === 0 ? '#ffffff' : '#6b7280' }]}>
                      {(playerNames[id] ?? '?').split(' ')[0]}
                    </Text>
                    <Text style={[s.summaryScore, { color: i === 0 ? GOLD : '#6b7280' }]}>
                      {playerTotals[id] ?? 0}pts
                    </Text>
                  </View>
                ))}
            </View>
          )}

          {(match.round_format === 'stableford' || match.secondary_format) && allPlayerIds.length > 0 && Object.keys(holeData).length > 0 && (
            <View style={s.summaryCard}>
              <Text style={s.summaryTitle}>SCORING BREAKDOWN</Text>
              {allPlayerIds.map(id => {
                const holes = holeData[id] ?? {};
                let eagles = 0, birdies = 0, pars = 0, bogeys = 0, doubles = 0;
                for (const [holeNumStr, h] of Object.entries(holes)) {
                  if (h.gross == null) continue;
                  const ch = courseHoles.find(c => c.hole_number === Number(holeNumStr));
                  const cat = scoreVsPar(h.gross, ch?.par ?? 4, 0);
                  if (cat === 'eagle') eagles++;
                  else if (cat === 'birdie') birdies++;
                  else if (cat === 'par') pars++;
                  else if (cat === 'bogey') bogeys++;
                  else doubles++;
                }
                const holesPlayed = Object.keys(holes).length;
                if (holesPlayed === 0) return null;
                const firstName = (playerNames[id] ?? '?').split(' ')[0];
                const tiles = [
                  { label: 'EAGLE',  count: eagles,  bg: GOLD,      fg: '#000' },
                  { label: 'BIRDIE', count: birdies, bg: RED,       fg: '#000' },
                  { label: 'PAR',    count: pars,    bg: '#262626', fg: PLAIN },
                  { label: 'BOGEY',  count: bogeys,  bg: '#1e3a5f', fg: BLUE },
                  { label: 'DBL+',   count: doubles, bg: '#1e1b4b', fg: DARKBLUE },
                ].filter(t => t.count > 0);
                return (
                  <View key={id} style={{ marginBottom: 16 }}>
                    <Text style={{ fontFamily: FFB, fontSize: 13, color: '#fff', marginBottom: 8, letterSpacing: 0.5 }}>{firstName}</Text>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {tiles.map(t => (
                        <View key={t.label} style={{
                          flex: 1, backgroundColor: t.bg, borderRadius: 10,
                          paddingVertical: 10, alignItems: 'center',
                        }}>
                          <Text style={{ fontFamily: FFB, fontSize: 22, color: t.fg, lineHeight: 26 }}>{t.count}</Text>
                          <Text style={{ fontFamily: FFB, fontSize: 8, color: t.fg, opacity: 0.8, letterSpacing: 1, marginTop: 2 }}>{t.label}</Text>
                        </View>
                      ))}
                      {tiles.length === 0 && (
                        <Text style={{ fontFamily: FF, fontSize: 12, color: '#ffffff' }}>No scores yet</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {match.side_games && match.side_games.filter(sg => !sg.startsWith('voice')).length > 0 && (
            <View style={s.summaryCard}>
              <Text style={s.summaryTitle}>SIDE GAMES</Text>
              {match.side_games.filter(sg => !sg.startsWith('voice')).map(sg => {
                const type = sg.split(':')[0];
                const result = (match as any).side_game_results?.[type];
                return (
                  <View key={sg} style={s.summaryRow}>
                    <Ionicons name={type === 'Longest Drive' ? 'flag-outline' : 'locate-outline'} size={20} color={GOLD} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.summaryName}>{type}</Text>
                      <Text style={{ fontFamily: FFB, fontSize: 11, color: '#fff', marginTop: 2 }}>
                        {result ? `${result.player ? result.player + ' · ' : ''}${result.result}` : 'Not recorded'}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Scorecard pager */}
          <View style={{ height: 360, marginBottom: 8 }}>
            <ScrollView
              horizontal pagingEnabled
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={e => setCurrentPage(Math.round(e.nativeEvent.contentOffset.x / screenWidth))}
            >
              <Scorecard
                startHole={1}
                allPlayerIds={allPlayerIds}
                playerNames={playerNames}
                holeData={holeData}
                courseHoles={courseHoles}
                matchHomeIds={match.home_player_ids}
                holeChars={holeChars}
                homeColor={homeColor}
                awayColor={awayColor}
                isStrokePlay={isStrokePlay}
                roundFormat={match.round_format}
                secondaryFormat={match.secondary_format}
                onUndo={undoHole}
                lastPlayedHole={0}
                saving={saving}
                screenWidth={screenWidth}
              />
              <Scorecard
                startHole={10}
                allPlayerIds={allPlayerIds}
                playerNames={playerNames}
                holeData={holeData}
                courseHoles={courseHoles}
                matchHomeIds={match.home_player_ids}
                holeChars={holeChars}
                homeColor={homeColor}
                awayColor={awayColor}
                isStrokePlay={isStrokePlay}
                roundFormat={match.round_format}
                secondaryFormat={match.secondary_format}
                onUndo={undoHole}
                lastPlayedHole={0}
                saving={saving}
                screenWidth={screenWidth}
              />
            </ScrollView>
            <View style={s.pageHint}>
              <View style={[s.pageDot, currentPage === 0 && s.pageDotActive]} />
              <View style={[s.pageDot, currentPage === 1 && s.pageDotActive]} />
            </View>
          </View>

          {/* Done comes first — the obvious next step once you've checked the
              scorecard. Correct Hole / Edit Scores (below) both reopen the
              round, and used to sit above Done with no visual distinction
              from it, which read as "no way to just finish" (Rick, Stableford). */}
          <TouchableOpacity
            style={s.doneBtn}
            onPress={() => {
              const dayId = match?.day_id ?? (match as any)?.day?.id;
              if (dayId) {
                router.replace(`/(app)/score/day/${dayId}` as any);
              } else {
                router.replace('/(app)/' as any);
              }
            }}
            activeOpacity={0.85}
          >
            <Text style={s.doneBtnText}>Done</Text>
          </TouchableOpacity>

          {(lastPlayedHole > 0 || isStrokePlay) && (
            <Text style={s.fixMistakeLabel}>Made a mistake?</Text>
          )}

          {lastPlayedHole > 0 && (
            <TouchableOpacity
              style={s.undoBtn}
              onPress={() => Alert.alert(
                'Correct Last Hole?',
                `This will remove hole ${lastPlayedHole}'s score and reopen the match.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Correct', style: 'destructive', onPress: undoHole },
                ]
              )}
              disabled={saving}
            >
              <Ionicons name="arrow-undo-outline" size={16} color="#ffffff" />
              <Text style={s.undoBtnText}>Correct Hole {lastPlayedHole}</Text>
            </TouchableOpacity>
          )}

          {isStrokePlay && (
            <TouchableOpacity
              style={s.undoBtn}
              onPress={() => Alert.alert(
                'Edit Scores?',
                'This reopens the round so you can correct any hole.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Edit', onPress: handleReopenMatch },
                ]
              )}
              disabled={saving}
            >
              <Ionicons name="create-outline" size={16} color="#ffffff" />
              <Text style={s.undoBtnText}>Edit Scores</Text>
            </TouchableOpacity>
          )}

        </ScrollView>
      )}

      {saving && (
        <View style={s.savingIndicator}>
          <ActivityIndicator color={GOLD} size="small" />
        </View>
      )}

      {/* ── Edit player (round HCP / tee) ── */}
      {editPlayerId !== null && (() => {
        const name = playerNames[editPlayerId] ?? '?';
        const src = playerAvatars[editPlayerId] ?? getPlayerAvatar(editPlayerId, 'normal');
        const base = baseCompRef.current.find(c => c.player_id === editPlayerId);
        const isHome = match?.home_player_ids.includes(editPlayerId);
        const teamColor = isHome ? homeColor : awayColor;
        return (
          <Modal visible transparent animationType="slide" onRequestClose={() => setEditPlayerId(null)}>
            <TouchableOpacity style={sh.overlay} activeOpacity={1} onPress={() => setEditPlayerId(null)} />
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
              <View style={[sh.sheet, { paddingBottom: 44 }]}>
                <View style={sh.handle} />
                {/* Player identity */}
                <View style={{ alignItems: 'center', marginBottom: 20 }}>
                  <Avatar name={name.split(' ')[0]} color={teamColor} size={60} source={src} />
                  <Text style={[sh.playerName, { marginTop: 10, fontSize: 18 }]}>{name}</Text>
                  {base?.handicap_index != null && (
                    <Text style={{ fontFamily: FF, fontSize: 12, color: '#666', marginTop: 2 }}>
                      Profile HCP {base.handicap_index}
                    </Text>
                  )}
                </View>

                {/* HCP input */}
                <Text style={{ fontFamily: FFB, fontSize: 11, letterSpacing: 1.5, color: '#ffffff', marginBottom: 6 }}>ROUND HANDICAP</Text>
                <TextInput
                  style={[sh.hcpInput, { color: '#fff', borderColor: GOLD }]}
                  value={editHcp}
                  onChangeText={setEditHcp}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                />

                {/* Tee picker */}
                <Text style={{ fontFamily: FFB, fontSize: 11, letterSpacing: 1.5, color: '#ffffff', marginTop: 16, marginBottom: 8 }}>PLAYING TEES</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {TEE_OPTIONS.map(t => {
                    const sel = editTee === t.label;
                    return (
                      <TouchableOpacity
                        key={t.label}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, borderColor: sel ? t.color : '#333', backgroundColor: sel ? `${t.color}20` : 'transparent' }}
                        onPress={() => setEditTee(sel ? null : t.label)}
                        activeOpacity={0.7}
                      >
                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.color }} />
                        <Text style={{ fontFamily: FFB, fontSize: 13, color: sel ? t.color : '#888' }}>{t.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={{ fontFamily: FF, fontSize: 11, color: '#ffffff', textAlign: 'center', marginTop: 16 }}>
                  Changes apply to this round only
                </Text>

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
                  <TouchableOpacity
                    style={{ flex: 1, borderWidth: 1, borderColor: '#333', borderRadius: 10, paddingVertical: 13, alignItems: 'center' }}
                    onPress={() => setEditPlayerId(null)}
                    activeOpacity={0.8}
                  >
                    <Text style={{ fontFamily: FFB, fontSize: 15, color: '#ffffff' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 2, backgroundColor: GOLD, borderRadius: 10, paddingVertical: 13, alignItems: 'center' }}
                    onPress={savePlayerOverride}
                    activeOpacity={0.85}
                  >
                    <Text style={{ fontFamily: FFB, fontSize: 15, color: '#000' }}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        );
      })()}

      {/* ── Score entry sheet ── */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={sh.overlay}>
          <View style={sh.sheet}>
            <View style={sh.handle} />

            {/* Player header */}
            <View style={sh.playerRow}>
              <Avatar name={modalPlayerName} color={modalTeamColor} size={44} source={modalPlayerAvatar} />
              <View style={{ flex: 1 }}>
                <Text style={sh.playerName}>{modalPlayerName}</Text>
                <Text style={sh.playerInfo}>
                  {modalTeamName ? `${modalTeamName} · ` : ''}
                  Hole {activeHole} · Par {courseHole?.par ?? '?'} · SI {courseHole?.stroke_index ?? '?'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setModalVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color="#ffffff" />
              </TouchableOpacity>
            </View>

            {/* Gets a shot badge */}
            {modalPlayerGetsShot && (
              <View style={sh.shotBadge}>
                <Ionicons name="golf-outline" size={12} color={GOLD} />
                <Text style={sh.shotBadgeText}>Gets a shot on this hole</Text>
              </View>
            )}

            {/* Progress + status */}
            <View style={sh.progressRow}>
              {allPlayerIds.map((_, i) => (
                <View key={i} style={[sh.progressDot, i < modalPlayerIdx && sh.progressDotDone, i === modalPlayerIdx && sh.progressDotActive]} />
              ))}
            </View>
            <View style={sh.statusStrip}>
              <Text style={sh.statusStripText} numberOfLines={1}>{modalStatusText}</Text>
            </View>

            {/* Scrollable score content */}
            {(() => {
              const shots = modalPlayerId
                ? calcStrokesReceived(matchplayHcp(modalPlayerId), courseHole?.stroke_index ?? 18)
                : 0;
              const par = courseHole?.par ?? 4;
              const result = selectedScore ? scoreVsPar(selectedScore, par, shots) : null;
              const accent = result ? (SCORE_COLORS[result] ?? '#6b7280') : '#1c1c1c';
              // MAIN GAME points only — `shots` above already uses matchplayHcp
              // (the match's own hcp_allowance). The background Stableford side
              // game always runs off 100% handicap separately and must never be
              // shown here (Rick: "must never visually overwrite the main game").
              const stablePts = selectedScore ? calcStablefordPoints(selectedScore, par, shots) : null;
              const SCORE_LABELS: Record<string, string> = {
                albatross: 'ALBATROSS', eagle: 'EAGLE', birdie: 'BIRDIE',
                par: 'PAR', bogey: 'BOGEY', double: 'DOUBLE +',
              };
              const scoreLabel = result ? (SCORE_LABELS[result] ?? '') : '';
              const showStats = modalPlayerId === myPlayerId && !statsOff;

              return (
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28 }}>
                  {/* ── Score hero ── */}
                  <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 28 }}>
                      <TouchableOpacity
                        onPress={() => setSelectedScore(selectedScore === null ? par : Math.max(1, selectedScore - 1))}
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      >
                        <Ionicons name="remove-circle" size={42} color={selectedScore && selectedScore > 1 ? '#ffffff' : '#555'} />
                      </TouchableOpacity>

                      <View style={{
                        width: 100, height: 100, borderRadius: 50,
                        backgroundColor: selectedScore ? accent : '#111',
                        borderWidth: 2, borderColor: selectedScore ? accent : '#2c2c2c',
                        alignItems: 'center', justifyContent: 'center',
                        shadowColor: selectedScore ? accent : 'transparent',
                        shadowOffset: { width: 0, height: 0 }, shadowRadius: 20, shadowOpacity: 0.6,
                        elevation: 10,
                      }}>
                        <Text style={{ fontFamily: FFB, fontSize: 50, color: selectedScore ? (accent === PLAIN ? '#000' : '#fff') : '#2c2c2c', lineHeight: 56 }}>
                          {selectedScore ?? '?'}
                        </Text>
                      </View>

                      <TouchableOpacity
                        onPress={() => setSelectedScore(selectedScore === null ? par : Math.min(12, selectedScore + 1))}
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      >
                        <Ionicons name="add-circle" size={42} color="#ffffff" />
                      </TouchableOpacity>
                    </View>

                    <View style={{ alignItems: 'center', marginTop: 10, minHeight: 36 }}>
                      {selectedScore ? (
                        isMedal
                          ? (scoreLabel ? (
                              <Text style={{ fontFamily: FFB, fontSize: 16, color: '#fff', letterSpacing: 1 }}>{scoreLabel}</Text>
                            ) : null)
                          : stablePts !== null
                            ? (
                              <Text style={{ fontFamily: FFB, fontSize: 22, color: '#fff' }}>{stablePts}<Text style={{ fontFamily: FFB, fontSize: 13, color: '#fff' }}> pts</Text></Text>
                            )
                            : null
                      ) : (
                        <Text style={{ fontFamily: FF, fontSize: 13, color: '#ffffff' }}>tap a number or use arrows</Text>
                      )}
                    </View>
                  </View>

                  {/* ── Quick tap grid (2 rows × 5) ── */}
                  {[[1,2,3,4,5],[6,7,8,9,10]].map((row, ri) => (
                    <View key={ri} style={{ flexDirection: 'row', gap: 7, marginTop: ri === 0 ? 0 : 7 }}>
                      {row.map(n => {
                        const r = courseHole ? scoreVsPar(n, par, shots) : 'par';
                        const a = SCORE_COLORS[r] ?? '#6b7280';
                        const on = selectedScore === n;
                        return (
                          <TouchableOpacity
                            key={n}
                            style={{
                              flex: 1, height: 44, borderRadius: 10,
                              backgroundColor: on ? a : '#111',
                              borderWidth: 1.5, borderColor: on ? a : '#222',
                              alignItems: 'center', justifyContent: 'center',
                            }}
                            onPress={() => setSelectedScore(n)}
                            activeOpacity={0.7}
                          >
                            <Text style={{ fontFamily: FFB, fontSize: 16, color: on ? (a === PLAIN ? '#000' : '#fff') : '#fff' }}>{n}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ))}

                  {/* ── Fairway ── */}
                  {showStats && courseHole && courseHole.par >= 4 && (
                    <>
                      <Text style={[sh.pickerLabel, { marginTop: 18 }]}>FAIRWAY</Text>
                      <View style={sh.fairwayRow}>
                        {(['left', 'centre', 'right'] as const).map(d => (
                          <TouchableOpacity
                            key={d}
                            style={[sh.fairwayBtn, selectedFairway === d && sh.fairwayBtnOn]}
                            onPress={() => setSelectedFairway(prev => prev === d ? null : d)}
                            activeOpacity={0.7}
                          >
                            <Text style={[sh.fairwayText, selectedFairway === d && sh.fairwayTextOn]}>
                              {d === 'left' ? '◀ Left' : d === 'centre' ? '● Centre' : 'Right ▶'}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </>
                  )}

                  {/* ── Compact stat cards (2×2 grid) ── */}
                  {showStats && (
                    <View style={{ marginTop: 18 }}>
                      <Text style={sh.pickerLabel}>STATS</Text>
                      {([
                        [
                          { label: 'PUTTS',   val: selectedPutts,   opts: [1,2,3,4] as number[], display: (n: number) => n === 4 ? '3+' : String(n) },
                          { label: 'BUNKER',  val: selectedBunker,  opts: [0,1,2,3] as number[], display: (n: number) => n === 3 ? '3+' : String(n) },
                        ],
                        [
                          { label: 'PENALTY', val: selectedPenalty, opts: [0,1,2,3] as number[], display: (n: number) => n === 3 ? '3+' : String(n) },
                          { label: 'CHIPS',   val: selectedChips,   opts: [0,1,2,3] as number[], display: (n: number) => n === 3 ? '3+' : String(n) },
                        ],
                      ]).map((row, ri) => (
                        <View key={ri} style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                          {row.map(({ label, val, opts, display }) => (
                            <View key={label} style={{ flex: 1, backgroundColor: '#0a0a0a', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#1c1c1c' }}>
                              <Text style={{ fontFamily: FFB, fontSize: 9, color: '#ffffff', letterSpacing: 1.5, marginBottom: 7 }}>{label}</Text>
                              <View style={{ flexDirection: 'row', gap: 5 }}>
                                {opts.map(n => {
                                  const on = val === n;
                                  return (
                                    <TouchableOpacity
                                      key={n}
                                      style={{
                                        flex: 1, height: 34, borderRadius: 8,
                                        backgroundColor: on ? GOLD : '#151515',
                                        borderWidth: 1, borderColor: on ? GOLD : '#222',
                                        alignItems: 'center', justifyContent: 'center',
                                      }}
                                      onPress={() => {
                                        if (label === 'PUTTS') setSelectedPutts(on ? null : n);
                                        else if (label === 'BUNKER') setSelectedBunker(n);
                                        else if (label === 'PENALTY') setSelectedPenalty(n);
                                        else setSelectedChips(n);
                                      }}
                                      activeOpacity={0.7}
                                    >
                                      <Text style={{ fontFamily: FFB, fontSize: 12, color: on ? '#000' : '#fff' }}>{display(n)}</Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                            </View>
                          ))}
                        </View>
                      ))}
                    </View>
                  )}

                  {/* ── Submit ── */}
                  <TouchableOpacity
                    style={[sh.submitBtn, !selectedScore && sh.submitBtnOff, { marginTop: 20 }]}
                    onPress={submitPlayerScore}
                    disabled={!selectedScore}
                    activeOpacity={0.8}
                  >
                    <Text style={sh.submitText}>
                      {modalPlayerIdx < allPlayerIds.length - 1 ? `Next Player →` : '✓ Save Hole'}
                    </Text>
                  </TouchableOpacity>
                </ScrollView>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* ── Side game result modal ── */}
      <Modal visible={!!sideGameModal} transparent animationType="slide" onRequestClose={() => setSideGameModal(null)}>
        <View style={sh.overlay}>
          <View style={sh.sheet}>
            <View style={sh.handle} />
            <Text style={sh.sideGameTitle}>
              {sideGameModal?.type === 'Longest Drive' ? 'LONGEST DRIVE' : 'NEAREST THE PIN'}
            </Text>
            <Text style={sh.sideGameSub}>
              Hole {sideGameModal?.hole} · {sideGameModal?.type === 'Longest Drive' ? 'Distance in yards' : 'Distance to pin'}
            </Text>

            <TextInput
              style={sh.sideGameInput}
              value={sideGameResult}
              onChangeText={setSideGameResult}
              placeholder={sideGameModal?.type === 'Longest Drive' ? 'e.g. 285 yards' : 'e.g. 4ft 2in'}
              placeholderTextColor="#4b5563"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={sideGameModal?.type === 'Longest Drive' ? 'numeric' : 'default'}
            />

            <Text style={sh.pickerLabel}>WINNER (OPTIONAL)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {allPlayerIds.map(id => (
                <TouchableOpacity
                  key={id}
                  style={[sh.winnerBtn, sideGameWinner === id && sh.winnerBtnOn]}
                  onPress={() => setSideGameWinner(prev => prev === id ? null : id)}
                  activeOpacity={0.8}
                >
                  <Text style={[sh.winnerText, sideGameWinner === id && { color: '#ffffff' }]}>
                    {(playerNames[id] ?? '?').split(' ')[0]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={sh.submitBtn} onPress={saveSideGameResult} activeOpacity={0.85}>
              <Text style={sh.submitText}>Save Result</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ paddingVertical: 12, alignItems: 'center' }} onPress={() => setSideGameModal(null)} activeOpacity={0.7}>
              <Text style={{ fontFamily: FFB, fontSize: 14, color: '#fff' }}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Shot tracker ── */}
      <Modal visible={showShotLogger} transparent animationType="slide" onRequestClose={() => setShowShotLogger(false)}>
        <View style={sh.overlay}>
          <View style={[sh.sheet, { height: '75%' }]}>
            <View style={sh.handle} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontFamily: FFB, fontSize: 16, color: '#ffffff', letterSpacing: 1 }}>SHOT TRACKER</Text>
              <TouchableOpacity onPress={() => setShowShotLogger(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color="#ffffff" />
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1 }}>
              {matchId && <ShotLogger matchId={matchId} holeNumber={safeCurrentHole} />}
            </View>
          </View>
        </View>
      </Modal>

      {recordsBroken.length > 0 && (
        <RecordCelebration
          records={recordsBroken}
          onDismiss={() => setRecordsBroken([])}
        />
      )}

      <EagleAlert
        visible={!!eagleAlert}
        type={eagleAlert?.type ?? 'eagle'}
        playerName={eagleAlert?.playerName ?? ''}
        hole={eagleAlert?.hole ?? 0}
        onDismiss={() => setEagleAlert(null)}
      />
      </View>
      {(IS_PAD && broadcastMode) && (
        <>
          <GPSPanel
            courseName={match?.day?.course_name ?? null}
            holeNumber={activeHole}
            par={courseHole?.par ?? null}
            strokeIndex={courseHole?.stroke_index ?? null}
            yardage={courseHole?.yardage ?? null}
            teeYardages={courseHole?.tee_yardages ?? null}
          />
          <LeaderboardPanel
            allPlayerIds={allPlayerIds}
            playerNames={playerNames}
            playerTotals={playerTotals}
            matchHomeIds={match.home_player_ids}
            homeColor={homeColor}
            awayColor={awayColor}
            holeChars={holeChars}
            isStrokePlay={isStrokePlay}
            isMatchplay={isMatchplay}
            liveHomeUp={liveHomeUp}
            homeLabel={homeLabel}
            awayLabel={awayLabel}
          />
        </>
      )}
    </View>
  );
}

// ── Scorecard component ────────────────────────────────────────
interface ScorecardProps {
  startHole: number;
  allPlayerIds: string[];
  playerNames: Record<string, string>;
  holeData: Record<string, Record<number, { gross: number | null; pts: number | null }>>;
  courseHoles: CourseHole[];
  matchHomeIds: string[];
  holeChars: string[];
  homeColor: string;
  awayColor: string;
  isStrokePlay: boolean;
  roundFormat: string;
  secondaryFormat?: string | null;
  onUndo: () => void;
  lastPlayedHole: number;
  saving: boolean;
  screenWidth: number;
}

function Scorecard({ startHole, allPlayerIds, playerNames, holeData, courseHoles, matchHomeIds, holeChars, homeColor, awayColor, isStrokePlay, roundFormat, secondaryFormat, onUndo, lastPlayedHole, saving, screenWidth }: ScorecardProps) {
  const holes = Array.from({ length: 9 }, (_, i) => startHole + i);
  const title = startHole === 1 ? 'FRONT 9' : 'BACK 9';
  const totalPar = holes.reduce((a, h) => {
    const ch = courseHoles.find(c => c.hole_number === h);
    return a + (ch?.par ?? 0);
  }, 0);
  // Medal must always show gross strokes here, even with a Stableford side
  // game attached — the side game's points belong in its own "2ND GAME"
  // summary, never in the main Medal scorecard. secondaryFormat only flips
  // this on for Matchplay (the existing 4BBB Stroke Matchplay + side-game
  // inline-points feature).
  const showPts = roundFormat === 'stableford' || (roundFormat === 'matchplay' && !!secondaryFormat);

  return (
    <ScrollView style={{ width: screenWidth }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
      <View style={sc.container}>
        <Text style={sc.title}>{title}</Text>

        {/* Header row */}
        <View style={sc.headerRow}>
          <Text allowFontScaling={false} style={[sc.cell, sc.labelCell, { color: '#fff' }]}>HOLE</Text>
          {holes.map(h => (
            <Text allowFontScaling={false} key={h} style={[sc.cell, sc.holeCell, holeChars[h-1] !== '.' && { color: '#ffffff' }]}>{h}</Text>
          ))}
          <Text allowFontScaling={false} style={[sc.cell, sc.totalCell, { color: '#fff' }]}>TOT</Text>
        </View>

        {/* Par row */}
        {courseHoles.length > 0 && (
          <View style={[sc.row, { backgroundColor: '#0a0a0a' }]}>
            <Text allowFontScaling={false} style={[sc.cell, sc.labelCell, { color: GOLD }]}>PAR</Text>
            {holes.map(h => {
              const ch = courseHoles.find(c => c.hole_number === h);
              return <Text allowFontScaling={false} key={h} style={[sc.cell, sc.holeCell, { color: GOLD }]}>{ch?.par ?? '—'}</Text>;
            })}
            <Text allowFontScaling={false} style={[sc.cell, sc.totalCell, { color: GOLD }]}>{totalPar || '—'}</Text>
          </View>
        )}

        {/* SI row */}
        {courseHoles.length > 0 && (
          <View style={sc.row}>
            <Text allowFontScaling={false} style={[sc.cell, sc.labelCell, { color: '#fff' }]}>SI</Text>
            {holes.map(h => {
              const ch = courseHoles.find(c => c.hole_number === h);
              return <Text allowFontScaling={false} key={h} style={[sc.cell, sc.holeCell, { color: '#fff', fontSize: 9 }]}>{ch?.stroke_index ?? '—'}</Text>;
            })}
            <Text allowFontScaling={false} style={[sc.cell, sc.totalCell, { color: '#fff' }]}>—</Text>
          </View>
        )}

        {/* Player rows */}
        {allPlayerIds.map((id, pi) => {
          const isHome = matchHomeIds.includes(id);
          const teamColor = isHome ? homeColor : awayColor;
          const firstName = (playerNames[id] ?? '?').split(' ')[0];
          let totalGross = 0;
          let totalPts = 0;
          return (
            <View key={id} style={[sc.row, pi % 2 === 0 && { backgroundColor: '#0d0d0d' }]}>
              <View style={[sc.cell, sc.labelCell, { flexDirection: 'row', alignItems: 'center', gap: 5 }]}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: teamColor }} />
                <Text style={{ fontFamily: FFB, fontSize: 11, color: '#ffffff' }} numberOfLines={1}>{firstName}</Text>
              </View>
              {holes.map(h => {
                const score = holeData[id]?.[h];
                const gross = score?.gross;
                const pts = score?.pts;
                const played = holeChars[h - 1] !== '.';
                if (gross) totalGross += gross;
                if (pts) totalPts += pts;
                const ch = courseHoles.find(c => c.hole_number === h);
                const cellColor = gross != null && ch
                  ? SCORE_COLORS[scoreVsPar(gross, ch.par, 0)]
                  : gross ? PLAIN : '#333';
                return (
                  <View key={h} style={[sc.cell, sc.holeCell, { gap: 2 }]}>
                    {gross ? (
                      <>
                        <View style={[sc.scorePill, { borderColor: `${cellColor}50`, backgroundColor: `${cellColor}12` }]}>
                          <Text allowFontScaling={false} style={[sc.scorePillText, { color: cellColor }]}>
                            {showPts && pts != null ? pts : gross}
                          </Text>
                        </View>
                        {showPts && pts != null && (
                          <Text allowFontScaling={false} style={[sc.ptsText, { color: '#ffffff' }]}>{gross}</Text>
                        )}
                      </>
                    ) : (
                      <Text style={{ fontFamily: FFB, fontSize: 10, color: played ? '#444' : '#222', textAlign: 'center' }}>
                        {played ? '—' : ''}
                      </Text>
                    )}
                  </View>
                );
              })}
              <Text allowFontScaling={false} style={[sc.cell, sc.totalCell, { color: totalGross > 0 ? '#ffffff' : '#333' }]}>
                {showPts && totalPts > 0 ? `${totalPts}` : totalGross > 0 ? `${totalGross}` : '—'}
              </Text>
            </View>
          );
        })}

        {/* Matchplay result row */}
        {!isStrokePlay && (
          <View style={[sc.row, { backgroundColor: '#0a0a0a', borderTopWidth: 1, borderTopColor: '#1a1a1a' }]}>
            <Text allowFontScaling={false} style={[sc.cell, sc.labelCell, { color: '#fff' }]}>RESULT</Text>
            {holes.map(h => {
              const c = holeChars[h - 1];
              const color = c === 'h' ? homeColor : c === 'a' ? awayColor : c === 'f' ? '#4b5563' : 'transparent';
              return (
                <Text allowFontScaling={false} key={h} style={[sc.cell, sc.holeCell, { color, fontFamily: FFB }]}>
                  {c === 'h' ? 'H' : c === 'a' ? 'A' : c === 'f' ? '=' : ''}
                </Text>
              );
            })}
            <Text allowFontScaling={false} style={[sc.cell, sc.totalCell]} />
          </View>
        )}

        <Text style={sc.swipeHint}>← Swipe to switch ·</Text>
      </View>

      {lastPlayedHole > 0 && (
        <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 16, flexDirection: 'row', justifyContent: 'center', gap: 6 }} onPress={onUndo} disabled={saving} activeOpacity={0.7}>
          <Ionicons name="arrow-undo-outline" size={14} color="#ffffff" />
          <Text style={{ fontFamily: FFB, fontSize: 12, color: '#ffffff' }}>Edit Hole {lastPlayedHole}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

// ── Main styles ───────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 56, paddingHorizontal: 16, paddingBottom: 8,
  },
  headerSide:   { width: 40 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerLogo:   { width: 28, height: 28, marginBottom: 2 },
  headerSub:    { fontFamily: FFB, fontSize: 11, color: '#fff', letterSpacing: 0.5 },

  statusBanner: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16 },
  statusMain:   { fontFamily: FFB, fontSize: 22, letterSpacing: -0.3 },
  statusSecondary: { fontFamily: FFB, fontSize: 11, color: GOLD, marginTop: 2, letterSpacing: 0.5 },
  statusSub:    { fontFamily: FFB, fontSize: 12, color: '#fff', marginTop: 2 },

  holeStripWrap: { maxHeight: 72 },
  holeStrip:     { paddingHorizontal: 12, paddingVertical: 6, gap: 6, alignItems: 'center' },
  holeTile: {
    width: 42, height: 58, borderRadius: 10,
    backgroundColor: '#111111', borderWidth: 1, borderColor: '#1c1c1c',
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  holeTileActive: { borderColor: GOLD, borderWidth: 1.5 },
  holeTileNum:    { fontFamily: FFB, fontSize: 14, color: '#ffffff' },
  holeTilePar:    { fontFamily: FFB, fontSize: 9, color: '#fff' },
  holeTileDot:    { width: 6, height: 6, borderRadius: 3, marginTop: 1 },
  holeTilePts:    { fontFamily: FFB, fontSize: 11, marginTop: 1 },

  halfLabels: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingHorizontal: 12, paddingBottom: 4,
  },
  halfLabel: { fontFamily: FFB, fontSize: 8, color: '#ffffff', letterSpacing: 1.5 },

  pageContent: { padding: 16, paddingBottom: 24 },

  holeCard: {
    backgroundColor: '#111111', borderRadius: 16,
    borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden',
    marginBottom: 12,
  },
  holeCardTop:     { flexDirection: 'row', padding: 16, gap: 12 },
  holeCardDivider: { width: 1, backgroundColor: '#1c1c1c' },
  // Just wide enough for a comfortable 2-digit hole number (18 is the
  // widest we ever show) — was 110, which starved the player rows next to
  // it of width they needed for full names.
  holeNumberBlock: { width: 80, alignItems: 'flex-start', justifyContent: 'center', gap: 6 },
  holeWord:        { fontFamily: FFB, fontSize: 10, color: '#fff', letterSpacing: 2 },
  holeBig:         { fontFamily: FFB, fontSize: 64, color: '#ffffff', lineHeight: 68, letterSpacing: -2 },
  holeChips:       { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  holeChip: {
    borderWidth: 1, borderColor: '#2c2c2c', borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  holeChipText: { fontFamily: FFB, fontSize: 10, color: '#fff' },
  // Single-player Stableford — bigger, more prominent hole info per Rick's
  // spec, since there's a whole empty right-hand side to fill otherwise.
  holeBigSolo:     { fontSize: 88, lineHeight: 92 },
  holeChipSolo:    { paddingHorizontal: 9, paddingVertical: 4 },
  holeChipTextSolo:{ fontSize: 12 },

  leaderboard:    { flex: 1, justifyContent: 'center', gap: 10 },
  soloStatBlock:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  soloStatName:   { fontFamily: FFB, fontSize: 13, color: '#9ca3af', letterSpacing: 1.5, marginTop: 6 },
  soloStatPts:    { fontFamily: FFB, fontSize: 40, color: GOLD, lineHeight: 44 },
  soloStatPtsLabel: { fontFamily: FFB, fontSize: 11, color: '#9ca3af', letterSpacing: 2 },
  lbGroupHeader:  { fontFamily: FFB, fontSize: 9, color: GOLD, letterSpacing: 2, marginBottom: 2 },
  lbRow:          { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lbRank:         { fontFamily: FFB, fontSize: 12, width: 18, textAlign: 'center' },
  lbName:         { flex: 1, fontFamily: FFB, fontSize: 13, color: '#ffffff' },
  lbPts:          { fontFamily: FFB, fontSize: 13 },
  lbStrokes:      { flex: 1, fontFamily: FFB, fontSize: 10, color: '#9ca3af', textAlign: 'right', lineHeight: 13 },
  lbMore:         { fontFamily: FFB, fontSize: 11, color: '#ffffff', textAlign: 'center', marginTop: 2 },
  shotPill: {
    backgroundColor: GOLD, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
  },
  shotPillText: { fontFamily: FFB, fontSize: 9, color: '#000', letterSpacing: 0.5 },

  miniLb: {
    paddingHorizontal: 16, paddingVertical: 12, gap: 8,
    borderTopWidth: 1, borderTopColor: '#1a1a1a',
  },
  shotRow: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: '#1a1a1a',
  },
  shotBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: `${GOLD}0d`, borderWidth: 1, borderColor: `${GOLD}25`,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  shotText: { fontFamily: FFB, fontSize: 12, color: GOLD },

  actionsRow: {
    flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#1a1a1a',
  },
  actionBtn:   { flex: 1, alignItems: 'center', paddingVertical: 14, gap: 4 },
  actionLabel: { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 1.5 },
  actionSep:   { width: 1, backgroundColor: '#1a1a1a' },

  sideGameBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: `${GOLD}0d`, borderRadius: 12,
    borderWidth: 1.5, borderColor: `${GOLD}40`,
    paddingHorizontal: 14, paddingVertical: 12,
    marginBottom: 12,
  },
  sideGameBannerTitle: { fontFamily: FFB, fontSize: 13, color: GOLD, letterSpacing: 1 },
  sideGameBannerSub:   { fontFamily: FFB, fontSize: 11, color: '#fff', marginTop: 2 },

  undoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#111111', borderRadius: 12, borderWidth: 1, borderColor: '#1c1c1c',
    paddingVertical: 12, marginBottom: 12,
  },
  undoBtnText: { fontFamily: FFB, fontSize: 13, color: '#fff' },
  doneBtn: {
    backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginTop: 8, marginBottom: 32,
  },
  doneBtnText: { fontFamily: FFB, fontSize: 18, color: '#000' },
  fixMistakeLabel: { fontFamily: FFB, fontSize: 11, color: '#6b7280', textAlign: 'center', marginBottom: 8, letterSpacing: 0.5 },
  deleteLink:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 16, marginBottom: 8 },
  deleteLinkText: { fontFamily: FFB, fontSize: 12, color: '#ffffff' },

  pageHint:       { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: 8 },
  pageDot:        { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2c2c2c' },
  pageDotActive:  { backgroundColor: GOLD, width: 18 },

  ctaWrap: { paddingHorizontal: 16, paddingBottom: 32, paddingTop: 8, backgroundColor: '#000000' },
  ctaBtn: {
    backgroundColor: GOLD, borderRadius: 14,
    paddingVertical: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  ctaText: { fontFamily: FFB, fontSize: 17, color: '#000000' },

  completeHero: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24 },
  completeTitle: { fontFamily: FFB, fontSize: 10, color: '#fff', letterSpacing: 3, marginBottom: 8 },
  completeResult: { fontFamily: FFB, fontSize: 56, color: GOLD, letterSpacing: 2 },
  completeWinner: { fontFamily: FFB, fontSize: 18, color: '#ffffff', marginTop: 4 },
  completeDuration: { fontFamily: FFB, fontSize: 12, color: '#9ca3af', marginTop: 10 },
  newsLinkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16,
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20,
    borderWidth: 1, borderColor: `${GOLD}40`, backgroundColor: `${GOLD}10`,
  },
  newsLinkBtnText: { fontFamily: FFB, fontSize: 12, color: GOLD },

  summaryCard: {
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c', padding: 14,
  },
  summaryTitle: { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 2, marginBottom: 12 },
  summaryRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  summaryRank:  { fontFamily: FFB, fontSize: 14, width: 20, textAlign: 'center' },
  summaryName:  { flex: 1, fontFamily: FFB, fontSize: 14, color: '#ffffff' },
  summaryScore: { fontFamily: FFB, fontSize: 16 },

  savingIndicator: {
    position: 'absolute',
    bottom: 40, alignSelf: 'center',
    backgroundColor: '#111111',
    borderRadius: 20, padding: 12,
    borderWidth: 1, borderColor: '#1c1c1c',
  },

  offlineBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1c1c1c', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginHorizontal: 16, marginBottom: 8 },
  offlineBannerText: { flex: 1, fontFamily: 'JUSTSans-ExBold', fontSize: 11, color: '#fff' },
});

// ── Score sheet styles ────────────────────────────────────────
const sh = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#111111',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, maxHeight: '92%',
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#333', alignSelf: 'center', marginVertical: 14 },

  playerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginBottom: 12, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  playerName: { fontFamily: FFB, fontSize: 18, color: '#ffffff' },
  playerInfo: { fontFamily: FFB, fontSize: 11, color: '#fff', marginTop: 2 },
  hcpInput: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontFamily: FFB, fontSize: 16,
  },

  shotBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: `${GOLD}0d`, borderWidth: 1, borderColor: `${GOLD}30`,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    alignSelf: 'flex-start', marginBottom: 10,
  },
  shotBadgeText: { fontFamily: FFB, fontSize: 12, color: GOLD },

  progressRow:   { flexDirection: 'row', gap: 8, marginBottom: 8 },
  progressDot:   { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1c1c1c', borderWidth: 1, borderColor: '#2c2c2c' },
  progressDotDone:   { backgroundColor: '#333' },
  progressDotActive: { backgroundColor: GOLD, borderColor: GOLD },

  statusStrip: {
    backgroundColor: '#1a1a1a', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 4,
    marginBottom: 4, borderWidth: 1, borderColor: '#2c2c2c', alignSelf: 'flex-start',
  },
  statusStripText: { fontFamily: FFB, fontSize: 11, color: GOLD, letterSpacing: 0.5 },

  pickerLabel: { fontFamily: FFB, fontSize: 9, color: GOLD, letterSpacing: 2, marginBottom: 10, marginTop: 16 },

  scoreGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  scoreBtn: {
    width: 62, height: 62, borderRadius: 14,
    backgroundColor: '#232323', borderWidth: 1.5, borderColor: '#444',
    alignItems: 'center', justifyContent: 'center',
  },
  scoreBtnText: { fontFamily: FFB, fontSize: 26, color: '#ffffff' },
  scoreDiff:    { fontFamily: FFB, fontSize: 9, marginTop: 1 },

  fairwayRow: { flexDirection: 'row', gap: 8 },
  fairwayBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    backgroundColor: '#232323', borderWidth: 1.5, borderColor: '#444', alignItems: 'center',
  },
  fairwayBtnOn:  { backgroundColor: GOLD, borderColor: GOLD },
  fairwayText:   { fontFamily: FFB, fontSize: 14, color: '#fff' },
  fairwayTextOn: { color: '#000' },

  puttsRow: { flexDirection: 'row', gap: 8 },
  puttsBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    backgroundColor: '#232323', borderWidth: 1.5, borderColor: '#444', alignItems: 'center',
  },
  puttsBtnOn:  { backgroundColor: BLUE, borderColor: BLUE },
  puttsText:   { fontFamily: FFB, fontSize: 18, color: '#fff' },
  puttsTextOn: { color: '#fff' },

  submitBtn: {
    marginTop: 24, backgroundColor: GOLD, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  submitBtnOff: { opacity: 0.35 },
  submitText:   { fontFamily: FFB, fontSize: 16, color: '#000000' },

  sideGameTitle: { fontFamily: FFB, fontSize: 16, color: GOLD, letterSpacing: 1.5, marginBottom: 4 },
  sideGameSub:   { fontFamily: FFB, fontSize: 11, color: '#fff', marginBottom: 16 },
  sideGameInput: {
    width: '100%', backgroundColor: '#1a1a1a', borderRadius: 12,
    borderWidth: 1, borderColor: '#2c2c2c',
    paddingHorizontal: 14, paddingVertical: 14,
    fontFamily: FFB, fontSize: 18, color: '#ffffff', textAlign: 'center',
    marginBottom: 16,
  },
  winnerBtn:    { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#2c2c2c', backgroundColor: '#1a1a1a' },
  winnerBtnOn:  { borderColor: GOLD, backgroundColor: `${GOLD}15` },
  winnerText:   { fontFamily: FFB, fontSize: 14, color: '#fff' },
});

// ── Scorecard styles ──────────────────────────────────────────
const sc = StyleSheet.create({
  container:    { backgroundColor: '#111111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden', marginBottom: 12 },
  title:        { fontFamily: FFB, fontSize: 10, color: GOLD, letterSpacing: 2, padding: 12, paddingBottom: 4 },
  headerRow:    { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', backgroundColor: '#0a0a0a' },
  row:          { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#141414' },
  cell:         { alignItems: 'center', justifyContent: 'center' },
  labelCell:    { width: 60, paddingLeft: 10, alignItems: 'flex-start' },
  holeCell:     { flex: 1, fontFamily: FFB, fontSize: 11, color: '#fff', textAlign: 'center' },
  totalCell:    { width: 34, fontFamily: FFB, fontSize: 11, color: '#ffffff', textAlign: 'center' },
  scorePill:    { borderWidth: 1, borderRadius: 5, paddingHorizontal: 4, paddingVertical: 1, minWidth: 20, alignItems: 'center' },
  scorePillText: { fontFamily: FFB, fontSize: 11 },
  ptsText:      { fontFamily: FFB, fontSize: 9, textAlign: 'center' },
  swipeHint:    { fontFamily: FFB, fontSize: 10, color: '#1a1a1a', textAlign: 'center', padding: 10, letterSpacing: 1 },
});
