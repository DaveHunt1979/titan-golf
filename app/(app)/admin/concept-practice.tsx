/**
 * Concept Preview — TITAN premium Driving Range / Practice screen
 * Mock data — shows design only
 */
import { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';

const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const RED    = '#f87171';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';

// ── Mock data ─────────────────────────────────────────────────
const MOCK_STATS = { sessions: 24, shots: 847, longest: 312 };

const MOCK_CLUBS = [
  { club: 'Driver', avg: 285, max: 312 },
  { club: '3W',     avg: 248, max: 266 },
  { club: '5W',     avg: 226, max: 241 },
  { club: '4i',     avg: 198, max: 210 },
  { club: '5i',     avg: 186, max: 196 },
  { club: '6i',     avg: 172, max: 182 },
  { club: '7i',     avg: 158, max: 168 },
  { club: '8i',     avg: 146, max: 158 },
  { club: '9i',     avg: 132, max: 142 },
  { club: 'PW',     avg: 118, max: 128 },
  { club: 'GW',     avg: 104, max: 114 },
  { club: 'SW',     avg:  86, max:  96 },
  { club: 'LW',     avg:  72, max:  80 },
];

const MOCK_SESSIONS = [
  { id: '1', date: 'Today · Thu 3 Jul', shots: 42, top: 'Driver · 7i · PW' },
  { id: '2', date: 'Mon 30 Jun',        shots: 28, top: 'Driver · 5W · 9i' },
  { id: '3', date: 'Thu 26 Jun',        shots: 35, top: '6i · 7i · 8i · PW' },
  { id: '4', date: 'Mon 23 Jun',        shots: 19, top: 'Driver · 3W' },
];

const MAX_DIST = MOCK_CLUBS[0].avg;

export default function ConceptPracticeScreen() {
  const router = useRouter();
  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [tab, setTab] = useState<'bag' | 'sessions'>('bag');

  if (!fontsLoaded) return null;

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={s.headerSide}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Image source={require('../../../assets/TitanAppLogo.png')} style={s.headerLogo} resizeMode="contain" />
        <View style={s.headerSide} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

        {/* ── Title ── */}
        <Text style={s.pageTitle}>Driving Range</Text>
        <Text style={s.pageSub}>Track every shot. Build your bag profile.</Text>

        {/* ── Stats row ── */}
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statNum}>{MOCK_STATS.sessions}</Text>
            <Text style={s.statLabel}>SESSIONS</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statNum}>{MOCK_STATS.shots}</Text>
            <Text style={s.statLabel}>SHOTS</Text>
          </View>
          <View style={[s.statCard, { borderColor: `${GOLD}50` }]}>
            <Text style={[s.statNum, { color: GOLD }]}>{MOCK_STATS.longest}</Text>
            <Text style={[s.statLabel, { color: `${GOLD}80` }]}>LONGEST</Text>
            <Text style={[s.statLabel, { color: `${GOLD}60`, fontSize: 8 }]}>yds · Driver</Text>
          </View>
        </View>

        {/* ── Start Session CTA ── */}
        <TouchableOpacity style={s.ctaBtn} activeOpacity={0.85}>
          <View style={s.ctaLeft}>
            <Ionicons name="radio-outline" size={22} color="#000" />
            <View>
              <Text style={s.ctaTitle}>Start Range Session</Text>
              <Text style={s.ctaSub}>Log shots · Track distances · Build your bag</Text>
            </View>
          </View>
          <Ionicons name="arrow-forward" size={18} color="#000" />
        </TouchableOpacity>

        {/* ── Tab switcher ── */}
        <View style={s.tabs}>
          <TouchableOpacity style={[s.tab, tab === 'bag' && s.tabActive]} onPress={() => setTab('bag')} activeOpacity={0.7}>
            <Text style={[s.tabText, tab === 'bag' && s.tabTextActive]}>My Bag</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tab, tab === 'sessions' && s.tabActive]} onPress={() => setTab('sessions')} activeOpacity={0.7}>
            <Text style={[s.tabText, tab === 'sessions' && s.tabTextActive]}>Sessions</Text>
          </TouchableOpacity>
        </View>

        {/* ── My Bag tab ── */}
        {tab === 'bag' && (
          <View style={s.card}>
            <View style={s.bagHeader}>
              <Text style={s.bagHeaderLabel}>CLUB</Text>
              <View style={{ flex: 1 }} />
              <Text style={s.bagHeaderLabel}>AVG</Text>
              <Text style={[s.bagHeaderLabel, { width: 44, textAlign: 'right', marginRight: 2 }]}>MAX</Text>
            </View>
            {MOCK_CLUBS.map((c, i) => {
              const pct = c.avg / MAX_DIST;
              const maxPct = c.max / MAX_DIST;
              const isDriver = i === 0;
              return (
                <View key={c.club} style={[s.bagRow, i < MOCK_CLUBS.length - 1 && s.bagRowBorder]}>
                  <Text style={[s.clubName, isDriver && { color: GOLD }]}>{c.club}</Text>
                  <View style={s.barWrap}>
                    {/* Max tick */}
                    <View style={[s.maxTick, { left: `${maxPct * 100}%` as any }]} />
                    {/* Avg bar */}
                    <View style={[s.bar, { width: `${pct * 100}%` as any, backgroundColor: isDriver ? GOLD : '#3b82f6' }]} />
                  </View>
                  <Text style={[s.distAvg, isDriver && { color: GOLD }]}>{c.avg}</Text>
                  <Text style={s.distMax}>↑{c.max}</Text>
                </View>
              );
            })}
            <Text style={s.bagFooter}>Tap a club to see full distance history</Text>
          </View>
        )}

        {/* ── Sessions tab ── */}
        {tab === 'sessions' && (
          <View style={{ gap: 8 }}>
            {MOCK_SESSIONS.map((sess, i) => (
              <TouchableOpacity key={sess.id} style={s.sessCard} activeOpacity={0.8}>
                <View style={s.sessLeft}>
                  <View style={[s.sessIndicator, i === 0 && { backgroundColor: GOLD }]} />
                  <View>
                    <Text style={s.sessDate}>{sess.date}</Text>
                    <Text style={s.sessClubs}>{sess.top}</Text>
                  </View>
                </View>
                <View style={s.sessRight}>
                  <Text style={s.sessShots}>{sess.shots}</Text>
                  <Text style={s.sessShotsLabel}>shots</Text>
                  <Ionicons name="chevron-forward" size={14} color="#444" />
                </View>
              </TouchableOpacity>
            ))}
            <Text style={s.longPressHint}>Long press a session to delete</Text>
          </View>
        )}

        {/* ── Distance Legend ── */}
        <View style={s.legend}>
          <View style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: GOLD }]} />
            <Text style={s.legendText}>Average carry (Driver)</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: '#3b82f6' }]} />
            <Text style={s.legendText}>Average carry</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: '#374151', borderWidth: 1, borderColor: '#6b7280' }]} />
            <Text style={s.legendText}>Best ever (↑ tick)</Text>
          </View>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#000000' },
  scroll: { paddingBottom: 40 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingHorizontal: 16, paddingBottom: 8,
  },
  headerSide: { width: 40 },
  headerLogo: { width: 32, height: 32 },

  // Title
  pageTitle: { fontFamily: FFB, fontSize: 34, color: '#ffffff', paddingHorizontal: 16, letterSpacing: -0.5, marginTop: 4 },
  pageSub:   { fontFamily: FFB, fontSize: 13, color: '#fff', paddingHorizontal: 16, marginTop: 4, marginBottom: 20 },

  // Stats
  statsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 16 },
  statCard: {
    flex: 1, backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingVertical: 14, alignItems: 'center', gap: 4,
  },
  statNum:   { fontFamily: FFB, fontSize: 28, color: '#ffffff' },
  statLabel: { fontFamily: FF, fontSize: 9, color: '#6b7280', letterSpacing: 1.5 },

  // CTA
  ctaBtn: {
    marginHorizontal: 16, marginBottom: 20,
    backgroundColor: GOLD, borderRadius: 16,
    paddingVertical: 16, paddingHorizontal: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  ctaLeft:  { flexDirection: 'row', alignItems: 'center', gap: 14 },
  ctaTitle: { fontFamily: FFB, fontSize: 16, color: '#000000' },
  ctaSub:   { fontFamily: FF, fontSize: 11, color: 'rgba(0,0,0,0.5)', marginTop: 2 },

  // Tabs
  tabs: {
    flexDirection: 'row', marginHorizontal: 16, marginBottom: 12,
    backgroundColor: '#111111', borderRadius: 12, padding: 4,
    borderWidth: 1, borderColor: '#1c1c1c',
  },
  tab:         { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 9 },
  tabActive:   { backgroundColor: '#1c1c1c' },
  tabText:     { fontFamily: FF, fontSize: 13, color: '#6b7280' },
  tabTextActive: { color: '#ffffff', fontFamily: FFB },

  // Card
  card: {
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden',
  },
  bagHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
    backgroundColor: '#0a0a0a',
  },
  bagHeaderLabel: { fontFamily: FF, fontSize: 9, color: '#444', letterSpacing: 1.5, width: 44 },

  bagRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 11, gap: 10,
  },
  bagRowBorder: { borderBottomWidth: 1, borderBottomColor: '#141414' },
  clubName: { fontFamily: FF, fontSize: 13, color: '#ffffff', width: 40 },
  barWrap:  { flex: 1, height: 6, backgroundColor: '#1a1a1a', borderRadius: 3, overflow: 'visible' },
  bar:      { height: '100%', borderRadius: 3 },
  maxTick:  {
    position: 'absolute', top: -3, width: 2, height: 12,
    backgroundColor: '#374151', borderRadius: 1,
  },
  distAvg:  { fontFamily: FFB, fontSize: 13, color: '#ffffff', width: 36, textAlign: 'right' },
  distMax:  { fontFamily: FF, fontSize: 11, color: '#6b7280', width: 38, textAlign: 'right' },
  bagFooter:{ fontFamily: FF, fontSize: 10, color: '#333', textAlign: 'center', padding: 12 },

  // Sessions
  sessCard: {
    marginHorizontal: 16,
    backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingVertical: 14, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  sessLeft:         { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  sessIndicator:    { width: 3, height: 36, borderRadius: 2, backgroundColor: '#3b82f6' },
  sessDate:         { fontFamily: FFB, fontSize: 14, color: '#ffffff' },
  sessClubs:        { fontFamily: FF, fontSize: 11, color: '#6b7280', marginTop: 3 },
  sessRight:        { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sessShots:        { fontFamily: FFB, fontSize: 20, color: '#ffffff' },
  sessShotsLabel:   { fontFamily: FF, fontSize: 10, color: '#6b7280', marginTop: 4 },
  longPressHint:    { fontFamily: FF, fontSize: 10, color: '#333', textAlign: 'center', paddingTop: 10, paddingBottom: 4 },

  // Legend
  legend: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
    paddingHorizontal: 16, paddingTop: 6,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:  { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontFamily: FF, fontSize: 10, color: '#6b7280' },
});
