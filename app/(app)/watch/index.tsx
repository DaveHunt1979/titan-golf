import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, RefreshControl, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { matchLabel, getEffectiveWinner, calcHoles } from '../../../src/lib/scoring';
import { getPlayerAvatar, teamLogos } from '../../../src/lib/assets';

// ── TITAN constants ───────────────────────────────────────────
const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

// ── Types ─────────────────────────────────────────────────────
interface CompDay { day_number: number; course_name: string | null; }
interface MatchRow {
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
  home_team: { name: string; accent_color: string } | null;
  away_team: { name: string; accent_color: string } | null;
  day: CompDay | null;
}
interface Player { id: string; display_name: string; avatar_url?: string | null; }

// ── Screen ────────────────────────────────────────────────────
export default function WatchScreen() {
  const router = useRouter();
  const [compName, setCompName]     = useState('');
  const [compId, setCompId]         = useState<string | null>(null);
  const [matches, setMatches]       = useState<MatchRow[]>([]);
  const [players, setPlayers]       = useState<Player[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  const load = useCallback(async () => {
    const { data: comp } = await supabase
      .from('competitions')
      .select('id, name')
      .eq('status', 'active')
      .neq('format', 'casual')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!comp) { setLoading(false); setRefreshing(false); return; }
    setCompName(comp.name);
    setCompId(comp.id);

    const { data: matchData } = await supabase
      .from('matches')
      .select('*, home_team:home_team_id(name,accent_color), away_team:away_team_id(name,accent_color), day:day_id(day_number,course_name)')
      .eq('competition_id', comp.id)
      .neq('status', 'complete')
      .order('match_number');

    const ms = (matchData ?? []) as unknown as MatchRow[];
    setMatches(ms.sort((a, b) => {
      const order = { in_progress: 0, upcoming: 1, complete: 2 };
      return (order[a.status] ?? 2) - (order[b.status] ?? 2);
    }));

    const allIds = [...new Set(ms.flatMap(m => [...m.home_player_ids, ...m.away_player_ids]))];
    if (allIds.length > 0) {
      const { data: pd } = await supabase.from('players').select('id,display_name,avatar_url').in('id', allIds);
      if (pd) setPlayers(pd);
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
    const sub = supabase
      .channel('watch-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, load)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [load]);

  const firstName = (id: string) => (players.find(p => p.id === id)?.display_name ?? '?').split(' ')[0];
  const getAvatar = (id: string) => players.find(p => p.id === id)?.avatar_url ?? null;
  const live      = matches.filter(m => m.status === 'in_progress');
  const upcoming  = matches.filter(m => m.status === 'upcoming');

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerBack}>
          <Text style={s.headerBackText}>‹ Back</Text>
        </TouchableOpacity>
        <View style={s.headerCentre}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerSub}>APPLE WATCH</Text>
        </View>
        <View style={s.headerSpacer} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={GOLD} />}
        showsVerticalScrollIndicator={false}
      >
        {matches.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>⛳</Text>
            <Text style={s.emptyTitle}>{compName ? 'No matches yet' : 'No active competition'}</Text>
            <Text style={s.emptySub}>
              {compName
                ? 'Matches will appear here once the draw is generated.'
                : 'Check back once a tournament is underway.'}
            </Text>
          </View>
        )}

        {live.length > 0 && (
          <>
            <SectionLabel label="LIVE NOW" color={RED} dot />
            {live.map(m => (
              <MatchCard key={m.id} match={m} firstName={firstName} getAvatar={getAvatar} onWatch={() => router.push(`/(app)/spectate/${m.id}` as any)} />
            ))}
          </>
        )}

        {upcoming.length > 0 && (
          <>
            <SectionLabel label="UP NEXT" />
            {upcoming.map(m => (
              <MatchCard key={m.id} match={m} firstName={firstName} getAvatar={getAvatar} onWatch={() => router.push(`/(app)/spectate/${m.id}` as any)} />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
  },
  headerBack:     { flex: 1, alignItems: 'flex-start' },
  headerBackText: { fontFamily: FFB, fontSize: 15, color: GOLD },
  headerCentre:   { alignItems: 'center', gap: 4 },
  headerLogo:     { width: 28, height: 28 },
  headerSub:      { fontFamily: FF, fontSize: 9, color: '#555', letterSpacing: 1 },
  headerSpacer:   { flex: 1 },
  scroll:  { padding: 16, paddingBottom: 48 },
  empty:   { alignItems: 'center', paddingTop: 80 },
  emptyIcon:  { fontSize: 52, marginBottom: 12 },
  emptyTitle: { fontFamily: FFB, fontSize: 18, color: '#555', marginBottom: 6 },
  emptySub:   { fontFamily: FF, fontSize: 14, color: '#3a3a3a', textAlign: 'center', lineHeight: 20, paddingHorizontal: 24 },
});

// ── Section label ─────────────────────────────────────────────
function SectionLabel({ label, color, dot }: { label: string; color?: string; dot?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, marginTop: 4 }}>
      {dot && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color ?? '#6b7280' }} />}
      <Text style={[sl.text, color ? { color } : {}]}>{label}</Text>
    </View>
  );
}
const sl = StyleSheet.create({
  text: { fontFamily: FFB, fontSize: 11, color: '#6b7280', letterSpacing: 2 },
});

// ── Match card ────────────────────────────────────────────────
function MatchCard({ match, firstName, getAvatar, onWatch }: {
  match: MatchRow;
  firstName: (id: string) => string;
  getAvatar: (id: string) => string | null;
  onWatch: () => void;
}) {
  const holesStr    = match.holes_string ?? '..................';
  const holeChars   = holesStr.split('');
  const { homeUp }  = calcHoles(holesStr);
  const holesPlayed = holeChars.filter(c => c !== '.').length;
  const status      = match.status;
  const winner      = getEffectiveWinner(status, match.winner, holesStr);
  const label       = matchLabel(status, match.winner, match.result_str, holesStr);
  const aheadSide   = status === 'complete' ? winner : homeUp > 0 ? 'home' : homeUp < 0 ? 'away' : null;

  const homeColor = match.home_team?.accent_color ?? GOLD;
  const awayColor = match.away_team?.accent_color ?? '#6366f1';
  const homeLabel = match.home_team?.name ?? match.home_player_ids.map(firstName).join(' & ');
  const awayLabel = match.away_team?.name ?? match.away_player_ids.map(firstName).join(' & ');
  const isLive    = status === 'in_progress';

  function renderSide(playerIds: string[], team: { name: string } | null, teamId: string | null, sideLabel: string) {
    if (teamId && team) {
      const logo = teamLogos[team.name];
      if (logo) return <Image source={logo} style={mc.logo} resizeMode="contain" />;
    }
    if (match.is_singles && playerIds.length === 1) {
      const raw = getAvatar(playerIds[0]) ?? getPlayerAvatar(playerIds[0], 'normal');
      return raw
        ? <Image source={typeof raw === 'string' ? { uri: raw } : raw} style={mc.avatar} />
        : <View style={[mc.avatar, mc.avatarFallback]}><Text style={mc.avatarInitial}>{sideLabel[0]}</Text></View>;
    }
    return (
      <View style={mc.pairRow}>
        {playerIds.map((id, i) => {
          const raw = getAvatar(id) ?? getPlayerAvatar(id, 'normal');
          return raw
            ? <Image key={id} source={typeof raw === 'string' ? { uri: raw } : raw} style={[mc.pairAv, i > 0 && mc.pairOverlap]} />
            : <View key={id} style={[mc.pairAv, mc.avatarFallback, i > 0 && mc.pairOverlap]}><Text style={mc.pairInitial}>{firstName(id)[0]}</Text></View>;
        })}
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[mc.card, isLive && mc.cardLive]}
      onPress={onWatch}
      activeOpacity={0.8}
    >
      {/* Top bar */}
      <View style={mc.topBar}>
        <Text style={mc.matchNum}>MATCH {match.match_number}{match.is_singles ? ' · SINGLES' : ''}</Text>
        {match.day && <Text style={mc.dayTag}>DAY {match.day.day_number}{match.day.course_name ? ` · ${match.day.course_name}` : ''}</Text>}
        {isLive && <Text style={mc.watchLink}>Watch Live →</Text>}
      </View>

      {/* Teams row */}
      <View style={mc.teamsRow}>
        {/* Home */}
        <View style={mc.side}>
          {renderSide(match.home_player_ids, match.home_team, match.home_team_id, homeLabel)}
          <Text style={[mc.sideName, aheadSide === 'home' && { color: '#ffffff' }]} numberOfLines={1}>
            {homeLabel}
          </Text>
        </View>

        {/* Status */}
        <View style={mc.centre}>
          <Text style={[mc.statusLabel, isLive && { color: RED }]}>{label}</Text>
          {isLive && holesPlayed > 0 && <Text style={mc.thru}>THRU {holesPlayed}</Text>}
          {isLive && holesPlayed === 0 && <Text style={mc.thru}>TEE OFF</Text>}
        </View>

        {/* Away */}
        <View style={[mc.side, mc.sideRight]}>
          <Text style={[mc.sideName, mc.sideNameRight, aheadSide === 'away' && { color: '#ffffff' }]} numberOfLines={1}>
            {awayLabel}
          </Text>
          {renderSide(match.away_player_ids, match.away_team, match.away_team_id, awayLabel)}
        </View>
      </View>

      {/* Hole progress strip */}
      {isLive && (
        <View style={mc.strip}>
          {holeChars.map((c, i) => {
            const isCurrent = i + 1 === holesPlayed + 1 && holesPlayed < 18;
            const bg = c === 'h' ? homeColor : c === 'a' ? awayColor : c === 'f' ? GOLD : undefined;
            return (
              <View
                key={i}
                style={[
                  mc.dot,
                  bg ? { backgroundColor: bg } : mc.dotEmpty,
                  isCurrent && mc.dotCurrent,
                ]}
              />
            );
          })}
        </View>
      )}

      {/* Leader strip */}
      {isLive && aheadSide && (
        <View style={[mc.leaderStrip, { borderLeftColor: aheadSide === 'home' ? homeColor : awayColor, borderLeftWidth: 3 }]}>
          <Text style={[mc.leaderText, { color: aheadSide === 'home' ? homeColor : awayColor }]}>
            {aheadSide === 'home' ? `◀ ${homeLabel} lead` : `${awayLabel} lead ▶`}
          </Text>
        </View>
      )}
      {isLive && !aheadSide && holesPlayed > 0 && (
        <View style={mc.leaderStrip}>
          <Text style={mc.leaderText}>— All Square —</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const mc = StyleSheet.create({
  card: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c',
    padding: 16, marginBottom: 16,
  },
  cardLive: { borderColor: 'rgba(248,113,113,0.3)' },
  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 8 },
  matchNum:  { fontFamily: FFB, fontSize: 11, color: '#6b7280', letterSpacing: 1 },
  dayTag:    { fontFamily: FF, fontSize: 11, color: '#6b7280', flex: 1 },
  watchLink: { fontFamily: FFB, fontSize: 11, color: RED, letterSpacing: 0.3 },
  teamsRow:  { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  side:      { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sideRight: { justifyContent: 'flex-end' },
  logo:      { width: 32, height: 32, borderRadius: 6 },
  avatar:    { width: 32, height: 32, borderRadius: 16, overflow: 'hidden' },
  avatarFallback: { backgroundColor: '#1c1c1c', alignItems: 'center', justifyContent: 'center' },
  avatarInitial:  { fontFamily: FFB, fontSize: 13, color: GOLD },
  pairRow:    { flexDirection: 'row' },
  pairAv:     { width: 26, height: 26, borderRadius: 13, overflow: 'hidden' },
  pairOverlap:{ marginLeft: -8 },
  pairInitial:{ fontFamily: FFB, fontSize: 10, color: GOLD },
  sideName:      { flex: 1, fontFamily: FFB, fontSize: 14, color: '#9ca3af' },
  sideNameRight: { textAlign: 'right' },
  centre:      { alignItems: 'center', paddingHorizontal: 6, minWidth: 68 },
  statusLabel: { fontFamily: FFB, fontSize: 18, color: '#9ca3af', textAlign: 'center', letterSpacing: 0.5 },
  thru:        { fontFamily: FFB, fontSize: 9, color: '#6b7280', letterSpacing: 1.5, marginTop: 2 },
  strip:    { flexDirection: 'row', gap: 3, marginBottom: 10 },
  dot:      { flex: 1, height: 6, borderRadius: 3 },
  dotEmpty: { backgroundColor: '#1c1c1c' },
  dotCurrent: { backgroundColor: GOLD, opacity: 0.5 },
  leaderStrip: {
    paddingLeft: 8, paddingVertical: 4,
    borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.02)',
  },
  leaderText: { fontFamily: FFB, fontSize: 11, color: '#6b7280', letterSpacing: 0.5 },
});
