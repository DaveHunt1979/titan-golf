/**
 * Concept Preview — TITAN premium Stats screen
 * Accessible from Admin → Locker Room Preview → My Stats
 */
import { useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Image, ScrollView, StyleSheet,
  Text, TouchableOpacity, View, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';

// ── Constants ─────────────────────────────────────────────────
const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const RED    = '#f87171';
const ORANGE = '#f97316';
const BLUE   = '#3b82f6';
const PURPLE = '#8b5cf6';
const FF     = 'JUSTSans';

type Category = 'wood' | 'hybrid' | 'iron' | 'wedge' | 'putter';

const CAT_COLOR: Record<Category, string> = {
  wood:   GOLD,
  hybrid: PURPLE,
  iron:   BLUE,
  wedge:  ORANGE,
  putter: '#10b981',
};

function inferCategory(short: string): Category {
  const s = short.toUpperCase();
  if (s === 'P') return 'putter';
  if (['PW', 'GW', 'SW', 'LW', 'AW'].includes(s)) return 'wedge';
  if (s === 'D' || s.endsWith('W')) return 'wood';
  if (s.endsWith('H')) return 'hybrid';
  return 'iron';
}

// ── Animated primitives ───────────────────────────────────────

function FairwayDot({ color, delay }: { color: string; delay: number }) {
  const scale   = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.spring(scale,   { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);
  return (
    <Animated.View style={{
      width: 8, height: 8, borderRadius: 4,
      backgroundColor: color,
      transform: [{ scale }], opacity,
      margin: 2,
    }} />
  );
}

function HBar({ fraction, color, delay }: { fraction: number; color: string; delay: number }) {
  const width = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.timing(width, {
        toValue: fraction, duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();
  }, []);
  return (
    <View style={{ flex: 1, height: 6, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 3 }}>
      <Animated.View style={{
        height: 6, borderRadius: 3, backgroundColor: color,
        width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
      }} />
    </View>
  );
}

function VBar({ fraction, color, delay }: { fraction: number; color: string; delay: number }) {
  const height = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.timing(height, {
        toValue: fraction, duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();
  }, []);
  return (
    <View style={{ flex: 1, height: 80, justifyContent: 'flex-end' }}>
      <Animated.View style={{
        width: '100%', borderRadius: 4, backgroundColor: color,
        height: height.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
      }} />
    </View>
  );
}

// ── Trend chart ───────────────────────────────────────────────

function TrendChart({ data }: { data: { index: number; calculatedAt: string }[] }) {
  const [w, setW] = useState(0);
  const CHART_H = 100;
  const PAD = 16;
  if (data.length < 2) return null;
  const vals  = data.map(d => d.index);
  const min   = Math.min(...vals);
  const max   = Math.max(...vals);
  const range = Math.max(max - min, 1);
  const inner = w - PAD * 2;
  const px = (i: number) => PAD + (i / (data.length - 1)) * inner;
  const py = (v: number) => PAD + ((v - min) / range) * (CHART_H - PAD * 2);
  const points = data.map((d, i) => ({ x: px(i), y: py(d.index), v: d.index }));

  return (
    <View
      style={{ height: CHART_H + 24 }}
      onLayout={e => setW(e.nativeEvent.layout.width)}
    >
      {w > 0 && (
        <>
          {points.slice(1).map((p, i) => {
            const prev = points[i];
            const dx = p.x - prev.x;
            const dy = p.y - prev.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            const cx = (prev.x + p.x) / 2;
            const cy = (prev.y + p.y) / 2;
            return (
              <View key={i} style={{
                position: 'absolute',
                left: cx - len / 2, top: cy - 1,
                width: len, height: 2,
                backgroundColor: p.v < prev.v ? GREEN : RED,
                transform: [{ rotate: `${angle}deg` }],
              }} />
            );
          })}
          {points.map((p, i) => (
            <View key={i} style={{
              position: 'absolute',
              left: p.x - 5, top: p.y - 5,
              width: 10, height: 10, borderRadius: 5,
              backgroundColor: i === points.length - 1 ? GOLD : '#000',
              borderWidth: 2, borderColor: GOLD,
            }} />
          ))}
          <Text style={{ position: 'absolute', left: points[0].x - 14, top: points[0].y + 10, fontSize: 9, color: '#6b7280', fontFamily: FF }}>
            {points[0].v.toFixed(1)}
          </Text>
          <Text style={{ position: 'absolute', left: points[points.length - 1].x - 14, top: points[points.length - 1].y + 10, fontSize: 9, color: GOLD, fontFamily: FF }}>
            {points[points.length - 1].v.toFixed(1)}
          </Text>
        </>
      )}
    </View>
  );
}

// ── Types ─────────────────────────────────────────────────────
interface ClubStat  { short: string; category: Category; shots: number }
interface ClubDist  { short: string; category: Category; avgYards: number }
interface DriveData { left: number; centre: number; right: number }
interface PuttData  { one: number; two: number; three: number; total: number }
interface ScoreData { eagle: number; birdie: number; par: number; bogey: number; double: number }

// ── Screen ────────────────────────────────────────────────────

export default function ConceptStatsScreen() {
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
  });

  const [loading,    setLoading]    = useState(true);
  const [rounds,     setRounds]     = useState(0);
  const [shots,      setShots]      = useState(0);
  const [avgPutts,   setAvgPutts]   = useState<number | null>(null);
  const [clubs,      setClubs]      = useState<ClubStat[]>([]);
  const [clubDists,  setClubDists]  = useState<ClubDist[]>([]);
  const [drives,     setDrives]     = useState<DriveData>({ left: 0, centre: 0, right: 0 });
  const [putts,      setPutts]      = useState<PuttData>({ one: 0, two: 0, three: 0, total: 0 });
  const [scoring,    setScoring]    = useState<ScoreData>({ eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0 });
  const [hcpHistory, setHcpHistory] = useState<{ index: number; calculatedAt: string }[]>([]);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: player } = await supabase
      .from('players').select('id').eq('auth_uid', user.id).maybeSingle();
    if (!player) { setLoading(false); return; }
    const pid = (player as any).id as string;

    const [shotsRes, statsRes, holesRes, distRes, hcpRes] = await Promise.all([
      supabase.from('shots').select('club_id, clubs(short, category)').eq('player_id', pid),
      supabase.from('hole_stats').select('fairway_direction, putts').eq('player_id', pid),
      supabase.from('match_holes').select('match_id, stableford_pts').eq('player_id', pid).not('stableford_pts', 'is', null),
      supabase.from('shots').select('club_short, clubs(category), distance_yards').eq('player_id', pid).not('distance_yards', 'is', null),
      supabase.from('handicap_history').select('handicap_index, calculated_at').eq('player_id', pid).order('calculated_at').limit(20),
    ]);

    const clubMap: Record<string, ClubStat> = {};
    let totalShots = 0;
    for (const row of (shotsRes.data ?? []) as any[]) {
      const club = row.clubs;
      if (!club) continue;
      totalShots++;
      const key = club.short ?? row.club_id;
      if (!clubMap[key]) clubMap[key] = { short: club.short ?? key, category: (club.category ?? inferCategory(club.short ?? '')) as Category, shots: 0 };
      clubMap[key].shots++;
    }

    const drv: DriveData = { left: 0, centre: 0, right: 0 };
    const ptt: PuttData  = { one: 0, two: 0, three: 0, total: 0 };
    let totalPutts = 0, puttsHoles = 0;
    for (const row of (statsRes.data ?? []) as any[]) {
      if (row.fairway_direction === 'left')   drv.left++;
      if (row.fairway_direction === 'centre') drv.centre++;
      if (row.fairway_direction === 'right')  drv.right++;
      if (row.putts != null) {
        ptt.total++; totalPutts += row.putts; puttsHoles++;
        if (row.putts === 1) ptt.one++;
        else if (row.putts === 2) ptt.two++;
        else ptt.three++;
      }
    }

    const matchIds = new Set<string>();
    const scr: ScoreData = { eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0 };
    for (const row of (holesRes.data ?? []) as any[]) {
      matchIds.add(row.match_id);
      const pts = row.stableford_pts as number;
      if (pts >= 4) scr.eagle++;
      else if (pts === 3) scr.birdie++;
      else if (pts === 2) scr.par++;
      else if (pts === 1) scr.bogey++;
      else scr.double++;
    }

    const distMap: Record<string, { cat: Category; total: number; count: number }> = {};
    for (const row of (distRes.data ?? []) as any[]) {
      const key = row.club_short ?? 'unknown';
      if (!distMap[key]) distMap[key] = { cat: ((row.clubs as any)?.category ?? inferCategory(key)) as Category, total: 0, count: 0 };
      distMap[key].total += Number(row.distance_yards);
      distMap[key].count++;
    }
    const distList: ClubDist[] = Object.entries(distMap)
      .map(([short, d]) => ({ short, category: d.cat, avgYards: Math.round(d.total / d.count) }))
      .sort((a, b) => b.avgYards - a.avgYards).slice(0, 12);

    const hcpList = ((hcpRes.data ?? []) as any[]).map(r => ({ index: Number(r.handicap_index), calculatedAt: r.calculated_at }));

    setRounds(matchIds.size);
    setShots(totalShots);
    setAvgPutts(puttsHoles > 0 ? Math.round((totalPutts / puttsHoles) * 10) / 10 : null);
    setClubs(Object.values(clubMap).sort((a, b) => b.shots - a.shots).slice(0, 10));
    setClubDists(distList);
    setDrives(drv);
    setPutts(ptt);
    setScoring(scr);
    setHcpHistory(hcpList);
    setLoading(false);
  }

  const totalDrives   = drives.left + drives.centre + drives.right;
  const maxClubShots  = clubs[0]?.shots ?? 1;
  const totalScoring  = scoring.eagle + scoring.birdie + scoring.par + scoring.bogey + scoring.double;
  const maxScore      = Math.max(1, ...([scoring.eagle, scoring.birdie, scoring.par, scoring.bogey, scoring.double]));

  const scoringEntries: { label: string; val: number; color: string }[] = [
    { label: 'Eagle+', val: scoring.eagle,  color: GOLD },
    { label: 'Birdie', val: scoring.birdie, color: GREEN },
    { label: 'Par',    val: scoring.par,    color: BLUE },
    { label: 'Bogey',  val: scoring.bogey,  color: ORANGE },
    { label: 'Dbl+',   val: scoring.double, color: RED },
  ];

  const isReady = fontsLoaded && !loading;

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={s.headerSide}
        >
          <Ionicons name="chevron-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image
            source={require('../../../assets/TitanAppLogo.png')}
            style={s.headerLogo}
            resizeMode="contain"
          />
        </View>
        <View style={s.headerSide} />
      </View>

      {!isReady ? (
        <View style={s.centered}>
          <ActivityIndicator color={GOLD} size="large" />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

          <Text style={s.pageTitle}>My Stats</Text>

          {/* ── Summary row ── */}
          <View style={s.summaryRow}>
            <View style={s.summaryCard}>
              <Text style={s.summaryVal}>{rounds}</Text>
              <Text style={s.summaryLbl}>ROUNDS</Text>
            </View>
            <View style={s.summaryCard}>
              <Text style={s.summaryVal}>{shots}</Text>
              <Text style={s.summaryLbl}>SHOTS</Text>
            </View>
            <View style={s.summaryCard}>
              <Text style={s.summaryVal}>{avgPutts ?? '—'}</Text>
              <Text style={s.summaryLbl}>AVG PUTTS</Text>
            </View>
          </View>

          {rounds === 0 && (
            <View style={s.emptyCard}>
              <Ionicons name="bar-chart-outline" size={36} color={`${GOLD}40`} />
              <Text style={s.emptyTitle}>No data yet</Text>
              <Text style={s.emptySub}>Play a round and log your shots to unlock your stats</Text>
            </View>
          )}

          {/* ── Handicap trend ── */}
          {hcpHistory.length >= 2 && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>HANDICAP TREND</Text>
              <View style={s.hcpMeta}>
                <View style={s.hcpMetaItem}>
                  <Text style={s.hcpMetaVal}>{hcpHistory[0].index.toFixed(1)}</Text>
                  <Text style={s.hcpMetaLbl}>STARTED</Text>
                </View>
                <View style={[s.hcpMetaItem, { alignItems: 'center' }]}>
                  {hcpHistory[hcpHistory.length - 1].index < hcpHistory[0].index
                    ? <Text style={[s.hcpDelta, { color: GREEN }]}>▼ {(hcpHistory[0].index - hcpHistory[hcpHistory.length - 1].index).toFixed(1)}</Text>
                    : <Text style={[s.hcpDelta, { color: RED }]}>▲ {(hcpHistory[hcpHistory.length - 1].index - hcpHistory[0].index).toFixed(1)}</Text>
                  }
                  <Text style={s.hcpMetaLbl}>CHANGE</Text>
                </View>
                <View style={[s.hcpMetaItem, { alignItems: 'flex-end' }]}>
                  <Text style={s.hcpMetaVal}>{hcpHistory[hcpHistory.length - 1].index.toFixed(1)}</Text>
                  <Text style={s.hcpMetaLbl}>NOW</Text>
                </View>
              </View>
              <TrendChart data={hcpHistory} />
            </View>
          )}

          {/* ── Net scoring ── */}
          {totalScoring > 0 && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>NET SCORING · {totalScoring} holes</Text>
              <View style={s.vBarRow}>
                {scoringEntries.map((e, i) => (
                  <View key={e.label} style={s.vBarCol}>
                    <Text style={[s.vBarCount, { color: e.color }]}>{e.val}</Text>
                    <VBar fraction={e.val / maxScore} color={e.color} delay={i * 100} />
                    <Text style={s.vBarLabel}>{e.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── Drives ── */}
          {totalDrives > 0 && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>DRIVES · {totalDrives} tracked</Text>
              <View style={s.fairwayWrap}>
                <View style={[s.fairwayZone, s.roughZone]}>
                  <Text style={s.zoneLabel}>LEFT</Text>
                  <Text style={[s.zoneCount, { color: RED }]}>{drives.left}</Text>
                  <View style={s.dotGrid}>
                    {Array.from({ length: drives.left }).map((_, i) => (
                      <FairwayDot key={i} color={RED} delay={i * 60} />
                    ))}
                  </View>
                </View>
                <View style={[s.fairwayZone, s.fairZone]}>
                  <Text style={s.zoneLabel}>CENTRE</Text>
                  <Text style={[s.zoneCount, { color: GREEN }]}>{drives.centre}</Text>
                  <View style={s.dotGrid}>
                    {Array.from({ length: drives.centre }).map((_, i) => (
                      <FairwayDot key={i} color={GREEN} delay={i * 60} />
                    ))}
                  </View>
                  <Text style={s.fairwayPct}>
                    {Math.round((drives.centre / totalDrives) * 100)}% fairway
                  </Text>
                </View>
                <View style={[s.fairwayZone, s.roughZone]}>
                  <Text style={s.zoneLabel}>RIGHT</Text>
                  <Text style={[s.zoneCount, { color: ORANGE }]}>{drives.right}</Text>
                  <View style={s.dotGrid}>
                    {Array.from({ length: drives.right }).map((_, i) => (
                      <FairwayDot key={i} color={ORANGE} delay={i * 60} />
                    ))}
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* ── Putting ── */}
          {putts.total > 0 && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>PUTTING · {putts.total} holes</Text>
              <View style={s.puttRow}>
                {[
                  { val: putts.one,   lbl: '1-PUTT',  color: GOLD },
                  { val: putts.two,   lbl: '2-PUTT',  color: GREEN },
                  { val: putts.three, lbl: '3-PUTT+', color: RED },
                ].map(p => (
                  <View key={p.lbl} style={s.puttCard}>
                    <Text style={[s.puttVal, { color: p.color }]}>{p.val}</Text>
                    <Text style={s.puttLbl}>{p.lbl}</Text>
                    <Text style={s.puttPct}>{Math.round((p.val / putts.total) * 100)}%</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── Club usage ── */}
          {clubs.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>CLUB USAGE · {shots} shots</Text>
              {clubs.map((c, i) => (
                <View key={c.short} style={s.clubRow}>
                  <Text style={[s.clubShort, { color: CAT_COLOR[c.category] }]}>{c.short}</Text>
                  <HBar fraction={c.shots / maxClubShots} color={CAT_COLOR[c.category]} delay={i * 80} />
                  <Text style={s.clubCount}>{c.shots}</Text>
                </View>
              ))}
              <View style={s.legend}>
                {(Object.entries(CAT_COLOR) as [Category, string][]).map(([cat, col]) => (
                  <View key={cat} style={s.legendItem}>
                    <View style={[s.legendDot, { backgroundColor: col }]} />
                    <Text style={s.legendLbl}>{cat}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── Club distances ── */}
          {clubDists.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>CLUB DISTANCES · avg yards</Text>
              {clubDists.map((c, i) => (
                <View key={c.short} style={s.clubRow}>
                  <Text style={[s.clubShort, { color: CAT_COLOR[c.category] }]}>{c.short}</Text>
                  <HBar fraction={c.avgYards / (clubDists[0]?.avgYards ?? 1)} color={CAT_COLOR[c.category]} delay={i * 80} />
                  <Text style={s.clubCount}>{c.avgYards}y</Text>
                </View>
              ))}
            </View>
          )}

          <View style={s.watermark}>
            <Text style={s.watermarkText}>CONCEPT PREVIEW · NOT LIVE</Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:     { flex: 1, backgroundColor: '#000000' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll:   { paddingBottom: 48 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12,
  },
  headerSide:   { width: 40 },
  headerCenter: { alignItems: 'center' },
  headerLogo:   { width: 36, height: 36 },

  pageTitle: {
    fontFamily: FF, fontSize: 36, color: '#ffffff',
    paddingHorizontal: 20, paddingBottom: 20, letterSpacing: -0.5,
  },

  // Summary
  summaryRow: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, marginBottom: 16,
  },
  summaryCard: {
    flex: 1, backgroundColor: '#111111',
    borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c',
    paddingVertical: 18, alignItems: 'center',
  },
  summaryVal: { fontFamily: FF, fontSize: 28, color: GOLD },
  summaryLbl: { fontFamily: 'JUSTSans-ExBold', fontSize: 9, color: '#fff', letterSpacing: 1.5, marginTop: 4 },

  // Empty
  emptyCard: {
    marginHorizontal: 16, padding: 40,
    alignItems: 'center', gap: 10,
    backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c', marginBottom: 16,
  },
  emptyTitle: { fontFamily: FF, fontSize: 16, color: '#ffffff' },
  emptySub:   { fontFamily: 'JUSTSans-ExBold', fontSize: 12, color: '#fff', textAlign: 'center', lineHeight: 18 },

  // Section
  section: {
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c', padding: 16,
  },
  sectionLabel: {
    fontFamily: FF, fontSize: 10, color: GOLD,
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 16,
  },

  // Handicap trend
  hcpMeta:     { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  hcpMetaItem: { flex: 1 },
  hcpMetaVal:  { fontFamily: FF, fontSize: 26, color: '#ffffff' },
  hcpMetaLbl:  { fontFamily: 'JUSTSans-ExBold', fontSize: 9, color: '#fff', letterSpacing: 1.5, marginTop: 2 },
  hcpDelta:    { fontFamily: FF, fontSize: 26 },

  // Scoring
  vBarRow: { flexDirection: 'row', gap: 8 },
  vBarCol: { flex: 1, alignItems: 'center', gap: 6 },
  vBarCount: { fontFamily: FF, fontSize: 16 },
  vBarLabel: { fontFamily: 'JUSTSans-ExBold', fontSize: 9, color: '#fff', textAlign: 'center', letterSpacing: 0.5 },

  // Drives
  fairwayWrap: { flexDirection: 'row', gap: 6 },
  fairwayZone: { flex: 1, borderRadius: 10, padding: 10, minHeight: 110 },
  roughZone:   { backgroundColor: 'rgba(139,69,19,0.10)', borderWidth: 1, borderColor: 'rgba(139,69,19,0.18)' },
  fairZone:    { backgroundColor: 'rgba(74,222,128,0.05)', borderWidth: 1, borderColor: 'rgba(74,222,128,0.12)' },
  zoneLabel:   { fontFamily: FF, fontSize: 9, color: '#6b7280', letterSpacing: 1.5 },
  zoneCount:   { fontFamily: FF, fontSize: 24, marginTop: 2 },
  dotGrid:     { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  fairwayPct:  { fontFamily: FF, fontSize: 10, color: GREEN, marginTop: 6 },

  // Putting
  puttRow:  { flexDirection: 'row', gap: 10 },
  puttCard: {
    flex: 1, backgroundColor: '#0a0a0a',
    borderRadius: 10, borderWidth: 1, borderColor: '#1c1c1c',
    paddingVertical: 16, alignItems: 'center', gap: 4,
  },
  puttVal: { fontFamily: FF, fontSize: 28 },
  puttLbl: { fontFamily: FF, fontSize: 9, color: '#6b7280', letterSpacing: 1 },
  puttPct: { fontFamily: FF, fontSize: 11, color: '#6b7280' },

  // Club rows
  clubRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  clubShort: { fontFamily: FF, fontSize: 12, width: 30 },
  clubCount: { fontFamily: FF, fontSize: 11, color: '#6b7280', width: 44, textAlign: 'right' },
  legend:    { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  legendItem:{ flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendLbl: { fontFamily: FF, fontSize: 10, color: '#6b7280', textTransform: 'capitalize' },

  // Watermark
  watermark:     { alignItems: 'center', paddingVertical: 20 },
  watermarkText: { fontFamily: FF, fontSize: 10, color: '#2a2a2a', letterSpacing: 2 },
});
