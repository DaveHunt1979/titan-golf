import { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Alert, ActivityIndicator, Image, Animated, PanResponder } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { titanLogo } from '../../../src/lib/assets';
import { useChatUnread } from '../../../src/lib/useChatUnread';
import ConfirmDialog from '../../../src/components/ConfirmDialog';

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
  created_by: string;
  entry_count?: number;
  am_entered?: boolean;
};

export default function SwindleIndex() {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  useFocusEffect(useCallback(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); }, []));
  const dc = useDynamicColors();
  const { localLogo, logoUrl, societyId } = useSocietyTheme() as any;
  const [games,    setGames]    = useState<Game[]>([]);
  const [myId,     setMyId]     = useState<string | null>(null);
  const chatUnread = useChatUnread('swindle', societyId, myId);
  const [loading,  setLoading]  = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [joining,  setJoining]  = useState(false);
  const [imInBusy,    setImInBusy]    = useState<string | null>(null);
  const [isMember,    setIsMember]    = useState<boolean | null>(null);
  const [gateCode,    setGateCode]    = useState('');
  const [gateJoining, setGateJoining] = useState(false);
  const [deletingId,  setDeletingId]  = useState<string | null>(null);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  useEffect(() => { init(); }, []);

  if (loading || !fontsLoaded || isMember === null) return (
    <View style={{ flex: 1, backgroundColor: dc.bg, alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" />
      <ActivityIndicator color={dc.gold} size="large" />
    </View>
  );

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    let pid: string | null = null;
    if (user) {
      const { data: p } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (p) { pid = p.id; setMyId(p.id); }
    }
    if (societyId && pid) {
      const { data: mem } = await supabase
        .from('society_members').select('membership_types')
        .eq('society_id', societyId).eq('player_id', pid).maybeSingle();
      const types: string[] = (mem?.membership_types ?? []) as string[];
      if (!types.includes('swindle')) { setIsMember(false); setLoading(false); return; }
      setIsMember(true);
    } else {
      setIsMember(true);
    }
    await loadGames(pid);
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

  async function deleteGame() {
    if (!deletingId) return;
    const id = deletingId;
    setDeletingId(null);
    const { error } = await supabase.from('swindle_games').delete().eq('id', id);
    if (error) { Alert.alert('Error', error.message); return; }
    setGames(gs => gs.filter(g => g.id !== id));
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

  async function joinSwindle() {
    const code = gateCode.trim().toUpperCase();
    if (!code || !societyId) return;
    setGateJoining(true);
    const { data: soc } = await supabase.from('societies').select('swindle_join_code').eq('id', societyId).maybeSingle();
    if (!soc || (soc.swindle_join_code ?? '').toUpperCase() !== code) {
      Alert.alert('Invalid code', 'That access code is not correct. Ask your society admin.');
      setGateJoining(false);
      return;
    }
    if (myId) {
      const { data: mem } = await supabase
        .from('society_members').select('membership_types')
        .eq('society_id', societyId).eq('player_id', myId).maybeSingle();
      const types: string[] = (mem?.membership_types ?? []) as string[];
      if (!types.includes('swindle')) types.push('swindle');
      await supabase.from('society_members').update({ membership_types: types })
        .eq('society_id', societyId).eq('player_id', myId);
    }
    setIsMember(true);
    setGateJoining(false);
    await loadGames(myId);
  }

  const open     = games.filter(g => g.status === 'open' || g.status === 'in_progress');
  const complete = games.filter(g => g.status === 'complete');

  if (!isMember) return (
    <View style={{ flex: 1, backgroundColor: dc.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <StatusBar style="light" />
      <Image source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)} style={{ width: 52, height: 52, marginBottom: 20 }} />
      <View style={{ backgroundColor: PURPLE + '22', borderRadius: 99, paddingHorizontal: 16, paddingVertical: 6, borderWidth: 1, borderColor: PURPLE + '55', marginBottom: 20 }}>
        <Text style={{ fontFamily: FFB, fontSize: 12, color: PURPLE, letterSpacing: 1 }}>INVITE ONLY</Text>
      </View>
      <Text style={{ fontFamily: FFB, fontSize: 22, color: dc.cardText, textAlign: 'center', marginBottom: 10 }}>The Swindle</Text>
      <Text style={{ fontFamily: FFB, fontSize: 13, color: '#555', textAlign: 'center', lineHeight: 22, marginBottom: 32 }}>
        This swindle is exclusive to invited members.{'\n'}Enter your access code to continue.
      </Text>
      <TextInput
        style={{ width: '100%', backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 14, fontFamily: FFB, fontSize: 20, color: '#fff', letterSpacing: 4, textAlign: 'center', marginBottom: 14 }}
        placeholder="ACCESS CODE"
        placeholderTextColor="#333"
        value={gateCode}
        onChangeText={t => setGateCode(t.toUpperCase())}
        autoCapitalize="characters"
        maxLength={10}
      />
      <TouchableOpacity
        style={{ width: '100%', backgroundColor: PURPLE, borderRadius: 12, paddingVertical: 16, alignItems: 'center', opacity: gateJoining ? 0.6 : 1 }}
        onPress={joinSwindle}
        disabled={gateJoining}
        activeOpacity={0.85}
      >
        <Text style={{ fontFamily: FFB, fontSize: 16, color: '#fff' }}>{gateJoining ? 'Checking…' : 'Join The Swindle'}</Text>
      </TouchableOpacity>
    </View>
  );

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
        <View style={[s.headerSide, { alignItems: 'flex-end' }]}>
          <TouchableOpacity onPress={() => router.push('/(app)/chat/swindle' as any)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chatbubbles-outline" size={22} color={dc.gold} />
            {chatUnread > 0 && (
              <View style={s.chatBadge}>
                <Text style={s.chatBadgeText}>{chatUnread > 9 ? '9+' : chatUnread}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
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
              <SwipeableRow key={g.id} enabled={g.created_by === myId} onDelete={() => setDeletingId(g.id)}>
                <GameCard
                  game={g}
                  bare={g.created_by === myId}
                  onPress={() => router.push(`/(app)/swindle/${g.id}` as any)}
                  onImIn={() => imIn(g)}
                  imInBusy={imInBusy === g.id}
                />
              </SwipeableRow>
            ))}
          </>
        )}
        {complete.length > 0 && (
          <>
            <Text style={[s.sectionLabel, { color: dc.cardText }]}>COMPLETED</Text>
            {complete.map(g => (
              <SwipeableRow key={g.id} enabled={g.created_by === myId} onDelete={() => setDeletingId(g.id)}>
                <GameCard game={g} bare={g.created_by === myId} onPress={() => router.push(`/(app)/swindle/${g.id}` as any)} />
              </SwipeableRow>
            ))}
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

      <ConfirmDialog
        visible={deletingId !== null}
        title="Delete Swindle"
        message="Delete this swindle? Entries, scores and groups all go with it — this cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={deleteGame}
        onCancel={() => setDeletingId(null)}
      />
    </View>
  );
}

const SWIPE_W = 76;

// Pure-JS swipe-to-delete — react-native-gesture-handler isn't installed in
// this project (only an optional peer dep of expo-router), so Swipeable
// would need a new native module + pod install + rebuild before it'd even
// show up in the sim. PanResponder needs no native dep, works immediately.
function SwipeableRow({ children, enabled, onDelete }: { children: React.ReactNode; enabled: boolean; onDelete: () => void }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => enabled && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => {
        const base = isOpen.current ? -SWIPE_W : 0;
        translateX.setValue(Math.max(-SWIPE_W, Math.min(0, base + g.dx)));
      },
      onPanResponderRelease: (_, g) => {
        const base = isOpen.current ? -SWIPE_W : 0;
        const shouldOpen = base + g.dx < -SWIPE_W / 2;
        isOpen.current = shouldOpen;
        Animated.spring(translateX, { toValue: shouldOpen ? -SWIPE_W : 0, useNativeDriver: true, bounciness: 0 }).start();
      },
    })
  ).current;

  if (!enabled) return <>{children}</>;

  return (
    <View style={{ marginHorizontal: 16, marginBottom: 10 }}>
      <View style={sw.deleteWrap}>
        <TouchableOpacity style={sw.deleteBtn} onPress={onDelete} activeOpacity={0.8}>
          <Ionicons name="trash-outline" size={18} color="#fff" />
          <Text style={sw.deleteText}>Delete</Text>
        </TouchableOpacity>
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const sw = StyleSheet.create({
  deleteWrap: { position: 'absolute', top: 0, bottom: 0, right: 0, width: SWIPE_W, borderRadius: 14, overflow: 'hidden' },
  deleteBtn:  { flex: 1, backgroundColor: '#f87171', alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: '#fff', fontFamily: FFB, fontSize: 11, marginTop: 2 },
});

function GameCard({ game, onPress, onImIn, imInBusy, bare }: {
  game: Game; onPress: () => void; onImIn?: () => void; imInBusy?: boolean; bare?: boolean;
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
      style={[s.card, { backgroundColor: dc.card, borderColor: dc.border }, isOpen && s.cardOpen, bare && { marginHorizontal: 0, marginBottom: 0 }]}
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
  chatBadge: {
    position: 'absolute', top: -4, right: -6,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#D4AF37', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  chatBadgeText: { fontFamily: FFB, fontSize: 9, color: '#000' },
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
