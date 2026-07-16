import { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Alert, ActivityIndicator, Image } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { useRouter, useFocusEffect } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { titanLogo } from '../../../src/lib/assets';

const GOLD   = '#D4AF37';
const PURPLE = '#a78bfa';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';

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
  const scrollRef = useRef<ScrollView>(null);
  useFocusEffect(useCallback(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); }, []));
  const dc = useDynamicColors();
  const { localLogo, logoUrl } = useSocietyTheme();
  const [games,    setGames]    = useState<Game[]>([]);
  const [myId,     setMyId]     = useState<string | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [joining,  setJoining]  = useState(false);
  const [imInBusy, setImInBusy] = useState<string | null>(null);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  useEffect(() => { init(); }, []);

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: dc.bg, alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" />
      <ActivityIndicator color={dc.gold} size="large" />
    </View>
  );

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
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />

      {/* Header: three-column */}
      <View style={s.header}>
        <View style={s.headerSide} />
        <View style={s.headerCenter}>
          <Image source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)} style={s.logo} />
          <Text style={[s.headerSub, { color: dc.cardText }]}>THE SWINDLE</Text>
        </View>
        <View style={s.headerSide} />
      </View>

      {/* Join by code row */}
      <View style={s.joinRow}>
        <TextInput
          style={[s.joinInput, { backgroundColor: dc.card, borderColor: dc.border, color: dc.cardText }]}
          placeholder="Enter join code…"
          placeholderTextColor="#444"
          value={joinCode}
          onChangeText={t => setJoinCode(t.toUpperCase())}
          autoCapitalize="characters"
          maxLength={6}
        />
        <TouchableOpacity style={s.joinBtn} onPress={joinByCode} disabled={joining}>
          <Text style={s.joinBtnText}>Join</Text>
        </TouchableOpacity>
      </View>

      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
        {open.length > 0 && (
          <>
            <Text style={[s.sectionLabel, { color: dc.cardText }]}>LIVE & OPEN</Text>
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
            <Text style={[s.sectionLabel, { color: dc.cardText }]}>COMPLETED</Text>
            {complete.map(g => <GameCard key={g.id} game={g} onPress={() => router.push(`/(app)/swindle/${g.id}` as any)} />)}
          </>
        )}
        {games.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>🏌️</Text>
            <Text style={[s.emptyTitle, { color: dc.cardText }]}>No swindles yet</Text>
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
  const dc = useDynamicColors();
  const pot = game.entry_fee * (game.entry_count ?? 0);
  const isOpen = game.status === 'open' || game.status === 'in_progress';
  const statusColor = game.status === 'in_progress' ? '#4ade80' : game.status === 'complete' ? '#555' : PURPLE;
  const statusLabel = game.status === 'in_progress' ? 'LIVE' : game.status === 'complete' ? 'DONE' : 'OPEN';
  const showImIn = game.status === 'open' && !game.am_entered && onImIn;
  const dayLabel = game.recurring_day ? game.recurring_day.charAt(0).toUpperCase() + game.recurring_day.slice(1) : null;

  return (
    <TouchableOpacity
      style={[s.card, { backgroundColor: dc.card, borderColor: dc.border }, isOpen && s.cardOpen]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={s.cardTop}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <Text style={[s.cardName, { color: dc.cardText }]}>{game.name}</Text>
            {game.is_recurring && dayLabel && (
              <View style={s.recurringBadge}>
                <Text style={s.recurringText}>🔁 {dayLabel}</Text>
              </View>
            )}
          </View>
          <Text style={[s.cardSub, { color: dc.cardText }]}>{game.course_name ?? 'No course set'} · {new Date(game.game_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</Text>
        </View>
        <View style={[s.statusBadge, { borderColor: statusColor }]}>
          <Text style={[s.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      <View style={s.cardStats}>
        {/* Entry fee */}
        <View style={s.statBlock}>
          <Text style={[s.statLabel, { color: dc.cardText }]}>ENTRY</Text>
          <Text style={[s.statValue, { color: dc.gold }]}>{game.currency}{Number(game.entry_fee).toFixed(0)}</Text>
        </View>
        {/* Players pill */}
        <View style={[s.entryPill, { backgroundColor: dc.card }]}>
          <Text style={[s.pillLabel, { color: dc.cardText }]}>Players: </Text>
          <Text style={s.pillCount}>{game.entry_count ?? 0}</Text>
        </View>
        {/* Pot */}
        <View style={s.statBlock}>
          <Text style={[s.statLabel, { color: dc.cardText }]}>POT</Text>
          <Text style={[s.statValue, { color: dc.gold }]}>{pot > 0 ? `${game.currency}${pot.toFixed(0)}` : '—'}</Text>
        </View>
        {/* Code */}
        <View style={s.statBlock}>
          <Text style={[s.statLabel, { color: dc.cardText }]}>CODE</Text>
          <Text style={[s.statValue, { color: dc.cardText }]}>{game.join_code}</Text>
        </View>
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
          <Text style={s.enteredText}>Entered ✓</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#000', paddingTop: 56 },

  // Header
  header:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16 },
  headerSide:    { flex: 1 },
  headerCenter:  { alignItems: 'center', gap: 4 },
  logo:          { width: 28, height: 28 },
  headerSub:     { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 2 },

  // Join row
  joinRow:       { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 20 },
  joinInput:     { flex: 1, backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: '#fff', fontFamily: FFB, fontSize: 14, letterSpacing: 2 },
  joinBtn:       { backgroundColor: GOLD, borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center', alignItems: 'center' },
  joinBtnText:   { fontFamily: FFB, color: '#000', fontSize: 14 },

  // Section headers
  sectionLabel:  { fontFamily: FFB, fontSize: 10, color: '#fff', letterSpacing: 1.5, textTransform: 'uppercase', paddingHorizontal: 16, marginTop: 12, marginBottom: 8 },

  // Game card
  card:          { marginHorizontal: 16, marginBottom: 10, backgroundColor: '#111', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#1c1c1c' },
  cardOpen:      { borderLeftWidth: 3, borderLeftColor: PURPLE },
  cardTop:       { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  cardName:      { fontFamily: FFB, fontSize: 15, color: '#fff', marginBottom: 2 },
  cardSub:       { fontFamily: FFB, fontSize: 12, color: '#fff' },
  statusBadge:   { borderWidth: 1, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
  statusText:    { fontFamily: FFB, fontSize: 10, letterSpacing: 1 },

  // Stats row
  cardStats:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  statBlock:     { alignItems: 'center' },
  statLabel:     { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 1, marginBottom: 2 },
  statValue:     { fontFamily: FFB, fontSize: 14, color: '#fff' },

  // Entry count pill
  entryPill:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1c1c1c', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  pillLabel:     { fontFamily: FFB, fontSize: 11, color: '#fff' },
  pillCount:     { fontFamily: FFB, fontSize: 11, color: PURPLE },

  // Recurring badge
  recurringBadge: { backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: 99, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)' },
  recurringText:  { fontFamily: FFB, fontSize: 9, color: GOLD },

  // I'm in button
  imInBtn:       { marginTop: 10, backgroundColor: PURPLE, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  imInText:      { fontFamily: FFB, fontSize: 14, color: '#fff' },

  // Entered badge
  enteredBadge:  { marginTop: 10, backgroundColor: 'rgba(167,139,250,0.15)', borderRadius: 10, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: PURPLE },
  enteredText:   { fontFamily: FFB, fontSize: 13, color: PURPLE },

  // Empty state
  empty:         { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyEmoji:    { fontSize: 48 },
  emptyTitle:    { fontFamily: FFB, fontSize: 16, color: '#fff' },
  emptySub:      { fontFamily: FFB, fontSize: 13, color: '#444', textAlign: 'center', paddingHorizontal: 32 },
});
