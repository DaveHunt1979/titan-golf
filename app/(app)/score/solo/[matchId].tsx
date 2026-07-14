import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, Image, ScrollView, TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../../src/lib/supabase';
import { calcCourseHandicap, calcStrokesReceived, calcStablefordPoints } from '../../../../src/lib/scoring';
import { resolveAvatar } from '../../../../src/lib/assets';
import { sendMatchNotification } from '../../../../src/lib/notifications';
import { speakHole, speakIntro, speakBack9, speakOutro } from '../../../../src/lib/caddie';
import * as Location from 'expo-location';
import RangeMap from '../../../../src/components/RangeMap';
import ShotLogger from '../../../../src/components/ShotLogger';
import RecordCelebration from '../../../../src/components/RecordCelebration';
import { checkAndUpdateRecords, type BrokenRecord } from '../../../../src/lib/records';
import { sendSoloMatchToWatch, clearSoloMatchFromWatch, onWatchSoloScoreEntry, onWatchRequestsState } from '../../../../src/lib/watch';
import CaddieButton from '../../../../src/components/CaddieButton';
import type { VoiceCommandResult } from '../../../../src/lib/voiceCommand';

const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const RED    = '#f87171';
const BLUE   = '#3b82f6';
const ORANGE = '#f97316';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';
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

function Avatar({ name, size = 44, src }: { name: string; size?: number; src?: any }) {
  if (src) {
    const imgSrc = typeof src === 'string' ? { uri: src } : src;
    return <Image source={imgSrc} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${GOLD}20`, borderWidth: 1.5, borderColor: `${GOLD}60`, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: FFB, fontSize: size * 0.38, color: GOLD }}>{(name || '?')[0].toUpperCase()}</Text>
    </View>
  );
}

interface MatchInfo {
  id: string;
  match_number: number;
  competition_id: string | null;
  round_format: 'stableford' | 'medal';
  status: 'upcoming' | 'in_progress' | 'complete';
  holes_string: string;
  home_player_ids: string[];
  side_games: string[] | null;
  day: { course_name: string; course_par: number; course_rating: number; slope_rating: number; day_number: number } | null;
}

interface CourseHole { hole_number: number; par: number; stroke_index: number; yardage: number | null; tee_yardages: Record<string, number> | null; }
interface HoleScore { hole_number: number; gross: number; net: number; pts: number; }

export default function SoloRoundScreen() {
  const { matchId, startHole: startHoleParam, teeColor } = useLocalSearchParams<{ matchId: string; startHole?: string; teeColor?: string }>();
  const startHole = Math.max(1, Math.min(18, parseInt(startHoleParam ?? '1', 10) || 1));
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [match, setMatch]           = useState<MatchInfo | null>(null);
  const [courseHoles, setCourseHoles] = useState<CourseHole[]>([]);
  const [playerName, setPlayerName]   = useState('');
  const [avatarUrl, setAvatarUrl]     = useState<string | null>(null);
  const [playerHcp, setPlayerHcp]     = useState(0);
  const [courseHcp, setCourseHcp]     = useState(0);
  const [savedScores, setSavedScores] = useState<HoleScore[]>([]);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [recordsBroken, setRecordsBroken] = useState<BrokenRecord[]>([]);

  const [coachLoading, setCoachLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedScore, setSelectedScore] = useState<number | null>(null);
  const [editingHole, setEditingHole] = useState<number | null>(null);
  const [selectedFairway, setSelectedFairway] = useState<'left' | 'centre' | 'right' | null>(null);
  const [selectedPutts, setSelectedPutts] = useState<number | null>(null);
  const [sideGameModal, setSideGameModal] = useState<{ type: string; hole: number } | null>(null);
  const [sideGameResult, setSideGameResult] = useState('');
  const [sideGameWinner, setSideGameWinner] = useState<string | null>(null);
  const [showRangeMap, setShowRangeMap]     = useState(false);
  const [showShotLogger, setShowShotLogger] = useState(false);
  const [showCaddieModal, setShowCaddieModal] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: matchData } = await supabase
        .from('matches')
        .select('*, day:day_id(course_name,course_par,course_rating,slope_rating,day_number)')
        .eq('id', matchId)
        .single();

      if (!matchData) { setLoading(false); return; }
      const m = matchData as unknown as MatchInfo;
      setMatch(m);

      const playerId = m.home_player_ids[0];
      const [{ data: holesData }, { data: playerData }, { data: scoresData }] = await Promise.all([
        m.day?.course_name
          ? supabase.from('course_holes').select('hole_number,par,stroke_index,yardage,tee_yardages').eq('course_name', m.day.course_name).order('hole_number')
          : Promise.resolve({ data: [] }),
        supabase.from('players').select('display_name,handicap_index,avatar_url').eq('id', playerId).single(),
        supabase.from('match_holes').select('hole_number,gross_score,net_score,stableford_pts').eq('match_id', matchId).eq('player_id', playerId),
      ]);

      if (holesData) setCourseHoles(holesData);
      if (playerData) {
        const p = playerData as any;
        setPlayerName(p.display_name ?? '');
        setAvatarUrl(p.avatar_url ?? null);
        const hcp = p.handicap_index ?? 0;
        setPlayerHcp(hcp);
        if (m.day?.slope_rating && m.day?.course_rating && m.day?.course_par) {
          setCourseHcp(calcCourseHandicap(hcp, m.day.slope_rating, m.day.course_rating, m.day.course_par));
        } else {
          setCourseHcp(Math.round(hcp));
        }
      }
      if (scoresData) {
        setSavedScores((scoresData as any[]).map(r => ({
          hole_number: r.hole_number,
          gross: r.gross_score ?? 0,
          net: r.net_score ?? 0,
          pts: r.stableford_pts ?? 0,
        })));
      }
      setLoading(false);
    }
    load();
  }, [matchId]);

  const matchRef         = useRef<MatchInfo | null>(null);
  const courseHolesRef   = useRef<CourseHole[]>([]);
  const courseHcpRef     = useRef<number>(0);
  const savedScoresRef   = useRef<HoleScore[]>([]);
  const nextHoleRef      = useRef<number>(1);
  const isStablefordRef  = useRef<boolean>(false);

  const holesStr    = match?.holes_string ?? '..................';
  const holeChars   = holesStr.split('');
  const holeSequence = startHole > 1
    ? [...Array.from({ length: 19 - startHole }, (_, i) => startHole + i), ...Array.from({ length: startHole - 1 }, (_, i) => i + 1)]
    : Array.from({ length: 18 }, (_, i) => i + 1);
  const nextHole  = holeSequence.find(h => holeChars[h - 1] === '.') ?? 19;
  const activeHole = editingHole ?? nextHole;
  const isComplete = nextHole > 18;
  const isStableford = match?.round_format === 'stableford';

  const sideGameByHole = (match?.side_games ?? []).reduce((acc, sg) => {
    const [type, hole] = sg.split(':');
    if (hole) acc[parseInt(hole)] = type;
    return acc;
  }, {} as Record<number, string>);
  const currentSideGame = sideGameByHole[activeHole] ?? null;
  const voiceOff = match?.side_games?.includes('voice:off') ?? false;

  const courseHole = courseHoles.find(h => h.hole_number === activeHole);
  const shots = courseHole ? calcStrokesReceived(courseHcp, courseHole.stroke_index) : 0;
  const holeYardage = courseHole
    ? ((teeColor && courseHole.tee_yardages?.[teeColor]) || courseHole.yardage || null)
    : null;

  const totalGross = savedScores.reduce((s, h) => s + h.gross, 0);
  const totalPts   = savedScores.reduce((s, h) => s + h.pts, 0);
  const totalNet   = savedScores.reduce((s, h) => s + h.net, 0);
  const parPlayed  = savedScores.reduce((s, h) => {
    const ch = courseHoles.find(c => c.hole_number === h.hole_number);
    return s + (ch?.par ?? 0);
  }, 0);
  const vsPar = totalGross - parPlayed;

  const avatar = match ? resolveAvatar(match.home_player_ids[0], avatarUrl, 'normal') : null;

  matchRef.current        = match;
  courseHolesRef.current  = courseHoles;
  courseHcpRef.current    = courseHcp;
  savedScoresRef.current  = savedScores;
  nextHoleRef.current     = nextHole;
  isStablefordRef.current = isStableford;

  useEffect(() => {
    if (!match || courseHoles.length === 0 || !playerName) return;
    if (isComplete) { clearSoloMatchFromWatch(); return; }
    const hole = courseHoles.find(h => h.hole_number === nextHole);
    if (!hole) return;
    sendSoloMatchToWatch({
      matchId: match.id,
      playerName,
      format: match.round_format,
      currentHole: nextHole,
      par: hole.par,
      extraStrokes: calcStrokesReceived(courseHcp, hole.stroke_index),
      holesCompleted: savedScores.length,
      yardage: (teeColor && hole.tee_yardages?.[teeColor]) || hole.yardage || null,
      totalPts,
      toPar: vsPar,
    });
  }, [match?.id, match?.status, nextHole, courseHcp, courseHoles.length, isComplete, playerName, savedScores.length]);

  useEffect(() => {
    const unsub = onWatchSoloScoreEntry(async ({ matchId: wid, hole, score }) => {
      const m      = matchRef.current;
      const holes  = courseHolesRef.current;
      const hcp    = courseHcpRef.current;
      const scores = savedScoresRef.current;
      const nh     = nextHoleRef.current;
      const isStb  = isStablefordRef.current;
      if (wid !== matchId || hole !== nh || !m) return;
      const hd = holes.find(h => h.hole_number === hole);
      if (!hd) return;
      const extraShots = calcStrokesReceived(hcp, hd.stroke_index);
      const net = score - extraShots;
      const pts = calcStablefordPoints(score, hd.par, extraShots);
      setSaving(true);
      await supabase.from('match_holes').delete().eq('match_id', matchId).eq('hole_number', hole);
      await supabase.from('match_holes').insert({
        match_id: matchId,
        player_id: m.home_player_ids[0],
        hole_number: hole,
        score: null,
        gross_score: score,
        net_score: net,
        stableford_pts: pts,
      });
      const chars = [...m.holes_string.split('')];
      chars[hole - 1] = 'd';
      const newHolesStr = chars.join('');
      const holesLeft   = newHolesStr.split('').filter(c => c === '.').length;
      const newStatus   = holesLeft === 0 ? 'complete' : 'in_progress';
      const totalPtsSoFar   = scores.reduce((s, h) => s + h.pts,   0);
      const totalGrossSoFar = scores.reduce((s, h) => s + h.gross, 0);
      const parPlayedSoFar  = scores.reduce((s, h) => {
        const ch = holes.find(c => c.hole_number === h.hole_number);
        return s + (ch?.par ?? 0);
      }, 0);
      const vsParNew = totalGrossSoFar - parPlayedSoFar + score - hd.par;
      const result = isStb
        ? `${totalPtsSoFar + pts} pts`
        : `${vsParNew >= 0 ? '+' : ''}${vsParNew}`;
      await supabase.from('matches').update({ holes_string: newHolesStr, status: newStatus, result_str: result }).eq('id', m.id);
      setSavedScores(prev => [...prev.filter(h => h.hole_number !== hole), { hole_number: hole, gross: score, net, pts }]);
      setMatch(prev => prev ? { ...prev, holes_string: newHolesStr, status: newStatus } : prev);
      setSaving(false);
      if (newStatus === 'complete') {
        const broken = await checkAndUpdateRecords(matchId as string, m.home_player_ids[0]);
        if (broken.length > 0) { setRecordsBroken(broken); }
        else { Alert.alert('Round Complete!', result, [{ text: 'Done', onPress: () => router.back() }]); }
      }
    });
    return unsub;
  }, [matchId]);

  useEffect(() => {
    const unsub = onWatchRequestsState(() => {
      const m     = matchRef.current;
      const holes = courseHolesRef.current;
      const nh    = nextHoleRef.current;
      if (!m || holes.length === 0) return;
      const hole = holes.find(h => h.hole_number === nh);
      if (!hole) return;
      const scores = savedScoresRef.current;
      const tPts   = scores.reduce((s, h) => s + h.pts, 0);
      const tGross = scores.reduce((s, h) => s + h.gross, 0);
      const tPar   = scores.reduce((s, h) => { const ch = holes.find(c => c.hole_number === h.hole_number); return s + (ch?.par ?? 0); }, 0);
      sendSoloMatchToWatch({
        matchId: m.id,
        playerName,
        format: m.round_format,
        currentHole: nh,
        par: hole.par,
        extraStrokes: calcStrokesReceived(courseHcpRef.current, hole.stroke_index),
        holesCompleted: scores.length,
        yardage: (teeColor && hole.tee_yardages?.[teeColor]) || hole.yardage || null,
        totalPts: tPts,
        toPar: tGross - tPar,
      });
    });
    return unsub;
  }, [matchId, playerName]);

  useEffect(() => () => { clearSoloMatchFromWatch(); }, []);

  const introPlayedRef = useRef(false);
  const back9PlayedRef = useRef(false);
  const gpsRef         = useRef<{ lat: number; lng: number } | null>(null);

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
    if (!match || !playerName || loading || introPlayedRef.current) return;
    if (nextHole === 1) {
      introPlayedRef.current = true;
      if (!voiceOff) speakIntro([playerName.split(' ')[0]]);
    }
  }, [match, playerName, loading, nextHole]);

  useEffect(() => {
    if (!match || !playerName || loading || back9PlayedRef.current) return;
    if (nextHole === 10) {
      back9PlayedRef.current = true;
      const front9 = savedScores.filter(h => h.hole_number <= 9);
      const frontGross  = front9.reduce((s, h) => s + h.gross, 0);
      const frontPts    = front9.reduce((s, h) => s + h.pts,   0);
      const frontParSum = front9.reduce((s, h) => {
        const ch = courseHoles.find(c => c.hole_number === h.hole_number);
        return s + (ch?.par ?? 0);
      }, 0);
      if (!voiceOff) speakBack9(playerName.split(' ')[0], match.round_format, frontPts, frontGross, frontGross - frontParSum);
    }
  }, [match, playerName, loading, nextHole, savedScores, courseHoles]);

  async function onCoachMe() {
    if (coachLoading || voiceOff) return;
    setCoachLoading(true);
    await speakHole(nextHole, courseHole?.par ?? null, holeYardage, courseHole?.stroke_index ?? null, playerName ? [playerName.split(' ')[0]] : []);
    setCoachLoading(false);
  }

  async function saveScore() {
    if (selectedScore === null || !match || !courseHole) return;
    setSaving(true);
    setModalVisible(false);

    const gross = selectedScore;
    const net   = gross - shots;
    const pts   = calcStablefordPoints(gross, courseHole.par, shots);

    const { error: delErr } = await supabase.from('match_holes').delete()
      .eq('match_id', matchId).eq('hole_number', activeHole);
    if (delErr) console.error('delete error:', delErr);

    const { error: insErr } = await supabase.from('match_holes').insert({
      match_id: matchId,
      player_id: match.home_player_ids[0],
      hole_number: activeHole,
      score: null,
      gross_score: gross,
      net_score: net,
      stableford_pts: pts,
    });
    if (insErr) console.error('insert error:', insErr);

    const chars = [...holeChars];
    chars[activeHole - 1] = 'd';
    const newHolesStr = chars.join('');
    const holesLeft = newHolesStr.split('').filter(c => c === '.').length;
    const newStatus = holesLeft === 0 ? 'complete' : 'in_progress';

    const result = isStableford
      ? `${totalPts + pts} pts`
      : `${vsPar + gross - courseHole.par >= 0 ? '+' : ''}${vsPar + gross - courseHole.par}`;

    await supabase.from('matches').update({
      holes_string: newHolesStr,
      status: newStatus,
      result_str: result,
    }).eq('id', match.id);

    setSavedScores(prev => [...prev.filter(h => h.hole_number !== activeHole), { hole_number: activeHole, gross, net, pts }]);
    setMatch({ ...match, holes_string: newHolesStr, status: newStatus });
    setEditingHole(null);

    if (selectedFairway !== null || selectedPutts !== null) {
      await supabase.from('hole_stats').upsert({
        match_id: matchId,
        player_id: match.home_player_ids[0],
        hole_number: activeHole,
        fairway_hit: courseHole.par >= 4 ? (selectedFairway != null ? selectedFairway === 'centre' : null) : null,
        fairway_direction: courseHole.par >= 4 ? selectedFairway : null,
        putts: selectedPutts,
      }, { onConflict: 'match_id,player_id,hole_number' });
    }

    setSelectedScore(null);
    setSelectedFairway(null);
    setSelectedPutts(null);
    setSaving(false);

    if (!editingHole) {
      if (match.competition_id && playerName) {
        const firstName = playerName.split(' ')[0];
        const pids = [...(match.home_player_ids ?? [])];
        if (gross === 1) {
          sendMatchNotification(match.competition_id, '⛳ HOLE IN ONE!', `${firstName} just made a hole in one on hole ${activeHole}!`, pids);
        } else if (gross <= courseHole.par - 2) {
          sendMatchNotification(match.competition_id, '🦅 Eagle!', `${firstName} just made an eagle on hole ${activeHole}!`, pids);
        } else if (gross === courseHole.par - 1) {
          sendMatchNotification(match.competition_id, '🐦 Birdie!', `${firstName} is on fire — birdie on hole ${activeHole}!`, pids);
        }
      }

      if (currentSideGame) {
        setSideGameResult('');
        setSideGameWinner(null);
        setSideGameModal({ type: currentSideGame, hole: activeHole });
      }

      if (newStatus === 'complete') {
        const summary = isStableford ? `${totalPts + pts} points` : `${vsPar + gross - courseHole.par >= 0 ? '+' : ''}${vsPar + gross - courseHole.par}`;
        const broken = await checkAndUpdateRecords(matchId as string, match.home_player_ids[0]);
        if (broken.length > 0) { setRecordsBroken(broken); }
        else { Alert.alert('Round Complete!', summary, [{ text: 'Done', onPress: () => router.back() }]); }
      }
    }
  }

  async function saveSideGameResult() {
    if (!sideGameModal || !match) return;
    const { type, hole } = sideGameModal;
    const winnerName = sideGameWinner ? playerName.split(' ')[0] : null;
    const existing = (match as any).side_game_results ?? {};
    const updated = { ...existing, [type]: { hole, result: sideGameResult, player: winnerName } };
    await supabase.from('matches').update({ side_game_results: updated } as any).eq('id', match.id);
    if (match.competition_id && sideGameResult) {
      const icon = type === 'Longest Drive' ? '🏌️' : '📍';
      const unit = type === 'Longest Drive' ? 'yards' : '';
      const body = winnerName
        ? `${winnerName} wins with ${sideGameResult}${unit ? ' ' + unit : ''} on hole ${hole}!`
        : `Result on hole ${hole}: ${sideGameResult}${unit ? ' ' + unit : ''}`;
      const pids = [...(match.home_player_ids ?? [])];
      sendMatchNotification(match.competition_id, `${icon} ${type}`, body, pids);
    }
    setSideGameModal(null);
  }

  async function deleteMatch() {
    Alert.alert('Delete Round', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await supabase.from('match_holes').delete().eq('match_id', matchId);
          const { error } = await supabase.from('matches').delete().eq('id', matchId);
          if (error) { Alert.alert('Error', error.message); return; }
          router.back();
        },
      },
    ]);
  }

  async function undoHole() {
    if (!match || saving || nextHole <= 1) return;
    const lastDone = nextHole - 1;
    setSaving(true);
    await supabase.from('match_holes').delete().eq('match_id', matchId).eq('hole_number', lastDone);
    const chars = [...holeChars];
    chars[lastDone - 1] = '.';
    const newHolesStr = chars.join('');
    await supabase.from('matches').update({ holes_string: newHolesStr, status: 'in_progress' }).eq('id', match.id);
    setSavedScores(prev => prev.filter(h => h.hole_number !== lastDone));
    setMatch({ ...match, holes_string: newHolesStr, status: 'in_progress' });
    setSaving(false);
  }

  if (loading || !fontsLoaded) return (
    <View style={s.loading}><ActivityIndicator color={GOLD} size="large" /></View>
  );
  if (!match) return (
    <View style={s.loading}><Text style={{ fontFamily: FF, color: '#6b7280' }}>Round not found.</Text></View>
  );

  const formatLabel = isStableford ? 'Stableford' : 'Medal';
  const scoreDisplay = isStableford
    ? `${totalPts} pts`
    : totalGross === 0 ? 'E'
    : vsPar > 0 ? `+${vsPar}` : `${vsPar}`;
  const scoreColor = isStableford ? GOLD : (vsPar < 0 ? GREEN : vsPar > 0 ? RED : '#ffffff');

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
          <Text style={s.headerSub} numberOfLines={1}>{match.day?.course_name ?? 'Course'} · {formatLabel}</Text>
        </View>
        {!isComplete ? (
          <TouchableOpacity onPress={deleteMatch} style={s.headerSide} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="trash-outline" size={20} color="#4b5563" />
          </TouchableOpacity>
        ) : <View style={s.headerSide} />}
      </View>

      {/* ── Player + score ── */}
      <View style={s.playerBlock}>
        <Avatar name={playerName} size={52} src={avatar} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={s.playerNameText}>{playerName}</Text>
          <Text style={s.playerHcpText}>HCP {playerHcp} · Course {courseHcp}</Text>
        </View>
        <View style={s.scoreDisplay}>
          <Text style={[s.scoreDisplayVal, { color: scoreColor }]}>{scoreDisplay}</Text>
          <Text style={s.scoreDisplayLabel}>{isStableford ? 'POINTS' : 'VS PAR'}</Text>
        </View>
      </View>

      {/* ── Hole strip ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.holeStrip} style={s.holeStripWrap}>
        {Array.from({ length: 18 }, (_, i) => {
          const h = i + 1;
          const c = holeChars[h - 1] ?? '.';
          const done = c === 'd';
          const active = h === activeHole && !isComplete;
          const ch = courseHoles.find(x => x.hole_number === h);
          const sc = savedScores.find(sv => sv.hole_number === h);
          const tc = done ? (isStableford ? ptsColor(sc?.pts ?? 0) : (sc ? (sc.gross - (ch?.par ?? 4) < 0 ? GREEN : sc.gross - (ch?.par ?? 4) === 0 ? BLUE : RED) : '#6b7280')) : 'transparent';
          return (
            <TouchableOpacity
              key={h}
              onPress={done ? () => {
                setSelectedScore(sc?.gross ?? null);
                setSelectedFairway(null);
                setSelectedPutts(null);
                setEditingHole(h);
                setModalVisible(true);
              } : undefined}
              style={[
                s.holeTile,
                done && { backgroundColor: `${tc}22`, borderColor: `${tc}60` },
                active && !done && { borderColor: `${GOLD}80` },
              ]}
              activeOpacity={done ? 0.7 : 1}
            >
              <Text style={[s.holeTileNum, done && { color: tc }, active && !done && { color: GOLD }]}>{h}</Text>
              <Text style={s.holeTilePar}>P{ch?.par ?? '?'}</Text>
              {done && sc && (
                <Text style={[s.holeTilePts, { color: tc }]}>
                  {isStableford ? sc.pts : (sc.gross - (ch?.par ?? 4) === 0 ? 'E' : sc.gross - (ch?.par ?? 4) > 0 ? `+${sc.gross - (ch?.par ?? 4)}` : String(sc.gross - (ch?.par ?? 4)))}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View style={s.halfLabels}>
        <Text style={s.halfLabel}>FRONT 9</Text>
        <Text style={s.halfLabel}>BACK 9</Text>
      </View>

      {/* ── Scrollable body ── */}
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {!isComplete ? (
          <>
            {/* Hole card */}
            <View style={s.holeCard}>
              <Text style={s.holeLabelSmall}>HOLE</Text>
              <Text style={s.holeBig}>{nextHole}</Text>
              {courseHole && (
                <View style={s.holeChips}>
                  <View style={s.holeChip}><Text style={s.holeChipText}>Par {courseHole.par}</Text></View>
                  <View style={s.holeChip}><Text style={s.holeChipText}>SI {courseHole.stroke_index}</Text></View>
                  {holeYardage ? <View style={s.holeChip}><Text style={s.holeChipText}>{holeYardage}y</Text></View> : null}
                  {shots > 0 && (
                    <View style={[s.holeChip, s.holeChipGold]}>
                      <Ionicons name="golf-outline" size={10} color={GOLD} />
                      <Text style={[s.holeChipText, { color: GOLD }]}>+{shots} shot{shots > 1 ? 's' : ''}</Text>
                    </View>
                  )}
                </View>
              )}
              <View style={s.quickActions}>
                <TouchableOpacity style={s.quickActionBtn} onPress={() => setShowRangeMap(true)} activeOpacity={0.7}>
                  <Ionicons name="scan-outline" size={20} color="#6b7280" />
                  <Text style={s.quickActionLbl}>RANGE</Text>
                </TouchableOpacity>
                <View style={s.quickActionSep} />
                <TouchableOpacity style={s.quickActionBtn} onPress={() => setShowShotLogger(true)} activeOpacity={0.7}>
                  <Ionicons name="analytics-outline" size={20} color="#6b7280" />
                  <Text style={s.quickActionLbl}>SHOTS</Text>
                </TouchableOpacity>
                <View style={s.quickActionSep} />
                <TouchableOpacity style={s.quickActionBtn} onPress={() => setShowCaddieModal(true)} activeOpacity={0.7}>
                  <Ionicons name="mic-outline" size={20} color={GOLD} />
                  <Text style={[s.quickActionLbl, { color: GOLD }]}>CADDIE</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Side game banner */}
            {currentSideGame && (
              <View style={s.sideGameBanner}>
                <Ionicons name={currentSideGame === 'Longest Drive' ? 'flag-outline' : 'locate-outline'} size={22} color={GOLD} />
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

            {/* Main CTA */}
            <TouchableOpacity
              style={[s.ctaBtn, editingHole ? { backgroundColor: '#ffffff' } : null]}
              onPress={() => { setSelectedScore(null); setSelectedFairway(null); setSelectedPutts(null); setModalVisible(true); }}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Ionicons name="create-outline" size={20} color="#000000" />
              <Text style={s.ctaBtnText}>
                {editingHole ? `Edit Hole ${editingHole}` : `Score Hole ${nextHole}`}
              </Text>
            </TouchableOpacity>

            {editingHole ? (
              <TouchableOpacity style={s.undoBtn} onPress={() => setEditingHole(null)} disabled={saving}>
                <Text style={s.undoBtnText}>Cancel Edit</Text>
              </TouchableOpacity>
            ) : nextHole > 1 ? (
              <TouchableOpacity style={s.undoBtn} onPress={undoHole} disabled={saving}>
                <Ionicons name="arrow-undo-outline" size={14} color="#4b5563" />
                <Text style={s.undoBtnText}>Undo Hole {nextHole - 1}</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : (() => {
          const holesWithPar = savedScores.map(sv => {
            const ch = courseHoles.find(c => c.hole_number === sv.hole_number);
            return { ...sv, par: ch?.par ?? 0, vsPar: sv.gross - (ch?.par ?? 0) };
          });
          const eagles  = holesWithPar.filter(h => h.vsPar <= -2).length;
          const birdies = holesWithPar.filter(h => h.vsPar === -1).length;
          const pars    = holesWithPar.filter(h => h.vsPar === 0).length;
          const bogeys  = holesWithPar.filter(h => h.vsPar === 1).length;
          const doubles = holesWithPar.filter(h => h.vsPar >= 2).length;
          const bestHole  = holesWithPar.length ? holesWithPar.reduce((b, h) => h.vsPar < b.vsPar ? h : b) : null;
          const worstHole = holesWithPar.length ? holesWithPar.reduce((b, h) => h.vsPar > b.vsPar ? h : b) : null;
          const vsParLabel = (v: number) => v <= -2 ? 'Eagle+' : v === -1 ? 'Birdie' : v === 0 ? 'Par' : v === 1 ? 'Bogey' : v === 2 ? 'Double' : 'Triple+';
          const finalScore = isStableford ? `${totalPts} pts` : `${vsPar >= 0 ? '+' : ''}${vsPar}`;
          return (
            <View style={s.completeCard}>
              <Ionicons name="trophy" size={48} color={GOLD} />
              <Text style={s.completeTitle}>ROUND COMPLETE</Text>
              <Text style={[s.completeScore, { color: scoreColor }]}>{scoreDisplay}</Text>
              <Text style={s.completeDetail}>
                {isStableford ? `${totalGross} gross · ${totalPts} pts` : `${totalGross} gross`}
              </Text>
              <View style={s.statGrid}>
                {eagles  > 0 && <View style={s.statBox}><Text style={[s.statVal, { color: GOLD }]}>{eagles}</Text><Text style={s.statLbl}>Eagle{eagles !== 1 ? 's' : ''}</Text></View>}
                {birdies > 0 && <View style={s.statBox}><Text style={[s.statVal, { color: GREEN }]}>{birdies}</Text><Text style={s.statLbl}>Birdie{birdies !== 1 ? 's' : ''}</Text></View>}
                {pars    > 0 && <View style={s.statBox}><Text style={[s.statVal, { color: BLUE }]}>{pars}</Text><Text style={s.statLbl}>Par{pars !== 1 ? 's' : ''}</Text></View>}
                {bogeys  > 0 && <View style={s.statBox}><Text style={[s.statVal, { color: ORANGE }]}>{bogeys}</Text><Text style={s.statLbl}>Bogey{bogeys !== 1 ? 's' : ''}</Text></View>}
                {doubles > 0 && <View style={s.statBox}><Text style={[s.statVal, { color: RED }]}>{doubles}</Text><Text style={s.statLbl}>Double{doubles !== 1 ? 's' : ''}+</Text></View>}
              </View>
              {bestHole && worstHole && bestHole.hole_number !== worstHole.hole_number && (
                <View style={s.bestWorstRow}>
                  <View style={s.bestWorstBox}>
                    <Text style={s.bestWorstLbl}>BEST</Text>
                    <Text style={[s.bestWorstVal, { color: GREEN }]}>Hole {bestHole.hole_number}</Text>
                    <Text style={s.bestWorstSub}>{vsParLabel(bestHole.vsPar)}</Text>
                  </View>
                  <View style={s.bestWorstBox}>
                    <Text style={s.bestWorstLbl}>WORST</Text>
                    <Text style={[s.bestWorstVal, { color: RED }]}>Hole {worstHole.hole_number}</Text>
                    <Text style={s.bestWorstSub}>{vsParLabel(worstHole.vsPar)}</Text>
                  </View>
                </View>
              )}
              <TouchableOpacity
                style={s.endRoundBtn}
                onPress={async () => { if (playerName && !voiceOff) await speakOutro(playerName.split(' ')[0], finalScore); router.back(); }}
                activeOpacity={0.85}
              >
                <Ionicons name="mic-outline" size={18} color="#000000" />
                <Text style={s.endRoundText}>End Round</Text>
              </TouchableOpacity>
              {nextHole > 1 && (
                <TouchableOpacity style={s.undoBtn} onPress={undoHole} disabled={saving}>
                  <Ionicons name="arrow-undo-outline" size={14} color="#4b5563" />
                  <Text style={s.undoBtnText}>Undo Last Hole</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={s.deleteLink} onPress={deleteMatch}>
                <Ionicons name="trash-outline" size={13} color="#4b5563" />
                <Text style={s.deleteLinkText}>Delete Round</Text>
              </TouchableOpacity>
            </View>
          );
        })()}

        {/* Mini scorecard */}
        {savedScores.length > 0 && courseHoles.length > 0 && (
          <View style={s.scorecardCard}>
            <Text style={s.scorecardTitle}>SCORECARD</Text>
            {[
              courseHoles.filter(h => h.hole_number <= 9).sort((a, b) => a.hole_number - b.hole_number),
              courseHoles.filter(h => h.hole_number >= 10).sort((a, b) => a.hole_number - b.hole_number),
            ].map((half, hi) => {
              const halfScores = savedScores.filter(sv => hi === 0 ? sv.hole_number <= 9 : sv.hole_number >= 10);
              if (halfScores.length === 0 && hi === 1) return null;
              return (
                <View key={hi}>
                  <View style={s.scorecardRow}>
                    <Text style={s.scorecardHoleLabel}>HOLE</Text>
                    {half.map(h => <Text key={h.hole_number} style={[s.scorecardCell, { color: savedScores.find(sv => sv.hole_number === h.hole_number) ? '#ffffff' : '#2a2a2a' }]}>{h.hole_number}</Text>)}
                    <Text style={s.scorecardTot}>{hi === 0 ? 'OUT' : 'IN'}</Text>
                  </View>
                  <View style={s.scorecardRow}>
                    <Text style={s.scorecardHoleLabel}>PAR</Text>
                    {half.map(h => <Text key={h.hole_number} style={[s.scorecardCell, { color: GOLD }]}>{h.par}</Text>)}
                    <Text style={[s.scorecardTot, { color: GOLD }]}>{half.reduce((s, h) => s + h.par, 0)}</Text>
                  </View>
                  <View style={s.scorecardRow}>
                    <Text style={s.scorecardHoleLabel}>GROSS</Text>
                    {half.map(h => {
                      const sv = halfScores.find(s => s.hole_number === h.hole_number);
                      const diff = sv ? sv.gross - h.par : null;
                      return (
                        <View key={h.hole_number} style={[s.scorecardScoreCell, diff !== null && diff < 0 && { backgroundColor: `${GREEN}25` }, diff !== null && diff > 0 && { backgroundColor: `${RED}15` }]}>
                          <Text style={[s.scorecardScoreText, diff !== null && diff < 0 && { color: GREEN }, diff !== null && diff > 0 && { color: RED }]}>{sv?.gross ?? '·'}</Text>
                        </View>
                      );
                    })}
                    <Text style={s.scorecardTot}>{halfScores.reduce((s, h) => s + h.gross, 0) || '·'}</Text>
                  </View>
                  {isStableford && (
                    <View style={s.scorecardRow}>
                      <Text style={s.scorecardHoleLabel}>PTS</Text>
                      {half.map(h => {
                        const sv = halfScores.find(s => s.hole_number === h.hole_number);
                        return <Text key={h.hole_number} style={[s.scorecardCell, { color: sv ? ptsColor(sv.pts) : '#2a2a2a' }]}>{sv?.pts ?? '·'}</Text>;
                      })}
                      <Text style={[s.scorecardTot, { color: GOLD }]}>{halfScores.reduce((s, h) => s + h.pts, 0) || '·'}</Text>
                    </View>
                  )}
                  {hi === 0 && <View style={{ height: 1, backgroundColor: '#1a1a1a', marginVertical: 4 }} />}
                </View>
              );
            })}
          </View>
        )}

        {!isComplete && (
          <TouchableOpacity style={s.deleteLink} onPress={deleteMatch}>
            <Ionicons name="trash-outline" size={13} color="#4b5563" />
            <Text style={s.deleteLinkText}>Delete Round</Text>
          </TouchableOpacity>
        )}
        <View style={{ height: 32 }} />
      </ScrollView>

      {saving && (
        <View style={s.savingOverlay}>
          <ActivityIndicator color={GOLD} size="small" />
        </View>
      )}

      {/* ── Score entry modal ── */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <ScrollView contentContainerStyle={s.sheetScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={s.sheetHandle} />
              <View style={s.sheetPlayerRow}>
                <Avatar name={playerName} size={38} src={avatar} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={s.sheetPlayerName}>{playerName}</Text>
                  {courseHole && <Text style={s.sheetHoleInfo}>{editingHole ? `Edit Hole ${editingHole}` : `Hole ${nextHole}`} · Par {courseHole.par} · SI {courseHole.stroke_index}</Text>}
                </View>
                {selectedScore !== null && courseHole && isStableford && (
                  <Text style={[s.sheetPts, { color: ptsColor(calcStablefordPoints(selectedScore, courseHole.par, shots)) }]}>
                    {calcStablefordPoints(selectedScore, courseHole.par, shots)} pts
                  </Text>
                )}
              </View>
              {shots > 0 && (
                <View style={s.sheetShotBadge}>
                  <Ionicons name="golf-outline" size={12} color={GOLD} />
                  <Text style={s.sheetShotBadgeText}>Gets {shots} shot{shots > 1 ? 's' : ''} on this hole</Text>
                </View>
              )}

              {/* Score buttons */}
              <View style={s.scoreGrid}>
                {[1,2,3,4,5,6,7,8,9].map(n => {
                  const result = courseHole ? scoreVsPar(n, courseHole.par, shots) : 'par';
                  const accent = SCORE_COLORS[result] ?? '#6b7280';
                  const netDiff = n - (courseHole?.par ?? 4) - shots;
                  const diffLabel = netDiff === 0 ? 'PAR' : netDiff < 0 ? String(netDiff) : `+${netDiff}`;
                  const isSelected = selectedScore === n;
                  return (
                    <TouchableOpacity
                      key={n}
                      style={[s.scoreNumBtn, isSelected && { backgroundColor: `${accent}25`, borderColor: accent, borderWidth: 2 }]}
                      onPress={() => setSelectedScore(n)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.scoreNumText, isSelected && { color: '#ffffff' }]}>{n}</Text>
                      {isSelected && <Text style={[s.scoreDiffLabel, { color: accent }]}>{diffLabel}</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Fairway */}
              {courseHole && courseHole.par >= 4 && (
                <View style={s.statSection}>
                  <Text style={s.statSectionLabel}>FAIRWAY</Text>
                  <View style={s.statBtnRow}>
                    {([['left', '◀ Left'], ['centre', '● Centre'], ['right', 'Right ▶']] as const).map(([dir, lbl]) => (
                      <TouchableOpacity
                        key={dir}
                        style={[s.statBtn, selectedFairway === dir && (dir === 'centre' ? s.statBtnGreen : dir === 'left' ? s.statBtnRed : s.statBtnOrange)]}
                        onPress={() => setSelectedFairway(selectedFairway === dir ? null : dir)}
                        activeOpacity={0.8}
                      >
                        <Text style={[s.statBtnText, selectedFairway === dir && { color: '#ffffff' }]}>{lbl}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {/* Putts */}
              <View style={s.statSection}>
                <Text style={s.statSectionLabel}>PUTTS</Text>
                <View style={s.statBtnRow}>
                  {([1, 2, 3, 4] as const).map(n => (
                    <TouchableOpacity
                      key={n}
                      style={[s.statBtn, s.statBtnPutt, selectedPutts === n && s.statBtnGold]}
                      onPress={() => setSelectedPutts(selectedPutts === n ? null : n)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.statBtnText, selectedPutts === n && { color: '#ffffff' }]}>{n === 4 ? '3+' : n}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <TouchableOpacity
                style={[s.submitBtn, !selectedScore && { opacity: 0.35 }]}
                onPress={saveScore}
                disabled={!selectedScore}
                activeOpacity={0.85}
              >
                <Text style={s.submitBtnText}>{editingHole ? `Save Hole ${editingHole}` : `Save Hole ${nextHole}`}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={{ paddingVertical: 14, alignItems: 'center' }}>
                <Text style={{ fontFamily: FF, color: '#6b7280', fontSize: 14 }}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Side game modal ── */}
      <Modal visible={!!sideGameModal} transparent animationType="slide" onRequestClose={() => setSideGameModal(null)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={s.sheetHandle} />
            <Text style={s.sideGameModalTitle}>
              {sideGameModal?.type === 'Longest Drive' ? 'LONGEST DRIVE' : 'NEAREST THE PIN'}
            </Text>
            <Text style={s.sideGameModalSub}>Hole {sideGameModal?.hole} · {sideGameModal?.type === 'Longest Drive' ? 'Distance in yards' : 'Distance (e.g. 4ft 2in)'}</Text>
            <TextInput
              style={s.sideGameInput}
              value={sideGameResult}
              onChangeText={setSideGameResult}
              placeholder={sideGameModal?.type === 'Longest Drive' ? 'e.g. 285' : 'e.g. 4ft 2in'}
              placeholderTextColor="#4b5563"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={sideGameModal?.type === 'Longest Drive' ? 'numeric' : 'default'}
            />
            <TouchableOpacity style={s.submitBtn} onPress={saveSideGameResult} activeOpacity={0.85}>
              <Text style={s.submitBtnText}>Save Result</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ paddingVertical: 14, alignItems: 'center' }} onPress={() => setSideGameModal(null)}>
              <Text style={{ fontFamily: FF, color: '#6b7280', fontSize: 14 }}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Range finder ── */}
      <Modal visible={showRangeMap} transparent animationType="slide" onRequestClose={() => setShowRangeMap(false)}>
        <View style={s.popupOverlay}>
          <View style={s.popupSheet}>
            <View style={s.sheetHandle} />
            <View style={s.popupTitleRow}>
              <Ionicons name="scan-outline" size={16} color={GOLD} />
              <Text style={s.popupTitleText}>RANGE FINDER</Text>
              <TouchableOpacity onPress={() => setShowRangeMap(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-outline" size={22} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <View style={{ padding: 16 }}>
              <RangeMap courseName={match?.day?.course_name} holeNumber={nextHole} />
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Shot tracker ── */}
      <Modal visible={showShotLogger} transparent animationType="slide" onRequestClose={() => setShowShotLogger(false)}>
        <View style={s.popupOverlay}>
          <View style={[s.popupSheet, { height: '75%' }]}>
            <View style={s.sheetHandle} />
            <View style={s.popupTitleRow}>
              <Ionicons name="analytics-outline" size={16} color={GOLD} />
              <Text style={s.popupTitleText}>SHOT TRACKER</Text>
              <TouchableOpacity onPress={() => setShowShotLogger(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-outline" size={22} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1 }}>
              {matchId && <ShotLogger matchId={matchId} holeNumber={nextHole} />}
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Voice caddie ── */}
      <Modal visible={showCaddieModal} transparent animationType="slide" onRequestClose={() => setShowCaddieModal(false)}>
        <TouchableOpacity style={s.popupOverlay} activeOpacity={1} onPress={() => setShowCaddieModal(false)}>
          <View style={s.popupSheet} onStartShouldSetResponder={() => true}>
            <View style={s.sheetHandle} />
            <View style={[s.popupTitleRow, { marginBottom: 16 }]}>
              <Ionicons name="mic-outline" size={16} color={GOLD} />
              <Text style={s.popupTitleText}>VOICE CADDIE</Text>
              <TouchableOpacity onPress={() => setShowCaddieModal(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-outline" size={22} color="#6b7280" />
              </TouchableOpacity>
            </View>
            {courseHole && match && (
              <CaddieButton
                context={{
                  playerName,
                  holeNumber: nextHole,
                  par: courseHole.par,
                  strokeIndex: courseHole.stroke_index,
                  format: match.round_format,
                  holesCompleted: savedScores.length,
                  runningScore: isStableford
                    ? `${totalPts} pts`
                    : vsPar === 0 ? 'level par' : `${vsPar > 0 ? '+' : ''}${vsPar}`,
                }}
                onAction={async (result: VoiceCommandResult) => {
                  if (result.action?.type === 'log_shot' && result.action.club) {
                    const playerId = match.home_player_ids[0];
                    if (playerId) {
                      await supabase.from('shots').insert({
                        match_id: match.id,
                        player_id: playerId,
                        hole_number: nextHole,
                        club_short: result.action.club,
                        distance_yards: result.action.distance ?? null,
                        lat: gpsRef.current?.lat ?? null,
                        lng: gpsRef.current?.lng ?? null,
                      });
                      setShowCaddieModal(false);
                    }
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
          onDismiss={() => { setRecordsBroken([]); router.back(); }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#000000' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' },

  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 56, paddingHorizontal: 16, paddingBottom: 8 },
  headerSide:   { width: 40 },
  headerCenter: { flex: 1, alignItems: 'center', gap: 2 },
  headerLogo:   { width: 28, height: 28 },
  headerSub:    { fontFamily: FF, fontSize: 11, color: '#6b7280', letterSpacing: 0.5 },

  playerBlock: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#0a0a0a', borderBottomWidth: 1, borderBottomColor: '#111111' },
  playerNameText: { fontFamily: FFB, fontSize: 16, color: '#ffffff' },
  playerHcpText:  { fontFamily: FF, fontSize: 11, color: '#6b7280', marginTop: 2 },
  scoreDisplay:   { alignItems: 'center' },
  scoreDisplayVal:   { fontFamily: FF, fontSize: 26, letterSpacing: -0.5 },
  scoreDisplayLabel: { fontFamily: FF, fontSize: 8, color: '#6b7280', letterSpacing: 1.5, marginTop: 1 },

  holeStripWrap: { maxHeight: 72 },
  holeStrip:     { paddingHorizontal: 12, paddingVertical: 6, gap: 6, alignItems: 'center' },
  holeTile: { width: 42, height: 58, borderRadius: 10, backgroundColor: '#111111', borderWidth: 1, borderColor: '#1c1c1c', alignItems: 'center', justifyContent: 'center', gap: 2 },
  holeTileNum:   { fontFamily: FF, fontSize: 14, color: '#4b5563' },
  holeTilePar:   { fontFamily: FF, fontSize: 9, color: '#333' },
  holeTilePts:   { fontFamily: FFB, fontSize: 11, marginTop: 1 },
  halfLabels:    { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 12, paddingBottom: 4 },
  halfLabel:     { fontFamily: FF, fontSize: 8, color: '#2a2a2a', letterSpacing: 1.5 },

  scroll: { padding: 16, paddingBottom: 40 },

  holeCard: { alignItems: 'center', marginBottom: 12, paddingVertical: 20, backgroundColor: '#111111', borderRadius: 16, borderWidth: 1, borderColor: '#1c1c1c' },
  holeLabelSmall: { fontFamily: FF, fontSize: 9, color: '#6b7280', letterSpacing: 2 },
  holeBig:        { fontFamily: FF, fontSize: 64, color: '#ffffff', lineHeight: 72 },
  holeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4, justifyContent: 'center', paddingHorizontal: 12 },
  holeChip:     { flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#222' },
  holeChipGold: { backgroundColor: `${GOLD}0d`, borderColor: `${GOLD}30` },
  holeChipText: { fontFamily: FF, fontSize: 10, color: '#6b7280' },
  quickActions:   { flexDirection: 'row', alignItems: 'center', marginTop: 14, borderTopWidth: 1, borderTopColor: '#1a1a1a', width: '100%' },
  quickActionBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, gap: 3 },
  quickActionLbl: { fontFamily: FF, fontSize: 9, color: '#6b7280', letterSpacing: 1 },
  quickActionSep: { width: 1, height: 28, backgroundColor: '#1a1a1a' },

  sideGameBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: `${GOLD}0d`, borderRadius: 12, borderWidth: 1.5, borderColor: `${GOLD}40`, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 },
  sideGameBannerTitle: { fontFamily: FFB, fontSize: 13, color: GOLD, letterSpacing: 1 },
  sideGameBannerSub:   { fontFamily: FF, fontSize: 11, color: '#6b7280', marginTop: 2 },

  ctaBtn:     { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 },
  ctaBtnText: { fontFamily: FF, fontSize: 17, color: '#000000' },

  undoBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  undoBtnText: { fontFamily: FF, fontSize: 13, color: '#4b5563' },
  deleteLink:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 },
  deleteLinkText: { fontFamily: FF, fontSize: 12, color: '#4b5563' },

  completeCard:   { alignItems: 'center', paddingVertical: 32, gap: 8 },
  completeTitle:  { fontFamily: FF, fontSize: 10, color: '#6b7280', letterSpacing: 3, marginTop: 8 },
  completeScore:  { fontFamily: FF, fontSize: 60, letterSpacing: -1 },
  completeDetail: { fontFamily: FF, fontSize: 13, color: '#6b7280' },
  statGrid:     { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 20, marginBottom: 8 },
  statBox:      { alignItems: 'center', minWidth: 68, backgroundColor: '#111111', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: '#1c1c1c' },
  statVal:      { fontFamily: FFB, fontSize: 24 },
  statLbl:      { fontFamily: FF, fontSize: 9, color: '#6b7280', letterSpacing: 0.5, marginTop: 2 },
  bestWorstRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  bestWorstBox: { alignItems: 'center', flex: 1, backgroundColor: '#111111', borderRadius: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#1c1c1c' },
  bestWorstLbl: { fontFamily: FF, fontSize: 8, color: '#6b7280', letterSpacing: 1 },
  bestWorstVal: { fontFamily: FFB, fontSize: 14, marginTop: 2 },
  bestWorstSub: { fontFamily: FF, fontSize: 10, color: '#6b7280', marginTop: 1 },
  endRoundBtn:  { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: GOLD, borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14, marginTop: 8 },
  endRoundText: { fontFamily: FF, fontSize: 16, color: '#000000' },

  scorecardCard:    { backgroundColor: '#111111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden', marginTop: 8, marginBottom: 8, padding: 10 },
  scorecardTitle:   { fontFamily: FF, fontSize: 9, color: '#6b7280', letterSpacing: 2, marginBottom: 8 },
  scorecardRow:     { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  scorecardHoleLabel: { width: 36, fontFamily: FF, fontSize: 8, color: '#4b5563' },
  scorecardCell:    { flex: 1, fontFamily: FF, fontSize: 10, textAlign: 'center' },
  scorecardTot:     { width: 30, fontFamily: FFB, fontSize: 10, color: '#ffffff', textAlign: 'center' },
  scorecardScoreCell:  { flex: 1, height: 20, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  scorecardScoreText:  { fontFamily: FF, fontSize: 10, color: '#9ca3af' },

  savingOverlay: { position: 'absolute', bottom: 40, alignSelf: 'center', backgroundColor: '#111111', borderRadius: 20, padding: 10, borderWidth: 1, borderColor: '#1c1c1c' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#111111', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 48, borderTopWidth: 1, borderTopColor: '#1c1c1c' },
  sheetScroll: { alignItems: 'stretch', paddingBottom: 16 },
  sheetHandle:     { width: 40, height: 4, borderRadius: 2, backgroundColor: '#333', alignSelf: 'center', marginTop: 12, marginBottom: 16 },
  sheetPlayerRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  sheetPlayerName: { fontFamily: FFB, fontSize: 16, color: '#ffffff' },
  sheetHoleInfo:   { fontFamily: FF, fontSize: 11, color: '#6b7280', marginTop: 2 },
  sheetPts:        { fontFamily: FFB, fontSize: 22 },
  sheetShotBadge:  { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: `${GOLD}0d`, borderWidth: 1, borderColor: `${GOLD}30`, marginBottom: 12 },
  sheetShotBadgeText: { fontFamily: FF, fontSize: 12, color: GOLD },

  scoreGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 12 },
  scoreNumBtn: { width: '30%', flexGrow: 1, height: 64, borderRadius: 12, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#222', alignItems: 'center', justifyContent: 'center' },
  scoreNumText:   { fontFamily: FF, fontSize: 22, color: '#6b7280' },
  scoreDiffLabel: { fontFamily: FF, fontSize: 9, letterSpacing: 0.5, marginTop: 2 },

  statSection:      { marginTop: 12 },
  statSectionLabel: { fontFamily: FF, fontSize: 9, color: '#6b7280', letterSpacing: 1.5, marginBottom: 8, textAlign: 'center' },
  statBtnRow:   { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  statBtn:      { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#222', minWidth: 70, alignItems: 'center' },
  statBtnPutt:  { minWidth: 60 },
  statBtnGreen: { backgroundColor: `${GREEN}20`, borderColor: GREEN },
  statBtnRed:   { backgroundColor: `${RED}20`, borderColor: RED },
  statBtnOrange:{ backgroundColor: `${ORANGE}20`, borderColor: ORANGE },
  statBtnGold:  { backgroundColor: `${GOLD}15`, borderColor: GOLD },
  statBtnText:  { fontFamily: FF, fontSize: 13, color: '#9ca3af' },

  submitBtn:    { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  submitBtnText:{ fontFamily: FF, fontSize: 16, color: '#000000' },

  sideGameModalTitle: { fontFamily: FFB, fontSize: 16, color: GOLD, letterSpacing: 1.5, marginBottom: 6, textAlign: 'center' },
  sideGameModalSub:   { fontFamily: FF, fontSize: 12, color: '#6b7280', marginBottom: 20, textAlign: 'center' },
  sideGameInput: { backgroundColor: '#1a1a1a', borderRadius: 12, borderWidth: 1, borderColor: '#222', paddingHorizontal: 16, paddingVertical: 14, fontFamily: FF, fontSize: 18, color: '#ffffff', textAlign: 'center', marginBottom: 16 },

  popupOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  popupSheet:   { backgroundColor: '#111111', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderTopColor: '#1c1c1c', overflow: 'hidden', paddingBottom: 32 },
  popupTitleRow:{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  popupTitleText: { flex: 1, fontFamily: FF, fontSize: 11, color: '#ffffff', letterSpacing: 2 },
});
