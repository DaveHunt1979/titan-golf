import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Image, Animated,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { matchLabel, getEffectiveWinner, calcHoles } from '../../../src/lib/scoring';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';
import { getPlayerAvatar, teamLogos } from '../../../src/lib/assets';

interface MatchDetail {
  id: string;
  match_number: number;
  status: 'upcoming' | 'in_progress' | 'complete';
  winner: string | null;
  result_str: string | null;
  holes_string: string;
  is_singles: boolean;
  home_team_id: string | null;
  away_team_id: string | null;
  home_player_ids: string[];
  away_player_ids: string[];
  home_team: { name: string; accent_color: string } | null;
  away_team: { name: string; accent_color: string } | null;
  day: { course_name: string | null; day_number: number; competition_id: string } | null;
}

interface Player    { id: string; display_name: string; }
interface CourseHole { hole_number: number; par: number; stroke_index: number; }

function SideAvatar({ playerIds, team, teamId, size, getFirstName }: {
  playerIds: string[];
  team: { name: string; accent_color: string } | null;
  teamId: string | null;
  size: number;
  getFirstName: (id: string) => string;
}) {
  if (teamId && team) {
    const logo = teamLogos[team.name];
    if (logo) return <Image source={logo} style={{ width: size, height: size, borderRadius: 8 }} resizeMode="contain" />;
    return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: team.accent_color + '33' }} />;
  }
  if (playerIds.length === 1) {
    const av = getPlayerAvatar(playerIds[0], 'normal');
    return av
      ? <Image source={av} style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }} />
      : <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size * 0.38, fontWeight: '800', color: colors.gold }}>{getFirstName(playerIds[0])[0]}</Text>
        </View>;
  }
  const avSize = Math.round(size * 0.72);
  return (
    <View style={{ flexDirection: 'row' }}>
      {playerIds.map((id, i) => {
        const av = getPlayerAvatar(id, 'normal');
        return av
          ? <Image key={id} source={av} style={{ width: avSize, height: avSize, borderRadius: avSize / 2, marginLeft: i > 0 ? -avSize * 0.28 : 0, overflow: 'hidden' }} />
          : <View key={id} style={{ width: avSize, height: avSize, borderRadius: avSize / 2, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center', marginLeft: i > 0 ? -avSize * 0.28 : 0 }}>
              <Text style={{ fontSize: avSize * 0.38, fontWeight: '800', color: colors.gold }}>{getFirstName(id)[0]}</Text>
            </View>;
      })}
    </View>
  );
}

export default function SpectateScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const [match, setMatch]         = useState<MatchDetail | null>(null);
  const [compName, setCompName]   = useState('');
  const [players, setPlayers]     = useState<Player[]>([]);
  const [courseHoles, setCourseHoles] = useState<CourseHole[]>([]);
  const [loading, setLoading]     = useState(true);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.2, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,   duration: 900, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  const load = useCallback(async () => {
    const { data: matchData } = await supabase
      .from('matches')
      .select('*, home_team:home_team_id(name,accent_color), away_team:away_team_id(name,accent_color), day:day_id(course_name,day_number,competition_id)')
      .eq('id', matchId)
      .single();

    if (!matchData) { setLoading(false); return; }
    setMatch(matchData as unknown as MatchDetail);

    const allIds = [...(matchData.home_player_ids ?? []), ...(matchData.away_player_ids ?? [])];
    const courseName = (matchData as any).day?.course_name;
    const compId     = (matchData as any).day?.competition_id;

    const [{ data: pd }, { data: cd }, { data: compData }] = await Promise.all([
      allIds.length
        ? supabase.from('players').select('id,display_name').in('id', allIds)
        : Promise.resolve({ data: [] }),
      courseName
        ? supabase.from('course_holes').select('hole_number,par,stroke_index').eq('course_name', courseName).order('hole_number')
        : Promise.resolve({ data: [] }),
      compId
        ? supabase.from('competitions').select('name').eq('id', compId).single()
        : Promise.resolve({ data: null }),
    ]);

    if (pd)       setPlayers(pd);
    if (cd)       setCourseHoles(cd);
    if (compData) setCompName((compData as any).name ?? '');
    setLoading(false);
  }, [matchId]);

  useEffect(() => {
    load();
    const sub = supabase
      .channel(`spectate-${matchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches',    filter: `id=eq.${matchId}` },         load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_holes', filter: `match_id=eq.${matchId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [matchId, load]);

  if (loading) return (
    <View style={s.centered}><StatusBar style="light" /><ActivityIndicator color={colors.gold} size="large" /></View>
  );
  if (!match) return (
    <View style={s.centered}><StatusBar style="light" /><Text style={{ color: colors.textMuted }}>Match not found.</Text></View>
  );

  const holesStr     = match.holes_string ?? '..................';
  const holeChars    = holesStr.split('');
  const { homeUp }   = calcHoles(holesStr);
  const holesPlayed  = holeChars.filter(c => c !== '.').length;
  const currentHole  = Math.min(holesPlayed + 1, 18);
  const status       = match.status;
  const winner       = getEffectiveWinner(status, match.winner, holesStr);
  const label        = matchLabel(status, match.winner, match.result_str, holesStr);
  const aheadSide    = status === 'complete' ? winner : homeUp > 0 ? 'home' : homeUp < 0 ? 'away' : null;

  const homeColor = match.home_team?.accent_color ?? colors.gold;
  const awayColor = match.away_team?.accent_color ?? '#6366f1';

  const firstName  = (id: string) => (players.find(p => p.id === id)?.display_name ?? '?').split(' ')[0];
  const homeLabel  = match.home_team?.name ?? match.home_player_ids.map(firstName).join(' & ');
  const awayLabel  = match.away_team?.name ?? match.away_player_ids.map(firstName).join(' & ');
  const aheadLabel = aheadSide === 'home' ? homeLabel : aheadSide === 'away' ? awayLabel : null;
  const aheadColor = aheadSide === 'home' ? homeColor : aheadSide === 'away' ? awayColor : colors.textMuted;
  const currentCourseHole = courseHoles.find(h => h.hole_number === currentHole);

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={s.back}>‹ Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerComp} numberOfLines={1}>{compName || 'Match'}</Text>
          <Text style={s.headerDay} numberOfLines={1}>
            Day {match.day?.day_number}{match.day?.course_name ? ` · ${match.day.course_name}` : ''}
          </Text>
        </View>
        {status === 'in_progress' && (
          <Animated.View style={[s.livePill, { opacity: pulse }]}>
            <Text style={s.livePillText}>● LIVE</Text>
          </Animated.View>
        )}
        {status === 'complete' && (
          <View style={s.finalPill}>
            <Text style={s.finalPillText}>FINAL</Text>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Hero match card ── */}
        <View style={s.heroCard}>
          <Text style={s.matchNum}>MATCH {match.match_number}</Text>

          <View style={s.heroRow}>
            {/* Home */}
            <View style={s.heroSide}>
              <View style={[s.avatarRing, { borderColor: aheadSide === 'home' ? homeColor : colors.border }]}>
                <SideAvatar playerIds={match.home_player_ids} team={match.home_team} teamId={match.home_team_id} size={58} getFirstName={firstName} />
              </View>
              <Text style={[s.sideName, aheadSide === 'home' && { color: colors.white }]} numberOfLines={2}>{homeLabel}</Text>
              {match.home_team && (
                <Text style={s.sidePlayers} numberOfLines={1}>{match.home_player_ids.map(firstName).join(' & ')}</Text>
              )}
            </View>

            {/* Centre status */}
            <View style={s.heroCenter}>
              <Text style={[
                s.statusText,
                status === 'in_progress' && { color: colors.live },
                status === 'complete'    && { color: colors.gold },
                status === 'upcoming'   && { color: colors.textMuted },
              ]}>{label}</Text>
              {status === 'in_progress' && (
                <Text style={s.thruText}>
                  {holesPlayed === 0 ? 'STARTING' : `THRU ${holesPlayed}`}
                </Text>
              )}
            </View>

            {/* Away */}
            <View style={[s.heroSide, s.heroSideRight]}>
              <View style={[s.avatarRing, { borderColor: aheadSide === 'away' ? awayColor : colors.border }]}>
                <SideAvatar playerIds={match.away_player_ids} team={match.away_team} teamId={match.away_team_id} size={58} getFirstName={firstName} />
              </View>
              <Text style={[s.sideName, s.sideNameRight, aheadSide === 'away' && { color: colors.white }]} numberOfLines={2}>{awayLabel}</Text>
              {match.away_team && (
                <Text style={[s.sidePlayers, { textAlign: 'right' }]} numberOfLines={1}>{match.away_player_ids.map(firstName).join(' & ')}</Text>
              )}
            </View>
          </View>

          {/* Leader banner */}
          {aheadLabel ? (
            <View style={[s.leaderBanner, { borderColor: aheadColor + '55' }]}>
              <Text style={[s.leaderText, { color: aheadColor }]}>
                {aheadSide === 'away' ? '' : '◀ '}
                {aheadLabel} {status === 'complete' ? 'WIN' : 'LEAD'}
                {aheadSide === 'home' ? '' : ' ▶'}
              </Text>
            </View>
          ) : status === 'in_progress' && holesPlayed > 0 ? (
            <View style={s.leaderBanner}>
              <Text style={s.leaderText}>— ALL SQUARE —</Text>
            </View>
          ) : null}
        </View>

        {/* ── Now Playing ── */}
        {status === 'in_progress' && holesPlayed < 18 && (
          <View style={s.nowCard}>
            <Text style={s.nowLabel}>NOW PLAYING</Text>
            <View style={s.nowRow}>
              <Text style={s.nowHole}>Hole {currentHole}</Text>
              {currentCourseHole && (
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <MetaChip label="PAR" value={String(currentCourseHole.par)} />
                  <MetaChip label="SI"  value={String(currentCourseHole.stroke_index)} />
                </View>
              )}
            </View>
          </View>
        )}

        {/* ── Hole-by-hole grid ── */}
        <View style={s.gridCard}>
          <Text style={s.gridTitle}>HOLE BY HOLE</Text>

          <NineGrid
            chars={holeChars.slice(0, 9)}
            offset={0}
            label="FRONT 9"
            currentHole={status === 'in_progress' ? currentHole : -1}
            homeColor={homeColor}
            awayColor={awayColor}
          />
          <View style={s.gridDivider} />
          <NineGrid
            chars={holeChars.slice(9, 18)}
            offset={9}
            label="BACK 9"
            currentHole={status === 'in_progress' ? currentHole : -1}
            homeColor={homeColor}
            awayColor={awayColor}
          />

          <View style={s.legend}>
            <LegendDot color={homeColor} label={homeLabel} />
            <LegendDot color={awayColor} label={awayLabel} />
            <LegendDot color={colors.gold} label="Halved" />
          </View>
        </View>

      </ScrollView>
    </View>
  );
}

function NineGrid({ chars, offset, label, currentHole, homeColor, awayColor }: {
  chars: string[];
  offset: number;
  label: string;
  currentHole: number;
  homeColor: string;
  awayColor: string;
}) {
  return (
    <View style={g.wrap}>
      <Text style={g.label}>{label}</Text>
      <View style={g.row}>
        {chars.map((c, i) => {
          const hNum      = i + offset + 1;
          const isCurrent = hNum === currentHole;
          const bg        = c === 'h' ? homeColor : c === 'a' ? awayColor : c === 'f' ? colors.gold : undefined;
          return (
            <View key={i} style={[g.cell, bg ? { backgroundColor: bg } : g.cellEmpty, isCurrent && g.cellCurrent]}>
              <Text style={[g.num, bg && g.numFilled]}>{hNum}</Text>
              <Text style={[g.char, bg && g.charFilled]}>
                {c === 'h' ? 'H' : c === 'a' ? 'A' : c === 'f' ? '½' : ''}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={mc.chip}>
      <Text style={mc.label}>{label}</Text>
      <Text style={mc.value}>{value}</Text>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ fontSize: fonts.xs, color: colors.textMuted, fontWeight: '600' }} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  back:         { fontSize: fonts.sm, color: colors.gold, fontWeight: '600' },
  headerCenter: { flex: 1 },
  headerComp:   { fontSize: fonts.sm, fontWeight: '800', color: colors.white },
  headerDay:    { fontSize: fonts.xs, color: colors.textMuted, marginTop: 1 },

  livePill: {
    backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: radius.full,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
    paddingHorizontal: spacing.sm, paddingVertical: 3,
  },
  livePillText: { fontSize: fonts.xs, fontWeight: '800', color: colors.live, letterSpacing: 1 },
  finalPill: {
    backgroundColor: colors.goldDim, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.goldBorder,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
  },
  finalPillText: { fontSize: fonts.xs, fontWeight: '800', color: colors.gold, letterSpacing: 1 },

  scroll: { padding: spacing.md, paddingBottom: 48 },

  heroCard: {
    backgroundColor: colors.card, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.md,
  },
  matchNum: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.md },
  heroRow:  { flexDirection: 'row', alignItems: 'flex-start' },

  heroSide:      { flex: 1, alignItems: 'flex-start' },
  heroSideRight: { alignItems: 'flex-end' },
  avatarRing: { borderRadius: 36, borderWidth: 2, padding: 2, marginBottom: spacing.sm },
  sideName:      { fontSize: fonts.md, fontWeight: '800', color: colors.textSecondary, lineHeight: 20 },
  sideNameRight: { textAlign: 'right' },
  sidePlayers:   { fontSize: fonts.xs, color: colors.textMuted, marginTop: 2 },

  heroCenter: { alignItems: 'center', paddingHorizontal: spacing.xs, paddingTop: 8, minWidth: 72 },
  statusText: { fontSize: fonts.xxl, fontWeight: '900', textAlign: 'center', letterSpacing: 0.5 },
  thruText:   { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginTop: 4 },

  leaderBanner: {
    marginTop: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.sm, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  leaderText: { fontSize: fonts.sm, fontWeight: '800', color: colors.textMuted, letterSpacing: 1 },

  nowCard: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.goldBorder,
    padding: spacing.md, marginBottom: spacing.md,
  },
  nowLabel: { fontSize: fonts.xs, fontWeight: '700', color: colors.gold, letterSpacing: 2, marginBottom: spacing.xs },
  nowRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nowHole:  { fontSize: fonts.xl, fontWeight: '800', color: colors.white },

  gridCard: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  gridTitle:   { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 2, marginBottom: spacing.md },
  gridDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  legend:      { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md, flexWrap: 'wrap' },
});

const g = StyleSheet.create({
  wrap:  { marginBottom: 2 },
  label: { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.xs },
  row:   { flexDirection: 'row', gap: 3 },
  cell: {
    flex: 1, aspectRatio: 0.72,
    borderRadius: 4, alignItems: 'center', justifyContent: 'center',
  },
  cellEmpty:   { borderWidth: 1, borderColor: colors.border },
  cellCurrent: { borderWidth: 2, borderColor: colors.gold },
  num:         { fontSize: 8,  fontWeight: '700', color: colors.textMuted },
  numFilled:   { color: 'rgba(255,255,255,0.7)' },
  char:        { fontSize: 9,  fontWeight: '900', color: colors.textMuted, marginTop: 1 },
  charFilled:  { color: colors.white },
});

const mc = StyleSheet.create({
  chip: {
    backgroundColor: colors.cardAlt, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    alignItems: 'center', minWidth: 44,
  },
  label: { fontSize: 8, fontWeight: '700', color: colors.textMuted, letterSpacing: 1 },
  value: { fontSize: fonts.md, fontWeight: '800', color: colors.white },
});
