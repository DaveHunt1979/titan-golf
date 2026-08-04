import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator, Image, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../../src/lib/supabase';
import { calcStrokesReceived, calcStablefordPoints, calcCourseHandicap } from '../../../../src/lib/scoring';
import { speakPressure } from '../../../../src/lib/caddie';

const { width: W } = Dimensions.get('window');
const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const RED    = '#f87171';
const PURPLE = '#a78bfa';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';

type HoleInfo = { hole_number: number; par: number; stroke_index: number; yardage?: number };
type SavedScore = { hole_number: number; gross: number; pts: number };

export default function SwindleScore() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const router = useRouter();
  const [game,        setGame]        = useState<any>(null);
  const [courseHoles, setCourseHoles] = useState<HoleInfo[]>([]);
  const [saved,       setSaved]       = useState<SavedScore[]>([]);
  const [myId,        setMyId]        = useState<string | null>(null);
  const [hcpIndex,    setHcpIndex]    = useState(0);
  const [slopeRating, setSlopeRating] = useState(113);
  const [courseRating,setCourseRating]= useState<number | null>(null);
  const [hcpAllowance,setHcpAllowance]= useState(100);
  const [selected,    setSelected]    = useState<number | null>(null);
  const [saving,      setSaving]      = useState(false);
  const [loading,     setLoading]     = useState(true);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  useEffect(() => { init(); }, [gameId]);

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" />
      <ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  const isStroke   = (game?.format ?? 'stableford') === 'stroke';
  const nextHole   = (() => { for (let h = 1; h <= 18; h++) { if (!saved.find(s => s.hole_number === h)) return h; } return 19; })();
  const isComplete = nextHole > 18;
  const courseHole = courseHoles.find(h => h.hole_number === nextHole);
  const coursePar  = courseHoles.length > 0 ? courseHoles.reduce((s, h) => s + h.par, 0) : 72;
  const courseHcp  = calcCourseHandicap(hcpIndex, slopeRating, courseRating ?? coursePar, coursePar);
  const playingHcp = Math.round(courseHcp * (hcpAllowance / 100));
  const shots      = courseHole ? calcStrokesReceived(playingHcp, courseHole.stroke_index) : 0;
  const totalPts   = saved.reduce((s, h) => s + h.pts, 0);
  const totalGross = saved.reduce((s, h) => s + h.gross, 0);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: p } = await supabase.from('players').select('id,handicap_index').eq('auth_uid', user.id).maybeSingle();
    if (!p) return;
    setMyId(p.id);
    setHcpIndex(p.handicap_index ?? 0);

    const { data: g } = await supabase.from('swindle_games').select('*').eq('id', gameId).single();
    if (!g) return;
    setGame(g);
    if (g.slope_rating)         setSlopeRating(g.slope_rating);
    if (g.course_rating != null) setCourseRating(g.course_rating);
    if (g.hcp_allowance != null) setHcpAllowance(g.hcp_allowance);

    if (g.course_name) {
      const { data: holes } = await supabase
        .from('course_holes')
        .select('hole_number,par,stroke_index,yardage')
        .eq('course_name', g.course_name)
        .order('hole_number');
      if (holes) setCourseHoles(holes);
    }

    const { data: scores } = await supabase
      .from('swindle_scores')
      .select('hole_number, gross_score, stableford_pts')
      .eq('game_id', gameId)
      .eq('player_id', p.id);
    if (scores) {
      setSaved(scores.map((s: any) => ({ hole_number: s.hole_number, gross: s.gross_score ?? 0, pts: s.stableford_pts ?? 0 })));
    }
    setLoading(false);
  }

  async function saveScore() {
    if (selected === null || !myId || !game || !courseHole) return;
    setSaving(true);
    const gross = selected;
    const pts   = calcStablefordPoints(gross, courseHole.par, shots);

    await supabase.from('swindle_scores').upsert({
      game_id: gameId, player_id: myId, hole_number: nextHole,
      gross_score: gross, stableford_pts: pts,
    }, { onConflict: 'game_id,player_id,hole_number' });

    const newSaved = [...saved.filter(s => s.hole_number !== nextHole), { hole_number: nextHole, gross, pts }];
    setSaved(newSaved);
    setSelected(null);
    setSaving(false);

    // Update game status to in_progress
    if (game.status === 'open') {
      await supabase.from('swindle_games').update({ status: 'in_progress' }).eq('id', gameId);
    }

    // Live Pressure at key holes
    if ([6, 9, 12, 15, 16, 17, 18].includes(nextHole)) {
      const { data: allScores } = await supabase
        .from('swindle_scores').select('player_id, stableford_pts').eq('game_id', gameId);
      const { data: entries } = await supabase
        .from('swindle_entries').select('player_id, players(display_name)').eq('game_id', gameId);
      if (allScores && entries) {
        const totals: Record<string, number> = {};
        for (const s of allScores as any[]) totals[s.player_id] = (totals[s.player_id] ?? 0) + (s.stableford_pts ?? 0);
        const standings = (entries as any[]).map(e => ({
          name: (e.players?.display_name ?? 'Player').split(' ')[0],
          pts: totals[e.player_id] ?? 0,
        })).sort((a, b) => b.pts - a.pts);
        speakPressure({ standings, holeNumber: nextHole, holesLeft: 18 - newSaved.length, format: 'stableford' });
      }
    }

    if (nextHole === 18) {
      const msg = isStroke
        ? `Gross total: ${gross}. Net total: ${totalGross + gross} 🏌️`
        : `You scored ${totalPts + pts} points 🏆`;
      Alert.alert('Round Complete!', msg, [
        { text: 'View Leaderboard', onPress: () => router.replace(`/(app)/swindle/${gameId}` as any) },
      ]);
    }
  }

  function ptColor(pts: number): string {
    if (pts >= 4) return GOLD;
    if (pts === 3) return GREEN;
    if (pts === 2) return '#9ca3af';
    if (pts === 1) return '#f97316';
    return RED;
  }

  function dotColor(sc: SavedScore): string {
    if (isStroke) {
      const ch = courseHoles.find(h => h.hole_number === sc.hole_number);
      const net = ch ? sc.gross - calcStrokesReceived(playingHcp, ch.stroke_index) : sc.gross;
      const rel = ch ? net - ch.par : 0;
      if (rel <= -2) return 'rgba(212,175,55,0.85)';
      if (rel === -1) return 'rgba(74,222,128,0.85)';
      if (rel === 0)  return 'rgba(156,163,175,0.6)';
      if (rel === 1)  return 'rgba(249,115,22,0.7)';
      return 'rgba(248,113,113,0.7)';
    }
    if (sc.pts >= 4) return 'rgba(212,175,55,0.85)';
    if (sc.pts === 3) return 'rgba(74,222,128,0.85)';
    if (sc.pts === 2) return 'rgba(156,163,175,0.6)';
    if (sc.pts === 1) return 'rgba(249,115,22,0.7)';
    return 'rgba(248,113,113,0.7)';
  }

  // ── Complete screen ──────────────────────────────────────────────────────────
  if (isComplete) {
    return (
      <View style={s.container}>
        <StatusBar style="light" />
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.headerLeft}>
            <Text style={s.backText}>← Back</Text>
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Text style={s.headerTitle}>{game?.name ?? 'Swindle'}</Text>
            <Text style={s.headerSub}>SWINDLE</Text>
          </View>
          <View style={s.headerRight} />
        </View>

        <View style={s.doneWrap}>
          <Text style={s.doneTrophy}>🏆</Text>
          <Text style={s.doneTitle}>Round Complete!</Text>
          <Text style={s.donePts}>{isStroke ? `${totalGross}` : `${totalPts} pts`}</Text>
          <Text style={s.doneSub}>{isStroke ? 'Gross strokes' : 'Stableford points'}</Text>

          {/* Summary rows */}
          <View style={s.summaryCard}>
            {saved.sort((a, b) => a.hole_number - b.hole_number).map(sc => {
              const ch = courseHoles.find(h => h.hole_number === sc.hole_number);
              const color = isStroke
                ? (() => { const net = ch ? sc.gross - calcStrokesReceived(playingHcp, ch.stroke_index) : sc.gross; const rel = ch ? net - ch.par : 0; return rel < 0 ? GOLD : rel === 0 ? GREEN : rel === 1 ? '#f97316' : RED; })()
                : ptColor(sc.pts);
              return (
                <View key={sc.hole_number} style={s.summaryRow}>
                  <Text style={s.summaryHole}>H{sc.hole_number}</Text>
                  <Text style={s.summaryGross}>{sc.gross}</Text>
                  <Text style={[s.summaryPts, { color }]}>
                    {isStroke ? (ch ? `net ${sc.gross - calcStrokesReceived(playingHcp, ch.stroke_index)}` : `${sc.gross}`) : `${sc.pts}pts`}
                  </Text>
                </View>
              );
            })}
          </View>

          <TouchableOpacity style={s.lbBtn} onPress={() => router.replace(`/(app)/swindle/${gameId}` as any)}>
            <Text style={s.lbBtnText}>View Leaderboard</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Scoring screen ───────────────────────────────────────────────────────────
  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerLeft}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>{game?.name ?? 'Swindle'}</Text>
          <Text style={s.headerSub}>SWINDLE</Text>
        </View>
        <View style={s.headerRight} />
      </View>

      {/* Incomplete course card warning */}
      {courseHoles.length > 0 && courseHoles.every(h => h.par === 4) && (
        <View style={s.courseWarning}>
          <Text style={s.courseWarningText}>⚠️ Course card not set up — scoring may be wrong. Ask your admin to add the scorecard.</Text>
        </View>
      )}

      {/* Progress dots */}
      <View style={s.dotsRow}>
        {Array.from({ length: 18 }, (_, i) => {
          const sc      = saved.find(s => s.hole_number === i + 1);
          const isDone  = !!sc;
          const isActive = i + 1 === nextHole;
          return (
            <View
              key={i}
              style={[
                s.dot,
                isDone   && { backgroundColor: dotColor(sc!) },
                isActive && s.dotActive,
              ]}
            />
          );
        })}
      </View>

      {/* Hole info card */}
      <View style={s.holeCard}>
        <View style={s.holeCardTop}>
          <Text style={s.holeLabel}>HOLE {nextHole}</Text>
          {courseHole && (
            <Text style={s.holePar}>PAR {courseHole.par}</Text>
          )}
        </View>
        {courseHole ? (
          <View style={s.holeMeta}>
            {courseHole.yardage ? (
              <Text style={s.holeYardage}>{courseHole.yardage} yds</Text>
            ) : null}
            <View style={s.holeMetaRight}>
              <Text style={s.holeMetaItem}>S.I. {courseHole.stroke_index}</Text>
              <Text style={s.holeMetaItem}>HCP {playingHcp}</Text>
              {shots > 0 && (
                <View style={s.shotPill}>
                  <Text style={s.shotPillText}>+{shots} shot{shots > 1 ? 's' : ''}</Text>
                </View>
              )}
            </View>
          </View>
        ) : (
          <Text style={s.noCourseTxt}>No course data</Text>
        )}
      </View>

      {/* Running totals banner */}
      {saved.length > 0 && (
        <View style={s.totalsBanner}>
          <Text style={s.totalsLabel}>TOTAL</Text>
          <Text style={s.totalsMain}>{isStroke ? totalGross : totalPts}</Text>
          <Text style={s.totalsSub}>{isStroke ? 'gross' : 'pts'}</Text>
          {!isStroke && totalGross > 0 && (
            <Text style={s.totalsGross}>({totalGross} gross)</Text>
          )}
        </View>
      )}

      <ScrollView contentContainerStyle={s.gridWrap} showsVerticalScrollIndicator={false}>
        {/* ── Score hero ── */}
        {(() => {
          const par = courseHole?.par ?? 4;
          const result = selected
            ? (courseHole
                ? (() => {
                    const net = selected - shots - par;
                    if (net <= -2) return 'eagle';
                    if (net === -1) return 'birdie';
                    if (net === 0) return 'par';
                    if (net === 1) return 'bogey';
                    return 'double';
                  })()
                : 'par')
            : null;
          const SCORE_COLORS: Record<string, string> = { eagle: GOLD, birdie: GREEN, par: '#3B82F6', bogey: '#f97316', double: RED };
          const SCORE_LABELS: Record<string, string> = { eagle: 'EAGLE', birdie: 'BIRDIE', par: 'PAR', bogey: 'BOGEY', double: 'DOUBLE +' };
          const accent = result ? (SCORE_COLORS[result] ?? '#6b7280') : '#1c1c1c';
          const scoreLabel = result ? (SCORE_LABELS[result] ?? '') : '';
          const pts = selected && courseHole ? calcStablefordPoints(selected, par, shots) : null;

          return (
            <>
              <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 28 }}>
                  <TouchableOpacity
                    onPress={() => setSelected(Math.max(1, (selected ?? par) - 1))}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <Ionicons name="remove-circle" size={42} color={selected && selected > 1 ? '#555' : '#222'} />
                  </TouchableOpacity>

                  <View style={{
                    width: 100, height: 100, borderRadius: 50,
                    backgroundColor: selected ? accent : '#111',
                    borderWidth: 2, borderColor: selected ? accent : '#2c2c2c',
                    alignItems: 'center', justifyContent: 'center',
                    shadowColor: selected ? accent : 'transparent',
                    shadowOffset: { width: 0, height: 0 }, shadowRadius: 20, shadowOpacity: 0.6,
                    elevation: 10,
                  }}>
                    <Text style={{ fontFamily: FFB, fontSize: 50, color: selected ? '#fff' : '#2c2c2c', lineHeight: 56 }}>
                      {selected ?? '?'}
                    </Text>
                  </View>

                  <TouchableOpacity
                    onPress={() => setSelected(Math.min(12, (selected ?? par) + 1))}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <Ionicons name="add-circle" size={42} color="#555" />
                  </TouchableOpacity>
                </View>

                <View style={{ alignItems: 'center', marginTop: 10, minHeight: 36 }}>
                  {selected ? (
                    <>
                      <Text style={{ fontFamily: FFB, fontSize: 14, color: accent, letterSpacing: 2 }}>{scoreLabel}</Text>
                      {!isStroke && pts !== null && (
                        <Text style={{ fontFamily: FF, fontSize: 12, color: '#555', marginTop: 2 }}>{pts} stableford pts</Text>
                      )}
                    </>
                  ) : (
                    <Text style={{ fontFamily: FF, fontSize: 13, color: '#444' }}>tap a number or use arrows</Text>
                  )}
                </View>
              </View>

              {/* Quick tap grid (2 rows × 5) */}
              {[[1,2,3,4,5],[6,7,8,9,10]].map((row, ri) => (
                <View key={ri} style={{ flexDirection: 'row', gap: 7, marginTop: ri === 0 ? 0 : 7 }}>
                  {row.map(n => {
                    const r = courseHole
                      ? (() => { const net = n - shots - courseHole.par; if (net <= -2) return 'eagle'; if (net === -1) return 'birdie'; if (net === 0) return 'par'; if (net === 1) return 'bogey'; return 'double'; })()
                      : 'par';
                    const SCORE_COLORS2: Record<string, string> = { eagle: GOLD, birdie: GREEN, par: '#3B82F6', bogey: '#f97316', double: RED };
                    const a = SCORE_COLORS2[r] ?? '#6b7280';
                    const on = selected === n;
                    return (
                      <TouchableOpacity
                        key={n}
                        style={{
                          flex: 1, height: 44, borderRadius: 10,
                          backgroundColor: on ? a : '#111',
                          borderWidth: 1.5, borderColor: on ? a : '#222',
                          alignItems: 'center', justifyContent: 'center',
                        }}
                        onPress={() => setSelected(n)}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontFamily: FFB, fontSize: 16, color: on ? '#fff' : '#444' }}>{n}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </>
          );
        })()}

        {/* Previous holes */}
        {saved.length > 0 && (
          <View style={s.prevSection}>
            <Text style={s.prevLabel}>PREVIOUS HOLES</Text>
            {saved.sort((a, b) => a.hole_number - b.hole_number).map(sc => {
              const ch = courseHoles.find(h => h.hole_number === sc.hole_number);
              const color = isStroke
                ? (() => {
                    const net = ch ? sc.gross - calcStrokesReceived(playingHcp, ch.stroke_index) : sc.gross;
                    const rel = ch ? net - ch.par : 0;
                    if (rel <= -2) return GOLD;
                    if (rel === -1) return GREEN;
                    if (rel === 0)  return '#9ca3af';
                    if (rel === 1)  return '#f97316';
                    return RED;
                  })()
                : ptColor(sc.pts);
              return (
                <View key={sc.hole_number} style={s.prevRow}>
                  <Text style={s.prevHole}>H{sc.hole_number}</Text>
                  <Text style={s.prevGross}>{sc.gross}</Text>
                  <Text style={[s.prevPts, { color }]}>
                    {isStroke
                      ? (ch ? `net ${sc.gross - calcStrokesReceived(playingHcp, ch.stroke_index)}` : `${sc.gross}`)
                      : `${sc.pts}pts`}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Save button */}
        <TouchableOpacity
          style={[s.saveBtn, (!selected || saving) && s.saveBtnDisabled]}
          onPress={saveScore}
          disabled={!selected || saving}
          activeOpacity={0.85}
        >
          <Text style={s.saveBtnText}>{saving ? 'Saving…' : `Save Hole ${nextHole}`}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#000', paddingTop: 56 },

  // Header — three-column
  header:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12 },
  headerLeft:      { flex: 1 },
  headerCenter:    { flex: 2, alignItems: 'center' },
  headerRight:     { flex: 1 },
  backText:        { color: GOLD, fontSize: 15, fontFamily: FFB },
  headerTitle:     { fontSize: 16, fontFamily: FFB, color: '#fff', textAlign: 'center' },
  headerSub:       { fontSize: 10, fontFamily: FFB, color: '#fff', textAlign: 'center', letterSpacing: 2, marginTop: 1 },

  // Course warning
  courseWarning:     { marginHorizontal: 16, marginBottom: 8, backgroundColor: 'rgba(245,158,11,0.12)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.4)', borderRadius: 8, padding: 10 },
  courseWarningText: { color: '#f59e0b', fontSize: 12, fontFamily: FFB, lineHeight: 18 },

  // Progress dots
  dotsRow:         { flexDirection: 'row', gap: 4, paddingHorizontal: 16, marginBottom: 12, flexWrap: 'wrap' },
  dot:             { width: 12, height: 12, borderRadius: 6, backgroundColor: '#1c1c1c' },
  dotActive:       { borderWidth: 2, borderColor: GOLD, backgroundColor: 'transparent' },

  // Hole info card
  holeCard:        { marginHorizontal: 16, backgroundColor: '#111', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#1c1c1c', marginBottom: 10 },
  holeCardTop:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  holeLabel:       { fontSize: 22, fontFamily: FFB, color: '#fff' },
  holePar:         { fontSize: 15, fontFamily: FFB, color: '#fff' },
  holeMeta:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  holeYardage:     { fontSize: 12, fontFamily: FFB, color: '#fff' },
  holeMetaRight:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  holeMetaItem:    { fontSize: 12, fontFamily: FFB, color: '#fff' },
  shotPill:        { backgroundColor: GREEN, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 },
  shotPillText:    { fontSize: 11, fontFamily: FFB, color: '#000' },
  noCourseTxt:     { color: '#fff', fontSize: 13, fontFamily: FFB, marginTop: 4 },

  // Running totals banner
  totalsBanner:    { marginHorizontal: 16, backgroundColor: '#111', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, borderWidth: 1, borderColor: '#1c1c1c' },
  totalsLabel:     { fontSize: 10, fontFamily: FFB, color: '#fff', letterSpacing: 1.5 },
  totalsMain:      { fontSize: 28, fontFamily: FFB, color: GOLD },
  totalsSub:       { fontSize: 12, fontFamily: FFB, color: '#fff', alignSelf: 'flex-end', marginBottom: 4 },
  totalsGross:     { fontSize: 11, fontFamily: FFB, color: '#fff', alignSelf: 'flex-end', marginBottom: 4, marginLeft: 4 },

  // Grid
  gridWrap:        { paddingHorizontal: 16, paddingBottom: 48 },
  gridLabel:       { fontSize: 11, fontFamily: FFB, color: '#fff', letterSpacing: 1.5, marginBottom: 8 },
  grid:            { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  scoreBtn:        { width: '30%', flexGrow: 1, backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  scoreBtnActive:  { backgroundColor: GOLD, borderColor: GOLD },
  scoreBtnNum:     { fontSize: 28, fontFamily: FFB, color: '#fff' },
  scoreBtnNumActive: { color: '#000' },
  scoreBtnPts:     { fontSize: 11, fontFamily: FFB, marginTop: 2 },

  // Previous holes
  prevSection:     { marginBottom: 16 },
  prevLabel:       { fontSize: 11, fontFamily: FFB, color: '#fff', letterSpacing: 1.5, marginBottom: 8 },
  prevRow:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#111', gap: 12 },
  prevHole:        { fontSize: 13, fontFamily: FFB, color: '#fff', width: 30 },
  prevGross:       { fontSize: 15, fontFamily: FFB, color: '#fff', flex: 1 },
  prevPts:         { fontSize: 13, fontFamily: FFB },

  // Save button
  saveBtn:         { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText:     { color: '#000', fontSize: 17, fontFamily: FFB },

  // Complete screen
  doneWrap:        { flex: 1, alignItems: 'center', paddingHorizontal: 16, paddingTop: 24 },
  doneTrophy:      { fontSize: 64, marginBottom: 8 },
  doneTitle:       { fontSize: 28, fontFamily: FFB, color: '#fff', marginBottom: 4 },
  donePts:         { fontSize: 56, fontFamily: FFB, color: GOLD, lineHeight: 64 },
  doneSub:         { fontSize: 13, fontFamily: FFB, color: '#fff', marginBottom: 20 },
  summaryCard:     { width: '100%', backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 12, marginBottom: 20, maxHeight: 320 },
  summaryRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: 12, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  summaryHole:     { fontSize: 12, fontFamily: FFB, color: '#fff', width: 28 },
  summaryGross:    { fontSize: 14, fontFamily: FFB, color: '#fff', flex: 1 },
  summaryPts:      { fontSize: 13, fontFamily: FFB },
  lbBtn:           { backgroundColor: GOLD, borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14 },
  lbBtnText:       { color: '#000', fontFamily: FFB, fontSize: 17 },
});
