import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, TextInput, Alert, Platform, Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../../src/lib/supabase';
import { scanPlayerScoresFromCamera, scanPlayerScoresFromLibrary } from '../../../../src/lib/scanScorecard';
import { calcStrokesReceived, calcStablefordPoints } from '../../../../src/lib/scoring';

// ── TITAN Design Constants ──────────────────────────────────────────────────
const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../../assets/TitanAppLogo.png');

interface CourseHole { hole_number: number; par: number; stroke_index: number; }
interface HoleScore  { hole: number; gross: number | null; }

type Step = 'scan' | 'review';

export default function ScanMatchScorecardScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [step, setStep]             = useState<Step>('scan');
  const [scanning, setScanning]     = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading]       = useState(true);

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
      if (!user) { setLoading(false); return; }

      const { data: p } = await supabase.from('players')
        .select('id, handicap_index')
        .eq('auth_uid', user.id)
        .single();
      if (!p) { setLoading(false); return; }

      setMyPlayerId((p as any).id);
      setMyHandicap(Math.round((p as any).handicap_index ?? 0));

      const { data: m } = await supabase.from('matches')
        .select('round_format, day:day_id(course_name)')
        .eq('id', matchId)
        .single();
      if (!m) { setLoading(false); return; }

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
      setLoading(false);
    })();
  }, [matchId]);

  // Loading / font guard
  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" />
      <ActivityIndicator color={GOLD} size="large" />
    </View>
  );

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
          const ch    = courseHoles.find(h => h.hole_number === s.hole);
          const par   = ch?.par ?? 4;
          const si    = ch?.stroke_index ?? s.hole;
          const shots = calcStrokesReceived(myHandicap, si);
          const pts   = calcStablefordPoints(s.gross, par, shots);
          return {
            match_id:       matchId,
            player_id:      myPlayerId,
            hole_number:    s.hole,
            gross_score:    s.gross,
            net_score:      (s.gross ?? 0) - shots,
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

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => step === 'review' ? setStep('scan') : router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={s.headerLeft}
        >
          <Text style={s.back}>‹ {step === 'review' ? 'Back' : 'Cancel'}</Text>
        </TouchableOpacity>

        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.logoImg} resizeMode="contain" />
          <Text style={s.headerSub}>SCAN SCORECARD</Text>
        </View>

        <View style={s.headerRight} />
      </View>

      {/* ── Step: Scan ── */}
      {step === 'scan' && (
        <View style={s.scanStep}>
          <Text style={s.scanIcon}>📋</Text>
          <Text style={s.scanHeading}>Scan Your Paper Scorecard</Text>
          <Text style={s.scanSub}>
            Take a photo of your completed scorecard or choose one from your library. The AI will extract your gross scores.
          </Text>

          {scanning ? (
            <View style={s.scanningWrap}>
              <ActivityIndicator color={GOLD} size="large" />
              <Text style={s.scanningText}>Reading your scorecard…</Text>
            </View>
          ) : (
            <View style={s.scanBtns}>
              <TouchableOpacity style={s.scanBtnCamera} onPress={() => doScan(true)} activeOpacity={0.85}>
                <Text style={s.scanBtnCameraText}>📷  Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.scanBtnLib} onPress={() => doScan(false)} activeOpacity={0.85}>
                <Text style={s.scanBtnLibText}>🖼  Choose from Library</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setStep('review')} activeOpacity={0.7} style={{ marginTop: 12 }}>
                <Text style={s.manualLink}>Enter scores manually instead</Text>
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
              <Text style={s.courseName}>{courseName}</Text>
            )}

            {/* Grid header */}
            <View style={s.gridHeader}>
              <Text style={[s.gridHdr, { flex: 1 }]}>HOLE</Text>
              <Text style={[s.gridHdr, { width: 36 }]}>PAR</Text>
              <Text style={[s.gridHdr, { width: 52 }]}>GROSS</Text>
              <Text style={[s.gridHdr, { width: 44 }]}>PTS</Text>
            </View>

            {scores.map(({ hole, gross }) => {
              const par  = parForHole(hole);
              const pts  = stablefordForHole(hole, gross);
              const diff = gross !== null ? gross - par : null;
              const grossColor = diff === null ? '#555'
                : diff <= -2 ? '#f59e0b'
                : diff === -1 ? GREEN
                : diff === 0  ? '#fff'
                : diff === 1  ? '#f97316'
                : RED;
              return (
                <View key={hole} style={s.gridRow}>
                  <Text style={[s.gridCell, { flex: 1, color: '#fff' }]}>{hole}</Text>
                  <Text style={[s.gridCell, { width: 36, color: '#fff' }]}>{par}</Text>
                  <TextInput
                    style={[s.gridInput, { color: grossColor }]}
                    value={gross !== null ? String(gross) : ''}
                    onChangeText={v => updateScore(hole, v)}
                    keyboardType="number-pad"
                    maxLength={2}
                    placeholder="—"
                    placeholderTextColor="#555"
                  />
                  <Text style={[s.gridCell, { width: 44, color: pts > 0 ? GOLD : '#555', fontFamily: FFB }]}>
                    {gross !== null ? pts : '—'}
                  </Text>
                </View>
              );
            })}

            {/* Totals */}
            <View style={s.totalsRow}>
              <Text style={[s.totalsLabel, { flex: 1 }]}>TOTAL</Text>
              <Text style={[s.totalsVal, { width: 36, color: '#fff' }]}>{totalPar > 0 ? totalPar : '—'}</Text>
              <View style={{ width: 52, alignItems: 'center' }}>
                <Text style={[s.totalsVal, { color: '#fff' }]}>{totalGross > 0 ? totalGross : '—'}</Text>
                {toPar !== null && (
                  <Text style={[s.toParLabel, { color: toPar <= 0 ? GREEN : '#f97316' }]}>
                    {toPar > 0 ? `+${toPar}` : toPar === 0 ? 'E' : toPar}
                  </Text>
                )}
              </View>
              <Text style={[s.totalsVal, { width: 44, color: GOLD, fontFamily: FFB }]}>{totalPts}</Text>
            </View>

            <View style={{ height: 120 }} />
          </ScrollView>

          {/* Submit bar */}
          <View style={s.submitBar}>
            <TouchableOpacity
              style={[s.submitBtn, submitting && { opacity: 0.6 }]}
              onPress={submit}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting
                ? <ActivityIndicator color="#000" />
                : <Text style={s.submitBtnText}>Save to Profile</Text>}
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  // ── Layout ──
  container: { flex: 1, backgroundColor: '#000' },

  // ── Header ──
  header: {
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1c',
  },
  headerLeft:   { width: 70 },
  headerCenter: { flex: 1, alignItems: 'center', gap: 4 },
  headerRight:  { width: 70 },
  logoImg:      { width: 28, height: 28 },
  headerSub:    { fontSize: 9, fontFamily: FFB, color: '#fff', letterSpacing: 1.5 },
  back:         { fontSize: 15, fontFamily: FFB, color: GOLD },

  // ── Scan step ──
  scanStep:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  scanIcon:     { fontSize: 56, marginBottom: 20 },
  scanHeading:  { fontSize: 20, fontFamily: FFB, color: '#fff', textAlign: 'center', marginBottom: 10 },
  scanSub:      { fontSize: 14, fontFamily: FFB, color: '#fff', textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  scanningWrap: { alignItems: 'center', gap: 14 },
  scanningText: { fontSize: 14, fontFamily: FFB, color: '#fff' },
  scanBtns:     { width: '100%', gap: 10 },

  scanBtnCamera: {
    backgroundColor: '#111',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: GOLD,
  },
  scanBtnCameraText: { fontSize: 15, fontFamily: FFB, color: GOLD },

  scanBtnLib: {
    backgroundColor: '#111',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1c1c1c',
  },
  scanBtnLibText: { fontSize: 15, fontFamily: FFB, color: '#fff' },

  manualLink: { fontSize: 13, fontFamily: FFB, color: '#fff', textDecorationLine: 'underline', textAlign: 'center' },

  // ── Review step ──
  reviewScroll: { padding: 16, paddingBottom: 48 },
  courseName:   { fontSize: 10, fontFamily: FFB, color: '#fff', letterSpacing: 1.5, marginBottom: 14, textAlign: 'center' },

  gridHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1c1c1c',
    marginBottom: 2,
  },
  gridHdr:  { fontSize: 10, fontFamily: FFB, color: '#fff', letterSpacing: 1, textAlign: 'center' },
  gridRow:  {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1c',
  },
  gridCell: { fontSize: 14, fontFamily: FFB, textAlign: 'center' },
  gridInput: {
    width: 52,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1c1c1c',
    backgroundColor: '#1a1a1a',
    textAlign: 'center',
    fontSize: 15,
    fontFamily: FFB,
    color: '#fff',
  },

  totalsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: GOLD,
    marginTop: 10,
  },
  totalsLabel: { fontSize: 10, fontFamily: FFB, color: '#fff', letterSpacing: 1 },
  totalsVal:   { fontSize: 15, fontFamily: FFB, textAlign: 'center' },
  toParLabel:  { fontSize: 10, fontFamily: FFB },

  // ── Submit ──
  submitBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    backgroundColor: '#000',
    borderTopWidth: 1,
    borderTopColor: '#1c1c1c',
  },
  submitBtn: {
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitBtnText: { fontSize: 15, fontFamily: FFB, color: '#000', letterSpacing: 0.5 },
});
