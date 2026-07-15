import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Image } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../../src/lib/supabase';

// ─── TITAN Design Tokens ──────────────────────────────────────────────────────
const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../../assets/teams/Titan Logo.png');

// ─── Types ────────────────────────────────────────────────────────────────────
interface CourseHole { hole_number: number; par: number; stroke_index: number; }
interface Match { id: string; status: string; home_player_ids: string[]; day: { course_name: string } | null; }

export default function ScrambleScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const [match, setMatch]     = useState<Match | null>(null);
  const [holes, setHoles]     = useState<CourseHole[]>([]);
  const [names, setNames]     = useState<Record<string, string>>({});
  const [scores, setScores]   = useState<Record<number, number>>({});
  const [holeIdx, setHoleIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

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

  const hole  = holes[holeIdx];
  const score = hole ? (scores[hole.hole_number] ?? hole.par) : 0;
  const setScore = (v: number) => { if (!hole) return; setScores(p => ({ ...p, [hole.hole_number]: Math.max(1, v) })); };

  async function save() {
    if (!match || !hole || saving) return;
    setSaving(true);
    const g = scores[hole.hole_number] ?? hole.par;
    for (const pid of match.home_player_ids) {
      await supabase.from('match_holes').upsert(
        { match_id: matchId, player_id: pid, hole_number: hole.hole_number, gross_score: g },
        { onConflict: 'match_id,player_id,hole_number' },
      );
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
    Alert.alert(
      'Round Complete!',
      `Team: ${totalGross} (${d === 0 ? 'E' : d > 0 ? `+${d}` : d})`,
      [{ text: 'Done', onPress: () => router.back() }],
    );
  }

  const runGross = holes.slice(0, holeIdx + 1).reduce((s, h) => s + (scores[h.hole_number] ?? 0), 0);
  const runPar   = holes.slice(0, holeIdx + 1).reduce((s, h) => s + h.par, 0);
  const runDiff  = runGross - runPar;

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" />
      <ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  if (!match || !hole) return null;

  // Score colouring for the stepper circle
  const scoreBorderColor = score < hole.par ? GREEN : score > hole.par ? RED : '#333';
  const scoreBgColor     = score < hole.par ? 'rgba(74,222,128,0.1)' : score > hole.par ? 'rgba(248,113,113,0.1)' : '#111';
  const scoreTextColor   = score < hole.par ? GREEN : score > hole.par ? RED : '#fff';
  const diffColor        = runDiff < 0 ? GREEN : runDiff > 0 ? RED : '#fff';

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* ── Header ────────────────────────────────────────────────── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerLeft}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>

        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.logo} resizeMode="contain" />
          <Text style={s.subtitle}>SCRAMBLE</Text>
        </View>

        <View style={s.headerRight} />
      </View>

      {/* ── Summary card ──────────────────────────────────────────── */}
      <View style={s.summaryCard}>
        <Text style={s.teamLabel}>
          {match.home_player_ids.map(id => names[id] ?? '?').join(' · ')}
        </Text>
        <View style={s.summaryRow}>
          {[
            { v: runGross || '—', l: 'GROSS', col: GOLD },
            {
              v: runGross === 0 ? '—' : runDiff === 0 ? 'E' : runDiff > 0 ? `+${runDiff}` : `${runDiff}`,
              l: 'TO PAR',
              col: diffColor,
            },
            { v: holeIdx + 1, l: 'HOLE', col: '#fff' },
          ].map(item => (
            <View key={item.l} style={s.summaryItem}>
              <Text style={[s.summaryVal, { color: item.col }]}>{item.v}</Text>
              <Text style={s.summaryLbl}>{item.l}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── Hole card ─────────────────────────────────────────────── */}
      <View style={s.holeCard}>
        <Text style={s.holeNum}>Hole {hole.hole_number}</Text>
        <Text style={s.holeMeta}>Par {hole.par}  ·  SI {hole.stroke_index}</Text>
      </View>

      {/* ── Score stepper ─────────────────────────────────────────── */}
      <View style={s.stepperWrap}>
        <Text style={s.stepperLbl}>TEAM SCORE</Text>
        <View style={s.stepper}>
          <TouchableOpacity style={s.stepBtn} onPress={() => setScore(score - 1)} activeOpacity={0.7}>
            <Text style={s.stepBtnTxt}>−</Text>
          </TouchableOpacity>

          <View style={[s.scoreDisp, { borderColor: scoreBorderColor, backgroundColor: scoreBgColor }]}>
            <Text style={[s.scoreTxt, { color: scoreTextColor }]}>{score}</Text>
            <Text style={s.scoreDiff}>
              {score === hole.par ? 'PAR' : score < hole.par ? `${score - hole.par}` : `+${score - hole.par}`}
            </Text>
          </View>

          <TouchableOpacity style={s.stepBtn} onPress={() => setScore(score + 1)} activeOpacity={0.7}>
            <Text style={s.stepBtnTxt}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Navigation ────────────────────────────────────────────── */}
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
  container: { flex: 1, backgroundColor: '#000' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1c',
  },
  headerLeft:   { width: 70 },
  headerCenter: { alignItems: 'center' },
  headerRight:  { width: 70 },
  logo:         { width: 28, height: 28 },
  subtitle:     { fontSize: 9, fontFamily: FFB, color: '#fff', letterSpacing: 1.5, marginTop: 3 },
  back:         { fontSize: 14, fontFamily: FFB, color: GOLD },

  // Summary card
  summaryCard: {
    margin: 16,
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1c1c1c',
    padding: 16,
  },
  teamLabel:   { fontSize: 11, fontFamily: FFB, color: '#fff', marginBottom: 12, textAlign: 'center', letterSpacing: 0.5 },
  summaryRow:  { flexDirection: 'row', justifyContent: 'space-around' },
  summaryItem: { alignItems: 'center' },
  summaryVal:  { fontSize: 28, fontFamily: FFB, color: '#fff' },
  summaryLbl:  { fontSize: 9, fontFamily: FFB, color: '#fff', letterSpacing: 1, marginTop: 2 },

  // Hole card
  holeCard: {
    alignItems: 'center',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1c',
  },
  holeNum:  { fontSize: 36, fontFamily: FFB, color: '#fff' },
  holeMeta: { fontSize: 13, fontFamily: FFB, color: '#fff', marginTop: 4 },

  // Stepper
  stepperWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stepperLbl:  { fontSize: 10, fontFamily: FFB, color: '#fff', letterSpacing: 1.5, marginBottom: 24 },
  stepper:     { flexDirection: 'row', alignItems: 'center', gap: 24 },
  stepBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1c1c1c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnTxt: { fontSize: 28, fontFamily: FFB, color: '#fff' },
  scoreDisp: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  scoreTxt:  { fontSize: 40, fontFamily: FFB, color: '#fff' },
  scoreDiff: { fontSize: 10, fontFamily: FFB, color: '#fff', marginTop: -4 },

  // Navigation
  nav: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: '#1c1c1c',
  },
  navBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1c1c1c',
    backgroundColor: '#111',
  },
  navPrimary: { backgroundColor: GOLD, borderColor: GOLD },
  dim:        { opacity: 0.35 },
  navTxt:     { fontSize: 15, fontFamily: FFB, color: '#fff' },
});
