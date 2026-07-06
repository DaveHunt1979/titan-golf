import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, Image, ScrollView, TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../../src/lib/theme';
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
        if (m.day) {
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

  const courseHole = courseHoles.find(h => h.hole_number === activeHole);
  const shots = courseHole ? calcStrokesReceived(courseHcp, courseHole.stroke_index) : 0;
  const holeYardage = courseHole
    ? ((teeColor && courseHole.tee_yardages?.[teeColor]) || courseHole.yardage || null)
    : null;

  // Running totals
  const totalGross = savedScores.reduce((s, h) => s + h.gross, 0);
  const totalPts   = savedScores.reduce((s, h) => s + h.pts, 0);
  const totalNet   = savedScores.reduce((s, h) => s + h.net, 0);
  const parPlayed  = savedScores.reduce((s, h) => {
    const ch = courseHoles.find(c => c.hole_number === h.hole_number);
    return s + (ch?.par ?? 0);
  }, 0);
  const vsPar = totalGross - parPlayed;

  const avatar = match ? resolveAvatar(match.home_player_ids[0], avatarUrl, 'normal') : null;

  // Keep refs current each render so Watch handlers never see stale closures
  matchRef.current        = match;
  courseHolesRef.current  = courseHoles;
  courseHcpRef.current    = courseHcp;
  savedScoresRef.current  = savedScores;
  nextHoleRef.current     = nextHole;
  isStablefordRef.current = isStableford;

  // Send current hole to Watch whenever hole/handicap/course data changes
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

  // Listen for Watch score entries — registered once, reads state via refs
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

  // Resend match data when Watch app opens and requests state
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

  // Clear Watch solo match when leaving screen
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

  // Auto intro on hole 1 when round starts
  useEffect(() => {
    if (!match || !playerName || loading || introPlayedRef.current) return;
    if (nextHole === 1) {
      introPlayedRef.current = true;
      speakIntro([playerName.split(' ')[0]]);
    }
  }, [match, playerName, loading, nextHole]);

  // Auto back 9 summary on hole 10
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
      speakBack9(playerName.split(' ')[0], match.round_format, frontPts, frontGross, frontGross - frontParSum);
    }
  }, [match, playerName, loading, nextHole, savedScores, courseHoles]);

  async function onCoachMe() {
    if (coachLoading) return;
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

    // Mark hole as done in holes_string ('d' = done)
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

    await supabase.from('match_holes').delete()
      .eq('match_id', matchId).eq('hole_number', lastDone);

    const chars = [...holeChars];
    chars[lastDone - 1] = '.';
    const newHolesStr = chars.join('');

    await supabase.from('matches').update({
      holes_string: newHolesStr,
      status: 'in_progress',
    }).eq('id', match.id);

    setSavedScores(prev => prev.filter(h => h.hole_number !== lastDone));
    setMatch({ ...match, holes_string: newHolesStr, status: 'in_progress' });
    setSaving(false);
  }

  if (loading) return (
    <View style={styles.centered}><ActivityIndicator color={colors.gold} size="large" /></View>
  );
  if (!match) return (
    <View style={styles.centered}><Text style={{ color: colors.textSecondary }}>Round not found.</Text></View>
  );

  const formatLabel = isStableford ? 'Stableford' : 'Medal';
  const scoreDisplay = isStableford
    ? `${totalPts} pts`
    : totalGross === 0 ? 'E'
    : vsPar > 0 ? `+${vsPar}` : `${vsPar}`;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerSub}>{match.day?.course_name} · {formatLabel}</Text>
        </View>
        {!isComplete && (
          <TouchableOpacity onPress={deleteMatch} style={styles.headerDeleteBtn} activeOpacity={0.7}>
            <Text style={styles.headerDeleteTxt}>Delete</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Player + running score */}
        <View style={styles.playerCard}>
          <View style={styles.playerRow}>
            {avatar
              ? <Image source={avatar} style={styles.playerAvatar} />
              : <View style={[styles.playerAvatar, styles.avatarFallback]}><Text style={styles.avatarInitial}>{playerName[0]}</Text></View>
            }
            <View style={styles.playerInfo}>
              <Text style={styles.playerNameText}>{playerName}</Text>
              <Text style={styles.playerHcp}>HCP {playerHcp} · Course HCP {courseHcp}</Text>
            </View>
            <View style={styles.scoreBox}>
              <Text style={styles.scoreBoxVal}>{scoreDisplay}</Text>
              <Text style={styles.scoreBoxLabel}>{isStableford ? 'POINTS' : 'VS PAR'}</Text>
            </View>
          </View>

          {/* Hole progress — tap a played hole to edit it */}
          <View style={styles.dotsRow}>
            {Array.from({ length: 18 }, (_, i) => {
              const c = holeChars[i] ?? '.';
              const done = c === 'd';
              const active = i + 1 === activeHole;
              if (done) {
                return (
                  <TouchableOpacity
                    key={i}
                    style={[styles.dot, styles.dotDone, active && styles.dotActive]}
                    onPress={() => {
                      const h = i + 1;
                      const existing = savedScores.find(s => s.hole_number === h);
                      setSelectedScore(existing?.gross ?? null);
                      setSelectedFairway(null);
                      setSelectedPutts(null);
                      setEditingHole(h);
                      setModalVisible(true);
                    }}
                    activeOpacity={0.7}
                  />
                );
              }
              return (
                <View key={i} style={[styles.dot, active && styles.dotActive]} />
              );
            })}
          </View>
          <View style={styles.dotsNumRow}>
            {Array.from({ length: 18 }, (_, i) => (
              <Text key={i} style={[styles.dotNum, i + 1 === nextHole && !isComplete && styles.dotNumActive]}>{i + 1}</Text>
            ))}
          </View>
        </View>

        {!isComplete ? (
          <>
            {/* Current hole card */}
            <View style={styles.holeCard}>
              <Text style={styles.holeLabelSmall}>HOLE</Text>
              <Text style={styles.holeBig}>{nextHole}</Text>
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
                <View style={styles.holeIconSep} />
                <TouchableOpacity style={styles.holeIconBtn} onPress={() => setShowCaddieModal(true)} activeOpacity={0.7}>
                  <Text style={styles.holeIconEmoji}>🏌️</Text>
                  <Text style={styles.holeIconLbl}>CADDIE</Text>
                </TouchableOpacity>
              </View>
              {courseHole && (
                <View style={styles.holeMetaRow}>
                  <View style={styles.holeMetaItem}>
                    <Text style={styles.holeMetaLabel}>PAR</Text>
                    <Text style={styles.holeMetaValue}>{courseHole.par}</Text>
                  </View>
                  <View style={styles.holeMetaSep} />
                  <View style={styles.holeMetaItem}>
                    <Text style={styles.holeMetaLabel}>S.I.</Text>
                    <Text style={styles.holeMetaValue}>{courseHole.stroke_index}</Text>
                  </View>
                  {holeYardage != null && (
                    <>
                      <View style={styles.holeMetaSep} />
                      <View style={styles.holeMetaItem}>
                        <Text style={styles.holeMetaLabel}>YRD</Text>
                        <Text style={styles.holeMetaValue}>{holeYardage}</Text>
                      </View>
                    </>
                  )}
                  {shots > 0 && (
                    <>
                      <View style={styles.holeMetaSep} />
                      <View style={styles.holeMetaItem}>
                        <Text style={styles.holeMetaLabel}>SHOT{shots > 1 ? 'S' : ''}</Text>
                        <Text style={[styles.holeMetaValue, { color: colors.gold }]}>{shots}</Text>
                      </View>
                    </>
                  )}
                </View>
              )}
              <TouchableOpacity
                style={styles.coachBtn}
                onPress={onCoachMe}
                disabled={coachLoading}
                activeOpacity={0.7}
              >
                <Text style={styles.coachBtnText}>
                  {coachLoading ? '🎙 Asking...' : '🎙 Coach Me'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Voice caddie modal */}
            <Modal visible={showCaddieModal} transparent animationType="slide" onRequestClose={() => setShowCaddieModal(false)}>
              <TouchableOpacity style={styles.popupOverlay} activeOpacity={1} onPress={() => setShowCaddieModal(false)}>
                <View style={styles.popupSheet} onStartShouldSetResponder={() => true}>
                  <View style={styles.popupHeader} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md }}>
                    <Text style={styles.popupTitle}>🏌️ Voice Caddie</Text>
                    <TouchableOpacity onPress={() => setShowCaddieModal(false)} style={styles.popupClose} activeOpacity={0.7}>
                      <Text style={{ fontSize: fonts.lg, color: colors.textMuted }}>✕</Text>
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

            <TouchableOpacity
              style={[styles.scoreBtn, editingHole ? { backgroundColor: colors.gold } : null]}
              onPress={() => {
                setSelectedScore(null);
                setSelectedFairway(null);
                setSelectedPutts(null);
                setModalVisible(true);
              }}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Text style={styles.scoreBtnText}>
                {editingHole ? `Save Edit — Hole ${editingHole}` : `Score Hole ${nextHole}`}
              </Text>
            </TouchableOpacity>

            {editingHole ? (
              <TouchableOpacity style={styles.undoBtn} onPress={() => setEditingHole(null)} disabled={saving}>
                <Text style={styles.undoText}>✕ Cancel Edit</Text>
              </TouchableOpacity>
            ) : nextHole > 1 ? (
              <TouchableOpacity style={styles.undoBtn} onPress={undoHole} disabled={saving}>
                <Text style={styles.undoText}>Undo Hole {nextHole - 1}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.deleteBtn} onPress={deleteMatch}>
              <Text style={styles.deleteBtnText}>Delete Round</Text>
            </TouchableOpacity>
          </>
        ) : (() => {
          const holesWithPar = savedScores.map(s => {
            const ch = courseHoles.find(c => c.hole_number === s.hole_number);
            return { ...s, par: ch?.par ?? 0, vsPar: s.gross - (ch?.par ?? 0) };
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
            <View style={styles.completeCard}>
              <Text style={styles.completeStar}>★</Text>
              <Text style={styles.completeTitle}>ROUND COMPLETE</Text>
              <Text style={styles.completeScore}>{scoreDisplay}</Text>
              <Text style={styles.completeDetail}>
                {isStableford ? `${totalGross} gross · ${totalPts} pts` : `${totalGross} gross`}
              </Text>

              <View style={styles.statGrid}>
                {eagles  > 0 && <View style={styles.statBox}><Text style={[styles.statVal, { color: colors.gold }]}>{eagles}</Text><Text style={styles.statLbl}>Eagle{eagles !== 1 ? 's' : ''}</Text></View>}
                {birdies > 0 && <View style={styles.statBox}><Text style={[styles.statVal, { color: '#22c55e' }]}>{birdies}</Text><Text style={styles.statLbl}>Birdie{birdies !== 1 ? 's' : ''}</Text></View>}
                {pars    > 0 && <View style={styles.statBox}><Text style={[styles.statVal, { color: colors.textSecondary }]}>{pars}</Text><Text style={styles.statLbl}>Par{pars !== 1 ? 's' : ''}</Text></View>}
                {bogeys  > 0 && <View style={styles.statBox}><Text style={[styles.statVal, { color: '#f97316' }]}>{bogeys}</Text><Text style={styles.statLbl}>Bogey{bogeys !== 1 ? 's' : ''}</Text></View>}
                {doubles > 0 && <View style={styles.statBox}><Text style={[styles.statVal, { color: colors.red }]}>{doubles}</Text><Text style={styles.statLbl}>Double{doubles !== 1 ? 's' : ''}+</Text></View>}
              </View>

              {bestHole && worstHole && bestHole.hole_number !== worstHole.hole_number && (
                <View style={styles.bestWorstRow}>
                  <View style={styles.bestWorstBox}>
                    <Text style={styles.bestWorstLbl}>BEST</Text>
                    <Text style={[styles.bestWorstVal, { color: '#22c55e' }]}>Hole {bestHole.hole_number}</Text>
                    <Text style={styles.bestWorstSub}>{vsParLabel(bestHole.vsPar)}</Text>
                  </View>
                  <View style={styles.bestWorstBox}>
                    <Text style={styles.bestWorstLbl}>WORST</Text>
                    <Text style={[styles.bestWorstVal, { color: colors.red }]}>Hole {worstHole.hole_number}</Text>
                    <Text style={styles.bestWorstSub}>{vsParLabel(worstHole.vsPar)}</Text>
                  </View>
                </View>
              )}

              <TouchableOpacity
                style={styles.endRoundBtn}
                onPress={async () => {
                  if (playerName) await speakOutro(playerName.split(' ')[0], finalScore);
                  router.back();
                }}
              >
                <Text style={styles.endRoundText}>🎙 End Round</Text>
              </TouchableOpacity>

              {nextHole > 1 && (
                <TouchableOpacity style={[styles.undoBtn, { marginTop: spacing.md }]} onPress={undoHole} disabled={saving}>
                  <Text style={styles.undoText}>Undo Last Hole</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.deleteBtn, { marginTop: spacing.sm }]} onPress={deleteMatch}>
                <Text style={styles.deleteBtnText}>Delete Round</Text>
              </TouchableOpacity>
            </View>
          );
        })()}

        {/* Mini scorecard */}
        {savedScores.length > 0 && (
          <View style={styles.miniCard}>
            <Text style={styles.miniTitle}>SCORECARD</Text>
            {[savedScores.filter(h => h.hole_number <= 9), savedScores.filter(h => h.hole_number >= 10)].map((half, hi) => {
              if (half.length === 0) return null;
              const halfHoles = courseHoles.filter(h => hi === 0 ? h.hole_number <= 9 : h.hole_number >= 10);
              return (
                <View key={hi} style={{ marginBottom: 4 }}>
                  <View style={styles.miniRow}>
                    <Text style={styles.miniLabel}>HOLE</Text>
                    {halfHoles.map(h => <Text key={h.hole_number} style={styles.miniCell}>{h.hole_number}</Text>)}
                    <Text style={styles.miniTot}>{hi === 0 ? 'OUT' : 'IN'}</Text>
                  </View>
                  <View style={styles.miniRow}>
                    <Text style={styles.miniLabel}>PAR</Text>
                    {halfHoles.map(h => <Text key={h.hole_number} style={styles.miniCell}>{h.par}</Text>)}
                    <Text style={styles.miniTot}>{halfHoles.reduce((s, h) => s + h.par, 0)}</Text>
                  </View>
                  <View style={styles.miniRow}>
                    <Text style={styles.miniLabel}>GROSS</Text>
                    {halfHoles.map(h => {
                      const sc = half.find(s => s.hole_number === h.hole_number);
                      const diff = sc ? sc.gross - h.par : null;
                      return (
                        <View key={h.hole_number} style={[
                          styles.miniScoreCell,
                          diff !== null && diff < 0 && styles.miniBirdie,
                          diff !== null && diff === 0 && styles.miniParCell,
                          diff !== null && diff > 0 && styles.miniBogey,
                        ]}>
                          <Text style={styles.miniScoreText}>{sc?.gross ?? '·'}</Text>
                        </View>
                      );
                    })}
                    <Text style={styles.miniTot}>{half.reduce((s, h) => s + h.gross, 0) || '·'}</Text>
                  </View>
                  {isStableford && (
                    <View style={styles.miniRow}>
                      <Text style={styles.miniLabel}>PTS</Text>
                      {halfHoles.map(h => {
                        const sc = half.find(s => s.hole_number === h.hole_number);
                        return <Text key={h.hole_number} style={[styles.miniCell, { color: colors.gold }]}>{sc?.pts ?? '·'}</Text>;
                      })}
                      <Text style={[styles.miniTot, { color: colors.gold }]}>{half.reduce((s, h) => s + h.pts, 0) || '·'}</Text>
                    </View>
                  )}
                  {hi === 0 && <View style={styles.miniDivider} />}
                </View>
              );
            })}
          </View>
        )}

      </ScrollView>

      {saving && (
        <View style={styles.savingIndicator}>
          <ActivityIndicator color={colors.gold} size="small" />
        </View>
      )}

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
            <TouchableOpacity style={styles.sideGameSaveBtn} onPress={saveSideGameResult} activeOpacity={0.85}>
              <Text style={styles.sideGameSaveBtnText}>Save Result</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sideGameSkipBtn} onPress={() => setSideGameModal(null)} activeOpacity={0.7}>
              <Text style={styles.sideGameSkipText}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Score entry modal */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: '92%', paddingBottom: 0 }]}>
            <ScrollView
              style={{ width: '100%' }}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Player avatar */}
              <View style={styles.modalAvatarWrap}>
                {avatar ? (
                  <Image source={typeof avatar === 'string' ? { uri: avatar } : avatar} style={styles.modalAvatar} />
                ) : (
                  <View style={[styles.modalAvatar, styles.modalAvatarFallback]}>
                    <Text style={styles.modalAvatarInitial}>{playerName[0] ?? '?'}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.modalPlayerName}>{playerName}</Text>
              <Text style={styles.modalTitle}>{editingHole ? `Edit Hole ${editingHole}` : `Hole ${nextHole}`}</Text>
              {courseHole && (
                <Text style={styles.modalSub}>Par {courseHole.par} · SI {courseHole.stroke_index}</Text>
              )}
              {shots > 0 && (
                <View style={styles.shotBadge}>
                  <Text style={styles.shotBadgeText}>★ Gets {shots} shot{shots > 1 ? 's' : ''} on this hole</Text>
                </View>
              )}
              {selectedScore !== null && courseHole && isStableford && (
                <View style={styles.ptsBadge}>
                  <Text style={styles.ptsBadgeText}>
                    {calcStablefordPoints(selectedScore, courseHole.par, shots)} pts
                  </Text>
                </View>
              )}
              <View style={styles.scoreGrid}>
                {[1, 2, 3, 4, 5].map(n => (
                  <TouchableOpacity
                    key={n}
                    style={[styles.scoreNumBtn, selectedScore === n && styles.scoreNumBtnOn]}
                    onPress={() => setSelectedScore(n)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.scoreNumText, selectedScore === n && styles.scoreNumTextOn]}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.scoreGrid}>
                {[6, 7, 8, 9, 10].map(n => (
                  <TouchableOpacity
                    key={n}
                    style={[styles.scoreNumBtn, selectedScore === n && styles.scoreNumBtnOn]}
                    onPress={() => setSelectedScore(n)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.scoreNumText, selectedScore === n && styles.scoreNumTextOn]}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </View>

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

              <TouchableOpacity
                style={[styles.submitBtn, !selectedScore && styles.submitBtnOff]}
                onPress={saveScore}
                disabled={!selectedScore}
                activeOpacity={0.85}
              >
                <Text style={styles.submitBtnText}>{editingHole ? `Save Edit — Hole ${editingHole}` : `Save Hole ${nextHole}`}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={{ marginTop: spacing.sm }}>
                <Text style={{ color: colors.textMuted, fontSize: fonts.sm, textAlign: 'center' }}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
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
              <RangeMap courseName={match?.day?.course_name} holeNumber={nextHole} />
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
              {matchId && <ShotLogger matchId={matchId} holeNumber={nextHole} />}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },

  header: {
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
  },
  headerLeft: { flex: 1 },
  headerDeleteBtn: { paddingTop: 4, paddingLeft: spacing.md },
  headerDeleteTxt: { fontSize: fonts.sm, fontWeight: '600', color: colors.red },
  backBtn: { marginBottom: spacing.xs },
  backText: { fontSize: fonts.md, color: colors.gold, fontWeight: '600' },
  headerSub: { fontSize: fonts.xs, color: colors.textMuted, letterSpacing: 1 },

  holeIconRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs, marginBottom: spacing.xs },
  holeIconBtn: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.xs },
  holeIconEmoji: { fontSize: 22 },
  holeIconLbl: { fontSize: 8, fontWeight: '800', color: colors.textMuted, letterSpacing: 1, marginTop: 2 },
  holeIconSep: { width: 1, height: 28, backgroundColor: colors.border },

  popupOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  popupSheet: {
    backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    borderTopWidth: 1, borderTopColor: colors.border, overflow: 'hidden',
  },
  popupHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  popupTitle: { fontSize: fonts.sm, fontWeight: '800', color: colors.white, letterSpacing: 1 },
  popupClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  popupCloseTxt: { fontSize: fonts.md, fontWeight: '700', color: colors.textSecondary },

  scroll: { padding: spacing.md, paddingBottom: 100 },

  playerCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  playerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  playerAvatar: { width: 48, height: 48, borderRadius: 24, overflow: 'hidden' },
  avatarFallback: { backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: fonts.xl, fontWeight: '800', color: colors.white },
  playerInfo: { flex: 1, marginLeft: spacing.md },
  playerNameText: { fontSize: fonts.md, fontWeight: '800', color: colors.white },
  playerHcp: { fontSize: fonts.xs, color: colors.textMuted, marginTop: 2 },
  scoreBox: { alignItems: 'center' },
  scoreBoxVal: { fontSize: fonts.xxl, fontWeight: '900', color: colors.gold },
  scoreBoxLabel: { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1 },

  dotsRow: { flexDirection: 'row', gap: 3 },
  dot: { flex: 1, height: 8, borderRadius: 2, backgroundColor: colors.cardAlt },
  dotDone: { backgroundColor: colors.gold },
  dotActive: { borderWidth: 1.5, borderColor: colors.gold, backgroundColor: 'transparent' },
  dotsNumRow: { flexDirection: 'row', gap: 3, marginTop: 2 },
  dotNum: { flex: 1, fontSize: 7, color: colors.textMuted, textAlign: 'center' },
  dotNumActive: { color: colors.gold, fontWeight: '700' },

  holeCard: {
    alignItems: 'center', marginBottom: spacing.md,
    paddingVertical: spacing.lg, backgroundColor: colors.card,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
  },
  holeLabelSmall: { fontSize: fonts.xs, color: colors.textMuted, letterSpacing: 2, fontWeight: '700' },
  holeBig: { fontSize: 80, fontWeight: '900', color: colors.white, lineHeight: 88 },
  holeMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  holeMetaItem: { alignItems: 'center', paddingHorizontal: spacing.lg },
  holeMetaLabel: { fontSize: fonts.xs, color: colors.textMuted, letterSpacing: 1, fontWeight: '600' },
  holeMetaValue: { fontSize: fonts.xl, fontWeight: '800', color: colors.textSecondary, marginTop: 2 },
  holeMetaSep: { width: 1, height: 32, backgroundColor: colors.border },

  scoreBtn: {
    backgroundColor: colors.gold, borderRadius: radius.lg,
    paddingVertical: spacing.lg, alignItems: 'center', marginBottom: spacing.sm,
  },
  scoreBtnText: { fontSize: fonts.lg, fontWeight: '800', color: colors.bg, letterSpacing: 1 },
  undoBtn: { alignItems: 'center', paddingVertical: spacing.sm },
  undoText: { fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600' },

  completeCard: { alignItems: 'center', paddingVertical: spacing.xxl },
  completeStar: { fontSize: 48, color: colors.gold, marginBottom: spacing.md },
  completeTitle: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 3, marginBottom: spacing.sm },
  completeScore: { fontSize: 64, fontWeight: '900', color: colors.gold, letterSpacing: 2 },
  completeDetail: { fontSize: fonts.sm, color: colors.textSecondary, marginTop: spacing.xs },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.xl, marginBottom: spacing.md },
  statBox: { alignItems: 'center', minWidth: 64, backgroundColor: colors.card, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border },
  statVal: { fontSize: fonts.xl, fontWeight: '900' },
  statLbl: { fontSize: 9, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.5, marginTop: 2 },

  bestWorstRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  bestWorstBox: { alignItems: 'center', flex: 1, backgroundColor: colors.card, borderRadius: radius.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border },
  bestWorstLbl: { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1 },
  bestWorstVal: { fontSize: fonts.md, fontWeight: '900', marginTop: 2 },
  bestWorstSub: { fontSize: 9, color: colors.textSecondary, marginTop: 1 },

  endRoundBtn: { marginTop: spacing.lg, backgroundColor: colors.gold, borderRadius: radius.full, paddingHorizontal: spacing.xxl, paddingVertical: spacing.md },
  endRoundText: { fontSize: fonts.sm, fontWeight: '900', color: '#000', letterSpacing: 1 },

  deleteBtn: { alignItems: 'center', paddingVertical: spacing.sm, marginTop: spacing.sm },
  deleteBtnText: { fontSize: fonts.sm, fontWeight: '600', color: colors.red, letterSpacing: 0.5 },
  savingIndicator: {
    position: 'absolute', bottom: 40, alignSelf: 'center',
    backgroundColor: colors.card, borderRadius: radius.full,
    padding: spacing.sm + 4, borderWidth: 1, borderColor: colors.border,
  },

  // Mini scorecard
  miniCard: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm, marginTop: spacing.md,
  },
  miniTitle: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.sm },
  miniRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  miniLabel: { width: 36, fontSize: 8, fontWeight: '700', color: colors.textMuted },
  miniCell: { flex: 1, fontSize: 9, fontWeight: '600', color: colors.textSecondary, textAlign: 'center' },
  miniTot: { width: 28, fontSize: 9, fontWeight: '800', color: colors.white, textAlign: 'center' },
  miniScoreCell: { flex: 1, height: 20, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  miniScoreText: { fontSize: 9, fontWeight: '700', color: colors.textSecondary },
  miniBirdie: { backgroundColor: 'rgba(74,222,128,0.25)', borderWidth: 1, borderColor: colors.green },
  miniParCell: { backgroundColor: colors.cardAlt },
  miniBogey: { backgroundColor: 'rgba(248,113,113,0.15)' },
  miniDivider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingTop: spacing.lg, paddingBottom: 48, paddingHorizontal: spacing.lg,
    alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border,
  },
  modalAvatarWrap: { borderRadius: 44, borderWidth: 3, borderColor: colors.gold, overflow: 'hidden', marginBottom: spacing.sm },
  modalAvatar: { width: 80, height: 80 },
  modalAvatarFallback: { backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  modalAvatarInitial: { fontSize: 32, fontWeight: '800', color: colors.white },
  modalPlayerName: { fontSize: fonts.xl, fontWeight: '800', color: colors.white, marginBottom: spacing.xs },
  shotBadge: { backgroundColor: 'rgba(212,175,55,0.15)', borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.goldBorder, marginBottom: spacing.sm },
  shotBadgeText: { fontSize: fonts.xs, color: colors.gold, fontWeight: '700', letterSpacing: 0.5 },
  modalTitle: { fontSize: fonts.md, fontWeight: '700', color: colors.textMuted, marginBottom: 2, letterSpacing: 1 },
  modalSub: { fontSize: fonts.xs, color: colors.textMuted, marginBottom: spacing.sm },
  ptsBadge: {
    backgroundColor: 'rgba(212,175,55,0.15)', borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderWidth: 1, borderColor: colors.goldBorder, marginBottom: spacing.md,
  },
  ptsBadgeText: { fontSize: fonts.sm, color: colors.gold, fontWeight: '700' },
  scoreGrid: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, width: '100%' },
  scoreNumBtn: {
    flex: 1, height: 52, borderRadius: radius.md,
    backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  scoreNumBtnOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  scoreNumText: { fontSize: fonts.lg, fontWeight: '700', color: colors.textSecondary },
  scoreNumTextOn: { color: colors.bg },
  submitBtn: {
    marginTop: spacing.lg, width: '100%', backgroundColor: colors.gold,
    borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center',
  },
  submitBtnOff: { opacity: 0.35 },
  submitBtnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg, letterSpacing: 1 },

  coachBtn: { marginTop: spacing.sm, alignSelf: 'center', backgroundColor: colors.cardAlt, borderRadius: radius.full, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs + 2, borderWidth: 1, borderColor: colors.border },
  coachBtnText: { fontSize: fonts.xs, color: colors.textSecondary, fontWeight: '700', letterSpacing: 0.3 },

  sideGameBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.goldDim, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.gold,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    marginBottom: spacing.sm,
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
  sideGameSaveBtn: {
    width: '100%', backgroundColor: colors.gold, borderRadius: radius.lg,
    paddingVertical: spacing.md, alignItems: 'center', marginBottom: spacing.sm,
  },
  sideGameSaveBtnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg, letterSpacing: 1 },
  sideGameSkipBtn: { paddingVertical: spacing.sm, alignItems: 'center' },
  sideGameSkipText: { fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600' },

  modalScrollContent: { alignItems: 'center', width: '100%', paddingBottom: 48 },
  statSection: { width: '100%', marginTop: spacing.md },
  statSectionLabel: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.sm, textAlign: 'center' },
  statBtnRow: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' },
  statBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border, minWidth: 70, alignItems: 'center' },
  statBtnPutt: { minWidth: 60 },
  statBtnGreen: { backgroundColor: 'rgba(74,222,128,0.2)', borderColor: colors.green },
  statBtnRed: { backgroundColor: 'rgba(248,113,113,0.2)', borderColor: colors.red },
  statBtnGold: { backgroundColor: colors.goldDim, borderColor: colors.gold },
  statBtnText: { fontSize: fonts.sm, fontWeight: '700', color: colors.textSecondary },
  statBtnTextSelected: { color: colors.white },
});
