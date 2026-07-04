import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../../src/lib/supabase';
import { calcStrokesReceived, calcStablefordPoints } from '../../../../src/lib/scoring';
import { speakPressure } from '../../../../src/lib/caddie';
import { colors, fonts, spacing, radius } from '../../../../src/lib/theme';

type HoleInfo = { hole_number: number; par: number; stroke_index: number; yardage?: number };
type SavedScore = { hole_number: number; gross: number; pts: number };

export default function SwindleScore() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const router = useRouter();
  const [game,        setGame]        = useState<any>(null);
  const [courseHoles, setCourseHoles] = useState<HoleInfo[]>([]);
  const [saved,       setSaved]       = useState<SavedScore[]>([]);
  const [myId,        setMyId]        = useState<string | null>(null);
  const [myHcp,       setMyHcp]       = useState(0);
  const [selected,    setSelected]    = useState<number | null>(null);
  const [saving,      setSaving]      = useState(false);
  const [loading,     setLoading]     = useState(true);

  const nextHole  = (() => { for (let h = 1; h <= 18; h++) { if (!saved.find(s => s.hole_number === h)) return h; } return 19; })();
  const isComplete = nextHole > 18;
  const courseHole = courseHoles.find(h => h.hole_number === nextHole);
  const shots      = courseHole ? calcStrokesReceived(myHcp, courseHole.stroke_index) : 0;
  const totalPts   = saved.reduce((s, h) => s + h.pts, 0);

  useEffect(() => { init(); }, [gameId]);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: p } = await supabase.from('players').select('id,handicap_index').eq('auth_uid', user.id).maybeSingle();
    if (!p) return;
    setMyId(p.id);
    setMyHcp(p.handicap_index ?? 0);

    const { data: g } = await supabase.from('swindle_games').select('*').eq('id', gameId).single();
    if (!g) return;
    setGame(g);

    if (g.course_name) {
      const { data: holes } = await supabase
        .from('course_holes')
        .select('hole_number,par,stroke_index,yardage')
        .eq('course_name', g.course_name)
        .order('hole_number');
      if (holes) setCourseHoles(holes);
    }

    const { data: scores } = await supabase
      .from('swindle_scores')
      .select('hole_number, gross_score, stableford_pts')
      .eq('game_id', gameId)
      .eq('player_id', p.id);
    if (scores) {
      setSaved(scores.map((s: any) => ({ hole_number: s.hole_number, gross: s.gross_score ?? 0, pts: s.stableford_pts ?? 0 })));
    }
    setLoading(false);
  }

  async function saveScore() {
    if (selected === null || !myId || !game || !courseHole) return;
    setSaving(true);
    const gross = selected;
    const pts   = calcStablefordPoints(gross, courseHole.par, shots);

    await supabase.from('swindle_scores').upsert({
      game_id: gameId, player_id: myId, hole_number: nextHole,
      gross_score: gross, stableford_pts: pts,
    }, { onConflict: 'game_id,player_id,hole_number' });

    const newSaved = [...saved.filter(s => s.hole_number !== nextHole), { hole_number: nextHole, gross, pts }];
    setSaved(newSaved);
    setSelected(null);
    setSaving(false);

    // Update game status to in_progress
    if (game.status === 'open') {
      await supabase.from('swindle_games').update({ status: 'in_progress' }).eq('id', gameId);
    }

    // Live Pressure at key holes
    if ([6, 9, 12, 15, 16, 17, 18].includes(nextHole)) {
      const { data: allScores } = await supabase
        .from('swindle_scores').select('player_id, stableford_pts').eq('game_id', gameId);
      const { data: entries } = await supabase
        .from('swindle_entries').select('player_id, players(display_name)').eq('game_id', gameId);
      if (allScores && entries) {
        const totals: Record<string, number> = {};
        for (const s of allScores as any[]) totals[s.player_id] = (totals[s.player_id] ?? 0) + (s.stableford_pts ?? 0);
        const standings = (entries as any[]).map(e => ({
          name: (e.players?.display_name ?? 'Player').split(' ')[0],
          pts: totals[e.player_id] ?? 0,
        })).sort((a, b) => b.pts - a.pts);
        speakPressure({ standings, holeNumber: nextHole, holesLeft: 18 - newSaved.length, format: 'stableford' });
      }
    }

    if (nextHole === 18) {
      Alert.alert('Round Complete!', `You scored ${totalPts + pts} points 🏆`, [
        { text: 'View Leaderboard', onPress: () => router.replace(`/(app)/swindle/${gameId}` as any) },
      ]);
    }
  }

  if (loading) return <View style={s.container}><Text style={s.loading}>Loading…</Text></View>;

  if (isComplete) {
    return (
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}><Text style={s.backText}>← Back</Text></TouchableOpacity>
        </View>
        <View style={s.doneWrap}>
          <Text style={s.doneEmoji}>🏆</Text>
          <Text style={s.doneTitle}>Round complete!</Text>
          <Text style={s.donePts}>{totalPts} points</Text>
          <TouchableOpacity style={s.lbBtn} onPress={() => router.replace(`/(app)/swindle/${gameId}` as any)}>
            <Text style={s.lbBtnText}>View Leaderboard</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.backText}>← Back</Text></TouchableOpacity>
        <Text style={s.headerTitle}>{game?.name}</Text>
        <Text style={s.headerPts}>{totalPts}pts</Text>
      </View>

      {/* Progress dots */}
      <View style={s.dotsRow}>
        {Array.from({ length: 18 }, (_, i) => {
          const sc = saved.find(s => s.hole_number === i + 1);
          const isDone   = !!sc;
          const isActive = i + 1 === nextHole;
          const ptColor  = !sc ? colors.cardAlt : sc.pts >= 4 ? 'rgba(212,175,55,0.8)' : sc.pts === 3 ? 'rgba(74,222,128,0.8)' : sc.pts === 2 ? colors.textSecondary : 'rgba(248,113,113,0.5)';
          return <View key={i} style={[s.dot, isDone && { backgroundColor: ptColor }, isActive && s.dotActive]} />;
        })}
      </View>

      {/* Hole card */}
      <View style={s.holeCard}>
        <Text style={s.holeLabel}>HOLE</Text>
        <Text style={s.holeBig}>{nextHole}</Text>
        {courseHole ? (
          <View style={s.holeMeta}>
            <MetaItem label="PAR" value={`${courseHole.par}`} />
            {courseHole.yardage ? <><View style={s.metaSep}/><MetaItem label="YARDS" value={`${courseHole.yardage}`} /></> : null}
            <View style={s.metaSep}/>
            <MetaItem label="S.I." value={`${courseHole.stroke_index}`} />
            {shots > 0 ? <><View style={s.metaSep}/><MetaItem label="SHOT" value="✓" gold /></> : null}
          </View>
        ) : (
          <Text style={s.noCourseTxt}>No course data</Text>
        )}
      </View>

      {/* Score grid */}
      <ScrollView contentContainerStyle={s.gridWrap} showsVerticalScrollIndicator={false}>
        <Text style={s.gridLabel}>SELECT SCORE</Text>
        <View style={s.grid}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map(n => {
            const pts = courseHole ? calcStablefordPoints(n, courseHole.par, shots) : 0;
            const isSelected = selected === n;
            const ptColor = pts >= 4 ? colors.gold : pts === 3 ? colors.green : pts === 2 ? colors.white : pts === 1 ? colors.textMuted : colors.red;
            return (
              <TouchableOpacity
                key={n}
                style={[s.scoreBtn, isSelected && s.scoreBtnActive]}
                onPress={() => setSelected(n)}
                activeOpacity={0.7}
              >
                <Text style={[s.scoreBtnNum, isSelected && s.scoreBtnNumActive]}>{n}</Text>
                {courseHole && <Text style={[s.scoreBtnPts, { color: isSelected ? colors.bg : ptColor }]}>{pts}pt{pts !== 1 ? 's' : ''}</Text>}
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={[s.saveBtn, (!selected || saving) && s.saveBtnDisabled]}
          onPress={saveScore}
          disabled={!selected || saving}
          activeOpacity={0.85}
        >
          <Text style={s.saveBtnText}>{saving ? 'Saving…' : `Save Hole ${nextHole}`}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function MetaItem({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={[s.metaValue, gold && { color: colors.gold }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: colors.bg, paddingTop: 56 },
  loading:         { color: colors.textMuted, textAlign: 'center', marginTop: 80 },
  header:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, marginBottom: spacing.md, gap: spacing.sm },
  backText:        { color: colors.gold, fontSize: fonts.md, fontWeight: '600' },
  headerTitle:     { flex: 1, fontSize: fonts.md, fontWeight: '700', color: colors.white, textAlign: 'center' },
  headerPts:       { fontSize: fonts.md, fontWeight: '800', color: colors.gold },
  dotsRow:         { flexDirection: 'row', gap: 4, paddingHorizontal: spacing.md, marginBottom: spacing.md, flexWrap: 'wrap' },
  dot:             { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.cardAlt },
  dotActive:       { borderWidth: 2, borderColor: colors.gold, backgroundColor: 'transparent' },
  holeCard:        { marginHorizontal: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  holeLabel:       { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 2, marginBottom: 4 },
  holeBig:         { fontSize: 72, fontWeight: '800', color: colors.white, lineHeight: 80 },
  holeMeta:        { flexDirection: 'row', gap: spacing.lg, alignItems: 'center', marginTop: spacing.sm },
  metaLabel:       { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1 },
  metaValue:       { fontSize: fonts.md, fontWeight: '700', color: colors.white },
  metaSep:         { width: 1, height: 24, backgroundColor: colors.border },
  noCourseTxt:     { color: colors.textMuted, fontSize: fonts.sm, marginTop: spacing.sm },
  gridWrap:        { paddingHorizontal: spacing.md, paddingBottom: 48 },
  gridLabel:       { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.sm },
  grid:            { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  scoreBtn:        { width: '30%', flexGrow: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  scoreBtnActive:  { backgroundColor: colors.gold, borderColor: colors.gold },
  scoreBtnNum:     { fontSize: fonts.xxl, fontWeight: '800', color: colors.white },
  scoreBtnNumActive: { color: colors.bg },
  scoreBtnPts:     { fontSize: fonts.xs, fontWeight: '700', marginTop: 2 },
  saveBtn:         { backgroundColor: colors.gold, borderRadius: radius.lg, paddingVertical: 16, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText:     { color: colors.bg, fontSize: fonts.lg, fontWeight: '800' },
  doneWrap:        { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  doneEmoji:       { fontSize: 64 },
  doneTitle:       { fontSize: fonts.xxl, fontWeight: '800', color: colors.white },
  donePts:         { fontSize: fonts.hero, fontWeight: '800', color: colors.gold },
  lbBtn:           { backgroundColor: colors.gold, borderRadius: radius.lg, paddingHorizontal: spacing.xl, paddingVertical: 14 },
  lbBtnText:       { color: colors.bg, fontWeight: '800', fontSize: fonts.lg },
});
