import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView, Image } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../../src/lib/supabase';
import { calcCourseHandicap, calcStrokesReceived } from '../../../../src/lib/scoring';

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../../assets/images/titan-logo.png');

interface CourseHole { hole_number: number; par: number; stroke_index: number; }
interface Match { id: string; home_player_ids: string[]; day: { course_name: string; course_par: number; course_rating: number; slope_rating: number; } | null; }
interface PlayerInfo { id: string; name: string; courseHcp: number; }

function modPts(gross: number, par: number, strokes: number): number {
  const diff = gross - strokes - par;
  if (diff <= -2) return 8;
  if (diff === -1) return 4;
  if (diff === 0) return 2;
  if (diff === 1) return 0;
  if (diff === 2) return -1;
  return -3;
}

function ptLabel(pts: number): string {
  if (pts === 8) return 'Eagle +8';
  if (pts === 4) return 'Birdie +4';
  if (pts === 2) return 'Par +2';
  if (pts === 0) return 'Bogey 0';
  if (pts === -1) return 'Dbl −1';
  return 'Worse −3';
}

export default function ModifiedStablefordScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const [match, setMatch]       = useState<Match | null>(null);
  const [holes, setHoles]       = useState<CourseHole[]>([]);
  const [players, setPlayers]   = useState<PlayerInfo[]>([]);
  const [scores, setScores]     = useState<Record<string, Record<number, number>>>({});
  const [holeIdx, setHoleIdx]   = useState(0);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);

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
      const pts = modPts(g, hole.par, s);
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
    const totals: Record<string, number> = {};
    players.forEach(p => { totals[p.id] = 0; });
    holes.forEach(h => {
      players.forEach(p => {
        const g = scores[p.id]?.[h.hole_number];
        if (g != null) totals[p.id] += modPts(g, h.par, calcStrokesReceived(p.courseHcp, h.stroke_index));
      });
    });
    const sorted = [...players].sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0));
    const summary = sorted.map(p => `${p.name}: ${totals[p.id] >= 0 ? '+' : ''}${totals[p.id]} pts`).join('\n');
    Alert.alert('Modified Stableford Complete!', summary, [{ text: 'Done', onPress: () => router.back() }]);
  }

  const runTotals: Record<string, number> = {};
  players.forEach(p => { runTotals[p.id] = 0; });
  holes.slice(0, holeIdx).forEach(h => {
    players.forEach(p => {
      const g = scores[p.id]?.[h.hole_number];
      if (g != null) runTotals[p.id] += modPts(g, h.par, calcStrokesReceived(p.courseHcp, h.stroke_index));
    });
  });

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
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerSub}>MODIFIED STABLEFORD</Text>
        </View>
        <View style={s.headerSpacer} />
      </View>

      {/* Running totals tally */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tallyScroll}>
        <View style={s.tally}>
          {players.map(p => {
            const t = runTotals[p.id] ?? 0;
            return (
              <View key={p.id} style={s.tallyItem}>
                <Text style={s.tallyName}>{p.name}</Text>
                <Text style={[s.tallyPts, { color: t > 0 ? GOLD : t < 0 ? RED : '#fff' }]}>
                  {t > 0 ? '+' : ''}{t}
                </Text>
                <Text style={s.tallyLbl}>PTS</Text>
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
          const pts = modPts(sc, hole.par, str);
          return (
            <View key={p.id} style={s.playerRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.playerName}>{p.name}</Text>
                <Text style={s.playerSub}>
                  {str > 0 ? `+${str} stroke${str > 1 ? 's' : ''}` : 'Scratch'}
                  {'  ·  '}
                  <Text style={{ color: pts >= 4 ? GOLD : pts < 0 ? RED : pts === 2 ? GREEN : '#888' }}>
                    {ptLabel(pts)}
                  </Text>
                </Text>
              </View>
              <View style={s.stepper}>
                <TouchableOpacity style={s.stepBtn} onPress={() => setPlayerScore(p.id, sc - 1)} activeOpacity={0.7}>
                  <Text style={s.stepBtnTxt}>−</Text>
                </TouchableOpacity>
                <View style={[s.scoreDisp, pts >= 8 && s.eagle, pts === 4 && s.birdie, pts === 2 && s.par, pts < 0 && s.bad]}>
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
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  backBtn:      { minWidth: 60 },
  back:         { fontSize: 14, fontFamily: FFB, color: GOLD },
  headerCenter: { alignItems: 'center', flex: 1 },
  headerLogo:   { width: 28, height: 28, marginBottom: 3 },
  headerSub:    { fontSize: 9, fontFamily: FF, color: '#555', letterSpacing: 1 },
  headerSpacer: { minWidth: 60 },
  tallyScroll:  { maxHeight: 90, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  tally:        { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingVertical: 10, alignItems: 'center' },
  tallyItem:    { alignItems: 'center', backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', paddingHorizontal: 14, paddingVertical: 8, minWidth: 70 },
  tallyName:    { fontSize: 11, fontFamily: FFB, color: '#666', marginBottom: 2 },
  tallyPts:     { fontSize: 22, fontFamily: FFB },
  tallyLbl:     { fontSize: 8, fontFamily: FFB, color: '#555', letterSpacing: 1, marginTop: 1 },
  holeCard:     { alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  holeNum:      { fontSize: 28, fontFamily: FFB, color: '#fff' },
  holeMeta:     { fontSize: 11, fontFamily: FF, color: '#666', marginTop: 2 },
  playersWrap:  { padding: 20, gap: 20 },
  playerRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 16 },
  playerName:   { fontSize: 16, fontFamily: FFB, color: '#fff' },
  playerSub:    { fontSize: 11, fontFamily: FF, color: '#666', marginTop: 3 },
  stepper:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn:      { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#222', alignItems: 'center', justifyContent: 'center' },
  stepBtnTxt:   { fontSize: 22, fontFamily: FF, color: '#fff' },
  scoreDisp:    { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a1a', borderWidth: 2, borderColor: '#222' },
  eagle:        { borderColor: GOLD, backgroundColor: 'rgba(212,175,55,0.12)' },
  birdie:       { borderColor: GREEN, backgroundColor: 'rgba(74,222,128,0.1)' },
  par:          {},
  bad:          { borderColor: RED, backgroundColor: 'rgba(248,113,113,0.1)' },
  scoreTxt:     { fontSize: 24, fontFamily: FFB, color: '#fff' },
  nav:          { flexDirection: 'row', gap: 12, padding: 20, paddingBottom: 40, borderTopWidth: 1, borderTopColor: '#1c1c1c' },
  navBtn:       { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#1c1c1c', backgroundColor: '#111' },
  navPrimary:   { backgroundColor: GOLD, borderColor: GOLD },
  dim:          { opacity: 0.35 },
  navTxt:       { fontSize: 16, fontFamily: FFB, color: '#fff' },
});
