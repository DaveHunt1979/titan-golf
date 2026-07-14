import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Image, Animated,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { matchLabel, getEffectiveWinner, calcHoles } from '../../../src/lib/scoring';
import { getPlayerAvatar, teamLogos } from '../../../src/lib/assets';

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

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
  round_format: 'matchplay' | 'stableford' | 'medal';
  home_team: { name: string; accent_color: string } | null;
  away_team: { name: string; accent_color: string } | null;
  day: { course_name: string | null; day_number: number; competition_id: string } | null;
}

interface Player     { id: string; display_name: string; avatar_url?: string | null; }
interface CourseHole { hole_number: number; par: number; stroke_index: number; }

function SideAvatar({ playerIds, team, teamId, size, getFirstName, getAvatar }: {
  playerIds: string[];
  team: { name: string; accent_color: string } | null;
  teamId: string | null;
  size: number;
  getFirstName: (id: string) => string;
  getAvatar: (id: string) => string | null;
}) {
  if (teamId && team) {
    const logo = teamLogos[team.name];
    if (logo) return <Image source={logo} style={{ width: size, height: size, borderRadius: 8 }} resizeMode="contain" />;
    return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: team.accent_color + '33' }} />;
  }
  if (playerIds.length === 1) {
    const raw = getAvatar(playerIds[0]) ?? getPlayerAvatar(playerIds[0], 'normal');
    return raw
      ? <Image source={typeof raw === 'string' ? { uri: raw } : raw} style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }} />
      : <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#1c1c1e', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size * 0.38, fontFamily: FFB, color: GOLD }}>{getFirstName(playerIds[0])[0]}</Text>
        </View>;
  }
  const avSize = Math.round(size * 0.72);
  return (
    <View style={{ flexDirection: 'row' }}>
      {playerIds.map((id, i) => {
        const raw = getAvatar(id) ?? getPlayerAvatar(id, 'normal');
        return raw
          ? <Image key={id} source={typeof raw === 'string' ? { uri: raw } : raw} style={{ width: avSize, height: avSize, borderRadius: avSize / 2, marginLeft: i > 0 ? -avSize * 0.28 : 0, overflow: 'hidden' }} />
          : <View key={id} style={{ width: avSize, height: avSize, borderRadius: avSize / 2, backgroundColor: '#1c1c1e', alignItems: 'center', justifyContent: 'center', marginLeft: i > 0 ? -avSize * 0.28 : 0 }}>
              <Text style={{ fontSize: avSize * 0.38, fontFamily: FFB, color: GOLD }}>{getFirstName(id)[0]}</Text>
            </View>;
      })}
    </View>
  );
}

export default function SpectateScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const [match, setMatch]             = useState<MatchDetail | null>(null);
  const [compName, setCompName]       = useState('');
  const [players, setPlayers]         = useState<Player[]>([]);
  const [courseHoles, setCourseHoles] = useState<CourseHole[]>([]);
  const [loading, setLoading]         = useState(true);
  const pulse = useRef(new Animated.Value(1)).current;

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

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

    const allIds    = [...(matchData.home_player_ids ?? []), ...(matchData.away_player_ids ?? [])];
    const courseName = (matchData as any).day?.course_name;
    const compId     = (matchData as any).day?.competition_id;

    const [{ data: pd }, { data: cd }, { data: compData }] = await Promise.all([
      allIds.length
        ? supabase.from('players').select('id,display_name,avatar_url').in('id', allIds)
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

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  if (!match) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" />
      <Text style={{ color: '#555', fontFamily: FF }}>Match not found.</Text>
    </View>
  );

  const holesStr    = match.holes_string ?? '..................';
  const holeChars   = holesStr.split('');
  const { homeUp }  = calcHoles(holesStr);
  const holesPlayed = holeChars.filter(c => c !== '.').length;
  const currentHole = Math.min(holesPlayed + 1, 18);
  const status      = match.status;
  const winner      = getEffectiveWinner(status, match.winner, holesStr);
  const isStrokePlay = match.round_format === 'stableford' || match.round_format === 'medal';
  const label       = isStrokePlay
    ? (status === 'complete' ? (match.result_str ?? 'Complete') : status === 'upcoming' ? 'Upcoming' : (match.result_str ?? 'In Progress'))
    : matchLabel(status, match.winner, match.result_str, holesStr);
  const aheadSide   = status === 'complete' ? winner : homeUp > 0 ? 'home' : homeUp < 0 ? 'away' : null;

  const homeColor = match.home_team?.accent_color ?? GOLD;
  const awayColor = match.away_team?.accent_color ?? '#6366f1';

  const firstName  = (id: string) => (players.find(p => p.id === id)?.display_name ?? '?').split(' ')[0];
  const getAvatar  = (id: string) => players.find(p => p.id === id)?.avatar_url ?? null;
  const homeLabel  = match.home_team?.name ?? match.home_player_ids.map(firstName).join(' & ');
  const awayLabel  = match.away_team?.name ?? match.away_player_ids.map(firstName).join(' & ');
  const aheadLabel = aheadSide === 'home' ? homeLabel : aheadSide === 'away' ? awayLabel : null;
  const aheadColor = aheadSide === 'home' ? homeColor : aheadSide === 'away' ? awayColor : '#555';
  const currentCourseHole = courseHoles.find(h => h.hole_number === currentHole);

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header — three-column */}
      <View style={s.header}>
        {/* Left: Back */}
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={s.headerLeft}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>

        {/* Centre: Logo + SPECTATE */}
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerSub}>SPECTATE</Text>
        </View>

        {/* Right: spacer */}
        <View style={s.headerRight} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Match header card ── */}
        <View style={s.heroCard}>
          {/* Status pill */}
          <View style={s.pillRow}>
            <Text style={s.matchNum}>MATCH {match.match_number}</Text>
            {status === 'in_progress' && (
              <View style={s.livePill}>
                <Animated.View style={[s.liveDot, { opacity: pulse }]} />
                <Text style={s.livePillText}>LIVE</Text>
              </View>
            )}
            {status === 'complete' && (
              <View style={s.completePill}>
                <Text style={s.completePillText}>COMPLETE</Text>
              </View>
            )}
          </View>

          <View style={s.heroRow}>
            {/* Home */}
            <View style={s.heroSide}>
              <View style={[s.avatarRing, { borderColor: aheadSide === 'home' ? homeColor : '#1c1c1c' }]}>
                <SideAvatar playerIds={match.home_player_ids} team={match.home_team} teamId={match.home_team_id} size={58} getFirstName={firstName} getAvatar={getAvatar} />
              </View>
              <Text style={[s.sideName, aheadSide === 'home' && { color: '#fff' }]} numberOfLines={2}>{homeLabel}</Text>
              {match.home_team && (
                <Text style={s.sidePlayers} numberOfLines={1}>{match.home_player_ids.map(firstName).join(' & ')}</Text>
              )}
            </View>

            {/* Centre status */}
            <View style={s.heroCenter}>
              <Text style={[
                s.statusText,
                status === 'in_progress' && { color: GREEN },
                status === 'complete'    && { color: GOLD },
                status === 'upcoming'   && { color: '#555' },
              ]}>{label}</Text>
              {status === 'in_progress' && (
                <Text style={s.thruText}>
                  {holesPlayed === 0 ? 'STARTING' : `THRU ${holesPlayed}`}
                </Text>
              )}
            </View>

            {/* Away */}
            <View style={[s.heroSide, s.heroSideRight]}>
              <View style={[s.avatarRing, { borderColor: aheadSide === 'away' ? awayColor : '#1c1c1c' }]}>
                <SideAvatar playerIds={match.away_player_ids} team={match.away_team} teamId={match.away_team_id} size={58} getFirstName={firstName} getAvatar={getAvatar} />
              </View>
              <Text style={[s.sideName, s.sideNameRight, aheadSide === 'away' && { color: '#fff' }]} numberOfLines={2}>{awayLabel}</Text>
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
                <View style={{ flexDirection: 'row', gap: 8 }}>
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
            <LegendDot color={GOLD}      label="Halved" />
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
          const bg        = c === 'h' ? homeColor : c === 'a' ? awayColor : c === 'f' ? GOLD : undefined;
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
      <Text style={{ fontSize: 11, fontFamily: FF, color: '#555' }} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  /* Header */
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  headerLeft: { flex: 1, alignItems: 'flex-start' },
  back:       { fontSize: 14, fontFamily: FFB, color: GOLD },
  headerCenter: { alignItems: 'center' },
  headerLogo:   { width: 28, height: 28 },
  headerSub:    { fontSize: 9, fontFamily: FF, color: '#555', marginTop: 2, letterSpacing: 1.5 },
  headerRight:  { flex: 1 },

  scroll: { padding: 16, paddingBottom: 48 },

  /* Match header card */
  heroCard: {
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c',
    padding: 20, marginBottom: 12,
  },
  pillRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  matchNum: { fontSize: 11, fontFamily: FFB, color: '#555', letterSpacing: 1.5 },

  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(74,222,128,0.10)', borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(74,222,128,0.3)',
    paddingHorizontal: 10, paddingVertical: 3,
  },
  liveDot:     { width: 7, height: 7, borderRadius: 4, backgroundColor: GREEN },
  livePillText: { fontSize: 11, fontFamily: FFB, color: GREEN, letterSpacing: 1 },

  completePill: {
    backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)',
    paddingHorizontal: 10, paddingVertical: 3,
  },
  completePillText: { fontSize: 11, fontFamily: FFB, color: GOLD, letterSpacing: 1 },

  heroRow:       { flexDirection: 'row', alignItems: 'flex-start' },
  heroSide:      { flex: 1, alignItems: 'flex-start' },
  heroSideRight: { alignItems: 'flex-end' },
  avatarRing:    { borderRadius: 36, borderWidth: 2, padding: 2, marginBottom: 8 },
  sideName:      { fontSize: 15, fontFamily: FFB, color: '#888', lineHeight: 20 },
  sideNameRight: { textAlign: 'right' },
  sidePlayers:   { fontSize: 11, fontFamily: FF, color: '#555', marginTop: 2 },

  heroCenter: { alignItems: 'center', paddingHorizontal: 8, paddingTop: 8, minWidth: 72 },
  statusText: { fontSize: 22, fontFamily: FFB, textAlign: 'center', letterSpacing: 0.5 },
  thruText:   { fontSize: 9, fontFamily: FFB, color: '#555', letterSpacing: 1.5, marginTop: 4 },

  leaderBanner: {
    marginTop: 12, borderRadius: 8,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingVertical: 8, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  leaderText: { fontSize: 13, fontFamily: FFB, color: '#555', letterSpacing: 1 },

  /* Now playing */
  nowCard: {
    backgroundColor: '#111', borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)',
    padding: 14, marginBottom: 12,
  },
  nowLabel: { fontSize: 11, fontFamily: FFB, color: GOLD, letterSpacing: 2, marginBottom: 6 },
  nowRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nowHole:  { fontSize: 20, fontFamily: FFB, color: '#fff' },

  /* Grid card */
  gridCard: {
    backgroundColor: '#111', borderRadius: 10,
    borderWidth: 1, borderColor: '#1c1c1c',
    padding: 14, marginBottom: 12,
  },
  gridTitle:   { fontSize: 11, fontFamily: FFB, color: '#555', letterSpacing: 2, marginBottom: 14 },
  gridDivider: { height: 1, backgroundColor: '#1c1c1c', marginVertical: 8 },
  legend:      { flexDirection: 'row', gap: 14, marginTop: 12, flexWrap: 'wrap' },
});

const g = StyleSheet.create({
  wrap:  { marginBottom: 2 },
  label: { fontSize: 9, fontFamily: FFB, color: '#555', letterSpacing: 1.5, marginBottom: 6 },
  row:   { flexDirection: 'row', gap: 3 },
  cell: {
    flex: 1, aspectRatio: 0.72,
    borderRadius: 4, alignItems: 'center', justifyContent: 'center',
  },
  cellEmpty:   { borderWidth: 1, borderColor: '#1c1c1c' },
  cellCurrent: { borderWidth: 2, borderColor: GOLD },
  num:         { fontSize: 8,  fontFamily: FFB, color: '#555' },
  numFilled:   { color: 'rgba(255,255,255,0.7)' },
  char:        { fontSize: 9,  fontFamily: FFB, color: '#555', marginTop: 1 },
  charFilled:  { color: '#fff' },
});

const mc = StyleSheet.create({
  chip: {
    backgroundColor: '#1a1a1a', borderRadius: 6,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingHorizontal: 10, paddingVertical: 4,
    alignItems: 'center', minWidth: 44,
  },
  label: { fontSize: 8, fontFamily: FFB, color: '#555', letterSpacing: 1 },
  value: { fontSize: 15, fontFamily: FFB, color: '#fff' },
});
