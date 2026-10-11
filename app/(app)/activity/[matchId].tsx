// Recent Activity — round detail (Dave, 2026-09-28). Read-only scorecard for
// one completed casual/tournament round, plus its AI match report if Titan
// News has already written one. Swindle rounds are NOT handled here — the
// list screen deep-links those straight to the existing swindle/[gameId]
// results screen instead.
//
// The match/players/holes fetch mirrors spectate/[matchId].tsx's own
// read-only query shape, which is already the working reference for exactly
// this data.
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Image, Dimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { titanLogo } from '../../../src/lib/assets';
import { goBack } from '../../../src/lib/navigation';
import RoundScorecard from '../../../src/components/RoundScorecard';
import { calcStrokesReceived, calcStablefordPoints } from '../../../src/lib/scoring';
import { matchplayHcp, type MatchForScoring, type CompPlayer } from '../../../src/lib/matchScoring';
import { resolveTournamentHandicaps } from '../../../src/lib/tournamentHandicap';
import type { RoundPlayerTeeSnapshot } from '../../../src/lib/whs';

const SCREEN_WIDTH = Dimensions.get('window').width;

const GOLD = '#D4AF37';
const FF   = 'JUSTSans';
const FFB  = 'JUSTSans-ExBold';

interface MatchDetail {
  id: string;
  status: string;
  holes_string: string | null;
  start_hole: number | null;
  holes_to_play: number | null;
  home_player_ids: string[];
  away_player_ids: string[];
  round_format: string;
  secondary_format: string | null;
  handicap_method: string | null;
  completed_at: string | null;
  hcp_allowance: number | null;
  competition_id: string | null;
  day_id: string | null;
  home_team: { name: string; accent_color: string } | null;
  away_team: { name: string; accent_color: string } | null;
  day: { course_name: string | null; slope_rating: number | null; course_rating: number | null; course_par: number | null } | null;
}
interface Player     { id: string; display_name: string; }
interface CourseHole { hole_number: number; par: number; stroke_index: number; }
interface HoleRow    { player_id: string; hole_number: number; gross_score: number | null; stableford_pts: number | null; }
interface Report     { headline: string | null; summary: string | null; body: string | null; }

export default function ActivityDetailScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const dc = useDynamicColors();
  const { localLogo, logoUrl } = useSocietyTheme();
  const [match, setMatch]             = useState<MatchDetail | null>(null);
  const [players, setPlayers]         = useState<Player[]>([]);
  const [courseHoles, setCourseHoles] = useState<CourseHole[]>([]);
  const [holeRows, setHoleRows]       = useState<HoleRow[]>([]);
  const [report, setReport]           = useState<Report | null>(null);
  // Only filled for Match Play–Stableford rounds, whose grid pts must be
  // recomputed at the match's own allowance (stored stableford_pts is the
  // 100%-handicap side-game value).
  const [compPlayers, setCompPlayers] = useState<CompPlayer[]>([]);
  const [roundPlayerTees, setRoundPlayerTees] = useState<Record<string, RoundPlayerTeeSnapshot>>({});
  const [loading, setLoading]         = useState(true);

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const load = useCallback(async () => {
    if (!matchId) { setLoading(false); return; }
    const { data: matchData } = await supabase
      .from('matches')
      .select('*, home_team:home_team_id(name,accent_color), away_team:away_team_id(name,accent_color), day:day_id(course_name,slope_rating,course_rating,course_par)')
      .eq('id', matchId)
      .maybeSingle();
    if (!matchData) { setLoading(false); return; }
    setMatch(matchData as unknown as MatchDetail);

    const allIds = [...((matchData as any).home_player_ids ?? []), ...((matchData as any).away_player_ids ?? [])];
    const courseName = (matchData as any).day?.course_name;

    const [{ data: pd }, { data: cd }, { data: mhData }, { data: newsData }] = await Promise.all([
      allIds.length
        ? supabase.from('players').select('id,display_name').in('id', allIds)
        : Promise.resolve({ data: [] }),
      courseName
        ? supabase.from('course_holes').select('hole_number,par,stroke_index').eq('course_name', courseName).order('hole_number')
        : Promise.resolve({ data: [] }),
      supabase.from('match_holes').select('player_id,hole_number,gross_score,stableford_pts').eq('match_id', matchId),
      // titan_news links back to a round via match_id (see the upsert in
      // supabase/functions/titan-news/index.ts) — NOT source_match_id.
      supabase.from('titan_news').select('headline, summary, body').eq('match_id', matchId).eq('story_type', 'casual_final').maybeSingle(),
    ]);

    if (pd) setPlayers(pd as Player[]);
    if (cd) setCourseHoles(cd as CourseHole[]);
    setHoleRows((mhData as HoleRow[] | null) ?? []);

    // Deliberately never triggers report generation from here — Titan News
    // already generates a report at round-completion time (score/enter),
    // and that generation also DMs every player in the round. Doing it again
    // on-demand just from someone browsing Recent Activity would re-fire
    // those DMs (and, for a tournament round, would call the wrong — casual
    // — report path entirely, since tournament reports are day-scoped, not
    // match-scoped). Missing report here just means none was written; the
    // scorecard still shows regardless.
    if (newsData) setReport(newsData as Report);

    const md = matchData as any;
    if (md.round_format === 'matchplay' && (md.handicap_method === 'relative_low_stableford' || md.handicap_method === 'individual_stableford') && allIds.length) {
      const [{ data: profs }, { data: rptData }] = await Promise.all([
        md.competition_id
          ? supabase.from('competition_players').select('player_id, handicap_index').eq('competition_id', md.competition_id).in('player_id', allIds)
          : supabase.from('players').select('id, handicap_index').in('id', allIds),
        md.day_id
          ? supabase.from('round_player_tees').select('player_id,whs_enabled_at_start,playing_handicap_at_start').eq('day_id', md.day_id).in('player_id', allIds)
          : Promise.resolve({ data: [] }),
      ]);
      const raw: CompPlayer[] = ((profs ?? []) as any[]).map(r => ({ player_id: r.player_id ?? r.id, handicap_index: r.handicap_index ?? 0 }));
      setCompPlayers(await resolveTournamentHandicaps(md.competition_id, md.day_id, raw));
      const rpt: Record<string, RoundPlayerTeeSnapshot> = {};
      ((rptData ?? []) as any[]).forEach(r => { rpt[r.player_id] = r; });
      setRoundPlayerTees(rpt);
    }
    setLoading(false);
  }, [matchId]);

  useEffect(() => { load(); }, [load]);

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: dc.bg, alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  const hasCustomLogo = !localLogo && !!logoUrl;
  const logoSource = localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo);

  const header = (
    <View style={[s.header, { borderBottomColor: dc.border }]}>
      <TouchableOpacity onPress={() => goBack(router, '/(app)/activity')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={s.headerLeft}>
        <Text style={[s.back, { color: dc.gold }]}>← Back</Text>
      </TouchableOpacity>
      <View style={s.headerCenter}>
        {hasCustomLogo ? (
          <View style={s.headerLogoChip}><Image source={logoSource} style={s.headerLogo} resizeMode="contain" /></View>
        ) : (
          <Image source={logoSource} style={s.headerLogo} resizeMode="contain" />
        )}
        <Text style={s.headerSub}>ROUND ACTIVITY</Text>
      </View>
      <View style={s.headerRight} />
    </View>
  );

  if (!match) return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />
      {header}
      <View style={s.centered}><Text style={{ color: '#fff', fontFamily: FFB }}>Round not found.</Text></View>
    </View>
  );

  const holeChars   = (match.holes_string ?? '..................').split('');
  const allPlayerIds = [...match.home_player_ids, ...match.away_player_ids];
  const playerNames = Object.fromEntries(players.map(p => [p.id, p.display_name]));
  // Only real head-to-head Matchplay marks holes 'h'/'a'/'f' — every other
  // format gets the plain per-player grid (same rule as Spectate).
  const isStrokePlay = match.round_format !== 'matchplay';
  const homeColor = match.home_team?.accent_color ?? GOLD;
  const awayColor = match.away_team?.accent_color ?? '#6366f1';

  const holeData: Record<string, Record<number, { gross: number | null; pts: number | null }>> = {};
  for (const row of holeRows) {
    if (!holeData[row.player_id]) holeData[row.player_id] = {};
    holeData[row.player_id][row.hole_number] = { gross: row.gross_score, pts: row.stableford_pts };
  }

  // Match Play–Stableford: recompute grid pts at the match's own handicap, as
  // the scoring engine decided the result (see score/enter mainPtsHoleData).
  const isMatchplayStableford = match.round_format === 'matchplay'
    && (match.handicap_method === 'relative_low_stableford' || match.handicap_method === 'individual_stableford');
  const mainPtsHoleData: typeof holeData = !isMatchplayStableford || compPlayers.length === 0 ? holeData : (() => {
    const out: typeof holeData = {};
    for (const id of allPlayerIds) {
      const hcp = matchplayHcp(id, match as unknown as MatchForScoring, compPlayers, roundPlayerTees, allPlayerIds);
      out[id] = {};
      for (const [holeStr, rec] of Object.entries(holeData[id] ?? {})) {
        const ch = courseHoles.find(c => c.hole_number === Number(holeStr));
        out[id][Number(holeStr)] = {
          gross: rec.gross,
          pts: (rec.gross != null && ch) ? calcStablefordPoints(rec.gross, ch.par, calcStrokesReceived(hcp, ch.stroke_index)) : null,
        };
      }
    }
    return out;
  })();

  const courseName = match.day?.course_name ?? 'Round';
  const playedAt = match.completed_at
    ? new Date(match.completed_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    : '';

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />
      {header}

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={[s.metaCard, { backgroundColor: dc.card, borderColor: dc.border }]}>
          <Text style={[s.metaCourse, { color: dc.cardText }]} numberOfLines={2}>{courseName}</Text>
          <Text style={s.metaSub}>
            {playedAt}{playedAt ? ' · ' : ''}{allPlayerIds.length} player{allPlayerIds.length === 1 ? '' : 's'}
          </Text>
        </View>

        {/* AI match report — Titan News writes one per completed casual
            round. summary is the brief version; body is long-form. */}
        {report && (report.headline || report.summary || report.body) && (
          <View style={[s.reportCard, { backgroundColor: dc.card, borderColor: dc.border }]}>
            <Text style={[s.reportLabel, { color: dc.gold }]}>MATCH REPORT</Text>
            {!!report.headline && <Text style={[s.reportHeadline, { color: dc.cardText }]}>{report.headline}</Text>}
            {!!(report.summary || report.body) && (
              <Text style={s.reportBody}>{report.summary || report.body}</Text>
            )}
          </View>
        )}

        {courseHoles.length > 0 && allPlayerIds.length > 0 && (
          <View style={[s.gridCard, { backgroundColor: dc.card, borderColor: dc.border }]}>
            <Text style={s.gridTitle}>SCORECARD</Text>
            <RoundScorecard
              startHole={1}
              allPlayerIds={allPlayerIds}
              playerNames={playerNames}
              holeData={mainPtsHoleData}
              courseHoles={courseHoles}
              matchHomeIds={match.home_player_ids}
              holeChars={holeChars}
              homeColor={homeColor}
              awayColor={awayColor}
              isStrokePlay={isStrokePlay}
              roundFormat={match.round_format}
              handicapMethod={match.handicap_method}
              secondaryFormat={match.secondary_format}
              screenWidth={SCREEN_WIDTH - 60}
            />
            <RoundScorecard
              startHole={10}
              allPlayerIds={allPlayerIds}
              playerNames={playerNames}
              holeData={mainPtsHoleData}
              courseHoles={courseHoles}
              matchHomeIds={match.home_player_ids}
              holeChars={holeChars}
              homeColor={homeColor}
              awayColor={awayColor}
              isStrokePlay={isStrokePlay}
              roundFormat={match.round_format}
              handicapMethod={match.handicap_method}
              secondaryFormat={match.secondary_format}
              screenWidth={SCREEN_WIDTH - 60}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerLeft:   { flex: 1, alignItems: 'flex-start' },
  headerCenter: { alignItems: 'center' },
  headerRight:  { flex: 1 },
  headerLogoChip: {
    width: 36, height: 36, borderRadius: 8, backgroundColor: '#f5f5f0',
    alignItems: 'center', justifyContent: 'center', padding: 4,
  },
  headerLogo: { width: 28, height: 28 },
  headerSub:  { fontFamily: FFB, fontSize: 9, color: '#fff', marginTop: 2, letterSpacing: 1.5 },
  back:       { fontFamily: FFB, fontSize: 14 },

  scroll: { padding: 16, paddingBottom: 48 },

  metaCard:   { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 12 },
  metaCourse: { fontFamily: FFB, fontSize: 18 },
  metaSub:    { fontFamily: FFB, fontSize: 11, color: '#888', marginTop: 4 },

  reportCard:     { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 12 },
  reportLabel:    { fontFamily: FFB, fontSize: 11, letterSpacing: 2, marginBottom: 8 },
  reportHeadline: { fontFamily: FFB, fontSize: 16, marginBottom: 6, lineHeight: 21 },
  reportBody:     { fontFamily: FF, fontSize: 13, color: '#888', lineHeight: 19 },

  gridCard:  { borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 12 },
  gridTitle: { fontFamily: FFB, fontSize: 11, color: '#fff', letterSpacing: 2, marginBottom: 14 },
});
