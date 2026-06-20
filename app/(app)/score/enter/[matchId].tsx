import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import CourseMapView from '../../../../src/components/CourseMapView';
import { supabase } from '../../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../../src/lib/theme';
import {
  calcHoles,
  matchLabel,
  calcCourseHandicap,
  calcStrokesReceived,
  calcStablefordPoints,
} from '../../../../src/lib/scoring';
import { getPlayerAvatar } from '../../../../src/lib/assets';

interface MatchInfo {
  id: string;
  match_number: number;
  competition_id: string;
  status: 'upcoming' | 'in_progress' | 'complete';
  winner: string | null;
  result_str: string | null;
  holes_string: string;
  home_player_ids: string[];
  away_player_ids: string[];
  home_team: { name: string; accent_color: string } | null;
  away_team: { name: string; accent_color: string } | null;
  day: {
    course_name: string;
    course_par: number;
    course_rating: number;
    slope_rating: number;
    day_number: number;
    competition: { format: string } | null;
  } | null;
}

interface CourseHole { hole_number: number; par: number; stroke_index: number; }
interface CompPlayer { player_id: string; handicap_index: number; }

function playerCourseHcp(playerId: string, compPlayers: CompPlayer[], day: MatchInfo['day']): number {
  const cp = compPlayers.find(c => c.player_id === playerId);
  const hcpIndex = cp?.handicap_index ?? 0;
  if (!day?.slope_rating || !day?.course_rating || !day?.course_par) return Math.round(hcpIndex);
  return calcCourseHandicap(hcpIndex, day.slope_rating, day.course_rating, day.course_par);
}

export default function EnterScoresScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();

  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [courseHoles, setCourseHoles] = useState<CourseHole[]>([]);
  const [compPlayers, setCompPlayers] = useState<CompPlayer[]>([]);
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [courseLocation, setCourseLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Score entry modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [modalPlayerIdx, setModalPlayerIdx] = useState(0);
  const [holeScores, setHoleScores] = useState<Record<string, number>>({});
  const [selectedScore, setSelectedScore] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      const { data: matchData } = await supabase
        .from('matches')
        .select(`
          *,
          home_team:home_team_id(name,accent_color),
          away_team:away_team_id(name,accent_color),
          day:day_id(course_name,course_par,course_rating,slope_rating,day_number,competition:competition_id(format))
        `)
        .eq('id', matchId)
        .single();

      if (!matchData) { setLoading(false); return; }
      setMatch(matchData as unknown as MatchInfo);

      const allIds = [...(matchData.home_player_ids ?? []), ...(matchData.away_player_ids ?? [])];

      const [{ data: holesData }, { data: compData }, { data: playersData }, { data: locationData }] = await Promise.all([
        matchData.day?.course_name
          ? supabase.from('course_holes').select('hole_number,par,stroke_index').eq('course_name', matchData.day.course_name).order('hole_number')
          : Promise.resolve({ data: [] }),
        matchData.competition_id && allIds.length
          ? supabase.from('competition_players').select('player_id,handicap_index').eq('competition_id', matchData.competition_id).in('player_id', allIds)
          : Promise.resolve({ data: [] }),
        allIds.length
          ? supabase.from('players').select('id,display_name,handicap_index').in('id', allIds)
          : Promise.resolve({ data: [] }),
        matchData.day?.course_name
          ? supabase.from('courses').select('lat,lng').eq('name', matchData.day.course_name).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      if (holesData) setCourseHoles(holesData);
      if (locationData && (locationData as any).lat && (locationData as any).lng) {
        setCourseLocation({ lat: (locationData as any).lat, lng: (locationData as any).lng });
      }
      if (playersData) {
        const names: Record<string, string> = {};
        const fallback: CompPlayer[] = [];
        (playersData as any[]).forEach(p => {
          names[p.id] = p.display_name;
          fallback.push({ player_id: p.id, handicap_index: p.handicap_index ?? 0 });
        });
        setPlayerNames(names);
        // For casual games competition_players may be empty — fall back to players.handicap_index
        const comp = compData as CompPlayer[] | null;
        setCompPlayers(comp && comp.length > 0 ? comp : fallback);
      }
      setLoading(false);
    }
    load();
  }, [matchId]);

  // ── Derived values ──────────────────────────────────────────────
  const holesStr = (match?.holes_string ?? '..................').padEnd(18, '.').slice(0, 18);
  const holeChars = holesStr.split('');
  const firstUnplayedIdx = holeChars.findIndex(c => c === '.');
  const currentHole = firstUnplayedIdx === -1 ? 19 : firstUnplayedIdx + 1;
  const isComplete = match?.status === 'complete' || currentHole > 18;

  let lastPlayedHole = 0;
  for (let i = holeChars.length - 1; i >= 0; i--) {
    if (holeChars[i] !== '.') { lastPlayedHole = i + 1; break; }
  }

  const allPlayerIds = match ? [...match.home_player_ids, ...match.away_player_ids] : [];
  const courseHole = courseHoles.find(h => h.hole_number === currentHole);

  // Players receiving a shot on the current hole
  const shotPlayerIds = courseHole
    ? allPlayerIds.filter(id => {
        const hcp = playerCourseHcp(id, compPlayers, match?.day ?? null);
        return calcStrokesReceived(hcp, courseHole.stroke_index) >= 1;
      })
    : [];

  // Current player in the modal
  const modalPlayerId = allPlayerIds[modalPlayerIdx] ?? null;
  const isHomePlayer = modalPlayerId ? match?.home_player_ids.includes(modalPlayerId) : false;
  const modalPlayerName = modalPlayerId ? (playerNames[modalPlayerId] ?? '?') : '';
  const modalTeamColor = isHomePlayer
    ? (match?.home_team?.accent_color ?? colors.gold)
    : (match?.away_team?.accent_color ?? colors.textMuted);
  const modalTeamName = isHomePlayer ? match?.home_team?.name : match?.away_team?.name;
  const modalPlayerAvatar = modalPlayerId ? getPlayerAvatar(modalPlayerId, 'normal') : null;
  const modalPlayerGetsShot = modalPlayerId && courseHole
    ? shotPlayerIds.includes(modalPlayerId)
    : false;

  // ── Score entry modal ───────────────────────────────────────────
  function openScoreModal() {
    setHoleScores({});
    setSelectedScore(null);
    setModalPlayerIdx(0);
    setModalVisible(true);
  }

  function submitPlayerScore() {
    if (selectedScore === null || !modalPlayerId) return;

    const newScores = { ...holeScores, [modalPlayerId]: selectedScore };
    setHoleScores(newScores);
    setSelectedScore(null);

    const nextIdx = modalPlayerIdx + 1;
    if (nextIdx < allPlayerIds.length) {
      setModalPlayerIdx(nextIdx);
    } else {
      setModalVisible(false);
      processHoleScores(newScores);
    }
  }

  // ── Calculate and save hole result ──────────────────────────────
  async function processHoleScores(scores: Record<string, number>) {
    if (!match || !courseHole) return;
    setSaving(true);

    const si = courseHole.stroke_index;
    const par = courseHole.par;
    const day = match.day;

    const getNetScore = (id: string) => {
      const hcp = playerCourseHcp(id, compPlayers, day);
      const shots = calcStrokesReceived(hcp, si);
      return (scores[id] ?? 99) - shots;
    };

    const homeNet = Math.min(...match.home_player_ids.map(getNetScore));
    const awayNet = Math.min(...match.away_player_ids.map(getNetScore));
    const holeResult: 'h' | 'a' | 'f' = homeNet < awayNet ? 'h' : awayNet < homeNet ? 'a' : 'f';

    // Clear existing match_holes rows for this hole then insert fresh
    const { error: delErr } = await supabase.from('match_holes').delete()
      .eq('match_id', matchId)
      .eq('hole_number', currentHole);
    if (delErr) console.error('match_holes delete error:', delErr);

    const rows = allPlayerIds.map(id => {
      const hcp = playerCourseHcp(id, compPlayers, day);
      const shots = calcStrokesReceived(hcp, si);
      const gross = scores[id] ?? null;
      return {
        match_id: matchId,
        player_id: id,
        hole_number: currentHole,
        score: holeResult,
        gross_score: gross,
        stableford_pts: calcStablefordPoints(gross, par, shots),
      };
    });

    const { error: insErr } = await supabase.from('match_holes').insert(rows);
    if (insErr) console.error('match_holes insert error:', insErr);

    // Update holes_string and match status
    const chars = [...holeChars];
    chars[currentHole - 1] = holeResult;
    const newHolesStr = chars.join('');
    const { homeUp, played, remaining, concluded } = calcHoles(newHolesStr);

    let newStatus: 'upcoming' | 'in_progress' | 'complete' = 'in_progress';
    let winner: string | null = null;
    let result_str: string | null = null;

    if (concluded) {
      newStatus = 'complete';
      winner = homeUp > 0 ? 'home' : 'away';
      result_str = `${Math.abs(homeUp)}&${remaining}`;
    } else if (played === 18) {
      newStatus = 'complete';
      if (homeUp === 0) { winner = 'half'; result_str = 'Halved'; }
      else { winner = homeUp > 0 ? 'home' : 'away'; result_str = `${Math.abs(homeUp)}UP`; }
    }

    const { error } = await supabase.from('matches')
      .update({ holes_string: newHolesStr, status: newStatus, winner, result_str })
      .eq('id', match.id);

    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }

    setMatch({ ...match, holes_string: newHolesStr, status: newStatus, winner, result_str });

    if (newStatus === 'complete') {
      const winTeam = winner === 'home' ? match.home_team?.name : winner === 'away' ? match.away_team?.name : null;
      const msg = winner === 'half' ? 'Match Halved!' : `${winTeam} win ${result_str}!`;
      Alert.alert('Match Complete', msg, [{ text: 'Done', onPress: () => router.back() }]);
    }
  }

  // ── Undo last hole ──────────────────────────────────────────────
  async function undoHole() {
    if (!match || saving || lastPlayedHole === 0) return;
    setSaving(true);

    await supabase.from('match_holes').delete()
      .eq('match_id', matchId)
      .eq('hole_number', lastPlayedHole);

    const chars = [...holeChars];
    chars[lastPlayedHole - 1] = '.';
    const newHolesStr = chars.join('');
    const { played } = calcHoles(newHolesStr);
    const newStatus = played === 0 ? 'upcoming' : 'in_progress';

    const { error } = await supabase.from('matches')
      .update({ holes_string: newHolesStr, status: newStatus, winner: null, result_str: null })
      .eq('id', match.id);

    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setMatch({ ...match, holes_string: newHolesStr, status: newStatus, winner: null, result_str: null });
  }

  // ── Render ──────────────────────────────────────────────────────
  if (loading) return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.gold} size="large" />
    </View>
  );

  if (!match) return (
    <View style={styles.centered}>
      <Text style={{ color: colors.textSecondary }}>Match not found.</Text>
    </View>
  );

  const label = matchLabel(match.status, match.winner, match.result_str, holesStr);
  const homeColor = match.home_team?.accent_color ?? colors.gold;
  const awayColor = match.away_team?.accent_color ?? colors.textMuted;
  const HOLE_BG: Record<string, string> = { h: homeColor, a: awayColor, f: colors.grey };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerSub}>
          {match.day?.competition?.format === 'casual'
            ? `Casual · ${match.day?.course_name} · Live Scoring`
            : `Day ${match.day?.day_number} · Match ${match.match_number} · Live Scoring`}
        </Text>
      </View>

      {/* Score bar */}
      <View style={styles.scoreBar}>
        <Text style={[styles.scoreTeam, { color: homeColor }]} numberOfLines={1}>
          {match.home_team?.name}
        </Text>
        <View style={styles.scoreLabelBox}>
          <Text style={styles.scoreLabel}>{label}</Text>
        </View>
        <Text style={[styles.scoreTeam, { color: awayColor, textAlign: 'right' }]} numberOfLines={1}>
          {match.away_team?.name}
        </Text>
      </View>

      {/* Hole progress dots */}
      <View style={styles.dotsRow}>
        {Array.from({ length: 18 }, (_, i) => {
          const c = holeChars[i] ?? '.';
          const isActive = i + 1 === currentHole && !isComplete;
          const bg = c !== '.' ? (HOLE_BG[c] ?? colors.grey) : colors.cardAlt;
          return (
            <View key={i} style={[styles.dot, { backgroundColor: bg }, isActive && styles.dotActive]} />
          );
        })}
      </View>
      <View style={styles.dotsLabelRow}>
        {Array.from({ length: 18 }, (_, i) => (
          <Text key={i} style={[styles.dotNum, i + 1 === currentHole && !isComplete && styles.dotNumActive]}>
            {i + 1}
          </Text>
        ))}
      </View>

      {courseLocation && (
        <View style={styles.mapStrip}>
          <CourseMapView
            lat={courseLocation.lat}
            lng={courseLocation.lng}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />
          <View style={styles.mapStripLabel}>
            <Text style={styles.mapStripLabelText}>{match.day?.course_name}</Text>
          </View>
        </View>
      )}

      {!isComplete ? (
        <>
          {/* Current hole card */}
          <View style={styles.holeCard}>
            <Text style={styles.holeLabelSmall}>HOLE</Text>
            <Text style={styles.holeBig}>{currentHole}</Text>

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
              </View>
            )}

            {/* Shot receivers — tiny player faces */}
            {shotPlayerIds.length > 0 && (
              <View style={styles.shotRow}>
                <Text style={styles.shotLabel}>Gets a shot</Text>
                <View style={styles.shotAvatars}>
                  {shotPlayerIds.map(id => {
                    const avatar = getPlayerAvatar(id, 'normal');
                    const isHome = match.home_player_ids.includes(id);
                    const teamColor = isHome ? homeColor : awayColor;
                    return (
                      <View key={id} style={[styles.shotAvatarWrap, { borderColor: teamColor }]}>
                        {avatar ? (
                          <Image source={avatar} style={styles.shotAvatar} />
                        ) : (
                          <View style={[styles.shotAvatar, styles.shotAvatarFallback]}>
                            <Text style={styles.shotAvatarInitial}>
                              {(playerNames[id] ?? '?')[0]}
                            </Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </View>

          {/* Score this hole button */}
          <TouchableOpacity
            style={styles.scoreHoleBtn}
            onPress={openScoreModal}
            disabled={saving}
            activeOpacity={0.85}
          >
            <Text style={styles.scoreHoleBtnText}>Score Hole {currentHole}</Text>
          </TouchableOpacity>

          {lastPlayedHole > 0 && (
            <TouchableOpacity style={styles.undoBtn} onPress={undoHole} disabled={saving}>
              <Text style={styles.undoText}>Undo Hole {lastPlayedHole}</Text>
            </TouchableOpacity>
          )}
        </>
      ) : (
        <View style={styles.completeCard}>
          <Text style={styles.completeStar}>★</Text>
          <Text style={styles.completeTitle}>MATCH COMPLETE</Text>
          <Text style={styles.completeResult}>{match.result_str ?? 'Done'}</Text>
          <Text style={styles.completeWinner}>
            {match.winner === 'half'
              ? 'Match Halved'
              : `${match.winner === 'home' ? match.home_team?.name : match.away_team?.name} Win`}
          </Text>
          {lastPlayedHole > 0 && (
            <TouchableOpacity style={[styles.undoBtn, { marginTop: spacing.xl }]} onPress={undoHole} disabled={saving}>
              <Text style={styles.undoText}>Undo Last Hole</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {saving && (
        <View style={styles.savingIndicator}>
          <ActivityIndicator color={colors.gold} size="small" />
        </View>
      )}

      {/* ── Score entry modal ───────────────────────────────────── */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => {}}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>

            {/* Progress dots */}
            <View style={styles.modalProgress}>
              {allPlayerIds.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.progressDot,
                    i < modalPlayerIdx && styles.progressDotDone,
                    i === modalPlayerIdx && styles.progressDotActive,
                  ]}
                />
              ))}
            </View>

            {/* Team label */}
            <Text style={[styles.modalTeamLabel, { color: modalTeamColor }]}>
              {modalTeamName?.toUpperCase()}
            </Text>

            {/* Player photo */}
            <View style={[styles.modalAvatarWrap, { borderColor: modalTeamColor }]}>
              {modalPlayerAvatar ? (
                <Image source={modalPlayerAvatar} style={styles.modalAvatar} />
              ) : (
                <View style={[styles.modalAvatar, styles.modalAvatarFallback]}>
                  <Text style={styles.modalAvatarInitial}>{modalPlayerName[0] ?? '?'}</Text>
                </View>
              )}
            </View>

            <Text style={styles.modalPlayerName}>{modalPlayerName}</Text>

            {modalPlayerGetsShot && (
              <View style={styles.shotBadge}>
                <Text style={styles.shotBadgeText}>★ Gets a shot on this hole</Text>
              </View>
            )}

            {/* Score buttons 1–10 */}
            <View style={styles.scoreGrid}>
              {[1, 2, 3, 4, 5].map(n => (
                <TouchableOpacity
                  key={n}
                  style={[styles.scoreBtn, selectedScore === n && { backgroundColor: modalTeamColor }]}
                  onPress={() => setSelectedScore(n)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.scoreBtnText, selectedScore === n && styles.scoreBtnTextSelected]}>
                    {n}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.scoreGrid}>
              {[6, 7, 8, 9, 10].map(n => (
                <TouchableOpacity
                  key={n}
                  style={[styles.scoreBtn, selectedScore === n && { backgroundColor: modalTeamColor }]}
                  onPress={() => setSelectedScore(n)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.scoreBtnText, selectedScore === n && styles.scoreBtnTextSelected]}>
                    {n}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Submit */}
            <TouchableOpacity
              style={[styles.submitBtn, !selectedScore && styles.submitBtnDisabled]}
              onPress={submitPlayerScore}
              disabled={!selectedScore}
              activeOpacity={0.85}
            >
              <Text style={styles.submitBtnText}>
                {modalPlayerIdx < allPlayerIds.length - 1 ? 'Next Player' : 'Calculate Hole'}
              </Text>
            </TouchableOpacity>

          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },

  header: {
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { marginBottom: spacing.xs },
  backText: { fontSize: fonts.md, color: colors.gold, fontWeight: '600' },
  headerSub: { fontSize: fonts.xs, color: colors.textMuted, letterSpacing: 1 },

  scoreBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  scoreTeam: { flex: 1, fontSize: fonts.md, fontWeight: '700' },
  scoreLabelBox: { paddingHorizontal: spacing.sm },
  scoreLabel: { fontSize: fonts.xxl, fontWeight: '900', color: colors.live, textAlign: 'center', minWidth: 80 },

  dotsRow: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingTop: spacing.lg, gap: 3 },
  dot: { flex: 1, height: 10, borderRadius: 2 },
  dotActive: { borderWidth: 1.5, borderColor: colors.gold, backgroundColor: 'transparent' },
  dotsLabelRow: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingTop: 3, paddingBottom: spacing.lg, gap: 3 },
  dotNum: { flex: 1, fontSize: 8, color: colors.textMuted, textAlign: 'center' },
  dotNumActive: { color: colors.gold, fontWeight: '700' },

  mapStrip: {
    height: 120,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  mapStripLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
  },
  mapStripLabelText: {
    fontSize: fonts.xs,
    fontWeight: '700',
    color: colors.white,
    letterSpacing: 0.5,
  },

  holeCard: {
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingVertical: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  holeLabelSmall: { fontSize: fonts.xs, color: colors.textMuted, letterSpacing: 2, fontWeight: '700' },
  holeBig: { fontSize: 80, fontWeight: '900', color: colors.white, lineHeight: 88 },
  holeMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  holeMetaItem: { alignItems: 'center', paddingHorizontal: spacing.xl },
  holeMetaLabel: { fontSize: fonts.xs, color: colors.textMuted, letterSpacing: 1, fontWeight: '600' },
  holeMetaValue: { fontSize: fonts.xl, fontWeight: '800', color: colors.textSecondary, marginTop: 2 },
  holeMetaSep: { width: 1, height: 32, backgroundColor: colors.border },

  shotRow: { alignItems: 'center', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, width: '100%', paddingHorizontal: spacing.lg },
  shotLabel: { fontSize: fonts.xs, color: colors.textMuted, letterSpacing: 1, marginBottom: spacing.xs },
  shotAvatars: { flexDirection: 'row', gap: spacing.sm },
  shotAvatarWrap: { borderRadius: 20, borderWidth: 2, overflow: 'hidden' },
  shotAvatar: { width: 36, height: 36 },
  shotAvatarFallback: { backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  shotAvatarInitial: { fontSize: fonts.sm, fontWeight: '700', color: colors.white },

  scoreHoleBtn: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.gold,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  scoreHoleBtnText: { fontSize: fonts.lg, fontWeight: '800', color: colors.bg, letterSpacing: 1 },

  undoBtn: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.xs },
  undoText: { fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600', letterSpacing: 0.5 },

  completeCard: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  completeStar: { fontSize: 48, color: colors.gold, marginBottom: spacing.md },
  completeTitle: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 3, marginBottom: spacing.sm },
  completeResult: { fontSize: 64, fontWeight: '900', color: colors.gold, letterSpacing: 2 },
  completeWinner: { fontSize: fonts.lg, fontWeight: '600', color: colors.white, marginTop: spacing.sm },

  savingIndicator: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.full,
    padding: spacing.sm + 4,
    borderWidth: 1,
    borderColor: colors.border,
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.lg,
    paddingBottom: 48,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  modalProgress: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  progressDotDone: { backgroundColor: colors.grey },
  progressDotActive: { backgroundColor: colors.gold, borderColor: colors.gold },

  modalTeamLabel: { fontSize: fonts.xs, fontWeight: '700', letterSpacing: 2, marginBottom: spacing.md },

  modalAvatarWrap: { borderRadius: 52, borderWidth: 3, overflow: 'hidden', marginBottom: spacing.sm },
  modalAvatar: { width: 100, height: 100 },
  modalAvatarFallback: { backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  modalAvatarInitial: { fontSize: 40, fontWeight: '800', color: colors.white },

  modalPlayerName: { fontSize: fonts.xl, fontWeight: '800', color: colors.white, marginBottom: spacing.xs },

  shotBadge: {
    backgroundColor: 'rgba(212,175,55,0.15)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    marginBottom: spacing.md,
  },
  shotBadgeText: { fontSize: fonts.xs, color: colors.gold, fontWeight: '700', letterSpacing: 0.5 },

  scoreGrid: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, width: '100%' },
  scoreBtn: {
    flex: 1,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  scoreBtnText: { fontSize: fonts.lg, fontWeight: '700', color: colors.textSecondary },
  scoreBtnTextSelected: { color: colors.white },

  submitBtn: {
    marginTop: spacing.lg,
    width: '100%',
    backgroundColor: colors.gold,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.35 },
  submitBtnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg, letterSpacing: 1 },
});
