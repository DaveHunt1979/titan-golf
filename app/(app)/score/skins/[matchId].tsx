import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView, Image } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../../src/lib/supabase';

const GOLD = '#D4AF37';
const GREEN = '#4ade80';
const RED = '#f87171';
const FF = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';
const titanLogo = require('../../../../assets/TitanAppLogo.png');

interface CourseHole { hole_number: number; par: number; stroke_index: number; }
interface Match { id: string; status: string; home_player_ids: string[]; day: { course_name: string } | null; }

function calcSkins(playerIds: string[], scores: Record<string, Record<number, number>>, holes: CourseHole[]) {
  const skins: Record<string, number> = {};
  playerIds.forEach(id => { skins[id] = 0; });
  let carryover = 0;
  for (const hole of holes) {
    const hScores = playerIds.map(id => ({ id, score: scores[id]?.[hole.hole_number] })).filter(x => x.score !== undefined) as { id: string; score: number }[];
    if (hScores.length < playerIds.length) continue;
    const min = Math.min(...hScores.map(x => x.score));
    const winners = hScores.filter(x => x.score === min);
    if (winners.length === 1) {
      skins[winners[0].id] += (1 + carryover);
      carryover = 0;
    } else {
      carryover++;
    }
  }
  return { skins, carryover };
}

export default function SkinsScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const [match, setMatch]     = useState<Match | null>(null);
  const [holes, setHoles]     = useState<CourseHole[]>([]);
  const [names, setNames]     = useState<Record<string, string>>({});
  // scores[playerId][holeNumber] = gross
  const [scores, setScores]   = useState<Record<string, Record<number, number>>>({});
  const [holeIdx, setHoleIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  useEffect(() => { load(); }, [matchId]);

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" />
      <ActivityIndicator color={GOLD} size="large" />
    </View>
  );

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
    }
    const { data: ex } = await supabase.from('match_holes').select('player_id,hole_number,gross_score').eq('match_id', matchId);
    if (ex) {
      const sc: Record<string, Record<number, number>> = {};
      ids.forEach((id: string) => { sc[id] = {}; });
      (ex as any[]).forEach(r => { if (r.gross_score != null) { if (!sc[r.player_id]) sc[r.player_id] = {}; sc[r.player_id][r.hole_number] = r.gross_score; } });
      setScores(sc);
    }
    setLoading(false);
  }

  const hole = holes[holeIdx];
  const players = match?.home_player_ids ?? [];

  function getScore(pid: string) { return hole ? (scores[pid]?.[hole.hole_number] ?? hole.par) : 0; }
  function setPlayerScore(pid: string, v: number) {
    if (!hole) return;
    setScores(prev => ({ ...prev, [pid]: { ...(prev[pid] ?? {}), [hole.hole_number]: Math.max(1, v) } }));
  }

  async function save() {
    if (!match || !hole || saving) return;
    setSaving(true);
    for (const pid of players) {
      const g = scores[pid]?.[hole.hole_number] ?? hole.par;
      await supabase.from('match_holes').upsert({ match_id: matchId, player_id: pid, hole_number: hole.hole_number, gross_score: g }, { onConflict: 'match_id,player_id,hole_number' });
    }
    setSaving(false);
  }

  async function next() {
    await save();
    if (holeIdx < holes.length - 1) { setHoleIdx(holeIdx + 1); return; }
    await supabase.from('matches').update({ status: 'complete' }).eq('id', matchId);
    const { skins } = calcSkins(players, scores, holes);
    const summary = players.map(id => `${names[id] ?? id}: ${skins[id]} skin${skins[id] !== 1 ? 's' : ''}`).join('\n');
    Alert.alert('Skins Complete!', summary, [{ text: 'Done', onPress: () => router.back() }]);
  }

  const { skins: liveSkins, carryover } = calcSkins(players, scores, holes.slice(0, holeIdx));

  // Hole result for completed holes
  function holeWinner(hNum: number) {
    const hScores = players.map(id => ({ id, score: scores[id]?.[hNum] })).filter(x => x.score !== undefined) as { id: string; score: number }[];
    if (hScores.length < players.length) return null;
    const min = Math.min(...hScores.map(x => x.score));
    const winners = hScores.filter(x => x.score === min);
    return winners.length === 1 ? winners[0].id : 'carry';
  }

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
          <Text style={s.headerSub}>SKINS</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {/* Skins tally */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tallyScroll}>
        <View style={s.tally}>
          {players.map(id => {
            const count = liveSkins[id] ?? 0;
            const isLeader = count > 0;
            return (
              <View key={id} style={[s.tallyItem, isLeader && s.tallyItemWinner]}>
                <Text style={[s.tallyName, isLeader && s.tallyNameWinner]}>{names[id] ?? '?'}</Text>
                <Text style={[s.tallySkins, isLeader && s.tallySkinsWinner]}>{count}</Text>
                <View style={[s.tallyPill, isLeader && s.tallyPillWinner]}>
                  <Text style={[s.tallyLbl, isLeader && s.tallyLblWinner]}>SKINS</Text>
                </View>
              </View>
            );
          })}
          {carryover > 0 && (
            <View style={[s.tallyItem, s.tallyCarry]}>
              <Text style={[s.tallyName, { color: '#fff' }]}>CARRY</Text>
              <Text style={[s.tallySkins, { color: '#fff' }]}>{carryover}</Text>
              <View style={s.tallyPill}>
                <Text style={s.tallyLbl}>HOLES</Text>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Hole card */}
      <View style={s.holeCard}>
        <Text style={s.holeNum}>Hole {hole.hole_number}</Text>
        <Text style={s.holeMeta}>Par {hole.par}  ·  SI {hole.stroke_index}</Text>
      </View>

      {/* Per-player score entry */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.playersWrap}>
        {players.map(pid => {
          const sc = getScore(pid);
          return (
            <View key={pid} style={s.playerCard}>
              <Text style={s.playerName}>{names[pid] ?? '?'}</Text>
              <View style={s.stepper}>
                <TouchableOpacity style={s.stepBtn} onPress={() => setPlayerScore(pid, sc - 1)} activeOpacity={0.7}>
                  <Text style={s.stepBtnTxt}>−</Text>
                </TouchableOpacity>
                <View style={[
                  s.scoreDisp,
                  sc < hole.par && s.birdie,
                  sc === hole.par && s.par,
                  sc > hole.par && s.bogey,
                ]}>
                  <Text style={s.scoreTxt}>{sc}</Text>
                </View>
                <TouchableOpacity style={s.stepBtn} onPress={() => setPlayerScore(pid, sc + 1)} activeOpacity={0.7}>
                  <Text style={s.stepBtnTxt}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Navigation */}
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
  container:       { flex: 1, backgroundColor: '#000' },
  // Header
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  backBtn:         { width: 60 },
  back:            { fontSize: 13, fontFamily: FFB, color: GOLD },
  headerCenter:    { alignItems: 'center', gap: 4 },
  logo:            { width: 28, height: 28 },
  headerSub:       { fontSize: 9, fontFamily: FFB, color: '#fff', letterSpacing: 2 },
  // Tally
  tallyScroll:     { maxHeight: 100, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  tally:           { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingVertical: 12, alignItems: 'center' },
  tallyItem:       { alignItems: 'center', backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', paddingHorizontal: 14, paddingVertical: 10, minWidth: 72 },
  tallyItemWinner: { backgroundColor: 'rgba(212,175,55,0.08)', borderColor: GOLD },
  tallyCarry:      { borderColor: '#333' },
  tallyName:       { fontSize: 11, fontFamily: FFB, color: '#fff', marginBottom: 2 },
  tallyNameWinner: { fontFamily: FFB, color: GOLD },
  tallySkins:      { fontSize: 26, fontFamily: FFB, color: '#fff' },
  tallySkinsWinner:{ color: GOLD },
  tallyPill:       { backgroundColor: '#1a1a1a', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 2 },
  tallyPillWinner: { backgroundColor: GOLD },
  tallyLbl:        { fontSize: 8, fontFamily: FFB, color: '#fff', letterSpacing: 1 },
  tallyLblWinner:  { color: '#000' },
  // Hole card
  holeCard:        { alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  holeNum:         { fontSize: 28, fontFamily: FFB, color: '#fff' },
  holeMeta:        { fontSize: 11, fontFamily: FFB, color: '#fff', marginTop: 3 },
  // Players
  playersWrap:     { padding: 20, gap: 12 },
  playerCard:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', paddingHorizontal: 16, paddingVertical: 14 },
  playerName:      { fontSize: 15, fontFamily: FFB, color: '#fff', flex: 1 },
  stepper:         { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn:         { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#222', alignItems: 'center', justifyContent: 'center' },
  stepBtnTxt:      { fontSize: 22, fontFamily: FFB, color: '#fff' },
  scoreDisp:       { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a1a', borderWidth: 2, borderColor: '#222' },
  birdie:          { borderColor: GREEN, backgroundColor: 'rgba(74,222,128,0.1)' },
  par:             {},
  bogey:           { borderColor: RED, backgroundColor: 'rgba(248,113,113,0.1)' },
  scoreTxt:        { fontSize: 24, fontFamily: FFB, color: '#fff' },
  // Nav
  nav:             { flexDirection: 'row', gap: 12, padding: 20, paddingBottom: 40, borderTopWidth: 1, borderTopColor: '#1c1c1c' },
  navBtn:          { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#1c1c1c', backgroundColor: '#111' },
  navPrimary:      { backgroundColor: GOLD, borderColor: GOLD },
  dim:             { opacity: 0.35 },
  navTxt:          { fontSize: 15, fontFamily: FFB, color: '#fff' },
});
