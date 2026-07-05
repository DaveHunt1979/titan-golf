import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Share, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../../src/lib/theme';

type DayInfo = { id: string; join_code: string; course_name: string; course_par: number; day_date: string };
type PlayerRow = { player_id: string; name: string; match_id: string; pts: number; holes: number; hcp: number };
type GroupRow = { match_id: string; format: string; player_names: string[] };

export default function DayLobby() {
  const { dayId }  = useLocalSearchParams<{ dayId: string }>();
  const router     = useRouter();
  const [day,        setDay]        = useState<DayInfo | null>(null);
  const [players,    setPlayers]    = useState<PlayerRow[]>([]);
  const [groups,     setGroups]     = useState<GroupRow[]>([]);
  const [myId,       setMyId]       = useState<string | null>(null);
  const [myMatchId,  setMyMatchId]  = useState<string | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { init(); }, [dayId]);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: p } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (p) setMyId(p.id);
    }
    await load();
  }

  const load = useCallback(async () => {
    const { data: dayData } = await supabase
      .from('competition_days').select('id,join_code,course_name,course_par,day_date').eq('id', dayId).single();
    if (!dayData) { setLoading(false); setRefreshing(false); return; }
    setDay(dayData as DayInfo);

    const { data: matches } = await supabase
      .from('matches')
      .select('id,home_player_ids,away_player_ids,round_format,hcp_allowance')
      .eq('day_id', dayId)
      .neq('status', 'cancelled');

    if (!matches) { setLoading(false); setRefreshing(false); return; }

    const allPlayerIds = [...new Set((matches as any[]).flatMap(m => [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])]))];

    const [{ data: playersData }, { data: holesData }, { data: courseHolesData }] = await Promise.all([
      allPlayerIds.length ? supabase.from('players').select('id,display_name,handicap_index').in('id', allPlayerIds) : Promise.resolve({ data: [] }),
      supabase.from('match_holes').select('match_id,player_id,stableford_pts,gross_score,hole_number').in('match_id', (matches as any[]).map(m => m.id)),
      supabase.from('course_holes').select('hole_number,par,stroke_index').eq('course_name', dayData.course_name).order('hole_number'),
    ]);

    const playerMap: Record<string, { name: string; hcp: number }> = {};
    for (const p of (playersData ?? []) as any[]) {
      playerMap[p.id] = { name: p.display_name, hcp: p.handicap_index ?? 0 };
    }

    const holesByPlayer: Record<string, { pts: number; count: number }> = {};
    for (const h of (holesData ?? []) as any[]) {
      if (!holesByPlayer[h.player_id]) holesByPlayer[h.player_id] = { pts: 0, count: 0 };
      holesByPlayer[h.player_id].pts   += h.stableford_pts ?? 0;
      holesByPlayer[h.player_id].count += 1;
    }

    // Determine which match each player belongs to
    const playerMatchMap: Record<string, string> = {};
    for (const m of (matches as any[])) {
      for (const id of [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])]) {
        playerMatchMap[id] = m.id;
      }
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: myPlayer } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (myPlayer) setMyMatchId(playerMatchMap[myPlayer.id] ?? null);
    }

    const rows: PlayerRow[] = allPlayerIds.map(id => ({
      player_id: id,
      name:      playerMap[id]?.name ?? 'Unknown',
      match_id:  playerMatchMap[id] ?? '',
      hcp:       playerMap[id]?.hcp ?? 0,
      pts:       holesByPlayer[id]?.pts ?? 0,
      holes:     holesByPlayer[id]?.count ?? 0,
    })).sort((a, b) => b.pts - a.pts || b.holes - a.holes);

    const grps: GroupRow[] = (matches as any[]).map(m => ({
      match_id:     m.id,
      format:       m.round_format ?? 'stableford',
      player_names: [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])]
        .map(id => playerMap[id]?.name?.split(' ')[0] ?? '?'),
    }));

    setPlayers(rows);
    setGroups(grps);
    setLoading(false);
    setRefreshing(false);
  }, [dayId]);

  function shareCode() {
    if (!day) return;
    Share.share({ message: `Join our game at ${day.course_name}!\nEnter code ${day.join_code} in Titan Golf → Score tab → Join Game Day` });
  }

  if (loading || !day) {
    return <View style={s.container}><ActivityIndicator color={colors.gold} style={{ marginTop: 80 }} /></View>;
  }

  const myMatch = myMatchId;
  const dateStr = new Date(day.day_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.backText}>← Back</Text></TouchableOpacity>
        <TouchableOpacity style={s.shareBtn} onPress={shareCode}>
          <Text style={s.shareBtnText}>Share Code</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />}
      >
        {/* Day info card */}
        <View style={s.dayCard}>
          <Text style={s.course}>{day.course_name}</Text>
          <Text style={s.dateStr}>{dateStr}</Text>
          <View style={s.codeRow}>
            <View style={s.codeBox}>
              <Text style={s.codeLabel}>DAY CODE</Text>
              <Text style={s.code}>{day.join_code}</Text>
            </View>
            <Text style={s.codeHint}>Share this code with other groups{'\n'}so they can join the leaderboard</Text>
          </View>
        </View>

        {/* Combined leaderboard */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>COMBINED LEADERBOARD  ·  {players.length} PLAYERS</Text>
          {players.length === 0 ? (
            <Text style={s.empty}>No scores yet — get playing!</Text>
          ) : (
            players.map((p, rank) => {
              const isMe = p.player_id === myId;
              return (
                <View key={p.player_id} style={[s.lbRow, isMe && s.lbRowMe]}>
                  <Text style={[s.lbRank, rank === 0 && s.lbRankGold]}>{rank + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.lbName, isMe && s.lbNameMe]}>{p.name.split(' ')[0]}{isMe ? ' (you)' : ''}</Text>
                    <Text style={s.lbSub}>{p.holes} holes · hcp {p.hcp.toFixed(0)}</Text>
                  </View>
                  <Text style={[s.lbPts, rank === 0 && s.lbPtsGold]}>{p.pts}pts</Text>
                </View>
              );
            })
          )}
        </View>

        {/* Groups */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>GROUPS  ·  {groups.length}</Text>
          {groups.map((g, i) => (
            <TouchableOpacity
              key={g.match_id}
              style={[s.groupCard, g.match_id === myMatch && s.groupCardMe]}
              onPress={() => router.push(`/(app)/score/${g.match_id}` as any)}
              activeOpacity={0.8}
            >
              <Text style={s.groupNum}>Group {i + 1}</Text>
              <Text style={s.groupPlayers}>{g.player_names.join(', ')}</Text>
              {g.match_id === myMatch && <Text style={s.groupYou}>YOUR GROUP</Text>}
            </TouchableOpacity>
          ))}
        </View>

        {/* Actions */}
        {myMatch ? (
          <TouchableOpacity
            style={s.scoreBtn}
            onPress={() => router.push(`/(app)/score/${myMatch}` as any)}
            activeOpacity={0.85}
          >
            <Text style={s.scoreBtnText}>⛳ Score My Group</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={s.joinBtn}
            onPress={() => router.push(`/(app)/games/new?existingDayId=${dayId}&course=${encodeURIComponent(day.course_name)}` as any)}
            activeOpacity={0.85}
          >
            <Text style={s.joinBtnText}>+ Add My Group</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.bg, paddingTop: 56 },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, marginBottom: spacing.md },
  backText:     { color: colors.gold, fontSize: fonts.md, fontWeight: '600' },
  shareBtn:     { backgroundColor: colors.goldDim, borderWidth: 1, borderColor: colors.goldBorder, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 6 },
  shareBtnText: { color: colors.gold, fontSize: fonts.sm, fontWeight: '700' },

  dayCard:      { marginHorizontal: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.goldBorder, marginBottom: spacing.md },
  course:       { fontSize: fonts.xxl, fontWeight: '800', color: colors.white },
  dateStr:      { fontSize: fonts.sm, color: colors.textMuted, marginTop: 2, marginBottom: spacing.md },
  codeRow:      { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  codeBox:      { backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', minWidth: 100 },
  codeLabel:    { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: 4 },
  code:         { fontSize: fonts.xxl, fontWeight: '800', color: colors.gold, letterSpacing: 4 },
  codeHint:     { fontSize: fonts.xs, color: colors.textMuted, lineHeight: 18, flex: 1 },

  section:      { marginHorizontal: spacing.md, marginBottom: spacing.md },
  sectionLabel: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.sm },
  empty:        { color: colors.textMuted, fontSize: fonts.sm, textAlign: 'center', paddingVertical: spacing.lg },

  lbRow:        { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  lbRowMe:      { backgroundColor: colors.goldDim, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginHorizontal: -spacing.sm },
  lbRank:       { width: 24, fontSize: fonts.md, fontWeight: '800', color: colors.textMuted, textAlign: 'center' },
  lbRankGold:   { color: colors.gold },
  lbName:       { fontSize: fonts.md, fontWeight: '700', color: colors.white },
  lbNameMe:     { color: colors.gold },
  lbSub:        { fontSize: fonts.xs, color: colors.textMuted },
  lbPts:        { fontSize: fonts.lg, fontWeight: '800', color: colors.white, minWidth: 52, textAlign: 'right' },
  lbPtsGold:    { color: colors.gold },

  groupCard:    { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  groupCardMe:  { borderColor: colors.gold, backgroundColor: colors.goldDim },
  groupNum:     { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: 2 },
  groupPlayers: { fontSize: fonts.md, fontWeight: '600', color: colors.white },
  groupYou:     { fontSize: 9, fontWeight: '800', color: colors.gold, letterSpacing: 1, marginTop: 4 },

  scoreBtn:     { marginHorizontal: spacing.md, backgroundColor: colors.green, borderRadius: radius.lg, paddingVertical: 16, alignItems: 'center', marginBottom: spacing.sm },
  scoreBtnText: { color: colors.bg, fontSize: fonts.lg, fontWeight: '800' },
  joinBtn:      { marginHorizontal: spacing.md, backgroundColor: colors.gold, borderRadius: radius.lg, paddingVertical: 16, alignItems: 'center', marginBottom: spacing.sm },
  joinBtnText:  { color: colors.bg, fontSize: fonts.lg, fontWeight: '800' },
});
