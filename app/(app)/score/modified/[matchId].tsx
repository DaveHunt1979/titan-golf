import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../../src/lib/theme';
import { calcCourseHandicap, calcStrokesReceived } from '../../../../src/lib/scoring';

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

  if (loading) return <View style={s.centered}><ActivityIndicator color={colors.gold} size="large" /></View>;
  if (!match || !hole) return null;

  return (
    <View style={s.container}>
      <StatusBar style="light" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>← Back</Text></TouchableOpacity>
        <Text style={s.title}>MODIFIED STABLEFORD</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tallyScroll}>
        <View style={s.tally}>
          {players.map(p => {
            const t = runTotals[p.id] ?? 0;
            return (
              <View key={p.id} style={s.tallyItem}>
                <Text style={s.tallyName}>{p.name}</Text>
                <Text style={[s.tallyPts, { color: t > 0 ? colors.gold : t < 0 ? colors.red : colors.white }]}>
                  {t > 0 ? '+' : ''}{t}
                </Text>
                <Text style={s.tallyLbl}>PTS</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={s.holeCard}>
        <Text style={s.holeNum}>Hole {hole.hole_number}</Text>
        <Text style={s.holeMeta}>Par {hole.par}  ·  SI {hole.stroke_index}</Text>
      </View>

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
                  <Text style={{ color: pts >= 4 ? colors.gold : pts < 0 ? colors.red : pts === 2 ? colors.green : colors.textSecondary }}>
                    {ptLabel(pts)}
                  </Text>
                </Text>
              </View>
              <View style={s.stepper}>
                <TouchableOpacity style={s.stepBtn} onPress={() => setPlayerScore(p.id, sc - 1)} activeOpacity={0.7}><Text style={s.stepBtnTxt}>−</Text></TouchableOpacity>
                <View style={[s.scoreDisp, pts >= 8 && s.eagle, pts === 4 && s.birdie, pts === 2 && s.par, pts < 0 && s.bad]}>
                  <Text style={s.scoreTxt}>{sc}</Text>
                </View>
                <TouchableOpacity style={s.stepBtn} onPress={() => setPlayerScore(p.id, sc + 1)} activeOpacity={0.7}><Text style={s.stepBtnTxt}>+</Text></TouchableOpacity>
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
  container:  { flex: 1, backgroundColor: colors.bg },
  centered:   { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  back:       { fontSize: fonts.sm, fontWeight: '600', color: colors.gold },
  title:      { fontSize: 9, fontWeight: '800', color: colors.white, letterSpacing: 1 },
  tallyScroll:{ maxHeight: 90, borderBottomWidth: 1, borderBottomColor: colors.border },
  tally:      { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, alignItems: 'center' },
  tallyItem:  { alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minWidth: 70 },
  tallyName:  { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, marginBottom: 2 },
  tallyPts:   { fontSize: fonts.xl, fontWeight: '900' },
  tallyLbl:   { fontSize: 8, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginTop: 1 },
  holeCard:   { alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  holeNum:    { fontSize: 28, fontWeight: '900', color: colors.white },
  holeMeta:   { fontSize: fonts.xs, color: colors.textMuted, fontWeight: '600', marginTop: 2 },
  playersWrap:{ padding: spacing.lg, gap: spacing.lg },
  playerRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  playerName: { fontSize: fonts.md, fontWeight: '800', color: colors.white },
  playerSub:  { fontSize: fonts.xs, color: colors.textMuted, marginTop: 3 },
  stepper:    { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepBtn:    { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepBtnTxt: { fontSize: 22, fontWeight: '300', color: colors.white },
  scoreDisp:  { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderWidth: 2, borderColor: colors.border },
  eagle:      { borderColor: colors.gold, backgroundColor: colors.goldDim },
  birdie:     { borderColor: colors.green, backgroundColor: 'rgba(74,222,128,0.1)' },
  par:        {},
  bad:        { borderColor: colors.red, backgroundColor: 'rgba(248,113,113,0.1)' },
  scoreTxt:   { fontSize: 24, fontWeight: '900', color: colors.white },
  nav:        { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, paddingBottom: 40, borderTopWidth: 1, borderTopColor: colors.border },
  navBtn:     { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  navPrimary: { backgroundColor: colors.gold, borderColor: colors.gold },
  dim:        { opacity: 0.35 },
  navTxt:     { fontSize: fonts.md, fontWeight: '800', color: colors.white },
});
