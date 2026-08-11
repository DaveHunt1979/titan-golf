import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, RefreshControl, Image, TextInput,
  Alert, Platform, ImageBackground,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { matchLabel, getEffectiveWinner } from '../../../src/lib/scoring';
import { getPlayerAvatar } from '../../../src/lib/assets';
import type { Match, Team } from '../../../src/types';

const GREEN  = '#4ade80';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';
const heroCourse = require('../../../assets/startround_gfx.png');

const FORMAT_LABELS: Record<string, string> = {
  stableford: 'Stableford', medal: 'Medal', singles: 'Singles Matchplay',
  '4bbb': '4BBB Stableford', skins: 'Skins', nassau: 'Nassau', wolf: 'Wolf',
  scramble: 'Scramble', greensomes: 'Greensomes', bbb: 'BBB',
  foursomes: 'Foursomes', modified_stableford: 'Modified Stableford',
  par_bogey: 'Par / Bogey', chacha: 'ChaChaCha', team_stableford: 'Team Stableford',
};

interface MatchWithDay extends Match {
  home_team: Pick<Team, 'name' | 'accent_color'> | null;
  away_team: Pick<Team, 'name' | 'accent_color'> | null;
  day: { course_name: string; course_par: number } | null;
}

export default function ScoreScreen() {
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const dc     = useDynamicColors();
  const GOLD   = dc.gold;
  const BG     = dc.bg;
  const CARD   = dc.card;
  const BORDER = dc.border;
  const { localLogo, logoUrl } = useSocietyTheme();

  const [myPlayerId, setMyPlayerId]             = useState<string | null>(null);
  const [matches, setMatches]                   = useState<MatchWithDay[]>([]);
  const [completedMatches, setCompletedMatches] = useState<MatchWithDay[]>([]);
  const [playerNames, setPlayerNames]           = useState<Record<string, string>>({});
  const [playerAvatars, setPlayerAvatars]       = useState<Record<string, string | null>>({});
  const [loading, setLoading]                   = useState(true);
  const [refreshing, setRefreshing]             = useState(false);
  const [dayCode, setDayCode]             = useState('');
  const [joiningDay, setJoiningDay]       = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  useFocusEffect(useCallback(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); }, []));

  async function joinGameDay() {
    const code = dayCode.trim().toUpperCase();
    if (code.length !== 6) { Alert.alert('Enter 6-character code'); return; }
    setJoiningDay(true);
    const { data } = await supabase
      .from('competition_days').select('id,course_name').eq('join_code', code).maybeSingle();
    setJoiningDay(false);
    if (!data) { Alert.alert('Not found', 'No game day with that code. Check with the organiser.'); return; }
    router.push(`/(app)/score/day/${(data as any).id}?spectate=1` as any);
  }

  async function loadMatches() {
    let pid = myPlayerId;
    if (!pid) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: p } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
        if (p) { pid = p.id; setMyPlayerId(p.id); }
      }
    }

    const { data, error } = await supabase
      .from('matches')
      .select('*,home_team:home_team_id(name,accent_color),away_team:away_team_id(name,accent_color),day:day_id(course_name,course_par)')
      .in('status', ['in_progress', 'upcoming'])
      .order('created_at', { ascending: false });

    if (!error && data) {
      // Casual hub shows casual rounds only — tournament fixtures (competition_id
      // set) already have their own home in the Tour tab, so keep them out of
      // here rather than mixing the two (Dave: tournament games shouldn't show
      // "if it's not casual golf").
      const matchData = (data as unknown as MatchWithDay[]).filter(m =>
        !m.competition_id && (!pid || m.home_player_ids.includes(pid) || m.away_player_ids.includes(pid))
      );
      setMatches(matchData);

      // Fetch completed matches for history section
      let completed: MatchWithDay[] = [];
      if (pid) {
        const [{ data: homeCompleted }, { data: awayCompleted }] = await Promise.all([
          supabase
            .from('matches')
            .select('*,home_team:home_team_id(name,accent_color),away_team:away_team_id(name,accent_color),day:day_id(course_name,course_par)')
            .eq('status', 'complete')
            .contains('home_player_ids', [pid])
            .order('created_at', { ascending: false })
            .limit(10),
          supabase
            .from('matches')
            .select('*,home_team:home_team_id(name,accent_color),away_team:away_team_id(name,accent_color),day:day_id(course_name,course_par)')
            .eq('status', 'complete')
            .contains('away_player_ids', [pid])
            .order('created_at', { ascending: false })
            .limit(10),
        ]);
        const merged = [...(homeCompleted as unknown as MatchWithDay[] ?? []), ...(awayCompleted as unknown as MatchWithDay[] ?? [])];
        const seen = new Set<string>();
        completed = merged
          .filter(m => !m.competition_id)
          .filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; })
          .sort((a, b) => new Date((b as any).created_at).getTime() - new Date((a as any).created_at).getTime())
          .slice(0, 15);
        setCompletedMatches(completed);
      }

      const allIds = [...new Set([...matchData, ...completed].flatMap(m => [...m.home_player_ids, ...m.away_player_ids]))];
      if (allIds.length > 0) {
        const { data: players } = await supabase.from('players').select('id,display_name,avatar_url').in('id', allIds);
        if (players) {
          const names: Record<string, string> = {};
          const avs: Record<string, string | null> = {};
          (players as any[]).forEach(p => { names[p.id] = p.display_name; avs[p.id] = p.avatar_url ?? null; });
          setPlayerNames(names);
          setPlayerAvatars(avs);
        }
      }
    }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    loadMatches();
    const sub = supabase
      .channel('matches-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, loadMatches)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, []);

  const live     = matches.filter(m => m.status === 'in_progress');
  const upcoming = matches.filter(m => m.status === 'upcoming');
  const complete = matches.filter(m => m.status === 'complete');

  const dateStr = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  const s = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: BG },

    // Image is 4928×3264 (3:2). width=SW → natural height = SW*(3264/4928) ≈ SW*0.663
    hero:        { width: '100%' as const, aspectRatio: 4928 / 3264 },
    heroOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(7,11,16,0.35)' },
    heroFade:    { position: 'absolute', bottom: 0, left: 0, right: 0, height: 50, backgroundColor: BG, opacity: 0.55 },
    heroContent: {
      flex: 1,
      paddingTop: Platform.OS === 'ios' ? 64 : 40,
      paddingHorizontal: 20,
      paddingBottom: 10,
      justifyContent: 'flex-end',
    },
    heroDate:  { fontFamily: FFB, fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 0.3, marginBottom: 6 },
    heroTitle: { fontFamily: FF, fontSize: 26, color: '#ffffff', lineHeight: 32, marginBottom: 16, letterSpacing: -0.2 },
    heroBtn:   {
      backgroundColor: GOLD, borderRadius: 14,
      paddingVertical: 16, flexDirection: 'row',
      alignItems: 'center', justifyContent: 'center', gap: 8,
    },
    heroBtnText: { fontFamily: FFB, fontSize: 17, color: '#000000' },

    body:    { paddingHorizontal: 16, paddingTop: 8 },
    centered:{ paddingVertical: 32, alignItems: 'center' },

    sectionHead:  { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 20, marginBottom: 10 },
    sectionLabel: { fontFamily: FFB, fontSize: 9, color: '#4b5563', letterSpacing: 2 },
    liveDot:      { width: 7, height: 7, borderRadius: 4, backgroundColor: GREEN },

    dayTile: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: CARD, borderRadius: 14,
      padding: 14, marginBottom: 8,
      borderWidth: 1, borderColor: `${GOLD}30`,
    },
    dayTileCourse: { fontFamily: FFB, fontSize: 14, color: '#ffffff', marginBottom: 2 },
    dayTileSub:    { fontFamily: FFB, fontSize: 11, color: '#fff' },
    dayCodeBadge:  { backgroundColor: `${GOLD}15`, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: `${GOLD}30`, marginRight: 8 },
    dayCodeText:   { fontFamily: FFB, fontSize: 11, color: GOLD, letterSpacing: 2 },

    joinCard: {
      backgroundColor: CARD, borderRadius: 14,
      borderWidth: 1, borderColor: BORDER,
      padding: 14, marginTop: 8,
    },
    joinCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4 },
    joinCardTitle:  { fontFamily: FFB, fontSize: 9, color: GOLD, letterSpacing: 2 },
    joinCardSub:    { fontFamily: FFB, fontSize: 12, color: '#fff', marginBottom: 12, lineHeight: 18 },
    joinRow:        { flexDirection: 'row', gap: 8 },
    joinInput: {
      flex: 1, backgroundColor: BG,
      borderWidth: 1, borderColor: BORDER,
      borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
      fontFamily: FFB, color: '#ffffff', fontSize: 16, letterSpacing: 4,
    },
    joinBtn:    { backgroundColor: GOLD, borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
    joinBtnText:{ fontFamily: FFB, fontSize: 14, color: '#000000' },

    card: {
      backgroundColor: CARD, borderRadius: 14,
      padding: 14, marginBottom: 8,
      borderWidth: 1, borderColor: BORDER,
    },
    cardLive:     { borderColor: `${GREEN}30` },
    cardComplete: { borderColor: BORDER },
    cardTop:    { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10, gap: 10 },
    cardCourse: { fontFamily: FFB, fontSize: 14, color: '#ffffff' },
    cardFormat: { fontFamily: FFB, fontSize: 11, color: '#fff', marginTop: 2 },

    badge: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: 10, paddingVertical: 4,
      borderRadius: 20, backgroundColor: '#1a1a1a',
      borderWidth: 1, borderColor: '#222',
    },
    badgeLive:     { backgroundColor: `${GREEN}10`, borderColor: `${GREEN}35` },
    badgeComplete: { backgroundColor: `${GOLD}0d`, borderColor: `${GOLD}30` },
    badgeText:     { fontFamily: FFB, fontSize: 11, color: '#fff' },
    liveDotSm:     { width: 5, height: 5, borderRadius: 3, backgroundColor: GREEN },

    playersRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    avWrap:     { borderRadius: 14, overflow: 'hidden', borderWidth: 1.5, borderColor: CARD },
    avOverlap:  { marginLeft: -8 },
    avImg:      { width: 28, height: 28, borderRadius: 14 },
    avFallback: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
    avInitial:  { fontFamily: FFB, fontSize: 10, color: '#ffffff' },
    playersText:{ flex: 1, fontFamily: FFB, fontSize: 13, color: '#fff', marginLeft: 6 },

    matchupRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
    matchSide:   { flex: 1, fontFamily: FFB, fontSize: 13, color: '#fff' },
    matchSideR:  { textAlign: 'right' },
    matchWin:    { fontFamily: FFB, color: '#ffffff' },
    vsText:      { fontFamily: FFB, fontSize: 10, color: '#4b5563' },

    emptyState:     { paddingVertical: 48, alignItems: 'center', gap: 12 },
    emptyStateText: { fontFamily: FFB, fontSize: 13, color: '#4b5563', textAlign: 'center', lineHeight: 20 },
  }), [GOLD, BG, CARD, BORDER]);

  if (!fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={GOLD} />
    </View>
  );

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadMatches(); }} tintColor={GOLD} />}
      >
        {/* ── Hero ── */}
        <ImageBackground source={heroCourse} style={s.hero} resizeMode="cover">
          <View style={s.heroOverlay} />
          <View style={s.heroFade} />
          <View style={s.heroContent}>
            <Text style={s.heroDate}>{dateStr}</Text>
            <Text style={s.heroTitle}>Are we playing{'\n'}today?</Text>
            <TouchableOpacity
              style={s.heroBtn}
              onPress={() => router.push('/(app)/games/new' as any)}
              activeOpacity={0.88}
            >
              <Ionicons name="golf-outline" size={18} color="#000000" />
              <Text style={s.heroBtnText}>Start New Round</Text>
            </TouchableOpacity>
          </View>
        </ImageBackground>

        {/* ── Body ── */}
        <View style={s.body}>

          {loading && (
            <View style={s.centered}><ActivityIndicator color={GOLD} /></View>
          )}

          {/* Join a Day */}
          <View style={s.joinCard}>
            <View style={s.joinCardHeader}>
              <Ionicons name="people-outline" size={16} color={GOLD} />
              <Text style={s.joinCardTitle}>JOIN A GAME DAY</Text>
            </View>
            <Text style={s.joinCardSub}>Got a 6-digit code from a mate? Jump into their leaderboard.</Text>
            <View style={s.joinRow}>
              <TextInput
                style={s.joinInput}
                placeholder="Enter code…"
                placeholderTextColor="#4b5563"
                value={dayCode}
                onChangeText={t => setDayCode(t.toUpperCase())}
                autoCapitalize="characters"
                maxLength={6}
              />
              <TouchableOpacity
                style={[s.joinBtn, (!dayCode || joiningDay) && { opacity: 0.4 }]}
                onPress={joinGameDay}
                disabled={!dayCode || joiningDay}
                activeOpacity={0.8}
              >
                <Text style={s.joinBtnText}>{joiningDay ? '…' : 'Join'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Live */}
          {live.length > 0 && (
            <>
              <SectionHead label="LIVE NOW" live s={s} />
              {live.map(m => <RoundCard key={m.id} match={m} playerNames={playerNames} playerAvatars={playerAvatars} s={s} GOLD={GOLD} />)}
            </>
          )}

          {/* Upcoming */}
          {upcoming.length > 0 && (
            <>
              <SectionHead label="UPCOMING" s={s} />
              {upcoming.map(m => <RoundCard key={m.id} match={m} playerNames={playerNames} playerAvatars={playerAvatars} s={s} GOLD={GOLD} />)}
            </>
          )}

          {/* History */}
          {completedMatches.length > 0 && (
            <>
              <SectionHead label="HISTORY" s={s} />
              {completedMatches.map(m => <RoundCard key={m.id} match={m} playerNames={playerNames} playerAvatars={playerAvatars} s={s} GOLD={GOLD} />)}
            </>
          )}

          {!loading && matches.length === 0 && completedMatches.length === 0 && (
            <View style={s.emptyState}>
              <Ionicons name="golf-outline" size={40} color="#1c1c1c" />
              <Text style={s.emptyStateText}>No rounds yet — hit Start New Round to get going.</Text>
            </View>
          )}


          <View style={{ height: 40 }} />
        </View>
      </ScrollView>
    </View>
  );
}

function SectionHead({ label, live, s }: { label: string; live?: boolean; s: any }) {
  return (
    <View style={s.sectionHead}>
      {live && <View style={s.liveDot} />}
      <Text style={[s.sectionLabel, live && { color: GREEN }]}>{label}</Text>
    </View>
  );
}

function RoundCard({ match, playerNames, playerAvatars, s, GOLD }: {
  match: MatchWithDay;
  playerNames: Record<string, string>;
  playerAvatars: Record<string, string | null>;
  s: any;
  GOLD: string;
}) {
  const router   = useRouter();
  const isSolo   = match.away_player_ids.length === 0 && match.home_player_ids.length === 1;
  const isStroke = match.round_format === 'stableford' || match.round_format === 'medal';
  const winner   = getEffectiveWinner(match.status, match.winner, match.holes_string ?? '..................', match.holes_to_play ?? 18);

  const resultStr = (isSolo || isStroke)
    ? (match.status === 'complete'  ? (match.result_str ?? 'Complete')
      : match.status === 'upcoming' ? 'Upcoming'
      : (match.result_str ?? 'In Progress'))
    : matchLabel(match.status, match.winner, match.result_str, match.holes_string ?? '..................', match.holes_to_play ?? 18);

  const homeWon   = winner === 'home';
  const awayWon   = winner === 'away';
  const fn        = (id: string) => (playerNames[id] ?? '?').split(' ')[0];
  const homeLabel = match.home_team?.name ?? match.home_player_ids.map(fn).join(' & ');
  const awayLabel = match.away_team?.name ?? match.away_player_ids.map(fn).join(' & ');
  // Mashie also stores as round_format 'team_stableford' — same field the
  // plain Team Stableford format uses — so it needs the same away-side +
  // team-size check score/preview/[matchId].tsx already uses to label it
  // correctly instead of falling back to the generic map entry.
  const isMashieMatch = (match.round_format as string) === 'team_stableford' && match.away_player_ids.length === 0 && ((match as any).team_size ?? 2) >= 4;
  const fmtLabel  = isMashieMatch ? 'Mashie Golf' : FORMAT_LABELS[match.round_format ?? ''] ?? (match.round_format ?? 'Golf');
  const isLive     = match.status === 'in_progress';
  const isComplete = match.status === 'complete';

  function av(id: string) {
    const raw = playerAvatars[id] ?? getPlayerAvatar(id, 'normal');
    if (raw) {
      return <Image key={id} source={typeof raw === 'string' ? { uri: raw } : raw} style={s.avImg} />;
    }
    return (
      <View key={id} style={s.avFallback}>
        <Text style={s.avInitial}>{fn(id)[0]}</Text>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[s.card, isLive && s.cardLive, isComplete && s.cardComplete]}
      onPress={() => {
        // solo/enter render the full trophy + scoring-breakdown results view
        // themselves once a round is complete — no separate results screen needed.
        if (isSolo) { router.push(`/(app)/score/solo/${match.id}` as any); return; }
        if (!isComplete && match.day_id) { router.push(`/(app)/score/day/${match.day_id}` as any); return; }
        if ((match.round_format as string) === 'team_stableford') { router.push(`/(app)/score/teamstableford/${match.id}` as any); return; }
        router.push(`/(app)/score/enter/${match.id}` as any);
      }}
      activeOpacity={0.75}
    >
      <View style={s.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={s.cardCourse} numberOfLines={1}>
            {match.day?.course_name ?? 'Casual Round'}
          </Text>
          <Text style={s.cardFormat}>{fmtLabel}</Text>
        </View>
        <View style={[s.badge, isLive && s.badgeLive, isComplete && s.badgeComplete]}>
          {isLive && <View style={s.liveDotSm} />}
          <Text style={[s.badgeText, isLive && { color: GREEN }, isComplete && { color: GOLD }]}>
            {resultStr}
          </Text>
        </View>
      </View>

      {(isSolo || isStroke) ? (
        <View style={s.playersRow}>
          {match.home_player_ids.slice(0, 4).map((id, i) => (
            <View key={id} style={[s.avWrap, i > 0 && s.avOverlap]}>{av(id)}</View>
          ))}
          <Text style={s.playersText} numberOfLines={1}>
            {match.home_player_ids.map(fn).join(', ')}
          </Text>
        </View>
      ) : (
        <View style={s.matchupRow}>
          <Text style={[s.matchSide, homeWon && s.matchWin]} numberOfLines={1}>{homeLabel}</Text>
          <Text style={s.vsText}>vs</Text>
          <Text style={[s.matchSide, s.matchSideR, awayWon && s.matchWin]} numberOfLines={1}>{awayLabel}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

