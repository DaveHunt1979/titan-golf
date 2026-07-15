import { useEffect, useState, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Image, RefreshControl, Animated,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../../src/lib/supabase';
import { matchLabel, getEffectiveWinner } from '../../../../src/lib/scoring';
import { getPlayerAvatar, teamLogos } from '../../../../src/lib/assets';
import type { Match, Team, CompetitionDay } from '../../../../src/types';

const GOLD = '#D4AF37';
const GREEN = '#4ade80';
const RED = '#f87171';
const FF = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';
const titanLogo = require('../../../../assets/TitanAppLogo.png');

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

  const [fontsLoaded] = useFonts({
    [FF]: require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    [FFB]: require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

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

  const formatLabel = day ? (() => {
    const isSingles = matches.some(m => m.is_singles);
    return isSingles ? 'Singles Matchplay' : '4BBB Matchplay';
  })() : '';

  if (loading || !fontsLoaded) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="light" />
        <ActivityIndicator color={GOLD} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={26} color={GOLD} />
          </TouchableOpacity>

          <View style={styles.headerCentre}>
            <Image source={titanLogo} style={styles.logo} resizeMode="contain" />
            <Text style={styles.headerSub}>DAY {day?.day_number ?? '—'}</Text>
          </View>

          <View style={styles.headerRight} />
        </View>

        {day?.course_name ? (
          <Text style={styles.courseName}>{day.course_name}</Text>
        ) : null}
        {formatLabel ? (
          <Text style={styles.formatSub}>{formatLabel}</Text>
        ) : null}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={GOLD}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {live.length > 0 && (
          <Section label="LIVE" variant="live">
            {live.map(m => (
              <MatchCard
                key={m.id}
                match={m}
                playerNames={playerNames}
                playerAvatars={playerAvatars}
              />
            ))}
          </Section>
        )}
        {upcoming.length > 0 && (
          <Section label="UPCOMING" variant="upcoming">
            {upcoming.map(m => (
              <MatchCard
                key={m.id}
                match={m}
                playerNames={playerNames}
                playerAvatars={playerAvatars}
              />
            ))}
          </Section>
        )}
        {complete.length > 0 && (
          <Section label="COMPLETE" variant="complete">
            {complete.map(m => (
              <MatchCard
                key={m.id}
                match={m}
                playerNames={playerNames}
                playerAvatars={playerAvatars}
              />
            ))}
          </Section>
        )}
        {matches.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No matches for this day.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function LiveDot() {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.2, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);

  return (
    <Animated.View style={[styles.liveDot, { opacity }]} />
  );
}

function Section({
  label,
  variant,
  children,
}: {
  label: string;
  variant: 'live' | 'upcoming' | 'complete';
  children: React.ReactNode;
}) {
  const isLive = variant === 'live';
  const isComplete = variant === 'complete';
  const labelColor = isLive ? GREEN : isComplete ? GOLD : '#555';

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        {isLive && <LiveDot />}
        <Text style={[styles.sectionLabel, { color: labelColor }]}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

function MatchCard({
  match,
  playerNames,
  playerAvatars,
}: {
  match: MatchWithTeams;
  playerNames: Record<string, string>;
  playerAvatars: Record<string, string | null>;
}) {
  const router = useRouter();
  const isLive = match.status === 'in_progress';
  const isComplete = match.status === 'complete';

  const winner = getEffectiveWinner(match.status, match.winner, match.holes_string ?? '..................');
  const isStrokePlay = match.round_format === 'stableford' || match.round_format === 'medal';
  const label = isStrokePlay
    ? (isComplete ? (match.result_str ?? 'Complete') : match.status === 'upcoming' ? 'Upcoming' : (match.result_str ?? 'In Progress'))
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

  function renderSide(playerIds: string[], logo: any, sideLabel: string) {
    if (hasTeam && logo) return <Image source={logo} style={card.teamLogo} resizeMode="contain" />;
    if (match.is_singles) {
      const raw = playerAvatars[playerIds[0]] ?? getPlayerAvatar(playerIds[0], 'normal');
      return raw
        ? <Image source={typeof raw === 'string' ? { uri: raw } : raw} style={card.playerAv} />
        : (
          <View style={[card.playerAv, card.avFallback]}>
            <Text style={card.avInitial}>{sideLabel[0]}</Text>
          </View>
        );
    }
    return (
      <View style={card.pairAvatars}>
        {playerIds.map((id, i) => {
          const raw = playerAvatars[id] ?? getPlayerAvatar(id, 'normal');
          return raw
            ? <Image key={id} source={typeof raw === 'string' ? { uri: raw } : raw} style={[card.pairAv, { marginLeft: i > 0 ? -6 : 0 }]} />
            : (
              <View key={id} style={[card.pairAv, card.avFallback, { marginLeft: i > 0 ? -6 : 0 }]}>
                <Text style={card.avInitialSm}>{firstName(id)[0]}</Text>
              </View>
            );
        })}
      </View>
    );
  }

  const cardBorder = isLive
    ? 'rgba(239,68,68,0.35)'
    : isComplete
      ? `${GOLD}30`
      : '#1c1c1c';

  return (
    <TouchableOpacity
      style={[card.container, { borderColor: cardBorder }]}
      onPress={() => router.push(`/(app)/score/${match.id}`)}
      activeOpacity={0.75}
    >
      {/* Top meta row */}
      <View style={card.meta}>
        <Text style={card.matchNum}>MATCH {match.match_number}</Text>
        {match.is_singles && (
          <View style={card.singlesTag}>
            <Text style={card.singlesTagText}>SINGLES</Text>
          </View>
        )}
        {isLive && (
          <TouchableOpacity
            style={card.watchBtn}
            onPress={e => { e.stopPropagation?.(); router.push(`/(app)/spectate/${match.id}` as any); }}
            activeOpacity={0.8}
          >
            <Text style={card.watchBtnText}>● WATCH LIVE</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Main row: home | badge | away */}
      <View style={card.row}>
        {/* Home side */}
        <View style={card.side}>
          {renderSide(match.home_player_ids, homeLogo, homeLabel)}
          <Text
            style={[card.name, homeWon ? card.nameWon : card.nameLost]}
            numberOfLines={1}
          >
            {homeLabel}
          </Text>
        </View>

        {/* Centre badge */}
        <View style={[
          card.badge,
          isLive && card.badgeLive,
          isComplete && card.badgeDone,
        ]}>
          <Text style={[
            card.badgeText,
            isLive && card.badgeTextLive,
            isComplete && card.badgeTextDone,
          ]}>
            {label}
          </Text>
        </View>

        {/* Away side */}
        <View style={[card.side, card.sideRight]}>
          <Text
            style={[card.name, awayWon ? card.nameWon : card.nameLost]}
            numberOfLines={1}
          >
            {awayLabel}
          </Text>
          {renderSide(match.away_player_ids, awayLogo, awayLabel)}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1c',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    width: 44,
    alignItems: 'flex-start',
  },
  headerCentre: {
    flex: 1,
    alignItems: 'center',
  },
  logo: {
    width: 90,
    height: 28,
  },
  headerSub: {
    fontFamily: FFB,
    fontSize: 11,
    color: GOLD,
    letterSpacing: 3,
    marginTop: 2,
  },
  headerRight: {
    width: 44,
  },
  courseName: {
    fontFamily: FFB,
    fontSize: 16,
    color: '#fff',
    textAlign: 'center',
    marginTop: 10,
  },
  formatSub: {
    fontFamily: FFB,
    fontSize: 11,
    color: '#fff',
    textAlign: 'center',
    marginTop: 3,
    letterSpacing: 0.5,
  },
  scroll: {
    padding: 16,
    paddingBottom: 48,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  sectionLabel: {
    fontFamily: FFB,
    fontSize: 10,
    letterSpacing: 2,
    color: '#fff',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: GREEN,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontFamily: FFB,
    fontSize: 15,
    color: '#fff',
  },
});

const card = StyleSheet.create({
  container: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1c1c1c',
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  matchNum: {
    fontFamily: FFB,
    fontSize: 10,
    color: '#fff',
    letterSpacing: 1,
  },
  singlesTag: {
    backgroundColor: 'rgba(212,175,55,0.12)',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: `${GOLD}40`,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  singlesTagText: {
    fontFamily: FFB,
    fontSize: 9,
    color: GOLD,
    letterSpacing: 1,
  },
  watchBtn: {
    marginLeft: 'auto' as any,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  watchBtnText: {
    fontFamily: FFB,
    fontSize: 9,
    color: RED,
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  side: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sideRight: {
    justifyContent: 'flex-end',
  },
  teamLogo: {
    width: 28,
    height: 28,
    borderRadius: 4,
  },
  playerAv: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
  },
  pairAvatars: {
    flexDirection: 'row',
  },
  pairAv: {
    width: 22,
    height: 22,
    borderRadius: 11,
    overflow: 'hidden',
  },
  avFallback: {
    backgroundColor: '#1c1c1c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avInitial: {
    fontFamily: FFB,
    fontSize: 11,
    color: '#fff',
  },
  avInitialSm: {
    fontFamily: FFB,
    fontSize: 9,
    color: '#fff',
  },
  name: {
    fontFamily: FFB,
    fontSize: 14,
    flexShrink: 1,
  },
  nameWon: {
    fontFamily: FFB,
    color: '#fff',
  },
  nameLost: {
    color: '#fff',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: '#1c1c1c',
    minWidth: 70,
    alignItems: 'center',
    marginHorizontal: 6,
  },
  badgeLive: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
  },
  badgeDone: {
    backgroundColor: `${GOLD}15`,
    borderWidth: 1,
    borderColor: `${GOLD}40`,
  },
  badgeText: {
    fontFamily: FFB,
    fontSize: 12,
    color: '#999',
  },
  badgeTextLive: {
    color: RED,
  },
  badgeTextDone: {
    color: GOLD,
  },
});
