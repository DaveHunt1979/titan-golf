import { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Image,
  TextInput,
  Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter, Link } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { fonts, spacing, radius } from '../../../src/lib/theme';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { matchLabel, getEffectiveWinner } from '../../../src/lib/scoring';
import { getPlayerAvatar, teamLogos } from '../../../src/lib/assets';
import type { Match, Team } from '../../../src/types';

interface MatchWithTeams extends Match {
  home_team: Pick<Team, 'name' | 'accent_color'> | null;
  away_team: Pick<Team, 'name' | 'accent_color'> | null;
}

export default function ScoreScreen() {
  const colors = useDynamicColors();
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: {
      paddingTop: 60,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      flexDirection: 'row',
      alignItems: 'flex-end',
    },
    title: { fontSize: fonts.xxl, fontWeight: '800', color: colors.white, letterSpacing: 1, flex: 1 },
    newGameBtn: {
      backgroundColor: colors.gold,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
    },
    newGameBtnText: { fontSize: fonts.sm, fontWeight: '700', color: colors.bg, letterSpacing: 0.5 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
    section: { marginBottom: spacing.lg },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.xs },
    sectionLabel: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5 },
    liveDot: { width: 7, height: 7, borderRadius: 4 },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardRow: { flexDirection: 'row', alignItems: 'center' },
    teamSide: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    teamRight: { justifyContent: 'flex-end' },
    teamLogo: { width: 28, height: 28, borderRadius: 4 },
    playerAv: { width: 28, height: 28, borderRadius: 14, overflow: 'hidden' },
    pairAvatars: { flexDirection: 'row' },
    pairAv: { width: 22, height: 22, borderRadius: 11, overflow: 'hidden' },
    avFallback: { backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
    avInitial: { fontSize: 11, fontWeight: '700', color: colors.white },
    avInitialSm: { fontSize: 9, fontWeight: '700', color: colors.white },
    teamName: { fontSize: fonts.md, fontWeight: '600', color: colors.textSecondary, flexShrink: 1 },
    teamWon: { color: colors.white, fontWeight: '700' },
    resultBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.sm,
      backgroundColor: colors.cardAlt,
      minWidth: 70,
      alignItems: 'center',
    },
    resultLive: { backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
    resultComplete: { backgroundColor: colors.goldDim, borderWidth: 1, borderColor: colors.goldBorder },
    resultText: { fontSize: fonts.sm, fontWeight: '700', color: colors.textSecondary },
    resultTextLive: { color: colors.live },
    matchType: { fontSize: fonts.xs, color: colors.textMuted, marginTop: 6, textAlign: 'center' },
    empty: { alignItems: 'center', paddingVertical: spacing.xxl },
    emptyText: { fontSize: fonts.lg, color: colors.textSecondary, fontWeight: '600' },
    emptySubtext: { fontSize: fonts.sm, color: colors.textMuted, marginTop: spacing.xs },
    joinDayRow:   { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
    joinDayInput: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 8, color: colors.white, fontSize: fonts.sm, fontWeight: '700', letterSpacing: 2 },
    joinDayBtn:   { backgroundColor: colors.gold, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 8, justifyContent: 'center' },
    joinDayBtnOff:{ opacity: 0.4 },
    joinDayBtnText: { color: colors.bg, fontSize: fonts.sm, fontWeight: '800' },
  }), [colors]);

  const router = useRouter();
  const [matches, setMatches] = useState<MatchWithTeams[]>([]);
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [playerAvatars, setPlayerAvatars] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dayCode, setDayCode] = useState('');
  const [joiningDay, setJoiningDay] = useState(false);

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
    const { data, error } = await supabase
      .from('matches')
      .select(`
        *,
        home_team:home_team_id(name, accent_color),
        away_team:away_team_id(name, accent_color)
      `)
      .order('match_number', { ascending: true });

    if (!error && data) {
      const matchData = data as unknown as MatchWithTeams[];
      setMatches(matchData);

      const allIds = [...new Set(matchData.flatMap(m => [...m.home_player_ids, ...m.away_player_ids]))];
      if (allIds.length > 0) {
        const { data: players } = await supabase.from('players').select('id,display_name,avatar_url').in('id', allIds);
        if (players) {
          const names: Record<string, string> = {};
          const avatars: Record<string, string | null> = {};
          (players as any[]).forEach(p => { names[p.id] = p.display_name; avatars[p.id] = p.avatar_url ?? null; });
          setPlayerNames(names);
          setPlayerAvatars(avatars);
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

  function onRefresh() {
    setRefreshing(true);
    loadMatches();
  }

  const live = matches.filter(m => m.status === 'in_progress');
  const upcoming = matches.filter(m => m.status === 'upcoming');
  const complete = matches.filter(m => m.status === 'complete');

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Text style={styles.title}>Matches</Text>
        <TouchableOpacity
          style={styles.newGameBtn}
          onPress={() => router.push('/(app)/games/new' as any)}
          activeOpacity={0.8}
        >
          <Text style={styles.newGameBtnText}>+ New Game</Text>
        </TouchableOpacity>
      </View>

      {/* Join Game Day banner */}
      <View style={styles.joinDayRow}>
        <TextInput
          style={styles.joinDayInput}
          placeholder="Game Day code…"
          placeholderTextColor={colors.textMuted}
          value={dayCode}
          onChangeText={t => setDayCode(t.toUpperCase())}
          autoCapitalize="characters"
          maxLength={6}
        />
        <TouchableOpacity
          style={[styles.joinDayBtn, (!dayCode || joiningDay) && styles.joinDayBtnOff]}
          onPress={joinGameDay}
          disabled={!dayCode || joiningDay}
          activeOpacity={0.8}
        >
          <Text style={styles.joinDayBtnText}>{joiningDay ? '…' : 'Join Day'}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.gold} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.gold} />}
          showsVerticalScrollIndicator={false}
        >
          {live.length > 0 && (
            <Section label="LIVE" labelColor={colors.live} styles={styles}>
              {live.map(m => <MatchCard key={m.id} match={m} playerNames={playerNames} playerAvatars={playerAvatars} styles={styles} colors={colors} />)}
            </Section>
          )}
          {upcoming.length > 0 && (
            <Section label="UPCOMING" styles={styles}>
              {upcoming.map(m => <MatchCard key={m.id} match={m} playerNames={playerNames} playerAvatars={playerAvatars} styles={styles} colors={colors} />)}
            </Section>
          )}
          {complete.length > 0 && (
            <Section label="COMPLETED" styles={styles}>
              {complete.map(m => <MatchCard key={m.id} match={m} playerNames={playerNames} playerAvatars={playerAvatars} styles={styles} colors={colors} />)}
            </Section>
          )}
          {matches.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No matches yet.</Text>
              <Text style={styles.emptySubtext}>Check back once the draw is set.</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Section({ label, labelColor, children, styles }: { label: string; labelColor?: string; children: React.ReactNode; styles: any }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        {labelColor && <View style={[styles.liveDot, { backgroundColor: labelColor }]} />}
        <Text style={[styles.sectionLabel, labelColor ? { color: labelColor } : {}]}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

function MatchCard({ match, playerNames, playerAvatars, styles, colors }: { match: MatchWithTeams; playerNames: Record<string, string>; playerAvatars: Record<string, string | null>; styles: any; colors: any }) {
  const router = useRouter();
  const isSolo = match.away_player_ids.length === 0;
  const isStrokePlay = match.round_format === 'stableford' || match.round_format === 'medal';
  const winner = getEffectiveWinner(match.status, match.winner, match.holes_string ?? '..................');
  const label = (isSolo || isStrokePlay)
    ? (match.status === 'complete' ? (match.result_str ?? 'Complete')
      : match.status === 'upcoming' ? 'Upcoming'
      : (match.result_str ?? 'In Progress'))
    : matchLabel(match.status, match.winner, match.result_str, match.holes_string ?? '..................');

  const homeWon = winner === 'home';
  const awayWon = winner === 'away';

  const firstName = (id: string) => (playerNames[id] ?? '?').split(' ')[0];
  const hasTeam = match.home_team_id !== null;
  const homeLogo = hasTeam && match.home_team ? teamLogos[match.home_team.name] : null;
  const awayLogo = hasTeam && match.away_team ? teamLogos[match.away_team.name] : null;

  const homeLabel = hasTeam
    ? (match.home_team?.name ?? '—')
    : match.home_player_ids.map(firstName).join(' & ');
  const awayLabel = hasTeam
    ? (match.away_team?.name ?? '—')
    : match.away_player_ids.map(firstName).join(' & ');

  function renderHomeVisual() {
    if (hasTeam && homeLogo) return <Image source={homeLogo} style={styles.teamLogo} resizeMode="contain" />;
    if (match.is_singles || isSolo) {
      const raw = playerAvatars[match.home_player_ids[0]] ?? getPlayerAvatar(match.home_player_ids[0], 'normal');
      return raw
        ? <Image source={typeof raw === 'string' ? { uri: raw } : raw} style={styles.playerAv} />
        : <View style={[styles.playerAv, styles.avFallback]}><Text style={styles.avInitial}>{homeLabel[0]}</Text></View>;
    }
    return (
      <View style={styles.pairAvatars}>
        {match.home_player_ids.map((id, i) => {
          const raw = playerAvatars[id] ?? getPlayerAvatar(id, 'normal');
          return raw
            ? <Image key={id} source={typeof raw === 'string' ? { uri: raw } : raw} style={[styles.pairAv, { marginLeft: i > 0 ? -6 : 0 }]} />
            : <View key={id} style={[styles.pairAv, styles.avFallback, { marginLeft: i > 0 ? -6 : 0 }]}><Text style={styles.avInitialSm}>{firstName(id)[0]}</Text></View>;
        })}
      </View>
    );
  }

  function renderAwayVisual() {
    if (hasTeam && awayLogo) return <Image source={awayLogo} style={styles.teamLogo} resizeMode="contain" />;
    if (match.is_singles) {
      const raw = playerAvatars[match.away_player_ids[0]] ?? getPlayerAvatar(match.away_player_ids[0], 'normal');
      return raw
        ? <Image source={typeof raw === 'string' ? { uri: raw } : raw} style={styles.playerAv} />
        : <View style={[styles.playerAv, styles.avFallback]}><Text style={styles.avInitial}>{awayLabel[0]}</Text></View>;
    }
    return (
      <View style={styles.pairAvatars}>
        {match.away_player_ids.map((id, i) => {
          const raw = playerAvatars[id] ?? getPlayerAvatar(id, 'normal');
          return raw
            ? <Image key={id} source={typeof raw === 'string' ? { uri: raw } : raw} style={[styles.pairAv, { marginLeft: i > 0 ? -6 : 0 }]} />
            : <View key={id} style={[styles.pairAv, styles.avFallback, { marginLeft: i > 0 ? -6 : 0 }]}><Text style={styles.avInitialSm}>{firstName(id)[0]}</Text></View>;
        })}
      </View>
    );
  }

  return (
    <TouchableOpacity style={styles.card} onPress={() => {
      router.push(`/(app)/score/${match.id}` as any);
    }} activeOpacity={0.75}>
      <View style={styles.cardRow}>
        {/* Home side */}
        <View style={styles.teamSide}>
          {renderHomeVisual()}
          <Text style={[styles.teamName, homeWon && styles.teamWon]} numberOfLines={1}>{homeLabel}</Text>
        </View>

        {/* Result badge */}
        <View style={[
          styles.resultBadge,
          match.status === 'in_progress' && styles.resultLive,
          match.status === 'complete' && styles.resultComplete,
        ]}>
          <Text style={[
            styles.resultText,
            match.status === 'in_progress' && styles.resultTextLive,
          ]}>{label}</Text>
        </View>

        {/* Away side */}
        <View style={[styles.teamSide, styles.teamRight]}>
          <Text style={[styles.teamName, awayWon && styles.teamWon]} numberOfLines={1}>{awayLabel}</Text>
          {renderAwayVisual()}
        </View>
      </View>

      {match.is_singles && (
        <Text style={styles.matchType}>Singles</Text>
      )}
    </TouchableOpacity>
  );
}
