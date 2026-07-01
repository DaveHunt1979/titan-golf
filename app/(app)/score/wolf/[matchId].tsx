import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../../src/lib/theme';

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

  if (loading) return <View style={s.centered}><ActivityIndicator color={colors.gold} size="large" /></View>;
  if (!match || !hole || !wolfId) return null;

  return (
    <View style={s.container}>
      <StatusBar style="light" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>← Back</Text></TouchableOpacity>
        <Text style={s.title}>WOLF</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Points tally */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tallyScroll}>
        <View style={s.tally}>
          {players.map(id => (
            <View key={id} style={[s.tallyItem, id === wolfId && s.tallyWolf]}>
              <Text style={s.tallyName}>{names[id] ?? '?'}{id === wolfId ? ' 🐺' : ''}</Text>
              <Text style={s.tallyPts}>{cumPoints[id] ?? 0}</Text>
              <Text style={s.tallyLbl}>PTS</Text>
            </View>
          ))}
        </View>
      </ScrollView>

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
            <TouchableOpacity key={pid} style={[s.partnerBtn, partnerId === pid && s.partnerBtnOn]} onPress={() => pickPartner(pid)} activeOpacity={0.8}>
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
            return (
              <View key={pid} style={s.playerRow}>
                <Text style={s.playerName}>{names[pid] ?? '?'}{pid === wolfId ? ' 🐺' : ''}</Text>
                <View style={s.stepper}>
                  <TouchableOpacity style={s.stepBtn} onPress={() => setPlayerScore(pid, sc - 1)} activeOpacity={0.7}><Text style={s.stepBtnTxt}>−</Text></TouchableOpacity>
                  <View style={[s.scoreDisp, sc < hole.par && s.birdie, sc > hole.par && s.bogey]}>
                    <Text style={s.scoreTxt}>{sc}</Text>
                  </View>
                  <TouchableOpacity style={s.stepBtn} onPress={() => setPlayerScore(pid, sc + 1)} activeOpacity={0.7}><Text style={s.stepBtnTxt}>+</Text></TouchableOpacity>
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
            {saving ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={[s.navTxt, { color: colors.bg }]}>{holeIdx === holes.length - 1 ? 'Finish →' : 'Next Hole →'}</Text>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:  { flex: 1, backgroundColor: colors.bg },
  centered:   { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  back:       { fontSize: fonts.sm, fontWeight: '600', color: colors.gold },
  title:      { fontSize: fonts.sm, fontWeight: '800', color: colors.white, letterSpacing: 2 },
  tallyScroll:{ maxHeight: 90, borderBottomWidth: 1, borderBottomColor: colors.border },
  tally:      { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, alignItems: 'center' },
  tallyItem:  { alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minWidth: 64 },
  tallyWolf:  { borderColor: colors.gold, backgroundColor: colors.goldDim },
  tallyName:  { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, marginBottom: 2 },
  tallyPts:   { fontSize: fonts.xl, fontWeight: '900', color: colors.gold },
  tallyLbl:   { fontSize: 8, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginTop: 1 },
  holeCard:   { alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  holeNum:    { fontSize: 28, fontWeight: '900', color: colors.white },
  holeMeta:   { fontSize: fonts.xs, color: colors.textMuted, fontWeight: '600', marginTop: 2 },
  wolfBadge:  { marginTop: spacing.xs, backgroundColor: colors.goldDim, borderRadius: radius.full, borderWidth: 1, borderColor: colors.goldBorder, paddingHorizontal: spacing.md, paddingVertical: 3 },
  wolfBadgeTxt:{ fontSize: fonts.xs, fontWeight: '800', color: colors.gold },
  pickWrap:   { padding: spacing.lg, gap: spacing.md },
  pickTitle:  { fontSize: fonts.sm, fontWeight: '700', color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.sm },
  loneBtn:    { backgroundColor: colors.goldDim, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.goldBorder, paddingVertical: spacing.md + 4, alignItems: 'center' },
  loneBtnTxt: { fontSize: fonts.md, fontWeight: '800', color: colors.gold },
  pickOr:     { fontSize: fonts.xs, color: colors.textMuted, textAlign: 'center', fontWeight: '600' },
  partnerBtn: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, alignItems: 'center' },
  partnerBtnOn:{ borderColor: colors.gold, backgroundColor: colors.goldDim },
  partnerBtnTxt:  { fontSize: fonts.md, fontWeight: '700', color: colors.textSecondary },
  partnerBtnTxtOn:{ color: colors.white },
  scoresWrap: { padding: spacing.lg, gap: spacing.lg },
  teamLabel:  { fontSize: fonts.xs, fontWeight: '700', color: colors.gold, textAlign: 'center', marginBottom: spacing.sm },
  playerRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  playerName: { fontSize: fonts.md, fontWeight: '800', color: colors.white, flex: 1 },
  stepper:    { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepBtn:    { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepBtnTxt: { fontSize: 22, fontWeight: '300', color: colors.white },
  scoreDisp:  { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderWidth: 2, borderColor: colors.border },
  birdie:     { borderColor: colors.green, backgroundColor: 'rgba(74,222,128,0.1)' },
  bogey:      { borderColor: colors.red, backgroundColor: 'rgba(248,113,113,0.1)' },
  scoreTxt:   { fontSize: 24, fontWeight: '900', color: colors.white },
  changeBtn:  { alignItems: 'center', paddingVertical: spacing.sm },
  changeBtnTxt:{ fontSize: fonts.xs, color: colors.textMuted, fontWeight: '600' },
  nav:        { padding: spacing.lg, paddingBottom: 40, borderTopWidth: 1, borderTopColor: colors.border },
  navBtn:     { backgroundColor: colors.gold, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  dim:        { opacity: 0.35 },
  navTxt:     { fontSize: fonts.md, fontWeight: '800', color: colors.white },
});
