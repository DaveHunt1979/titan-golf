import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Image, RefreshControl,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../../src/lib/supabase';
import { matchLabel, getEffectiveWinner } from '../../../../src/lib/scoring';
import { colors, fonts, spacing, radius } from '../../../../src/lib/theme';
import { getPlayerAvatar, teamLogos } from '../../../../src/lib/assets';
import type { Match, Team, CompetitionDay } from '../../../../src/types';

interface MatchWithTeams extends Match {
  home_team: Pick<Team, 'name' | 'accent_color'> | null;
  away_team: Pick<Team, 'name' | 'accent_color'> | null;
}

export default function TourDayScreen() {
  const { dayId } = useLocalSearchParams<{ dayId: string }>();
  const router = useRouter();
  const [day, setDay] = useState<CompetitionDay | null>(null);
  const [matches, setMatches] = useState<MatchWithTeams[]>([]);
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [playerAvatars, setPlayerAvatars] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    const [{ data: dayData }, { data: matchData }] = await Promise.all([
      supabase.from('competition_days').select('*').eq('id', dayId).single(),
      supabase
        .from('matches')
        .select('*, home_team:home_team_id(name, accent_color), away_team:away_team_id(name, accent_color)')
        .eq('day_id', dayId)
        .order('match_number'),
    ]);

    if (dayData) setDay(dayData as CompetitionDay);

    if (matchData) {
      const ms = matchData as unknown as MatchWithTeams[];
      setMatches(ms);
      const allIds = [...new Set(ms.flatMap(m => [...m.home_player_ids, ...m.away_player_ids]))];
      if (allIds.length > 0) {
        const { data: players } = await supabase
          .from('players')
          .select('id,display_name,avatar_url')
          .in('id', allIds);
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
    load();
    const sub = supabase
      .channel(`day-${dayId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, load)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [dayId]);

  const live = matches.filter(m => m.status === 'in_progress');
  const upcoming = matches.filter(m => m.status === 'upcoming');
  const complete = matches.filter(m => m.status === 'complete');

  const settings = day ? (() => {
    const isSingles = matches.some(m => m.is_singles);
    return isSingles ? 'Singles Matchplay' : '4BBB Matchplay';
  })() : '';

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.backBtn}
        >
          <Text style={styles.backText}>‹ Tour</Text>
        </TouchableOpacity>
        <Text style={styles.dayTitle}>Day {day?.day_number ?? '—'}</Text>
        <Text style={styles.courseName}>{day?.course_name ?? ''}</Text>
        {settings ? <Text style={styles.format}>{settings}</Text> : null}
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.gold} size="large" /></View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={colors.gold}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {live.length > 0 && (
            <Section label="LIVE" labelColor={colors.live}>
              {live.map(m => <MatchCard key={m.id} match={m} playerNames={playerNames} playerAvatars={playerAvatars} />)}
            </Section>
          )}
          {upcoming.length > 0 && (
            <Section label="UPCOMING">
              {upcoming.map(m => <MatchCard key={m.id} match={m} playerNames={playerNames} playerAvatars={playerAvatars} />)}
            </Section>
          )}
          {complete.length > 0 && (
            <Section label="COMPLETE">
              {complete.map(m => <MatchCard key={m.id} match={m} playerNames={playerNames} playerAvatars={playerAvatars} />)}
            </Section>
          )}
          {matches.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No matches for this day.</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Section({ label, labelColor, children }: { label: string; labelColor?: string; children: React.ReactNode }) {
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

function MatchCard({ match, playerNames, playerAvatars }: { match: MatchWithTeams; playerNames: Record<string, string>; playerAvatars: Record<string, string | null> }) {
  const router = useRouter();
  const winner = getEffectiveWinner(match.status, match.winner, match.holes_string ?? '..................');
  const isStrokePlay = match.round_format === 'stableford' || match.round_format === 'medal';
  const label = isStrokePlay
    ? (match.status === 'complete' ? (match.result_str ?? 'Complete') : match.status === 'upcoming' ? 'Upcoming' : (match.result_str ?? 'In Progress'))
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

  function renderSide(playerIds: string[], logo: any, label: string) {
    if (hasTeam && logo) return <Image source={logo} style={card.teamLogo} resizeMode="contain" />;
    if (match.is_singles) {
      const raw = playerAvatars[playerIds[0]] ?? getPlayerAvatar(playerIds[0], 'normal');
      return raw
        ? <Image source={typeof raw === 'string' ? { uri: raw } : raw} style={card.playerAv} />
        : <View style={[card.playerAv, card.avFallback]}><Text style={card.avInitial}>{label[0]}</Text></View>;
    }
    return (
      <View style={card.pairAvatars}>
        {playerIds.map((id, i) => {
          const raw = playerAvatars[id] ?? getPlayerAvatar(id, 'normal');
          return raw
            ? <Image key={id} source={typeof raw === 'string' ? { uri: raw } : raw} style={[card.pairAv, { marginLeft: i > 0 ? -6 : 0 }]} />
            : <View key={id} style={[card.pairAv, card.avFallback, { marginLeft: i > 0 ? -6 : 0 }]}>
                <Text style={card.avInitialSm}>{firstName(id)[0]}</Text>
              </View>;
        })}
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[card.container, match.status === 'in_progress' && card.containerLive]}
      onPress={() => router.push(`/(app)/score/${match.id}`)}
      activeOpacity={0.75}
    >
      <View style={card.meta}>
        <Text style={card.matchNum}>MATCH {match.match_number}</Text>
        {match.is_singles && <Text style={card.singlesTag}>Singles</Text>}
        {match.status === 'in_progress' && (
          <TouchableOpacity
            style={card.watchBtn}
            onPress={e => { e.stopPropagation?.(); router.push(`/(app)/spectate/${match.id}` as any); }}
            activeOpacity={0.8}
          >
            <Text style={card.watchBtnText}>● Watch Live</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={card.row}>
        <View style={card.side}>
          {renderSide(match.home_player_ids, homeLogo, homeLabel)}
          <Text style={[card.name, homeWon && card.nameWon]} numberOfLines={1}>{homeLabel}</Text>
        </View>
        <View style={[
          card.badge,
          match.status === 'in_progress' && card.badgeLive,
          match.status === 'complete' && card.badgeDone,
        ]}>
          <Text style={[card.badgeText, match.status === 'in_progress' && card.badgeTextLive]}>
            {label}
          </Text>
        </View>
        <View style={[card.side, card.sideRight]}>
          <Text style={[card.name, awayWon && card.nameWon]} numberOfLines={1}>{awayLabel}</Text>
          {renderSide(match.away_player_ids, awayLogo, awayLabel)}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { marginBottom: spacing.sm },
  backText: { fontSize: fonts.sm, color: colors.gold, fontWeight: '600' },
  dayTitle: { fontSize: fonts.xxl, fontWeight: '800', color: colors.white, letterSpacing: 0.5 },
  courseName: { fontSize: fonts.md, color: colors.textSecondary, marginTop: 2 },
  format: { fontSize: fonts.xs, color: colors.textMuted, marginTop: 4, letterSpacing: 0.5 },
  scroll: { padding: spacing.md, paddingBottom: 40 },
  section: { marginBottom: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.xs },
  sectionLabel: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyText: { fontSize: fonts.md, color: colors.textMuted },
});

const card = StyleSheet.create({
  container: {
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  containerLive: { borderColor: 'rgba(239,68,68,0.35)' },
  watchBtn: {
    marginLeft: 'auto' as any,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: radius.sm, borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    paddingHorizontal: spacing.sm, paddingVertical: 2,
  },
  watchBtnText: { fontSize: fonts.xs, fontWeight: '800', color: colors.live, letterSpacing: 0.5 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 8 },
  matchNum: { fontSize: fonts.xs, color: colors.textMuted, fontWeight: '700', letterSpacing: 1 },
  singlesTag: { fontSize: fonts.xs, color: colors.gold, fontWeight: '700', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center' },
  side: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  sideRight: { justifyContent: 'flex-end' },
  teamLogo: { width: 28, height: 28, borderRadius: 4 },
  playerAv: { width: 28, height: 28, borderRadius: 14, overflow: 'hidden' },
  pairAvatars: { flexDirection: 'row' },
  pairAv: { width: 22, height: 22, borderRadius: 11, overflow: 'hidden' },
  avFallback: { backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  avInitial: { fontSize: 11, fontWeight: '700', color: colors.white },
  avInitialSm: { fontSize: 9, fontWeight: '700', color: colors.white },
  name: { fontSize: fonts.md, fontWeight: '600', color: colors.textSecondary, flexShrink: 1 },
  nameWon: { color: colors.white, fontWeight: '700' },
  badge: {
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.sm, backgroundColor: colors.cardAlt,
    minWidth: 70, alignItems: 'center',
  },
  badgeLive: { backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
  badgeDone: { backgroundColor: colors.goldDim, borderWidth: 1, borderColor: colors.goldBorder },
  badgeText: { fontSize: fonts.sm, fontWeight: '700', color: colors.textSecondary },
  badgeTextLive: { color: colors.live },
});
