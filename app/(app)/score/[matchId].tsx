import { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Image,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';
import { matchLabel, getEffectiveWinner, calcHoles } from '../../../src/lib/scoring';
import { getPlayerAvatar, teamLogos } from '../../../src/lib/assets';

interface HoleResult { hole_number: number; score: 'h' | 'a' | 'f' | null; gross_score: number | null; stableford_pts: number | null; player_id: string; }
interface CourseHole { hole_number: number; par: number; stroke_index: number; yardage: number | null; hole_name: string | null; }
interface Player { id: string; display_name: string; avatar_url?: string | null; }

interface MatchDetail {
  id: string;
  match_number: number;
  status: 'upcoming' | 'in_progress' | 'complete';
  winner: string | null;
  result_str: string | null;
  holes_string: string;
  is_singles: boolean;
  round_format: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_player_ids: string[];
  away_player_ids: string[];
  hcp_allowance: number;
  side_games: string[];
  home_team: { name: string; accent_color: string } | null;
  away_team: { name: string; accent_color: string } | null;
  day: { course_name: string; course_par: number; day_number: number; competition: { format: string } | null } | null;
}

const HOLE_COLORS: Record<string, string> = {
  h: colors.green,
  a: colors.red,
  f: colors.grey,
};

export default function MatchDetailScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [holeResults, setHoleResults] = useState<HoleResult[]>([]);
  const [courseHoles, setCourseHoles] = useState<CourseHole[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cardPage, setCardPage] = useState(0);
  const { width: screenWidth } = useWindowDimensions();
  async function load() {
    const { data: matchData } = await supabase
      .from('matches')
      .select(`*, home_team:home_team_id(name,accent_color), away_team:away_team_id(name,accent_color), day:day_id(course_name,course_par,day_number,competition:competition_id(format))`)
      .eq('id', matchId)
      .single();

    if (!matchData) { setLoading(false); return; }
    setMatch(matchData as unknown as MatchDetail);

    const allPlayerIds = [...(matchData.home_player_ids ?? []), ...(matchData.away_player_ids ?? [])];

    const [{ data: holesData }, { data: courseHoleData }, { data: playersData }] = await Promise.all([
      supabase.from('match_holes').select('*').eq('match_id', matchId),
      matchData.day?.course_name
        ? supabase.from('course_holes').select('*').eq('course_name', matchData.day.course_name).order('hole_number')
        : Promise.resolve({ data: [] }),
      allPlayerIds.length
        ? supabase.from('players').select('id,display_name,avatar_url').in('id', allPlayerIds)
        : Promise.resolve({ data: [] }),
    ]);

    if (holesData) setHoleResults(holesData);
    if (courseHoleData) setCourseHoles(courseHoleData);
    if (playersData) setPlayers(playersData);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    load();
    const sub = supabase
      .channel(`match-${matchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_holes', filter: `match_id=eq.${matchId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [matchId]);

  function deleteMatch() {
    Alert.alert('Delete Game', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: () => {
          supabase.from('matches').delete().eq('id', matchId)
            .then(({ error }) => {
              if (error) {
                console.error('delete match error:', JSON.stringify(error));
                Alert.alert('Error', error.message ?? 'Could not delete game');
              } else {
                router.back();
              }
            });
        },
      },
    ]);
  }

  const playerName = (id: string) => players.find(p => p.id === id)?.display_name?.split(' ')[0] ?? '?';
  const holesForPlayer = (pid: string) => holeResults.filter(h => h.player_id === pid);
  const grossForHole = (pid: string, hole: number) => holeResults.find(h => h.player_id === pid && h.hole_number === hole)?.gross_score ?? null;
  const stablefordForHole = (pid: string, hole: number) => holeResults.find(h => h.player_id === pid && h.hole_number === hole)?.stableford_pts ?? null;

  function renderSideVisual(
    playerIds: string[],
    team: { name: string; accent_color: string } | null,
    teamId: string | null,
    color: string,
  ) {
    if (teamId && team) {
      const logo = teamLogos[team.name];
      if (logo) return <Image source={logo} style={styles.sideTeamLogo} resizeMode="contain" />;
      return <View style={[styles.sideColorBar, { backgroundColor: color }]} />;
    }
    if (playerIds.length === 1) {
      const raw = players.find(p => p.id === playerIds[0])?.avatar_url ?? getPlayerAvatar(playerIds[0], 'normal');
      return raw
        ? <Image source={typeof raw === 'string' ? { uri: raw } : raw} style={styles.sideAvatar} />
        : <View style={[styles.sideAvatar, styles.sideAvatarFallback]}><Text style={styles.sideAvatarInitial}>{playerName(playerIds[0])[0]}</Text></View>;
    }
    return (
      <View style={styles.sidePairRow}>
        {playerIds.map((id, i) => {
          const raw = players.find(p => p.id === id)?.avatar_url ?? getPlayerAvatar(id, 'normal');
          return raw
            ? <Image key={id} source={typeof raw === 'string' ? { uri: raw } : raw} style={[styles.sidePairAv, i > 0 && styles.sidePairOverlap]} />
            : <View key={id} style={[styles.sidePairAv, styles.sideAvatarFallback, i > 0 && styles.sidePairOverlap]}><Text style={styles.sidePairInitial}>{playerName(id)[0]}</Text></View>;
        })}
      </View>
    );
  }

  const holesStr = match?.holes_string ?? '..................';
  const holeChars = holesStr.split('');

  const status = match?.status ?? 'upcoming';
  const label = match ? matchLabel(status, match.winner, match.result_str, holesStr) : '';
  const winner = match ? getEffectiveWinner(status, match.winner, holesStr) : null;
  const { homeUp } = calcHoles(holesStr);
  const currentlyAhead = status === 'complete'
    ? winner
    : homeUp > 0 ? 'home' : homeUp < 0 ? 'away' : null;

  const homeColor = match?.home_team?.accent_color ?? colors.textMuted;
  const awayColor = match?.away_team?.accent_color ?? colors.textMuted;

  if (loading) return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.gold} size="large" />
    </View>
  );

  if (!match) return (
    <View style={styles.centered}>
      <Text style={styles.errorText}>Match not found.</Text>
    </View>
  );

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
            ? `Casual · ${match.day?.course_name}`
            : `Day ${match.day?.day_number} · ${match.day?.course_name} · Match ${match.match_number}`}
        </Text>
      </View>

      {status !== 'complete' && (
        <TouchableOpacity
          style={styles.enterScoresBtn}
          onPress={() => {
            const isSolo = match.away_player_ids.length === 0 && match.home_player_ids.length === 1;
            if (isSolo) { router.push(`/(app)/score/solo/${matchId}` as any); return; }
            const fmt = match?.round_format ?? '';
            const routes: Record<string, string> = {
              skins:               `/(app)/score/skins/${matchId}`,
              nassau:              `/(app)/score/nassau/${matchId}`,
              wolf:                `/(app)/score/wolf/${matchId}`,
              scramble:            `/(app)/score/scramble/${matchId}`,
              bbb:                 `/(app)/score/bbb/${matchId}`,
              modified_stableford: `/(app)/score/modified/${matchId}`,
              par_bogey:           `/(app)/score/parbogey/${matchId}`,
              chacha:              `/(app)/score/chacha/${matchId}`,
            };
            router.push((routes[fmt] ?? `/(app)/score/enter/${matchId}`) as any);
          }}
          activeOpacity={0.85}
        >
          <Text style={styles.enterScoresBtnText}>Enter Scores</Text>
        </TouchableOpacity>
      )}

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />}>

        {/* Match status card */}
        <View style={styles.matchCard}>
          <View style={styles.teamsRow}>

            {/* Home side */}
            <View style={styles.teamBlock}>
              {renderSideVisual(match.home_player_ids, match.home_team, match.home_team_id, homeColor)}
              <Text style={[styles.teamLabel, winner === 'home' && styles.teamWinner]} numberOfLines={1}>
                {match.home_team?.name ?? match.home_player_ids.map(playerName).join(' & ')}
              </Text>
              {match.home_team && (
                <Text style={styles.playerNames}>{match.home_player_ids.map(playerName).join(' & ')}</Text>
              )}
            </View>

            {/* Status + arrow */}
            <View style={styles.statusBlock}>
              {status === 'in_progress' && <View style={styles.liveDot} />}
              {currentlyAhead === 'home' && <Text style={[styles.winArrow, { color: homeColor }]}>◀</Text>}
              <Text style={[styles.statusLabel,
                status === 'in_progress' && styles.statusLive,
                status === 'complete' && styles.statusComplete,
              ]}>{label}</Text>
              {currentlyAhead === 'away' && <Text style={[styles.winArrow, { color: awayColor }]}>▶</Text>}
            </View>

            {/* Away side */}
            <View style={[styles.teamBlock, styles.teamBlockRight]}>
              {renderSideVisual(match.away_player_ids, match.away_team, match.away_team_id, awayColor)}
              <Text style={[styles.teamLabel, winner === 'away' && styles.teamWinner]} numberOfLines={1}>
                {match.away_team?.name ?? match.away_player_ids.map(playerName).join(' & ')}
              </Text>
              {match.away_team && (
                <Text style={styles.playerNames}>{match.away_player_ids.map(playerName).join(' & ')}</Text>
              )}
            </View>

          </View>
        </View>

        {/* Side games + settings */}
        {((match.side_games?.length > 0) || match.hcp_allowance !== 100) && (
          <View style={styles.tagsRow}>
            {match.hcp_allowance !== 100 && (
              <View style={styles.tag}>
                <Text style={styles.tagText}>{match.hcp_allowance === 0 ? 'Scratch' : `${match.hcp_allowance}% HCP`}</Text>
              </View>
            )}
            {match.side_games?.map(g => (
              <View key={g} style={[styles.tag, styles.tagGold]}>
                <Text style={[styles.tagText, styles.tagTextGold]}>{g}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Hole-by-hole matchplay grid */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>HOLE BY HOLE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.holeGrid}>
            {/* Header row */}
            <View style={styles.holeRow}>
              <Text style={[styles.holeCell, styles.holeLabelCell]}>HOLE</Text>
              {Array.from({ length: 18 }, (_, i) => (
                <Text key={i} style={[styles.holeCell, styles.holeNumCell]}>{i + 1}</Text>
              ))}
            </View>
            {/* Par row */}
            {courseHoles.length > 0 && (
              <View style={styles.holeRow}>
                <Text style={[styles.holeCell, styles.holeLabelCell, styles.parLabel]}>PAR</Text>
                {courseHoles.map(h => (
                  <Text key={h.hole_number} style={[styles.holeCell, styles.holeNumCell, styles.parLabel]}>{h.par}</Text>
                ))}
              </View>
            )}
            {/* Result row */}
            <View style={styles.holeRow}>
              <Text style={[styles.holeCell, styles.holeLabelCell]}>RESULT</Text>
              {holeChars.map((c, i) => (
                <View key={i} style={[styles.holeCell, styles.resultCell, c !== '.' && { backgroundColor: HOLE_COLORS[c] ?? 'transparent' }]}>
                  <Text style={styles.resultChar}>{c === '.' ? '' : c.toUpperCase()}</Text>
                </View>
              ))}
            </View>
          </View>
          </ScrollView>
        </View>

        {/* Player scorecards — horizontal pager */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SCORECARDS</Text>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={e => setCardPage(Math.round(e.nativeEvent.contentOffset.x / screenWidth))}
            style={{ marginHorizontal: -spacing.md }}
          >
            {[
              ...match.home_player_ids.map(pid => ({ pid, color: homeColor })),
              ...match.away_player_ids.map(pid => ({ pid, color: awayColor })),
            ].map(({ pid, color }) => {
              const name = players.find(p => p.id === pid)?.display_name?.split(' ')[0] ?? '—';
              const gross = (hole: number) => grossForHole(pid, hole);
              const pts   = (hole: number) => stablefordForHole(pid, hole);

              const front = courseHoles.filter(h => h.hole_number <= 9).sort((a, b) => a.hole_number - b.hole_number);
              const back  = courseHoles.filter(h => h.hole_number >= 10).sort((a, b) => a.hole_number - b.hole_number);

              const frontPar   = front.reduce((s, h) => s + h.par, 0);
              const backPar    = back.reduce((s, h) => s + h.par, 0);
              const frontGross = front.reduce((s, h) => s + (gross(h.hole_number) ?? 0), 0);
              const backGross  = back.reduce((s, h) => s + (gross(h.hole_number) ?? 0), 0);
              const frontPts   = front.reduce((s, h) => s + (pts(h.hole_number) ?? 0), 0);
              const backPts    = back.reduce((s, h) => s + (pts(h.hole_number) ?? 0), 0);
              const totGross   = frontGross + backGross;
              const totPts     = frontPts + backPts;
              const hasScores  = courseHoles.some(h => gross(h.hole_number) !== null);

              const SL = 32; const SC = 26; const ST = 30;

              const ScCell = ({ val, par: p }: { val: number | null; par: number | null }) => {
                const diff = val !== null && p !== null ? val - p : null;
                return (
                  <View style={[
                    styles.scScoreCell, { width: SC },
                    diff !== null && diff < 0 && styles.scBirdie,
                    diff !== null && diff === 0 && styles.scPar,
                    diff !== null && diff > 0 && styles.scBogey,
                  ]}>
                    <Text style={styles.scScoreText}>{val ?? '·'}</Text>
                  </View>
                );
              };

              const renderHalf = (holes: CourseHole[], outLabel: string, showTot: boolean) => (
                <View>
                  <View style={styles.scRow}>
                    <Text style={[styles.scLabel, { width: SL }]}>HOLE</Text>
                    {holes.map(h => <Text key={h.hole_number} style={[styles.scHoleNum, { width: SC }]}>{h.hole_number}</Text>)}
                    <Text style={[styles.scTotLabel, { width: ST }]}>{outLabel}</Text>
                    {showTot && <Text style={[styles.scTotLabel, { width: ST }]}>TOT</Text>}
                  </View>
                  <View style={styles.scRow}>
                    <Text style={[styles.scLabel, { width: SL }]}>SI</Text>
                    {holes.map(h => <Text key={h.hole_number} style={[styles.scMuted, { width: SC }]}>{h.stroke_index}</Text>)}
                    <Text style={{ width: ST }} />
                    {showTot && <Text style={{ width: ST }} />}
                  </View>
                  <View style={[styles.scRow, styles.scParRow]}>
                    <Text style={[styles.scLabel, { width: SL }]}>PAR</Text>
                    {holes.map(h => <Text key={h.hole_number} style={[styles.scParText, { width: SC }]}>{h.par}</Text>)}
                    <Text style={[styles.scTot, { width: ST }]}>{holes.reduce((s, h) => s + h.par, 0)}</Text>
                    {showTot && <Text style={[styles.scTot, { width: ST }]}>{frontPar + backPar}</Text>}
                  </View>
                  <View style={styles.scRow}>
                    <Text style={[styles.scLabel, styles.scPlayerLabel, { width: SL, color }]} numberOfLines={1}>{name}</Text>
                    {holes.map(h => <ScCell key={h.hole_number} val={gross(h.hole_number)} par={h.par} />)}
                    <Text style={[styles.scTot, styles.scTotBold, { width: ST }]}>
                      {holes.reduce((s, h) => s + (gross(h.hole_number) ?? 0), 0) || '·'}
                    </Text>
                    {showTot && <Text style={[styles.scTot, styles.scTotBold, { width: ST, color: colors.gold }]}>{totGross || '·'}</Text>}
                  </View>
                  <View style={[styles.scRow, styles.scPtsRow]}>
                    <Text style={[styles.scLabel, { width: SL }]}>PTS</Text>
                    {holes.map(h => <Text key={h.hole_number} style={[styles.scPtsCell, { width: SC }]}>{pts(h.hole_number) ?? '·'}</Text>)}
                    <Text style={[styles.scTot, styles.scGold, { width: ST }]}>
                      {holes.reduce((s, h) => s + (pts(h.hole_number) ?? 0), 0) || '·'}
                    </Text>
                    {showTot && <Text style={[styles.scTot, styles.scGold, { width: ST }]}>{totPts || '·'}</Text>}
                  </View>
                </View>
              );

              return (
                <View key={pid} style={{ width: screenWidth, paddingHorizontal: spacing.md }}>
                  <View style={styles.scorecardCard}>
                    <View style={styles.scorecardHeader}>
                      <View style={[styles.scorecardDot, { backgroundColor: color }]} />
                      <Text style={styles.scorecardName}>{name}</Text>
                      {hasScores && <Text style={styles.scorecardTotal}>{totGross}</Text>}
                      {hasScores && totPts > 0 && <Text style={styles.scorecardStableford}>{totPts} pts</Text>}
                    </View>
                    {renderHalf(front, 'OUT', false)}
                    <View style={styles.scDivider} />
                    {renderHalf(back, 'IN', true)}
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <View style={styles.cardPageDots}>
            {[...match.home_player_ids, ...match.away_player_ids].map((_, i) => (
              <View key={i} style={[styles.cardPageDot, cardPage === i && styles.cardPageDotActive]} />
            ))}
          </View>
        </View>

        {/* Delete game */}
        <TouchableOpacity style={styles.deleteBtn} onPress={deleteMatch} activeOpacity={0.7}>
          <Text style={styles.deleteBtnText}>Delete Game</Text>
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

const CELL_W = 32;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  errorText: { color: colors.textSecondary, fontSize: fonts.md },
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
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },

  matchCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  teamsRow: { flexDirection: 'row', alignItems: 'center' },
  teamBlock: { flex: 1 },
  teamBlockRight: { alignItems: 'flex-end' },
  sideColorBar: { width: 28, height: 3, borderRadius: 2, marginBottom: 6 },
  sideTeamLogo: { width: 48, height: 48, borderRadius: 6, marginBottom: 6 },
  sideAvatar: { width: 48, height: 48, borderRadius: 24, overflow: 'hidden', marginBottom: 6 },
  sideAvatarFallback: { backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  sideAvatarInitial: { fontSize: fonts.lg, fontWeight: '800', color: colors.white },
  sidePairRow: { flexDirection: 'row', marginBottom: 6 },
  sidePairAv: { width: 38, height: 38, borderRadius: 19, overflow: 'hidden' },
  sidePairOverlap: { marginLeft: -10 },
  sidePairInitial: { fontSize: fonts.sm, fontWeight: '700', color: colors.white },
  teamLabel: { fontSize: fonts.md, fontWeight: '800', color: colors.textSecondary },
  teamWinner: { color: colors.white },
  playerNames: { fontSize: fonts.xs, color: colors.textMuted, marginTop: 2 },
  statusBlock: { alignItems: 'center', paddingHorizontal: spacing.sm },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.live, marginBottom: 4 },
  winArrow: { fontSize: fonts.lg, fontWeight: '900', marginVertical: 2 },
  statusLabel: { fontSize: fonts.xl, fontWeight: '900', color: colors.textSecondary, letterSpacing: 0.5 },
  statusLive: { color: colors.live },
  statusComplete: { color: colors.gold },

  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  tag: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  tagGold: { backgroundColor: colors.goldDim, borderColor: colors.goldBorder },
  tagText: { fontSize: fonts.xs, fontWeight: '600', color: colors.textMuted },
  tagTextGold: { color: colors.gold },
  cardPageDots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: spacing.sm },
  cardPageDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  cardPageDotActive: { backgroundColor: colors.gold, borderColor: colors.gold, width: 18 },
  deleteBtn: { alignItems: 'center', paddingVertical: spacing.lg, marginTop: spacing.lg },
  deleteBtnText: { fontSize: fonts.sm, fontWeight: '600', color: colors.live, letterSpacing: 0.5 },
  section: { marginBottom: spacing.lg },
  sectionTitle: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.sm },

  holeGrid: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  holeRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  holeCell: { width: CELL_W, height: 28, alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 9, color: colors.textMuted, fontWeight: '600' },
  holeLabelCell: { width: 52, paddingLeft: spacing.xs, textAlign: 'left', fontSize: 9, color: colors.textMuted },
  holeNumCell: { fontSize: 10, color: colors.textSecondary },
  parLabel: { color: colors.textMuted },
  resultCell: { alignItems: 'center', justifyContent: 'center', borderRadius: 0 },
  resultChar: { fontSize: 10, fontWeight: '800', color: colors.white },

  enterScoresBtn: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
  },
  enterScoresBtnText: {
    fontSize: fonts.md,
    fontWeight: '700',
    color: colors.bg,
    letterSpacing: 1,
  },

  scorecardCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  scorecardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.xs, paddingHorizontal: spacing.xs },
  scorecardDot: { width: 8, height: 8, borderRadius: 4 },
  scorecardName: { flex: 1, fontSize: fonts.sm, fontWeight: '700', color: colors.white },
  scorecardTotal: { fontSize: fonts.sm, fontWeight: '800', color: colors.gold },
  scorecardStableford: { fontSize: fonts.xs, fontWeight: '600', color: colors.textMuted },
  scDivider: { height: 1, backgroundColor: colors.border, marginVertical: 3 },
  scRow: { flexDirection: 'row', alignItems: 'center' },
  scParRow: { backgroundColor: 'rgba(255,255,255,0.03)', borderTopWidth: 1, borderTopColor: colors.border },
  scPtsRow: { backgroundColor: 'rgba(212,175,55,0.05)' },
  scLabel: { fontSize: 8, fontWeight: '700', color: colors.textMuted, textAlign: 'center', height: 20, textAlignVertical: 'center', lineHeight: 20 },
  scPlayerLabel: { fontSize: 8, fontWeight: '800' },
  scHoleNum: { fontSize: 9, fontWeight: '700', color: colors.textSecondary, textAlign: 'center', height: 20, lineHeight: 20 },
  scMuted: { fontSize: 8, color: colors.textMuted, textAlign: 'center', height: 18, lineHeight: 18 },
  scParText: { fontSize: 9, fontWeight: '600', color: colors.textMuted, textAlign: 'center', height: 20, lineHeight: 20 },
  scTotLabel: { fontSize: 8, fontWeight: '700', color: colors.gold, textAlign: 'center', height: 20, lineHeight: 20 },
  scTot: { fontSize: 9, fontWeight: '600', color: colors.textSecondary, textAlign: 'center', height: 20, lineHeight: 20 },
  scTotBold: { fontWeight: '800', color: colors.white },
  scGold: { color: colors.gold, fontWeight: '700' },
  scScoreCell: { height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 2 },
  scScoreText: { fontSize: 9, fontWeight: '800', color: colors.textSecondary },
  scPtsCell: { fontSize: 8, fontWeight: '600', color: colors.gold, textAlign: 'center', height: 18, lineHeight: 18 },
  scBirdie: { backgroundColor: 'rgba(74,222,128,0.25)', borderWidth: 1, borderColor: colors.green },
  scPar: { backgroundColor: colors.cardAlt },
  scBogey: { backgroundColor: 'rgba(248,113,113,0.15)' },
});
