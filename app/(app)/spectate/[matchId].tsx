import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Image, Animated,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { matchLabel, getEffectiveWinner, calcHoles, calcCourseHandicap, calcStrokesReceived, calcStablefordPoints, formatStrokeHoles } from '../../../src/lib/scoring';
import { getPlayerAvatar, teamLogos } from '../../../src/lib/assets';
import { initials } from '../../../src/lib/playerDisplay';

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
  start_hole: number | null;
  holes_to_play: number | null;
  is_singles: boolean;
  home_team_id: string | null;
  away_team_id: string | null;
  home_player_ids: string[];
  away_player_ids: string[];
  round_format: 'matchplay' | 'stableford' | 'medal' | 'team_stableford';
  competition_id: string | null;
  hcp_allowance: number | null;
  handicap_method: string | null;
  team_size: number | null;
  counting_scores: number | null;
  side_games: string[] | null;
  player_overrides: Record<string, { hcp?: number; tee?: string }> | null;
  home_team: { name: string; accent_color: string } | null;
  away_team: { name: string; accent_color: string } | null;
  day: { course_name: string | null; day_number: number; competition_id: string; course_par: number | null; course_rating: number | null; slope_rating: number | null } | null;
}

interface Player     { id: string; display_name: string; avatar_url?: string | null; handicap_index: number; }
interface CourseHole { hole_number: number; par: number; stroke_index: number; }
interface CompPlayer { player_id: string; handicap_index: number; }
interface HoleRow    { player_id: string; hole_number: number; gross_score: number | null; stableford_pts: number | null; }

function formatVsPar(n: number): string {
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `${n}`;
}

// Same formula as score/enter/[matchId].tsx's playerCourseHcp — Rick was
// explicit that the calculation must not change, only where it's displayed,
// so this is copied verbatim rather than approximated.
function playerCourseHcp(playerId: string, compPlayers: CompPlayer[], day: MatchDetail['day'], hcpAllowance: number = 100): number {
  const cp = compPlayers.find(c => c.player_id === playerId);
  const hcpIndex = cp?.handicap_index ?? 0;
  const raw = (!day?.slope_rating || !day?.course_rating || !day?.course_par)
    ? Math.round(hcpIndex)
    : calcCourseHandicap(hcpIndex, day.slope_rating, day.course_rating, day.course_par);
  return Math.round(raw * (hcpAllowance / 100));
}

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
  const [compPlayers, setCompPlayers] = useState<CompPlayer[]>([]);
  const [holeRows, setHoleRows]       = useState<HoleRow[]>([]);
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
      .select('*, home_team:home_team_id(name,accent_color), away_team:away_team_id(name,accent_color), day:day_id(course_name,day_number,competition_id,course_par,course_rating,slope_rating)')
      .eq('id', matchId)
      .single();

    if (!matchData) { setLoading(false); return; }
    setMatch(matchData as unknown as MatchDetail);

    const allIds    = [...(matchData.home_player_ids ?? []), ...(matchData.away_player_ids ?? [])];
    const courseName = (matchData as any).day?.course_name;
    const compId     = (matchData as any).day?.competition_id;

    const [{ data: pd }, { data: cd }, { data: compData }, { data: cpData }, { data: mhData }] = await Promise.all([
      allIds.length
        ? supabase.from('players').select('id,display_name,avatar_url,handicap_index').in('id', allIds)
        : Promise.resolve({ data: [] }),
      courseName
        ? supabase.from('course_holes').select('hole_number,par,stroke_index').eq('course_name', courseName).order('hole_number')
        : Promise.resolve({ data: [] }),
      compId
        ? supabase.from('competitions').select('name').eq('id', compId).single()
        : Promise.resolve({ data: null }),
      // Same precedence as score/enter/[matchId].tsx: competition_players
      // (max_handicap-capped) wins over the raw player record, then a
      // per-match override on top — otherwise a spectator sees a different
      // handicap/stroke allocation than the match is actually using.
      (matchData as any).competition_id && allIds.length
        ? supabase.from('competition_players').select('player_id,handicap_index').eq('competition_id', (matchData as any).competition_id).in('player_id', allIds)
        : Promise.resolve({ data: [] as CompPlayer[] }),
      // Per-hole scores — needed to mirror the actual game's live result
      // (Stableford points / Medal vs-par / Team Stableford total) instead
      // of assuming every format is Match Play.
      supabase.from('match_holes').select('player_id,hole_number,gross_score,stableford_pts').eq('match_id', matchId),
    ]);

    if (pd) {
      setPlayers(pd);
      const compMap = new Map((cpData ?? []).map(cp => [cp.player_id, cp]));
      const fallback: CompPlayer[] = (pd as Player[]).map(p => ({ player_id: p.id, handicap_index: p.handicap_index ?? 0 }));
      const rawComp = fallback.map(f => compMap.get(f.player_id) ?? f);
      const overrides = (matchData as any).player_overrides ?? {};
      const effectiveComp = rawComp.map(cp => {
        const ov = overrides[cp.player_id]?.hcp;
        return ov != null ? { ...cp, handicap_index: ov } : cp;
      });
      setCompPlayers(effectiveComp);
    }
    if (cd)       setCourseHoles(cd);
    if (compData) setCompName((compData as any).name ?? '');
    setHoleRows((mhData as HoleRow[] | null) ?? []);
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
      <Text style={{ color: '#fff', fontFamily: FFB }}>Match not found.</Text>
    </View>
  );

  const holesStr    = match.holes_string ?? '..................';
  const holeChars   = holesStr.split('');
  const holesToPlay = match.holes_to_play ?? 18;
  const { homeUp }  = calcHoles(holesStr, holesToPlay);
  const holesPlayed = holeChars.filter(c => c !== '.').length;
  // Rounds don't always start at hole 1 — walk the actual play sequence (from
  // start_hole, wrapping at 18) to find the true next unplayed hole, same as
  // the live scoring screen does. Falls back to the first non-'.' position if
  // start_hole isn't set.
  const inferredStartHole = (() => { const i = holeChars.findIndex(c => c !== '.'); return i >= 0 ? i + 1 : 1; })();
  const effectiveStartHole = match.start_hole ?? inferredStartHole;
  const fullHoleSequence = effectiveStartHole > 1
    ? [...Array.from({ length: 19 - effectiveStartHole }, (_, i) => effectiveStartHole + i), ...Array.from({ length: effectiveStartHole - 1 }, (_, i) => i + 1)]
    : Array.from({ length: 18 }, (_, i) => i + 1);
  // A 9-hole round (front or back) only ever plays the first N holes of the
  // sequence — "now playing" must stop there, not wrap into the unplayed 9.
  const holeSequence = fullHoleSequence.slice(0, holesToPlay);
  const currentHole = holeSequence.find(h => holeChars[h - 1] === '.') ?? (holeSequence[holeSequence.length - 1] ?? 18);
  const status      = match.status;
  const winner      = getEffectiveWinner(status, match.winner, holesStr, holesToPlay);

  const firstName  = (id: string) => (players.find(p => p.id === id)?.display_name ?? '?').split(' ')[0];
  const getAvatar  = (id: string) => players.find(p => p.id === id)?.avatar_url ?? null;

  const isMatchplay      = match.round_format === 'matchplay';
  const isMedal          = match.round_format === 'medal';
  const isTeamStableford = match.round_format === 'team_stableford';
  const allPlayerIds = [...match.home_player_ids, ...match.away_player_ids];
  // No real away side (e.g. a multi-player Stableford group, not a head-to-
  // head) — same signal score/preview/[matchId].tsx uses to switch from the
  // two-team hero layout to individual player cards.
  const isSolo = match.away_player_ids.length === 0;

  // Live per-hole scores, keyed the same way score/enter's own holeData is —
  // used below to mirror the actual game's current result instead of
  // assuming every format plays like Match Play.
  const holeData: Record<string, Record<number, { gross: number | null; pts: number | null }>> = {};
  for (const row of holeRows) {
    if (!holeData[row.player_id]) holeData[row.player_id] = {};
    holeData[row.player_id][row.hole_number] = { gross: row.gross_score, pts: row.stableford_pts };
  }

  // Stableford: round_format 'stableford' has no separate side-game, so
  // stableford_pts here is always the main-game value — same sum score/enter
  // uses for its own leader banner.
  const stablefordTotals: Record<string, number> = {};
  for (const id of allPlayerIds) {
    stablefordTotals[id] = Object.values(holeData[id] ?? {}).reduce((sum, h) => sum + (h.pts ?? 0), 0);
  }
  const stablefordLeaderId = allPlayerIds.length
    ? [...allPlayerIds].sort((a, b) => (stablefordTotals[b] ?? 0) - (stablefordTotals[a] ?? 0))[0]
    : null;
  const stablefordLeaderPts = stablefordLeaderId ? (stablefordTotals[stablefordLeaderId] ?? 0) : 0;
  const stablefordLeaderText = stablefordLeaderPts > 0
    ? (allPlayerIds.length === 1
        ? `${stablefordLeaderPts} POINTS`
        : `${firstName(stablefordLeaderId!)} LEADS · ${stablefordLeaderPts}PTS`)
    : null;

  // Medal: ranked by gross-vs-par, same as score/enter's medal leaderboard —
  // never by stableford_pts, which is a different number kept only for the
  // independent side game/stats.
  const parByHole: Record<number, number> = {};
  courseHoles.forEach(h => { parByHole[h.hole_number] = h.par; });
  const medalStats: Record<string, { vsPar: number; played: number }> = {};
  for (const id of allPlayerIds) {
    const entries = Object.entries(holeData[id] ?? {}).filter(([, d]) => d.gross != null);
    medalStats[id] = {
      vsPar: entries.reduce((sum, [h, d]) => sum + ((d.gross ?? 0) - (parByHole[Number(h)] ?? 0)), 0),
      played: entries.length,
    };
  }
  const medalPlayedIds = allPlayerIds.filter(id => (medalStats[id]?.played ?? 0) > 0);
  const medalLeaderId = medalPlayedIds.length
    ? medalPlayedIds.reduce((best, id) => (medalStats[id].vsPar < medalStats[best].vsPar ? id : best), medalPlayedIds[0])
    : null;
  const medalLeaderText = medalLeaderId
    ? (allPlayerIds.length === 1
        ? formatVsPar(medalStats[medalLeaderId].vsPar)
        : `${firstName(medalLeaderId)} LEADS · ${formatVsPar(medalStats[medalLeaderId].vsPar)}`)
    : null;

  // Team Stableford: identical "best N counted per hole" reducer as
  // score/teamstableford/[matchId].tsx's own live total — copied rather than
  // approximated so spectate never drifts from the real team score. Uses the
  // team screen's own handicap formula (raw handicap_index x allowance%),
  // not playerCourseHcp — they're genuinely different calculations there.
  function teamHolePts(playerIds: string[], holeNum: number): number {
    const hole = courseHoles.find(h => h.hole_number === holeNum);
    if (!hole) return 0;
    const isPar3 = hole.par === 3;
    const countN = (match!.side_games?.includes('par3all') && isPar3)
      ? (match!.team_size ?? 2)
      : (match!.counting_scores ?? 2);
    const data = playerIds.map(id => {
      const gross = holeData[id]?.[holeNum]?.gross ?? null;
      const player = players.find(p => p.id === id);
      let pts = 0;
      if (gross != null && player) {
        const adjHcp = Math.round(player.handicap_index * ((match!.hcp_allowance ?? 100) / 100));
        pts = calcStablefordPoints(gross, hole.par, calcStrokesReceived(adjHcp, hole.stroke_index));
      }
      return { id, pts, entered: gross != null };
    });
    const countingIds = new Set([...data].sort((a, b) => b.pts - a.pts).slice(0, countN).filter(p => p.entered).map(p => p.id));
    return data.filter(p => countingIds.has(p.id)).reduce((sum, p) => sum + p.pts, 0);
  }
  function teamRunningTotal(playerIds: string[]): number {
    let total = 0;
    for (let h = 1; h <= 18; h++) {
      if (!playerIds.some(id => (holeData[id]?.[h]?.gross ?? null) != null)) continue;
      total += teamHolePts(playerIds, h);
    }
    return total;
  }
  const teamHomeTotal = isTeamStableford ? teamRunningTotal(match.home_player_ids) : 0;
  const teamAwayTotal = isTeamStableford && match.away_player_ids.length ? teamRunningTotal(match.away_player_ids) : 0;

  const label = isMatchplay
    ? matchLabel(status, match.winner, match.result_str, holesStr, holesToPlay)
    : isTeamStableford
      ? (status === 'complete' ? (match.result_str ?? 'Complete')
          : status === 'upcoming' ? 'Upcoming'
          : `${teamHomeTotal} - ${teamAwayTotal} PTS`)
      : (status === 'complete' ? (match.result_str ?? 'Complete')
          : status === 'upcoming' ? 'Upcoming'
          : (isMedal ? (medalLeaderText ?? 'In Progress') : (stablefordLeaderText ?? 'In Progress')));

  const aheadSide = isMatchplay
    ? (status === 'complete' ? winner : homeUp > 0 ? 'home' : homeUp < 0 ? 'away' : null)
    : isTeamStableford
      ? (status === 'complete' ? match.winner : (teamHomeTotal > teamAwayTotal ? 'home' : teamAwayTotal > teamHomeTotal ? 'away' : null))
      : null;

  const homeColor = match.home_team?.accent_color ?? GOLD;
  const awayColor = match.away_team?.accent_color ?? '#6366f1';

  const homeLabel  = match.home_team?.name ?? match.home_player_ids.map(firstName).join(' & ');
  const awayLabel  = match.away_team?.name ?? match.away_player_ids.map(firstName).join(' & ');
  const aheadLabel = aheadSide === 'home' ? homeLabel : aheadSide === 'away' ? awayLabel : null;
  const aheadColor = aheadSide === 'home' ? homeColor : aheadSide === 'away' ? awayColor : '#555';
  const currentCourseHole = courseHoles.find(h => h.hole_number === currentHole);

  // Rick: the detailed player-by-player shot panel from the 4BBB/Matchplay
  // screen must show here too, for every format, not a simplified version —
  // "the only difference with Spectator Mode is that the spectator cannot
  // enter or change scores." Same calculation as score/enter/[matchId].tsx's
  // matchplayHcp, just read-only here.
  const playedCourseHoles = courseHoles.filter(h => holeSequence.includes(h.hole_number));
  const showStrokeAllocation = allPlayerIds.length > 1 && playedCourseHoles.length > 0 && players.length > 0;
  const strokeAllocation = showStrokeAllocation
    ? (() => {
        const cutHcpFor = (id: string) => playerCourseHcp(id, compPlayers, match.day, match.hcp_allowance ?? 100);
        const isRelativeHcp = match.handicap_method === 'relative_low';
        const groupLowest = isRelativeHcp ? Math.min(...allPlayerIds.map(cutHcpFor)) : 0;
        return allPlayerIds.map(id => {
          const cutHcp = cutHcpFor(id);
          const effectiveHcp = isRelativeHcp ? Math.max(0, cutHcp - groupLowest) : cutHcp;
          // Same main-game handicap used above for the stroke-holes text —
          // never the 100%-allowance Stableford side-game allocation.
          const getsShot = !!currentCourseHole && calcStrokesReceived(effectiveHcp, currentCourseHole.stroke_index) >= 1;
          return { id, text: formatStrokeHoles(effectiveHcp, playedCourseHoles), getsShot };
        });
      })()
    : [];

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

          {isSolo ? (
            <>
              <View style={s.heroSoloStatus}>
                <Text style={[
                  s.statusTextSolo,
                  (status === 'in_progress' || status === 'complete') && { color: GOLD },
                  status === 'upcoming' && { color: '#fff' },
                ]}>{label}</Text>
                {status === 'in_progress' && (
                  <Text style={s.thruText}>
                    {holesPlayed === 0 ? 'STARTING' : `THRU ${holesPlayed}`}
                  </Text>
                )}
              </View>
              {/* Individual players — no real away side, so one avatar-on-
                  top-of-name card per player instead of the two-team
                  layout (same pattern as score/preview's isSolo branch). */}
              <View style={s.heroSoloRow}>
                {match.home_player_ids.map(id => {
                  // Main-game score under the name — vs-par for Medal
                  // (never Stableford points, per the Medal fix), points
                  // for Stableford/Team Stableford.
                  const medalStat = medalStats[id];
                  const playerScore = isMedal
                    ? ((medalStat?.played ?? 0) > 0 ? formatVsPar(medalStat.vsPar) : '—')
                    : ((stablefordTotals[id] ?? 0) > 0 ? `${stablefordTotals[id]} PTS` : '—');
                  return (
                    <View key={id} style={s.heroPlayerCard}>
                      <View style={s.heroPlayerAvatarRing}>
                        <SideAvatar playerIds={[id]} team={null} teamId={null} size={52} getFirstName={firstName} getAvatar={getAvatar} />
                      </View>
                      <Text style={s.heroPlayerName} numberOfLines={1}>{firstName(id)}</Text>
                      <Text style={s.heroPlayerScore} numberOfLines={1}>{playerScore}</Text>
                    </View>
                  );
                })}
              </View>
            </>
          ) : (
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
                  (status === 'in_progress' || status === 'complete') && { color: GOLD },
                  status === 'upcoming' && { color: '#fff' },
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
          )}

          {/* Leader banner */}
          {aheadLabel ? (
            <View style={[s.leaderBanner, { borderColor: aheadColor + '55' }]}>
              <Text style={[s.leaderText, { color: aheadColor }]}>
                {aheadSide === 'away' ? '' : '◀ '}
                {aheadLabel} {status === 'complete' ? 'WIN' : 'LEAD'}
                {aheadSide === 'home' ? '' : ' ▶'}
              </Text>
            </View>
          ) : isMatchplay && status === 'in_progress' && holesPlayed > 0 ? (
            <View style={s.leaderBanner}>
              <Text style={s.leaderText}>— ALL SQUARE —</Text>
            </View>
          ) : null}
        </View>

        {/* ── Now Playing ── */}
        {status === 'in_progress' && holesPlayed < holesToPlay && (
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

        {/* ── Shot allocation — same detailed panel as score/enter, every
            format, not a simplified spectator-only version ── */}
        {showStrokeAllocation && (
          <View style={s.strokeCard}>
            <Text style={s.strokeTitle}>SHOT ALLOCATION</Text>
            {strokeAllocation.map(({ id, text, getsShot }) => {
              const isHome = match.home_player_ids.includes(id);
              const shortName = initials(players.find(p => p.id === id)?.display_name ?? '?');
              return (
                <View key={id} style={s.strokeRow}>
                  <SideAvatar playerIds={[id]} team={null} teamId={null} size={28} getFirstName={firstName} getAvatar={getAvatar} />
                  <Text style={[s.strokeName, { color: isHome ? homeColor : awayColor }]} numberOfLines={1}>{shortName}</Text>
                  {status === 'in_progress' && getsShot && (
                    <View style={s.shotPill}>
                      <Text style={s.shotPillText}>SHOT</Text>
                    </View>
                  )}
                  <Text style={s.strokeText} numberOfLines={3}>{text}</Text>
                </View>
              );
            })}
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
      <Text style={{ fontSize: 11, fontFamily: FFB, color: '#fff' }} numberOfLines={1}>{label}</Text>
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
  headerSub:    { fontSize: 9, fontFamily: FFB, color: '#fff', marginTop: 2, letterSpacing: 1.5 },
  headerRight:  { flex: 1 },

  scroll: { padding: 16, paddingBottom: 48 },

  /* Match header card */
  heroCard: {
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c',
    padding: 20, marginBottom: 12,
  },
  pillRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  matchNum: { fontSize: 11, fontFamily: FFB, color: '#fff', letterSpacing: 1.5 },

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
  sideName:      { fontSize: 15, fontFamily: FFB, color: '#fff', lineHeight: 20 },
  sideNameRight: { textAlign: 'right' },
  sidePlayers:   { fontSize: 11, fontFamily: FFB, color: '#fff', marginTop: 2 },

  // Individual player cards (isSolo — no real away side), same avatar-on-
  // top-of-name pattern as score/preview's isSolo branch.
  heroSoloRow:         { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 18 },
  heroPlayerCard:       { alignItems: 'center', gap: 6, width: 66 },
  heroPlayerAvatarRing: { borderRadius: 29, borderWidth: 2, borderColor: `${GOLD}40`, padding: 2 },
  heroPlayerName:       { fontSize: 13, fontFamily: FFB, color: '#fff' },
  heroPlayerScore:      { fontSize: 15, fontFamily: FFB, color: GOLD },
  heroSoloStatus:       { alignItems: 'center', marginBottom: 14 },

  heroCenter: { alignItems: 'center', paddingHorizontal: 8, paddingTop: 8, minWidth: 72 },
  statusText:      { fontSize: 22, fontFamily: FFB, textAlign: 'center', letterSpacing: 0.5 },
  statusTextSolo:  { fontSize: 16, fontFamily: FFB, textAlign: 'center', letterSpacing: 0.5 },
  thruText:   { fontSize: 9, fontFamily: FFB, color: '#fff', letterSpacing: 1.5, marginTop: 4 },

  leaderBanner: {
    marginTop: 12, borderRadius: 8,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingVertical: 8, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  leaderText: { fontSize: 13, fontFamily: FFB, color: '#fff', letterSpacing: 1 },

  /* Now playing */
  nowCard: {
    backgroundColor: '#111', borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)',
    padding: 14, marginBottom: 12,
  },
  nowLabel: { fontSize: 11, fontFamily: FFB, color: GOLD, letterSpacing: 2, marginBottom: 6 },
  nowRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nowHole:  { fontSize: 20, fontFamily: FFB, color: '#fff' },

  /* Shot allocation */
  strokeCard: {
    backgroundColor: '#111', borderRadius: 10,
    borderWidth: 1, borderColor: '#1c1c1c',
    padding: 14, marginBottom: 12, gap: 10,
  },
  strokeTitle: { fontSize: 11, fontFamily: FFB, color: GOLD, letterSpacing: 2, marginBottom: 2 },
  strokeRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  strokeName:  { width: 32, fontSize: 13, fontFamily: FFB },
  strokeText:  { flex: 1, fontSize: 12, fontFamily: FFB, color: '#fff', textAlign: 'right' },
  shotPill:    { backgroundColor: GOLD, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  shotPillText: { fontFamily: FFB, fontSize: 9, color: '#000', letterSpacing: 0.5 },

  /* Grid card */
  gridCard: {
    backgroundColor: '#111', borderRadius: 10,
    borderWidth: 1, borderColor: '#1c1c1c',
    padding: 14, marginBottom: 12,
  },
  gridTitle:   { fontSize: 11, fontFamily: FFB, color: '#fff', letterSpacing: 2, marginBottom: 14 },
  gridDivider: { height: 1, backgroundColor: '#1c1c1c', marginVertical: 8 },
  legend:      { flexDirection: 'row', gap: 14, marginTop: 12, flexWrap: 'wrap' },
});

const g = StyleSheet.create({
  wrap:  { marginBottom: 2 },
  label: { fontSize: 9, fontFamily: FFB, color: '#fff', letterSpacing: 1.5, marginBottom: 6 },
  row:   { flexDirection: 'row', gap: 3 },
  cell: {
    flex: 1, aspectRatio: 0.72,
    borderRadius: 4, alignItems: 'center', justifyContent: 'center',
  },
  cellEmpty:   { borderWidth: 1, borderColor: '#1c1c1c' },
  cellCurrent: { borderWidth: 2, borderColor: GOLD },
  num:         { fontSize: 8,  fontFamily: FFB, color: '#fff' },
  numFilled:   { color: 'rgba(255,255,255,0.7)' },
  char:        { fontSize: 9,  fontFamily: FFB, color: '#fff', marginTop: 1 },
  charFilled:  { color: '#fff' },
});

const mc = StyleSheet.create({
  chip: {
    backgroundColor: '#1a1a1a', borderRadius: 6,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingHorizontal: 10, paddingVertical: 4,
    alignItems: 'center', minWidth: 44,
  },
  label: { fontSize: 8, fontFamily: FFB, color: '#fff', letterSpacing: 1 },
  value: { fontSize: 15, fontFamily: FFB, color: '#fff' },
});
