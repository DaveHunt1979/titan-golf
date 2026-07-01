import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../../src/lib/theme';

interface CourseHole { hole_number: number; par: number; stroke_index: number; }
interface Match { id: string; status: string; home_player_ids: string[]; day: { course_name: string } | null; }

export default function ScrambleScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const [match, setMatch]         = useState<Match | null>(null);
  const [holes, setHoles]         = useState<CourseHole[]>([]);
  const [names, setNames]         = useState<Record<string, string>>({});
  const [scores, setScores]       = useState<Record<number, number>>({});
  const [holeIdx, setHoleIdx]     = useState(0);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);

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
    const { data: ex } = await supabase.from('match_holes').select('hole_number,gross_score,player_id').eq('match_id', matchId);
    if (ex && (m as any).home_player_ids[0]) {
      const firstPid = (m as any).home_player_ids[0];
      const sc: Record<number,number> = {};
      (ex as any[]).filter(r => r.player_id === firstPid && r.gross_score != null).forEach(r => { sc[r.hole_number] = r.gross_score; });
      setScores(sc);
    }
    setLoading(false);
  }

  const hole = holes[holeIdx];
  const score = hole ? (scores[hole.hole_number] ?? hole.par) : 0;
  const setScore = (v: number) => { if (!hole) return; setScores(p => ({ ...p, [hole.hole_number]: Math.max(1, v) })); };

  async function save() {
    if (!match || !hole || saving) return;
    setSaving(true);
    const g = scores[hole.hole_number] ?? hole.par;
    for (const pid of match.home_player_ids) {
      await supabase.from('match_holes').upsert({ match_id: matchId, player_id: pid, hole_number: hole.hole_number, gross_score: g }, { onConflict: 'match_id,player_id,hole_number' });
    }
    setSaving(false);
  }

  async function next() {
    await save();
    if (holeIdx < holes.length - 1) { setHoleIdx(holeIdx + 1); return; }
    await supabase.from('matches').update({ status: 'complete' }).eq('id', matchId);
    const totalGross = holes.reduce((s, h) => s + (scores[h.hole_number] ?? h.par), 0);
    const par = holes.reduce((s, h) => s + h.par, 0);
    const d = totalGross - par;
    Alert.alert('Round Complete!', `Team: ${totalGross} (${d === 0 ? 'E' : d > 0 ? `+${d}` : d})`, [{ text: 'Done', onPress: () => router.back() }]);
  }

  const runGross = holes.slice(0, holeIdx + 1).reduce((s, h) => s + (scores[h.hole_number] ?? 0), 0);
  const runPar   = holes.slice(0, holeIdx + 1).reduce((s, h) => s + h.par, 0);
  const runDiff  = runGross - runPar;

  if (loading) return <View style={s.centered}><ActivityIndicator color={colors.gold} size="large" /></View>;
  if (!match || !hole) return null;

  return (
    <View style={s.container}>
      <StatusBar style="light" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>← Back</Text></TouchableOpacity>
        <Text style={s.title}>SCRAMBLE</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={s.summaryCard}>
        <Text style={s.teamLabel}>{match.home_player_ids.map(id => names[id] ?? '?').join(' · ')}</Text>
        <View style={s.summaryRow}>
          {[
            { v: runGross || '—', l: 'GROSS' },
            { v: runGross === 0 ? '—' : runDiff === 0 ? 'E' : runDiff > 0 ? `+${runDiff}` : `${runDiff}`, l: 'TO PAR', color: runDiff < 0 ? colors.green : runDiff > 0 ? colors.red : colors.white },
            { v: holeIdx + 1, l: 'HOLE' },
          ].map(item => (
            <View key={item.l} style={s.summaryItem}>
              <Text style={[s.summaryVal, item.color ? { color: item.color } : undefined]}>{item.v}</Text>
              <Text style={s.summaryLbl}>{item.l}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={s.holeCard}>
        <Text style={s.holeNum}>Hole {hole.hole_number}</Text>
        <Text style={s.holeMeta}>Par {hole.par}  ·  SI {hole.stroke_index}</Text>
      </View>

      <View style={s.stepperWrap}>
        <Text style={s.stepperLbl}>TEAM SCORE</Text>
        <View style={s.stepper}>
          <TouchableOpacity style={s.stepBtn} onPress={() => setScore(score - 1)} activeOpacity={0.7}><Text style={s.stepBtnTxt}>−</Text></TouchableOpacity>
          <View style={[s.scoreDisp, score < hole.par && s.birdie, score === hole.par && s.par, score > hole.par && s.bogey]}>
            <Text style={s.scoreTxt}>{score}</Text>
            <Text style={s.scoreDiff}>{score === hole.par ? 'PAR' : score < hole.par ? `${score - hole.par}` : `+${score - hole.par}`}</Text>
          </View>
          <TouchableOpacity style={s.stepBtn} onPress={() => setScore(score + 1)} activeOpacity={0.7}><Text style={s.stepBtnTxt}>+</Text></TouchableOpacity>
        </View>
      </View>

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
  summaryCard: { margin: spacing.lg, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  teamLabel:   { fontSize: fonts.xs, color: colors.textMuted, fontWeight: '600', marginBottom: spacing.sm, textAlign: 'center' },
  summaryRow:  { flexDirection: 'row', justifyContent: 'space-around' },
  summaryItem: { alignItems: 'center' },
  summaryVal:  { fontSize: fonts.xl, fontWeight: '900', color: colors.white },
  summaryLbl:  { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginTop: 2 },
  holeCard:  { alignItems: 'center', paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  holeNum:   { fontSize: 36, fontWeight: '900', color: colors.white },
  holeMeta:  { fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600', marginTop: 4 },
  stepperWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stepperLbl:  { fontSize: fonts.xs, fontWeight: '800', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.lg },
  stepper:   { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  stepBtn:   { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepBtnTxt:{ fontSize: 28, fontWeight: '300', color: colors.white },
  scoreDisp: { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderWidth: 2, borderColor: colors.border },
  birdie:    { borderColor: colors.green, backgroundColor: 'rgba(74,222,128,0.1)' },
  par:       {},
  bogey:     { borderColor: colors.red, backgroundColor: 'rgba(248,113,113,0.1)' },
  scoreTxt:  { fontSize: 40, fontWeight: '900', color: colors.white },
  scoreDiff: { fontSize: 10, fontWeight: '800', color: colors.textMuted, marginTop: -4 },
  nav:       { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, paddingBottom: 40, borderTopWidth: 1, borderTopColor: colors.border },
  navBtn:    { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  navPrimary:{ backgroundColor: colors.gold, borderColor: colors.gold },
  dim:       { opacity: 0.35 },
  navTxt:    { fontSize: fonts.md, fontWeight: '800', color: colors.white },
});
