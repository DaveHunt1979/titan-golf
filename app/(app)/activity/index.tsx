// Recent Activity (Dave, 2026-09-28) — every society member's completed
// rounds this calendar month in one feed: casual, tournament AND Swindle.
// Read-only; tapping a row opens the existing Swindle results screen for a
// Swindle game, or the new activity/[matchId] scorecard for a
// casual/tournament round.
import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Image, RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase, fetchAllRows } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { resolveAvatar, titanLogo } from '../../../src/lib/assets';
import { goBack } from '../../../src/lib/navigation';

const GOLD = '#D4AF37';
const FF   = 'JUSTSans';
const FFB  = 'JUSTSans-ExBold';

const FORMAT_LABELS: Record<string, string> = {
  matchplay:       'Match Play',
  stableford:      'Stableford',
  medal:           'Medal',
  team_stableford: 'Team Stableford',
};

interface ActivityRow {
  key: string;
  kind: 'match' | 'swindle';
  id: string;
  courseName: string;
  playedAt: string;
  formatLabel: string;
  playerIds: string[];
}

interface PlayerInfo { display_name: string; avatar_url: string | null; }

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function ActivityScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { societyId, localLogo, logoUrl } = useSocietyTheme();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [players, setPlayers] = useState<Record<string, PlayerInfo>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const load = useCallback(async () => {
    if (!societyId) { setRows([]); setLoading(false); setRefreshing(false); return; }
    // Current calendar month in the device's own timezone — 1st at 00:00
    // local through now. Nothing else in this app does timezone gymnastics
    // and a round is always "played" on the local day it happened.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const { data: memberRows } = await supabase
      .from('society_members').select('player_id').eq('society_id', societyId);
    const memberIds = new Set(((memberRows ?? []) as any[]).map(r => r.player_id as string));
    if (memberIds.size === 0) { setRows([]); setLoading(false); setRefreshing(false); return; }

    // ── Casual + tournament rounds ──────────────────────────────────────
    // course_name lives on competition_days, not matches. Admin > Simulate
    // test tournaments (is_simulation) are excluded for the same reason
    // Season ingestion excludes them (seasonRoundIngestion.ts:107-118) —
    // they reuse real members' accounts and would otherwise look like real
    // rounds here.
    const matchRows = await fetchAllRows<any>((from, to) => supabase
      .from('matches')
      .select('id, status, completed_at, home_player_ids, away_player_ids, round_format, day_id, competition_days(course_name, competition:competition_id(is_simulation))')
      .eq('status', 'complete')
      .gte('completed_at', monthStart)
      .range(from, to));

    const matchActivity: ActivityRow[] = [];
    for (const m of matchRows) {
      if (m.competition_days?.competition?.is_simulation) continue;
      const courseName = m.competition_days?.course_name ?? null;
      if (!courseName || !m.completed_at) continue;
      const ids = [...new Set<string>([...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])])];
      if (!ids.some(id => memberIds.has(id))) continue;
      matchActivity.push({
        key: `match:${m.id}`, kind: 'match', id: m.id,
        courseName, playedAt: m.completed_at,
        formatLabel: FORMAT_LABELS[m.round_format] ?? 'Round',
        playerIds: ids,
      });
    }

    // ── Swindle rounds ──────────────────────────────────────────────────
    // Same swindle_games → swindle_groups → swindle_group_players join
    // seasonRoundIngestion's resolveSwindleSources uses, minus the
    // guest-exclusion rules — this screen shows activity, not season
    // eligibility, so a game only has to contain one society member.
    const gameRows = await fetchAllRows<any>((from, to) => supabase
      .from('swindle_games')
      .select('id, course_name, game_date, status')
      .eq('status', 'complete')
      .gte('game_date', monthStart)
      .range(from, to));

    const swindleActivity: ActivityRow[] = [];
    const gameIds = gameRows.map(g => g.id as string);
    if (gameIds.length) {
      const groupRows = await fetchAllRows<any>((from, to) => supabase
        .from('swindle_groups').select('id, game_id').in('game_id', gameIds).range(from, to));
      const gameByGroup = new Map<string, string>(groupRows.map(g => [g.id as string, g.game_id as string]));
      const groupIds = groupRows.map(g => g.id as string);
      const groupPlayerRows = groupIds.length
        ? await fetchAllRows<any>((from, to) => supabase
            .from('swindle_group_players').select('group_id, player_id, is_guest').in('group_id', groupIds).range(from, to))
        : [];

      const playersByGame: Record<string, Set<string>> = {};
      for (const r of groupPlayerRows) {
        if (r.is_guest || !r.player_id) continue;
        const gameId = gameByGroup.get(r.group_id);
        if (!gameId) continue;
        (playersByGame[gameId] ??= new Set<string>()).add(r.player_id);
      }

      for (const g of gameRows) {
        const ids = [...(playersByGame[g.id] ?? [])];
        if (!ids.some(id => memberIds.has(id))) continue;
        if (!g.game_date) continue;
        swindleActivity.push({
          key: `swindle:${g.id}`, kind: 'swindle', id: g.id,
          courseName: g.course_name ?? 'Swindle', playedAt: g.game_date,
          formatLabel: 'Swindle', playerIds: ids,
        });
      }
    }

    const all = [...matchActivity, ...swindleActivity]
      .sort((a, b) => new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime());

    const allIds = [...new Set(all.flatMap(r => r.playerIds))];
    if (allIds.length) {
      const playerRows = await fetchAllRows<any>((from, to) => supabase
        .from('players').select('id, display_name, avatar_url').in('id', allIds).range(from, to));
      const byId: Record<string, PlayerInfo> = {};
      for (const p of playerRows) byId[p.id] = { display_name: p.display_name ?? 'Unknown', avatar_url: p.avatar_url ?? null };
      setPlayers(byId);
    }

    setRows(all);
    setLoading(false);
    setRefreshing(false);
  }, [societyId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!fontsLoaded) return <View style={[s.container, { backgroundColor: dc.bg }]} />;

  function open(row: ActivityRow) {
    if (row.kind === 'swindle') router.push(`/(app)/swindle/${row.id}` as any);
    else router.push(`/(app)/activity/${row.id}` as any);
  }

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />
      <View style={[s.header, { borderBottomColor: dc.border }]}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={[s.back, { color: dc.gold }]}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)} style={s.headerLogo} resizeMode="contain" />
          <Text style={[s.headerSub, { color: dc.gold }]}>RECENT ACTIVITY</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={s.centered}><ActivityIndicator color={GOLD} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={GOLD} />}
        >
          {rows.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>⛳</Text>
              <Text style={[s.emptyTitle, { color: dc.cardText }]}>No rounds yet this month</Text>
              <Text style={s.emptySub}>Completed rounds — casual, tournament or Swindle — will appear here as members finish them.</Text>
            </View>
          ) : (
            <>
              <Text style={s.sectionLabel}>{rows.length} ROUND{rows.length === 1 ? '' : 'S'} THIS MONTH</Text>
              {rows.map(row => {
                const shown = row.playerIds.slice(0, 3);
                const extra = row.playerIds.length - shown.length;
                return (
                  <TouchableOpacity
                    key={row.key}
                    style={[s.card, { backgroundColor: dc.card, borderColor: dc.border }]}
                    onPress={() => open(row)}
                    activeOpacity={0.85}
                  >
                    <View style={s.cardTop}>
                      <Text style={[s.cardCourse, { color: dc.cardText }]} numberOfLines={1}>{row.courseName}</Text>
                      <Text style={s.cardDate}>{formatDate(row.playedAt)}</Text>
                    </View>
                    <Text style={[s.cardFormat, { color: dc.gold }]}>{row.formatLabel.toUpperCase()}</Text>
                    <View style={s.cardPlayers}>
                      {shown.map(id => {
                        const info = players[id];
                        const src = resolveAvatar(id, info?.avatar_url);
                        const name = (info?.display_name ?? 'Unknown').split(' ')[0];
                        return (
                          <View key={id} style={s.playerChip}>
                            {src
                              ? <Image source={src} style={s.playerAvatar} />
                              : <View style={[s.playerAvatar, s.playerAvatarFallback]}>
                                  <Text style={s.playerInitial}>{name[0] ?? '?'}</Text>
                                </View>}
                            <Text style={s.playerName} numberOfLines={1}>{name}</Text>
                          </View>
                        );
                      })}
                      {extra > 0 && <Text style={s.playerMore}>+{extra} more</Text>}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerCenter: { alignItems: 'center' },
  headerLogo:   { width: 36, height: 36 },
  headerSub:    { fontFamily: FFB, fontSize: 10, letterSpacing: 2, marginTop: 2 },
  back:         { fontFamily: FFB, fontSize: 14 },

  scroll: { padding: 20, paddingBottom: 60 },
  sectionLabel: { fontFamily: FFB, fontSize: 11, color: GOLD, letterSpacing: 2, marginBottom: 10 },

  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10 },
  cardTop:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardCourse: { flex: 1, fontFamily: FFB, fontSize: 15 },
  cardDate:   { fontFamily: FFB, fontSize: 11, color: '#888' },
  cardFormat: { fontFamily: FFB, fontSize: 10, letterSpacing: 1.5, marginTop: 4 },
  cardPlayers: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  playerChip:  { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 120 },
  playerAvatar: { width: 22, height: 22, borderRadius: 11 },
  playerAvatarFallback: { backgroundColor: '#1c1c1e', alignItems: 'center', justifyContent: 'center' },
  playerInitial: { fontFamily: FFB, fontSize: 10, color: GOLD },
  playerName:  { fontFamily: FF, fontSize: 12, color: '#888' },
  playerMore:  { fontFamily: FFB, fontSize: 11, color: '#666' },

  empty:      { alignItems: 'center', paddingTop: 80 },
  emptyIcon:  { fontSize: 52, marginBottom: 12 },
  emptyTitle: { fontFamily: FFB, fontSize: 18, color: '#fff', marginBottom: 6 },
  emptySub:   { fontFamily: FFB, fontSize: 14, color: '#3a3a3a', textAlign: 'center', lineHeight: 20, paddingHorizontal: 24 },
});
