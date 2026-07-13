import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView, Image } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../../src/lib/supabase';
import { calcCourseHandicap, calcStrokesReceived } from '../../../../src/lib/scoring';

// TITAN design constants
const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../../assets/images/titan-logo.png');

interface CourseHole { hole_number: number; par: number; stroke_index: number; }
interface Match { id: string; home_player_ids: string[]; day: { course_name: string; course_par: number; course_rating: number; slope_rating: number; } | null; }
interface PlayerInfo { id: string; name: string; courseHcp: number; }

// +1 win, 0 halve, -1 lose vs nett par
function holeResult(gross: number, par: number, strokes: number): 1 | 0 | -1 {
  const nett = gross - strokes;
  if (nett < par) return 1;
  if (nett > par) return -1;
  return 0;
}

function resultLabel(r: 1 | 0 | -1) {
  if (r === 1)  return { text: 'WIN',   color: GREEN };
  if (r === -1) return { text: 'LOSE',  color: RED };
  return            { text: 'HALVE', color: '#555' };
}

function totalLabel(t: number) {
  if (t === 0) return 'E';
  return `${t > 0 ? '+' : ''}${t}`;
}

export default function ParBogeyScreen() {
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
  function strokes(pid: string) {
    const p = players.find(x => x.id === pid);
    return p && hole ? calcStrokesReceived(p.courseHcp, hole.stroke_index) : 0;
  }

  async function save() {
    if (!match || !hole || saving) return;
    setSaving(true);
    for (const p of players) {
      const g = scores[p.id]?.[hole.hole_number] ?? hole.par;
      const s = calcStrokesReceived(p.courseHcp, hole.stroke_index);
      const r = holeResult(g, hole.par, s);
      await supabase.from('match_holes').upsert(
        { match_id: matchId, player_id: p.id, hole_number: hole.hole_number, gross_score: g, stableford_pts: r },
        { onConflict: 'match_id,player_id,hole_number' }
      );
    }
    setSaving(false);
  }

  async function next() {
    await save();
    if (holeIdx < holes.length - 1) { setHoleIdx(holeIdx + 1); return; }
    await supabase.from('matches').update({ status: 'complete' }).eq('id', matchId);
    const totals: Record<string, number> = {};
    players.forEach(p => { totals[p.id] = 0; });
    holes.forEach(h => {
      players.forEach(p => {
        const g = scores[p.id]?.[h.hole_number];
        if (g != null) totals[p.id] += holeResult(g, h.par, calcStrokesReceived(p.courseHcp, h.stroke_index));
      });
    });
    const sorted = [...players].sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0));
    const summary = sorted.map(p => `${p.name}: ${totalLabel(totals[p.id])}`).join('\n');
    Alert.alert('Par/Bogey Complete!', summary, [{ text: 'Done', onPress: () => router.back() }]);
  }

  // Running totals for holes already played (up to current)
  const runTotals: Record<string, number> = {};
  players.forEach(p => { runTotals[p.id] = 0; });
  holes.slice(0, holeIdx).forEach(h => {
    players.forEach(p => {
      const g = scores[p.id]?.[h.hole_number];
      if (g != null) runTotals[p.id] += holeResult(g, h.par, calcStrokesReceived(p.courseHcp, h.stroke_index));
    });
  });

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" />
      <ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  if (!match || !hole) return null;

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.logo} resizeMode="contain" />
          <Text style={s.subtitle}>PAR/BOGEY</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {/* Running totals */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tallyScroll}>
        <View style={s.tally}>
          {players.map(p => {
            const t = runTotals[p.id] ?? 0;
            return (
              <View key={p.id} style={[s.tallyItem, t > 0 && s.tallyWin, t < 0 && s.tallyLose]}>
                <Text style={s.tallyName}>{p.name}</Text>
                <Text style={[s.tallyScore, { color: t > 0 ? GREEN : t < 0 ? RED : '#fff' }]}>
                  {totalLabel(t)}
                </Text>
                <Text style={s.tallyLbl}>VS PAR</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Hole info card */}
      <View style={s.holeCard}>
        <Text style={s.holeNum}>Hole {hole.hole_number}</Text>
        <Text style={s.holeMeta}>Par {hole.par}  ·  SI {hole.stroke_index}</Text>
      </View>

      {/* Player score rows */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.playersWrap}>
        {players.map(p => {
          const sc  = getScore(p.id);
          const str = strokes(p.id);
          const res = holeResult(sc, hole.par, str);
          const lbl = resultLabel(res);
          return (
            <View key={p.id} style={s.playerRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.playerName}>{p.name}</Text>
                <Text style={s.playerSub}>
                  Nett {sc - str}  ·  {str > 0 ? `+${str} stroke${str > 1 ? 's' : ''}` : 'Scratch'}
                  {'  ·  '}
                  <Text style={{ color: lbl.color, fontFamily: FFB }}>{lbl.text}</Text>
                </Text>
              </View>
              <View style={s.stepper}>
                <TouchableOpacity style={s.stepBtn} onPress={() => setPlayerScore(p.id, sc - 1)} activeOpacity={0.7}>
                  <Text style={s.stepBtnTxt}>−</Text>
                </TouchableOpacity>
                <View style={[s.scoreDisp, res === 1 && s.win, res === -1 && s.lose]}>
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

      {/* Nav buttons */}
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
  container:    { flex: 1, backgroundColor: '#000' },
  // Header
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  backBtn:      { width: 60 },
  back:         { fontSize: 13, fontFamily: FFB, color: GOLD },
  headerCenter: { alignItems: 'center', gap: 4 },
  logo:         { width: 28, height: 28 },
  subtitle:     { fontSize: 9, fontFamily: FF, color: '#555', letterSpacing: 1.5 },
  // Tally strip
  tallyScroll:  { maxHeight: 90, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  tally:        { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingVertical: 10, alignItems: 'center' },
  tallyItem:    { alignItems: 'center', backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', paddingHorizontal: 14, paddingVertical: 8, minWidth: 70 },
  tallyWin:     { borderColor: GREEN, backgroundColor: 'rgba(74,222,128,0.08)' },
  tallyLose:    { borderColor: RED,   backgroundColor: 'rgba(248,113,113,0.08)' },
  tallyName:    { fontSize: 10, fontFamily: FFB, color: '#555', marginBottom: 2 },
  tallyScore:   { fontSize: 20, fontFamily: FFB },
  tallyLbl:     { fontSize: 8, fontFamily: FFB, color: '#555', letterSpacing: 1, marginTop: 1 },
  // Hole card
  holeCard:     { alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  holeNum:      { fontSize: 28, fontFamily: FFB, color: '#fff' },
  holeMeta:     { fontSize: 11, fontFamily: FF, color: '#555', marginTop: 2 },
  // Player rows
  playersWrap:  { padding: 20, gap: 20 },
  playerRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 16 },
  playerName:   { fontSize: 16, fontFamily: FFB, color: '#fff' },
  playerSub:    { fontSize: 11, fontFamily: FF, color: '#555', marginTop: 3 },
  // Stepper
  stepper:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn:      { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#222', alignItems: 'center', justifyContent: 'center' },
  stepBtnTxt:   { fontSize: 22, fontFamily: FF, color: '#fff' },
  scoreDisp:    { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a1a', borderWidth: 2, borderColor: '#222' },
  win:          { borderColor: GREEN, backgroundColor: 'rgba(74,222,128,0.1)' },
  lose:         { borderColor: RED,   backgroundColor: 'rgba(248,113,113,0.1)' },
  scoreTxt:     { fontSize: 24, fontFamily: FFB, color: '#fff' },
  // Nav
  nav:          { flexDirection: 'row', gap: 12, padding: 20, paddingBottom: 40, borderTopWidth: 1, borderTopColor: '#1c1c1c' },
  navBtn:       { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#1c1c1c', backgroundColor: '#111' },
  navPrimary:   { backgroundColor: GOLD, borderColor: GOLD },
  dim:          { opacity: 0.35 },
  navTxt:       { fontSize: 15, fontFamily: FFB, color: '#fff' },
});
