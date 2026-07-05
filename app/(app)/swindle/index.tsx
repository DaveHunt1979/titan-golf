import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';

type Game = {
  id: string;
  name: string;
  game_date: string;
  course_name: string | null;
  entry_fee: number;
  currency: string;
  status: string;
  join_code: string;
  is_recurring: boolean;
  recurring_day: string | null;
  entry_count?: number;
  am_entered?: boolean;
};

export default function SwindleIndex() {
  const router = useRouter();
  const [games,    setGames]    = useState<Game[]>([]);
  const [myId,     setMyId]     = useState<string | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [joining,  setJoining]  = useState(false);
  const [imInBusy, setImInBusy] = useState<string | null>(null);

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: p } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (p) { setMyId(p.id); await loadGames(p.id); return; }
    }
    await loadGames(null);
  }

  async function loadGames(playerId: string | null) {
    const { data } = await supabase
      .from('swindle_games')
      .select('*, swindle_entries(count)')
      .order('game_date', { ascending: false })
      .limit(20);
    if (!data) { setLoading(false); return; }

    let enteredSet = new Set<string>();
    if (playerId) {
      const openIds = (data as any[]).filter(g => g.status === 'open').map(g => g.id);
      if (openIds.length) {
        const { data: myEntries } = await supabase
          .from('swindle_entries').select('game_id').eq('player_id', playerId).in('game_id', openIds);
        if (myEntries) enteredSet = new Set((myEntries as any[]).map(e => e.game_id));
      }
    }

    setGames((data as any[]).map(g => ({
      ...g,
      entry_count: g.swindle_entries?.[0]?.count ?? 0,
      am_entered: enteredSet.has(g.id),
    })));
    setLoading(false);
  }

  async function imIn(game: Game) {
    if (!myId || imInBusy) return;
    setImInBusy(game.id);
    await supabase.from('swindle_entries').insert({ game_id: game.id, player_id: myId });
    setGames(gs => gs.map(g => g.id === game.id ? { ...g, am_entered: true, entry_count: (g.entry_count ?? 0) + 1 } : g));
    setImInBusy(null);
  }

  async function joinByCode() {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setJoining(true);
    const { data } = await supabase
      .from('swindle_games')
      .select('id')
      .eq('join_code', code)
      .maybeSingle();
    setJoining(false);
    if (!data) { Alert.alert('Not found', 'No game with that code.'); return; }
    router.push(`/(app)/swindle/${data.id}` as any);
  }

  const open     = games.filter(g => g.status === 'open' || g.status === 'in_progress');
  const complete = games.filter(g => g.status === 'complete');

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>Swindle</Text>
        <TouchableOpacity style={s.createBtn} onPress={() => router.push('/(app)/swindle/create' as any)}>
          <Text style={s.createBtnText}>+ Create</Text>
        </TouchableOpacity>
      </View>

      <View style={s.joinRow}>
        <TextInput
          style={s.joinInput}
          placeholder="Enter join code…"
          placeholderTextColor={colors.textMuted}
          value={joinCode}
          onChangeText={t => setJoinCode(t.toUpperCase())}
          autoCapitalize="characters"
          maxLength={6}
        />
        <TouchableOpacity style={s.joinBtn} onPress={joinByCode} disabled={joining}>
          <Text style={s.joinBtnText}>Join</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
        {open.length > 0 && (
          <>
            <Text style={s.sectionLabel}>LIVE & OPEN</Text>
            {open.map(g => (
              <GameCard
                key={g.id}
                game={g}
                onPress={() => router.push(`/(app)/swindle/${g.id}` as any)}
                onImIn={() => imIn(g)}
                imInBusy={imInBusy === g.id}
              />
            ))}
          </>
        )}
        {complete.length > 0 && (
          <>
            <Text style={s.sectionLabel}>COMPLETED</Text>
            {complete.map(g => <GameCard key={g.id} game={g} onPress={() => router.push(`/(app)/swindle/${g.id}` as any)} />)}
          </>
        )}
        {!loading && games.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>🏌️</Text>
            <Text style={s.emptyTitle}>No swindles yet</Text>
            <Text style={s.emptySub}>Create one and share the join code with your group</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function GameCard({ game, onPress, onImIn, imInBusy }: {
  game: Game; onPress: () => void; onImIn?: () => void; imInBusy?: boolean;
}) {
  const pot = game.entry_fee * (game.entry_count ?? 0);
  const statusColor = game.status === 'in_progress' ? colors.green : game.status === 'complete' ? colors.textMuted : colors.gold;
  const statusLabel = game.status === 'in_progress' ? 'LIVE' : game.status === 'complete' ? 'DONE' : 'OPEN';
  const showImIn = game.status === 'open' && !game.am_entered && onImIn;
  const dayLabel = game.recurring_day ? game.recurring_day.charAt(0).toUpperCase() + game.recurring_day.slice(1) : null;

  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.85}>
      <View style={s.cardTop}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <Text style={s.cardName}>{game.name}</Text>
            {game.is_recurring && dayLabel && (
              <View style={s.recurringBadge}>
                <Text style={s.recurringText}>🔁 {dayLabel}</Text>
              </View>
            )}
          </View>
          <Text style={s.cardSub}>{game.course_name ?? 'No course set'} · {new Date(game.game_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</Text>
        </View>
        <View style={[s.statusBadge, { borderColor: statusColor }]}>
          <Text style={[s.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>
      <View style={s.cardStats}>
        <Stat label="ENTRY" value={`${game.currency}${Number(game.entry_fee).toFixed(0)}`} />
        <Stat label="PLAYERS" value={`${game.entry_count ?? 0}`} />
        <Stat label="POT" value={pot > 0 ? `${game.currency}${pot.toFixed(0)}` : '—'} highlight />
        <Stat label="CODE" value={game.join_code} />
      </View>
      {showImIn && (
        <TouchableOpacity
          style={s.imInBtn}
          onPress={e => { e.stopPropagation?.(); onImIn(); }}
          disabled={imInBusy}
          activeOpacity={0.85}
        >
          <Text style={s.imInText}>{imInBusy ? '…' : "⛳ I'm in!"}</Text>
        </TouchableOpacity>
      )}
      {game.status === 'open' && game.am_entered && (
        <View style={s.enteredBadge}>
          <Text style={s.enteredText}>✓ You're entered</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, highlight && { color: colors.gold }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.bg, paddingTop: 56 },
  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, marginBottom: spacing.md },
  title:        { flex: 1, fontSize: fonts.xxl, fontWeight: '800', color: colors.white, letterSpacing: 1 },
  createBtn:    { backgroundColor: colors.gold, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full },
  createBtnText:{ fontSize: fonts.sm, fontWeight: '800', color: colors.bg },
  joinRow:      { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.lg },
  joinInput:    { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.white, fontSize: fonts.md, fontWeight: '700', letterSpacing: 2 },
  joinBtn:      { backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.goldBorder, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center' },
  joinBtnText:  { color: colors.gold, fontWeight: '700', fontSize: fonts.sm },
  sectionLabel: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, paddingHorizontal: spacing.md, marginTop: spacing.md, marginBottom: spacing.sm },
  card:         { marginHorizontal: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  cardTop:      { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.md },
  cardName:     { fontSize: fonts.lg, fontWeight: '700', color: colors.white, marginBottom: 2 },
  cardSub:      { fontSize: fonts.xs, color: colors.textMuted },
  statusBadge:  { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  statusText:   { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  cardStats:    { flexDirection: 'row', justifyContent: 'space-between' },
  statLabel:    { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: 2 },
  statValue:    { fontSize: fonts.md, fontWeight: '700', color: colors.white },
  recurringBadge: { backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: radius.full, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: colors.goldBorder },
  recurringText:  { fontSize: 9, fontWeight: '700', color: colors.gold },
  imInBtn:      { marginTop: spacing.sm, backgroundColor: colors.gold, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center' },
  imInText:     { fontSize: fonts.md, fontWeight: '800', color: colors.bg },
  enteredBadge: { marginTop: spacing.sm, backgroundColor: 'rgba(74,222,128,0.1)', borderRadius: radius.md, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(74,222,128,0.3)' },
  enteredText:  { fontSize: fonts.sm, fontWeight: '700', color: colors.green },
  empty:        { alignItems: 'center', paddingTop: 80, gap: spacing.sm },
  emptyEmoji:   { fontSize: 48 },
  emptyTitle:   { fontSize: fonts.lg, fontWeight: '700', color: colors.textPrimary },
  emptySub:     { fontSize: fonts.sm, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.xl },
});
