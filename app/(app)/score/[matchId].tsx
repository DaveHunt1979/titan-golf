import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  ActivityIndicator, TouchableOpacity,
  RefreshControl, Image, Alert, useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { matchLabel, getEffectiveWinner, calcHoles } from '../../../src/lib/scoring';
import { getPlayerAvatar, teamLogos } from '../../../src/lib/assets';

const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const RED    = '#f87171';
const BLUE   = '#3b82f6';
const ORANGE = '#f97316';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

function ptsColor(pts: number): string {
  if (pts >= 4) return GOLD;
  if (pts === 3) return GREEN;
  if (pts === 2) return BLUE;
  if (pts === 1) return ORANGE;
  return RED;
}

function Avatar({ name, color, size = 40, source }: { name: string; color: string; size?: number; source?: any }) {
  if (source) {
    const imgSrc = typeof source === 'string' ? { uri: source } : source;
    return <Image source={imgSrc} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${color}20`, borderWidth: 1.5, borderColor: `${color}60`, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: FFB, fontSize: size * 0.38, color }}>{(name || '?').charAt(0).toUpperCase()}</Text>
    </View>
  );
}

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

export default function MatchDetailScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [holeResults, setHoleResults] = useState<HoleResult[]>([]);
  const [courseHoles, setCourseHoles] = useState<CourseHole[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cardPage, setCardPage] = useState(0);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const { width: screenWidth } = useWindowDimensions();

  async function load() {
    const { data: matchData } = await supabase
      .from('matches')
      .select(`*, home_team:home_team_id(name,accent_color), away_team:away_team_id(name,accent_color), day:day_id(course_name,course_par,day_number,competition:competition_id(format))`)
      .eq('id', matchId)
      .single();

    if (!matchData) { setLoading(false); return; }
    setMatch(matchData as unknown as MatchDetail);

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: p } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (p) setMyPlayerId((p as any).id);
    }

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
              if (error) Alert.alert('Error', error.message ?? 'Could not delete game');
              else router.back();
            });
        },
      },
    ]);
  }

  const playerName = (id: string) => players.find(p => p.id === id)?.display_name?.split(' ')[0] ?? '?';
  const grossForHole = (pid: string, hole: number) => holeResults.find(h => h.player_id === pid && h.hole_number === hole)?.gross_score ?? null;
  const stablefordForHole = (pid: string, hole: number) => holeResults.find(h => h.player_id === pid && h.hole_number === hole)?.stableford_pts ?? null;

  const holesStr = match?.holes_string ?? '..................';
  const holeChars = holesStr.split('');
  const status = match?.status ?? 'upcoming';
  const label = match ? matchLabel(status, match.winner, match.result_str, holesStr) : '';
  const winner = match ? getEffectiveWinner(status, match.winner, holesStr) : null;
  const { homeUp } = calcHoles(holesStr);
  const currentlyAhead = status === 'complete' ? winner : homeUp > 0 ? 'home' : homeUp < 0 ? 'away' : null;
  const homeColor = match?.home_team?.accent_color ?? GOLD;
  const awayColor = match?.away_team?.accent_color ?? '#6366f1';
  const isStrokePlay = match?.round_format === 'stableford' || match?.round_format === 'medal';
  const allPlayerIds = match ? [...match.home_player_ids, ...match.away_player_ids] : [];
  const playerTotals = allPlayerIds.reduce((acc, pid) => {
    acc[pid] = holeResults.filter(h => h.player_id === pid).reduce((s, h) => s + (h.stableford_pts ?? 0), 0);
    return acc;
  }, {} as Record<string, number>);
  const sortedByPts = [...allPlayerIds].sort((a, b) => (playerTotals[b] ?? 0) - (playerTotals[a] ?? 0));
  const spLeaderId = sortedByPts[0];
  const spLeaderPts = spLeaderId ? (playerTotals[spLeaderId] ?? 0) : 0;
  const spLeaderName = spLeaderId ? playerName(spLeaderId) : null;
  const holesPlayed = holeChars.filter(c => c !== '.').length;
  const holesLeft = 18 - holesPlayed;

  const statusText = isStrokePlay
    ? (spLeaderPts > 0 ? `${spLeaderName} leads · ${spLeaderPts}pts` : 'Not started')
    : (status === 'complete' ? label : homeUp === 0 ? 'All Square' : homeUp > 0 ? `${match?.home_team?.name ?? 'Home'}  ${homeUp} Up` : `${match?.away_team?.name ?? 'Away'}  ${Math.abs(homeUp)} Up`);
  const statusColor = isStrokePlay ? GOLD : (currentlyAhead === 'home' ? homeColor : currentlyAhead === 'away' ? awayColor : '#ffffff');
  const statusSub = status === 'complete' ? 'Match complete' : holesPlayed === 0 ? 'Not started' : `${holesLeft} holes to play`;

  const formatLabel = (() => {
    const f = match?.round_format ?? '';
    const map: Record<string, string> = { stableford: 'Stableford', medal: 'Stroke Play', matchplay: 'Matchplay', skins: 'Skins', nassau: 'Nassau', wolf: 'Wolf', scramble: 'Scramble', bbb: 'Best Ball', modified_stableford: 'Modified Stableford', par_bogey: 'Par/Bogey', chacha: 'Cha Cha Cha' };
    return map[f] ?? f;
  })();

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' }}>
      <ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  if (!match) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' }}>
      <Text style={{ fontFamily: FFB, color: '#fff' }}>Match not found.</Text>
    </View>
  );

  const isMember = myPlayerId && allPlayerIds.includes(myPlayerId);

  async function handleEnterScores() {
    const courseName = match!.day?.course_name ?? null;
    const isSolo = match!.away_player_ids.length === 0 && match!.home_player_ids.length === 1;

    let availableTees: string[] = [];
    if (courseName) {
      const { data: teeData } = await supabase
        .from('course_holes')
        .select('tee_yardages')
        .eq('course_name', courseName)
        .limit(1)
        .single();
      const ty = (teeData as any)?.tee_yardages ?? {};
      availableTees = Object.keys(ty).filter(k => ty[k] > 0);
    }

    const navigate = (startHole: number) => {
      const buildUrl = (base: string, teeColor?: string) => {
        const params = new URLSearchParams();
        if (startHole !== 1) params.set('startHole', String(startHole));
        if (teeColor)        params.set('teeColor', teeColor);
        const qs = params.toString();
        return qs ? `${base}?${qs}` : base;
      };

      const goToScorer = (teeColor?: string) => {
        if (isSolo) { router.push(buildUrl(`/(app)/score/solo/${matchId}`, teeColor) as any); return; }
        const fmt = match?.round_format ?? '';
        const specialRoutes: Record<string, string> = {
          skins: `/(app)/score/skins/${matchId}`,
          nassau: `/(app)/score/nassau/${matchId}`,
          scramble: `/(app)/score/scramble/${matchId}`,
          modified_stableford: `/(app)/score/modified/${matchId}`,
          par_bogey: `/(app)/score/parbogey/${matchId}`,
          team_stableford: `/(app)/score/teamstableford/${matchId}`,
          best2from4:      `/(app)/score/teamstableford/${matchId}`,
          best2from4_par3all: `/(app)/score/teamstableford/${matchId}`,
        };
        if (specialRoutes[fmt]) router.push(specialRoutes[fmt] as any);
        else router.push(buildUrl(`/(app)/score/enter/${matchId}`, teeColor) as any);
      };

      if (availableTees.length > 1) {
        const TEE_LABELS: Record<string, string> = { black: '⚫ Black', white: '⚪ White', yellow: '🟡 Yellow', blue: '🔵 Blue', red: '🔴 Red', gold: '🟠 Gold' };
        Alert.alert('Which Tees?', 'Select the tees you\'re playing from:', availableTees.map(t => ({ text: TEE_LABELS[t] ?? t, onPress: () => goToScorer(t) })));
      } else {
        goToScorer(availableTees[0]);
      }
    };

    Alert.alert('Starting Hole', 'Which hole are you starting from?', [
      { text: 'Hole 1 (Front 9)', onPress: () => navigate(1) },
      { text: 'Hole 10 (Back 9)', onPress: () => navigate(10) },
    ]);
  }

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerSide} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerSub} numberOfLines={1}>
            {match.day?.course_name ? `${match.day.course_name} · ${formatLabel}` : formatLabel}
          </Text>
        </View>
        <TouchableOpacity style={s.headerSide} onPress={() => router.push(`/(app)/rangefinder?courseName=${encodeURIComponent(match?.day?.course_name ?? '')}&holeNumber=1` as any)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="scan-outline" size={22} color={GOLD} />
        </TouchableOpacity>
      </View>

      {/* ── Status banner ── */}
      <View style={s.statusBanner}>
        {status === 'complete' && <Ionicons name="trophy" size={20} color={GOLD} style={{ marginBottom: 4 }} />}
        {status === 'in_progress' && <View style={s.livePulse} />}
        <Text style={[s.statusMain, { color: statusColor }]}>{statusText}</Text>
        <Text style={s.statusSub}>{statusSub}</Text>
      </View>

      {/* ── Players row ── */}
      <View style={s.playersRow}>
        {allPlayerIds.map(id => {
          const isHome = match.home_player_ids.includes(id);
          const teamColor = isHome ? homeColor : awayColor;
          const src = players.find(p => p.id === id)?.avatar_url ?? getPlayerAvatar(id, 'normal');
          const firstName = playerName(id);
          const total = playerTotals[id] ?? 0;
          const isLeader = id === spLeaderId && spLeaderPts > 0;
          return (
            <View key={id} style={s.playerPill}>
              <View style={[s.playerPillAvatar, isLeader && { borderColor: GOLD, borderWidth: 2 }]}>
                <Avatar name={firstName} color={teamColor} size={44} source={src} />
              </View>
              <Text style={[s.playerPillName, { color: '#ffffff', opacity: isLeader ? 1 : 0.6 }]} numberOfLines={1}>{firstName}</Text>
              {total > 0 && (
                <Text style={[s.playerPillPts, { color: isLeader ? GOLD : '#fff' }]}>
                  {isStrokePlay ? `${total}pts` : ''}
                </Text>
              )}
            </View>
          );
        })}
      </View>

      {/* ── Hole result strip ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.holeStrip} style={s.holeStripWrap}>
        {Array.from({ length: 18 }, (_, i) => {
          const h = i + 1;
          const c = holeChars[h - 1] ?? '.';
          const isPlayed = c !== '.';
          const ch = courseHoles.find(x => x.hole_number === h);
          let resultColor = 'transparent';
          if (c === 'h') resultColor = homeColor;
          else if (c === 'a') resultColor = awayColor;
          else if (c === 'f') resultColor = '#4b5563';
          else if (c === 'd') {
            const bestPts = Math.max(0, ...allPlayerIds.map(id => stablefordForHole(id, h) ?? 0));
            resultColor = bestPts > 0 ? ptsColor(bestPts) : '#22c55e';
          }
          return (
            <View
              key={h}
              style={[
                s.holeTile,
                isPlayed && { backgroundColor: `${resultColor}22`, borderColor: `${resultColor}60` },
              ]}
            >
              <Text style={[s.holeTileNum, isPlayed && { color: resultColor }]}>{h}</Text>
              <Text style={s.holeTilePar}>P{ch?.par ?? '?'}</Text>
              {isPlayed && isStrokePlay && (() => {
                const best = Math.max(0, ...allPlayerIds.map(id => stablefordForHole(id, h) ?? 0));
                return best > 0 ? <Text style={[s.holeTilePts, { color: ptsColor(best) }]}>{best}</Text> : null;
              })()}
              {isPlayed && !isStrokePlay && (
                <Text style={[s.holeTilePts, { color: resultColor }]}>
                  {c === 'h' ? 'H' : c === 'a' ? 'A' : '='}
                </Text>
              )}
            </View>
          );
        })}
      </ScrollView>
      <View style={s.halfLabels}>
        <Text style={s.halfLabel}>FRONT 9</Text>
        <Text style={s.halfLabel}>BACK 9</Text>
      </View>

      {/* ── Scrollable content ── */}
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={GOLD} />}
      >
        {/* Settings tags */}
        {(match.side_games?.filter(g => !g.startsWith('voice')).length > 0 || match.hcp_allowance !== 100) && (
          <View style={s.tagsRow}>
            {match.hcp_allowance !== 100 && (
              <View style={s.tag}>
                <Ionicons name="person-outline" size={10} color="#fff" />
                <Text style={s.tagText}>{match.hcp_allowance === 0 ? 'Scratch' : `${match.hcp_allowance}% HCP`}</Text>
              </View>
            )}
            {match.side_games?.filter(g => !g.startsWith('voice')).map(g => (
              <View key={g} style={[s.tag, s.tagGold]}>
                <Ionicons name={g.startsWith('Longest') ? 'flag-outline' : 'locate-outline'} size={10} color={GOLD} />
                <Text style={[s.tagText, { color: GOLD }]}>{g.split(':')[0]}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Scorecards per player */}
        {courseHoles.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>SCORECARDS</Text>
            <ScrollView
              horizontal pagingEnabled
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={e => setCardPage(Math.round(e.nativeEvent.contentOffset.x / screenWidth))}
              style={{ marginHorizontal: -16 }}
            >
              {[
                ...match.home_player_ids.map(pid => ({ pid, color: homeColor })),
                ...match.away_player_ids.map(pid => ({ pid, color: awayColor })),
              ].map(({ pid, color }) => {
                const name = playerName(pid);
                const gross = (hole: number) => grossForHole(pid, hole);
                const pts   = (hole: number) => stablefordForHole(pid, hole);
                const front = courseHoles.filter(h => h.hole_number <= 9).sort((a, b) => a.hole_number - b.hole_number);
                const back  = courseHoles.filter(h => h.hole_number >= 10).sort((a, b) => a.hole_number - b.hole_number);
                const totGross = courseHoles.reduce((s, h) => s + (gross(h.hole_number) ?? 0), 0);
                const totPts   = courseHoles.reduce((s, h) => s + (pts(h.hole_number) ?? 0), 0);
                const frontPar = front.reduce((s, h) => s + h.par, 0);
                const backPar  = back.reduce((s, h) => s + h.par, 0);
                const hasScores = courseHoles.some(h => gross(h.hole_number) !== null);

                const SL = 36; const SC = 26; const ST = 32;

                const ScCell = ({ val, par: p }: { val: number | null; par: number | null }) => {
                  const diff = val !== null && p !== null ? val - p : null;
                  const bg = diff === null ? 'transparent' : diff < 0 ? `${GREEN}25` : diff === 0 ? '#1a1a1a' : `${RED}15`;
                  const tc = diff === null ? '#333' : diff < 0 ? GREEN : diff === 0 ? '#fff' : RED;
                  return (
                    <View style={{ width: SC, height: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, borderRadius: 4 }}>
                      <Text style={{ fontFamily: FFB, fontSize: 11, color: val ? tc : '#2a2a2a' }}>{val ?? '·'}</Text>
                    </View>
                  );
                };

                const renderHalf = (holes: CourseHole[], outLabel: string, showTot: boolean) => (
                  <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', backgroundColor: '#0a0a0a' }}>
                      <Text style={{ width: SL, fontFamily: FFB, fontSize: 8, color: '#fff', paddingLeft: 8 }}>HOLE</Text>
                      {holes.map(h => <Text key={h.hole_number} style={{ width: SC, fontFamily: FFB, fontSize: 10, color: gross(h.hole_number) ? '#ffffff' : '#444', textAlign: 'center' }}>{h.hole_number}</Text>)}
                      <Text style={{ width: ST, fontFamily: FFB, fontSize: 9, color: GOLD, textAlign: 'center' }}>{outLabel}</Text>
                      {showTot && <Text style={{ width: ST, fontFamily: FFB, fontSize: 9, color: GOLD, textAlign: 'center' }}>TOT</Text>}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
                      <Text style={{ width: SL, fontFamily: FFB, fontSize: 8, color: '#444', paddingLeft: 8 }}>PAR</Text>
                      {holes.map(h => <Text key={h.hole_number} style={{ width: SC, fontFamily: FFB, fontSize: 9, color: GOLD, textAlign: 'center' }}>{h.par}</Text>)}
                      <Text style={{ width: ST, fontFamily: FFB, fontSize: 9, color: GOLD, textAlign: 'center' }}>{holes.reduce((s, h) => s + h.par, 0)}</Text>
                      {showTot && <Text style={{ width: ST, fontFamily: FFB, fontSize: 9, color: GOLD, textAlign: 'center' }}>{frontPar + backPar}</Text>}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5 }}>
                      <Text style={{ width: SL, fontFamily: FFB, fontSize: 9, color, paddingLeft: 8 }} numberOfLines={1}>{name}</Text>
                      {holes.map(h => <ScCell key={h.hole_number} val={gross(h.hole_number)} par={h.par} />)}
                      <Text style={{ width: ST, fontFamily: FFB, fontSize: 11, color: '#ffffff', textAlign: 'center' }}>
                        {holes.reduce((s, h) => s + (gross(h.hole_number) ?? 0), 0) || '·'}
                      </Text>
                      {showTot && <Text style={{ width: ST, fontFamily: FFB, fontSize: 11, color: GOLD, textAlign: 'center' }}>{totGross || '·'}</Text>}
                    </View>
                    {isStrokePlay && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, backgroundColor: `${GOLD}06` }}>
                        <Text style={{ width: SL, fontFamily: FFB, fontSize: 8, color: '#fff', paddingLeft: 8 }}>PTS</Text>
                        {holes.map(h => {
                          const p = pts(h.hole_number);
                          return <Text key={h.hole_number} style={{ width: SC, fontFamily: FFB, fontSize: 10, color: p ? ptsColor(p) : '#2a2a2a', textAlign: 'center' }}>{p ?? '·'}</Text>;
                        })}
                        <Text style={{ width: ST, fontFamily: FFB, fontSize: 11, color: GOLD, textAlign: 'center' }}>
                          {holes.reduce((s, h) => s + (pts(h.hole_number) ?? 0), 0) || '·'}
                        </Text>
                        {showTot && <Text style={{ width: ST, fontFamily: FFB, fontSize: 11, color: GOLD, textAlign: 'center' }}>{totPts || '·'}</Text>}
                      </View>
                    )}
                  </View>
                );

                return (
                  <View key={pid} style={{ width: screenWidth, paddingHorizontal: 16 }}>
                    <View style={s.scorecardCard}>
                      <View style={s.scorecardHeader}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
                        <Text style={[s.scorecardName, { color }]}>{name}</Text>
                        {hasScores && totGross > 0 && <Text style={s.scorecardTotal}>{totGross}</Text>}
                        {hasScores && isStrokePlay && totPts > 0 && <Text style={s.scorecardPts}>{totPts} pts</Text>}
                      </View>
                      {renderHalf(front, 'OUT', false)}
                      <View style={{ height: 1, backgroundColor: '#1c1c1c', marginVertical: 4 }} />
                      {renderHalf(back, 'IN', true)}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
            {allPlayerIds.length > 1 && (
              <View style={s.pageDots}>
                {allPlayerIds.map((_, i) => (
                  <View key={i} style={[s.pageDot, cardPage === i && s.pageDotActive]} />
                ))}
              </View>
            )}
          </View>
        )}

        {/* Delete */}
        <TouchableOpacity style={s.deleteBtn} onPress={deleteMatch} activeOpacity={0.7}>
          <Ionicons name="trash-outline" size={14} color="#4b5563" />
          <Text style={s.deleteBtnText}>Delete Game</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Bottom CTAs ── */}
      {status !== 'complete' && (
        <View style={s.ctaWrap}>
          <TouchableOpacity style={s.ctaBtn} onPress={handleEnterScores} activeOpacity={0.85}>
            <Ionicons name="create-outline" size={20} color="#000000" />
            <Text style={s.ctaText}>Enter Scores</Text>
          </TouchableOpacity>
          {isMember && (
            <TouchableOpacity
              style={s.ctaSecondary}
              onPress={() => router.push(`/(app)/score/scan/${matchId}` as any)}
              activeOpacity={0.8}
            >
              <Ionicons name="scan-outline" size={16} color={GOLD} />
              <Text style={s.ctaSecondaryText}>Scan Paper Scorecard</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 56, paddingHorizontal: 16, paddingBottom: 8,
  },
  headerSide:   { width: 40 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerLogo:   { width: 28, height: 28, marginBottom: 2 },
  headerSub:    { fontFamily: FFB, fontSize: 11, color: '#fff', letterSpacing: 0.5 },

  statusBanner: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16 },
  livePulse:    { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e', marginBottom: 4 },
  statusMain:   { fontFamily: FFB, fontSize: 22, letterSpacing: -0.3, textAlign: 'center' },
  statusSub:    { fontFamily: FFB, fontSize: 12, color: '#fff', marginTop: 2 },

  playersRow: {
    flexDirection: 'row', justifyContent: 'center',
    gap: 16, paddingHorizontal: 16, paddingVertical: 10,
  },
  playerPill:       { alignItems: 'center', gap: 4, minWidth: 52 },
  playerPillAvatar: { borderRadius: 26, overflow: 'visible' },
  playerPillName:   { fontFamily: FFB, fontSize: 11, textAlign: 'center' },
  playerPillPts:    { fontFamily: FFB, fontSize: 11, textAlign: 'center' },

  holeStripWrap: { maxHeight: 72 },
  holeStrip:     { paddingHorizontal: 12, paddingVertical: 6, gap: 6, alignItems: 'center' },
  holeTile: {
    width: 42, height: 58, borderRadius: 10,
    backgroundColor: '#111111', borderWidth: 1, borderColor: '#1c1c1c',
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  holeTileNum:  { fontFamily: FFB, fontSize: 14, color: '#4b5563' },
  holeTilePar:  { fontFamily: FFB, fontSize: 9, color: '#333' },
  holeTilePts:  { fontFamily: FFB, fontSize: 11, marginTop: 1 },

  halfLabels: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingHorizontal: 12, paddingBottom: 4,
  },
  halfLabel: { fontFamily: FFB, fontSize: 8, color: '#2a2a2a', letterSpacing: 1.5 },

  scroll: { padding: 16, paddingBottom: 24 },

  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  tag:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: '#111111', borderWidth: 1, borderColor: '#1c1c1c' },
  tagGold: { backgroundColor: `${GOLD}0d`, borderColor: `${GOLD}30` },
  tagText: { fontFamily: FFB, fontSize: 11, color: '#fff' },

  section: { marginBottom: 16 },
  sectionTitle: { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 2, marginBottom: 10 },

  scorecardCard: {
    backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden',
    marginBottom: 8,
  },
  scorecardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  scorecardName:  { flex: 1, fontFamily: FFB, fontSize: 14 },
  scorecardTotal: { fontFamily: FFB, fontSize: 14, color: '#ffffff' },
  scorecardPts:   { fontFamily: FFB, fontSize: 11, color: GOLD },

  pageDots:    { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: 8 },
  pageDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: '#1c1c1c' },
  pageDotActive: { backgroundColor: GOLD, width: 18 },

  deleteBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 20, marginTop: 8 },
  deleteBtnText: { fontFamily: FFB, fontSize: 12, color: '#4b5563' },

  ctaWrap: { paddingHorizontal: 16, paddingBottom: 32, paddingTop: 8, backgroundColor: '#000000', borderTopWidth: 1, borderTopColor: '#111111' },
  ctaBtn: {
    backgroundColor: GOLD, borderRadius: 14,
    paddingVertical: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
    marginBottom: 10,
  },
  ctaText: { fontFamily: FFB, fontSize: 17, color: '#000000' },
  ctaSecondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: 14,
    backgroundColor: `${GOLD}0d`, borderWidth: 1, borderColor: `${GOLD}30`,
  },
  ctaSecondaryText: { fontFamily: FFB, fontSize: 14, color: GOLD },
});
