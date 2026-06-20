import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, Image, ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../../src/lib/theme';
import { calcCourseHandicap, calcStrokesReceived, calcStablefordPoints } from '../../../../src/lib/scoring';
import { getPlayerAvatar } from '../../../../src/lib/assets';

interface MatchInfo {
  id: string;
  match_number: number;
  round_format: 'stableford' | 'medal';
  status: 'upcoming' | 'in_progress' | 'complete';
  holes_string: string;
  home_player_ids: string[];
  day: { course_name: string; course_par: number; course_rating: number; slope_rating: number; day_number: number } | null;
}

interface CourseHole { hole_number: number; par: number; stroke_index: number; }
interface HoleScore { hole_number: number; gross: number; net: number; pts: number; }

export default function SoloRoundScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();

  const [match, setMatch]           = useState<MatchInfo | null>(null);
  const [courseHoles, setCourseHoles] = useState<CourseHole[]>([]);
  const [playerName, setPlayerName]   = useState('');
  const [playerHcp, setPlayerHcp]     = useState(0);
  const [courseHcp, setCourseHcp]     = useState(0);
  const [savedScores, setSavedScores] = useState<HoleScore[]>([]);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [selectedScore, setSelectedScore] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      const { data: matchData } = await supabase
        .from('matches')
        .select('*, day:day_id(course_name,course_par,course_rating,slope_rating,day_number)')
        .eq('id', matchId)
        .single();

      if (!matchData) { setLoading(false); return; }
      const m = matchData as unknown as MatchInfo;
      setMatch(m);

      const playerId = m.home_player_ids[0];
      const [{ data: holesData }, { data: playerData }, { data: scoresData }] = await Promise.all([
        m.day?.course_name
          ? supabase.from('course_holes').select('hole_number,par,stroke_index').eq('course_name', m.day.course_name).order('hole_number')
          : Promise.resolve({ data: [] }),
        supabase.from('players').select('display_name,handicap_index').eq('id', playerId).single(),
        supabase.from('match_holes').select('hole_number,gross_score,net_score,stableford_pts').eq('match_id', matchId).eq('player_id', playerId),
      ]);

      if (holesData) setCourseHoles(holesData);
      if (playerData) {
        const p = playerData as any;
        setPlayerName(p.display_name ?? '');
        const hcp = p.handicap_index ?? 0;
        setPlayerHcp(hcp);
        if (m.day) {
          setCourseHcp(calcCourseHandicap(hcp, m.day.slope_rating, m.day.course_rating, m.day.course_par));
        } else {
          setCourseHcp(Math.round(hcp));
        }
      }
      if (scoresData) {
        setSavedScores((scoresData as any[]).map(r => ({
          hole_number: r.hole_number,
          gross: r.gross_score ?? 0,
          net: r.net_score ?? 0,
          pts: r.stableford_pts ?? 0,
        })));
      }
      setLoading(false);
    }
    load();
  }, [matchId]);

  const holesStr  = match?.holes_string ?? '..................';
  const holeChars = holesStr.split('');
  const nextHole  = holeChars.findIndex(c => c === '.') + 1 || 19;
  const isComplete = match?.status === 'complete' || nextHole > 18;
  const isStableford = match?.round_format === 'stableford';

  const courseHole = courseHoles.find(h => h.hole_number === nextHole);
  const shots = courseHole ? calcStrokesReceived(courseHcp, courseHole.stroke_index) : 0;

  // Running totals
  const totalGross = savedScores.reduce((s, h) => s + h.gross, 0);
  const totalPts   = savedScores.reduce((s, h) => s + h.pts, 0);
  const totalNet   = savedScores.reduce((s, h) => s + h.net, 0);
  const parPlayed  = savedScores.reduce((s, h) => {
    const ch = courseHoles.find(c => c.hole_number === h.hole_number);
    return s + (ch?.par ?? 0);
  }, 0);
  const vsPar = totalGross - parPlayed;

  const avatar = match ? getPlayerAvatar(match.home_player_ids[0], 'normal') : null;

  async function saveScore() {
    if (selectedScore === null || !match || !courseHole) return;
    setSaving(true);
    setModalVisible(false);

    const gross = selectedScore;
    const net   = gross - shots;
    const pts   = calcStablefordPoints(gross, courseHole.par, shots);

    const { error: delErr } = await supabase.from('match_holes').delete()
      .eq('match_id', matchId).eq('hole_number', nextHole);
    if (delErr) console.error('delete error:', delErr);

    const { error: insErr } = await supabase.from('match_holes').insert({
      match_id: matchId,
      player_id: match.home_player_ids[0],
      hole_number: nextHole,
      score: null,
      gross_score: gross,
      net_score: net,
      stableford_pts: pts,
    });
    if (insErr) console.error('insert error:', insErr);

    // Mark hole as done in holes_string ('d' = done)
    const chars = [...holeChars];
    chars[nextHole - 1] = 'd';
    const newHolesStr = chars.join('');
    const holesLeft = newHolesStr.split('').filter(c => c === '.').length;
    const newStatus = holesLeft === 0 ? 'complete' : 'in_progress';

    const result = isStableford
      ? `${totalPts + pts} pts`
      : `${vsPar + gross - courseHole.par >= 0 ? '+' : ''}${vsPar + gross - courseHole.par}`;

    await supabase.from('matches').update({
      holes_string: newHolesStr,
      status: newStatus,
      result_str: result,
    }).eq('id', match.id);

    setSavedScores(prev => [...prev.filter(h => h.hole_number !== nextHole), { hole_number: nextHole, gross, net, pts }]);
    setMatch({ ...match, holes_string: newHolesStr, status: newStatus });
    setSelectedScore(null);
    setSaving(false);

    if (newStatus === 'complete') {
      const summary = isStableford ? `${totalPts + pts} points` : `${vsPar + gross - courseHole.par >= 0 ? '+' : ''}${vsPar + gross - courseHole.par}`;
      Alert.alert('Round Complete!', summary, [{ text: 'Done', onPress: () => router.back() }]);
    }
  }

  async function undoHole() {
    if (!match || saving || nextHole <= 1) return;
    const lastDone = nextHole - 1;
    setSaving(true);

    await supabase.from('match_holes').delete()
      .eq('match_id', matchId).eq('hole_number', lastDone);

    const chars = [...holeChars];
    chars[lastDone - 1] = '.';
    const newHolesStr = chars.join('');

    await supabase.from('matches').update({
      holes_string: newHolesStr,
      status: 'in_progress',
    }).eq('id', match.id);

    setSavedScores(prev => prev.filter(h => h.hole_number !== lastDone));
    setMatch({ ...match, holes_string: newHolesStr, status: 'in_progress' });
    setSaving(false);
  }

  if (loading) return (
    <View style={styles.centered}><ActivityIndicator color={colors.gold} size="large" /></View>
  );
  if (!match) return (
    <View style={styles.centered}><Text style={{ color: colors.textSecondary }}>Round not found.</Text></View>
  );

  const formatLabel = isStableford ? 'Stableford' : 'Medal';
  const scoreDisplay = isStableford
    ? `${totalPts} pts`
    : totalGross === 0 ? 'E'
    : vsPar > 0 ? `+${vsPar}` : `${vsPar}`;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerSub}>{match.day?.course_name} · {formatLabel}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Player + running score */}
        <View style={styles.playerCard}>
          <View style={styles.playerRow}>
            {avatar
              ? <Image source={avatar} style={styles.playerAvatar} />
              : <View style={[styles.playerAvatar, styles.avatarFallback]}><Text style={styles.avatarInitial}>{playerName[0]}</Text></View>
            }
            <View style={styles.playerInfo}>
              <Text style={styles.playerNameText}>{playerName}</Text>
              <Text style={styles.playerHcp}>HCP {playerHcp} · Course HCP {courseHcp}</Text>
            </View>
            <View style={styles.scoreBox}>
              <Text style={styles.scoreBoxVal}>{scoreDisplay}</Text>
              <Text style={styles.scoreBoxLabel}>{isStableford ? 'POINTS' : 'VS PAR'}</Text>
            </View>
          </View>

          {/* Hole progress */}
          <View style={styles.dotsRow}>
            {Array.from({ length: 18 }, (_, i) => {
              const c = holeChars[i] ?? '.';
              const done = c === 'd';
              const active = i + 1 === nextHole && !isComplete;
              return (
                <View key={i} style={[
                  styles.dot,
                  done && styles.dotDone,
                  active && styles.dotActive,
                ]} />
              );
            })}
          </View>
          <View style={styles.dotsNumRow}>
            {Array.from({ length: 18 }, (_, i) => (
              <Text key={i} style={[styles.dotNum, i + 1 === nextHole && !isComplete && styles.dotNumActive]}>{i + 1}</Text>
            ))}
          </View>
        </View>

        {!isComplete ? (
          <>
            {/* Current hole card */}
            <View style={styles.holeCard}>
              <Text style={styles.holeLabelSmall}>HOLE</Text>
              <Text style={styles.holeBig}>{nextHole}</Text>
              {courseHole && (
                <View style={styles.holeMetaRow}>
                  <View style={styles.holeMetaItem}>
                    <Text style={styles.holeMetaLabel}>PAR</Text>
                    <Text style={styles.holeMetaValue}>{courseHole.par}</Text>
                  </View>
                  <View style={styles.holeMetaSep} />
                  <View style={styles.holeMetaItem}>
                    <Text style={styles.holeMetaLabel}>S.I.</Text>
                    <Text style={styles.holeMetaValue}>{courseHole.stroke_index}</Text>
                  </View>
                  {shots > 0 && (
                    <>
                      <View style={styles.holeMetaSep} />
                      <View style={styles.holeMetaItem}>
                        <Text style={styles.holeMetaLabel}>SHOT{shots > 1 ? 'S' : ''}</Text>
                        <Text style={[styles.holeMetaValue, { color: colors.gold }]}>{shots}</Text>
                      </View>
                    </>
                  )}
                </View>
              )}
            </View>

            <TouchableOpacity
              style={styles.scoreBtn}
              onPress={() => { setSelectedScore(null); setModalVisible(true); }}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Text style={styles.scoreBtnText}>Score Hole {nextHole}</Text>
            </TouchableOpacity>

            {nextHole > 1 && (
              <TouchableOpacity style={styles.undoBtn} onPress={undoHole} disabled={saving}>
                <Text style={styles.undoText}>Undo Hole {nextHole - 1}</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <View style={styles.completeCard}>
            <Text style={styles.completeStar}>★</Text>
            <Text style={styles.completeTitle}>ROUND COMPLETE</Text>
            <Text style={styles.completeScore}>{scoreDisplay}</Text>
            <Text style={styles.completeDetail}>
              {isStableford ? `${totalGross} gross · ${totalPts} pts` : `${totalGross} gross`}
            </Text>
            {nextHole > 1 && (
              <TouchableOpacity style={[styles.undoBtn, { marginTop: spacing.xl }]} onPress={undoHole} disabled={saving}>
                <Text style={styles.undoText}>Undo Last Hole</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Mini scorecard */}
        {savedScores.length > 0 && (
          <View style={styles.miniCard}>
            <Text style={styles.miniTitle}>SCORECARD</Text>
            {[savedScores.filter(h => h.hole_number <= 9), savedScores.filter(h => h.hole_number >= 10)].map((half, hi) => {
              if (half.length === 0) return null;
              const halfHoles = courseHoles.filter(h => hi === 0 ? h.hole_number <= 9 : h.hole_number >= 10);
              return (
                <View key={hi} style={{ marginBottom: 4 }}>
                  <View style={styles.miniRow}>
                    <Text style={styles.miniLabel}>HOLE</Text>
                    {halfHoles.map(h => <Text key={h.hole_number} style={styles.miniCell}>{h.hole_number}</Text>)}
                    <Text style={styles.miniTot}>{hi === 0 ? 'OUT' : 'IN'}</Text>
                  </View>
                  <View style={styles.miniRow}>
                    <Text style={styles.miniLabel}>PAR</Text>
                    {halfHoles.map(h => <Text key={h.hole_number} style={styles.miniCell}>{h.par}</Text>)}
                    <Text style={styles.miniTot}>{halfHoles.reduce((s, h) => s + h.par, 0)}</Text>
                  </View>
                  <View style={styles.miniRow}>
                    <Text style={styles.miniLabel}>GROSS</Text>
                    {halfHoles.map(h => {
                      const sc = half.find(s => s.hole_number === h.hole_number);
                      const diff = sc ? sc.gross - h.par : null;
                      return (
                        <View key={h.hole_number} style={[
                          styles.miniScoreCell,
                          diff !== null && diff < 0 && styles.miniBirdie,
                          diff !== null && diff === 0 && styles.miniParCell,
                          diff !== null && diff > 0 && styles.miniBogey,
                        ]}>
                          <Text style={styles.miniScoreText}>{sc?.gross ?? '·'}</Text>
                        </View>
                      );
                    })}
                    <Text style={styles.miniTot}>{half.reduce((s, h) => s + h.gross, 0) || '·'}</Text>
                  </View>
                  {isStableford && (
                    <View style={styles.miniRow}>
                      <Text style={styles.miniLabel}>PTS</Text>
                      {halfHoles.map(h => {
                        const sc = half.find(s => s.hole_number === h.hole_number);
                        return <Text key={h.hole_number} style={[styles.miniCell, { color: colors.gold }]}>{sc?.pts ?? '·'}</Text>;
                      })}
                      <Text style={[styles.miniTot, { color: colors.gold }]}>{half.reduce((s, h) => s + h.pts, 0) || '·'}</Text>
                    </View>
                  )}
                  {hi === 0 && <View style={styles.miniDivider} />}
                </View>
              );
            })}
          </View>
        )}

      </ScrollView>

      {saving && (
        <View style={styles.savingIndicator}>
          <ActivityIndicator color={colors.gold} size="small" />
        </View>
      )}

      {/* Score entry modal */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Hole {nextHole}</Text>
            {courseHole && (
              <Text style={styles.modalSub}>Par {courseHole.par} · SI {courseHole.stroke_index}{shots > 0 ? ` · +${shots} shot${shots > 1 ? 's' : ''}` : ''}</Text>
            )}
            {selectedScore !== null && courseHole && isStableford && (
              <View style={styles.ptsBadge}>
                <Text style={styles.ptsBadgeText}>
                  {calcStablefordPoints(selectedScore, courseHole.par, shots)} pts
                </Text>
              </View>
            )}
            <View style={styles.scoreGrid}>
              {[1, 2, 3, 4, 5].map(n => (
                <TouchableOpacity
                  key={n}
                  style={[styles.scoreNumBtn, selectedScore === n && styles.scoreNumBtnOn]}
                  onPress={() => setSelectedScore(n)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.scoreNumText, selectedScore === n && styles.scoreNumTextOn]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.scoreGrid}>
              {[6, 7, 8, 9, 10].map(n => (
                <TouchableOpacity
                  key={n}
                  style={[styles.scoreNumBtn, selectedScore === n && styles.scoreNumBtnOn]}
                  onPress={() => setSelectedScore(n)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.scoreNumText, selectedScore === n && styles.scoreNumTextOn]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.submitBtn, !selectedScore && styles.submitBtnOff]}
              onPress={saveScore}
              disabled={!selectedScore}
              activeOpacity={0.85}
            >
              <Text style={styles.submitBtnText}>Save Hole {nextHole}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setModalVisible(false)} style={{ marginTop: spacing.sm }}>
              <Text style={{ color: colors.textMuted, fontSize: fonts.sm, textAlign: 'center' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },

  header: {
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { marginBottom: spacing.xs },
  backText: { fontSize: fonts.md, color: colors.gold, fontWeight: '600' },
  headerSub: { fontSize: fonts.xs, color: colors.textMuted, letterSpacing: 1 },

  scroll: { padding: spacing.md, paddingBottom: 100 },

  playerCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  playerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  playerAvatar: { width: 48, height: 48, borderRadius: 24, overflow: 'hidden' },
  avatarFallback: { backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: fonts.xl, fontWeight: '800', color: colors.white },
  playerInfo: { flex: 1, marginLeft: spacing.md },
  playerNameText: { fontSize: fonts.md, fontWeight: '800', color: colors.white },
  playerHcp: { fontSize: fonts.xs, color: colors.textMuted, marginTop: 2 },
  scoreBox: { alignItems: 'center' },
  scoreBoxVal: { fontSize: fonts.xxl, fontWeight: '900', color: colors.gold },
  scoreBoxLabel: { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1 },

  dotsRow: { flexDirection: 'row', gap: 3 },
  dot: { flex: 1, height: 8, borderRadius: 2, backgroundColor: colors.cardAlt },
  dotDone: { backgroundColor: colors.gold },
  dotActive: { borderWidth: 1.5, borderColor: colors.gold, backgroundColor: 'transparent' },
  dotsNumRow: { flexDirection: 'row', gap: 3, marginTop: 2 },
  dotNum: { flex: 1, fontSize: 7, color: colors.textMuted, textAlign: 'center' },
  dotNumActive: { color: colors.gold, fontWeight: '700' },

  holeCard: {
    alignItems: 'center', marginBottom: spacing.md,
    paddingVertical: spacing.lg, backgroundColor: colors.card,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
  },
  holeLabelSmall: { fontSize: fonts.xs, color: colors.textMuted, letterSpacing: 2, fontWeight: '700' },
  holeBig: { fontSize: 80, fontWeight: '900', color: colors.white, lineHeight: 88 },
  holeMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  holeMetaItem: { alignItems: 'center', paddingHorizontal: spacing.lg },
  holeMetaLabel: { fontSize: fonts.xs, color: colors.textMuted, letterSpacing: 1, fontWeight: '600' },
  holeMetaValue: { fontSize: fonts.xl, fontWeight: '800', color: colors.textSecondary, marginTop: 2 },
  holeMetaSep: { width: 1, height: 32, backgroundColor: colors.border },

  scoreBtn: {
    backgroundColor: colors.gold, borderRadius: radius.lg,
    paddingVertical: spacing.lg, alignItems: 'center', marginBottom: spacing.sm,
  },
  scoreBtnText: { fontSize: fonts.lg, fontWeight: '800', color: colors.bg, letterSpacing: 1 },
  undoBtn: { alignItems: 'center', paddingVertical: spacing.sm },
  undoText: { fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600' },

  completeCard: { alignItems: 'center', paddingVertical: spacing.xxl },
  completeStar: { fontSize: 48, color: colors.gold, marginBottom: spacing.md },
  completeTitle: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 3, marginBottom: spacing.sm },
  completeScore: { fontSize: 64, fontWeight: '900', color: colors.gold, letterSpacing: 2 },
  completeDetail: { fontSize: fonts.sm, color: colors.textSecondary, marginTop: spacing.xs },

  savingIndicator: {
    position: 'absolute', bottom: 40, alignSelf: 'center',
    backgroundColor: colors.card, borderRadius: radius.full,
    padding: spacing.sm + 4, borderWidth: 1, borderColor: colors.border,
  },

  // Mini scorecard
  miniCard: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm, marginTop: spacing.md,
  },
  miniTitle: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.sm },
  miniRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  miniLabel: { width: 36, fontSize: 8, fontWeight: '700', color: colors.textMuted },
  miniCell: { flex: 1, fontSize: 9, fontWeight: '600', color: colors.textSecondary, textAlign: 'center' },
  miniTot: { width: 28, fontSize: 9, fontWeight: '800', color: colors.white, textAlign: 'center' },
  miniScoreCell: { flex: 1, height: 20, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  miniScoreText: { fontSize: 9, fontWeight: '700', color: colors.textSecondary },
  miniBirdie: { backgroundColor: 'rgba(74,222,128,0.25)', borderWidth: 1, borderColor: colors.green },
  miniParCell: { backgroundColor: colors.cardAlt },
  miniBogey: { backgroundColor: 'rgba(248,113,113,0.15)' },
  miniDivider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingTop: spacing.lg, paddingBottom: 48, paddingHorizontal: spacing.lg,
    alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border,
  },
  modalTitle: { fontSize: fonts.xl, fontWeight: '900', color: colors.white, marginBottom: 4 },
  modalSub: { fontSize: fonts.xs, color: colors.textMuted, marginBottom: spacing.md },
  ptsBadge: {
    backgroundColor: 'rgba(212,175,55,0.15)', borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderWidth: 1, borderColor: colors.goldBorder, marginBottom: spacing.md,
  },
  ptsBadgeText: { fontSize: fonts.sm, color: colors.gold, fontWeight: '700' },
  scoreGrid: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, width: '100%' },
  scoreNumBtn: {
    flex: 1, height: 52, borderRadius: radius.md,
    backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  scoreNumBtnOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  scoreNumText: { fontSize: fonts.lg, fontWeight: '700', color: colors.textSecondary },
  scoreNumTextOn: { color: colors.bg },
  submitBtn: {
    marginTop: spacing.lg, width: '100%', backgroundColor: colors.gold,
    borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center',
  },
  submitBtnOff: { opacity: 0.35 },
  submitBtnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg, letterSpacing: 1 },
});
