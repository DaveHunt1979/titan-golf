import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../../src/lib/supabase';
import { scanPlayerScoresFromCamera, scanPlayerScoresFromLibrary, ScannedScore } from '../../../../src/lib/scanScorecard';
import { calcStrokesReceived, calcStablefordPoints, calcCourseHandicap } from '../../../../src/lib/scoring';
import { colors, fonts, spacing, radius } from '../../../../src/lib/theme';

type Step = 'player' | 'scan' | 'review' | 'saving';

interface EnteredPlayer {
  player_id:    string;
  display_name: string;
  handicap:     number | null;
  hcpIndex:     number | null;
  has_scores:   boolean;
}

interface HoleInfo { hole_number: number; par: number; stroke_index: number; }

export default function SwindleScan() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const router     = useRouter();

  const [step,        setStep]       = useState<Step>('player');
  const [players,     setPlayers]    = useState<EnteredPlayer[]>([]);
  const [selected,    setSelected]   = useState<EnteredPlayer | null>(null);
  const [courseHoles, setCourseHoles]= useState<HoleInfo[]>([]);
  const [scores,      setScores]     = useState<(number | null)[]>(Array(18).fill(null));
  const [scanning,    setScanning]   = useState(false);
  const [loading,     setLoading]    = useState(true);
  const [slopeRating, setSlopeRating] = useState(113);
  const [courseRating,setCourseRating]= useState<number | null>(null);
  const [hcpAllowance,setHcpAllowance]= useState(100);

  useEffect(() => { load(); }, [gameId]);

  async function load() {
    const [{ data: gameData }, { data: entriesData }, { data: scoresData }] = await Promise.all([
      supabase.from('swindle_games').select('course_name, slope_rating, course_rating, hcp_allowance').eq('id', gameId).single(),
      supabase.from('swindle_entries').select('player_id, handicap, players(display_name, handicap_index)').eq('game_id', gameId),
      supabase.from('swindle_scores').select('player_id').eq('game_id', gameId),
    ]);

    const g = gameData as any;
    if (g?.slope_rating)         setSlopeRating(g.slope_rating);
    if (g?.course_rating != null) setCourseRating(g.course_rating);
    if (g?.hcp_allowance != null) setHcpAllowance(g.hcp_allowance);

    const scoredPlayers = new Set((scoresData ?? []).map((s: any) => s.player_id));

    setPlayers(((entriesData ?? []) as any[]).map(e => ({
      player_id:    e.player_id,
      display_name: e.players?.display_name ?? 'Unknown',
      handicap:     e.handicap != null ? Math.round(e.handicap) : null,
      hcpIndex:     e.players?.handicap_index ?? null,
      has_scores:   scoredPlayers.has(e.player_id),
    })).sort((a, b) => a.display_name.localeCompare(b.display_name)));

    if ((gameData as any)?.course_name) {
      const { data: holes } = await supabase
        .from('course_holes').select('hole_number,par,stroke_index')
        .eq('course_name', (gameData as any).course_name).order('hole_number');
      if (holes) setCourseHoles(holes as HoleInfo[]);
    }

    setLoading(false);
  }

  function getPlayingHcp(player: EnteredPlayer | null): number {
    if (!player) return 0;
    const idx = player.hcpIndex ?? (player.handicap ?? 0);
    const par = courseHoles.length > 0 ? courseHoles.reduce((s, h) => s + h.par, 0) : 72;
    const ch  = calcCourseHandicap(idx, slopeRating, courseRating ?? par, par);
    return Math.round(ch * (hcpAllowance / 100));
  }

  async function doScan(fromLibrary = false) {
    setScanning(true);
    try {
      const scanned: ScannedScore[] = fromLibrary
        ? await scanPlayerScoresFromLibrary()
        : await scanPlayerScoresFromCamera();

      const filled = Array(18).fill(null) as (number | null)[];
      for (const s of scanned) {
        if (s.hole >= 1 && s.hole <= 18) filled[s.hole - 1] = s.gross;
      }
      setScores(filled);
      setStep('review');
    } catch (e: any) {
      if (e.message !== 'Cancelled') Alert.alert('Scan failed', e.message);
    } finally {
      setScanning(false);
    }
  }

  async function submitScores() {
    if (!selected) return;
    setStep('saving');

    const rows = scores
      .map((gross, i) => {
        if (gross == null) return null;
        const holeNum  = i + 1;
        const holeInfo = courseHoles.find(h => h.hole_number === holeNum);
        const shots    = holeInfo ? calcStrokesReceived(getPlayingHcp(selected), holeInfo.stroke_index) : 0;
        const pts      = holeInfo ? calcStablefordPoints(gross, holeInfo.par, shots) : 0;
        return { game_id: gameId, player_id: selected.player_id, hole_number: holeNum, gross_score: gross, stableford_pts: pts };
      })
      .filter(Boolean);

    if (rows.length === 0) {
      Alert.alert('No scores', 'Please enter at least one score before submitting.');
      setStep('review');
      return;
    }

    const { error } = await supabase.from('swindle_scores').upsert(rows as any[], { onConflict: 'game_id,player_id,hole_number' });
    if (error) {
      Alert.alert('Error', error.message);
      setStep('review');
      return;
    }

    await supabase.from('swindle_games').update({ status: 'in_progress' }).eq('id', gameId).eq('status', 'open');

    Alert.alert(
      'Submitted!',
      `${selected.display_name.split(' ')[0]}'s scorecard has been added to the leaderboard.`,
      [{ text: 'Done', onPress: () => router.back() }],
    );
  }

  const totalPts = scores.reduce<number>((sum, gross, i) => {
    if (gross == null) return sum;
    const holeInfo = courseHoles.find(h => h.hole_number === i + 1);
    const shots    = holeInfo ? calcStrokesReceived(getPlayingHcp(selected), holeInfo.stroke_index) : 0;
    return sum + (holeInfo ? calcStablefordPoints(gross, holeInfo.par, shots) : 0);
  }, 0);

  const holesEntered = scores.filter(s => s !== null).length;

  if (loading) {
    return <View style={s.container}><ActivityIndicator color={colors.gold} style={{ marginTop: 80 }} /></View>;
  }

  // ── Step: Select player ───────────────────────────────────────
  if (step === 'player') {
    return (
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top:10,bottom:10,left:10,right:10 }}>
            <Text style={s.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>Scan Scorecard</Text>
          <View style={{ width: 60 }} />
        </View>
        <Text style={s.stepHint}>Step 1 of 3 — Who's scorecard is this?</Text>
        <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
          {players.map(p => (
            <TouchableOpacity
              key={p.player_id}
              style={[s.playerRow, p.has_scores && s.playerRowDone]}
              onPress={() => { setSelected(p); setStep('scan'); }}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={[s.playerName, p.has_scores && { color: colors.textMuted }]}>{p.display_name}</Text>
                <Text style={s.playerHcp}>
                  {p.handicap != null ? `HCP ${p.handicap}` : 'No handicap'}{p.has_scores ? ' · Already submitted' : ''}
                </Text>
              </View>
              <Text style={[s.arrow, p.has_scores && { color: colors.textMuted }]}>›</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ── Step: Scan ────────────────────────────────────────────────
  if (step === 'scan') {
    return (
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => setStep('player')} hitSlop={{ top:10,bottom:10,left:10,right:10 }}>
            <Text style={s.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>{selected?.display_name.split(' ')[0]}'s Card</Text>
          <View style={{ width: 60 }} />
        </View>
        <Text style={s.stepHint}>Step 2 of 3 — Scan or photograph the scorecard</Text>

        <View style={s.scanArea}>
          <Text style={s.scanIcon}>📋</Text>
          <Text style={s.scanTitle}>Photograph the scorecard</Text>
          <Text style={s.scanSub}>Make sure the player's written scores are clearly visible</Text>

          {scanning ? (
            <View style={s.scanningWrap}>
              <ActivityIndicator color={colors.gold} size="large" />
              <Text style={s.scanningText}>Reading scores…</Text>
            </View>
          ) : (
            <View style={s.scanBtns}>
              <TouchableOpacity style={s.scanBtn} onPress={() => doScan(false)} activeOpacity={0.8}>
                <Text style={s.scanBtnIcon}>📷</Text>
                <Text style={s.scanBtnText}>Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.scanBtn, s.scanBtnAlt]} onPress={() => doScan(true)} activeOpacity={0.8}>
                <Text style={s.scanBtnIcon}>🖼️</Text>
                <Text style={[s.scanBtnText, { color: colors.textSecondary }]}>Choose Photo</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <TouchableOpacity style={s.manualBtn} onPress={() => { setScores(Array(18).fill(null)); setStep('review'); }} activeOpacity={0.7}>
          <Text style={s.manualBtnText}>Enter scores manually instead</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Step: Review / edit scores ────────────────────────────────
  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => setStep('scan')} hitSlop={{ top:10,bottom:10,left:10,right:10 }}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{selected?.display_name.split(' ')[0]}'s Card</Text>
        <Text style={s.headerPts}>{totalPts}pts</Text>
      </View>
      <Text style={s.stepHint}>Step 3 of 3 — Check scores, edit if needed, then submit</Text>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: 100 }}>
        <View style={s.grid}>
          {Array.from({ length: 18 }, (_, i) => {
            const holeNum  = i + 1;
            const holeInfo = courseHoles.find(h => h.hole_number === holeNum);
            const gross    = scores[i];
            const shots    = holeInfo ? calcStrokesReceived(getPlayingHcp(selected), holeInfo.stroke_index) : 0;
            const pts      = (gross != null && holeInfo) ? calcStablefordPoints(gross, holeInfo.par, shots) : null;
            const ptColor  = pts == null ? colors.textMuted : pts >= 4 ? colors.gold : pts === 3 ? '#4ade80' : pts === 2 ? colors.white : pts === 1 ? colors.textMuted : colors.red;

            return (
              <View key={holeNum} style={s.holeCell}>
                <Text style={s.holeCellNum}>H{holeNum}</Text>
                {holeInfo && <Text style={s.holeCellPar}>Par {holeInfo.par}{shots > 0 ? ' +' + shots : ''}</Text>}
                <TextInput
                  style={[s.holeCellInput, gross != null && s.holeCellInputFilled]}
                  value={gross != null ? String(gross) : ''}
                  onChangeText={v => {
                    const n = parseInt(v);
                    const next = [...scores];
                    next[i] = isNaN(n) || n < 1 ? null : Math.min(n, 15);
                    setScores(next);
                  }}
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="—"
                  placeholderTextColor={colors.textMuted}
                  selectTextOnFocus
                />
                {pts != null && <Text style={[s.holeCellPts, { color: ptColor }]}>{pts}pt{pts !== 1 ? 's' : ''}</Text>}
              </View>
            );
          })}
        </View>

        <View style={s.summary}>
          <View style={s.summaryItem}>
            <Text style={s.summaryLabel}>HOLES</Text>
            <Text style={s.summaryValue}>{holesEntered}/18</Text>
          </View>
          <View style={s.summaryItem}>
            <Text style={s.summaryLabel}>STABLEFORD</Text>
            <Text style={[s.summaryValue, { color: colors.gold }]}>{totalPts}pts</Text>
          </View>
          {selected && (
            <View style={s.summaryItem}>
              <Text style={s.summaryLabel}>HCP</Text>
              <Text style={s.summaryValue}>{getPlayingHcp(selected)}</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[s.submitBtn, (step === 'saving' || holesEntered === 0) && { opacity: 0.5 }]}
          onPress={submitScores}
          disabled={step === 'saving' || holesEntered === 0}
          activeOpacity={0.85}
        >
          {step === 'saving'
            ? <ActivityIndicator color={colors.bg} />
            : <Text style={s.submitBtnText}>Submit {selected?.display_name.split(' ')[0]}'s Scores</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container:     { flex: 1, backgroundColor: colors.bg, paddingTop: 56 },
  header:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, marginBottom: spacing.xs, gap: spacing.sm },
  back:          { color: colors.gold, fontSize: fonts.md, fontWeight: '600' },
  headerTitle:   { flex: 1, fontSize: fonts.md, fontWeight: '800', color: colors.white, textAlign: 'center' },
  headerPts:     { fontSize: fonts.md, fontWeight: '800', color: colors.gold, minWidth: 60, textAlign: 'right' },
  stepHint:      { fontSize: fonts.xs, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.md, paddingHorizontal: spacing.lg },

  playerRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  playerRowDone: { opacity: 0.5 },
  playerName:    { fontSize: fonts.md, fontWeight: '700', color: colors.white, marginBottom: 2 },
  playerHcp:     { fontSize: fonts.xs, color: colors.textMuted },
  arrow:         { fontSize: 22, color: colors.gold },

  scanArea:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  scanIcon:      { fontSize: 56 },
  scanTitle:     { fontSize: fonts.xl, fontWeight: '800', color: colors.white, textAlign: 'center' },
  scanSub:       { fontSize: fonts.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  scanBtns:      { flexDirection: 'row', gap: spacing.md, width: '100%' },
  scanBtn:       { flex: 1, backgroundColor: colors.gold, borderRadius: radius.lg, paddingVertical: spacing.lg, alignItems: 'center', gap: spacing.xs },
  scanBtnAlt:    { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  scanBtnIcon:   { fontSize: 24 },
  scanBtnText:   { fontSize: fonts.sm, fontWeight: '800', color: colors.bg },
  scanningWrap:  { alignItems: 'center', gap: spacing.sm },
  scanningText:  { color: colors.textMuted, fontSize: fonts.sm },
  manualBtn:     { alignItems: 'center', paddingBottom: spacing.xl },
  manualBtnText: { fontSize: fonts.sm, color: colors.textMuted, textDecorationLine: 'underline' },

  grid:          { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  holeCell:      { width: '30%', flexGrow: 1, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, alignItems: 'center', gap: 2 },
  holeCellNum:   { fontSize: 10, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.5 },
  holeCellPar:   { fontSize: 9, color: colors.textMuted },
  holeCellInput: { fontSize: fonts.xxl, fontWeight: '800', color: colors.textMuted, textAlign: 'center', width: '100%', paddingVertical: 4 },
  holeCellInputFilled: { color: colors.white },
  holeCellPts:   { fontSize: fonts.xs, fontWeight: '700' },

  summary:       { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md, borderWidth: 1, borderColor: colors.border },
  summaryItem:   { alignItems: 'center' },
  summaryLabel:  { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1 },
  summaryValue:  { fontSize: fonts.lg, fontWeight: '800', color: colors.white, marginTop: 2 },

  submitBtn:     { backgroundColor: colors.gold, borderRadius: radius.lg, paddingVertical: 16, alignItems: 'center', marginTop: spacing.lg },
  submitBtnText: { color: colors.bg, fontSize: fonts.lg, fontWeight: '800' },
});
