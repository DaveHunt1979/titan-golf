import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, RefreshControl, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { matchLabel, getEffectiveWinner, calcHoles } from '../../../src/lib/scoring';
import { fonts, spacing, radius } from '../../../src/lib/theme';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { getPlayerAvatar, teamLogos } from '../../../src/lib/assets';

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

export default function WatchScreen() {
  const colors = useDynamicColors();
  const s = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    centered:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
    header: {
      paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg,
      borderBottomWidth: 1, borderBottomColor: colors.border,
      flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    },
    headerSub:   { fontSize: fonts.xs, fontWeight: '700', color: colors.gold, letterSpacing: 2, marginBottom: 4 },
    headerTitle: { fontSize: fonts.xxl, fontWeight: '800', color: colors.white, letterSpacing: 0.5 },
    liveCountPill: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: radius.full,
      borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
      paddingHorizontal: spacing.sm, paddingVertical: 5,
      marginBottom: 2,
    },
    liveDot:       { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.live },
    liveCountText: { fontSize: fonts.xs, fontWeight: '800', color: colors.live, letterSpacing: 1 },
    scroll: { padding: spacing.md, paddingBottom: 48 },
    empty: { alignItems: 'center', paddingTop: 80 },
    emptyIcon:  { fontSize: 52, marginBottom: spacing.md },
    emptyTitle: { fontSize: fonts.xl, fontWeight: '800', color: colors.textSecondary, marginBottom: spacing.xs },
    emptySub:   { fontSize: fonts.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing.xl },
  }), [colors]);

  const router = useRouter();
  const [compName, setCompName]   = useState('');
  const [compId, setCompId]       = useState<string | null>(null);
  const [matches, setMatches]     = useState<MatchRow[]>([]);
  const [players, setPlayers]     = useState<Player[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  const firstName  = (id: string) => (players.find(p => p.id === id)?.display_name ?? '?').split(' ')[0];
  const getAvatar  = (id: string) => players.find(p => p.id === id)?.avatar_url ?? null;
  const live       = matches.filter(m => m.status === 'in_progress');
  const upcoming   = matches.filter(m => m.status === 'upcoming');

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.headerSub}>LIVE BOARD</Text>
          <Text style={s.headerTitle} numberOfLines={1}>{compName || 'No active competition'}</Text>
        </View>
        {live.length > 0 && (
          <View style={s.liveCountPill}>
            <View style={s.liveDot} />
            <Text style={s.liveCountText}>{live.length} LIVE</Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={s.centered}><ActivityIndicator color={colors.gold} size="large" /></View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />}
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
              <SectionLabel label="LIVE NOW" color={colors.live} dot />
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
      )}
    </View>
  );
}

// ── Section label ─────────────────────────────────────────────
function SectionLabel({ label, color, dot }: { label: string; color?: string; dot?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm, marginTop: spacing.xs }}>
      {dot && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color ?? sl.text.color }} />}
      <Text style={[sl.text, color ? { color } : {}]}>{label}</Text>
    </View>
  );
}
const sl = StyleSheet.create({
  text: { fontSize: fonts.xs, fontWeight: '800', color: '#6b7280', letterSpacing: 2 },
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

  const homeColor  = match.home_team?.accent_color ?? '#d4af37';
  const awayColor  = match.away_team?.accent_color ?? '#6366f1';
  const homeLabel  = match.home_team?.name ?? match.home_player_ids.map(firstName).join(' & ');
  const awayLabel  = match.away_team?.name ?? match.away_player_ids.map(firstName).join(' & ');
  const isLive     = status === 'in_progress';

  function renderSide(playerIds: string[], team: { name: string } | null, teamId: string | null, label: string) {
    if (teamId && team) {
      const logo = teamLogos[team.name];
      if (logo) return <Image source={logo} style={mc.logo} resizeMode="contain" />;
    }
    if (match.is_singles && playerIds.length === 1) {
      const raw = getAvatar(playerIds[0]) ?? getPlayerAvatar(playerIds[0], 'normal');
      return raw
        ? <Image source={typeof raw === 'string' ? { uri: raw } : raw} style={mc.avatar} />
        : <View style={[mc.avatar, mc.avatarFallback]}><Text style={mc.avatarInitial}>{label[0]}</Text></View>;
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
          <Text style={[
            mc.statusLabel,
            isLive && { color: '#ef4444' },
          ]}>{label}</Text>
          {isLive && holesPlayed > 0 && (
            <Text style={mc.thru}>THRU {holesPlayed}</Text>
          )}
          {isLive && holesPlayed === 0 && (
            <Text style={mc.thru}>TEE OFF</Text>
          )}
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
            const bg = c === 'h' ? homeColor : c === 'a' ? awayColor : c === 'f' ? '#d4af37' : undefined;
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
    backgroundColor: '#1c1c1e', borderRadius: radius.lg,
    borderWidth: 1, borderColor: '#2c2c2e',
    padding: spacing.md, marginBottom: spacing.md,
  },
  cardLive: { borderColor: 'rgba(239,68,68,0.3)' },
  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md, gap: spacing.sm },
  matchNum: { fontSize: fonts.xs, fontWeight: '700', color: '#6b7280', letterSpacing: 1 },
  dayTag: { fontSize: fonts.xs, color: '#6b7280', flex: 1 },
  watchLink: { fontSize: fonts.xs, fontWeight: '700', color: '#ef4444', letterSpacing: 0.3 },
  teamsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  side: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sideRight: { justifyContent: 'flex-end' },
  logo:   { width: 32, height: 32, borderRadius: 6 },
  avatar: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden' },
  avatarFallback: { backgroundColor: '#2c2c2e', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: fonts.sm, fontWeight: '800', color: '#d4af37' },
  pairRow: { flexDirection: 'row' },
  pairAv:  { width: 26, height: 26, borderRadius: 13, overflow: 'hidden' },
  pairOverlap: { marginLeft: -8 },
  pairInitial: { fontSize: 10, fontWeight: '700', color: '#d4af37' },
  sideName: { flex: 1, fontSize: fonts.md, fontWeight: '800', color: '#9ca3af' },
  sideNameRight: { textAlign: 'right' },
  centre: { alignItems: 'center', paddingHorizontal: spacing.xs, minWidth: 68 },
  statusLabel: { fontSize: fonts.xl, fontWeight: '900', color: '#9ca3af', textAlign: 'center', letterSpacing: 0.5 },
  thru: { fontSize: 9, fontWeight: '700', color: '#6b7280', letterSpacing: 1.5, marginTop: 2 },
  strip: { flexDirection: 'row', gap: 3, marginBottom: spacing.sm },
  dot: { flex: 1, height: 6, borderRadius: 3 },
  dotEmpty: { backgroundColor: '#2c2c2e' },
  dotCurrent: { backgroundColor: '#d4af37', opacity: 0.5 },
  leaderStrip: {
    paddingLeft: spacing.sm, paddingVertical: 4,
    borderRadius: radius.sm, backgroundColor: 'rgba(255,255,255,0.02)',
  },
  leaderText: { fontSize: fonts.xs, fontWeight: '700', color: '#6b7280', letterSpacing: 0.5 },
});
