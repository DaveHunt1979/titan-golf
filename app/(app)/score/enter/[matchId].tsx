import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  Image,
  TextInput,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../../src/lib/theme';
import {
  calcHoles,
  matchLabel,
  calcCourseHandicap,
  calcStrokesReceived,
  calcStablefordPoints,
} from '../../../../src/lib/scoring';
import { getPlayerAvatar } from '../../../../src/lib/assets';
import { speakHole } from '../../../../src/lib/caddie';
import RangeMap from '../../../../src/components/RangeMap';
import ShotLogger from '../../../../src/components/ShotLogger';
import RecordCelebration from '../../../../src/components/RecordCelebration';
import { checkAndUpdateRecords, type BrokenRecord } from '../../../../src/lib/records';
import { sendMatchNotification } from '../../../../src/lib/notifications';
import { sendMatchToWatch, clearMatchFromWatch, onWatchScoreEntry, onWatchRequestsState } from '../../../../src/lib/watch';
import CaddieButton from '../../../../src/components/CaddieButton';
import type { VoiceCommandResult } from '../../../../src/lib/voiceCommand';

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
  day: {
    course_name: string;
    course_par: number;
    course_rating: number;
    slope_rating: number;
    day_number: number;
    competition: { format: string } | null;
  } | null;
}

interface CourseHole { hole_number: number; par: number; stroke_index: number; yardage: number | null; }
interface CompPlayer { player_id: string; handicap_index: number; }

function playerCourseHcp(playerId: string, compPlayers: CompPlayer[], day: MatchInfo['day']): number {
  const cp = compPlayers.find(c => c.player_id === playerId);
  const hcpIndex = cp?.handicap_index ?? 0;
  if (!day?.slope_rating || !day?.course_rating || !day?.course_par) return Math.round(hcpIndex);
  return calcCourseHandicap(hcpIndex, day.slope_rating, day.course_rating, day.course_par);
}

export default function EnterScoresScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();

  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [courseHoles, setCourseHoles] = useState<CourseHole[]>([]);
  const [compPlayers, setCompPlayers] = useState<CompPlayer[]>([]);
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [playerAvatars, setPlayerAvatars] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recordsBroken, setRecordsBroken] = useState<BrokenRecord[]>([]);

  // Score entry modal state
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
  const [showRangeMap, setShowRangeMap] = useState(false);
  const [showShotLogger, setShowShotLogger] = useState(false);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [playerTotals, setPlayerTotals] = useState<Record<string, number>>({});
  const [holeData, setHoleData] = useState<Record<string, Record<number, { gross: number | null; pts: number | null }>>>({});
  const [currentPage, setCurrentPage] = useState(0);
  const { width: screenWidth } = useWindowDimensions();
  const pagerRef = useRef<ScrollView>(null);

  useEffect(() => {
    async function load() {
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
          ? supabase.from('course_holes').select('hole_number,par,stroke_index,yardage').eq('course_name', matchData.day.course_name).order('hole_number')
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
        // For casual games competition_players may be empty — fall back to players.handicap_index
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
    return () => { unsub(); clearMatchFromWatch(); };
  }, [match]);

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
        const val = match!.round_format === 'stableford'
          ? (row.stableford_pts ?? 0)
          : (row.gross_score ?? 0);
        totals[id] = (totals[id] ?? 0) + val;
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
      Alert.alert('Match Complete', msg, [{ text: 'Done', onPress: () => router.back() }]);
    }
  }

  // ── Derived values ──────────────────────────────────────────────
  const holesStr = (match?.holes_string ?? '..................').padEnd(18, '.').slice(0, 18);
  const holeChars = holesStr.split('');
  const firstUnplayedIdx = holeChars.findIndex(c => c === '.');
  const currentHole = firstUnplayedIdx === -1 ? 19 : firstUnplayedIdx + 1;
  const isComplete = match?.status === 'complete' || currentHole > 18;

  let lastPlayedHole = 0;
  for (let i = holeChars.length - 1; i >= 0; i--) {
    if (holeChars[i] !== '.') { lastPlayedHole = i + 1; break; }
  }

  const allPlayerIds = match ? [...match.home_player_ids, ...match.away_player_ids] : [];
  const courseHole = courseHoles.find(h => h.hole_number === currentHole);

  // Parse side games: "Longest Drive:7" → { 7: 'Longest Drive' }
  const sideGameByHole = (match?.side_games ?? []).reduce((acc, sg) => {
    const [type, hole] = sg.split(':');
    if (hole) acc[parseInt(hole)] = type;
    return acc;
  }, {} as Record<number, string>);
  const currentSideGame = sideGameByHole[currentHole] ?? null;


  const [coachLoading, setCoachLoading] = useState(false);
  async function onCoachMe() {
    if (coachLoading) return;
    setCoachLoading(true);
    const firstNames = Object.values(playerNames).map(n => n.split(' ')[0]);
    await speakHole(currentHole, courseHole?.par ?? null, courseHole?.yardage ?? null, courseHole?.stroke_index ?? null, firstNames);
    setCoachLoading(false);
  }

  // Players receiving a shot on the current hole
  const shotPlayerIds = courseHole
    ? allPlayerIds.filter(id => {
        const hcp = playerCourseHcp(id, compPlayers, match?.day ?? null);
        return calcStrokesReceived(hcp, courseHole.stroke_index) >= 1;
      })
    : [];

  // Current player in the modal
  const modalPlayerId = allPlayerIds[modalPlayerIdx] ?? null;
  const isHomePlayer = modalPlayerId ? match?.home_player_ids.includes(modalPlayerId) : false;
  const modalPlayerName = modalPlayerId ? (playerNames[modalPlayerId] ?? '?') : '';
  const modalTeamColor = isHomePlayer
    ? (match?.home_team?.accent_color ?? colors.gold)
    : (match?.away_team?.accent_color ?? colors.textMuted);
  const modalTeamName = isHomePlayer ? match?.home_team?.name : match?.away_team?.name;
  const modalPlayerAvatar = modalPlayerId
    ? (playerAvatars[modalPlayerId] ?? getPlayerAvatar(modalPlayerId, 'normal'))
    : null;
  const modalPlayerGetsShot = modalPlayerId && courseHole
    ? shotPlayerIds.includes(modalPlayerId)
    : false;

  // ── Score entry modal ───────────────────────────────────────────
  function openScoreModal() {
    setHoleScores({});
    setHoleStatMap({});
    setSelectedScore(null);
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
    setSelectedScore(null);
    setSelectedFairway(null);
    setSelectedPutts(null);

    const nextIdx = modalPlayerIdx + 1;
    if (nextIdx < allPlayerIds.length) {
      setModalPlayerIdx(nextIdx);
    } else {
      setModalVisible(false);
      processHoleScores(newScores, newStats);
    }
  }

  // ── Calculate and save hole result ──────────────────────────────
  async function processHoleScores(scores: Record<string, number>, stats: Record<string, { fairway: 'left' | 'centre' | 'right' | null; putts: number | null }> = {}) {
    if (!match || !courseHole) return;
    setSaving(true);

    const si = courseHole.stroke_index;
    const par = courseHole.par;
    const day = match.day;

    const isStrokePlay = match.round_format === 'stableford' || match.round_format === 'medal';

    if (isStrokePlay) {
      const { error: delErr } = await supabase.from('match_holes').delete()
        .eq('match_id', matchId)
        .eq('hole_number', currentHole);
      if (delErr) console.error('match_holes delete error:', delErr);

      const spRows = allPlayerIds.map(id => {
        const hcp = playerCourseHcp(id, compPlayers, day);
        const shots = calcStrokesReceived(hcp, si);
        const gross = scores[id] ?? null;
        const net = gross !== null ? gross - shots : null;
        return {
          match_id: matchId,
          player_id: id,
          hole_number: currentHole,
          score: 'd',
          gross_score: gross,
          net_score: net,
          stableford_pts: calcStablefordPoints(gross, par, shots),
        };
      });

      const { error: insErr } = await supabase.from('match_holes').insert(spRows);
      if (insErr) console.error('match_holes insert error:', insErr);

      const spStatRows = allPlayerIds
        .map(id => ({
          match_id: matchId,
          player_id: id,
          hole_number: currentHole,
          fairway_hit: courseHole.par >= 4 ? (stats[id]?.fairway != null ? stats[id]?.fairway === 'centre' : null) : null,
          fairway_direction: courseHole.par >= 4 ? (stats[id]?.fairway ?? null) : null,
          putts: stats[id]?.putts ?? null,
        }))
        .filter(r => r.fairway_direction !== null || r.putts !== null);
      if (spStatRows.length > 0) {
        await supabase.from('hole_stats').upsert(spStatRows, { onConflict: 'match_id,player_id,hole_number' });
      }

      const spChars = [...holeChars];
      spChars[currentHole - 1] = 'd';
      const newHolesStr = spChars.join('');
      const holesPlayed = newHolesStr.split('').filter(c => c !== '.').length;
      const newStatus: 'upcoming' | 'in_progress' | 'complete' = holesPlayed >= 18 ? 'complete' : 'in_progress';
      const newResultStr = newStatus === 'complete' ? 'Complete' : null;

      const { error } = await supabase.from('matches')
        .update({ holes_string: newHolesStr, status: newStatus, winner: null, result_str: newResultStr })
        .eq('id', match.id);

      setSaving(false);
      if (error) { Alert.alert('Error', error.message); return; }
      setMatch({ ...match, holes_string: newHolesStr, status: newStatus, winner: null, result_str: newResultStr });

      if (newStatus === 'complete') {
        const allBroken = await Promise.all(allPlayerIds.map(id => checkAndUpdateRecords(matchId as string, id)));
        const broken = allBroken.flat();
        if (broken.length > 0) { setRecordsBroken(broken); }
        else { Alert.alert('Round Complete', 'All 18 holes scored!', [{ text: 'Done', onPress: () => router.back() }]); }
      }
      return;
    }

    // ── Match play branch ────────────────────────────────────────────
    const getNetScore = (id: string) => {
      const hcp = playerCourseHcp(id, compPlayers, day);
      const shots = calcStrokesReceived(hcp, si);
      return (scores[id] ?? 99) - shots;
    };

    const homeNet = Math.min(...match.home_player_ids.map(getNetScore));
    const awayNet = Math.min(...match.away_player_ids.map(getNetScore));
    const holeResult: 'h' | 'a' | 'f' = homeNet < awayNet ? 'h' : awayNet < homeNet ? 'a' : 'f';

    // Clear existing match_holes rows for this hole then insert fresh
    const { error: delErr } = await supabase.from('match_holes').delete()
      .eq('match_id', matchId)
      .eq('hole_number', currentHole);
    if (delErr) console.error('match_holes delete error:', delErr);

    const rows = allPlayerIds.map(id => {
      const hcp = playerCourseHcp(id, compPlayers, day);
      const shots = calcStrokesReceived(hcp, si);
      const gross = scores[id] ?? null;
      return {
        match_id: matchId,
        player_id: id,
        hole_number: currentHole,
        score: holeResult,
        gross_score: gross,
        stableford_pts: calcStablefordPoints(gross, par, shots),
      };
    });

    const { error: insErr } = await supabase.from('match_holes').insert(rows);
    if (insErr) console.error('match_holes insert error:', insErr);

    // Save per-player hole stats (fairway + putts)
    const statRows = allPlayerIds
      .map(id => ({
        match_id: matchId,
        player_id: id,
        hole_number: currentHole,
        fairway_hit: courseHole.par >= 4 ? (stats[id]?.fairway != null ? stats[id]?.fairway === 'centre' : null) : null,
        fairway_direction: courseHole.par >= 4 ? (stats[id]?.fairway ?? null) : null,
        putts: stats[id]?.putts ?? null,
      }))
      .filter(r => r.fairway_direction !== null || r.putts !== null);
    if (statRows.length > 0) {
      await supabase.from('hole_stats').upsert(statRows, { onConflict: 'match_id,player_id,hole_number' });
    }

    // Update holes_string and match status
    const chars = [...holeChars];
    chars[currentHole - 1] = holeResult;
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

    const { error } = await supabase.from('matches')
      .update({ holes_string: newHolesStr, status: newStatus, winner, result_str })
      .eq('id', match.id);

    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }

    setMatch({ ...match, holes_string: newHolesStr, status: newStatus, winner, result_str });

    // Live score update at the turn and key back-9 milestones
    if (match.competition_id && newStatus !== 'complete' && [9, 12, 15].includes(currentHole)) {
      const homeTeam = match.home_team?.name ?? match.home_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
      const awayTeam = match.away_team?.name ?? match.away_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
      const { homeUp: newHomeUp } = calcHoles(newHolesStr);
      const at = currentHole === 9 ? 'the turn' : `hole ${currentHole}`;
      const scoreBody = newHomeUp > 0
        ? `${homeTeam} ${newHomeUp}UP at ${at}`
        : newHomeUp < 0
          ? `${awayTeam} ${Math.abs(newHomeUp)}UP at ${at}`
          : `All Square at ${at}`;
      sendMatchNotification(match.competition_id, `⛳ Match ${match.match_number}`, scoreBody);
    }

    // Show side game result entry if this was a side game hole
    if (currentSideGame) {
      setSideGameResult('');
      setSideGameWinner(null);
      setSideGameModal({ type: currentSideGame, hole: currentHole });
    }

    // Fire push notifications for birdies, eagles, HIOs
    if (match.competition_id) {
      for (const id of allPlayerIds) {
        const gross = scores[id];
        if (!gross) continue;
        const firstName = (playerNames[id] ?? '').split(' ')[0];
        const pids = [...(match.home_player_ids ?? []), ...(match.away_player_ids ?? [])];
        if (gross === 1) {
          sendMatchNotification(match.competition_id, '⛳ HOLE IN ONE!', `${firstName} just made a hole in one on hole ${currentHole}!`, pids);
        } else if (gross <= par - 2) {
          sendMatchNotification(match.competition_id, '🦅 Eagle!', `${firstName} just made an eagle on hole ${currentHole}!`, pids);
        } else if (gross === par - 1) {
          sendMatchNotification(match.competition_id, '🐦 Birdie!', `${firstName} is on fire — birdie on hole ${currentHole}!`, pids);
        }
      }
    }

    if (newStatus === 'complete') {
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
      if (broken.length > 0) { setRecordsBroken(broken); }
      else { Alert.alert('Match Complete', msg, [{ text: 'Done', onPress: () => router.back() }]); }
    }
  }

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
  if (loading) return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.gold} size="large" />
    </View>
  );

  if (!match) return (
    <View style={styles.centered}>
      <Text style={{ color: colors.textSecondary }}>Match not found.</Text>
    </View>
  );

  const isStrokePlay = match.round_format === 'stableford' || match.round_format === 'medal';
  const label = isStrokePlay ? '' : matchLabel(match.status, match.winner, match.result_str, holesStr);
  const homeColor = match.home_team?.accent_color ?? colors.gold;
  const awayColor = match.away_team?.accent_color ?? colors.textMuted;
  const homeLabel = match.home_team?.name ?? match.home_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
  const awayLabel = match.away_team?.name ?? match.away_player_ids.map(id => (playerNames[id] ?? '').split(' ')[0]).join(' & ');
  const { homeUp: liveHomeUp } = calcHoles(holesStr);
  const modalStatusText = isStrokePlay
    ? `Hole ${currentHole} · ${holeChars.filter(c => c !== '.').length} played`
    : liveHomeUp === 0 ? 'All Square'
      : liveHomeUp > 0 ? `${homeLabel} lead ${Math.abs(liveHomeUp)}UP`
      : `${awayLabel} lead ${Math.abs(liveHomeUp)}UP`;
  const HOLE_BG: Record<string, string> = { h: homeColor, a: awayColor, f: colors.grey };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerSub}>
          {match.day?.competition?.format === 'casual'
            ? `Casual · ${match.day?.course_name} · Live Scoring`
            : `Day ${match.day?.day_number} · Match ${match.match_number} · Live Scoring`}
        </Text>
      </View>

      {/* Hole progress dots */}
      <View style={styles.dotsRow}>
        {Array.from({ length: 18 }, (_, i) => {
          const c = holeChars[i] ?? '.';
          const isActive = i + 1 === currentHole && !isComplete;
          const bg = c !== '.' ? (HOLE_BG[c] ?? colors.grey) : colors.cardAlt;
          return (
            <View key={i} style={[styles.dot, { backgroundColor: bg }, isActive && styles.dotActive]} />
          );
        })}
      </View>
      <View style={styles.dotsLabelRow}>
        {Array.from({ length: 18 }, (_, i) => (
          <Text key={i} style={[styles.dotNum, i + 1 === currentHole && !isComplete && styles.dotNumActive]}>
            {i + 1}
          </Text>
        ))}
      </View>

      {!isStrokePlay && (
        <Text style={styles.liveStatus}>{label}</Text>
      )}

      {!isComplete ? (
        <>
          {/* Horizontal page swiper — Page 0: hole, Page 1: Front 9, Page 2: Back 9 */}
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
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
          {/* Current hole card */}
          <View style={styles.holeCard}>
            <View style={styles.holeCardInner}>

              {/* Left: hole info */}
              <View style={styles.holeCardLeft}>
                <Text style={styles.holeLabelSmall}>HOLE</Text>
                <Text style={styles.holeBig}>{currentHole}</Text>
                {courseHole && (
                  <>
                    <Text style={styles.holeMetaChip}>Par {courseHole.par}  ·  SI {courseHole.stroke_index}</Text>
                    {courseHole.yardage ? <Text style={styles.holeMetaChip}>{courseHole.yardage} yards</Text> : null}
                  </>
                )}
                {!isComplete && (
                  <TouchableOpacity style={styles.coachBtn} onPress={onCoachMe} disabled={coachLoading} activeOpacity={0.7}>
                    <Text style={styles.coachBtnText}>{coachLoading ? '🎙 Asking...' : '🎙 Coach Me'}</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.holeCardDivider} />

              {/* Right: mini leaderboard — sorted best score first */}
              <View style={styles.holeCardRight}>
                {[...allPlayerIds].sort((a, b) => {
                  const aVal = playerTotals[a] ?? 0;
                  const bVal = playerTotals[b] ?? 0;
                  if (match.round_format === 'medal') {
                    if (aVal === 0 && bVal === 0) return 0;
                    if (aVal === 0) return 1;
                    if (bVal === 0) return -1;
                    return aVal - bVal;
                  }
                  return bVal - aVal;
                }).map(id => {
                  const isHome = match.home_player_ids.includes(id);
                  const teamColor = isHome ? homeColor : awayColor;
                  const avatar = playerAvatars[id] ?? getPlayerAvatar(id, 'normal');
                  const firstName = (playerNames[id] ?? '?').split(' ')[0];
                  const total = playerTotals[id] ?? 0;
                  const scoreStr = total > 0
                    ? (match.round_format === 'stableford' ? `${total}pts` : `${total}`)
                    : '—';
                  return (
                    <View key={id} style={styles.lbRow}>
                      <View style={[styles.lbAvatarWrap, { borderColor: teamColor }]}>
                        {avatar ? (
                          <Image source={typeof avatar === 'string' ? { uri: avatar } : avatar} style={styles.lbAvatar} />
                        ) : (
                          <View style={[styles.lbAvatar, styles.lbAvatarFallback]}>
                            <Text style={styles.lbAvatarInitial}>{firstName[0]}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.lbName} numberOfLines={1}>{firstName}</Text>
                      <Text style={[styles.lbScore, { color: teamColor }]}>{scoreStr}</Text>
                    </View>
                  );
                })}
              </View>

            </View>

            {/* Gets a shot */}
            {shotPlayerIds.length > 0 && (
              <View style={styles.shotRow}>
                <Text style={styles.shotLabel}>Gets a shot</Text>
                <View style={styles.shotAvatars}>
                  {shotPlayerIds.map(id => {
                    const avatar = playerAvatars[id] ?? getPlayerAvatar(id, 'normal');
                    const isHome = match.home_player_ids.includes(id);
                    const teamColor = isHome ? homeColor : awayColor;
                    return (
                      <View key={id} style={[styles.shotAvatarWrap, { borderColor: teamColor }]}>
                        {avatar ? (
                          <Image source={typeof avatar === 'string' ? { uri: avatar } : avatar} style={styles.shotAvatar} />
                        ) : (
                          <View style={[styles.shotAvatar, styles.shotAvatarFallback]}>
                            <Text style={styles.shotAvatarInitial}>{(playerNames[id] ?? '?')[0]}</Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            <View style={styles.holeIconRow}>
              <TouchableOpacity style={styles.holeIconBtn} onPress={() => setShowRangeMap(true)} activeOpacity={0.7}>
                <Text style={styles.holeIconEmoji}>🔭</Text>
                <Text style={styles.holeIconLbl}>RANGE</Text>
              </TouchableOpacity>
              <View style={styles.holeIconSep} />
              <TouchableOpacity style={styles.holeIconBtn} onPress={() => setShowShotLogger(true)} activeOpacity={0.7}>
                <Text style={styles.holeIconEmoji}>🎯</Text>
                <Text style={styles.holeIconLbl}>SHOTS</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Side game banner */}
          {currentSideGame && (
            <View style={styles.sideGameBanner}>
              <Text style={styles.sideGameBannerIcon}>
                {currentSideGame === 'Longest Drive' ? '🏌️' : '📍'}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.sideGameBannerTitle}>{currentSideGame.toUpperCase()}</Text>
                <Text style={styles.sideGameBannerSub}>
                  {currentSideGame === 'Longest Drive'
                    ? 'Record your best drive in yards after scoring'
                    : 'Record the closest distance after scoring'}
                </Text>
              </View>
            </View>
          )}

          {/* Voice caddie */}
          {courseHole && match && (
            <CaddieButton
              context={{
                playerName: myPlayerId ? (playerNames[myPlayerId] ?? 'Player') : 'Player',
                holeNumber: currentHole,
                par: courseHole.par,
                yardage: courseHole.yardage,
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
                  });
                }
              }}
            />
          )}
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
            onUndo={undoHole}
            lastPlayedHole={lastPlayedHole}
            saving={saving}
            screenWidth={screenWidth}
          />
          </ScrollView>

          {/* Pagination dots */}
          <View style={styles.pageDots}>
            {[0, 1, 2].map(i => (
              <View key={i} style={[styles.pageDot, currentPage === i && styles.pageDotActive]} />
            ))}
          </View>

          {/* Fixed footer */}
          <View style={styles.actionFooter}>
            <TouchableOpacity
              style={styles.scoreHoleBtn}
              onPress={openScoreModal}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Text style={styles.scoreHoleBtnText}>Score Hole {currentHole}</Text>
            </TouchableOpacity>
            {lastPlayedHole > 0 && (
              <TouchableOpacity style={styles.undoBtn} onPress={undoHole} disabled={saving}>
                <Text style={styles.undoText}>← Edit Hole {lastPlayedHole}</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      ) : (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>

          {/* Winner announcement */}
          <View style={styles.completeHero}>
            <Text style={styles.completeStar}>★</Text>
            <Text style={styles.completeTitle}>MATCH COMPLETE</Text>
            <Text style={styles.completeResult}>{match.result_str ?? 'Done'}</Text>
            <Text style={styles.completeWinner}>
              {match.winner === 'half'
                ? 'Match Halved'
                : `${match.winner === 'home' ? homeLabel : awayLabel} Win`}
            </Text>
          </View>

          {/* Side game results */}
          {match.side_games && match.side_games.length > 0 && (
            <View style={styles.sideGameSummary}>
              <Text style={styles.sideGameSummaryTitle}>SIDE GAMES</Text>
              {match.side_games.map(sg => {
                const type = sg.split(':')[0];
                const result = (match as any).side_game_results?.[type];
                return (
                  <View key={sg} style={styles.sideGameSummaryRow}>
                    <Text style={styles.sideGameSummaryIcon}>{type === 'Longest Drive' ? '🏌️' : '📍'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sideGameSummaryType}>{type}</Text>
                      <Text style={styles.sideGameSummaryResult}>
                        {result ? `${result.player ? result.player + ' · ' : ''}${result.result}` : 'Not recorded'}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Scorecard pager */}
          <View style={styles.completeScorecardWrap}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={e => setCurrentPage(Math.round(e.nativeEvent.contentOffset.x / screenWidth))}
              style={{ flex: 1 }}
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
                onUndo={undoHole}
                lastPlayedHole={0}
                saving={saving}
                screenWidth={screenWidth}
              />
            </ScrollView>
            <View style={styles.pageDots}>
              {[0, 1].map(i => (
                <View key={i} style={[styles.pageDot, currentPage === i && styles.pageDotActive]} />
              ))}
            </View>
          </View>

          {lastPlayedHole > 0 && (
            <TouchableOpacity
              style={styles.undoBtn}
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
              <Text style={styles.undoText}>← Correct Hole {lastPlayedHole}</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      {saving && (
        <View style={styles.savingIndicator}>
          <ActivityIndicator color={colors.gold} size="small" />
        </View>
      )}

      {/* ── Score entry modal ───────────────────────────────────── */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setModalVisible(false)} activeOpacity={0.7}>
              <Text style={styles.modalCloseTxt}>✕</Text>
            </TouchableOpacity>
            <ScrollView
              style={{ width: '100%' }}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >

            {/* Progress dots */}
            <View style={styles.modalProgress}>
              {allPlayerIds.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.progressDot,
                    i < modalPlayerIdx && styles.progressDotDone,
                    i === modalPlayerIdx && styles.progressDotActive,
                  ]}
                />
              ))}
            </View>

            {/* Live match status — compact, always one line */}
            <View style={styles.modalStatusStrip}>
              <Text style={styles.modalStatusText} numberOfLines={1}>{modalStatusText}</Text>
            </View>

            {/* Team label */}
            <Text style={[styles.modalTeamLabel, { color: modalTeamColor }]}>
              {modalTeamName?.toUpperCase()}
            </Text>

            {/* Player photo */}
            <View style={[styles.modalAvatarWrap, { borderColor: modalTeamColor }]}>
              {modalPlayerAvatar ? (
                <Image source={typeof modalPlayerAvatar === 'string' ? { uri: modalPlayerAvatar } : modalPlayerAvatar} style={styles.modalAvatar} />
              ) : (
                <View style={[styles.modalAvatar, styles.modalAvatarFallback]}>
                  <Text style={styles.modalAvatarInitial}>{modalPlayerName[0] ?? '?'}</Text>
                </View>
              )}
            </View>

            <Text style={styles.modalPlayerName}>{modalPlayerName}</Text>

            {modalPlayerGetsShot && (
              <View style={styles.shotBadge}>
                <Text style={styles.shotBadgeText}>★ Gets a shot on this hole</Text>
              </View>
            )}

            {/* Score buttons 1–10 */}
            <View style={styles.scoreGrid}>
              {[1, 2, 3, 4, 5].map(n => (
                <TouchableOpacity
                  key={n}
                  style={[styles.scoreBtn, selectedScore === n && { backgroundColor: modalTeamColor }]}
                  onPress={() => setSelectedScore(n)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.scoreBtnText, selectedScore === n && styles.scoreBtnTextSelected]}>
                    {n}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.scoreGrid}>
              {[6, 7, 8, 9, 10].map(n => (
                <TouchableOpacity
                  key={n}
                  style={[styles.scoreBtn, selectedScore === n && { backgroundColor: modalTeamColor }]}
                  onPress={() => setSelectedScore(n)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.scoreBtnText, selectedScore === n && styles.scoreBtnTextSelected]}>
                    {n}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Fairway — par 4/5 only */}
            {courseHole && courseHole.par >= 4 && (
              <View style={styles.statSection}>
                <Text style={styles.statSectionLabel}>FAIRWAY</Text>
                <View style={styles.statBtnRow}>
                  <TouchableOpacity
                    style={[styles.statBtn, selectedFairway === 'left' && styles.statBtnRed]}
                    onPress={() => setSelectedFairway(selectedFairway === 'left' ? null : 'left')}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.statBtnText, selectedFairway === 'left' && styles.statBtnTextSelected]}>◀ Left</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.statBtn, selectedFairway === 'centre' && styles.statBtnGreen]}
                    onPress={() => setSelectedFairway(selectedFairway === 'centre' ? null : 'centre')}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.statBtnText, selectedFairway === 'centre' && styles.statBtnTextSelected]}>● Centre</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.statBtn, selectedFairway === 'right' && { backgroundColor: 'rgba(249,115,22,0.25)', borderColor: '#f97316' }]}
                    onPress={() => setSelectedFairway(selectedFairway === 'right' ? null : 'right')}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.statBtnText, selectedFairway === 'right' && { color: '#f97316' }]}>Right ▶</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Putts */}
            <View style={styles.statSection}>
              <Text style={styles.statSectionLabel}>PUTTS</Text>
              <View style={styles.statBtnRow}>
                {([1, 2, 3, 4] as const).map(n => (
                  <TouchableOpacity
                    key={n}
                    style={[styles.statBtn, styles.statBtnPutt, selectedPutts === n && styles.statBtnGold]}
                    onPress={() => setSelectedPutts(selectedPutts === n ? null : n)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.statBtnText, selectedPutts === n && styles.statBtnTextSelected]}>
                      {n === 4 ? '3+' : n}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Submit */}
            <TouchableOpacity
              style={[styles.submitBtn, !selectedScore && styles.submitBtnDisabled]}
              onPress={submitPlayerScore}
              disabled={!selectedScore}
              activeOpacity={0.85}
            >
              <Text style={styles.submitBtnText}>
                {modalPlayerIdx < allPlayerIds.length - 1 ? 'Next Player' : 'Calculate Hole'}
              </Text>
            </TouchableOpacity>

            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Side game result modal */}
      <Modal visible={!!sideGameModal} transparent animationType="slide" onRequestClose={() => setSideGameModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.sideGameModalTitle}>
              {sideGameModal?.type === 'Longest Drive' ? '🏌️ LONGEST DRIVE' : '📍 NEAREST THE PIN'}
            </Text>
            <Text style={styles.sideGameModalSub}>
              Hole {sideGameModal?.hole} · {sideGameModal?.type === 'Longest Drive' ? 'Enter distance in yards' : 'Enter distance (e.g. 4ft 2in)'}
            </Text>

            <TextInput
              style={styles.sideGameInput}
              value={sideGameResult}
              onChangeText={setSideGameResult}
              placeholder={sideGameModal?.type === 'Longest Drive' ? 'e.g. 285 yards' : 'e.g. 4ft 2in'}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={sideGameModal?.type === 'Longest Drive' ? 'numeric' : 'default'}
            />

            <Text style={styles.sideGameWinnerLabel}>WINNER (OPTIONAL)</Text>
            <View style={styles.sideGameWinnerRow}>
              {allPlayerIds.map(id => (
                <TouchableOpacity
                  key={id}
                  style={[styles.sideGameWinnerBtn, sideGameWinner === id && styles.sideGameWinnerBtnOn]}
                  onPress={() => setSideGameWinner(prev => prev === id ? null : id)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.sideGameWinnerName, sideGameWinner === id && styles.sideGameWinnerNameOn]}>
                    {(playerNames[id] ?? '?').split(' ')[0]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={styles.sideGameSaveBtn} onPress={saveSideGameResult} activeOpacity={0.85}>
              <Text style={styles.sideGameSaveBtnText}>Save Result</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sideGameSkipBtn} onPress={() => setSideGameModal(null)} activeOpacity={0.7}>
              <Text style={styles.sideGameSkipText}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {/* Range finder popup */}
      <Modal visible={showRangeMap} transparent animationType="slide" onRequestClose={() => setShowRangeMap(false)}>
        <View style={styles.popupOverlay}>
          <View style={styles.popupSheet}>
            <View style={styles.popupHeader}>
              <Text style={styles.popupTitle}>🔭  RANGE FINDER</Text>
              <TouchableOpacity onPress={() => setShowRangeMap(false)} style={styles.popupClose} activeOpacity={0.7}>
                <Text style={styles.popupCloseTxt}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={{ padding: spacing.md }}>
              <RangeMap courseName={match?.day?.course_name} holeNumber={currentHole} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Shot tracker popup */}
      <Modal visible={showShotLogger} transparent animationType="slide" onRequestClose={() => setShowShotLogger(false)}>
        <View style={styles.popupOverlay}>
          <View style={[styles.popupSheet, { height: '75%' }]}>
            <View style={styles.popupHeader}>
              <Text style={styles.popupTitle}>🎯  SHOT TRACKER</Text>
              <TouchableOpacity onPress={() => setShowShotLogger(false)} style={styles.popupClose} activeOpacity={0.7}>
                <Text style={styles.popupCloseTxt}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1 }}>
              {matchId && <ShotLogger matchId={matchId} holeNumber={currentHole} />}
            </View>
          </View>
        </View>
      </Modal>

      {recordsBroken.length > 0 && (
        <RecordCelebration
          records={recordsBroken}
          onDismiss={() => { setRecordsBroken([]); router.back(); }}
        />
      )}
    </View>
  );
}

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
  onUndo: () => void;
  lastPlayedHole: number;
  saving: boolean;
  screenWidth: number;
}

function Scorecard({ startHole, allPlayerIds, playerNames, holeData, courseHoles, matchHomeIds, holeChars, homeColor, awayColor, isStrokePlay, roundFormat, onUndo, lastPlayedHole, saving, screenWidth }: ScorecardProps) {
  const holes = Array.from({ length: 9 }, (_, i) => startHole + i);

  return (
    <ScrollView style={{ width: screenWidth }} contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl }} showsVerticalScrollIndicator={false}>
      <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>

        {/* Hole numbers */}
        <View style={{ flexDirection: 'row', backgroundColor: colors.cardAlt, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={scStyles.labelCol}><Text style={scStyles.headerTxt}>HOLE</Text></View>
          {holes.map(h => (
            <View key={h} style={scStyles.dataCol}>
              <Text style={[scStyles.headerTxt, holeChars[h - 1] !== '.' && { color: colors.white }]}>{h}</Text>
            </View>
          ))}
        </View>

        {/* Par row */}
        {courseHoles.length > 0 && (
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={scStyles.labelCol}><Text style={scStyles.subTxt}>Par</Text></View>
            {holes.map(h => {
              const ch = courseHoles.find(c => c.hole_number === h);
              return <View key={h} style={scStyles.dataCol}><Text style={scStyles.subTxt}>{ch?.par ?? '—'}</Text></View>;
            })}
          </View>
        )}

        {/* Player rows */}
        {allPlayerIds.map((id, idx) => {
          const isHome = matchHomeIds.includes(id);
          const teamColor = isHome ? homeColor : awayColor;
          const firstName = (playerNames[id] ?? '?').split(' ')[0];
          const isLastRow = idx === allPlayerIds.length - 1 && isStrokePlay;
          return (
            <View key={id} style={[{ flexDirection: 'row' }, !isLastRow && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
              <View style={scStyles.labelCol}>
                <Text style={[scStyles.nameTxt, { color: teamColor }]} numberOfLines={1}>{firstName}</Text>
              </View>
              {holes.map(h => {
                const score = holeData[id]?.[h];
                const gross = score?.gross;
                const pts = score?.pts;
                const played = holeChars[h - 1] !== '.';
                let bg = 'transparent';
                if (roundFormat === 'stableford' && gross && pts !== null && pts !== undefined) {
                  if (pts >= 4) bg = 'rgba(212,175,55,0.25)';
                  else if (pts >= 3) bg = 'rgba(74,222,128,0.18)';
                  else if (pts <= 0) bg = 'rgba(248,113,113,0.12)';
                }
                return (
                  <View key={h} style={[scStyles.dataCol, { backgroundColor: bg }]}>
                    <Text style={[scStyles.scoreTxt, { color: gross ? colors.white : played ? colors.textMuted : 'transparent' }]}>
                      {gross ?? (played ? '—' : '')}
                    </Text>
                    {roundFormat === 'stableford' && gross && pts !== null && pts !== undefined && (
                      <Text style={[scStyles.ptsTxt, { color: pts >= 3 ? colors.gold : colors.textMuted }]}>{pts}</Text>
                    )}
                  </View>
                );
              })}
            </View>
          );
        })}

        {/* Matchplay hole result row */}
        {!isStrokePlay && (
          <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.cardAlt }}>
            <View style={scStyles.labelCol}><Text style={scStyles.subTxt}>Hole</Text></View>
            {holes.map(h => {
              const c = holeChars[h - 1];
              const color = c === 'h' ? homeColor : c === 'a' ? awayColor : colors.textMuted;
              return (
                <View key={h} style={scStyles.dataCol}>
                  <Text style={[scStyles.resultTxt, { color }]}>
                    {c === 'h' ? 'H' : c === 'a' ? 'A' : c === 'f' ? '½' : ''}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {lastPlayedHole > 0 && (
        <TouchableOpacity style={{ alignItems: 'center', paddingVertical: spacing.lg }} onPress={onUndo} disabled={saving} activeOpacity={0.7}>
          <Text style={{ fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600', letterSpacing: 0.5 }}>← Edit Hole {lastPlayedHole}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const scStyles = StyleSheet.create({
  labelCol: { width: 52, justifyContent: 'center', paddingHorizontal: 6, paddingVertical: 8 },
  dataCol: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 7 },
  headerTxt: { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5 },
  subTxt: { fontSize: 10, color: colors.textMuted, fontWeight: '600' },
  nameTxt: { fontSize: 10, fontWeight: '800' },
  scoreTxt: { fontSize: 13, fontWeight: '700' },
  ptsTxt: { fontSize: 7, fontWeight: '800', marginTop: 1 },
  resultTxt: { fontSize: 11, fontWeight: '800' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },

  header: {
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { marginBottom: spacing.xs },
  backText: { fontSize: fonts.md, color: colors.gold, fontWeight: '600' },
  headerSub: { fontSize: fonts.xs, color: colors.textMuted, letterSpacing: 1 },

  liveStatus: {
    textAlign: 'center',
    fontSize: fonts.md,
    fontWeight: '900',
    color: colors.live,
    paddingVertical: spacing.xs,
  },

  dotsRow: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingTop: spacing.lg, gap: 3 },
  dot: { flex: 1, height: 10, borderRadius: 2 },
  dotActive: { borderWidth: 1.5, borderColor: colors.gold, backgroundColor: 'transparent' },
  dotsLabelRow: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingTop: 3, paddingBottom: spacing.lg, gap: 3 },
  dotNum: { flex: 1, fontSize: 8, color: colors.textMuted, textAlign: 'center' },
  dotNumActive: { color: colors.gold, fontWeight: '700' },

  holeCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  holeCardInner: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  holeCardLeft: { flex: 1 },
  holeCardDivider: { width: 1, backgroundColor: colors.border, marginHorizontal: spacing.md },
  holeCardRight: { flex: 1, justifyContent: 'center', gap: spacing.sm },

  holeLabelSmall: { fontSize: fonts.xs, color: colors.textMuted, letterSpacing: 2, fontWeight: '700' },
  holeBig: { fontSize: 56, fontWeight: '900', color: colors.white, lineHeight: 62 },
  holeMetaChip: { fontSize: fonts.xs, color: colors.textMuted, fontWeight: '600', marginTop: 3 },

  coachBtn: { marginTop: spacing.sm, alignSelf: 'flex-start', backgroundColor: colors.cardAlt, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderWidth: 1, borderColor: colors.border },
  coachBtnText: { fontSize: fonts.xs, color: colors.textSecondary, fontWeight: '700', letterSpacing: 0.3 },

  lbRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  lbAvatarWrap: { borderRadius: 14, borderWidth: 1.5, overflow: 'hidden' },
  lbAvatar: { width: 26, height: 26 },
  lbAvatarFallback: { backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  lbAvatarInitial: { fontSize: 10, fontWeight: '700', color: colors.white },
  lbName: { flex: 1, fontSize: fonts.xs, color: colors.textSecondary, fontWeight: '600' },
  lbScore: { fontSize: fonts.sm, fontWeight: '800' },

  shotRow: { alignItems: 'center', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, width: '100%', paddingHorizontal: spacing.lg },
  shotLabel: { fontSize: fonts.xs, color: colors.textMuted, letterSpacing: 1, marginBottom: spacing.xs },
  shotAvatars: { flexDirection: 'row', gap: spacing.sm },
  shotAvatarWrap: { borderRadius: 20, borderWidth: 2, overflow: 'hidden' },
  shotAvatar: { width: 36, height: 36 },
  shotAvatarFallback: { backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  shotAvatarInitial: { fontSize: fonts.sm, fontWeight: '700', color: colors.white },

  scrollContent: { paddingBottom: spacing.md },

  actionFooter: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  scoreHoleBtn: {
    backgroundColor: colors.gold,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg + 2,
    alignItems: 'center',
  },
  scoreHoleBtnText: { fontSize: fonts.xl, fontWeight: '800', color: colors.bg, letterSpacing: 1 },

  pageDots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: spacing.xs + 2 },
  pageDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  pageDotActive: { backgroundColor: colors.gold, borderColor: colors.gold, width: 18, borderRadius: 3 },

  undoBtn: { alignItems: 'center', paddingVertical: spacing.sm, marginTop: spacing.xs },
  undoText: { fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600', letterSpacing: 0.5 },

  completeHero: { alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.xl },
  completeStar: { fontSize: 40, color: colors.gold, marginBottom: spacing.sm },
  completeTitle: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 3, marginBottom: spacing.sm },
  completeResult: { fontSize: 56, fontWeight: '900', color: colors.gold, letterSpacing: 2 },
  completeWinner: { fontSize: fonts.lg, fontWeight: '600', color: colors.white, marginTop: spacing.xs },

  sideGameSummary: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  sideGameSummaryTitle: { fontSize: 9, fontWeight: '800', color: colors.textMuted, letterSpacing: 2, marginBottom: spacing.sm },
  sideGameSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  sideGameSummaryIcon: { fontSize: 20 },
  sideGameSummaryType: { fontSize: fonts.sm, fontWeight: '700', color: colors.white },
  sideGameSummaryResult: { fontSize: fonts.xs, color: colors.textMuted, fontWeight: '600', marginTop: 2 },

  completeScorecardWrap: { height: 340, marginBottom: spacing.sm },

  savingIndicator: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.full,
    padding: spacing.sm + 4,
    borderWidth: 1,
    borderColor: colors.border,
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    maxHeight: '90%',
  },
  modalScrollContent: {
    alignItems: 'center',
    width: '100%',
    paddingBottom: 48,
  },

  modalProgress: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  progressDotDone: { backgroundColor: colors.grey },
  progressDotActive: { backgroundColor: colors.gold, borderColor: colors.gold },

  modalStatusStrip: {
    backgroundColor: colors.cardAlt,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalStatusText: { fontSize: fonts.xs, fontWeight: '700', color: colors.gold, textAlign: 'center', letterSpacing: 0.5 },
  modalTeamLabel: { fontSize: fonts.xs, fontWeight: '700', letterSpacing: 2, marginBottom: spacing.md },

  modalAvatarWrap: { borderRadius: 52, borderWidth: 3, overflow: 'hidden', marginBottom: spacing.sm },
  modalAvatar: { width: 100, height: 100 },
  modalAvatarFallback: { backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  modalAvatarInitial: { fontSize: 40, fontWeight: '800', color: colors.white },

  modalPlayerName: { fontSize: fonts.xl, fontWeight: '800', color: colors.white, marginBottom: spacing.xs },

  shotBadge: {
    backgroundColor: 'rgba(212,175,55,0.15)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    marginBottom: spacing.md,
  },
  shotBadgeText: { fontSize: fonts.xs, color: colors.gold, fontWeight: '700', letterSpacing: 0.5 },

  scoreGrid: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, width: '100%' },
  scoreBtn: {
    flex: 1,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  scoreBtnText: { fontSize: fonts.lg, fontWeight: '700', color: colors.textSecondary },
  scoreBtnTextSelected: { color: colors.white },

  statSection: { width: '100%', marginTop: spacing.md },
  statSectionLabel: { fontSize: 9, fontWeight: '800', color: colors.textMuted, letterSpacing: 2, marginBottom: spacing.xs, textAlign: 'center' },
  statBtnRow: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' },
  statBtn: {
    flex: 1, height: 40, borderRadius: radius.md,
    backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  statBtnPutt: { flex: 0, width: 56 },
  statBtnGreen: { backgroundColor: 'rgba(74,222,128,0.2)', borderColor: colors.green },
  statBtnRed:   { backgroundColor: 'rgba(248,113,113,0.2)', borderColor: colors.red },
  statBtnGold:  { backgroundColor: colors.goldDim, borderColor: colors.gold },
  statBtnText:  { fontSize: fonts.sm, fontWeight: '700', color: colors.textSecondary },
  statBtnTextSelected: { color: colors.white },

  submitBtn: {
    marginTop: spacing.lg,
    width: '100%',
    backgroundColor: colors.gold,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.35 },
  submitBtnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg, letterSpacing: 1 },

  sideGameBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.goldDim, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.gold,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    marginHorizontal: spacing.lg, marginBottom: spacing.sm,
  },
  sideGameBannerIcon: { fontSize: 28 },
  sideGameBannerTitle: { fontSize: fonts.sm, fontWeight: '900', color: colors.gold, letterSpacing: 1 },
  sideGameBannerSub: { fontSize: fonts.xs, color: colors.textMuted, marginTop: 2 },

  sideGameModalTitle: { fontSize: fonts.md, fontWeight: '900', color: colors.gold, letterSpacing: 1.5, marginBottom: spacing.xs },
  sideGameModalSub: { fontSize: fonts.xs, color: colors.textMuted, marginBottom: spacing.lg, textAlign: 'center' },
  sideGameInput: {
    width: '100%', backgroundColor: colors.cardAlt, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4,
    fontSize: fonts.lg, fontWeight: '700', color: colors.white, textAlign: 'center',
    marginBottom: spacing.lg,
  },
  sideGameWinnerLabel: { fontSize: 9, fontWeight: '800', color: colors.textMuted, letterSpacing: 2, alignSelf: 'flex-start', marginBottom: spacing.sm },
  sideGameWinnerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, width: '100%', marginBottom: spacing.lg },
  sideGameWinnerBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardAlt,
  },
  sideGameWinnerBtnOn: { borderColor: colors.gold, backgroundColor: colors.goldDim },
  sideGameWinnerName: { fontSize: fonts.sm, fontWeight: '600', color: colors.textSecondary },
  sideGameWinnerNameOn: { color: colors.white },
  sideGameSaveBtn: {
    width: '100%', backgroundColor: colors.gold, borderRadius: radius.lg,
    paddingVertical: spacing.md, alignItems: 'center', marginBottom: spacing.sm,
  },
  sideGameSaveBtnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg, letterSpacing: 1 },
  sideGameSkipBtn: { paddingVertical: spacing.sm, alignItems: 'center' },
  sideGameSkipText: { fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600' },

  modalCloseBtn: { position: 'absolute', top: spacing.md, right: spacing.md, zIndex: 10, width: 32, height: 32, borderRadius: 16, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  modalCloseTxt: { fontSize: fonts.md, fontWeight: '600', color: colors.textMuted },

  holeIconRow: { flexDirection: 'row', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, width: '100%', alignItems: 'center', justifyContent: 'center' },
  holeIconBtn: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm },
  holeIconEmoji: { fontSize: 22 },
  holeIconLbl: { fontSize: 8, fontWeight: '800', color: colors.textMuted, letterSpacing: 1, marginTop: 3 },
  holeIconSep: { width: 1, height: 32, backgroundColor: colors.border },

  popupOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  popupSheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '80%' },
  popupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  popupTitle: { fontSize: fonts.md, fontWeight: '800', color: colors.white, letterSpacing: 1 },
  popupClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  popupCloseTxt: { fontSize: fonts.md, fontWeight: '600', color: colors.white },
});
