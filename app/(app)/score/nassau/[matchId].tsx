import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../../src/lib/theme';

interface CourseHole { hole_number: number; par: number; stroke_index: number; }
interface Match { id: string; home_player_ids: string[]; away_player_ids: string[]; day: { course_name: string } | null; }

// Nassau: compare gross scores between home and away per hole
// Returns: front diff (holes 1-9), back diff (holes 10-18), total diff
function nassauCalc(homeIds: string[], awayIds: string[], scores: Record<string, Record<number, number>>, holes: CourseHole[]) {
  let front = 0, back = 0;
  for (const hole of holes) {
    const homeScore = Math.min(...homeIds.map(id => scores[id]?.[hole.hole_number] ?? 99));
    const awayScore = Math.min(...awayIds.map(id => scores[id]?.[hole.hole_number] ?? 99));
    if (homeScore === 99 || awayScore === 99) continue;
    const diff = homeScore < awayScore ? -1 : homeScore > awayScore ? 1 : 0;
    if (hole.hole_number <= 9) front += diff;
    else back += diff;
  }
  return { front, back, total: front + back };
}

function betLabel(diff: number, homeLabel: string, awayLabel: string) {
  if (diff === 0) return 'A/S';
  const lead = Math.abs(diff);
  return diff < 0 ? `${homeLabel} ${lead}UP` : `${awayLabel} ${lead}UP`;
}

export default function NassauScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const [match, setMatch]     = useState<Match | null>(null);
  const [holes, setHoles]     = useState<CourseHole[]>([]);
  const [names, setNames]     = useState<Record<string, string>>({});
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
    const allIds = [...((m as any).home_player_ids ?? []), ...((m as any).away_player_ids ?? [])];
    if (allIds.length) {
      const { data: p } = await supabase.from('players').select('id,display_name').in('id', allIds);
      if (p) { const n: Record<string,string> = {}; (p as any[]).forEach(x => n[x.id] = x.display_name.split(' ')[0]); setNames(n); }
    }
    const { data: ex } = await supabase.from('match_holes').select('player_id,hole_number,gross_score').eq('match_id', matchId);
    if (ex) {
      const sc: Record<string, Record<number, number>> = {};
      allIds.forEach((id: string) => { sc[id] = {}; });
      (ex as any[]).forEach(r => { if (r.gross_score != null) { if (!sc[r.player_id]) sc[r.player_id] = {}; sc[r.player_id][r.hole_number] = r.gross_score; } });
      setScores(sc);
    }
    setLoading(false);
  }

  const hole = holes[holeIdx];
  const allPlayers = [...(match?.home_player_ids ?? []), ...(match?.away_player_ids ?? [])];

  function getScore(pid: string) { return hole ? (scores[pid]?.[hole.hole_number] ?? hole.par) : 0; }
  function setPlayerScore(pid: string, v: number) {
    if (!hole) return;
    setScores(prev => ({ ...prev, [pid]: { ...(prev[pid] ?? {}), [hole.hole_number]: Math.max(1, v) } }));
  }

  async function save() {
    if (!match || !hole || saving) return;
    setSaving(true);
    for (const pid of allPlayers) {
      const g = scores[pid]?.[hole.hole_number] ?? hole.par;
      await supabase.from('match_holes').upsert({ match_id: matchId, player_id: pid, hole_number: hole.hole_number, gross_score: g }, { onConflict: 'match_id,player_id,hole_number' });
    }
    setSaving(false);
  }

  async function next() {
    await save();
    if (holeIdx < holes.length - 1) { setHoleIdx(holeIdx + 1); return; }
    if (!match) return;
    await supabase.from('matches').update({ status: 'complete' }).eq('id', matchId);
    const { front, back, total } = nassauCalc(match.home_player_ids, match.away_player_ids, scores, holes);
    const hn = match.home_player_ids.map(id => names[id] ?? '?').join(' & ');
    const an = match.away_player_ids.map(id => names[id] ?? '?').join(' & ');
    const msg = `Front: ${betLabel(front, hn, an)}\nBack: ${betLabel(back, hn, an)}\nTotal: ${betLabel(total, hn, an)}`;
    Alert.alert('Nassau Complete!', msg, [{ text: 'Done', onPress: () => router.back() }]);
  }

  const { front, back, total } = match
    ? nassauCalc(match.home_player_ids, match.away_player_ids, scores, holes.slice(0, holeIdx))
    : { front: 0, back: 0, total: 0 };

  const homeLabel = match?.home_player_ids.map(id => names[id] ?? '?').join(' & ') ?? 'Home';
  const awayLabel = match?.away_player_ids.map(id => names[id] ?? '?').join(' & ') ?? 'Away';

  if (loading) return <View style={s.centered}><ActivityIndicator color={colors.gold} size="large" /></View>;
  if (!match || !hole) return null;

  return (
    <View style={s.container}>
      <StatusBar style="light" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>← Back</Text></TouchableOpacity>
        <Text style={s.title}>NASSAU</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* 3 bets */}
      <View style={s.bets}>
        {[
          { label: 'FRONT 9', value: betLabel(front, homeLabel, awayLabel) },
          { label: 'BACK 9',  value: betLabel(back, homeLabel, awayLabel) },
          { label: 'OVERALL', value: betLabel(total, homeLabel, awayLabel) },
        ].map(b => (
          <View key={b.label} style={s.bet}>
            <Text style={s.betLabel}>{b.label}</Text>
            <Text style={s.betValue} numberOfLines={2}>{b.value}</Text>
          </View>
        ))}
      </View>

      <View style={s.matchupRow}>
        <Text style={s.matchupName}>{homeLabel}</Text>
        <Text style={s.vs}>VS</Text>
        <Text style={s.matchupName}>{awayLabel}</Text>
      </View>

      <View style={s.holeCard}>
        <Text style={s.holeNum}>Hole {hole.hole_number}</Text>
        <Text style={s.holeMeta}>Par {hole.par}  ·  SI {hole.stroke_index}</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.playersWrap}>
        {allPlayers.map(pid => {
          const isHome = match.home_player_ids.includes(pid);
          const sc = getScore(pid);
          return (
            <View key={pid} style={s.playerRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.playerName}>{names[pid] ?? '?'}</Text>
                <Text style={[s.playerSide, { color: isHome ? colors.green : colors.red }]}>{isHome ? 'HOME' : 'AWAY'}</Text>
              </View>
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
  bets:      { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  bet:       { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRightWidth: 1, borderRightColor: colors.border },
  betLabel:  { fontSize: 8, fontWeight: '800', color: colors.textMuted, letterSpacing: 1, marginBottom: 3 },
  betValue:  { fontSize: fonts.xs, fontWeight: '800', color: colors.gold, textAlign: 'center' },
  matchupRow:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  matchupName:{ fontSize: fonts.xs, fontWeight: '700', color: colors.textSecondary, flex: 1 },
  vs:        { fontSize: fonts.xs, fontWeight: '900', color: colors.textMuted, marginHorizontal: spacing.sm },
  holeCard:  { alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  holeNum:   { fontSize: 28, fontWeight: '900', color: colors.white },
  holeMeta:  { fontSize: fonts.xs, color: colors.textMuted, fontWeight: '600', marginTop: 2 },
  playersWrap:{ padding: spacing.lg, gap: spacing.lg },
  playerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  playerName:{ fontSize: fonts.md, fontWeight: '800', color: colors.white },
  playerSide:{ fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  stepper:   { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepBtn:   { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepBtnTxt:{ fontSize: 22, fontWeight: '300', color: colors.white },
  scoreDisp: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderWidth: 2, borderColor: colors.border },
  birdie:    { borderColor: colors.green, backgroundColor: 'rgba(74,222,128,0.1)' },
  bogey:     { borderColor: colors.red, backgroundColor: 'rgba(248,113,113,0.1)' },
  scoreTxt:  { fontSize: 24, fontWeight: '900', color: colors.white },
  nav:       { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, paddingBottom: 40, borderTopWidth: 1, borderTopColor: colors.border },
  navBtn:    { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  navPrimary:{ backgroundColor: colors.gold, borderColor: colors.gold },
  dim:       { opacity: 0.35 },
  navTxt:    { fontSize: fonts.md, fontWeight: '800', color: colors.white },
});
