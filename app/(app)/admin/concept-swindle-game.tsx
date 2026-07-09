/**
 * Concept Preview — TITAN premium Swindle game detail
 * Mock data — shows design only
 */
import { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';

const GOLD    = '#D4AF37';
const GREEN   = '#4ade80';
const RED     = '#f87171';
const SILVER  = '#9ca3af';
const BRONZE  = '#cd7f32';
const PURPLE  = '#a78bfa';
const FF      = 'JUSTSans';
const FFB     = 'JUSTSans-ExBold';

// ── Mock data ─────────────────────────────────────────────────
const GAME = {
  name: 'Tuesday Swindle',
  course: 'West Cliffs',
  date: '8 Jul 2025',
  format: 'Stableford',
  status: 'in_progress',
  entry: 5,
  currency: '£',
  players: 12,
  joinCode: 'SW8X2K',
  isRecurring: true,
  twosEnabled: true,
  ntpHole: 5,
  ldHole: 14,
  prizeSplit: [50, 30, 20],
};

const POT         = GAME.entry * GAME.players;
const TWOS_POT    = 2 * GAME.players;
const PRIZE_AMTS  = GAME.prizeSplit.map(p => Math.round((POT * p) / 100));

const LEADERBOARD = [
  { rank: 1,  name: 'Ricky Snell',      pts: 38, thru: 18, hasTwos: true  },
  { rank: 2,  name: 'Dave Hunt',        pts: 35, thru: 18, hasTwos: false },
  { rank: 3,  name: 'Brad Kiddell',     pts: 34, thru: 18, hasTwos: false },
  { rank: 4,  name: 'Chris Johnson',    pts: 33, thru: 15, hasTwos: false },
  { rank: 5,  name: 'George Lings',     pts: 31, thru: 14, hasTwos: true  },
  { rank: 6,  name: 'Darren Moorhouse', pts: 30, thru: 14, hasTwos: false },
  { rank: 7,  name: 'Kev Bedford',      pts: 29, thru: 12, hasTwos: false },
  { rank: 8,  name: 'Stuart Brown',     pts: 28, thru: 12, hasTwos: false },
  { rank: 9,  name: 'Tom Chandler',     pts: 27, thru: 9,  hasTwos: false },
  { rank: 10, name: 'Ross Snell',       pts: 26, thru: 9,  hasTwos: false },
  { rank: 11, name: 'Steve Taylor',     pts: 0,  thru: 0,  hasTwos: false },
  { rank: 12, name: 'Joe Bond',         pts: 0,  thru: 0,  hasTwos: false },
];

const TWOS_WINNERS = LEADERBOARD.filter(p => p.hasTwos);

export default function ConceptSwindleGameScreen() {
  const router = useRouter();
  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });
  const [tab, setTab] = useState<'leaderboard' | 'pots'>('leaderboard');

  if (!fontsLoaded) return null;

  const isLive = GAME.status === 'in_progress';
  const isDone = GAME.status === 'complete';
  const twosShare = TWOS_WINNERS.length > 0 ? Math.round(TWOS_POT / TWOS_WINNERS.length) : TWOS_POT;

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={s.headerSide}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={require('../../../assets/TitanAppLogo.png')} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerSub}>SWINDLE</Text>
        </View>
        <TouchableOpacity style={s.headerSide} onPress={() => {}}>
          <Ionicons name="share-outline" size={22} color={GOLD} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

        {/* ── Game hero card ── */}
        <View style={s.heroCard}>
          {/* Status badge row */}
          <View style={s.heroBadgeRow}>
            <View style={[s.statusBadge, { borderColor: isLive ? GREEN : GOLD, backgroundColor: isLive ? `${GREEN}12` : `${GOLD}12` }]}>
              {isLive && <View style={s.livePulse} />}
              <Text style={[s.statusText, { color: isLive ? GREEN : GOLD }]}>
                {isLive ? 'LIVE' : isDone ? 'COMPLETED' : 'OPEN'}
              </Text>
            </View>
            {GAME.isRecurring && (
              <View style={s.recurBadge}>
                <Ionicons name="repeat-outline" size={10} color={GOLD} />
                <Text style={s.recurText}>Weekly · Tue</Text>
              </View>
            )}
            <View style={{ flex: 1 }} />
            <Text style={s.joinCodeText}>{GAME.joinCode}</Text>
          </View>

          <Text style={s.heroName}>{GAME.name}</Text>
          <Text style={s.heroCourse}>{GAME.course} · {GAME.date} · {GAME.format}</Text>

          {/* Big pot */}
          <View style={s.potHero}>
            <Text style={s.potHeroLabel}>TOTAL POT</Text>
            <Text style={s.potHeroAmount}>{GAME.currency}{POT}</Text>
            <Text style={s.potHeroSub}>{GAME.players} players · {GAME.currency}{GAME.entry} entry</Text>
          </View>
        </View>

        {/* ── Prize podium ── */}
        <Text style={s.sectionLabel}>PRIZE MONEY</Text>
        <View style={s.podiumRow}>
          {/* 2nd */}
          <View style={[s.podiumCard, { marginTop: 24 }]}>
            <Text style={s.podiumPos}>2nd</Text>
            <View style={[s.podiumMedal, { backgroundColor: `${SILVER}15`, borderColor: `${SILVER}40` }]}>
              <Text style={[s.podiumMedalNum, { color: SILVER }]}>2</Text>
            </View>
            <Text style={[s.podiumAmount, { color: SILVER }]}>{GAME.currency}{PRIZE_AMTS[1]}</Text>
            <Text style={s.podiumPct}>{GAME.prizeSplit[1]}%</Text>
            <Text style={s.podiumWinner} numberOfLines={1}>D. Hunt</Text>
          </View>

          {/* 1st — taller */}
          <View style={[s.podiumCard, s.podiumCardGold]}>
            <Text style={[s.podiumPos, { color: GOLD }]}>1st</Text>
            <View style={[s.podiumMedal, { backgroundColor: `${GOLD}20`, borderColor: `${GOLD}50`, width: 52, height: 52, borderRadius: 26 }]}>
              <Text style={[s.podiumMedalNum, { color: GOLD, fontSize: 22 }]}>1</Text>
            </View>
            <Text style={[s.podiumAmount, { color: GOLD, fontSize: 30 }]}>{GAME.currency}{PRIZE_AMTS[0]}</Text>
            <Text style={[s.podiumPct, { color: `${GOLD}70` }]}>{GAME.prizeSplit[0]}%</Text>
            <Text style={[s.podiumWinner, { color: '#e5e7eb' }]} numberOfLines={1}>R. Snell</Text>
          </View>

          {/* 3rd */}
          <View style={[s.podiumCard, { marginTop: 40 }]}>
            <Text style={s.podiumPos}>3rd</Text>
            <View style={[s.podiumMedal, { backgroundColor: `${BRONZE}15`, borderColor: `${BRONZE}40` }]}>
              <Text style={[s.podiumMedalNum, { color: BRONZE }]}>3</Text>
            </View>
            <Text style={[s.podiumAmount, { color: BRONZE }]}>{GAME.currency}{PRIZE_AMTS[2]}</Text>
            <Text style={s.podiumPct}>{GAME.prizeSplit[2]}%</Text>
            <Text style={s.podiumWinner} numberOfLines={1}>B. Kiddell</Text>
          </View>
        </View>

        {/* ── Side pots ── */}
        <Text style={[s.sectionLabel, { marginTop: 20 }]}>SIDE POTS</Text>
        <View style={s.sidePotsRow}>
          {/* Two's */}
          <View style={[s.sidePotCard, { flex: 1 }]}>
            <Text style={s.sidePotTitle}>TWOS</Text>
            <Text style={[s.sidePotAmt, { color: PURPLE }]}>{GAME.currency}{TWOS_POT}</Text>
            {TWOS_WINNERS.length > 0 ? (
              <>
                <Text style={s.sidePotWinLabel}>{TWOS_WINNERS.length} winner{TWOS_WINNERS.length > 1 ? 's' : ''}</Text>
                <Text style={[s.sidePotWinAmt, { color: PURPLE }]}>{GAME.currency}{twosShare} each</Text>
                {TWOS_WINNERS.map(w => (
                  <Text key={w.name} style={s.sidePotWinner}>{w.name.split(' ')[0]}</Text>
                ))}
              </>
            ) : (
              <Text style={s.sidePotTbd}>In play</Text>
            )}
          </View>

          <View style={{ gap: 8, flex: 1 }}>
            {/* NTP */}
            <View style={s.sidePotCard}>
              <Text style={s.sidePotTitle}>NTP · H{GAME.ntpHole}</Text>
              <Text style={[s.sidePotAmt, { color: GREEN }]}>{GAME.currency}{Math.round(GAME.entry * GAME.players * 0.1)}</Text>
              <Text style={s.sidePotTbd}>TBD</Text>
            </View>
            {/* LD */}
            <View style={s.sidePotCard}>
              <Text style={s.sidePotTitle}>LD · H{GAME.ldHole}</Text>
              <Text style={[s.sidePotAmt, { color: GOLD }]}>{GAME.currency}{Math.round(GAME.entry * GAME.players * 0.1)}</Text>
              <Text style={s.sidePotTbd}>TBD</Text>
            </View>
          </View>
        </View>

        {/* ── Tab switcher ── */}
        <View style={s.tabs}>
          <TouchableOpacity
            style={[s.tab, tab === 'leaderboard' && s.tabActive]}
            onPress={() => setTab('leaderboard')}
            activeOpacity={0.7}
          >
            <Text style={[s.tabText, tab === 'leaderboard' && s.tabTextActive]}>Leaderboard</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tab, tab === 'pots' && s.tabActive]}
            onPress={() => setTab('pots')}
            activeOpacity={0.7}
          >
            <Text style={[s.tabText, tab === 'pots' && s.tabTextActive]}>Breakdown</Text>
          </TouchableOpacity>
        </View>

        {/* ── Leaderboard ── */}
        {tab === 'leaderboard' && (
          <View style={s.lbCard}>
            {/* Header row */}
            <View style={s.lbHeaderRow}>
              <Text style={[s.lbCol, { width: 32 }]}>#</Text>
              <Text style={[s.lbCol, { flex: 1 }]}>PLAYER</Text>
              <Text style={[s.lbCol, { width: 36, textAlign: 'center' }]}>PTS</Text>
              <Text style={[s.lbCol, { width: 36, textAlign: 'center' }]}>THRU</Text>
              <Text style={[s.lbCol, { width: 44, textAlign: 'right' }]}>PRIZE</Text>
            </View>

            {LEADERBOARD.map((p, i) => {
              const rankColor = p.rank === 1 ? GOLD : p.rank === 2 ? SILVER : p.rank === 3 ? BRONZE : '#374151';
              const isMe = p.name === 'Dave Hunt';
              const prize = p.rank <= 3 ? `${GAME.currency}${PRIZE_AMTS[p.rank - 1]}` : '—';
              const thruText = p.thru === 18 ? 'F' : p.thru === 0 ? '-' : String(p.thru);
              return (
                <View
                  key={p.name}
                  style={[
                    s.lbRow,
                    i < LEADERBOARD.length - 1 && s.lbRowBorder,
                    isMe && s.lbRowMe,
                    p.rank === 1 && s.lbRowLeader,
                  ]}
                >
                  <View style={[s.rankBadge, { backgroundColor: `${rankColor}15`, borderColor: `${rankColor}30` }]}>
                    <Text style={[s.rankNum, { color: rankColor }]}>{p.rank}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.lbName, isMe && { color: GOLD }]}>{p.name}</Text>
                    {p.hasTwos && (
                      <Text style={s.lbTwosTag}>⑇ 2s</Text>
                    )}
                  </View>
                  <Text style={[s.lbPts, { width: 36, textAlign: 'center' }, p.thru === 0 && { color: '#374151' }]}>
                    {p.thru === 0 ? '-' : p.pts}
                  </Text>
                  <Text style={[s.lbThru, { width: 36, textAlign: 'center' }]}>{thruText}</Text>
                  <Text style={[s.lbPrize, { width: 44, textAlign: 'right' }, p.rank <= 3 && { color: p.rank === 1 ? GOLD : p.rank === 2 ? SILVER : BRONZE }]}>
                    {prize}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Breakdown tab ── */}
        {tab === 'pots' && (
          <View style={s.lbCard}>
            <Text style={s.breakdownTitle}>Money breakdown</Text>
            {[
              { label: '1st Place',      pct: GAME.prizeSplit[0], amt: PRIZE_AMTS[0], color: GOLD },
              { label: '2nd Place',      pct: GAME.prizeSplit[1], amt: PRIZE_AMTS[1], color: SILVER },
              { label: '3rd Place',      pct: GAME.prizeSplit[2], amt: PRIZE_AMTS[2], color: BRONZE },
              { label: "Two's Pot",      pct: null,               amt: TWOS_POT,     color: PURPLE },
              { label: 'NTP – Hole 5',  pct: null,               amt: Math.round(GAME.entry * GAME.players * 0.1), color: GREEN },
              { label: 'LD – Hole 14',  pct: null,               amt: Math.round(GAME.entry * GAME.players * 0.1), color: GOLD },
            ].map((row, i, arr) => (
              <View key={row.label} style={[s.breakdownRow, i < arr.length - 1 && s.lbRowBorder]}>
                <View style={[s.breakdownDot, { backgroundColor: row.color }]} />
                <Text style={s.breakdownLabel}>{row.label}</Text>
                {row.pct && <Text style={s.breakdownPct}>{row.pct}%</Text>}
                <Text style={[s.breakdownAmt, { color: row.color }]}>{GAME.currency}{row.amt}</Text>
              </View>
            ))}
            <View style={s.breakdownTotal}>
              <Text style={s.breakdownTotalLabel}>Total pot</Text>
              <Text style={s.breakdownTotalAmt}>{GAME.currency}{POT}</Text>
            </View>
          </View>
        )}

        {/* ── Actions ── */}
        <View style={s.actions}>
          <TouchableOpacity style={s.scoreBtn} activeOpacity={0.85}>
            <Ionicons name="golf-outline" size={20} color="#000" />
            <Text style={s.scoreBtnText}>Score My Round</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.shareBtn} activeOpacity={0.85}>
            <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
            <Text style={s.shareBtnText}>Share Results</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 48 }} />
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
  headerSide:   { width: 40 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerLogo:   { width: 26, height: 26, marginBottom: 2 },
  headerSub:    { fontFamily: FFB, fontSize: 10, color: GOLD, letterSpacing: 2.5 },

  // Hero card
  heroCard: {
    backgroundColor: '#111111', borderRadius: 16,
    borderWidth: 1, borderColor: '#1c1c1c',
    padding: 16, marginBottom: 16,
  },
  heroBadgeRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
  },
  livePulse:  { width: 6, height: 6, borderRadius: 3, backgroundColor: GREEN },
  statusText: { fontFamily: FFB, fontSize: 9, letterSpacing: 1.5 },
  recurBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: `${GOLD}0d`, borderWidth: 1, borderColor: `${GOLD}30`,
    borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3,
  },
  recurText:    { fontFamily: FF, fontSize: 10, color: GOLD },
  joinCodeText: { fontFamily: FFB, fontSize: 12, color: '#2d2d2d', letterSpacing: 2 },

  heroName:   { fontFamily: FFB, fontSize: 24, color: '#ffffff', marginBottom: 3 },
  heroCourse: { fontFamily: FF, fontSize: 12, color: '#6b7280', marginBottom: 16 },

  potHero: {
    alignItems: 'center', paddingVertical: 16,
    backgroundColor: '#0a0a0a', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c',
  },
  potHeroLabel:  { fontFamily: FF, fontSize: 9, color: '#6b7280', letterSpacing: 2, marginBottom: 4 },
  potHeroAmount: { fontFamily: FFB, fontSize: 56, color: GOLD, lineHeight: 60, letterSpacing: -2 },
  potHeroSub:    { fontFamily: FF, fontSize: 11, color: '#6b7280', marginTop: 4 },

  // Section label
  sectionLabel: {
    fontFamily: FF, fontSize: 10, color: GOLD,
    letterSpacing: 2, marginBottom: 10,
  },

  // Podium
  podiumRow:     { flexDirection: 'row', gap: 8, marginBottom: 0 },
  podiumCard: {
    flex: 1, backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c',
    padding: 12, alignItems: 'center', gap: 6,
  },
  podiumCardGold: { borderColor: `${GOLD}40`, backgroundColor: '#121008' },
  podiumPos:  { fontFamily: FF, fontSize: 10, color: '#6b7280', letterSpacing: 1 },
  podiumMedal: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  podiumMedalNum:{ fontFamily: FFB, fontSize: 18 },
  podiumAmount:  { fontFamily: FFB, fontSize: 22, marginTop: 2 },
  podiumPct:     { fontFamily: FF, fontSize: 10, color: '#4b5563' },
  podiumWinner:  { fontFamily: FF, fontSize: 11, color: '#9ca3af', textAlign: 'center' },

  // Side pots
  sidePotsRow:  { flexDirection: 'row', gap: 8, marginBottom: 0 },
  sidePotCard: {
    backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c',
    padding: 14,
  },
  sidePotTitle:   { fontFamily: FF, fontSize: 9, color: '#6b7280', letterSpacing: 1.5, marginBottom: 4 },
  sidePotAmt:     { fontFamily: FFB, fontSize: 22 },
  sidePotTbd:     { fontFamily: FF, fontSize: 11, color: '#374151', marginTop: 4 },
  sidePotWinLabel:{ fontFamily: FF, fontSize: 10, color: '#9ca3af', marginTop: 4 },
  sidePotWinAmt:  { fontFamily: FFB, fontSize: 14 },
  sidePotWinner:  { fontFamily: FF, fontSize: 11, color: '#9ca3af' },

  // Tabs
  tabs: {
    flexDirection: 'row', marginTop: 20, marginBottom: 10,
    backgroundColor: '#111111', borderRadius: 12, padding: 4,
    borderWidth: 1, borderColor: '#1c1c1c',
  },
  tab:           { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 9 },
  tabActive:     { backgroundColor: '#1c1c1c' },
  tabText:       { fontFamily: FF, fontSize: 13, color: '#6b7280' },
  tabTextActive: { color: '#ffffff', fontFamily: FFB },

  // Leaderboard
  lbCard: {
    backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden',
  },
  lbHeaderRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
    backgroundColor: '#0a0a0a',
  },
  lbCol: { fontFamily: FF, fontSize: 9, color: '#4b5563', letterSpacing: 1.5 },
  lbRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12, gap: 10,
  },
  lbRowBorder:  { borderBottomWidth: 1, borderBottomColor: '#141414' },
  lbRowMe:      { backgroundColor: `${GOLD}07` },
  lbRowLeader:  { backgroundColor: `${GOLD}05` },
  rankBadge: {
    width: 26, height: 26, borderRadius: 8,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  rankNum:  { fontFamily: FFB, fontSize: 12 },
  lbName:   { fontFamily: FF, fontSize: 14, color: '#e5e7eb' },
  lbTwosTag:{ fontFamily: FFB, fontSize: 9, color: PURPLE, letterSpacing: 0.5, marginTop: 1 },
  lbPts:    { fontFamily: FFB, fontSize: 16, color: '#ffffff' },
  lbThru:   { fontFamily: FF, fontSize: 12, color: '#6b7280' },
  lbPrize:  { fontFamily: FFB, fontSize: 13, color: '#374151' },

  // Breakdown
  breakdownTitle:   { fontFamily: FF, fontSize: 10, color: '#6b7280', letterSpacing: 1.5, padding: 14, paddingBottom: 10 },
  breakdownRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  breakdownDot:     { width: 8, height: 8, borderRadius: 4 },
  breakdownLabel:   { fontFamily: FF, fontSize: 13, color: '#9ca3af', flex: 1 },
  breakdownPct:     { fontFamily: FF, fontSize: 12, color: '#4b5563' },
  breakdownAmt:     { fontFamily: FFB, fontSize: 15 },
  breakdownTotal: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: '#1c1c1c',
    backgroundColor: '#0a0a0a',
  },
  breakdownTotalLabel: { fontFamily: FF, fontSize: 11, color: '#6b7280', letterSpacing: 1 },
  breakdownTotalAmt:   { fontFamily: FFB, fontSize: 20, color: GOLD },

  // Actions
  actions: { gap: 10, marginTop: 16 },
  scoreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16,
  },
  scoreBtnText: { fontFamily: FFB, fontSize: 16, color: '#000000' },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#0a1f0c', borderWidth: 1, borderColor: '#1a3d1f',
    borderRadius: 14, paddingVertical: 14,
  },
  shareBtnText: { fontFamily: FFB, fontSize: 14, color: '#25D366' },
});
