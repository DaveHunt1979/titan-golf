import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Share, StyleSheet, Alert, RefreshControl } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';

type Game = {
  id: string; name: string; game_date: string; course_name: string | null;
  entry_fee: number; currency: string; prize_split: number[]; join_code: string;
  status: string; created_by: string;
};
type Entry = { player_id: string; display_name: string; handicap: number | null; total_pts: number; holes_played: number };

export default function SwindleGame() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const router = useRouter();
  const [game,      setGame]      = useState<Game | null>(null);
  const [entries,   setEntries]   = useState<Entry[]>([]);
  const [myId,      setMyId]      = useState<string | null>(null);
  const [isCreator, setIsCreator] = useState(false);
  const [loading,   setLoading]   = useState(true);
  const [joining,   setJoining]   = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { init(); }, [gameId]);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: p } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (p) setMyId(p.id);
    }
    await load();
  }

  const load = useCallback(async () => {
    const [{ data: gameData }, { data: entriesData }, { data: scoresData }] = await Promise.all([
      supabase.from('swindle_games').select('*').eq('id', gameId).single(),
      supabase.from('swindle_entries').select('player_id, handicap, players(display_name)').eq('game_id', gameId),
      supabase.from('swindle_scores').select('player_id, stableford_pts').eq('game_id', gameId),
    ]);

    if (gameData) {
      setGame(gameData as Game);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: p } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
        if (p) setIsCreator(gameData.created_by === p.id);
      }
    }

    if (entriesData && scoresData) {
      const totals: Record<string, number> = {};
      const holes:  Record<string, number> = {};
      for (const s of (scoresData as any[])) {
        totals[s.player_id] = (totals[s.player_id] ?? 0) + (s.stableford_pts ?? 0);
        holes[s.player_id]  = (holes[s.player_id]  ?? 0) + 1;
      }
      const built: Entry[] = (entriesData as any[]).map(e => ({
        player_id:    e.player_id,
        display_name: e.players?.display_name ?? 'Unknown',
        handicap:     e.handicap,
        total_pts:    totals[e.player_id]  ?? 0,
        holes_played: holes[e.player_id] ?? 0,
      }));
      built.sort((a, b) => b.total_pts - a.total_pts || b.holes_played - a.holes_played);
      setEntries(built);
    }
    setLoading(false);
    setRefreshing(false);
  }, [gameId]);

  async function join() {
    if (!myId || !game) return;
    setJoining(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setJoining(false); return; }
    const { data: p } = await supabase.from('players').select('id, handicap_index').eq('auth_uid', user.id).maybeSingle();
    if (!p) { setJoining(false); return; }
    const { error } = await supabase.from('swindle_entries').insert({
      game_id: game.id, player_id: p.id, handicap: p.handicap_index ?? null,
    });
    if (error && error.code !== '23505') Alert.alert('Error', error.message);
    setJoining(false);
    load();
  }

  async function complete() {
    if (!game) return;
    Alert.alert('Complete Game', 'Mark this swindle as finished?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Complete', onPress: async () => {
        await supabase.from('swindle_games').update({ status: 'complete' }).eq('id', game.id);
        load();
      }},
    ]);
  }

  function shareCode() {
    if (!game) return;
    Share.share({ message: `Join my Titan Golf swindle "${game.name}"! Use code: ${game.join_code}` });
  }

  if (loading || !game) {
    return <View style={s.container}><Text style={s.loading}>Loading…</Text></View>;
  }

  const pot      = game.entry_fee * entries.length;
  const inGame   = entries.some(e => e.player_id === myId);
  const prizes   = game.prize_split.map(pct => pot * pct / 100);
  const statusColor = game.status === 'in_progress' ? colors.green : game.status === 'complete' ? colors.textMuted : colors.gold;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={shareCode} style={s.shareBtn}>
          <Text style={s.shareText}>Share Code</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />}
      >
        {/* Game info */}
        <View style={s.gameCard}>
          <View style={s.gameCardTop}>
            <View style={{ flex: 1 }}>
              <Text style={s.gameName}>{game.name}</Text>
              <Text style={s.gameSub}>{game.course_name ?? 'No course'} · {new Date(game.game_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</Text>
            </View>
            <View style={[s.statusBadge, { borderColor: statusColor }]}>
              <Text style={[s.statusText, { color: statusColor }]}>{game.status.toUpperCase()}</Text>
            </View>
          </View>
          <View style={s.statsRow}>
            <StatBox label="ENTRY" value={`${game.currency}${Number(game.entry_fee).toFixed(0)}`} />
            <StatBox label="PLAYERS" value={`${entries.length}`} />
            <StatBox label="POT" value={pot > 0 ? `${game.currency}${pot.toFixed(0)}` : '—'} gold />
            <StatBox label="CODE" value={game.join_code} />
          </View>
        </View>

        {/* Prize breakdown */}
        {pot > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>PRIZES</Text>
            {game.prize_split.map((pct, i) => (
              <View key={i} style={s.prizeRow}>
                <Text style={s.prizePos}>{i + 1}{i === 0 ? 'ST' : i === 1 ? 'ND' : i === 2 ? 'RD' : 'TH'}</Text>
                <Text style={s.prizePct}>{pct}%</Text>
                <Text style={s.prizeAmount}>{game.currency}{prizes[i].toFixed(2)}</Text>
                {entries[i] && <Text style={s.prizePlayer} numberOfLines={1}>{entries[i].display_name.split(' ')[0]}</Text>}
              </View>
            ))}
          </View>
        )}

        {/* Leaderboard */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>LEADERBOARD</Text>
          {entries.length === 0 && (
            <Text style={s.noEntries}>No players yet — share the code!</Text>
          )}
          {entries.map((e, rank) => {
            const prizeAmt = prizes[rank] ?? 0;
            const isMe = e.player_id === myId;
            return (
              <View key={e.player_id} style={[s.lbRow, isMe && s.lbRowMe]}>
                <Text style={[s.lbRank, rank === 0 && { color: colors.gold }]}>{rank + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[s.lbName, isMe && { color: colors.gold }]}>
                    {e.display_name.split(' ')[0]}{isMe ? ' (you)' : ''}
                  </Text>
                  <Text style={s.lbSub}>{e.holes_played} hole{e.holes_played !== 1 ? 's' : ''} played</Text>
                </View>
                <Text style={s.lbPts}>{e.total_pts}pts</Text>
                {prizeAmt > 0 && (
                  <Text style={[s.lbPrize, rank === 0 && { color: colors.gold }]}>{game.currency}{prizeAmt.toFixed(0)}</Text>
                )}
              </View>
            );
          })}
        </View>

        {/* Actions */}
        {!inGame && game.status === 'open' && (
          <TouchableOpacity style={s.joinBtn} onPress={join} disabled={joining} activeOpacity={0.85}>
            <Text style={s.joinBtnText}>{joining ? 'Joining…' : `Join — ${game.currency}${Number(game.entry_fee).toFixed(0)} entry`}</Text>
          </TouchableOpacity>
        )}
        {inGame && game.status !== 'complete' && (
          <TouchableOpacity
            style={s.scoreBtn}
            onPress={() => router.push(`/(app)/swindle/score/${game.id}` as any)}
            activeOpacity={0.85}
          >
            <Text style={s.scoreBtnText}>⛳ Score My Round</Text>
          </TouchableOpacity>
        )}
        {isCreator && game.status !== 'complete' && (
          <TouchableOpacity style={s.completeBtn} onPress={complete} activeOpacity={0.85}>
            <Text style={s.completeBtnText}>Mark Complete</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

function StatBox({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, gold && { color: colors.gold }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.bg, paddingTop: 56 },
  loading:      { color: colors.textMuted, textAlign: 'center', marginTop: 80 },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, marginBottom: spacing.md },
  backBtn:      { paddingVertical: spacing.xs },
  backText:     { color: colors.gold, fontSize: fonts.md, fontWeight: '600' },
  shareBtn:     { backgroundColor: colors.goldDim, borderWidth: 1, borderColor: colors.goldBorder, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  shareText:    { color: colors.gold, fontSize: fonts.sm, fontWeight: '700' },
  gameCard:     { marginHorizontal: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  gameCardTop:  { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.md },
  gameName:     { fontSize: fonts.xl, fontWeight: '800', color: colors.white, marginBottom: 2 },
  gameSub:      { fontSize: fonts.xs, color: colors.textMuted },
  statsRow:     { flexDirection: 'row', justifyContent: 'space-between' },
  statLabel:    { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: 2 },
  statValue:    { fontSize: fonts.md, fontWeight: '700', color: colors.white },
  statusBadge:  { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  statusText:   { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  section:      { marginHorizontal: spacing.md, marginBottom: spacing.md },
  sectionLabel: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.sm },
  prizeRow:     { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  prizePos:     { width: 32, fontSize: fonts.xs, fontWeight: '800', color: colors.textMuted },
  prizePct:     { width: 40, fontSize: fonts.sm, color: colors.textSecondary },
  prizeAmount:  { fontSize: fonts.lg, fontWeight: '700', color: colors.gold, flex: 1 },
  prizePlayer:  { fontSize: fonts.sm, color: colors.textSecondary, maxWidth: 100 },
  noEntries:    { color: colors.textMuted, fontSize: fonts.sm, textAlign: 'center', paddingVertical: spacing.lg },
  lbRow:        { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  lbRowMe:      { backgroundColor: colors.goldDim, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginHorizontal: -spacing.sm },
  lbRank:       { width: 24, fontSize: fonts.md, fontWeight: '800', color: colors.textMuted, textAlign: 'center' },
  lbName:       { fontSize: fonts.md, fontWeight: '700', color: colors.white },
  lbSub:        { fontSize: fonts.xs, color: colors.textMuted },
  lbPts:        { fontSize: fonts.lg, fontWeight: '800', color: colors.white, minWidth: 52, textAlign: 'right' },
  lbPrize:      { fontSize: fonts.md, fontWeight: '700', color: colors.textSecondary, minWidth: 40, textAlign: 'right' },
  joinBtn:      { marginHorizontal: spacing.md, backgroundColor: colors.gold, borderRadius: radius.lg, paddingVertical: 16, alignItems: 'center', marginBottom: spacing.sm },
  joinBtnText:  { color: colors.bg, fontSize: fonts.lg, fontWeight: '800' },
  scoreBtn:     { marginHorizontal: spacing.md, backgroundColor: colors.green, borderRadius: radius.lg, paddingVertical: 16, alignItems: 'center', marginBottom: spacing.sm },
  scoreBtnText: { color: colors.bg, fontSize: fonts.lg, fontWeight: '800' },
  completeBtn:  { marginHorizontal: spacing.md, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingVertical: 12, alignItems: 'center', marginBottom: spacing.sm },
  completeBtnText: { color: colors.textMuted, fontSize: fonts.sm, fontWeight: '700' },
});
