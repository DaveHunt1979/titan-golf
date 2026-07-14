import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView, Image } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../../src/lib/supabase';
import { calcCourseHandicap, calcStrokesReceived, calcStablefordPoints } from '../../../../src/lib/scoring';

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../../assets/TitanAppLogo.png');

interface CourseHole { hole_number: number; par: number; stroke_index: number; }
interface Match { id: string; home_player_ids: string[]; day: { course_name: string; course_par: number; course_rating: number; slope_rating: number; } | null; }
interface PlayerInfo { id: string; name: string; courseHcp: number; }

// Hole 1,4,7,10,13,16 → best 1 | Hole 2,5,8,11,14,17 → best 2 | Hole 3,6,9,12,15,18 → best 3
function countForHole(holeNumber: number): number { return (holeNumber - 1) % 3 + 1; }

function holeTeamPts(
  players: PlayerInfo[],
  holeNumber: number,
  par: number,
  strokeIndex: number,
  scores: Record<string, Record<number, number>>
): { total: number; countingIds: string[] } {
  const count = countForHole(holeNumber);
  const playerPts = players.map(p => {
    const g = scores[p.id]?.[holeNumber];
    if (g == null) return { id: p.id, pts: 0, entered: false };
    const str = calcStrokesReceived(p.courseHcp, strokeIndex);
    return { id: p.id, pts: calcStablefordPoints(g, par, str), entered: true };
  }).filter(x => x.entered);

  const sorted = [...playerPts].sort((a, b) => b.pts - a.pts);
  const counting = sorted.slice(0, count);
  return {
    total: counting.reduce((s, x) => s + x.pts, 0),
    countingIds: counting.map(x => x.id),
  };
}

export default function ChaChaScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const [match, setMatch]     = useState<Match | null>(null);
  const [holes, setHoles]     = useState<CourseHole[]>([]);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [scores, setScores]   = useState<Record<string, Record<number, number>>>({});
  const [holeIdx, setHoleIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" />
      <ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  useEffect(() => { load(); }, [matchId]);

  async function load() {
    const { data: m } = await supabase
      .from('matches')
      .select('*,day:day_id(course_name,course_par,course_rating,slope_rating)')
      .eq('id', matchId).single();
    if (!m) { setLoading(false); return; }
    setMatch(m as any);
    const day = (m as any).day;
    const ids: string[] = (m as any).home_player_ids ?? [];

    const [holesRes, playersRes, existingRes] = await Promise.all([
      day?.course_name
        ? supabase.from('course_holes').select('hole_number,par,stroke_index').eq('course_name', day.course_name).order('hole_number')
        : Promise.resolve({ data: [] }),
      ids.length
        ? supabase.from('players').select('id,display_name,handicap_index').in('id', ids)
        : Promise.resolve({ data: [] }),
      supabase.from('match_holes').select('player_id,hole_number,gross_score').eq('match_id', matchId),
    ]);

    if (holesRes.data) setHoles(holesRes.data as CourseHole[]);

    if (playersRes.data) {
      const info: PlayerInfo[] = ids.map(id => {
        const p = (playersRes.data as any[]).find(x => x.id === id);
        const hcpIdx = p?.handicap_index ?? 0;
        const courseHcp = day
          ? calcCourseHandicap(hcpIdx, day.slope_rating, day.course_rating, day.course_par)
          : Math.round(hcpIdx);
        return { id, name: (p?.display_name ?? '?').split(' ')[0], courseHcp };
      });
      setPlayers(info);
    }

    if (existingRes.data) {
      const sc: Record<string, Record<number, number>> = {};
      ids.forEach(id => { sc[id] = {}; });
      (existingRes.data as any[]).forEach(r => {
        if (r.gross_score != null) { if (!sc[r.player_id]) sc[r.player_id] = {}; sc[r.player_id][r.hole_number] = r.gross_score; }
      });
      setScores(sc);
    }
    setLoading(false);
  }

  const hole = holes[holeIdx];
  function getScore(pid: string) { return hole ? (scores[pid]?.[hole.hole_number] ?? hole.par) : 0; }
  function setPlayerScore(pid: string, v: number) {
    if (!hole) return;
    setScores(prev => ({ ...prev, [pid]: { ...(prev[pid] ?? {}), [hole.hole_number]: Math.max(1, v) } }));
  }

  async function save() {
    if (!match || !hole || saving) return;
    setSaving(true);
    for (const p of players) {
      const g = scores[p.id]?.[hole.hole_number] ?? hole.par;
      const str = calcStrokesReceived(p.courseHcp, hole.stroke_index);
      const pts = calcStablefordPoints(g, hole.par, str);
      await supabase.from('match_holes').upsert(
        { match_id: matchId, player_id: p.id, hole_number: hole.hole_number, gross_score: g, stableford_pts: pts },
        { onConflict: 'match_id,player_id,hole_number' }
      );
    }
    setSaving(false);
  }

  async function next() {
    await save();
    if (holeIdx < holes.length - 1) { setHoleIdx(holeIdx + 1); return; }
    await supabase.from('matches').update({ status: 'complete' }).eq('id', matchId);
    const total = holes.reduce((sum, h) => {
      const { total: t } = holeTeamPts(players, h.hole_number, h.par, h.stroke_index, scores);
      return sum + t;
    }, 0);
    Alert.alert('ChaChaCha Complete!', `Team total: ${total} pts`, [{ text: 'Done', onPress: () => router.back() }]);
  }

  // Running team total
  const teamTotal = holes.slice(0, holeIdx).reduce((sum, h) => {
    const { total: t } = holeTeamPts(players, h.hole_number, h.par, h.stroke_index, scores);
    return sum + t;
  }, 0);

  // Current hole info
  const holeCount = hole ? countForHole(hole.hole_number) : 1;
  const { countingIds } = hole
    ? holeTeamPts(players, hole.hole_number, hole.par, hole.stroke_index, scores)
    : { countingIds: [] as string[] };

  if (!match || !hole) return null;

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header: back | logo+subtitle | spacer */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.logo} resizeMode="contain" />
          <Text style={s.headerSub}>CHA CHA</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {/* Team total */}
      <View style={s.teamRow}>
        <View style={s.teamTotal}>
          <Text style={s.teamPts}>{teamTotal}</Text>
          <Text style={s.teamLbl}>TEAM PTS</Text>
        </View>
        <View style={s.holeBadge}>
          <Text style={s.holeBadgeTxt}>BEST {holeCount}</Text>
          <Text style={s.holeBadgeSub}>SCORE{holeCount > 1 ? 'S' : ''} COUNT</Text>
        </View>
      </View>

      <View style={s.holeCard}>
        <Text style={s.holeNum}>Hole {hole.hole_number}</Text>
        <Text style={s.holeMeta}>Par {hole.par}  ·  SI {hole.stroke_index}</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.playersWrap}>
        {players.map(p => {
          const sc  = getScore(p.id);
          const str = calcStrokesReceived(p.courseHcp, hole.stroke_index);
          const pts = calcStablefordPoints(sc, hole.par, str);
          const isCounting = countingIds.includes(p.id);
          return (
            <View key={p.id} style={[s.playerRow, isCounting && s.playerRowCounting]}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={s.playerName}>{p.name}</Text>
                  {isCounting && <View style={s.countingBadge}><Text style={s.countingTxt}>COUNTING</Text></View>}
                </View>
                <Text style={s.playerSub}>
                  {str > 0 ? `+${str} stroke${str > 1 ? 's' : ''}` : 'Scratch'}
                  {'  ·  '}
                  <Text style={{ color: pts >= 3 ? GOLD : pts === 0 ? RED : '#888', fontFamily: FFB }}>
                    {pts} pts
                  </Text>
                </Text>
              </View>
              <View style={s.stepper}>
                <TouchableOpacity style={s.stepBtn} onPress={() => setPlayerScore(p.id, sc - 1)} activeOpacity={0.7}>
                  <Text style={s.stepBtnTxt}>−</Text>
                </TouchableOpacity>
                <View style={[
                  s.scoreDisp,
                  sc < hole.par && s.birdie,
                  sc === hole.par && s.par,
                  sc > hole.par && s.bogey,
                  isCounting && s.scoreDispCounting,
                ]}>
                  <Text style={s.scoreTxt}>{sc}</Text>
                </View>
                <TouchableOpacity style={s.stepBtn} onPress={() => setPlayerScore(p.id, sc + 1)} activeOpacity={0.7}>
                  <Text style={s.stepBtnTxt}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={s.nav}>
        <TouchableOpacity
          style={[s.navBtn, holeIdx === 0 && s.dim]}
          onPress={async () => { await save(); setHoleIdx(Math.max(0, holeIdx - 1)); }}
          disabled={holeIdx === 0 || saving}
          activeOpacity={0.7}
        >
          <Text style={s.navTxt}>← Prev</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.navBtn, s.navPrimary, saving && s.dim]}
          onPress={next}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color="#000" size="small" />
            : <Text style={[s.navTxt, { color: '#000' }]}>{holeIdx === holes.length - 1 ? 'Finish →' : 'Next →'}</Text>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container:         { flex: 1, backgroundColor: '#000' },
  header:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  backBtn:           { width: 60 },
  back:              { fontSize: 13, fontFamily: FFB, color: GOLD },
  headerCenter:      { alignItems: 'center', gap: 4 },
  logo:              { width: 28, height: 28 },
  headerSub:         { fontSize: 9, fontFamily: FF, color: '#555', letterSpacing: 1.5 },
  teamRow:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  teamTotal:         { alignItems: 'center' },
  teamPts:           { fontSize: 40, fontFamily: FFB, color: GOLD },
  teamLbl:           { fontSize: 9, fontFamily: FFB, color: '#555', letterSpacing: 1, marginTop: -4 },
  holeBadge:         { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#D4AF3740', paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center' },
  holeBadgeTxt:      { fontSize: 18, fontFamily: FFB, color: GOLD },
  holeBadgeSub:      { fontSize: 9, fontFamily: FFB, color: '#555', letterSpacing: 1 },
  holeCard:          { alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  holeNum:           { fontSize: 28, fontFamily: FFB, color: '#fff' },
  holeMeta:          { fontSize: 11, fontFamily: FF, color: '#555', marginTop: 2 },
  playersWrap:       { padding: 20, gap: 12 },
  playerRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 14 },
  playerRowCounting: { borderColor: '#D4AF3760', backgroundColor: '#1a1600' },
  playerName:        { fontSize: 15, fontFamily: FFB, color: '#fff' },
  playerSub:         { fontSize: 11, fontFamily: FF, color: '#888', marginTop: 3 },
  countingBadge:     { backgroundColor: GOLD, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  countingTxt:       { fontSize: 8, fontFamily: FFB, color: '#000', letterSpacing: 0.5 },
  stepper:           { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn:           { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#222', alignItems: 'center', justifyContent: 'center' },
  stepBtnTxt:        { fontSize: 20, fontFamily: FF, color: '#fff' },
  scoreDisp:         { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a1a', borderWidth: 2, borderColor: '#222' },
  scoreDispCounting: { borderColor: GOLD },
  birdie:            { borderColor: GREEN, backgroundColor: 'rgba(74,222,128,0.1)' },
  par:               {},
  bogey:             { borderColor: RED, backgroundColor: 'rgba(248,113,113,0.1)' },
  scoreTxt:          { fontSize: 22, fontFamily: FFB, color: '#fff' },
  nav:               { flexDirection: 'row', gap: 12, padding: 20, paddingBottom: 40, borderTopWidth: 1, borderTopColor: '#1c1c1c' },
  navBtn:            { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#1c1c1c', backgroundColor: '#111' },
  navPrimary:        { backgroundColor: GOLD, borderColor: GOLD },
  dim:               { opacity: 0.35 },
  navTxt:            { fontSize: 15, fontFamily: FFB, color: '#fff' },
});
