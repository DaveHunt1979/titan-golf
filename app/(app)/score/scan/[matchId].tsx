import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, TextInput, Alert, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../../src/lib/theme';
import { useDynamicColors } from '../../../../src/lib/SocietyThemeContext';
import { scanPlayerScoresFromCamera, scanPlayerScoresFromLibrary } from '../../../../src/lib/scanScorecard';
import { calcStrokesReceived, calcStablefordPoints } from '../../../../src/lib/scoring';

interface CourseHole { hole_number: number; par: number; stroke_index: number; }
interface HoleScore  { hole: number; gross: number | null; }

type Step = 'scan' | 'review';

export default function ScanMatchScorecardScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const colors = useDynamicColors();

  const [step, setStep]           = useState<Step>('scan');
  const [scanning, setScanning]   = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [myPlayerId,  setMyPlayerId]  = useState<string | null>(null);
  const [myHandicap,  setMyHandicap]  = useState<number>(0);
  const [courseName,  setCourseName]  = useState<string | null>(null);
  const [courseHoles, setCourseHoles] = useState<CourseHole[]>([]);
  const [matchFormat, setMatchFormat] = useState<string | null>(null);

  const [scores, setScores] = useState<HoleScore[]>(
    Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, gross: null }))
  );

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: p } = await supabase.from('players')
        .select('id, handicap_index')
        .eq('auth_uid', user.id)
        .single();
      if (!p) return;

      setMyPlayerId((p as any).id);
      setMyHandicap(Math.round((p as any).handicap_index ?? 0));

      const { data: m } = await supabase.from('matches')
        .select('round_format, day:day_id(course_name)')
        .eq('id', matchId)
        .single();
      if (!m) return;

      const cn = (m as any).day?.course_name ?? null;
      setCourseName(cn);
      setMatchFormat((m as any).round_format ?? null);

      if (cn) {
        const { data: holes } = await supabase.from('course_holes')
          .select('hole_number, par, stroke_index')
          .eq('course_name', cn)
          .order('hole_number');
        if (holes) setCourseHoles(holes as CourseHole[]);
      }
    })();
  }, [matchId]);

  async function doScan(fromCamera: boolean) {
    setScanning(true);
    try {
      const result = fromCamera
        ? await scanPlayerScoresFromCamera()
        : await scanPlayerScoresFromLibrary();
      const merged = Array.from({ length: 18 }, (_, i) => {
        const found = result.find(r => r.hole === i + 1);
        return { hole: i + 1, gross: found?.gross ?? null };
      });
      setScores(merged);
      setStep('review');
    } catch (e: any) {
      Alert.alert('Scan failed', e.message ?? 'Try a clearer photo');
    } finally {
      setScanning(false);
    }
  }

  function updateScore(hole: number, val: string) {
    const n = parseInt(val, 10);
    setScores(prev => prev.map(s => s.hole === hole ? { ...s, gross: isNaN(n) ? null : n } : s));
  }

  function stablefordForHole(hole: number, gross: number | null): number {
    const ch = courseHoles.find(h => h.hole_number === hole);
    if (!ch || gross === null) return 0;
    const shots = calcStrokesReceived(myHandicap, ch.stroke_index);
    return calcStablefordPoints(gross, ch.par, shots);
  }

  function parForHole(hole: number): number {
    return courseHoles.find(h => h.hole_number === hole)?.par ?? 4;
  }

  const totalGross = scores.reduce((s, h) => s + (h.gross ?? 0), 0);
  const totalPts   = scores.reduce<number>((s, h) => s + stablefordForHole(h.hole, h.gross), 0);
  const totalPar   = courseHoles.reduce((s, h) => s + h.par, 0);
  const toPar      = totalGross > 0 && totalPar > 0 ? totalGross - totalPar : null;

  async function submit() {
    if (!myPlayerId) return;
    const filled = scores.filter(s => s.gross !== null);
    if (filled.length < 9) {
      Alert.alert('Not enough holes', 'Please fill in at least 9 holes before submitting.');
      return;
    }
    setSubmitting(true);
    try {
      const rows = scores
        .filter(s => s.gross !== null)
        .map(s => {
          const ch  = courseHoles.find(h => h.hole_number === s.hole);
          const par = ch?.par ?? 4;
          const si  = ch?.stroke_index ?? s.hole;
          const shots = calcStrokesReceived(myHandicap, si);
          const pts   = calcStablefordPoints(s.gross, par, shots);
          return {
            match_id:      matchId,
            player_id:     myPlayerId,
            hole_number:   s.hole,
            gross_score:   s.gross,
            net_score:     (s.gross ?? 0) - shots,
            stableford_pts: pts,
          };
        });

      const { error } = await supabase.from('match_holes')
        .upsert(rows, { onConflict: 'match_id,player_id,hole_number' });
      if (error) throw new Error(error.message);

      await supabase.from('matches')
        .update({ status: 'in_progress' })
        .eq('id', matchId)
        .eq('status', 'upcoming');

      Alert.alert('Submitted!', 'Your scores have been saved.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save scores');
    } finally {
      setSubmitting(false);
    }
  }

  const dyn = useDynamicColors();

  return (
    <View style={[s.container, { backgroundColor: dyn.bg }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { borderBottomColor: dyn.border }]}>
        <TouchableOpacity onPress={() => step === 'review' ? setStep('scan') : router.back()} hitSlop={{ top:10,bottom:10,left:10,right:10 }}>
          <Text style={[s.back, { color: dyn.textMuted }]}>‹ {step === 'review' ? 'Back' : 'Cancel'}</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: dyn.white }]}>Scan Scorecard</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* ── Step: Scan ── */}
      {step === 'scan' && (
        <View style={s.scanStep}>
          <Text style={s.scanIcon}>📋</Text>
          <Text style={[s.scanHeading, { color: dyn.white }]}>Scan Your Paper Scorecard</Text>
          <Text style={[s.scanSub, { color: dyn.textMuted }]}>
            Take a photo of your completed scorecard or choose one from your library. The AI will extract your gross scores.
          </Text>
          {scanning ? (
            <View style={s.scanningWrap}>
              <ActivityIndicator color={dyn.gold} size="large" />
              <Text style={[s.scanningText, { color: dyn.textMuted }]}>Reading your scorecard…</Text>
            </View>
          ) : (
            <View style={s.scanBtns}>
              <TouchableOpacity style={[s.scanBtn, { backgroundColor: dyn.gold }]} onPress={() => doScan(true)} activeOpacity={0.85}>
                <Text style={[s.scanBtnText, { color: dyn.bg }]}>📷  Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.scanBtn, { backgroundColor: dyn.card, borderWidth: 1, borderColor: dyn.border }]} onPress={() => doScan(false)} activeOpacity={0.85}>
                <Text style={[s.scanBtnText, { color: dyn.white }]}>🖼  Choose from Library</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setStep('review')} activeOpacity={0.7} style={{ marginTop: spacing.sm }}>
                <Text style={[s.manualLink, { color: dyn.textMuted }]}>Enter scores manually instead</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* ── Step: Review ── */}
      {step === 'review' && (
        <>
          <ScrollView contentContainerStyle={s.reviewScroll} showsVerticalScrollIndicator={false}>
            {courseName && (
              <Text style={[s.courseName, { color: dyn.textMuted }]}>{courseName}</Text>
            )}

            {/* Hole grid */}
            <View style={[s.gridHeader, { backgroundColor: dyn.card, borderColor: dyn.border }]}>
              <Text style={[s.gridHdr, { color: dyn.textMuted, flex: 1 }]}>HOLE</Text>
              <Text style={[s.gridHdr, { color: dyn.textMuted, width: 36 }]}>PAR</Text>
              <Text style={[s.gridHdr, { color: dyn.textMuted, width: 52 }]}>GROSS</Text>
              <Text style={[s.gridHdr, { color: dyn.textMuted, width: 44 }]}>PTS</Text>
            </View>

            {scores.map(({ hole, gross }) => {
              const par = parForHole(hole);
              const pts = stablefordForHole(hole, gross);
              const diff = gross !== null ? gross - par : null;
              const grossColor = diff === null ? dyn.textMuted
                : diff <= -2 ? '#f59e0b'
                : diff === -1 ? '#22c55e'
                : diff === 0  ? dyn.white
                : diff === 1  ? '#f97316'
                : '#ef4444';
              return (
                <View key={hole} style={[s.gridRow, { borderBottomColor: dyn.border }]}>
                  <Text style={[s.gridCell, { color: dyn.textSecondary, flex: 1 }]}>{hole}</Text>
                  <Text style={[s.gridCell, { color: dyn.textMuted, width: 36 }]}>{par}</Text>
                  <TextInput
                    style={[s.gridInput, { color: grossColor, borderColor: dyn.border, backgroundColor: dyn.card }]}
                    value={gross !== null ? String(gross) : ''}
                    onChangeText={v => updateScore(hole, v)}
                    keyboardType="number-pad"
                    maxLength={2}
                    placeholder="—"
                    placeholderTextColor={dyn.textMuted}
                  />
                  <Text style={[s.gridCell, { color: pts > 0 ? dyn.gold : dyn.textMuted, width: 44, fontWeight: '700' }]}>
                    {gross !== null ? pts : '—'}
                  </Text>
                </View>
              );
            })}

            {/* Totals */}
            <View style={[s.totalsRow, { backgroundColor: dyn.cardAlt, borderColor: dyn.goldBorder }]}>
              <Text style={[s.totalsLabel, { color: dyn.textSecondary, flex: 1 }]}>TOTAL</Text>
              <Text style={[s.totalsVal, { color: dyn.textMuted, width: 36 }]}>{totalPar > 0 ? totalPar : '—'}</Text>
              <View style={{ width: 52, alignItems: 'center' }}>
                <Text style={[s.totalsVal, { color: dyn.white }]}>{totalGross > 0 ? totalGross : '—'}</Text>
                {toPar !== null && (
                  <Text style={[s.toParLabel, { color: toPar <= 0 ? '#22c55e' : '#f97316' }]}>
                    {toPar > 0 ? `+${toPar}` : toPar === 0 ? 'E' : toPar}
                  </Text>
                )}
              </View>
              <Text style={[s.totalsVal, { color: dyn.gold, width: 44, fontWeight: '800' }]}>{totalPts}</Text>
            </View>

            <View style={{ height: 120 }} />
          </ScrollView>

          {/* Submit */}
          <View style={[s.submitBar, { backgroundColor: dyn.bg, borderTopColor: dyn.border }]}>
            <TouchableOpacity
              style={[s.submitBtn, { backgroundColor: dyn.gold }, submitting && { opacity: 0.6 }]}
              onPress={submit}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting
                ? <ActivityIndicator color={dyn.bg} />
                : <Text style={[s.submitBtnText, { color: dyn.bg }]}>Save to Profile</Text>}
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1 },
  header: {
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  back:  { fontSize: fonts.sm, fontWeight: '600' },
  title: { fontSize: fonts.md, fontWeight: '800', letterSpacing: 0.5 },

  // Scan step
  scanStep:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  scanIcon:     { fontSize: 56, marginBottom: spacing.lg },
  scanHeading:  { fontSize: fonts.xl, fontWeight: '800', textAlign: 'center', marginBottom: spacing.sm },
  scanSub:      { fontSize: fonts.sm, textAlign: 'center', lineHeight: 22, marginBottom: spacing.xl },
  scanningWrap: { alignItems: 'center', gap: spacing.md },
  scanningText: { fontSize: fonts.sm },
  scanBtns:     { width: '100%', gap: spacing.sm },
  scanBtn:      { borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
  scanBtnText:  { fontSize: fonts.md, fontWeight: '700' },
  manualLink:   { fontSize: fonts.sm, textDecorationLine: 'underline', textAlign: 'center' },

  // Review step
  reviewScroll: { padding: spacing.md, paddingBottom: 48 },
  courseName:   { fontSize: fonts.xs, fontWeight: '700', letterSpacing: 1.5, marginBottom: spacing.md, textAlign: 'center' },
  gridHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.xs, paddingHorizontal: spacing.sm,
    borderRadius: radius.sm, borderWidth: 1, marginBottom: 2,
  },
  gridHdr:   { fontSize: 10, fontWeight: '800', letterSpacing: 1, textAlign: 'center' },
  gridRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: spacing.sm, borderBottomWidth: 1 },
  gridCell:  { fontSize: fonts.sm, textAlign: 'center' },
  gridInput: {
    width: 52, height: 34, borderRadius: radius.sm, borderWidth: 1,
    textAlign: 'center', fontSize: fonts.md, fontWeight: '700',
  },
  totalsRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, marginTop: spacing.sm,
  },
  totalsLabel: { fontSize: fonts.xs, fontWeight: '800', letterSpacing: 1 },
  totalsVal:   { fontSize: fonts.md, fontWeight: '700', textAlign: 'center' },
  toParLabel:  { fontSize: 10, fontWeight: '700' },

  // Submit
  submitBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: spacing.md, paddingBottom: Platform.OS === 'ios' ? 32 : spacing.md,
    borderTopWidth: 1,
  },
  submitBtn:     { borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
  submitBtnText: { fontSize: fonts.md, fontWeight: '800', letterSpacing: 0.5 },
});
