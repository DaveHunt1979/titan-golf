import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../../src/lib/theme';

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

  if (loading) return <View style={s.centered}><ActivityIndicator color={colors.gold} size="large" /></View>;
  if (!match || !hole) return null;

  return (
    <View style={s.container}>
      <StatusBar style="light" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>← Back</Text></TouchableOpacity>
        <Text style={s.title}>SKINS</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Skins tally */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tallyScroll}>
        <View style={s.tally}>
          {players.map(id => (
            <View key={id} style={s.tallyItem}>
              <Text style={s.tallyName}>{names[id] ?? '?'}</Text>
              <Text style={s.tallySkins}>{liveSkins[id] ?? 0}</Text>
              <Text style={s.tallyLbl}>SKINS</Text>
            </View>
          ))}
          {carryover > 0 && (
            <View style={[s.tallyItem, s.tallyCarry]}>
              <Text style={s.tallyName}>CARRY</Text>
              <Text style={s.tallySkins}>{carryover}</Text>
              <Text style={s.tallyLbl}>HOLES</Text>
            </View>
          )}
        </View>
      </ScrollView>

      <View style={s.holeCard}>
        <Text style={s.holeNum}>Hole {hole.hole_number}</Text>
        <Text style={s.holeMeta}>Par {hole.par}  ·  SI {hole.stroke_index}</Text>
      </View>

      {/* Per-player score entry */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.playersWrap}>
        {players.map(pid => {
          const sc = getScore(pid);
          return (
            <View key={pid} style={s.playerRow}>
              <Text style={s.playerName}>{names[pid] ?? '?'}</Text>
              <View style={s.stepper}>
                <TouchableOpacity style={s.stepBtn} onPress={() => setPlayerScore(pid, sc - 1)} activeOpacity={0.7}><Text style={s.stepBtnTxt}>−</Text></TouchableOpacity>
                <View style={[s.scoreDisp, sc < hole.par && s.birdie, sc === hole.par && s.par, sc > hole.par && s.bogey]}>
                  <Text style={s.scoreTxt}>{sc}</Text>
                </View>
                <TouchableOpacity style={s.stepBtn} onPress={() => setPlayerScore(pid, sc + 1)} activeOpacity={0.7}><Text style={s.stepBtnTxt}>+</Text></TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={s.nav}>
        <TouchableOpacity style={[s.navBtn, holeIdx === 0 && s.dim]} onPress={async () => { await save(); setHoleIdx(Math.max(0, holeIdx - 1)); }} disabled={holeIdx === 0 || saving} activeOpacity={0.7}>
          <Text style={s.navTxt}>← Prev</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.navBtn, s.navPrimary, saving && s.dim]} onPress={next} disabled={saving} activeOpacity={0.8}>
          {saving ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={[s.navTxt, { color: colors.bg }]}>{holeIdx === holes.length - 1 ? 'Finish →' : 'Next →'}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  back:      { fontSize: fonts.sm, fontWeight: '600', color: colors.gold },
  title:     { fontSize: fonts.sm, fontWeight: '800', color: colors.white, letterSpacing: 2 },
  tallyScroll: { maxHeight: 90, borderBottomWidth: 1, borderBottomColor: colors.border },
  tally:     { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, alignItems: 'center' },
  tallyItem: { alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minWidth: 70 },
  tallyCarry:{ borderColor: colors.goldBorder, backgroundColor: colors.goldDim },
  tallyName: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, marginBottom: 2 },
  tallySkins:{ fontSize: fonts.xl, fontWeight: '900', color: colors.gold },
  tallyLbl:  { fontSize: 8, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginTop: 1 },
  holeCard:  { alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  holeNum:   { fontSize: 28, fontWeight: '900', color: colors.white },
  holeMeta:  { fontSize: fonts.xs, color: colors.textMuted, fontWeight: '600', marginTop: 2 },
  playersWrap:{ padding: spacing.lg, gap: spacing.lg },
  playerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  playerName:{ fontSize: fonts.md, fontWeight: '800', color: colors.white, flex: 1 },
  stepper:   { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepBtn:   { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepBtnTxt:{ fontSize: 22, fontWeight: '300', color: colors.white },
  scoreDisp: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderWidth: 2, borderColor: colors.border },
  birdie:    { borderColor: colors.green, backgroundColor: 'rgba(74,222,128,0.1)' },
  par:       {},
  bogey:     { borderColor: colors.red, backgroundColor: 'rgba(248,113,113,0.1)' },
  scoreTxt:  { fontSize: 24, fontWeight: '900', color: colors.white },
  nav:       { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, paddingBottom: 40, borderTopWidth: 1, borderTopColor: colors.border },
  navBtn:    { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  navPrimary:{ backgroundColor: colors.gold, borderColor: colors.gold },
  dim:       { opacity: 0.35 },
  navTxt:    { fontSize: fonts.md, fontWeight: '800', color: colors.white },
});
