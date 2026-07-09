/**
 * Concept Preview — TITAN premium Swindle lobby
 * Mock data — shows design only
 */
import { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Image, TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';

const GOLD    = '#D4AF37';
const GREEN   = '#4ade80';
const PURPLE  = '#a78bfa';
const FF      = 'JUSTSans';
const FFB     = 'JUSTSans-ExBold';

// ── Mock data ─────────────────────────────────────────────────
const LIVE_GAMES = [
  {
    id: 'g1', name: 'Tuesday Swindle', course: 'West Cliffs',
    date: '8 Jul', status: 'in_progress', entry: 5, currency: '£',
    players: 8, joinCode: 'SW8X2K', amIn: true, isRecurring: true, day: 'Tue',
  },
  {
    id: 'g2', name: 'Saturday Roll-Up', course: 'Roserrow',
    date: '12 Jul', status: 'open', entry: 3, currency: '£',
    players: 4, joinCode: 'RU4P9M', amIn: false, isRecurring: true, day: 'Sat',
  },
];
const DONE_GAMES = [
  {
    id: 'g3', name: 'Tuesday Swindle', course: 'West Cliffs',
    date: '1 Jul', status: 'complete', entry: 5, currency: '£',
    players: 10, joinCode: 'TU5A1B', amIn: true, isRecurring: false, day: null,
  },
  {
    id: 'g4', name: 'Bank Holiday Special', course: 'Trevose',
    date: '26 May', status: 'complete', entry: 10, currency: '£',
    players: 12, joinCode: 'BH9ZX3', amIn: false, isRecurring: false, day: null,
  },
];

export default function ConceptSwindleScreen() {
  const router = useRouter();
  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });
  const [joinCode, setJoinCode] = useState('');
  const [imInBusy, setImInBusy] = useState<string | null>(null);

  if (!fontsLoaded) return null;

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerSide} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={require('../../../assets/TitanAppLogo.png')} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerSub}>Swindle</Text>
        </View>
        <TouchableOpacity style={[s.headerSide, { alignItems: 'flex-end' }]}>
          <View style={s.createBtn}>
            <Ionicons name="add" size={16} color="#000" />
            <Text style={s.createBtnText}>Create</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* ── Join code bar ── */}
      <View style={s.joinRow}>
        <View style={s.joinInputWrap}>
          <Ionicons name="key-outline" size={16} color="#6b7280" style={{ marginLeft: 12 }} />
          <TextInput
            style={s.joinInput}
            placeholder="Enter join code…"
            placeholderTextColor="#4b5563"
            value={joinCode}
            onChangeText={t => setJoinCode(t.toUpperCase())}
            autoCapitalize="characters"
            maxLength={6}
          />
        </View>
        <TouchableOpacity style={[s.joinBtn, !joinCode && { opacity: 0.4 }]} activeOpacity={0.8} disabled={!joinCode}>
          <Text style={s.joinBtnText}>Join</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

        {/* ── Live & Open ── */}
        <Text style={s.sectionLabel}>LIVE & OPEN</Text>
        {LIVE_GAMES.map(g => {
          const pot = g.entry * g.players;
          const isLive = g.status === 'in_progress';
          return (
            <TouchableOpacity
              key={g.id}
              style={[s.card, isLive && s.cardLive]}
              onPress={() => {}}
              activeOpacity={0.88}
            >
              {/* Status + recurring */}
              <View style={s.cardBadgeRow}>
                <View style={[s.statusBadge, { borderColor: isLive ? GREEN : GOLD, backgroundColor: isLive ? `${GREEN}12` : `${GOLD}12` }]}>
                  {isLive && <View style={s.livePulse} />}
                  <Text style={[s.statusText, { color: isLive ? GREEN : GOLD }]}>
                    {isLive ? 'LIVE' : 'OPEN'}
                  </Text>
                </View>
                {g.isRecurring && (
                  <View style={s.recurBadge}>
                    <Ionicons name="repeat-outline" size={10} color={GOLD} />
                    <Text style={s.recurText}>{g.day}</Text>
                  </View>
                )}
                <Text style={s.cardCode}>{g.joinCode}</Text>
              </View>

              {/* Name + course */}
              <Text style={s.cardName}>{g.name}</Text>
              <Text style={s.cardCourse}>{g.course} · {g.date}</Text>

              {/* Pot hero */}
              <View style={s.potRow}>
                <View style={s.potBlock}>
                  <Text style={s.potLabel}>POT</Text>
                  <Text style={s.potAmount}>{g.currency}{pot}</Text>
                </View>
                <View style={s.potDivider} />
                <View style={s.potStat}>
                  <Text style={s.potStatLabel}>ENTRY</Text>
                  <Text style={s.potStatVal}>{g.currency}{g.entry}</Text>
                </View>
                <View style={s.potDivider} />
                <View style={s.potStat}>
                  <Text style={s.potStatLabel}>PLAYERS</Text>
                  <Text style={s.potStatVal}>{g.players}</Text>
                </View>
              </View>

              {/* CTA */}
              {g.amIn ? (
                <View style={s.enteredRow}>
                  <Ionicons name="checkmark-circle" size={16} color={GREEN} />
                  <Text style={s.enteredText}>You're in</Text>
                  <TouchableOpacity style={s.scoreRoundBtn} activeOpacity={0.8}>
                    <Text style={s.scoreRoundText}>Score Round →</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={s.imInBtn}
                  onPress={() => setImInBusy(g.id)}
                  disabled={imInBusy === g.id}
                  activeOpacity={0.85}
                >
                  <Ionicons name="golf-outline" size={16} color="#000" />
                  <Text style={s.imInText}>{imInBusy === g.id ? 'Joining…' : "I'm In!"}</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          );
        })}

        {/* ── Completed ── */}
        <Text style={[s.sectionLabel, { marginTop: 24 }]}>COMPLETED</Text>
        {DONE_GAMES.map(g => {
          const pot = g.entry * g.players;
          return (
            <TouchableOpacity key={g.id} style={s.doneCard} activeOpacity={0.85} onPress={() => {}}>
              <View style={{ flex: 1 }}>
                <Text style={s.doneCardName}>{g.name}</Text>
                <Text style={s.doneCardSub}>{g.course} · {g.date} · {g.players} players</Text>
              </View>
              <View style={s.doneCardRight}>
                <Text style={s.doneCardPot}>{g.currency}{pot}</Text>
                <Ionicons name="chevron-forward" size={14} color="#444" />
              </View>
            </TouchableOpacity>
          );
        })}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#000000' },
  scroll: { paddingHorizontal: 16, paddingBottom: 48 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12,
  },
  headerSide:   { width: 80 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerLogo:   { width: 28, height: 28, marginBottom: 2 },
  headerSub:    { fontFamily: FFB, fontSize: 11, color: GOLD, letterSpacing: 2 },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: GOLD, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  createBtnText: { fontFamily: FFB, fontSize: 12, color: '#000' },

  // Join row
  joinRow: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 16, marginBottom: 20,
  },
  joinInputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#111111', borderRadius: 12,
    borderWidth: 1, borderColor: '#1c1c1c',
  },
  joinInput: {
    flex: 1, fontFamily: FFB, fontSize: 15, color: '#ffffff',
    paddingHorizontal: 10, paddingVertical: 12, letterSpacing: 3,
  },
  joinBtn: {
    backgroundColor: `${GOLD}15`, borderWidth: 1, borderColor: `${GOLD}50`,
    borderRadius: 12, paddingHorizontal: 18, justifyContent: 'center',
  },
  joinBtnText: { fontFamily: FFB, fontSize: 14, color: GOLD },

  // Section
  sectionLabel: {
    fontFamily: FF, fontSize: 10, color: GOLD,
    letterSpacing: 2, marginBottom: 10,
  },

  // Game card
  card: {
    backgroundColor: '#111111', borderRadius: 16,
    borderWidth: 1, borderColor: '#1c1c1c',
    padding: 16, marginBottom: 12,
  },
  cardLive: { borderColor: `${GREEN}30` },
  cardBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  livePulse:  { width: 6, height: 6, borderRadius: 3, backgroundColor: GREEN },
  statusText: { fontFamily: FFB, fontSize: 9, letterSpacing: 1.5 },
  recurBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: `${GOLD}0d`, borderWidth: 1, borderColor: `${GOLD}30`,
    borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3,
  },
  recurText: { fontFamily: FF, fontSize: 10, color: GOLD },
  cardCode: { fontFamily: FFB, fontSize: 12, color: '#374151', letterSpacing: 2, marginLeft: 'auto' },
  cardName:   { fontFamily: FFB, fontSize: 20, color: '#ffffff', marginBottom: 3 },
  cardCourse: { fontFamily: FF, fontSize: 12, color: '#6b7280', marginBottom: 14 },

  // Pot display
  potRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0a0a0a', borderRadius: 12,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingVertical: 12, paddingHorizontal: 16,
    marginBottom: 12, gap: 12,
  },
  potBlock:  { alignItems: 'center' },
  potLabel:  { fontFamily: FF, fontSize: 9, color: '#6b7280', letterSpacing: 1.5, marginBottom: 2 },
  potAmount: { fontFamily: FFB, fontSize: 32, color: GOLD, lineHeight: 36 },
  potDivider:{ width: 1, height: 28, backgroundColor: '#1c1c1c' },
  potStat:   { flex: 1, alignItems: 'center' },
  potStatLabel: { fontFamily: FF, fontSize: 9, color: '#6b7280', letterSpacing: 1.5, marginBottom: 2 },
  potStatVal:   { fontFamily: FFB, fontSize: 18, color: '#ffffff' },

  // I'm In / entered
  imInBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: GOLD, borderRadius: 12, paddingVertical: 13,
  },
  imInText: { fontFamily: FFB, fontSize: 15, color: '#000000' },
  enteredRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: `${GREEN}0d`, borderWidth: 1, borderColor: `${GREEN}30`,
    borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14,
  },
  enteredText:   { fontFamily: FF, fontSize: 13, color: GREEN, flex: 1 },
  scoreRoundBtn: { backgroundColor: `${GREEN}20`, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  scoreRoundText:{ fontFamily: FFB, fontSize: 12, color: GREEN },

  // Done cards
  doneCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0d0d0d', borderRadius: 12,
    borderWidth: 1, borderColor: '#1a1a1a',
    paddingVertical: 14, paddingHorizontal: 16, marginBottom: 8,
  },
  doneCardName:  { fontFamily: FF, fontSize: 15, color: '#9ca3af' },
  doneCardSub:   { fontFamily: FF, fontSize: 11, color: '#4b5563', marginTop: 2 },
  doneCardRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  doneCardPot:   { fontFamily: FFB, fontSize: 16, color: '#6b7280' },
});
