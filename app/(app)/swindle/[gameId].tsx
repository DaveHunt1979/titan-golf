import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Share, StyleSheet, Alert, RefreshControl, Modal, FlatList } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { calcStrokesReceived } from '../../../src/lib/scoring';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';

type Game = {
  id: string; name: string; game_date: string; course_name: string | null;
  entry_fee: number; currency: string; prize_split: number[]; join_code: string;
  status: string; created_by: string; format: string;
  twos_enabled: boolean; twos_fee: number;
  ntp_hole: number | null; ntp_fee: number; ntp_winner_id: string | null;
  ld_hole: number | null; ld_fee: number; ld_winner_id: string | null;
};
type Entry = {
  player_id: string; display_name: string; handicap: number | null;
  total_pts: number; net_total: number; holes_played: number;
};
type HoleInfo = { hole_number: number; par: number; stroke_index: number };
type PlayerScore = { player_id: string; hole_number: number; gross_score: number; stableford_pts: number };

export default function SwindleGame() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const router     = useRouter();

  const [game,         setGame]         = useState<Game | null>(null);
  const [entries,      setEntries]      = useState<Entry[]>([]);
  const [myId,         setMyId]         = useState<string | null>(null);
  const [isCreator,    setIsCreator]    = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [joining,      setJoining]      = useState(false);
  const [refreshing,   setRefreshing]   = useState(false);
  const [courseHoles,  setCourseHoles]  = useState<HoleInfo[]>([]);
  const [allScores,    setAllScores]    = useState<PlayerScore[]>([]);
  const [showWinner,   setShowWinner]   = useState<'ntp' | 'ld' | null>(null);

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
      supabase.from('swindle_scores').select('player_id, hole_number, gross_score, stableford_pts').eq('game_id', gameId),
    ]);

    if (gameData) {
      setGame(gameData as Game);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: p } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
        if (p) setIsCreator(gameData.created_by === p.id);
      }

      if (gameData.course_name) {
        const { data: holes } = await supabase
          .from('course_holes').select('hole_number,par,stroke_index')
          .eq('course_name', gameData.course_name).order('hole_number');
        if (holes) setCourseHoles(holes as HoleInfo[]);
      }
    }

    const scores = (scoresData ?? []) as PlayerScore[];
    setAllScores(scores);

    if (entriesData) {
      const totals:   Record<string, number> = {};
      const netTots:  Record<string, number> = {};
      const holes:    Record<string, number> = {};

      for (const s of scores) {
        totals[s.player_id]  = (totals[s.player_id]  ?? 0) + (s.stableford_pts ?? 0);
        holes[s.player_id]   = (holes[s.player_id]   ?? 0) + 1;
        // net total for stroke play — will refine after holes loaded
        netTots[s.player_id] = (netTots[s.player_id] ?? 0) + (s.gross_score ?? 0);
      }

      const built: Entry[] = (entriesData as any[]).map(e => ({
        player_id:    e.player_id,
        display_name: e.players?.display_name ?? 'Unknown',
        handicap:     e.handicap,
        total_pts:    totals[e.player_id]  ?? 0,
        net_total:    netTots[e.player_id] ?? 0,
        holes_played: holes[e.player_id]   ?? 0,
      }));

      const fmt = (gameData as any)?.format ?? 'stableford';
      if (fmt === 'stroke') {
        built.sort((a, b) => a.net_total - b.net_total || b.holes_played - a.holes_played);
      } else {
        built.sort((a, b) => b.total_pts - a.total_pts || b.holes_played - a.holes_played);
      }

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

  async function setWinner(type: 'ntp' | 'ld', playerId: string) {
    if (!game) return;
    const col = type === 'ntp' ? 'ntp_winner_id' : 'ld_winner_id';
    await supabase.from('swindle_games').update({ [col]: playerId }).eq('id', game.id);
    setShowWinner(null);
    load();
  }

  function shareCode() {
    if (!game) return;
    Share.share({ message: `Join my Titan Golf swindle "${game.name}"! Use code: ${game.join_code}` });
  }

  function shareResults() {
    if (!game) return;
    const fmt = game.format ?? 'stableford';
    const suffix = (i: number) => i === 0 ? 'st' : i === 1 ? 'nd' : i === 2 ? 'rd' : 'th';
    const pot   = game.entry_fee * entries.length;
    const prizes = game.prize_split.map(pct => pot * pct / 100);

    const lines = [
      `🏆 ${game.name} — Results`,
      `📍 ${game.course_name ?? 'Course TBC'}`,
      `👥 ${entries.length} players · ${game.currency}${pot.toFixed(0)} pot`,
      '',
    ];

    entries.forEach((e, i) => {
      const score = fmt === 'stroke' ? `${e.net_total} gross` : `${e.total_pts}pts`;
      const prize = prizes[i] ? ` — ${game.currency}${prizes[i].toFixed(0)}` : '';
      lines.push(`${i + 1}${suffix(i)}  ${e.display_name.split(' ')[0]} · ${score}${prize}`);
    });

    if (twos.length > 0) {
      const twosPot = (game.twos_fee ?? 0) * entries.length;
      const perWinner = twos.length > 0 ? twosPot / new Set(twos.map(t => t.player_id)).size : 0;
      lines.push('');
      lines.push(`🦅 Two's pot: ${game.currency}${twosPot.toFixed(0)}`);
      twos.forEach(t => lines.push(`  • ${t.name} — Hole ${t.hole_number}`));
      if (perWinner > 0) lines.push(`  Each winner: ${game.currency}${perWinner.toFixed(2)}`);
    }

    if (ntpWinner) { lines.push(''); lines.push(`📍 NTP (Hole ${game.ntp_hole}): ${ntpWinner}`); }
    if (ldWinner)  { lines.push(''); lines.push(`💨 LD (Hole ${game.ld_hole}): ${ldWinner}`);  }

    lines.push('', '⛳ Powered by Titan Golf');
    Share.share({ message: lines.join('\n') });
  }

  if (loading || !game) {
    return <View style={s.container}><Text style={s.loading}>Loading…</Text></View>;
  }

  const isStroke = (game.format ?? 'stableford') === 'stroke';
  const pot      = game.entry_fee * entries.length;
  const inGame   = entries.some(e => e.player_id === myId);
  const prizes   = game.prize_split.map(pct => pot * pct / 100);

  // Two's detection: gross score ≤ par - 2 on any hole
  const twos: { player_id: string; name: string; hole_number: number }[] = [];
  if (game.twos_enabled && courseHoles.length > 0) {
    for (const sc of allScores) {
      const holeInfo = courseHoles.find(h => h.hole_number === sc.hole_number);
      if (holeInfo && sc.gross_score <= holeInfo.par - 2) {
        const entry = entries.find(e => e.player_id === sc.player_id);
        twos.push({ player_id: sc.player_id, name: entry?.display_name?.split(' ')[0] ?? 'Unknown', hole_number: sc.hole_number });
      }
    }
    twos.sort((a, b) => a.hole_number - b.hole_number);
  }

  const twosPot    = game.twos_enabled ? (game.twos_fee ?? 0) * entries.length : 0;
  const ntpPot     = game.ntp_hole    ? (game.ntp_fee  ?? 0) * entries.length : 0;
  const ldPot      = game.ld_hole     ? (game.ld_fee   ?? 0) * entries.length : 0;
  const uniqueTwos = new Set(twos.map(t => t.player_id)).size;
  const twosEach   = uniqueTwos > 0 ? twosPot / uniqueTwos : 0;

  const ntpWinner  = game.ntp_winner_id ? entries.find(e => e.player_id === game.ntp_winner_id)?.display_name?.split(' ')[0] : null;
  const ldWinner   = game.ld_winner_id  ? entries.find(e => e.player_id === game.ld_winner_id)?.display_name?.split(' ')[0]  : null;

  const statusColor = game.status === 'in_progress' ? colors.green : game.status === 'complete' ? colors.textMuted : colors.gold;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerActions}>
          {game.status === 'complete'
            ? <TouchableOpacity onPress={shareResults} style={s.shareBtn}>
                <Text style={s.shareText}>Share Results</Text>
              </TouchableOpacity>
            : <TouchableOpacity onPress={shareCode} style={s.shareBtn}>
                <Text style={s.shareText}>Share Code</Text>
              </TouchableOpacity>
          }
        </View>
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
              <Text style={s.gameSub}>
                {game.course_name ?? 'No course'} · {new Date(game.game_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
              </Text>
              <Text style={s.gameFormat}>{isStroke ? 'Stroke Play' : 'Stableford'}</Text>
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

        {/* Two's competition */}
        {game.twos_enabled && (
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <Text style={s.sectionLabel}>🦅 TWO'S COMPETITION</Text>
              {twosPot > 0 && <Text style={s.potBadge}>{game.currency}{twosPot.toFixed(0)}</Text>}
            </View>
            {twos.length === 0 ? (
              <Text style={s.noEntries}>No two's scored yet — keep going!</Text>
            ) : (
              <>
                {twos.map((t, i) => (
                  <View key={i} style={s.prizeRow}>
                    <Text style={s.prizePos}>H{t.hole_number}</Text>
                    <Text style={[s.lbName, { flex: 1 }]}>{t.name}</Text>
                    {twosEach > 0 && <Text style={s.prizeAmount}>{game.currency}{twosEach.toFixed(2)}</Text>}
                  </View>
                ))}
                {uniqueTwos > 1 && <Text style={s.twosSub}>Split equally between {uniqueTwos} players</Text>}
              </>
            )}
          </View>
        )}

        {/* NTP */}
        {game.ntp_hole && (
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <Text style={s.sectionLabel}>📍 NEAREST THE PIN — HOLE {game.ntp_hole}</Text>
              {ntpPot > 0 && <Text style={s.potBadge}>{game.currency}{ntpPot.toFixed(0)}</Text>}
            </View>
            {ntpWinner ? (
              <View style={s.winnerRow}>
                <Text style={s.winnerName}>{ntpWinner}</Text>
                {ntpPot > 0 && <Text style={s.prizeAmount}>{game.currency}{ntpPot.toFixed(2)}</Text>}
              </View>
            ) : (
              <View style={s.prizeRow}>
                <Text style={s.noEntries}>No winner set yet</Text>
                {isCreator && (
                  <TouchableOpacity style={s.setWinnerBtn} onPress={() => setShowWinner('ntp')} activeOpacity={0.8}>
                    <Text style={s.setWinnerText}>Set Winner</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}

        {/* Longest drive */}
        {game.ld_hole && (
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <Text style={s.sectionLabel}>💨 LONGEST DRIVE — HOLE {game.ld_hole}</Text>
              {ldPot > 0 && <Text style={s.potBadge}>{game.currency}{ldPot.toFixed(0)}</Text>}
            </View>
            {ldWinner ? (
              <View style={s.winnerRow}>
                <Text style={s.winnerName}>{ldWinner}</Text>
                {ldPot > 0 && <Text style={s.prizeAmount}>{game.currency}{ldPot.toFixed(2)}</Text>}
              </View>
            ) : (
              <View style={s.prizeRow}>
                <Text style={s.noEntries}>No winner set yet</Text>
                {isCreator && (
                  <TouchableOpacity style={s.setWinnerBtn} onPress={() => setShowWinner('ld')} activeOpacity={0.8}>
                    <Text style={s.setWinnerText}>Set Winner</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}

        {/* Leaderboard */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>LEADERBOARD</Text>
          {entries.length === 0 && <Text style={s.noEntries}>No players yet — share the code!</Text>}
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
                {isStroke
                  ? <Text style={s.lbPts}>{e.net_total > 0 ? e.net_total : '—'}</Text>
                  : <Text style={s.lbPts}>{e.total_pts}pts</Text>
                }
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
          <TouchableOpacity style={s.scoreBtn} onPress={() => router.push(`/(app)/swindle/score/${game.id}` as any)} activeOpacity={0.85}>
            <Text style={s.scoreBtnText}>⛳ Score My Round</Text>
          </TouchableOpacity>
        )}
        {isCreator && game.status !== 'complete' && (
          <TouchableOpacity style={s.completeBtn} onPress={complete} activeOpacity={0.85}>
            <Text style={s.completeBtnText}>Mark Complete</Text>
          </TouchableOpacity>
        )}
        {game.status === 'complete' && (
          <TouchableOpacity style={s.shareResultsBtn} onPress={shareResults} activeOpacity={0.85}>
            <Text style={s.shareResultsBtnText}>Share Results via WhatsApp</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Winner picker modal */}
      <Modal visible={showWinner !== null} animationType="slide" transparent>
        <View style={s.pickerOverlay}>
          <View style={s.pickerSheet}>
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>{showWinner === 'ntp' ? 'NTP Winner' : 'LD Winner'}</Text>
              <TouchableOpacity onPress={() => setShowWinner(null)}>
                <Text style={s.pickerClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={entries}
              keyExtractor={e => e.player_id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={s.pickerItem}
                  onPress={() => setWinner(showWinner!, item.player_id)}
                  activeOpacity={0.8}
                >
                  <Text style={s.pickerItemText}>{item.display_name}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
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
  container:        { flex: 1, backgroundColor: colors.bg, paddingTop: 56 },
  loading:          { color: colors.textMuted, textAlign: 'center', marginTop: 80 },
  header:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, marginBottom: spacing.md },
  backBtn:          { paddingVertical: spacing.xs },
  backText:         { color: colors.gold, fontSize: fonts.md, fontWeight: '600' },
  headerActions:    { flexDirection: 'row', gap: spacing.sm },
  shareBtn:         { backgroundColor: colors.goldDim, borderWidth: 1, borderColor: colors.goldBorder, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  shareText:        { color: colors.gold, fontSize: fonts.sm, fontWeight: '700' },
  gameCard:         { marginHorizontal: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  gameCardTop:      { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.md },
  gameName:         { fontSize: fonts.xl, fontWeight: '800', color: colors.white, marginBottom: 2 },
  gameSub:          { fontSize: fonts.xs, color: colors.textMuted },
  gameFormat:       { fontSize: fonts.xs, color: colors.gold, fontWeight: '700', marginTop: 2 },
  statsRow:         { flexDirection: 'row', justifyContent: 'space-between' },
  statLabel:        { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: 2 },
  statValue:        { fontSize: fonts.md, fontWeight: '700', color: colors.white },
  statusBadge:      { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  statusText:       { fontSize: 10, fontWeight: '800', letterSpacing: 1 },

  section:          { marginHorizontal: spacing.md, marginBottom: spacing.md },
  sectionLabel:     { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.sm },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  potBadge:         { backgroundColor: colors.goldDim, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2, borderWidth: 1, borderColor: colors.goldBorder },

  prizeRow:         { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  prizePos:         { width: 32, fontSize: fonts.xs, fontWeight: '800', color: colors.textMuted },
  prizePct:         { width: 40, fontSize: fonts.sm, color: colors.textSecondary },
  prizeAmount:      { fontSize: fonts.lg, fontWeight: '700', color: colors.gold, flex: 1 },
  prizePlayer:      { fontSize: fonts.sm, color: colors.textSecondary, maxWidth: 100 },

  noEntries:        { color: colors.textMuted, fontSize: fonts.sm, paddingVertical: spacing.sm, flex: 1 },
  twosSub:          { fontSize: fonts.xs, color: colors.textMuted, marginTop: 4 },
  winnerRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  winnerName:       { fontSize: fonts.lg, fontWeight: '800', color: colors.white, flex: 1 },
  setWinnerBtn:     { backgroundColor: colors.goldDim, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 6, borderWidth: 1, borderColor: colors.goldBorder },
  setWinnerText:    { fontSize: fonts.xs, color: colors.gold, fontWeight: '700' },

  lbRow:            { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  lbRowMe:          { backgroundColor: colors.goldDim, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginHorizontal: -spacing.sm },
  lbRank:           { width: 24, fontSize: fonts.md, fontWeight: '800', color: colors.textMuted, textAlign: 'center' },
  lbName:           { fontSize: fonts.md, fontWeight: '700', color: colors.white },
  lbSub:            { fontSize: fonts.xs, color: colors.textMuted },
  lbPts:            { fontSize: fonts.lg, fontWeight: '800', color: colors.white, minWidth: 52, textAlign: 'right' },
  lbPrize:          { fontSize: fonts.md, fontWeight: '700', color: colors.textSecondary, minWidth: 40, textAlign: 'right' },

  joinBtn:          { marginHorizontal: spacing.md, backgroundColor: colors.gold, borderRadius: radius.lg, paddingVertical: 16, alignItems: 'center', marginBottom: spacing.sm },
  joinBtnText:      { color: colors.bg, fontSize: fonts.lg, fontWeight: '800' },
  scoreBtn:         { marginHorizontal: spacing.md, backgroundColor: colors.green, borderRadius: radius.lg, paddingVertical: 16, alignItems: 'center', marginBottom: spacing.sm },
  scoreBtnText:     { color: colors.bg, fontSize: fonts.lg, fontWeight: '800' },
  completeBtn:      { marginHorizontal: spacing.md, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingVertical: 12, alignItems: 'center', marginBottom: spacing.sm },
  completeBtnText:  { color: colors.textMuted, fontSize: fonts.sm, fontWeight: '700' },
  shareResultsBtn:  { marginHorizontal: spacing.md, backgroundColor: '#25D366', borderRadius: radius.lg, paddingVertical: 14, alignItems: 'center', marginBottom: spacing.sm },
  shareResultsBtnText: { color: colors.white, fontSize: fonts.md, fontWeight: '800' },

  pickerOverlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  pickerSheet:      { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: 40, maxHeight: '60%' },
  pickerHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerTitle:      { fontSize: fonts.lg, fontWeight: '800', color: colors.white },
  pickerClose:      { fontSize: fonts.lg, color: colors.textMuted, paddingHorizontal: spacing.sm },
  pickerItem:       { paddingHorizontal: spacing.md, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerItemText:   { fontSize: fonts.md, color: colors.white, fontWeight: '600' },
});
