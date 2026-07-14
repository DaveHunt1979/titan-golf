import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView, Image } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../../src/lib/supabase';

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../../assets/TitanAppLogo.png');

interface CourseHole { hole_number: number; par: number; stroke_index: number; }
interface Match { id: string; home_player_ids: string[]; day: { course_name: string } | null; }

// Wolf points: Wolf+partner win = 2ea; others win = 2ea; lone Wolf wins = 3ea; lone Wolf loses = 2 each to others
function wolfPoints(players: string[], wolfId: string, partnerId: string | null, scores: Record<string, number>) {
  const wolfScore = scores[wolfId] ?? 99;
  const pts: Record<string, number> = {};
  players.forEach(id => { pts[id] = 0; });

  if (partnerId) {
    const partnerScore = scores[partnerId] ?? 99;
    const wolfSideScore = Math.min(wolfScore, partnerScore);
    const others = players.filter(id => id !== wolfId && id !== partnerId);
    const otherBest = Math.min(...others.map(id => scores[id] ?? 99));
    if (wolfSideScore < otherBest) {
      pts[wolfId] = 2; pts[partnerId] = 2;
    } else if (otherBest < wolfSideScore) {
      others.forEach(id => { pts[id] = 2; });
    }
  } else {
    const others = players.filter(id => id !== wolfId);
    const otherBest = Math.min(...others.map(id => scores[id] ?? 99));
    if (wolfScore < otherBest) {
      others.forEach(id => { pts[wolfId] += 3; }); // 3 pts per other player
      pts[wolfId] = 3 * others.length;
    } else if (otherBest < wolfScore) {
      others.forEach(id => { pts[id] = 2; });
    }
  }
  return pts;
}

export default function WolfScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const [match, setMatch]       = useState<Match | null>(null);
  const [holes, setHoles]       = useState<CourseHole[]>([]);
  const [names, setNames]       = useState<Record<string, string>>({});
  const [holeIdx, setHoleIdx]   = useState(0);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  // Per-hole: wolf decisions stored in result_str
  const [wolfDecisions, setWolfDecisions] = useState<Record<number, { partner: string | null }>>({});
  // Gross scores per player per hole
  const [scores, setScores]     = useState<Record<string, Record<number, number>>>({});
  // Phase: 'pick' (wolf picks partner) | 'score' (enter scores)
  const [phase, setPhase]       = useState<'pick' | 'score'>('pick');
  // Cumulative points
  const [cumPoints, setCumPoints] = useState<Record<string, number>>({});

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
    const { data: m } = await supabase.from('matches').select('*,day:day_id(course_name)').eq('id', matchId).single();
    if (!m) { setLoading(false); return; }
    setMatch(m as any);
    const { data: h } = await supabase.from('course_holes').select('hole_number,par,stroke_index').eq('course_name', (m as any).day?.course_name).order('hole_number');
    if (h) setHoles(h as CourseHole[]);
    const ids = (m as any).home_player_ids ?? [];
    if (ids.length) {
      const { data: p } = await supabase.from('players').select('id,display_name').in('id', ids);
      if (p) { const n: Record<string,string> = {}; (p as any[]).forEach(x => n[x.id] = x.display_name.split(' ')[0]); setNames(n); }
      const cp: Record<string, number> = {}; ids.forEach((id: string) => { cp[id] = 0; }); setCumPoints(cp);
    }
    const { data: existing } = await supabase.from('match_holes').select('player_id,hole_number,gross_score').eq('match_id', matchId);
    if (existing) {
      const sc: Record<string, Record<number, number>> = {};
      ids.forEach((id: string) => { sc[id] = {}; });
      (existing as any[]).forEach(r => { if (r.gross_score != null) { if (!sc[r.player_id]) sc[r.player_id] = {}; sc[r.player_id][r.hole_number] = r.gross_score; } });
      setScores(sc);
    }
    // Load wolf decisions
    const { data: matchData } = await supabase.from('matches').select('result_str').eq('id', matchId).single();
    if (matchData && (matchData as any).result_str) {
      try { const parsed = JSON.parse((matchData as any).result_str); if (parsed.wolf) setWolfDecisions(parsed.wolf); } catch {}
    }
    setLoading(false);
  }

  const hole = holes[holeIdx];
  const players = match?.home_player_ids ?? [];
  // Wolf rotates: hole 1 = player[0], hole 2 = player[1], etc.
  const wolfId = hole ? players[(hole.hole_number - 1) % players.length] : null;
  const decision = hole ? wolfDecisions[hole.hole_number] : null;
  const partnerId = decision?.partner ?? null;

  function pickPartner(pid: string | null) {
    if (!hole) return;
    setWolfDecisions(prev => ({ ...prev, [hole.hole_number]: { partner: pid } }));
    setPhase('score');
  }

  function getScore(pid: string) { return hole ? (scores[pid]?.[hole.hole_number] ?? hole.par) : 0; }
  function setPlayerScore(pid: string, v: number) {
    if (!hole) return;
    setScores(prev => ({ ...prev, [pid]: { ...(prev[pid] ?? {}), [hole.hole_number]: Math.max(1, v) } }));
  }

  async function saveHole() {
    if (!match || !hole || saving) return;
    setSaving(true);
    for (const pid of players) {
      const g = scores[pid]?.[hole.hole_number] ?? hole.par;
      await supabase.from('match_holes').upsert({ match_id: matchId, player_id: pid, hole_number: hole.hole_number, gross_score: g }, { onConflict: 'match_id,player_id,hole_number' });
    }
    const { data: existing } = await supabase.from('matches').select('result_str').eq('id', matchId).single();
    let parsed: any = {};
    try { if ((existing as any)?.result_str) parsed = JSON.parse((existing as any).result_str); } catch {}
    parsed.wolf = wolfDecisions;
    await supabase.from('matches').update({ result_str: JSON.stringify(parsed) }).eq('id', matchId);
    setSaving(false);
  }

  async function nextHole() {
    if (!wolfId || !hole) return;
    // Calculate points for this hole
    const hScores: Record<string, number> = {};
    players.forEach(pid => { hScores[pid] = scores[pid]?.[hole.hole_number] ?? hole.par; });
    const holePts = wolfPoints(players, wolfId, partnerId, hScores);
    const newCum = { ...cumPoints };
    players.forEach(id => { newCum[id] = (newCum[id] ?? 0) + (holePts[id] ?? 0); });
    setCumPoints(newCum);

    await saveHole();

    if (holeIdx < holes.length - 1) {
      setHoleIdx(holeIdx + 1);
      setPhase('pick');
    } else {
      await supabase.from('matches').update({ status: 'complete' }).eq('id', matchId);
      const summary = players.sort((a, b) => (newCum[b] ?? 0) - (newCum[a] ?? 0))
        .map(id => `${names[id] ?? id}: ${newCum[id]} pts`).join('\n');
      Alert.alert('Wolf Complete!', summary, [{ text: 'Done', onPress: () => router.back() }]);
    }
  }

  if (!match || !hole || !wolfId) return null;

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
          <Text style={s.headerSub}>WOLF</Text>
        </View>
        <View style={s.headerSpacer} />
      </View>

      {/* Cumulative points tally */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tallyScroll}>
        <View style={s.tally}>
          {players.map(id => (
            <View key={id} style={[s.tallyItem, id === wolfId && s.tallyWolf]}>
              <Text style={[s.tallyName, id === wolfId && { color: GOLD }]}>{names[id] ?? '?'}{id === wolfId ? ' 🐺' : ''}</Text>
              <Text style={[s.tallyPts, { color: id === wolfId ? GOLD : '#fff' }]}>{cumPoints[id] ?? 0}</Text>
              <Text style={s.tallyLbl}>PTS</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Hole info card */}
      <View style={s.holeCard}>
        <Text style={s.holeNum}>Hole {hole.hole_number}</Text>
        <Text style={s.holeMeta}>Par {hole.par}  ·  SI {hole.stroke_index}</Text>
        <View style={s.wolfBadge}>
          <Text style={s.wolfBadgeTxt}>🐺 {names[wolfId] ?? '?'} is the Wolf</Text>
        </View>
      </View>

      {phase === 'pick' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.pickWrap}>
          <Text style={s.pickTitle}>Wolf — pick your partner or go it alone!</Text>
          <TouchableOpacity style={s.loneBtn} onPress={() => pickPartner(null)} activeOpacity={0.8}>
            <Text style={s.loneBtnTxt}>🐺 Go it alone! (3× pts)</Text>
          </TouchableOpacity>
          <Text style={s.pickOr}>— or pick a partner —</Text>
          {players.filter(id => id !== wolfId).map(pid => (
            <TouchableOpacity
              key={pid}
              style={[s.partnerBtn, partnerId === pid && s.partnerBtnOn]}
              onPress={() => pickPartner(pid)}
              activeOpacity={0.8}
            >
              <Text style={[s.partnerBtnTxt, partnerId === pid && s.partnerBtnTxtOn]}>{names[pid] ?? '?'}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scoresWrap}>
          {partnerId
            ? <Text style={s.teamLabel}>🐺 {names[wolfId] ?? '?'} & {names[partnerId] ?? '?'} vs {players.filter(id => id !== wolfId && id !== partnerId).map(id => names[id] ?? '?').join(' & ')}</Text>
            : <Text style={s.teamLabel}>🐺 {names[wolfId] ?? '?'} LONE WOLF vs everyone</Text>
          }
          {players.map(pid => {
            const sc = getScore(pid);
            const isWolf = pid === wolfId;
            return (
              <View key={pid} style={[s.playerRow, isWolf && s.playerRowWolf]}>
                <Text style={[s.playerName, isWolf && { color: GOLD }]}>{names[pid] ?? '?'}{isWolf ? ' 🐺' : ''}</Text>
                <View style={s.stepper}>
                  <TouchableOpacity style={s.stepBtn} onPress={() => setPlayerScore(pid, sc - 1)} activeOpacity={0.7}>
                    <Text style={s.stepBtnTxt}>−</Text>
                  </TouchableOpacity>
                  <View style={[s.scoreDisp, sc < hole.par && s.birdie, sc > hole.par && s.bogey, isWolf && sc <= hole.par && s.scoreDispWolf]}>
                    <Text style={[s.scoreTxt, isWolf && { color: GOLD }]}>{sc}</Text>
                  </View>
                  <TouchableOpacity style={s.stepBtn} onPress={() => setPlayerScore(pid, sc + 1)} activeOpacity={0.7}>
                    <Text style={s.stepBtnTxt}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
          <TouchableOpacity style={s.changeBtn} onPress={() => setPhase('pick')} activeOpacity={0.7}>
            <Text style={s.changeBtnTxt}>← Change Wolf decision</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {phase === 'score' && (
        <View style={s.nav}>
          <TouchableOpacity style={[s.navBtn, saving && s.dim]} onPress={nextHole} disabled={saving} activeOpacity={0.8}>
            {saving
              ? <ActivityIndicator color="#000" size="small" />
              : <Text style={[s.navTxt, { color: '#000' }]}>{holeIdx === holes.length - 1 ? 'Finish →' : 'Next Hole →'}</Text>
            }
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#000' },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  backBtn:         { minWidth: 60 },
  back:            { fontSize: 14, fontFamily: FFB, color: GOLD },
  headerCenter:    { alignItems: 'center', flex: 1 },
  headerLogo:      { width: 28, height: 28, marginBottom: 3 },
  headerSub:       { fontSize: 9, fontFamily: FF, color: '#555', letterSpacing: 1 },
  headerSpacer:    { minWidth: 60 },
  tallyScroll:     { maxHeight: 90, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  tally:           { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingVertical: 10, alignItems: 'center' },
  tallyItem:       { alignItems: 'center', backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', paddingHorizontal: 14, paddingVertical: 8, minWidth: 64 },
  tallyWolf:       { borderColor: GOLD, backgroundColor: 'rgba(212,175,55,0.08)' },
  tallyName:       { fontSize: 11, fontFamily: FFB, color: '#666', marginBottom: 2 },
  tallyPts:        { fontSize: 22, fontFamily: FFB },
  tallyLbl:        { fontSize: 8, fontFamily: FFB, color: '#555', letterSpacing: 1, marginTop: 1 },
  holeCard:        { alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  holeNum:         { fontSize: 28, fontFamily: FFB, color: '#fff' },
  holeMeta:        { fontSize: 11, fontFamily: FF, color: '#666', marginTop: 2 },
  wolfBadge:       { marginTop: 8, backgroundColor: 'rgba(212,175,55,0.1)', borderRadius: 99, borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)', paddingHorizontal: 14, paddingVertical: 3 },
  wolfBadgeTxt:    { fontSize: 11, fontFamily: FFB, color: GOLD },
  pickWrap:        { padding: 20, gap: 12 },
  pickTitle:       { fontSize: 14, fontFamily: FFB, color: '#888', textAlign: 'center', marginBottom: 8 },
  loneBtn:         { backgroundColor: 'rgba(212,175,55,0.1)', borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(212,175,55,0.3)', paddingVertical: 18, alignItems: 'center' },
  loneBtnTxt:      { fontSize: 16, fontFamily: FFB, color: GOLD },
  pickOr:          { fontSize: 11, fontFamily: FF, color: '#555', textAlign: 'center' },
  partnerBtn:      { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', paddingVertical: 14, alignItems: 'center' },
  partnerBtnOn:    { borderColor: GOLD, backgroundColor: 'rgba(212,175,55,0.1)' },
  partnerBtnTxt:   { fontSize: 16, fontFamily: FFB, color: '#888' },
  partnerBtnTxtOn: { color: GOLD },
  scoresWrap:      { padding: 20, gap: 16 },
  teamLabel:       { fontSize: 11, fontFamily: FFB, color: GOLD, textAlign: 'center', marginBottom: 8 },
  playerRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 16 },
  playerRowWolf:   { borderColor: GOLD, backgroundColor: 'rgba(212,175,55,0.06)' },
  playerName:      { fontSize: 16, fontFamily: FFB, color: '#fff', flex: 1 },
  stepper:         { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn:         { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#222', alignItems: 'center', justifyContent: 'center' },
  stepBtnTxt:      { fontSize: 22, fontFamily: FF, color: '#fff' },
  scoreDisp:       { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a1a', borderWidth: 2, borderColor: '#222' },
  scoreDispWolf:   { borderColor: GOLD, backgroundColor: 'rgba(212,175,55,0.12)' },
  birdie:          { borderColor: GREEN, backgroundColor: 'rgba(74,222,128,0.1)' },
  bogey:           { borderColor: RED, backgroundColor: 'rgba(248,113,113,0.1)' },
  scoreTxt:        { fontSize: 24, fontFamily: FFB, color: '#fff' },
  changeBtn:       { alignItems: 'center', paddingVertical: 10 },
  changeBtnTxt:    { fontSize: 11, fontFamily: FF, color: '#555' },
  nav:             { padding: 20, paddingBottom: 40, borderTopWidth: 1, borderTopColor: '#1c1c1c' },
  navBtn:          { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  dim:             { opacity: 0.35 },
  navTxt:          { fontSize: 16, fontFamily: FFB, color: '#fff' },
});
