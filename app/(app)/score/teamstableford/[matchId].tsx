import { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../../src/lib/supabase';
import { getPlayerAvatar } from '../../../../src/lib/assets';
import { calcStrokesReceived, calcStablefordPoints } from '../../../../src/lib/scoring';

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const BLUE  = '#3b82f6';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../../assets/TitanAppLogo.png');

interface Match {
  id: string;
  day_id: string | null;
  round_format: string | null;
  home_player_ids: string[];
  away_player_ids: string[];
  team_size: number | null;
  counting_scores: number | null;
  side_games: string[] | null;
  hcp_allowance: number | null;
  status: string;
  day: { course_name: string; course_par: number } | null;
}

interface Player {
  id: string;
  display_name: string;
  handicap_index: number;
  avatar_url: string | null;
}

interface CourseHole {
  hole_number: number;
  par: number;
  stroke_index: number;
  yardage: number | null;
}

type ScoreMap = Record<string, Record<number, number | null>>;

interface HolePlayerResult {
  playerId: string;
  pts: number;
  entered: boolean;
  counted: boolean;
}

interface TeamHoleResult {
  results: HolePlayerResult[];
  teamTotal: number;
}

function Avatar({ name, size = 36, src }: { name: string; size?: number; src?: any }) {
  if (src) {
    const imgSrc = typeof src === 'string' ? { uri: src } : src;
    return <Image source={imgSrc} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${GOLD}20`, borderWidth: 1.5, borderColor: `${GOLD}50`, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: FFB, fontSize: size * 0.38, color: GOLD }}>{(name || '?')[0].toUpperCase()}</Text>
    </View>
  );
}

export default function TeamStablefordScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [match, setMatch]           = useState<Match | null>(null);
  const [players, setPlayers]       = useState<Player[]>([]);
  const [courseHoles, setCourseHoles] = useState<CourseHole[]>([]);
  const [scores, setScores]         = useState<ScoreMap>({});
  const [currentHole, setCurrentHole] = useState(1);
  const [loading, setLoading]       = useState(true);
  const [showComplete, setShowComplete] = useState(false);

  const holeStripRef = useRef<ScrollView>(null);

  useEffect(() => {
    async function load() {
      const { data: matchData } = await supabase
        .from('matches')
        .select('*,day:day_id(course_name,course_par)')
        .eq('id', matchId)
        .single();

      if (!matchData) { setLoading(false); return; }
      setMatch(matchData as any);
      if ((matchData as any).status === 'complete') setShowComplete(true);

      const allIds = [...((matchData as any).home_player_ids ?? []), ...((matchData as any).away_player_ids ?? [])];

      const [playersRes, holesRes, scoresRes] = await Promise.all([
        allIds.length
          ? supabase.from('players').select('id,display_name,handicap_index,avatar_url').in('id', allIds)
          : { data: [] },
        (matchData as any).day?.course_name
          ? supabase.from('course_holes').select('hole_number,par,stroke_index,yardage').eq('course_name', (matchData as any).day.course_name).order('hole_number')
          : { data: [] },
        allIds.length
          ? supabase.from('match_holes').select('hole_number,player_id,gross_score').eq('match_id', matchId).in('player_id', allIds)
          : { data: [] },
      ]);

      if (playersRes.data) setPlayers(playersRes.data as Player[]);
      if (holesRes.data) setCourseHoles(holesRes.data as CourseHole[]);

      if (scoresRes.data && scoresRes.data.length > 0) {
        const rebuilt: ScoreMap = {};
        for (const row of scoresRes.data as any[]) {
          if (!rebuilt[row.player_id]) rebuilt[row.player_id] = {};
          rebuilt[row.player_id][row.hole_number] = row.gross_score;
        }
        setScores(rebuilt);
        const maxDone = Math.max(...(scoresRes.data as any[]).map((r: any) => r.hole_number));
        setCurrentHole(Math.min(maxDone + 1, 18));
      }

      setLoading(false);
    }
    load();
  }, [matchId]);

  function getPts(playerId: string, holeNum: number): number | null {
    const gross = scores[playerId]?.[holeNum] ?? null;
    if (gross === null) return null;
    const player = players.find(p => p.id === playerId);
    const hole = courseHoles.find(h => h.hole_number === holeNum);
    if (!player || !hole) return null;
    const adjHcp = Math.round(player.handicap_index * ((match?.hcp_allowance ?? 100) / 100));
    const strokes = calcStrokesReceived(adjHcp, hole.stroke_index);
    return calcStablefordPoints(gross, hole.par, strokes);
  }

  function computeTeamHole(playerIds: string[], holeNum: number): TeamHoleResult {
    const isPar3 = courseHoles.find(h => h.hole_number === holeNum)?.par === 3;
    const effectiveN = (match?.side_games?.includes('par3all') && isPar3)
      ? (match?.team_size ?? 2)
      : (match?.counting_scores ?? 2);
    const countN = effectiveN;
    const data = playerIds.map(id => ({
      playerId: id,
      pts: getPts(id, holeNum) ?? 0,
      entered: (scores[id]?.[holeNum] ?? null) !== null,
    }));
    const sorted = [...data].sort((a, b) => b.pts - a.pts);
    const countingIds = new Set(sorted.slice(0, countN).filter(p => p.entered).map(p => p.playerId));
    const results = data.map(p => ({ ...p, counted: countingIds.has(p.playerId) }));
    const teamTotal = results.filter(p => p.counted).reduce((s, p) => s + p.pts, 0);
    return { results, teamTotal };
  }

  function runningTotal(playerIds: string[]): number {
    let total = 0;
    for (let h = 1; h <= 18; h++) {
      if (!playerIds.some(id => (scores[id]?.[h] ?? null) !== null)) continue;
      total += computeTeamHole(playerIds, h).teamTotal;
    }
    return total;
  }

  async function saveScore(playerId: string, gross: number) {
    const existing = scores[playerId]?.[currentHole] ?? null;
    const newGross = existing === gross ? null : gross;

    setScores(prev => ({
      ...prev,
      [playerId]: { ...(prev[playerId] ?? {}), [currentHole]: newGross },
    }));

    await supabase.from('match_holes').delete()
      .eq('match_id', matchId).eq('player_id', playerId).eq('hole_number', currentHole);

    if (newGross !== null) {
      const player = players.find(p => p.id === playerId);
      const hole = courseHoles.find(h => h.hole_number === currentHole);
      let pts = 0;
      let netScore = newGross;
      if (player && hole) {
        const adjHcp = Math.round(player.handicap_index * ((match?.hcp_allowance ?? 100) / 100));
        const strokes = calcStrokesReceived(adjHcp, hole.stroke_index);
        pts = calcStablefordPoints(newGross, hole.par, strokes);
        netScore = newGross - strokes;
      }
      await supabase.from('match_holes').insert({
        match_id: matchId,
        player_id: playerId,
        hole_number: currentHole,
        gross_score: newGross,
        net_score: netScore,
        stableford_pts: pts,
      });
    }
  }

  async function completeRound() {
    if (!match) return;
    const homeTotal = runningTotal(match.home_player_ids);
    const awayTotal = runningTotal(match.away_player_ids);
    const winner = homeTotal > awayTotal ? 'home' : awayTotal > homeTotal ? 'away' : 'half';
    const lo = Math.min(homeTotal, awayTotal);
    const hi = Math.max(homeTotal, awayTotal);
    const resultStr = homeTotal === awayTotal
      ? `All Square — ${homeTotal} pts each`
      : `${winner === 'home' ? 'Team A' : 'Team B'} wins ${hi}–${lo}`;
    await supabase.from('matches').update({ status: 'complete', winner, result_str: resultStr }).eq('id', matchId);
    setMatch(prev => prev ? { ...prev, status: 'complete' } : prev);
    setShowComplete(true);
  }

  function confirmDelete() {
    Alert.alert('Delete Round', 'Delete this round? All scores will be lost.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('match_holes').delete().eq('match_id', matchId);
          await supabase.from('matches').update({ status: 'cancelled' }).eq('id', matchId);
          router.replace('/(app)/score' as any);
        },
      },
    ]);
  }

  if (loading || !fontsLoaded) {
    return <View style={s.loading}><ActivityIndicator color={GOLD} size="large" /></View>;
  }
  if (!match) return null;

  const totalHoles = courseHoles.length || 18;
  const hole       = courseHoles.find(h => h.hole_number === currentHole) ?? null;
  const par3all    = match.side_games?.includes('par3all') ?? false;
  const baseCountN = match.counting_scores ?? 2;
  const teamSize   = match.team_size ?? 2;
  const countN     = par3all && hole?.par === 3 ? teamSize : baseCountN;

  const homeTotal  = runningTotal(match.home_player_ids);
  const awayTotal  = runningTotal(match.away_player_ids);
  const homeHole   = computeTeamHole(match.home_player_ids, currentHole);
  const awayHole   = computeTeamHole(match.away_player_ids, currentHole);

  // ── Complete view ───────────────────────────────────────────
  if (showComplete) {
    const winLabel = homeTotal > awayTotal ? 'TEAM A WINS' : awayTotal > homeTotal ? 'TEAM B WINS' : 'ALL SQUARE';
    const winColor = homeTotal >= awayTotal ? GOLD : BLUE;
    const front9   = Array.from({ length: Math.min(9, totalHoles) }, (_, i) => i + 1);
    const back9    = Array.from({ length: Math.max(0, totalHoles - 9) }, (_, i) => i + 10);

    function PlayerScoreRow({ playerId, holes, color }: { playerId: string; holes: number[]; color: string }) {
      const p = players.find(pl => pl.id === playerId);
      if (!p) return null;
      const total = holes.reduce((s, h) => s + (getPts(playerId, h) ?? 0), 0);
      return (
        <View style={s.scRow}>
          <Text style={[s.scName, { flex: 2 }]} numberOfLines={1}>{p.display_name.split(' ')[0]}</Text>
          {holes.map(h => {
            const pts = getPts(playerId, h);
            const col = pts === null ? '#333' : pts >= 4 ? BLUE : pts === 3 ? GREEN : pts === 0 ? '#333' : '#aaa';
            return <Text key={h} style={[s.scCell, { color: col }]}>{pts ?? '—'}</Text>;
          })}
          <Text style={[s.scCell, { color }]}>{total}</Text>
        </View>
      );
    }

    function TeamBlock({ ids, label, color }: { ids: string[]; label: string; color: string }) {
      return (
        <View style={s.cardDark}>
          <View style={s.scHeaderRow}>
            <Text style={[s.scHdr, { flex: 2, color }]}>{label}</Text>
            {front9.map(h => <Text key={h} style={s.scHdr}>{h}</Text>)}
            <Text style={[s.scHdr, { color }]}>OUT</Text>
          </View>
          {ids.map(id => <PlayerScoreRow key={id} playerId={id} holes={front9} color={color} />)}
          {back9.length > 0 && (
            <>
              <View style={[s.scHeaderRow, { marginTop: 10 }]}>
                <Text style={[s.scHdr, { flex: 2, color: '#fff' }]}>BACK</Text>
                {back9.map(h => <Text key={h} style={s.scHdr}>{h}</Text>)}
                <Text style={[s.scHdr, { color }]}>IN</Text>
              </View>
              {ids.map(id => <PlayerScoreRow key={id + '_b'} playerId={id} holes={back9} color={color} />)}
            </>
          )}
          <View style={[s.scRow, { borderTopWidth: 1, borderTopColor: '#222', marginTop: 6, paddingTop: 8 }]}>
            <Text style={[s.scName, { flex: 2, color }]}>TOTAL</Text>
            <Text style={[s.scCell, { color, fontSize: 15 }]}>{ids.reduce((s, id) => {
              const best = Array.from({ length: totalHoles }, (_, i) => {
                const h = i + 1;
                const counted = computeTeamHole(ids, h).results.find(r => r.playerId === id)?.counted;
                return counted ? (getPts(id, h) ?? 0) : 0;
              }).reduce((a, b) => a + b, 0);
              return s + best;
            }, 0)}</Text>
          </View>
        </View>
      );
    }

    return (
      <View style={s.root}>
        <StatusBar style="light" />
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.replace('/(app)/score' as any)} style={s.headerSide} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
            <Text style={s.headerSub}>ROUND COMPLETE</Text>
          </View>
          <View style={s.headerSide} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 16 }} showsVerticalScrollIndicator={false}>
          <View style={[s.winnerBanner, { borderColor: `${winColor}40` }]}>
            <Ionicons name="trophy" size={36} color={winColor} />
            <Text style={[s.winnerText, { color: winColor }]}>{winLabel}</Text>
            <View style={s.winnerScoreRow}>
              <Text style={[s.winnerScore, { color: GOLD }]}>{homeTotal}</Text>
              <Text style={s.winnerDash}> – </Text>
              <Text style={[s.winnerScore, { color: BLUE }]}>{awayTotal}</Text>
            </View>
            <Text style={s.winnerSub}>Best {countN} of {teamSize} per hole</Text>
          </View>

          <Text style={s.teamLabel}>TEAM A</Text>
          <TeamBlock ids={match.home_player_ids} label="TEAM A" color={GOLD} />

          <Text style={[s.teamLabel, { color: BLUE }]}>TEAM B</Text>
          <TeamBlock ids={match.away_player_ids} label="TEAM B" color={BLUE} />

          <TouchableOpacity style={s.doneBtn} onPress={() => router.replace('/(app)/score' as any)} activeOpacity={0.85}>
            <Text style={s.doneBtnText}>Back to Play</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── Scoring view ────────────────────────────────────────────
  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerSide} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerSub}>{match.round_format === 'best2from4' || match.round_format === 'best2from4_par3all' ? 'MASHIE · BEST 2 FROM 4' : 'TEAM STABLEFORD'}</Text>
        </View>
        <TouchableOpacity onPress={confirmDelete} style={s.headerSide} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="trash-outline" size={20} color="#555" />
        </TouchableOpacity>
      </View>

      {/* Team totals bar */}
      <View style={s.totalsBar}>
        <View style={[s.totalBlock, homeTotal > awayTotal && s.totalBlockWin]}>
          <Text style={s.totalTeamLbl}>TEAM A</Text>
          <Text style={[s.totalPts, homeTotal >= awayTotal ? { color: GOLD } : { color: '#fff' }]}>{homeTotal}</Text>
        </View>
        <View style={s.totalMid}>
          <Text style={s.totalVs}>VS</Text>
        </View>
        <View style={[s.totalBlock, { alignItems: 'flex-end' }, awayTotal > homeTotal && s.totalBlockWinB]}>
          <Text style={[s.totalTeamLbl, { color: BLUE }]}>TEAM B</Text>
          <Text style={[s.totalPts, awayTotal >= homeTotal ? { color: BLUE } : { color: '#fff' }]}>{awayTotal}</Text>
        </View>
      </View>

      {/* Hole strip */}
      <ScrollView
        ref={holeStripRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.holeStrip}
        style={{ height: 58 }}
      >
        {Array.from({ length: totalHoles }, (_, i) => {
          const h     = i + 1;
          const hHome = computeTeamHole(match.home_player_ids, h);
          const hAway = computeTeamHole(match.away_player_ids, h);
          const anyPlayed = match.home_player_ids.concat(match.away_player_ids).some(id => (scores[id]?.[h] ?? null) !== null);
          const isCur = h === currentHole;
          const ch    = courseHoles.find(c => c.hole_number === h);

          let bg = '#111', fg = '#333';
          if (anyPlayed) {
            if (hHome.teamTotal > hAway.teamTotal)      { bg = `${GOLD}25`; fg = GOLD; }
            else if (hAway.teamTotal > hHome.teamTotal) { bg = `${BLUE}25`; fg = BLUE; }
            else                                         { bg = '#222';      fg = '#888'; }
          }
          if (isCur) { bg = GOLD; fg = '#000'; }

          return (
            <TouchableOpacity
              key={h}
              style={[s.holeTile, { backgroundColor: bg }]}
              onPress={() => setCurrentHole(h)}
              activeOpacity={0.7}
            >
              <Text style={[s.holeTileNum, { color: fg }]}>{h}</Text>
              {ch && <Text style={[s.holeTilePar, { color: isCur ? '#00000088' : '#555' }]}>P{ch.par}</Text>}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

        {/* Hole card */}
        <View style={s.holeCard}>
          <Text style={s.holeNum}>{currentHole}</Text>
          <View style={s.holeDetails}>
            {hole && (
              <>
                <View style={s.chip}><Text style={s.chipText}>Par {hole.par}</Text></View>
                <View style={s.chip}><Text style={s.chipText}>SI {hole.stroke_index}</Text></View>
                {hole.yardage && <View style={s.chip}><Text style={s.chipText}>{hole.yardage} yds</Text></View>}
              </>
            )}
            <View style={[s.chip, { backgroundColor: `${GOLD}15`, borderColor: `${GOLD}30` }]}>
              <Text style={[s.chipText, { color: GOLD }]}>Best {countN} of {teamSize}</Text>
            </View>
          </View>
        </View>

        {/* Team A */}
        <TeamSection
          label="TEAM A" color={GOLD}
          playerIds={match.home_player_ids}
          players={players}
          hole={hole}
          hcpAllowance={match.hcp_allowance ?? 100}
          scores={scores}
          holeResult={homeHole}
          getPts={getPts}
          onScore={saveScore}
        />

        {/* Team B */}
        <TeamSection
          label="TEAM B" color={BLUE}
          playerIds={match.away_player_ids}
          players={players}
          hole={hole}
          hcpAllowance={match.hcp_allowance ?? 100}
          scores={scores}
          holeResult={awayHole}
          getPts={getPts}
          onScore={saveScore}
        />

        {/* Hole result summary */}
        {(homeHole.teamTotal > 0 || awayHole.teamTotal > 0) && (
          <View style={s.holeResult}>
            <View style={[s.holeResultBlock, homeHole.teamTotal >= awayHole.teamTotal && { borderColor: `${GOLD}40` }]}>
              <Text style={s.holeResultLbl}>TEAM A</Text>
              <Text style={[s.holeResultPts, { color: GOLD }]}>{homeHole.teamTotal}</Text>
            </View>
            <Text style={s.holeResultVs}>pts</Text>
            <View style={[s.holeResultBlock, awayHole.teamTotal >= homeHole.teamTotal && { borderColor: `${BLUE}40` }]}>
              <Text style={s.holeResultLbl}>TEAM B</Text>
              <Text style={[s.holeResultPts, { color: BLUE }]}>{awayHole.teamTotal}</Text>
            </View>
          </View>
        )}

      </ScrollView>

      {/* Footer */}
      <View style={s.footer}>
        <TouchableOpacity
          style={[s.prevBtn, currentHole === 1 && s.prevBtnOff]}
          onPress={currentHole > 1 ? () => setCurrentHole(h => h - 1) : undefined}
          disabled={currentHole === 1}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={20} color={currentHole === 1 ? '#333' : '#fff'} />
          <Text style={[s.prevBtnText, currentHole === 1 && { color: '#333' }]}>Prev</Text>
        </TouchableOpacity>

        {match.day_id && (
          <TouchableOpacity
            style={s.leadersBtn}
            onPress={() => router.push(`/(app)/score/day/${match.day_id}` as any)}
            activeOpacity={0.7}
          >
            <Ionicons name="trophy-outline" size={18} color={GOLD} />
            <Text style={s.leadersBtnText}>LEADERS</Text>
          </TouchableOpacity>
        )}

        {currentHole === totalHoles ? (
          <TouchableOpacity style={s.completeBtn} onPress={completeRound} activeOpacity={0.85}>
            <Ionicons name="trophy-outline" size={18} color="#000" />
            <Text style={s.completeBtnText}>Complete Round</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={s.nextBtn}
            onPress={() => setCurrentHole(h => Math.min(h + 1, totalHoles))}
            activeOpacity={0.85}
          >
            <Text style={s.nextBtnText}>Next Hole</Text>
            <Ionicons name="chevron-forward" size={20} color="#000" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ── TeamSection component ──────────────────────────────────────

const GROSS_BUTTONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function TeamSection({
  label, color, playerIds, players, hole, hcpAllowance, scores, holeResult, getPts, onScore,
}: {
  label: string;
  color: string;
  playerIds: string[];
  players: Player[];
  hole: CourseHole | null;
  hcpAllowance: number;
  scores: ScoreMap;
  holeResult: TeamHoleResult;
  getPts: (id: string, hole: number) => number | null;
  onScore: (id: string, gross: number) => void;
}) {
  const currentHoleNum = hole?.hole_number ?? 1;

  return (
    <View style={ts.container}>
      <View style={ts.header}>
        <View style={[ts.accent, { backgroundColor: color }]} />
        <Text style={[ts.label, { color }]}>{label}</Text>
        {holeResult.teamTotal > 0 && (
          <Text style={[ts.holePts, { color }]}>{holeResult.teamTotal} pts</Text>
        )}
      </View>

      {playerIds.map(id => {
        const player = players.find(p => p.id === id);
        if (!player) return null;

        const firstName = player.display_name.split(' ')[0];
        const avatar = player.avatar_url ?? getPlayerAvatar(player.id, 'normal');
        const gross = scores[id]?.[currentHoleNum] ?? null;
        const pts = getPts(id, currentHoleNum);
        const result = holeResult.results.find(r => r.playerId === id);
        const adjHcp = Math.round(player.handicap_index * (hcpAllowance / 100));
        const strokes = hole ? calcStrokesReceived(adjHcp, hole.stroke_index) : 0;

        return (
          <View key={id} style={ts.playerBlock}>
            <View style={ts.playerRow}>
              <Avatar name={firstName} size={32} src={avatar} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={ts.playerName}>{firstName}</Text>
                <Text style={ts.playerHcp}>HCP {adjHcp}{strokes > 0 ? ` · +${strokes} shot${strokes > 1 ? 's' : ''}` : ''}</Text>
              </View>
              {pts !== null && (
                <View style={[ts.badge, result?.counted ? [ts.badgeCounts, { borderColor: `${color}40` }] : ts.badgeDropped]}>
                  <Text style={[ts.badgeText, { color: result?.counted ? color : '#555' }]}>
                    {result?.counted ? `${pts} pts` : `${pts} dropped`}
                  </Text>
                </View>
              )}
            </View>

            <View style={ts.scoreRow}>
              {GROSS_BUTTONS.map(g => {
                const isSel = gross === g;
                const net   = hole ? g - strokes - hole.par : 0;
                let bg = '#1a1a1a', fg = '#555';
                if (isSel) {
                  if (net <= -2)     { bg = BLUE;    fg = '#fff'; }
                  else if (net === -1) { bg = GREEN;   fg = '#000'; }
                  else if (net === 0)  { bg = '#ffffff'; fg = '#000'; }
                  else if (net === 1)  { bg = '#f97316'; fg = '#000'; }
                  else                { bg = RED;     fg = '#fff'; }
                }
                return (
                  <TouchableOpacity
                    key={g}
                    style={[ts.scoreBtn, { backgroundColor: bg }, isSel && ts.scoreBtnSel]}
                    onPress={() => onScore(id, g)}
                    activeOpacity={0.7}
                  >
                    <Text style={[ts.scoreBtnTxt, { color: fg }]}>{g}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#000' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },

  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 56, paddingHorizontal: 16, paddingBottom: 8 },
  headerSide:   { width: 40, alignItems: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', gap: 2 },
  headerLogo:   { width: 28, height: 28 },
  headerSub:    { fontFamily: FFB, fontSize: 9, color: GOLD, letterSpacing: 2.5 },

  totalsBar: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 4, backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden' },
  totalBlock: { flex: 1, padding: 12 },
  totalBlockWin:  { borderRightWidth: 2, borderRightColor: `${GOLD}30` },
  totalBlockWinB: { borderLeftWidth: 2, borderLeftColor: `${BLUE}30` },
  totalTeamLbl: { fontFamily: FFB, fontSize: 9, color: GOLD, letterSpacing: 2 },
  totalPts:     { fontFamily: FFB, fontSize: 26, color: '#fff', marginTop: 2 },
  totalMid:     { paddingHorizontal: 12 },
  totalVs:      { fontFamily: FFB, fontSize: 11, color: '#333', letterSpacing: 2 },

  holeStrip: { paddingHorizontal: 8, gap: 4, paddingVertical: 8 },
  holeTile: { width: 42, height: 42, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  holeTileNum: { fontFamily: FFB, fontSize: 14 },
  holeTilePar: { fontFamily: FFB, fontSize: 9, marginTop: 1 },

  scroll: { paddingHorizontal: 16, paddingBottom: 120, gap: 12 },

  holeCard: { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  holeNum:  { fontFamily: FFB, fontSize: 48, color: '#fff', lineHeight: 52, width: 60 },
  holeDetails: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: '#1c1c1c', borderWidth: 1, borderColor: '#2a2a2a' },
  chipText: { fontFamily: FFB, fontSize: 12, color: '#fff' },

  holeResult: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  holeResultBlock: { flex: 1, backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#1c1c1c', padding: 14, alignItems: 'center' },
  holeResultLbl:   { fontFamily: FFB, fontSize: 10, color: '#fff', letterSpacing: 1.5 },
  holeResultPts:   { fontFamily: FFB, fontSize: 28, marginTop: 4 },
  holeResultVs:    { fontFamily: FFB, fontSize: 12, color: '#444' },

  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, paddingBottom: 36, backgroundColor: '#000', borderTopWidth: 1, borderTopColor: '#111', flexDirection: 'row', gap: 10 },
  prevBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: '#222' },
  prevBtnOff:  { opacity: 0.3 },
  prevBtnText: { fontFamily: FFB, fontSize: 15, color: '#fff' },
  nextBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14 },
  nextBtnText: { fontFamily: FFB, fontSize: 15, color: '#000' },
  completeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14 },
  completeBtnText: { fontFamily: FFB, fontSize: 15, color: '#000' },
  leadersBtn:     { flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: `${GOLD}40`, backgroundColor: `${GOLD}10` },
  leadersBtnText: { fontFamily: FFB, fontSize: 9, color: GOLD, letterSpacing: 1.5 },

  // Complete view
  winnerBanner: { backgroundColor: '#111', borderRadius: 16, borderWidth: 1, padding: 24, alignItems: 'center', gap: 8 },
  winnerText:   { fontFamily: FFB, fontSize: 28, letterSpacing: 1 },
  winnerScoreRow: { flexDirection: 'row', alignItems: 'center' },
  winnerScore:  { fontFamily: FFB, fontSize: 42 },
  winnerDash:   { fontFamily: FFB, fontSize: 24, color: '#444' },
  winnerSub:    { fontFamily: FFB, fontSize: 12, color: '#fff', letterSpacing: 1 },

  teamLabel: { fontFamily: FFB, fontSize: 10, color: GOLD, letterSpacing: 2, marginTop: 4 },
  cardDark: { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 14 },

  scHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  scRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  scHdr:  { fontFamily: FFB, fontSize: 9, color: '#444', letterSpacing: 1, width: 22, textAlign: 'center' },
  scName: { fontFamily: FFB, fontSize: 12, color: '#fff' },
  scCell: { fontFamily: FFB, fontSize: 12, color: '#fff', width: 22, textAlign: 'center' },

  doneBtn:     { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  doneBtnText: { fontFamily: FFB, fontSize: 16, color: '#000' },
});

const ts = StyleSheet.create({
  container: { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  accent: { width: 3, height: 16, borderRadius: 2 },
  label:  { fontFamily: FFB, fontSize: 12, letterSpacing: 1.5, flex: 1 },
  holePts: { fontFamily: FFB, fontSize: 14 },

  playerBlock: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  playerRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  playerName:  { fontFamily: FFB, fontSize: 14, color: '#fff' },
  playerHcp:   { fontFamily: FFB, fontSize: 11, color: '#fff', marginTop: 1 },

  badge:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  badgeCounts: { backgroundColor: 'transparent' },
  badgeDropped:{ backgroundColor: 'transparent', borderColor: '#2a2a2a' },
  badgeText:   { fontFamily: FFB, fontSize: 11, letterSpacing: 0.5 },

  scoreRow:    { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  scoreBtn:    { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#222' },
  scoreBtnSel: { borderColor: 'transparent' },
  scoreBtnTxt: { fontFamily: FFB, fontSize: 14 },
});
