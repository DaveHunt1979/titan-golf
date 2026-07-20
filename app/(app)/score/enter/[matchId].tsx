import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, Image,
  TextInput, ScrollView, useWindowDimensions, Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../../src/lib/supabase';
import {
  calcHoles, matchLabel, calcCourseHandicap,
  calcStrokesReceived, calcStablefordPoints,
} from '../../../../src/lib/scoring';
import { getPlayerAvatar } from '../../../../src/lib/assets';
import { speakHole, speakPressure } from '../../../../src/lib/caddie';
import * as Location from 'expo-location';
import ShotLogger from '../../../../src/components/ShotLogger';
import RecordCelebration from '../../../../src/components/RecordCelebration';
import { checkAndUpdateRecords, type BrokenRecord } from '../../../../src/lib/records';
import { sendMatchNotification } from '../../../../src/lib/notifications';
import { sendMatchToWatch, clearMatchFromWatch, onWatchScoreEntry, onWatchRequestsState } from '../../../../src/lib/watch';
import CaddieButton from '../../../../src/components/CaddieButton';
import type { VoiceCommandResult } from '../../../../src/lib/voiceCommand';
import { enqueueHole, isNetworkError } from '../../../../src/lib/offlineQueue';
import { useSyncStatus } from '../../../../src/lib/useSyncStatus';
import { getMatchPack } from '../../../../src/lib/offlinePack';
import SyncBar from '../../../../src/components/SyncBar';

// ── Design tokens ──────────────────────────────────────────────
const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const RED    = '#f87171';
const BLUE   = '#3b82f6';
const ORANGE = '#f97316';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';
const { width: W } = Dimensions.get('window');
const titanLogo = require('../../../../assets/TitanAppLogo.png');

const SCORE_COLORS: Record<string, string> = { eagle: GOLD, birdie: GREEN, par: BLUE, bogey: ORANGE, double: RED };

function scoreVsPar(gross: number, par: number, shots: number): string {
  const net = gross - shots;
  const diff = net - par;
  if (diff <= -2) return 'eagle';
  if (diff === -1) return 'birdie';
  if (diff === 0)  return 'par';
  if (diff === 1)  return 'bogey';
  return 'double';
}

function ptsColor(pts: number): string {
  if (pts >= 4) return GOLD;
  if (pts === 3) return GREEN;
  if (pts === 2) return BLUE;
  if (pts === 1) return ORANGE;
  return RED;
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
  round_format: 'matchplay' | 'stableford' | 'medal';
  home_player_ids: string[];
  away_player_ids: string[];
  home_team: { name: string; accent_color: string } | null;
  away_team: { name: string; accent_color: string } | null;
  side_games: string[] | null;
  secondary_format: string | null;
  hcp_allowance: number | null;
  day_id: string | null;
  day: {
    course_name: string;
    course_par: number;
    course_rating: number;
    slope_rating: number;
    day_number: number;
    competition: { format: string } | null;
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
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [playerAvatars, setPlayerAvatars] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recordsBroken, setRecordsBroken] = useState<BrokenRecord[]>([]);

  const [modalVisible, setModalVisible] = useState(false);
  const [modalPlayerIdx, setModalPlayerIdx] = useState(0);
  const [holeScores, setHoleScores] = useState<Record<string, number>>({});
  const [selectedScore, setSelectedScore] = useState<number | null>(null);
  const [selectedFairway, setSelectedFairway] = useState<'left' | 'centre' | 'right' | null>(null);
  const [selectedPutts, setSelectedPutts] = useState<number | null>(null);
  const [holeStatMap, setHoleStatMap] = useState<Record<string, { fairway: 'left' | 'centre' | 'right' | null; putts: number | null }>>({});
  const [sideGameModal, setSideGameModal] = useState<{ type: string; hole: number } | null>(null);
  const [sideGameResult, setSideGameResult] = useState('');
  const [sideGameWinner, setSideGameWinner] = useState<string | null>(null);
  const [showShotLogger, setShowShotLogger] = useState(false);
  const [showCaddieModal, setShowCaddieModal] = useState(false);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [playerTotals, setPlayerTotals] = useState<Record<string, number>>({});
  const [holeData, setHoleData] = useState<Record<string, Record<number, { gross: number | null; pts: number | null }>>>({});
  const [editingHole, setEditingHole] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const syncStatus = useSyncStatus();
  const pendingCount = syncStatus.pendingCount;
  const { width: screenWidth } = useWindowDimensions();
  const pagerRef = useRef<ScrollView>(null);
  const holeStripRef = useRef<ScrollView>(null);
  const gpsRef = useRef<{ lat: number; lng: number } | null>(null);
  const skipNextLoad = useRef(false);
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
      // Try local pack first — instant display when offline or on slow networks
      const pack = await getMatchPack(matchId);
      if (pack) {
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
        supabase.auth.getUser().then(({ data: { user } }) => {
          if (user) supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle()
            .then(({ data: row }) => { if (row) setMyPlayerId(row.id); });
        });
        return;
      }

      // No pack — fetch from network
      const { data: matchData } = await supabase
        .from('matches')
        .select(`
          *,
          home_team:home_team_id(name,accent_color),
          away_team:away_team_id(name,accent_color),
          day:day_id(course_name,course_par,course_rating,slope_rating,day_number,competition:competition_id(format))
        `)
        .eq('id', matchId)
        .single();

      if (!matchData) { setLoading(false); return; }
      setMatch(matchData as unknown as MatchInfo);

      const allIds = [...(matchData.home_player_ids ?? []), ...(matchData.away_player_ids ?? [])];

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
        const comp = compData as CompPlayer[] | null;
        setCompPlayers(comp && comp.length > 0 ? comp : fallback);
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: playerRow } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
        if (playerRow) setMyPlayerId(playerRow.id);
      }
      setLoading(false);
    }
    load();
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
    const { homeUp, played, remaining, concluded } = calcHoles(newHolesStr);

    let newStatus: 'upcoming' | 'in_progress' | 'complete' = 'in_progress';
    let winner: string | null = null;
    let result_str: string | null = null;

    if (concluded) {
      newStatus = 'complete';
      winner = homeUp > 0 ? 'home' : 'away';
      result_str = `${Math.abs(homeUp)}&${remaining}`;
    } else if (played === 18) {
      newStatus = 'complete';
      if (homeUp === 0) { winner = 'half'; result_str = 'Halved'; }
      else { winner = homeUp > 0 ? 'home' : 'away'; result_str = `${Math.abs(homeUp)}UP`; }
    }

    await supabase.from('matches')
      .update({ holes_string: newHolesStr, status: newStatus, winner, result_str })
      .eq('id', match.id);

    setMatch({ ...match, holes_string: newHolesStr, status: newStatus, winner, result_str });

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
  const holeSequence = startHole > 1
    ? [...Array.from({ length: 19 - startHole }, (_, i) => startHole + i), ...Array.from({ length: startHole - 1 }, (_, i) => i + 1)]
    : Array.from({ length: 18 }, (_, i) => i + 1);
  const currentHole = holeSequence.find(h => holeChars[h - 1] === '.') ?? 19;
  const activeHole = editingHole ?? currentHole;
  const isComplete = currentHole > 18;

  let lastPlayedHole = 0;
  for (let i = holeChars.length - 1; i >= 0; i--) {
    if (holeChars[i] !== '.') { lastPlayedHole = i + 1; break; }
  }

  const allPlayerIds = match ? [...match.home_player_ids, ...match.away_player_ids] : [];
  const courseHole = courseHoles.find(h => h.hole_number === activeHole);
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

  async function onCoachMe() {
    if (coachLoading || voiceOff) return;
    setCoachLoading(true);
    const firstNames = Object.values(playerNames).map(n => n.split(' ')[0]);
    await speakHole(currentHole, courseHole?.par ?? null, holeYardage, courseHole?.stroke_index ?? null, firstNames);
    setCoachLoading(false);
  }

  // Players receiving a shot on the current hole
  const shotPlayerIds = courseHole
    ? allPlayerIds.filter(id => {
        const hcp = playerCourseHcp(id, compPlayers, match?.day ?? null, match?.hcp_allowance ?? 100);
        return calcStrokesReceived(hcp, courseHole.stroke_index) >= 1;
      })
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
    const firstId = allPlayerIds[0];
    setHoleScores(preScores);
    setHoleStatMap({});
    setSelectedScore(hole && firstId ? (holeData[firstId]?.[hole]?.gross ?? null) : null);
    setSelectedFairway(null);
    setSelectedPutts(null);
    setModalPlayerIdx(0);
    setModalVisible(true);
  }

  function submitPlayerScore() {
    if (selectedScore === null || !modalPlayerId) return;

    const newScores = { ...holeScores, [modalPlayerId]: selectedScore };
    const newStats = { ...holeStatMap, [modalPlayerId]: { fairway: selectedFairway, putts: selectedPutts } };
    setHoleScores(newScores);
    setHoleStatMap(newStats);
    const nextIdx = modalPlayerIdx + 1;
    if (nextIdx < allPlayerIds.length) {
      const nextId = allPlayerIds[nextIdx];
      const nextExisting = editingHole ? (holeData[nextId]?.[editingHole]?.gross ?? null) : null;
      setSelectedScore(nextExisting);
      setSelectedFairway(null);
      setSelectedPutts(null);
      setModalPlayerIdx(nextIdx);
    } else {
      setSelectedScore(null);
      setSelectedFairway(null);
      setSelectedPutts(null);
      setModalVisible(false);
      processHoleScores(newScores, newStats);
    }
  }

  // ── Calculate and save hole result ──────────────────────────────
  async function processHoleScores(scores: Record<string, number>, stats: Record<string, { fairway: 'left' | 'centre' | 'right' | null; putts: number | null }> = {}) {
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
        return {
          match_id: matchId,
          player_id: id,
          hole_number: activeHole,
          score: 'd',
          gross_score: gross,
          net_score: net,
          stableford_pts: calcStablefordPoints(gross, par, shots),
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
        }))
        .filter(r => r.fairway_direction !== null || r.putts !== null);

      const spChars = [...holeChars];
      spChars[activeHole - 1] = 'd';
      const newHolesStr = spChars.join('');
      const holesPlayed = newHolesStr.split('').filter(c => c !== '.').length;
      const newStatus: 'upcoming' | 'in_progress' | 'complete' = holesPlayed >= 18 ? 'complete' : 'in_progress';
      const newResultStr = newStatus === 'complete' ? 'Complete' : null;
      const matchUpdate = { holes_string: newHolesStr, status: newStatus, winner: null, result_str: newResultStr };

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

      if (!savedOffline) {
        if (newStatus === 'complete' && !editingHole) {
          const allBroken = await Promise.all(allPlayerIds.map(id => checkAndUpdateRecords(matchId as string, id)));
          const broken = allBroken.flat();
          if (broken.length > 0) { setRecordsBroken(broken); }
          else { Alert.alert('Round Complete', 'All 18 holes scored!', [{ text: 'View Scorecard' }]); }
        }

        if (!editingHole && !wasAlreadyComplete && [6, 9, 12, 15, 16, 17, 18].includes(activeHole)) {
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
      }
      return;
    }

    // ── Match play branch ────────────────────────────────────────────
    const getNetScore = (id: string) => {
      const hcp = playerCourseHcp(id, compPlayers, day, match.hcp_allowance ?? 100);
      const shots = calcStrokesReceived(hcp, si);
      return (scores[id] ?? 99) - shots;
    };

    const homeNet = Math.min(...match.home_player_ids.map(getNetScore));
    const awayNet = Math.min(...match.away_player_ids.map(getNetScore));
    const holeResult: 'h' | 'a' | 'f' = homeNet < awayNet ? 'h' : awayNet < homeNet ? 'a' : 'f';

    const rows = allPlayerIds.map(id => {
      const hcp = playerCourseHcp(id, compPlayers, day, match.hcp_allowance ?? 100);
      const shots = calcStrokesReceived(hcp, si);
      const gross = scores[id] ?? null;
      return {
        match_id: matchId,
        player_id: id,
        hole_number: activeHole,
        score: holeResult,
        gross_score: gross,
        stableford_pts: calcStablefordPoints(gross, par, shots),
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
      }))
      .filter(r => r.fairway_direction !== null || r.putts !== null);

    const chars = [...holeChars];
    chars[activeHole - 1] = holeResult;
    const newHolesStr = chars.join('');
    const { homeUp, played, remaining, concluded } = calcHoles(newHolesStr);

    let newStatus: 'upcoming' | 'in_progress' | 'complete' = 'in_progress';
    let winner: string | null = null;
    let result_str: string | null = null;

    if (concluded) {
      newStatus = 'complete';
      winner = homeUp > 0 ? 'home' : 'away';
      result_str = `${Math.abs(homeUp)}&${remaining}`;
    } else if (played === 18) {
      newStatus = 'complete';
      if (homeUp === 0) { winner = 'half'; result_str = 'Halved'; }
      else { winner = homeUp > 0 ? 'home' : 'away'; result_str = `${Math.abs(homeUp)}UP`; }
    }

    const matchUpdate = { holes_string: newHolesStr, status: newStatus, winner, result_str };

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

    if (!savedOffline) {
      if (!editingHole) {
        if (match.competition_id && newStatus !== 'complete' && [9, 12, 15].includes(activeHole)) {
          const homeTeam = match.home_team?.name ?? match.home_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
          const awayTeam = match.away_team?.name ?? match.away_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
          const { homeUp: newHomeUp } = calcHoles(newHolesStr);
          const at = activeHole === 9 ? 'the turn' : `hole ${activeHole}`;
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
        } else if (match.secondary_format && match.round_format === 'matchplay') {
          const secLabel = match.secondary_format === 'stableford' ? 'Stableford' : 'Stroke Play';
          Alert.alert(
            'Matchplay Complete',
            `${msg}\n\nYou have a ${secLabel} secondary game running — continue to finish all 18 holes.`,
            [
              { text: 'Finish Now', style: 'cancel' },
              { text: `Continue ${secLabel}`, onPress: () => {
                  setMatch(prev => prev ? { ...prev, status: 'in_progress' } : prev);
                } },
            ]
          );
        } else {
          Alert.alert('Match Complete', msg, [{ text: 'View Scorecard' }]);
        }
      }

      if (!editingHole && !wasAlreadyComplete && [9, 12, 15].includes(activeHole)) {
        const homeTeam = match.home_team?.name ?? match.home_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
        const awayTeam = match.away_team?.name ?? match.away_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
        const { homeUp: newHomeUp, remaining: newRemaining } = calcHoles(newHolesStr);
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

    const sub = supabase
      .channel(`day-lb-${dayId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_holes' }, () => {
        loadDayBoard();
      })
      .subscribe();

    return () => { supabase.removeChannel(sub); };
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

  // ── Render ──────────────────────────────────────────────────────
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

  const sortedLeaders = [...allPlayerIds].sort((a, b) => (playerTotals[b] ?? 0) - (playerTotals[a] ?? 0));
  const leaderId = sortedLeaders[0];
  const leaderPts = leaderId ? (playerTotals[leaderId] ?? 0) : 0;
  const leaderName = leaderId ? (playerNames[leaderId] ?? '').split(' ')[0] : null;
  const leaderStatusText = leaderPts > 0 && (isStrokePlay || match.secondary_format)
    ? `${leaderName} leads · ${leaderPts}pts`
    : null;
  const { homeUp: liveHomeUp } = calcHoles(holesStr);
  const holesLeft = holeChars.filter(c => c === '.').length;

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

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerSide} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerSub} numberOfLines={1}>
            {match.day?.course_name ? `${match.day.course_name} · ${formatLabel}` : formatLabel}
          </Text>
        </View>
        <TouchableOpacity
          style={s.headerSide}
          onPress={() => router.push(`/(app)/rangefinder?courseName=${encodeURIComponent(match?.day?.course_name ?? '')}&holeNumber=${currentHole}` as any)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="scan-outline" size={22} color={GOLD} />
        </TouchableOpacity>
      </View>

      {/* ── Sync status ── */}
      <SyncBar status={syncStatus} />

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
            const bestPts = Math.max(0, ...allPlayerIds.map(id => holeData[id]?.[h]?.pts ?? 0));
            resultColor = bestPts > 0 ? ptsColor(bestPts) : '#22c55e';
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
              <Text style={[s.holeTileNum, isActive && { color: GOLD }]}>{h}</Text>
              <Text style={[s.holeTilePar, isActive && { color: `${GOLD}80` }]}>P{ch?.par ?? '?'}</Text>
              {isPlayed && isStrokePlay && (() => {
                const bestPts = Math.max(0, ...allPlayerIds.map(id => holeData[id]?.[h]?.pts ?? 0));
                return bestPts > 0 ? <Text style={[s.holeTilePts, { color: ptsColor(bestPts) }]}>{bestPts}</Text> : null;
              })()}
              {isPlayed && !isStrokePlay && (
                <Text style={[s.holeTilePts, { color: resultColor }]}>
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
                  <View style={s.holeNumberBlock}>
                    <Text style={s.holeWord}>HOLE</Text>
                    <Text style={s.holeBig}>{activeHole}</Text>
                    <View style={s.holeChips}>
                      {courseHole && (
                        <>
                          <View style={s.holeChip}><Text style={s.holeChipText}>Par {courseHole.par}</Text></View>
                          <View style={s.holeChip}><Text style={s.holeChipText}>SI {courseHole.stroke_index}</Text></View>
                          {holeYardage ? <View style={s.holeChip}><Text style={s.holeChipText}>{holeYardage}y</Text></View> : null}
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
                  ) : allPlayerIds.length > 1 ? (
                    <View style={s.leaderboard}>
                      {(() => {
                        const sorted = [...allPlayerIds].sort((a, b) => {
                          const aVal = playerTotals[a] ?? 0;
                          const bVal = playerTotals[b] ?? 0;
                          if (match.round_format === 'medal') {
                            if (aVal === 0 && bVal === 0) return 0;
                            if (aVal === 0) return 1;
                            if (bVal === 0) return -1;
                            return aVal - bVal;
                          }
                          return bVal - aVal;
                        });
                        const topScore = playerTotals[sorted[0]] ?? 0;
                        return sorted.map((id, rank) => {
                          const isHome = match.home_player_ids.includes(id);
                          const teamColor = isHome ? homeColor : awayColor;
                          const src = playerAvatars[id] ?? getPlayerAvatar(id, 'normal');
                          const firstName = (playerNames[id] ?? '?').split(' ')[0];
                          const total = playerTotals[id] ?? 0;
                          const isStablefordMode = isStrokePlay || !!match.secondary_format;
                          const scoreStr = total > 0 ? (isStablefordMode ? `${total}pts` : `${total}`) : '—';
                          const isLeader = rank === 0 && topScore > 0;
                          return (
                            <View key={id} style={s.lbRow}>
                              <Avatar name={firstName} color={teamColor} size={32} source={src} />
                              <Text style={[s.lbName, !isLeader && { opacity: 0.5 }]} numberOfLines={1}>{firstName}</Text>
                              <Text style={[s.lbPts, { color: isLeader ? GOLD : '#fff' }]}>{scoreStr}</Text>
                            </View>
                          );
                        });
                      })()}
                    </View>
                  ) : null}
                </View>

                {/* Gets a shot */}
                {shotPlayerIds.length > 0 && (
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
                    onPress={() => router.push(`/(app)/rangefinder?courseName=${encodeURIComponent(match?.day?.course_name ?? '')}&holeNumber=${currentHole}` as any)}
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
                  <TouchableOpacity style={s.actionBtn} onPress={() => setShowCaddieModal(true)} activeOpacity={0.7}>
                    <Ionicons name="mic-outline" size={20} color={GOLD} />
                    <Text style={s.actionLabel}>CADDIE</Text>
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
              lastPlayedHole={lastPlayedHole}
              saving={saving}
              screenWidth={screenWidth}
            />

            {/* Page 2: Back 9 scorecard */}
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
              lastPlayedHole={lastPlayedHole}
              saving={saving}
              screenWidth={screenWidth}
            />
          </ScrollView>

          {/* ── Enter score CTA ── */}
          <View style={s.ctaWrap}>
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
          </View>
        </>
      ) : (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
          {/* Winner announcement */}
          <View style={s.completeHero}>
            <Ionicons name="trophy" size={48} color={GOLD} style={{ marginBottom: 12 }} />
            <Text style={s.completeTitle}>MATCH COMPLETE</Text>
            <Text style={s.completeResult}>{match.result_str ?? 'Done'}</Text>
            <Text style={s.completeWinner}>
              {match.winner === 'half'
                ? 'Match Halved'
                : `${match.winner === 'home' ? homeLabel : awayLabel} Win`}
            </Text>
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
              <Ionicons name="arrow-undo-outline" size={16} color="#6b7280" />
              <Text style={s.undoBtnText}>Correct Hole {lastPlayedHole}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={s.doneBtn} onPress={() => router.back()} activeOpacity={0.85}>
            <Text style={s.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {saving && (
        <View style={s.savingIndicator}>
          <ActivityIndicator color={GOLD} size="small" />
        </View>
      )}

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
                <Ionicons name="close" size={22} color="#6b7280" />
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
            <ScrollView style={{ width: '100%' }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
              {/* Score buttons */}
              <Text style={sh.pickerLabel}>GROSS SCORE</Text>
              <View style={sh.scoreGrid}>
                {[1,2,3,4,5,6,7,8,9].map(n => {
                  const on = selectedScore === n;
                  const shots = modalPlayerId
                    ? calcStrokesReceived(playerCourseHcp(modalPlayerId, compPlayers, match?.day ?? null, match?.hcp_allowance ?? 100), courseHole?.stroke_index ?? 18)
                    : 0;
                  const result = courseHole ? scoreVsPar(n, courseHole.par, shots) : 'par';
                  const accent = SCORE_COLORS[result] ?? '#6b7280';
                  const stablePts = calcStablefordPoints(n, courseHole?.par ?? 4, shots);
                  return (
                    <TouchableOpacity
                      key={n}
                      style={[sh.scoreBtn, on && { backgroundColor: accent, borderColor: accent }]}
                      onPress={() => setSelectedScore(n)}
                      activeOpacity={0.7}
                    >
                      <Text style={[sh.scoreBtnText, on && { color: '#000' }]}>{n}</Text>
                      {on && <Text style={[sh.scoreDiff, { color: '#000' }]}>{stablePts} pts</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Fairway (myPlayerId only, par 4+) */}
              {modalPlayerId === myPlayerId && courseHole && courseHole.par >= 4 && (
                <>
                  <Text style={sh.pickerLabel}>FAIRWAY</Text>
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

              {/* Putts (myPlayerId only) */}
              {modalPlayerId === myPlayerId && (
                <>
                  <Text style={sh.pickerLabel}>PUTTS</Text>
                  <View style={sh.puttsRow}>
                    {([1, 2, 3, 4] as const).map(n => (
                      <TouchableOpacity
                        key={n}
                        style={[sh.puttsBtn, selectedPutts === n && sh.puttsBtnOn]}
                        onPress={() => setSelectedPutts(prev => prev === n ? null : n)}
                        activeOpacity={0.7}
                      >
                        <Text style={[sh.puttsText, selectedPutts === n && sh.puttsTextOn]}>{n === 4 ? '3+' : n}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {/* Submit */}
              <TouchableOpacity
                style={[sh.submitBtn, !selectedScore && sh.submitBtnOff]}
                onPress={submitPlayerScore}
                disabled={!selectedScore}
                activeOpacity={0.8}
              >
                <Text style={sh.submitText}>
                  {modalPlayerIdx < allPlayerIds.length - 1 ? `Next Player →` : '✓ Save Hole'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
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
                <Ionicons name="close" size={22} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1 }}>
              {matchId && <ShotLogger matchId={matchId} holeNumber={currentHole} />}
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Voice caddie ── */}
      <Modal visible={showCaddieModal} transparent animationType="slide" onRequestClose={() => setShowCaddieModal(false)}>
        <TouchableOpacity style={sh.overlay} activeOpacity={1} onPress={() => setShowCaddieModal(false)}>
          <View style={[sh.sheet, { paddingBottom: 32 }]} onStartShouldSetResponder={() => true}>
            <View style={sh.handle} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontFamily: FFB, fontSize: 16, color: '#ffffff', letterSpacing: 1 }}>VOICE CADDIE</Text>
              <TouchableOpacity onPress={() => setShowCaddieModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color="#6b7280" />
              </TouchableOpacity>
            </View>
            {courseHole && match && (
              <CaddieButton
                context={{
                  playerName: myPlayerId ? (playerNames[myPlayerId] ?? 'Player') : 'Player',
                  holeNumber: currentHole,
                  par: courseHole.par,
                  yardage: holeYardage,
                  strokeIndex: courseHole.stroke_index,
                  format: match.round_format,
                  holesCompleted: holeChars.filter(c => c !== '.').length,
                  runningScore: (() => {
                    const up = holeChars.reduce((n, c) => n + (c === 'h' ? 1 : c === 'a' ? -1 : 0), 0);
                    const left = holeChars.filter(c => c === '.').length;
                    if (up === 0) return 'All Square';
                    return `${Math.abs(up)}UP with ${left} to play`;
                  })(),
                }}
                onAction={async (result: VoiceCommandResult) => {
                  if (result.action?.type === 'log_shot' && result.action.club && myPlayerId) {
                    await supabase.from('shots').insert({
                      match_id: match.id,
                      player_id: myPlayerId,
                      hole_number: currentHole,
                      club_short: result.action.club,
                      distance_yards: result.action.distance ?? null,
                      lat: gpsRef.current?.lat ?? null,
                      lng: gpsRef.current?.lng ?? null,
                    });
                    setShowCaddieModal(false);
                  }
                }}
              />
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {recordsBroken.length > 0 && (
        <RecordCelebration
          records={recordsBroken}
          onDismiss={() => setRecordsBroken([])}
        />
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
  const showPts = roundFormat === 'stableford' || !!secondaryFormat;

  return (
    <ScrollView style={{ width: screenWidth }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
      <View style={sc.container}>
        <Text style={sc.title}>{title}</Text>

        {/* Header row */}
        <View style={sc.headerRow}>
          <Text style={[sc.cell, sc.labelCell, { color: '#fff' }]}>PLAYER</Text>
          {holes.map(h => (
            <Text key={h} style={[sc.cell, sc.holeCell, holeChars[h-1] !== '.' && { color: '#ffffff' }]}>{h}</Text>
          ))}
          <Text style={[sc.cell, sc.totalCell, { color: '#fff' }]}>TOT</Text>
        </View>

        {/* Par row */}
        {courseHoles.length > 0 && (
          <View style={[sc.row, { backgroundColor: '#0a0a0a' }]}>
            <Text style={[sc.cell, sc.labelCell, { color: GOLD }]}>PAR</Text>
            {holes.map(h => {
              const ch = courseHoles.find(c => c.hole_number === h);
              return <Text key={h} style={[sc.cell, sc.holeCell, { color: GOLD }]}>{ch?.par ?? '—'}</Text>;
            })}
            <Text style={[sc.cell, sc.totalCell, { color: GOLD }]}>{totalPar || '—'}</Text>
          </View>
        )}

        {/* SI row */}
        {courseHoles.length > 0 && (
          <View style={sc.row}>
            <Text style={[sc.cell, sc.labelCell, { color: '#fff' }]}>SI</Text>
            {holes.map(h => {
              const ch = courseHoles.find(c => c.hole_number === h);
              return <Text key={h} style={[sc.cell, sc.holeCell, { color: '#fff', fontSize: 9 }]}>{ch?.stroke_index ?? '—'}</Text>;
            })}
            <Text style={[sc.cell, sc.totalCell, { color: '#fff' }]}>—</Text>
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
                const cellColor = showPts && pts != null
                  ? ptsColor(pts)
                  : gross ? '#6b7280' : '#333';
                return (
                  <View key={h} style={[sc.cell, sc.holeCell, { gap: 2 }]}>
                    {gross ? (
                      <>
                        <View style={[sc.scorePill, { borderColor: `${cellColor}50`, backgroundColor: `${cellColor}12` }]}>
                          <Text style={[sc.scorePillText, { color: cellColor }]}>
                            {showPts && pts != null ? pts : gross}
                          </Text>
                        </View>
                        {showPts && pts != null && (
                          <Text style={[sc.ptsText, { color: '#555' }]}>{gross}</Text>
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
              <Text style={[sc.cell, sc.totalCell, { color: totalGross > 0 ? '#ffffff' : '#333' }]}>
                {showPts && totalPts > 0 ? `${totalPts}` : totalGross > 0 ? `${totalGross}` : '—'}
              </Text>
            </View>
          );
        })}

        {/* Matchplay result row */}
        {!isStrokePlay && (
          <View style={[sc.row, { backgroundColor: '#0a0a0a', borderTopWidth: 1, borderTopColor: '#1a1a1a' }]}>
            <Text style={[sc.cell, sc.labelCell, { color: '#fff' }]}>RESULT</Text>
            {holes.map(h => {
              const c = holeChars[h - 1];
              const color = c === 'h' ? homeColor : c === 'a' ? awayColor : c === 'f' ? '#4b5563' : 'transparent';
              return (
                <Text key={h} style={[sc.cell, sc.holeCell, { color, fontFamily: FFB }]}>
                  {c === 'h' ? 'H' : c === 'a' ? 'A' : c === 'f' ? '=' : ''}
                </Text>
              );
            })}
            <Text style={[sc.cell, sc.totalCell]} />
          </View>
        )}

        <Text style={sc.swipeHint}>← Swipe to switch ·</Text>
      </View>

      {lastPlayedHole > 0 && (
        <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 16, flexDirection: 'row', justifyContent: 'center', gap: 6 }} onPress={onUndo} disabled={saving} activeOpacity={0.7}>
          <Ionicons name="arrow-undo-outline" size={14} color="#444" />
          <Text style={{ fontFamily: FFB, fontSize: 12, color: '#444' }}>Edit Hole {lastPlayedHole}</Text>
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
  halfLabel: { fontFamily: FFB, fontSize: 8, color: '#2a2a2a', letterSpacing: 1.5 },

  pageContent: { padding: 16, paddingBottom: 24 },

  holeCard: {
    backgroundColor: '#111111', borderRadius: 16,
    borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden',
    marginBottom: 12,
  },
  holeCardTop:     { flexDirection: 'row', padding: 16, gap: 12 },
  holeCardDivider: { width: 1, backgroundColor: '#1c1c1c' },
  holeNumberBlock: { width: 110, alignItems: 'flex-start', justifyContent: 'center', gap: 6 },
  holeWord:        { fontFamily: FFB, fontSize: 10, color: '#fff', letterSpacing: 2 },
  holeBig:         { fontFamily: FFB, fontSize: 64, color: '#ffffff', lineHeight: 68, letterSpacing: -2 },
  holeChips:       { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  holeChip: {
    borderWidth: 1, borderColor: '#2c2c2c', borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  holeChipText: { fontFamily: FFB, fontSize: 10, color: '#fff' },

  leaderboard:    { flex: 1, justifyContent: 'center', gap: 10 },
  lbGroupHeader:  { fontFamily: FFB, fontSize: 9, color: GOLD, letterSpacing: 2, marginBottom: 2 },
  lbRow:          { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lbRank:         { fontFamily: FFB, fontSize: 12, width: 18, textAlign: 'center' },
  lbName:         { flex: 1, fontFamily: FFB, fontSize: 13, color: '#ffffff' },
  lbPts:          { fontFamily: FFB, fontSize: 13 },
  lbMore:         { fontFamily: FFB, fontSize: 11, color: '#555', textAlign: 'center', marginTop: 2 },

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
