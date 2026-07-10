import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, RefreshControl, Image, TextInput,
  Alert, Platform, ImageBackground,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';
import { matchLabel, getEffectiveWinner } from '../../../src/lib/scoring';
import { getPlayerAvatar } from '../../../src/lib/assets';
import type { Match, Team } from '../../../src/types';

const heroCourse = require('../../../assets/hero-course.jpeg');

interface MatchWithDay extends Match {
  home_team: Pick<Team, 'name' | 'accent_color'> | null;
  away_team: Pick<Team, 'name' | 'accent_color'> | null;
  day: { course_name: string; course_par: number } | null;
}
type ActiveDay = { id: string; course_name: string; join_code: string; day_date: string; player_count: number };

const FORMAT_LABELS: Record<string, string> = {
  stableford: 'Stableford', medal: 'Medal', singles: 'Singles Matchplay',
  '4bbb': '4BBB Matchplay', skins: 'Skins', nassau: 'Nassau', wolf: 'Wolf',
  scramble: 'Scramble', greensomes: 'Greensomes', bbb: 'BBB',
  foursomes: 'Foursomes', modified_stableford: 'Modified Stableford',
  par_bogey: 'Par / Bogey', chacha: 'ChaChaCha',
};

export default function ScoreScreen() {
  const router = useRouter();
  const [myPlayerId, setMyPlayerId]       = useState<string | null>(null);
  const [matches, setMatches]             = useState<MatchWithDay[]>([]);
  const [playerNames, setPlayerNames]     = useState<Record<string, string>>({});
  const [playerAvatars, setPlayerAvatars] = useState<Record<string, string | null>>({});
  const [loading, setLoading]             = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [dayCode, setDayCode]             = useState('');
  const [joiningDay, setJoiningDay]       = useState(false);
  const [activeDays, setActiveDays]       = useState<ActiveDay[]>([]);

  async function joinGameDay() {
    const code = dayCode.trim().toUpperCase();
    if (code.length !== 6) { Alert.alert('Enter 6-character code'); return; }
    setJoiningDay(true);
    const { data } = await supabase
      .from('competition_days').select('id,course_name').eq('join_code', code).maybeSingle();
    setJoiningDay(false);
    if (!data) { Alert.alert('Not found', 'No game day with that code. Check with the organiser.'); return; }
    router.push(`/(app)/score/day/${(data as any).id}` as any);
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

    const today = new Date().toISOString().split('T')[0];

    const [{ data, error }, { data: daysData }] = await Promise.all([
      supabase
        .from('matches')
        .select('*,home_team:home_team_id(name,accent_color),away_team:away_team_id(name,accent_color),day:day_id(course_name,course_par)')
        .order('created_at', { ascending: false }),
      supabase
        .from('competition_days')
        .select('id,course_name,join_code,day_date,matches(home_player_ids,away_player_ids)')
        .gte('day_date', today)
        .order('day_date', { ascending: true })
        .limit(20),
    ]);

    if (daysData) {
      const days = (daysData as any[])
        .filter(d => {
          const allIds = (d.matches ?? []).flatMap((m: any) => [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])]);
          return !pid || allIds.includes(pid);
        })
        .map(d => {
          const allIds = new Set((d.matches ?? []).flatMap((m: any) => [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])]));
          return { id: d.id, course_name: d.course_name, join_code: d.join_code, day_date: d.day_date, player_count: allIds.size };
        });
      setActiveDays(days);
    }

    if (!error && data) {
      const matchData = (data as unknown as MatchWithDay[]).filter(m =>
        !pid || m.home_player_ids.includes(pid) || m.away_player_ids.includes(pid)
      );
      setMatches(matchData);

      const allIds = [...new Set(matchData.flatMap(m => [...m.home_player_ids, ...m.away_player_ids]))];
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

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadMatches(); }} tintColor={colors.gold} />}
      >
        {/* ── Hero ── */}
        <ImageBackground source={heroCourse} style={s.hero} resizeMode="cover">
          {/* Dark overlay */}
          <View style={s.heroOverlay} />
          {/* Bottom fade to black */}
          <View style={s.heroFade} />

          <View style={s.heroContent}>
            <View style={s.heroTop}>
              <Text style={s.heroLabel}>CASUAL PLAY</Text>
              <Text style={s.heroDate}>{dateStr}</Text>
            </View>

            <Text style={s.heroTitle}>Are we playing{'\n'}today?</Text>

            <TouchableOpacity
              style={s.heroBtn}
              onPress={() => router.push('/(app)/games/new' as any)}
              activeOpacity={0.88}
            >
              <Text style={s.heroBtnText}>⛳  Start New Round</Text>
            </TouchableOpacity>
          </View>
        </ImageBackground>

        {/* ── Body ── */}
        <View style={s.body}>

          {loading && (
            <View style={s.centered}><ActivityIndicator color={colors.gold} /></View>
          )}

          {/* Group Days */}
          {activeDays.length > 0 && (
            <>
              <SectionHead label="GROUP DAYS" />
              {activeDays.map(d => {
                const isToday = d.day_date === new Date().toISOString().split('T')[0];
                const label   = isToday
                  ? 'Today'
                  : new Date(d.day_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
                return (
                  <TouchableOpacity
                    key={d.id}
                    style={s.dayTile}
                    onPress={() => router.push(`/(app)/score/day/${d.id}` as any)}
                    activeOpacity={0.8}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={s.dayTileCourse}>{d.course_name}</Text>
                      <Text style={s.dayTileSub}>{label}{d.player_count > 0 ? ` · ${d.player_count} players` : ''}</Text>
                    </View>
                    <View style={s.dayCode}><Text style={s.dayCodeText}>{d.join_code}</Text></View>
                    <Text style={s.chevron}>›</Text>
                  </TouchableOpacity>
                );
              })}
            </>
          )}

          {/* Join a Day */}
          <View style={s.joinCard}>
            <Text style={s.joinCardTitle}>JOIN A GAME DAY</Text>
            <Text style={s.joinCardSub}>Got a 6-digit code from a mate? Jump into their leaderboard.</Text>
            <View style={s.joinRow}>
              <TextInput
                style={s.joinInput}
                placeholder="Enter code…"
                placeholderTextColor={colors.textMuted}
                value={dayCode}
                onChangeText={t => setDayCode(t.toUpperCase())}
                autoCapitalize="characters"
                maxLength={6}
              />
              <TouchableOpacity
                style={[s.joinBtn, (!dayCode || joiningDay) && s.joinBtnOff]}
                onPress={joinGameDay}
                disabled={!dayCode || joiningDay}
                activeOpacity={0.8}
              >
                <Text style={s.joinBtnText}>{joiningDay ? '…' : 'Join Day'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Live */}
          {live.length > 0 && (
            <>
              <SectionHead label="LIVE NOW" live />
              {live.map(m => <RoundCard key={m.id} match={m} playerNames={playerNames} playerAvatars={playerAvatars} />)}
            </>
          )}

          {/* Upcoming */}
          {upcoming.length > 0 && (
            <>
              <SectionHead label="UPCOMING" />
              {upcoming.map(m => <RoundCard key={m.id} match={m} playerNames={playerNames} playerAvatars={playerAvatars} />)}
            </>
          )}

          {/* Recent rounds */}
          {complete.length > 0 && (
            <>
              <SectionHead label="RECENT ROUNDS" />
              {complete.map(m => <RoundCard key={m.id} match={m} playerNames={playerNames} playerAvatars={playerAvatars} />)}
            </>
          )}

          {/* Empty rounds state */}
          {!loading && matches.length === 0 && (
            <View style={s.emptyRounds}>
              <Text style={s.emptyRoundsText}>No rounds yet — hit Start New Round above to get going.</Text>
            </View>
          )}

          <View style={{ height: 40 }} />
        </View>
      </ScrollView>
    </View>
  );
}

function SectionHead({ label, live }: { label: string; live?: boolean }) {
  return (
    <View style={s.sectionHead}>
      {live && <View style={s.liveDot} />}
      <Text style={[s.sectionLabel, live && s.sectionLabelLive]}>{label}</Text>
    </View>
  );
}

function RoundCard({ match, playerNames, playerAvatars }: {
  match: MatchWithDay;
  playerNames: Record<string, string>;
  playerAvatars: Record<string, string | null>;
}) {
  const router   = useRouter();
  const isSolo   = match.away_player_ids.length === 0;
  const isStroke = match.round_format === 'stableford' || match.round_format === 'medal';
  const winner   = getEffectiveWinner(match.status, match.winner, match.holes_string ?? '..................');

  const resultStr = (isSolo || isStroke)
    ? (match.status === 'complete'  ? (match.result_str ?? 'Complete')
      : match.status === 'upcoming' ? 'Upcoming'
      : (match.result_str ?? 'In Progress'))
    : matchLabel(match.status, match.winner, match.result_str, match.holes_string ?? '..................');

  const homeWon   = winner === 'home';
  const awayWon   = winner === 'away';
  const fn        = (id: string) => (playerNames[id] ?? '?').split(' ')[0];
  const homeLabel = match.home_team?.name ?? match.home_player_ids.map(fn).join(' & ');
  const awayLabel = match.away_team?.name ?? match.away_player_ids.map(fn).join(' & ');
  const fmtLabel  = FORMAT_LABELS[match.round_format ?? ''] ?? (match.round_format ?? 'Golf');
  const isLive     = match.status === 'in_progress';
  const isComplete = match.status === 'complete';

  function av(id: string) {
    const raw = playerAvatars[id] ?? getPlayerAvatar(id, 'normal');
    return raw
      ? <Image key={id} source={typeof raw === 'string' ? { uri: raw } : raw} style={s.avImg} />
      : <View key={id} style={s.avFallback}><Text style={s.avInitial}>{fn(id)[0]}</Text></View>;
  }

  return (
    <TouchableOpacity
      style={[s.card, isLive && s.cardLive]}
      onPress={() => router.push(`/(app)/score/${match.id}` as any)}
      activeOpacity={0.75}
    >
      {/* Top row: course + badge */}
      <View style={s.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={s.cardCourse} numberOfLines={1}>
            {match.day?.course_name ?? 'Casual Round'}
          </Text>
          <Text style={s.cardFormat}>{fmtLabel}</Text>
        </View>
        <View style={[s.badge, isLive && s.badgeLive, isComplete && s.badgeComplete]}>
          {isLive && <View style={s.liveDotSm} />}
          <Text style={[s.badgeText, isLive && s.badgeLiveText, isComplete && s.badgeCompleteText]}>
            {resultStr}
          </Text>
        </View>
      </View>

      {/* Players */}
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

const HERO_H = 340;

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  // Hero
  hero: { height: HERO_H },
  heroOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(7,11,16,0.42)',
  },
  heroFade: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 160,
    backgroundColor: colors.bg,
    opacity: 0.92,
  },
  heroContent: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 60 : 36,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    justifyContent: 'flex-end',
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  heroLabel: { fontSize: fonts.xs, fontWeight: '800', color: colors.gold, letterSpacing: 2 },
  heroDate:  { fontSize: fonts.xs, color: 'rgba(255,255,255,0.55)', fontWeight: '600' },
  heroTitle: {
    fontSize: 34,
    fontWeight: '900',
    color: colors.white,
    lineHeight: 40,
    marginBottom: spacing.lg,
    letterSpacing: 0.3,
  },
  heroBtn: {
    backgroundColor: colors.gold,
    borderRadius: radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
  },
  heroBtnText: { fontSize: fonts.lg, fontWeight: '900', color: colors.bg, letterSpacing: 1 },

  // Body
  body:    { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  centered:{ paddingVertical: spacing.xl, alignItems: 'center' },

  // Section
  sectionHead:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionLabel:     { fontSize: fonts.xs, fontWeight: '800', color: colors.textMuted, letterSpacing: 1.5 },
  sectionLabelLive: { color: '#22c55e' },
  liveDot:          { width: 7, height: 7, borderRadius: 4, backgroundColor: '#22c55e' },

  // Group day tile
  dayTile: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.goldBorder,
  },
  dayTileCourse: { fontSize: fonts.md, fontWeight: '700', color: colors.white, marginBottom: 2 },
  dayTileSub:    { fontSize: fonts.xs, color: colors.textMuted },
  dayCode: {
    backgroundColor: 'rgba(212,175,55,0.1)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    marginLeft: spacing.sm,
  },
  dayCodeText: { fontSize: fonts.xs, fontWeight: '800', color: colors.gold, letterSpacing: 2 },
  chevron:     { color: colors.gold, fontSize: 22, marginLeft: spacing.xs },

  // Join card
  joinCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  joinCardTitle: { fontSize: fonts.xs, fontWeight: '800', color: colors.gold, letterSpacing: 2, marginBottom: 4 },
  joinCardSub:   { fontSize: fonts.xs, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 18 },
  joinRow:       { flexDirection: 'row', gap: spacing.sm },
  joinInput: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.white,
    fontSize: fonts.sm,
    fontWeight: '700',
    letterSpacing: 3,
  },
  joinBtn:    { backgroundColor: colors.gold, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 10, justifyContent: 'center' },
  joinBtnOff: { opacity: 0.4 },
  joinBtnText:{ color: colors.bg, fontSize: fonts.sm, fontWeight: '800' },

  // Round card
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardLive: { borderColor: 'rgba(34,197,94,0.3)' },
  cardTop:  { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.sm, gap: spacing.sm },
  cardCourse: { fontSize: fonts.md, fontWeight: '700', color: colors.white },
  cardFormat: { fontSize: fonts.xs, color: colors.textMuted, marginTop: 2 },

  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.cardAlt,
    borderWidth: 1, borderColor: colors.border,
  },
  badgeLive:         { backgroundColor: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.35)' },
  badgeComplete:     { backgroundColor: colors.goldDim, borderColor: colors.goldBorder },
  badgeText:         { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted },
  badgeLiveText:     { color: '#22c55e' },
  badgeCompleteText: { color: colors.gold },
  liveDotSm:         { width: 5, height: 5, borderRadius: 3, backgroundColor: '#22c55e' },

  playersRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  avWrap:     { borderRadius: 14, overflow: 'hidden', borderWidth: 1.5, borderColor: colors.card },
  avOverlap:  { marginLeft: -8 },
  avImg:      { width: 28, height: 28, borderRadius: 14 },
  avFallback: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  avInitial:  { fontSize: 10, fontWeight: '800', color: colors.white },
  playersText:{ flex: 1, fontSize: fonts.sm, fontWeight: '600', color: colors.textSecondary, marginLeft: 4 },

  matchupRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  matchSide:   { flex: 1, fontSize: fonts.sm, fontWeight: '600', color: colors.textSecondary },
  matchSideR:  { textAlign: 'right' },
  matchWin:    { color: colors.white, fontWeight: '700' },
  vsText:      { fontSize: fonts.xs, fontWeight: '600', color: colors.textMuted },

  emptyRounds: { paddingVertical: spacing.xl, alignItems: 'center' },
  emptyRoundsText: { fontSize: fonts.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
});
