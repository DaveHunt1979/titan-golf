import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Share, StyleSheet, Alert, RefreshControl, Modal, FlatList, ActivityIndicator, Image } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { calcStrokesReceived } from '../../../src/lib/scoring';

const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const RED    = '#f87171';
const PURPLE = '#a78bfa';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';

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

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

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

  if (loading || !fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar style="light" />
        <ActivityIndicator color={GOLD} size="large" />
      </View>
    );
  }

  if (!game) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar style="light" />
        <ActivityIndicator color={GOLD} size="large" />
      </View>
    );
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

  const statusBadgeColor =
    game.status === 'complete'   ? GOLD   :
    game.status === 'open'       ? PURPLE :
    '#6b7280';

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header: three-column */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{game.name}</Text>
        <TouchableOpacity
          onPress={game.status === 'complete' ? shareResults : shareCode}
          style={s.shareIconBtn}
          activeOpacity={0.7}
        >
          <Text style={s.shareIconText}>↑</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={GOLD}
          />
        }
      >
        {/* Game info card */}
        <View style={s.gameCard}>
          <View style={s.gameCardTop}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={s.gameName} numberOfLines={2}>{game.name}</Text>
              <Text style={s.gameSub}>
                {new Date(game.game_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
              </Text>
              {game.course_name && (
                <Text style={s.gameCourse}>{game.course_name}</Text>
              )}
              <Text style={s.gameFormat}>{isStroke ? 'Stroke Play' : 'Stableford'}</Text>
            </View>
            {/* Status badge */}
            <View style={[s.statusBadge, { backgroundColor: statusBadgeColor + '22', borderColor: statusBadgeColor }]}>
              <Text style={[s.statusText, { color: statusBadgeColor }]}>
                {game.status === 'in_progress' ? 'LIVE' : game.status.toUpperCase()}
              </Text>
            </View>
          </View>

          {/* Stat row */}
          <View style={s.statsRow}>
            <StatBox label="ENTRY" value={`${game.currency}${Number(game.entry_fee).toFixed(0)}`} />
            <View style={s.statDivider} />
            <StatBox label="PLAYERS" value={`${entries.length}`} />
            <View style={s.statDivider} />
            <StatBox label="POT" value={pot > 0 ? `${game.currency}${pot.toFixed(0)}` : '—'} gold />
            <View style={s.statDivider} />
            <StatBox label="CODE" value={game.join_code} />
          </View>
        </View>

        {/* Prize breakdown */}
        {pot > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>PRIZES</Text>
            <View style={s.pillRow}>
              {game.prize_split.map((pct, i) => (
                <View key={i} style={s.prizePill}>
                  <Text style={s.prizePillPos}>
                    {i + 1}{i === 0 ? 'st' : i === 1 ? 'nd' : i === 2 ? 'rd' : 'th'}
                  </Text>
                  <Text style={s.prizePillAmt}>
                    {game.currency}{prizes[i].toFixed(0)}
                  </Text>
                  {entries[i] && (
                    <Text style={s.prizePillName} numberOfLines={1}>
                      {entries[i].display_name.split(' ')[0]}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Two's competition */}
        {game.twos_enabled && (
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <Text style={s.sectionLabel}>TWO'S COMPETITION</Text>
              {twosPot > 0 && (
                <View style={s.potPill}>
                  <Text style={s.potPillText}>{game.currency}{twosPot.toFixed(0)}</Text>
                </View>
              )}
            </View>
            <View style={s.card}>
              {twos.length === 0 ? (
                <Text style={s.noEntries}>No two's scored yet</Text>
              ) : (
                <>
                  {twos.map((t, i) => (
                    <View key={i} style={s.cardRow}>
                      <Text style={s.cardRowLabel}>H{t.hole_number}</Text>
                      <Text style={s.cardRowName}>{t.name}</Text>
                      {twosEach > 0 && (
                        <Text style={s.cardRowAmt}>{game.currency}{twosEach.toFixed(2)}</Text>
                      )}
                    </View>
                  ))}
                  {uniqueTwos > 1 && (
                    <Text style={s.cardSub}>Split equally between {uniqueTwos} players</Text>
                  )}
                </>
              )}
            </View>
          </View>
        )}

        {/* NTP */}
        {game.ntp_hole && (
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <Text style={s.sectionLabel}>NEAREST THE PIN — HOLE {game.ntp_hole}</Text>
              {ntpPot > 0 && (
                <View style={s.potPill}>
                  <Text style={s.potPillText}>{game.currency}{ntpPot.toFixed(0)}</Text>
                </View>
              )}
            </View>
            <View style={s.card}>
              {ntpWinner ? (
                <View style={s.cardRow}>
                  <Text style={s.cardRowName}>{ntpWinner}</Text>
                  {ntpPot > 0 && <Text style={s.cardRowAmt}>{game.currency}{ntpPot.toFixed(2)}</Text>}
                </View>
              ) : (
                <View style={s.cardRow}>
                  <Text style={s.noEntries}>TBD</Text>
                  {isCreator && (
                    <TouchableOpacity style={s.setWinnerBtn} onPress={() => setShowWinner('ntp')} activeOpacity={0.8}>
                      <Text style={s.setWinnerText}>Set Winner</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          </View>
        )}

        {/* Longest drive */}
        {game.ld_hole && (
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <Text style={s.sectionLabel}>LONGEST DRIVE — HOLE {game.ld_hole}</Text>
              {ldPot > 0 && (
                <View style={s.potPill}>
                  <Text style={s.potPillText}>{game.currency}{ldPot.toFixed(0)}</Text>
                </View>
              )}
            </View>
            <View style={s.card}>
              {ldWinner ? (
                <View style={s.cardRow}>
                  <Text style={s.cardRowName}>{ldWinner}</Text>
                  {ldPot > 0 && <Text style={s.cardRowAmt}>{game.currency}{ldPot.toFixed(2)}</Text>}
                </View>
              ) : (
                <View style={s.cardRow}>
                  <Text style={s.noEntries}>TBD</Text>
                  {isCreator && (
                    <TouchableOpacity style={s.setWinnerBtn} onPress={() => setShowWinner('ld')} activeOpacity={0.8}>
                      <Text style={s.setWinnerText}>Set Winner</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          </View>
        )}

        {/* Leaderboard */}
        <View style={s.section}>
          <View style={s.lbHeader}>
            <Text style={s.sectionLabel}>LEADERBOARD</Text>
            {game.status === 'in_progress' && prizes.some(p => p > 0) && (
              <View style={s.liveBadge}>
                <Text style={s.liveBadgeText}>LIVE MONEY</Text>
              </View>
            )}
          </View>
          {entries.length === 0 && (
            <Text style={s.noEntries}>No players yet — share the code!</Text>
          )}
          {entries.map((e, rank) => {
            const prizeAmt  = prizes[rank] ?? 0;
            const isMe      = e.player_id === myId;
            const leftColor =
              rank === 0 ? GOLD      :
              rank === 1 ? '#9ca3af' :
              rank === 2 ? '#cd7f32' : 'transparent';

            return (
              <View
                key={e.player_id}
                style={[
                  s.lbRow,
                  { borderLeftColor: leftColor, borderLeftWidth: rank < 3 ? 3 : 0 },
                  isMe && s.lbRowMe,
                ]}
              >
                <Text style={s.lbRank}>{rank + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.lbName}>
                    {e.display_name.split(' ')[0]}{isMe ? ' (you)' : ''}
                  </Text>
                  <Text style={s.lbHoles}>{e.holes_played} hole{e.holes_played !== 1 ? 's' : ''}</Text>
                </View>
                {isStroke
                  ? <Text style={s.lbPts}>{e.net_total > 0 ? e.net_total : '—'}</Text>
                  : <Text style={s.lbPts}>{e.total_pts}pts</Text>
                }
                {prizeAmt > 0 && (
                  <Text style={s.lbPrize}>{game.currency}{prizeAmt.toFixed(0)}</Text>
                )}
              </View>
            );
          })}
        </View>

        {/* Actions */}
        {!inGame && game.status === 'open' && (
          <TouchableOpacity style={s.joinBtn} onPress={join} disabled={joining} activeOpacity={0.85}>
            <Text style={s.joinBtnText}>
              {joining ? 'Joining…' : `I'm In — ${game.currency}${Number(game.entry_fee).toFixed(0)} entry`}
            </Text>
          </TouchableOpacity>
        )}
        {inGame && game.status !== 'complete' && (
          <TouchableOpacity
            style={s.scoreBtn}
            onPress={() => router.push(`/(app)/swindle/score/${game.id}` as any)}
            activeOpacity={0.85}
          >
            <Text style={s.scoreBtnText}>Score My Round</Text>
          </TouchableOpacity>
        )}
        {inGame && game.status !== 'complete' && (
          <TouchableOpacity
            style={s.scanBtn}
            onPress={() => router.push(`/(app)/swindle/scan/${game.id}` as any)}
            activeOpacity={0.85}
          >
            <Text style={s.scanBtnText}>Scan Paper Scorecard</Text>
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
              <Text style={s.pickerTitle}>
                {showWinner === 'ntp' ? 'NTP Winner' : 'LD Winner'}
              </Text>
              <TouchableOpacity onPress={() => setShowWinner(null)} activeOpacity={0.7}>
                <Text style={s.pickerClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={entries}
              keyExtractor={e => e.player_id}
              renderItem={({ item }) => {
                const isActive = item.player_id === (showWinner === 'ntp' ? game.ntp_winner_id : game.ld_winner_id);
                return (
                  <TouchableOpacity
                    style={[s.pickerItem, isActive && s.pickerItemActive]}
                    onPress={() => setWinner(showWinner!, item.player_id)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.pickerItemText, isActive && { color: GOLD }]}>
                      {item.display_name}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function StatBox({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, gold && { color: GOLD }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#000', paddingTop: 56 },

  // Header
  header:           { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16 },
  backBtn:          { paddingVertical: 4, minWidth: 64 },
  backText:         { color: GOLD, fontSize: 15, fontFamily: FFB },
  headerTitle:      { flex: 1, color: '#fff', fontSize: 17, fontFamily: FFB, textAlign: 'center', marginHorizontal: 8 },
  shareIconBtn:     { minWidth: 64, alignItems: 'flex-end', paddingVertical: 4 },
  shareIconText:    { color: GOLD, fontSize: 20, fontFamily: FFB },

  // Game card
  gameCard:         { marginHorizontal: 16, backgroundColor: '#111', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#1c1c1c', marginBottom: 16 },
  gameCardTop:      { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  gameName:         { fontSize: 20, fontFamily: FFB, color: '#fff', marginBottom: 4 },
  gameSub:          { fontSize: 13, fontFamily: FF, color: '#888', marginBottom: 2 },
  gameCourse:       { fontSize: 13, fontFamily: FFB, color: '#aaa', marginBottom: 2 },
  gameFormat:       { fontSize: 12, fontFamily: FFB, color: GOLD, marginTop: 2 },

  // Status badge
  statusBadge:      { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  statusText:       { fontSize: 10, fontFamily: FFB, letterSpacing: 1 },

  // Stats row
  statsRow:         { flexDirection: 'row', alignItems: 'center' },
  statDivider:      { width: 1, height: 28, backgroundColor: '#1c1c1c' },
  statLabel:        { fontSize: 9, fontFamily: FFB, color: '#555', letterSpacing: 1, marginBottom: 2, textAlign: 'center' },
  statValue:        { fontSize: 15, fontFamily: FFB, color: '#fff', textAlign: 'center' },

  // Section
  section:          { marginHorizontal: 16, marginBottom: 20 },
  sectionLabel:     { fontSize: 11, fontFamily: FFB, color: '#555', letterSpacing: 1.5, marginBottom: 10 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },

  // Pot pill
  potPill:          { backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)' },
  potPillText:      { fontSize: 12, fontFamily: FFB, color: GOLD },

  // Prize pills
  pillRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  prizePill:        { backgroundColor: 'rgba(212,175,55,0.10)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)', flexDirection: 'row', alignItems: 'center', gap: 6 },
  prizePillPos:     { fontSize: 12, fontFamily: FFB, color: GOLD },
  prizePillAmt:     { fontSize: 14, fontFamily: FFB, color: GOLD },
  prizePillName:    { fontSize: 12, fontFamily: FF, color: '#aaa', maxWidth: 72 },

  // Card (twos/ntp/ld)
  card:             { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', paddingHorizontal: 14, paddingVertical: 4 },
  cardRow:          { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  cardRowLabel:     { width: 36, fontSize: 12, fontFamily: FFB, color: '#555' },
  cardRowName:      { flex: 1, fontSize: 15, fontFamily: FFB, color: '#fff' },
  cardRowAmt:       { fontSize: 15, fontFamily: FFB, color: GOLD },
  cardSub:          { fontSize: 11, fontFamily: FF, color: '#555', paddingVertical: 8 },

  noEntries:        { fontSize: 13, fontFamily: FF, color: '#444', paddingVertical: 10 },

  // Set winner button
  setWinnerBtn:     { backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)' },
  setWinnerText:    { fontSize: 12, fontFamily: FFB, color: GOLD },

  // Leaderboard
  lbHeader:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  liveBadge:        { backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)' },
  liveBadgeText:    { fontSize: 9, fontFamily: FFB, color: GOLD, letterSpacing: 1 },
  lbRow:            { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingLeft: 12, borderBottomWidth: 1, borderBottomColor: '#111' },
  lbRowMe:          { backgroundColor: 'rgba(212,175,55,0.07)', borderRadius: 10 },
  lbRank:           { width: 22, fontSize: 15, fontFamily: FFB, color: GOLD, textAlign: 'center' },
  lbName:           { fontSize: 15, fontFamily: FFB, color: '#fff' },
  lbHoles:          { fontSize: 11, fontFamily: FF, color: '#555' },
  lbPts:            { fontSize: 16, fontFamily: FFB, color: GOLD, minWidth: 54, textAlign: 'right' },
  lbPrize:          { fontSize: 13, fontFamily: FFB, color: GOLD, minWidth: 40, textAlign: 'right' },

  // Join button (PURPLE)
  joinBtn:          { marginHorizontal: 16, backgroundColor: PURPLE, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 10 },
  joinBtnText:      { color: '#fff', fontSize: 17, fontFamily: FFB },

  // Score button (GOLD)
  scoreBtn:         { marginHorizontal: 16, backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 10 },
  scoreBtnText:     { color: '#000', fontSize: 17, fontFamily: FFB },

  // Scan button
  scanBtn:          { marginHorizontal: 16, backgroundColor: 'rgba(167,139,250,0.12)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.3)', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  scanBtnText:      { color: PURPLE, fontSize: 15, fontFamily: FFB },

  // Complete button
  completeBtn:      { marginHorizontal: 16, backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c', borderRadius: 14, paddingVertical: 12, alignItems: 'center', marginBottom: 10 },
  completeBtnText:  { color: '#555', fontSize: 14, fontFamily: FFB },

  // Share results
  shareResultsBtn:  { marginHorizontal: 16, backgroundColor: '#25D366', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  shareResultsBtnText: { color: '#fff', fontSize: 15, fontFamily: FFB },

  // Winner picker modal
  pickerOverlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  pickerSheet:      { backgroundColor: '#111', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40, maxHeight: '60%', borderTopWidth: 1, borderColor: '#1c1c1c' },
  pickerHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  pickerTitle:      { fontSize: 17, fontFamily: FFB, color: '#fff' },
  pickerClose:      { fontSize: 17, fontFamily: FF, color: '#555', paddingHorizontal: 8 },
  pickerItem:       { paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  pickerItemActive: { backgroundColor: 'rgba(212,175,55,0.08)' },
  pickerItemText:   { fontSize: 16, fontFamily: FFB, color: '#fff' },
});
