import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Image, Share, ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../../src/lib/supabase';
import { useDynamicColors } from '../../../../src/lib/SocietyThemeContext';
import { useSocietyTheme } from '../../../../src/lib/SocietyThemeContext';
import { titanLogo } from '../../../../src/lib/assets';
import {
  calcCourseHandicap,
  calcStrokesReceived,
} from '../../../../src/lib/scoring';

// ── Design tokens ───────────────────────────────────────────────
const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const BLUE  = '#6366f1';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';

// ── Helpers ─────────────────────────────────────────────────────
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function vsParString(diff: number): string {
  if (diff === 0) return 'E';
  return diff > 0 ? `+${diff}` : `${diff}`;
}

function vsParColor(diff: number): string {
  if (diff === 0) return GOLD;
  return diff < 0 ? GREEN : RED;
}

// ── Types ────────────────────────────────────────────────────────
interface MatchRow {
  id: string;
  status: string;
  round_format: string;
  holes_string: string | null;
  start_hole: number | null;
  home_player_ids: string[];
  away_player_ids: string[];
  home_team: { name: string; accent_color: string } | null;
  away_team: { name: string; accent_color: string } | null;
  hcp_allowance: number | null;
  day: {
    course_name: string;
    tee_date: string;
    competition: { format: string } | null;
  } | null;
}

interface Profile {
  id: string;
  display_name: string;
  handicap_index: number | null;
}

interface CourseHole {
  hole_number: number;
  par: number;
  stroke_index: number;
}

interface MatchHole {
  player_id: string;
  hole_number: number;
  gross_score: number | null;
  stableford_pts: number | null;
  net_score: number | null;
}

interface HoleStat {
  player_id: string;
  hole_number: number;
  fairway_hit: boolean | null;
  fairway_direction: string | null;
  putts: number | null;
  bunker_shots: number | null;
  penalty_strokes: number | null;
  chip_shots: number | null;
}

// ── Per-player derived stats ─────────────────────────────────────
interface PlayerStats {
  grossTotal: number;
  netTotal: number;
  frontGross: number;
  backGross: number;
  frontPts: number;
  backPts: number;
  totalPts: number;
  vsParDiff: number;
  fairwaysHit: number;
  fairwaysDenominator: number;
  girCount: number;
  girDenominator: number;
  puttTotal: number;
  birdieCount: number;
  parCount: number;
  bogeyCount: number;
  doubleCount: number;
  eagleCount: number;
  bunkerTotal: number;
  penaltyTotal: number;
  chipTotal: number;
  hasExtendedStats: boolean;
}

function deriveStats(
  playerId: string,
  courseHoles: CourseHole[],
  matchHoles: MatchHole[],
  holeStats: HoleStat[],
  courseHcp: number,
): PlayerStats {
  const holeMap: Record<number, MatchHole> = {};
  for (const mh of matchHoles) {
    if (mh.player_id === playerId) holeMap[mh.hole_number] = mh;
  }
  const statMap: Record<number, HoleStat> = {};
  for (const hs of holeStats) {
    if (hs.player_id === playerId) statMap[hs.hole_number] = hs;
  }

  let grossTotal = 0, netTotal = 0;
  let frontGross = 0, backGross = 0, frontPts = 0, backPts = 0;
  let fairwaysHit = 0, fairwaysDenominator = 0;
  let girCount = 0, girDenominator = 0;
  let puttTotal = 0;
  let birdieCount = 0, parCount = 0, bogeyCount = 0, doubleCount = 0, eagleCount = 0;
  let bunkerTotal = 0, penaltyTotal = 0, chipTotal = 0;

  let coursePar = 0;
  for (const ch of courseHoles) {
    coursePar += ch.par;
    const mh = holeMap[ch.hole_number];
    const hs = statMap[ch.hole_number];
    const gross = mh?.gross_score ?? null;
    const shots = calcStrokesReceived(courseHcp, ch.stroke_index);
    const net = gross !== null ? gross - shots : null;

    if (gross !== null) {
      grossTotal += gross;
      if (net !== null) netTotal += net;
      if (ch.hole_number <= 9) {
        frontGross += gross;
        frontPts += mh?.stableford_pts ?? 0;
      } else {
        backGross += gross;
        backPts += mh?.stableford_pts ?? 0;
      }
      const diff = gross - ch.par;
      if (diff <= -2) eagleCount++;
      else if (diff === -1) birdieCount++;
      else if (diff === 0) parCount++;
      else if (diff === 1) bogeyCount++;
      else doubleCount++;
    }

    if (ch.par >= 4) {
      fairwaysDenominator++;
      if (hs?.fairway_hit === true) fairwaysHit++;
    }

    if (hs?.putts != null && gross !== null) {
      girDenominator++;
      puttTotal += hs.putts;
      if (gross - hs.putts <= ch.par - 2) girCount++;
    }

    if (hs?.bunker_shots != null) bunkerTotal += hs.bunker_shots;
    if (hs?.penalty_strokes != null) penaltyTotal += hs.penalty_strokes;
    if (hs?.chip_shots != null) chipTotal += hs.chip_shots;
  }

  const hasExtendedStats = bunkerTotal > 0 || penaltyTotal > 0 || chipTotal > 0;
  const vsParDiff = grossTotal - coursePar;
  const totalPts = frontPts + backPts;

  return {
    grossTotal, netTotal, frontGross, backGross,
    frontPts, backPts, totalPts,
    vsParDiff, fairwaysHit, fairwaysDenominator,
    girCount, girDenominator, puttTotal,
    birdieCount, parCount, bogeyCount, doubleCount, eagleCount,
    bunkerTotal, penaltyTotal, chipTotal,
    hasExtendedStats,
  };
}

// ── Score cell coloring ──────────────────────────────────────────
function ScoreCell({ gross, par }: { gross: number | null; par: number }) {
  if (gross === null) {
    return (
      <View style={sc.cell}>
        <Text style={[sc.cellText, { color: '#555' }]}>—</Text>
      </View>
    );
  }
  const diff = gross - par;
  let bg = 'transparent';
  let textColor = '#fff';
  let borderColor = 'transparent';
  let circle = false;

  if (diff <= -2) { bg = GOLD; textColor = '#000'; }
  else if (diff === -1) { bg = GREEN; textColor = '#fff'; }
  else if (diff === 0) { bg = '#1a1a1a'; textColor = '#fff'; }
  else if (diff === 1) { bg = 'transparent'; textColor = RED; borderColor = RED; circle = true; }
  else { bg = RED; textColor = '#fff'; }

  return (
    <View style={sc.cell}>
      <View style={[
        sc.scoreInner,
        { backgroundColor: bg },
        circle && { borderWidth: 1.5, borderColor, borderRadius: 12 },
      ]}>
        <Text style={[sc.cellText, { color: textColor }]}>{gross}</Text>
      </View>
    </View>
  );
}

// ── Scorecard grid (9 holes) ─────────────────────────────────────
function ScorecardGrid({
  holeSequence,
  courseHoles,
  matchHoles,
  playerId,
  isStableford,
  label,
}: {
  holeSequence: number[];
  courseHoles: CourseHole[];
  matchHoles: MatchHole[];
  playerId: string;
  isStableford: boolean;
  label: string;
}) {
  const holeMap: Record<number, MatchHole> = {};
  for (const mh of matchHoles) {
    if (mh.player_id === playerId) holeMap[mh.hole_number] = mh;
  }
  const chMap: Record<number, CourseHole> = {};
  for (const ch of courseHoles) chMap[ch.hole_number] = ch;

  const holes = holeSequence;
  const parTotal = holes.reduce((s, h) => s + (chMap[h]?.par ?? 0), 0);
  const grossTotal = holes.reduce((s, h) => {
    const g = holeMap[h]?.gross_score ?? null;
    return g !== null ? s + g : s;
  }, 0);
  const ptsTotal = holes.reduce((s, h) => s + (holeMap[h]?.stableford_pts ?? 0), 0);
  const anyGross = holes.some(h => holeMap[h]?.gross_score != null);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={sc.gridWrap}>
      <View>
        {/* Header row */}
        <View style={sc.row}>
          <View style={sc.labelCell}><Text style={sc.labelText}>HOLE</Text></View>
          {holes.map(h => (
            <View key={h} style={sc.cell}>
              <Text style={sc.holeNumText}>{h}</Text>
            </View>
          ))}
          <View style={sc.totalCell}><Text style={sc.totalLabel}>{label}</Text></View>
        </View>

        {/* Par row */}
        <View style={sc.row}>
          <View style={sc.labelCell}><Text style={sc.labelText}>PAR</Text></View>
          {holes.map(h => (
            <View key={h} style={sc.cell}>
              <Text style={sc.parText}>{chMap[h]?.par ?? '—'}</Text>
            </View>
          ))}
          <View style={sc.totalCell}><Text style={sc.totalText}>{parTotal}</Text></View>
        </View>

        {/* Gross row */}
        <View style={sc.row}>
          <View style={sc.labelCell}><Text style={sc.labelText}>SCORE</Text></View>
          {holes.map(h => (
            <ScoreCell key={h} gross={holeMap[h]?.gross_score ?? null} par={chMap[h]?.par ?? 4} />
          ))}
          <View style={sc.totalCell}>
            <Text style={[sc.totalText, { color: GOLD }]}>{anyGross ? grossTotal : '—'}</Text>
          </View>
        </View>

        {/* Stableford pts row */}
        {isStableford && (
          <View style={sc.row}>
            <View style={sc.labelCell}><Text style={sc.labelText}>PTS</Text></View>
            {holes.map(h => {
              const pts = holeMap[h]?.stableford_pts ?? null;
              const played = holeMap[h]?.gross_score != null;
              return (
                <View key={h} style={sc.cell}>
                  <Text style={[sc.ptsText, { color: pts != null && pts > 0 ? GREEN : '#555' }]}>
                    {played ? (pts ?? 0) : '—'}
                  </Text>
                </View>
              );
            })}
            <View style={sc.totalCell}>
              <Text style={[sc.totalText, { color: GREEN }]}>{ptsTotal > 0 ? ptsTotal : '—'}</Text>
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

// ── Main screen ──────────────────────────────────────────────────
export default function ResultsScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const dc = useDynamicColors();
  const { localLogo, logoUrl } = useSocietyTheme();

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [match, setMatch] = useState<MatchRow | null>(null);
  const [players, setPlayers] = useState<Profile[]>([]);
  const [courseHoles, setCourseHoles] = useState<CourseHole[]>([]);
  const [matchHoles, setMatchHoles] = useState<MatchHole[]>([]);
  const [holeStats, setHoleStats] = useState<HoleStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data: matchData } = await supabase
        .from('matches')
        .select(`
          id, status, round_format, holes_string, start_hole,
          home_player_ids, away_player_ids,
          hcp_allowance,
          home_team:home_team_id(name, accent_color),
          away_team:away_team_id(name, accent_color),
          day:day_id(course_name, tee_date, competition:competition_id(format))
        `)
        .eq('id', matchId)
        .single();

      if (!matchData) { setLoading(false); return; }
      const m = matchData as unknown as MatchRow;
      setMatch(m);

      const allIds = [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])];
      if (allIds.length > 0) setSelectedPlayerId(allIds[0]);

      const [
        { data: profilesData },
        { data: holesData },
        { data: matchHolesData },
        { data: holeStatsData },
      ] = await Promise.all([
        allIds.length
          ? supabase.from('players').select('id, display_name, handicap_index').in('id', allIds)
          : Promise.resolve({ data: [] }),
        m.day?.course_name
          ? supabase.from('course_holes')
              .select('hole_number, par, stroke_index')
              .eq('course_name', m.day.course_name)
              .order('hole_number')
          : Promise.resolve({ data: [] }),
        supabase.from('match_holes')
          .select('player_id, hole_number, gross_score, stableford_pts, net_score')
          .eq('match_id', matchId),
        supabase.from('hole_stats')
          .select('player_id, hole_number, fairway_hit, fairway_direction, putts, bunker_shots, penalty_strokes, chip_shots')
          .eq('match_id', matchId),
      ]);

      if (profilesData) setPlayers(profilesData as Profile[]);
      if (holesData) setCourseHoles(holesData as CourseHole[]);
      if (matchHolesData) setMatchHoles(matchHolesData as MatchHole[]);
      if (holeStatsData) setHoleStats(holeStatsData as HoleStat[]);

      setLoading(false);
    }
    load();
  }, [matchId]);

  // ── Derived ──────────────────────────────────────────────────────
  const allPlayerIds = match ? [...match.home_player_ids, ...match.away_player_ids] : [];
  const playerMap: Record<string, Profile> = {};
  for (const p of players) playerMap[p.id] = p;

  const startHole = match?.start_hole ?? 1;
  const holeSequenceFull: number[] = startHole > 1
    ? [
        ...Array.from({ length: 19 - startHole }, (_, i) => startHole + i),
        ...Array.from({ length: startHole - 1 }, (_, i) => i + 1),
      ]
    : Array.from({ length: 18 }, (_, i) => i + 1);

  // Split into two display halves (first 9 played, second 9 played)
  const firstNine  = holeSequenceFull.slice(0, 9);
  const secondNine = holeSequenceFull.slice(9, 18);
  const firstLabel  = firstNine[0] === 1 ? 'OUT' : 'IN';
  const secondLabel = firstNine[0] === 1 ? 'IN'  : 'OUT';

  const isStableford = match?.round_format === 'stableford';

  function getCourseHcp(playerId: string): number {
    const profile = playerMap[playerId];
    const hcpIndex = profile?.handicap_index ?? 0;
    const allowance = match?.hcp_allowance ?? 100;
    // No slope/course rating available from this query — use raw index rounded
    const raw = Math.round(hcpIndex);
    return Math.round(raw * (allowance / 100));
  }

  const selectedProfile = selectedPlayerId ? playerMap[selectedPlayerId] : null;
  const selectedCourseHcp = selectedPlayerId ? getCourseHcp(selectedPlayerId) : 0;
  const stats = selectedPlayerId
    ? deriveStats(selectedPlayerId, courseHoles, matchHoles, holeStats, selectedCourseHcp)
    : null;

  // ── Share ────────────────────────────────────────────────────────
  async function handleShare() {
    if (!match || !selectedProfile || !stats) return;
    const courseName = match.day?.course_name ?? 'Course';
    const dateStr = match.day?.tee_date ? formatDate(match.day.tee_date) : '';
    const name = selectedProfile.display_name;
    const hcp = selectedProfile.handicap_index ?? 0;

    const lines = [
      `⛳ ${name} (HCP ${hcp}) — ${courseName} ${dateStr}`,
      `Gross: ${stats.grossTotal}  |  Net: ${stats.netTotal}  |  vs Par: ${vsParString(stats.vsParDiff)}`,
    ];
    if (isStableford) lines.push(`Stableford: ${stats.totalPts}pts`);
    lines.push('');
    lines.push(`Birdies: ${stats.birdieCount}  Pars: ${stats.parCount}  Bogeys: ${stats.bogeyCount}  Doubles+: ${stats.doubleCount}`);
    lines.push(`FIR: ${stats.fairwaysHit}/${stats.fairwaysDenominator}  GIR: ${stats.girCount}/${stats.girDenominator}  Putts: ${stats.puttTotal}`);
    lines.push('');
    lines.push('Scored with Titan Golf');

    await Share.share({ message: lines.join('\n') });
  }

  // ── Loading / error ──────────────────────────────────────────────
  if (loading || !fontsLoaded) {
    return (
      <View style={[s.root, { backgroundColor: dc.bg }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={GOLD} size="large" style={{ marginTop: 120 }} />
      </View>
    );
  }

  if (!match) {
    return (
      <View style={[s.root, { backgroundColor: dc.bg }]}>
        <StatusBar style="light" />
        <Text style={[s.errText, { fontFamily: FFB }]}>Match not found.</Text>
      </View>
    );
  }

  const logoSource = localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo);

  return (
    <View style={[s.root, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={s.headerSide}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>

        <View style={s.headerCenter}>
          <Image source={logoSource} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerSub}>RESULTS</Text>
        </View>

        <TouchableOpacity
          onPress={handleShare}
          style={s.headerSide}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="share-outline" size={22} color={GOLD} />
        </TouchableOpacity>
      </View>

      {/* ── Player tabs ── */}
      {allPlayerIds.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.tabsRow}
          style={s.tabsWrap}
        >
          {allPlayerIds.map(id => {
            const name = playerMap[id]?.display_name ?? 'Player';
            const firstName = name.split(' ')[0];
            const isSelected = id === selectedPlayerId;
            return (
              <TouchableOpacity
                key={id}
                style={[s.tab, isSelected && { backgroundColor: GOLD, borderColor: GOLD }]}
                onPress={() => setSelectedPlayerId(id)}
                activeOpacity={0.75}
              >
                <Text style={[s.tabText, { color: isSelected ? '#000' : '#aaa' }]}>
                  {firstName}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}
      >
        {selectedProfile && (
          <>
            {/* ── Player info card ── */}
            <View style={[s.card, { backgroundColor: dc.card, borderColor: dc.border }]}>
              <Text style={s.playerName}>{selectedProfile.display_name}</Text>
              <Text style={s.playerHcp}>
                HCP {selectedProfile.handicap_index != null
                  ? selectedProfile.handicap_index.toFixed(1)
                  : '—'}
              </Text>
            </View>

            {/* ── Course + date ── */}
            {match.day && (
              <View style={s.courseRow}>
                <Ionicons name="golf-outline" size={14} color={GOLD} />
                <Text style={s.courseText}>
                  {match.day.course_name}
                  {match.day.tee_date ? `  •  ${formatDate(match.day.tee_date)}` : ''}
                </Text>
              </View>
            )}

            {/* ── Front scorecard ── */}
            <View style={[s.scorecardWrap, { backgroundColor: dc.card, borderColor: dc.border }]}>
              <Text style={s.scorecardTitle}>FRONT 9</Text>
              <ScorecardGrid
                holeSequence={firstNine}
                courseHoles={courseHoles}
                matchHoles={matchHoles}
                playerId={selectedPlayerId!}
                isStableford={isStableford}
                label={firstLabel}
              />
            </View>

            {/* ── Back scorecard ── */}
            <View style={[s.scorecardWrap, { backgroundColor: dc.card, borderColor: dc.border }]}>
              <Text style={s.scorecardTitle}>BACK 9</Text>
              <ScorecardGrid
                holeSequence={secondNine}
                courseHoles={courseHoles}
                matchHoles={matchHoles}
                playerId={selectedPlayerId!}
                isStableford={isStableford}
                label={secondLabel}
              />
            </View>

            {/* ── Score summary ── */}
            {stats && (
              <View style={[s.summaryRow, { backgroundColor: dc.card, borderColor: dc.border }]}>
                <View style={s.summaryItem}>
                  <Text style={s.summaryLabel}>GROSS</Text>
                  <Text style={s.summaryValue}>{stats.grossTotal || '—'}</Text>
                </View>
                <View style={s.summarySep} />
                <View style={s.summaryItem}>
                  <Text style={s.summaryLabel}>NET</Text>
                  <Text style={s.summaryValue}>{stats.netTotal || '—'}</Text>
                </View>
                <View style={s.summarySep} />
                <View style={s.summaryItem}>
                  <Text style={s.summaryLabel}>+/−</Text>
                  <Text style={[s.summaryValue, { color: vsParColor(stats.vsParDiff) }]}>
                    {stats.grossTotal ? vsParString(stats.vsParDiff) : '—'}
                  </Text>
                </View>
                {isStableford && (
                  <>
                    <View style={s.summarySep} />
                    <View style={s.summaryItem}>
                      <Text style={s.summaryLabel}>PTS</Text>
                      <Text style={[s.summaryValue, { color: GREEN }]}>{stats.totalPts}</Text>
                    </View>
                  </>
                )}
              </View>
            )}

            {/* ── Stats chips ── */}
            {stats && (
              <View style={s.chipsGrid}>
                <StatChip
                  label="FAIRWAYS"
                  value={`${stats.fairwaysHit}/${stats.fairwaysDenominator}`}
                  dc={dc}
                />
                <StatChip
                  label="GIR"
                  value={`${stats.girCount}/${stats.girDenominator || 18}`}
                  dc={dc}
                />
                <StatChip
                  label="PUTTS"
                  value={`${stats.puttTotal || '—'}`}
                  dc={dc}
                />
                <StatChip
                  label="BIRDIES"
                  value={`${stats.birdieCount}`}
                  color={GREEN}
                  dc={dc}
                />
              </View>
            )}

            {/* ── Score breakdown ── */}
            {stats && (
              <View style={[s.breakdownWrap, { backgroundColor: dc.card, borderColor: dc.border }]}>
                <Text style={s.breakdownTitle}>SCORE BREAKDOWN</Text>
                <View style={s.breakdownRow}>
                  {stats.eagleCount > 0 && (
                    <View style={s.breakdownChip}>
                      <Text style={[s.breakdownValue, { color: GOLD }]}>{stats.eagleCount}</Text>
                      <Text style={s.breakdownLabel}>EAGLE{stats.eagleCount !== 1 ? 'S' : ''}</Text>
                    </View>
                  )}
                  <View style={s.breakdownChip}>
                    <Text style={[s.breakdownValue, { color: GREEN }]}>{stats.birdieCount}</Text>
                    <Text style={s.breakdownLabel}>BIRDIE{stats.birdieCount !== 1 ? 'S' : ''}</Text>
                  </View>
                  <View style={s.breakdownChip}>
                    <Text style={[s.breakdownValue, { color: BLUE }]}>{stats.parCount}</Text>
                    <Text style={s.breakdownLabel}>PARS</Text>
                  </View>
                  <View style={s.breakdownChip}>
                    <Text style={[s.breakdownValue, { color: '#f97316' }]}>{stats.bogeyCount}</Text>
                    <Text style={s.breakdownLabel}>BOGEY{stats.bogeyCount !== 1 ? 'S' : ''}</Text>
                  </View>
                  <View style={s.breakdownChip}>
                    <Text style={[s.breakdownValue, { color: RED }]}>{stats.doubleCount}</Text>
                    <Text style={s.breakdownLabel}>DOUBLE+</Text>
                  </View>
                </View>
              </View>
            )}

            {/* ── Extended stats ── */}
            {stats?.hasExtendedStats && (
              <View style={s.chipsGrid}>
                {stats.bunkerTotal > 0 && (
                  <StatChip label="BUNKERS" value={`${stats.bunkerTotal}`} dc={dc} />
                )}
                {stats.penaltyTotal > 0 && (
                  <StatChip label="PENALTIES" value={`${stats.penaltyTotal}`} color={RED} dc={dc} />
                )}
                {stats.chipTotal > 0 && (
                  <StatChip label="CHIPS" value={`${stats.chipTotal}`} dc={dc} />
                )}
              </View>
            )}
          </>
        )}

        {/* ── End Game button ── */}
        <TouchableOpacity
          style={s.endBtn}
          onPress={() => router.replace('/(app)/' as any)}
          activeOpacity={0.8}
        >
          <Text style={s.endBtnText}>END GAME</Text>
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

// ── StatChip helper ──────────────────────────────────────────────
function StatChip({
  label,
  value,
  color,
  dc,
}: {
  label: string;
  value: string;
  color?: string;
  dc: ReturnType<typeof useDynamicColors>;
}) {
  return (
    <View style={[sc2.chip, { backgroundColor: dc.card, borderColor: dc.border }]}>
      <Text style={[sc2.chipValue, { color: color ?? '#fff' }]}>{value}</Text>
      <Text style={sc2.chipLabel}>{label}</Text>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  errText: {
    color: '#fff',
    textAlign: 'center',
    marginTop: 120,
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 56,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerSide: {
    width: 40,
    alignItems: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerLogo: {
    width: 80,
    height: 28,
  },
  headerSub: {
    fontFamily: FFB,
    fontSize: 10,
    color: GOLD,
    letterSpacing: 2,
    marginTop: 2,
  },
  tabsWrap: {
    maxHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  tabsRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    flexDirection: 'row',
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'transparent',
  },
  tabText: {
    fontFamily: FFB,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  card: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  playerName: {
    fontFamily: FFB,
    fontSize: 15,
    color: '#fff',
    flex: 1,
  },
  playerHcp: {
    fontFamily: FFB,
    fontSize: 13,
    color: GOLD,
  },
  courseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  courseText: {
    fontFamily: FF,
    fontSize: 12,
    color: '#aaa',
  },
  scorecardWrap: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 8,
    overflow: 'hidden',
  },
  scorecardTitle: {
    fontFamily: FFB,
    fontSize: 10,
    color: GOLD,
    letterSpacing: 2,
    marginBottom: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
    overflow: 'hidden',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
  },
  summaryLabel: {
    fontFamily: FFB,
    fontSize: 9,
    color: '#666',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  summaryValue: {
    fontFamily: FFB,
    fontSize: 22,
    color: '#fff',
  },
  summarySep: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 10,
  },
  chipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  breakdownWrap: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
  },
  breakdownTitle: {
    fontFamily: FFB,
    fontSize: 9,
    color: GOLD,
    letterSpacing: 2,
    marginBottom: 10,
  },
  breakdownRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  breakdownChip: {
    alignItems: 'center',
    minWidth: 44,
  },
  breakdownValue: {
    fontFamily: FFB,
    fontSize: 20,
    color: '#fff',
  },
  breakdownLabel: {
    fontFamily: FFB,
    fontSize: 8,
    color: '#555',
    letterSpacing: 1,
    marginTop: 2,
  },
  endBtn: {
    backgroundColor: GOLD,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  endBtnText: {
    fontFamily: FFB,
    fontSize: 15,
    color: '#000',
    letterSpacing: 2,
  },
});

// Scorecard cell styles
const sc = StyleSheet.create({
  gridWrap: {
    // allows horizontal scroll inside the card
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 30,
  },
  labelCell: {
    width: 46,
    justifyContent: 'center',
    paddingRight: 4,
  },
  labelText: {
    fontFamily: FFB,
    fontSize: 8,
    color: '#555',
    letterSpacing: 1,
  },
  cell: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreInner: {
    width: 24,
    height: 24,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellText: {
    fontFamily: FFB,
    fontSize: 11,
    color: '#fff',
  },
  holeNumText: {
    fontFamily: FFB,
    fontSize: 10,
    color: '#777',
  },
  parText: {
    fontFamily: FFB,
    fontSize: 11,
    color: '#aaa',
  },
  ptsText: {
    fontFamily: FFB,
    fontSize: 11,
  },
  totalCell: {
    width: 36,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.1)',
    marginLeft: 2,
  },
  totalLabel: {
    fontFamily: FFB,
    fontSize: 8,
    color: '#555',
    letterSpacing: 1,
  },
  totalText: {
    fontFamily: FFB,
    fontSize: 12,
    color: '#fff',
  },
});

// Stat chip styles
const sc2 = StyleSheet.create({
  chip: {
    flex: 1,
    minWidth: '22%',
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  chipValue: {
    fontFamily: FFB,
    fontSize: 18,
    color: '#fff',
  },
  chipLabel: {
    fontFamily: FFB,
    fontSize: 8,
    color: '#555',
    letterSpacing: 1,
    marginTop: 3,
  },
});
