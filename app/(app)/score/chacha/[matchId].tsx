import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../../src/lib/theme';
import { calcCourseHandicap, calcStrokesReceived, calcStablefordPoints } from '../../../../src/lib/scoring';

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

  if (loading) return <View style={s.centered}><ActivityIndicator color={colors.gold} size="large" /></View>;
  if (!match || !hole) return null;

  return (
    <View style={s.container}>
      <StatusBar style="light" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>← Back</Text></TouchableOpacity>
        <Text style={s.title}>CHA CHA CHA</Text>
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
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Text style={s.playerName}>{p.name}</Text>
                  {isCounting && <View style={s.countingBadge}><Text style={s.countingTxt}>COUNTING</Text></View>}
                </View>
                <Text style={s.playerSub}>
                  {str > 0 ? `+${str} stroke${str > 1 ? 's' : ''}` : 'Scratch'}
                  {'  ·  '}
                  <Text style={{ color: pts >= 3 ? colors.gold : pts === 0 ? colors.red : colors.textSecondary }}>
                    {pts} pts
                  </Text>
                </Text>
              </View>
              <View style={s.stepper}>
                <TouchableOpacity style={s.stepBtn} onPress={() => setPlayerScore(p.id, sc - 1)} activeOpacity={0.7}><Text style={s.stepBtnTxt}>−</Text></TouchableOpacity>
                <View style={[s.scoreDisp,
                  sc < hole.par && s.birdie,
                  sc === hole.par && s.par,
                  sc > hole.par && s.bogey,
                  isCounting && s.scoreDispCounting,
                ]}>
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
  container:    { flex: 1, backgroundColor: colors.bg },
  centered:     { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  back:         { fontSize: fonts.sm, fontWeight: '600', color: colors.gold },
  title:        { fontSize: fonts.sm, fontWeight: '800', color: colors.white, letterSpacing: 2 },
  teamRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  teamTotal:    { alignItems: 'center' },
  teamPts:      { fontSize: 40, fontWeight: '900', color: colors.gold },
  teamLbl:      { fontSize: 9, fontWeight: '800', color: colors.textMuted, letterSpacing: 1, marginTop: -4 },
  holeBadge:    { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.goldBorder, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, alignItems: 'center' },
  holeBadgeTxt: { fontSize: fonts.lg, fontWeight: '900', color: colors.gold },
  holeBadgeSub: { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1 },
  holeCard:     { alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  holeNum:      { fontSize: 28, fontWeight: '900', color: colors.white },
  holeMeta:     { fontSize: fonts.xs, color: colors.textMuted, fontWeight: '600', marginTop: 2 },
  playersWrap:  { padding: spacing.lg, gap: spacing.md },
  playerRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  playerRowCounting: { borderColor: colors.goldBorder, backgroundColor: colors.goldDim },
  playerName:   { fontSize: fonts.md, fontWeight: '800', color: colors.white },
  playerSub:    { fontSize: fonts.xs, color: colors.textMuted, marginTop: 3 },
  countingBadge:{ backgroundColor: colors.gold, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  countingTxt:  { fontSize: 8, fontWeight: '900', color: colors.bg, letterSpacing: 0.5 },
  stepper:      { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepBtn:      { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepBtnTxt:   { fontSize: 20, fontWeight: '300', color: colors.white },
  scoreDisp:    { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardAlt, borderWidth: 2, borderColor: colors.border },
  scoreDispCounting: { borderColor: colors.gold },
  birdie:       { borderColor: colors.green, backgroundColor: 'rgba(74,222,128,0.1)' },
  par:          {},
  bogey:        { borderColor: colors.red, backgroundColor: 'rgba(248,113,113,0.1)' },
  scoreTxt:     { fontSize: 22, fontWeight: '900', color: colors.white },
  nav:          { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, paddingBottom: 40, borderTopWidth: 1, borderTopColor: colors.border },
  navBtn:       { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  navPrimary:   { backgroundColor: colors.gold, borderColor: colors.gold },
  dim:          { opacity: 0.35 },
  navTxt:       { fontSize: fonts.md, fontWeight: '800', color: colors.white },
});
