import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, Image, ScrollView, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';

// ─── TITAN design constants ──────────────────────────────────────────────────

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

// ─── helpers ────────────────────────────────────────────────────────────────

type Category = 'wood' | 'hybrid' | 'iron' | 'wedge' | 'putter';

const CAT_COLOR: Record<Category, string> = {
  wood:   '#D4AF37',
  hybrid: '#8b5cf6',
  iron:   '#3b82f6',
  wedge:  '#f97316',
  putter: '#10b981',
};

function inferCategory(short: string): Category {
  const s = short.toUpperCase();
  if (s === 'P') return 'putter';
  if (['PW','GW','SW','LW','AW'].includes(s)) return 'wedge';
  if (s === 'D' || s.endsWith('W')) return 'wood';
  if (s.endsWith('H')) return 'hybrid';
  return 'iron';
}

// ─── animated primitives ────────────────────────────────────────────────────

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
        toValue: fraction,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();
  }, []);

  return (
    <View style={{ flex: 1, height: 10, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 5 }}>
      <Animated.View style={{
        height: 10, borderRadius: 5, backgroundColor: color,
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
        toValue: fraction,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();
  }, []);

  return (
    <View style={{ flex: 1, height: 72, justifyContent: 'flex-end' }}>
      <Animated.View style={{
        width: '100%', borderRadius: 4, backgroundColor: color,
        height: height.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
      }} />
    </View>
  );
}

// ─── main screen ────────────────────────────────────────────────────────────

interface ClubStat  { short: string; category: Category; shots: number }
interface ClubDist  { short: string; category: Category; avgYards: number; shots: number }
interface DriveData { left: number; centre: number; right: number }
interface PuttData  { one: number; two: number; three: number; total: number }
interface ScoreData { eagle: number; birdie: number; par: number; bogey: number; double: number }
interface HcpEntry  { index: number; calculatedAt: string }

export default function StatsScreen() {
  const router = useRouter();
  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [loading, setLoading]   = useState(true);
  const [rounds,  setRounds]    = useState(0);
  const [shots,   setShots]     = useState(0);
  const [avgPutts, setAvgPutts] = useState<number | null>(null);
  const [clubs,      setClubs]      = useState<ClubStat[]>([]);
  const [clubDists,  setClubDists]  = useState<ClubDist[]>([]);
  const [drives,     setDrives]     = useState<DriveData>({ left: 0, centre: 0, right: 0 });
  const [putts,      setPutts]      = useState<PuttData>({ one: 0, two: 0, three: 0, total: 0 });
  const [scoring,    setScoring]    = useState<ScoreData>({ eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0 });
  const [hcpHistory, setHcpHistory] = useState<HcpEntry[]>([]);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: player } = await supabase
      .from('players').select('id').eq('auth_uid', user.id).maybeSingle();
    if (!player) { setLoading(false); return; }

    const pid = (player as any).id as string;

    const [shotsRes, statsRes, holesRes, distRes, hcpRes] = await Promise.all([
      supabase
        .from('shots')
        .select('club_id, clubs(short, category)')
        .eq('player_id', pid),
      supabase
        .from('hole_stats')
        .select('fairway_direction, putts')
        .eq('player_id', pid),
      supabase
        .from('match_holes')
        .select('match_id, stableford_pts')
        .eq('player_id', pid)
        .not('stableford_pts', 'is', null),
      supabase
        .from('shots')
        .select('club_short, clubs(category), distance_yards')
        .eq('player_id', pid)
        .not('distance_yards', 'is', null),
      supabase
        .from('handicap_history')
        .select('handicap_index, calculated_at')
        .eq('player_id', pid)
        .order('calculated_at')
        .limit(20),
    ]);

    // ── shots + club usage ─────────────────────────────
    const clubMap: Record<string, ClubStat> = {};
    let totalShots = 0;
    for (const row of (shotsRes.data ?? []) as any[]) {
      const club = row.clubs;
      if (!club) continue;
      totalShots++;
      const key = club.short ?? row.club_id;
      if (!clubMap[key]) {
        clubMap[key] = {
          short:    club.short ?? key,
          category: (club.category ?? inferCategory(club.short ?? '')) as Category,
          shots: 0,
        };
      }
      clubMap[key].shots++;
    }
    const clubList = Object.values(clubMap).sort((a, b) => b.shots - a.shots).slice(0, 10);

    // ── fairway directions + putts ─────────────────────
    const drv: DriveData = { left: 0, centre: 0, right: 0 };
    const ptt: PuttData  = { one: 0, two: 0, three: 0, total: 0 };
    let totalPutts = 0, puttsHoles = 0;

    for (const row of (statsRes.data ?? []) as any[]) {
      const r = row as any;
      if (r.fairway_direction === 'left')   drv.left++;
      if (r.fairway_direction === 'centre') drv.centre++;
      if (r.fairway_direction === 'right')  drv.right++;
      if (r.putts != null) {
        ptt.total++;
        totalPutts += r.putts;
        puttsHoles++;
        if (r.putts === 1)      ptt.one++;
        else if (r.putts === 2) ptt.two++;
        else                    ptt.three++;
      }
    }

    // ── scoring distribution ───────────────────────────
    const matchIds = new Set<string>();
    const scr: ScoreData = { eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0 };
    for (const row of (holesRes.data ?? []) as any[]) {
      const r = row as any;
      matchIds.add(r.match_id);
      const pts = r.stableford_pts as number;
      if (pts >= 4)      scr.eagle++;
      else if (pts === 3) scr.birdie++;
      else if (pts === 2) scr.par++;
      else if (pts === 1) scr.bogey++;
      else                scr.double++;
    }

    // ── club distances ─────────────────────────────────
    const distMap: Record<string, { cat: Category; total: number; count: number }> = {};
    for (const row of (distRes.data ?? []) as any[]) {
      const key = row.club_short ?? 'unknown';
      if (!distMap[key]) {
        distMap[key] = {
          cat:   ((row.clubs as any)?.category ?? inferCategory(key)) as Category,
          total: 0, count: 0,
        };
      }
      distMap[key].total += Number(row.distance_yards);
      distMap[key].count++;
    }
    const distList: ClubDist[] = Object.entries(distMap)
      .map(([short, d]) => ({ short, category: d.cat, avgYards: Math.round(d.total / d.count), shots: d.count }))
      .sort((a, b) => b.avgYards - a.avgYards)
      .slice(0, 12);

    // ── handicap history ───────────────────────────────
    const hcpList: HcpEntry[] = ((hcpRes.data ?? []) as any[]).map(r => ({
      index:        Number(r.handicap_index),
      calculatedAt: r.calculated_at,
    }));

    setRounds(matchIds.size);
    setShots(totalShots);
    setAvgPutts(puttsHoles > 0 ? Math.round((totalPutts / puttsHoles) * 10) / 10 : null);
    setClubs(clubList);
    setClubDists(distList);
    setDrives(drv);
    setPutts(ptt);
    setScoring(scr);
    setHcpHistory(hcpList);
    setLoading(false);
  }

  if (loading || !fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={GOLD} size="large" />
      </View>
    );
  }

  const totalDrives = drives.left + drives.centre + drives.right;
  const maxClubShots = clubs[0]?.shots ?? 1;

  const scoringEntries: { label: string; key: keyof ScoreData; color: string }[] = [
    { label: 'Eagle+', key: 'eagle',  color: '#D4AF37' },
    { label: 'Birdie', key: 'birdie', color: '#4ade80' },
    { label: 'Par',    key: 'par',    color: '#3b82f6' },
    { label: 'Bogey',  key: 'bogey',  color: '#f97316' },
    { label: 'Dbl+',   key: 'double', color: '#f87171' },
  ];
  const maxScore = Math.max(1, ...scoringEntries.map(e => scoring[e.key]));

  return (
    <View style={ss.container}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={ss.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={ss.headerBtn}
        >
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>

        <View style={ss.headerCenter}>
          <Image source={titanLogo} style={ss.headerLogo} resizeMode="contain" />
          <Text style={ss.headerSubtitle}>MY STATS</Text>
        </View>

        <View style={ss.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={ss.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Summary pills ── */}
        <View style={ss.pillRow}>
          <View style={ss.pill}>
            <Text style={ss.pillVal}>{rounds}</Text>
            <Text style={ss.pillLbl}>ROUNDS</Text>
          </View>
          <View style={ss.pill}>
            <Text style={ss.pillVal}>{shots}</Text>
            <Text style={ss.pillLbl}>SHOTS</Text>
          </View>
          <View style={ss.pill}>
            <Text style={ss.pillVal}>{avgPutts != null ? avgPutts : '—'}</Text>
            <Text style={ss.pillLbl}>AVG PUTTS</Text>
          </View>
        </View>

        {/* ── DRIVES ── */}
        {totalDrives > 0 && (
          <View style={ss.section}>
            <Text style={ss.sectionLabel}>DRIVES  ·  {totalDrives} tracked</Text>
            <View style={ss.fairwayWrap}>

              {/* Left rough */}
              <View style={[ss.fairwayZone, ss.roughZone]}>
                <Text style={ss.zoneLabel}>LEFT</Text>
                <Text style={[ss.zoneCount, { color: RED }]}>{drives.left}</Text>
                <View style={ss.dotGrid}>
                  {Array.from({ length: drives.left }).map((_, i) => (
                    <FairwayDot key={i} color={RED} delay={i * 60} />
                  ))}
                </View>
              </View>

              {/* Centre fairway */}
              <View style={[ss.fairwayZone, ss.fairZone]}>
                <Text style={ss.zoneLabel}>CENTRE</Text>
                <Text style={[ss.zoneCount, { color: GREEN }]}>{drives.centre}</Text>
                <View style={ss.dotGrid}>
                  {Array.from({ length: drives.centre }).map((_, i) => (
                    <FairwayDot key={i} color={GREEN} delay={i * 60} />
                  ))}
                </View>
                {totalDrives > 0 && (
                  <Text style={ss.fairwayPct}>
                    {Math.round((drives.centre / totalDrives) * 100)}%
                  </Text>
                )}
              </View>

              {/* Right rough */}
              <View style={[ss.fairwayZone, ss.roughZone]}>
                <Text style={ss.zoneLabel}>RIGHT</Text>
                <Text style={[ss.zoneCount, { color: '#f97316' }]}>{drives.right}</Text>
                <View style={ss.dotGrid}>
                  {Array.from({ length: drives.right }).map((_, i) => (
                    <FairwayDot key={i} color="#f97316" delay={i * 60} />
                  ))}
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ── CLUB USAGE ── */}
        {clubs.length > 0 && (
          <View style={ss.section}>
            <Text style={ss.sectionLabel}>CLUB USAGE  ·  {shots} shots</Text>
            {clubs.map((c, i) => (
              <View key={c.short} style={ss.clubRow}>
                <Text style={[ss.clubShort, { color: CAT_COLOR[c.category] }]}>{c.short}</Text>
                <HBar fraction={c.shots / maxClubShots} color={CAT_COLOR[c.category]} delay={i * 80} />
                <Text style={ss.clubCount}>{c.shots}</Text>
              </View>
            ))}
            {/* legend */}
            <View style={ss.legend}>
              {(Object.entries(CAT_COLOR) as [Category, string][]).map(([cat, col]) => (
                <View key={cat} style={ss.legendItem}>
                  <View style={[ss.legendDot, { backgroundColor: col }]} />
                  <Text style={ss.legendLbl}>{cat}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── NET SCORING ── */}
        {(scoring.eagle + scoring.birdie + scoring.par + scoring.bogey + scoring.double) > 0 && (
          <View style={ss.section}>
            <Text style={ss.sectionLabel}>NET SCORING</Text>
            <View style={ss.vBarRow}>
              {scoringEntries.map((e, i) => (
                <View key={e.key} style={ss.vBarCol}>
                  <Text style={[ss.vBarCount, { color: e.color }]}>{scoring[e.key]}</Text>
                  <VBar fraction={scoring[e.key] / maxScore} color={e.color} delay={i * 100} />
                  <Text style={ss.vBarLabel}>{e.label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── PUTTING ── */}
        {putts.total > 0 && (
          <View style={ss.section}>
            <Text style={ss.sectionLabel}>PUTTING  ·  {putts.total} holes</Text>
            <View style={ss.puttRow}>
              <View style={ss.puttCard}>
                <Text style={[ss.puttVal, { color: GOLD }]}>{putts.one}</Text>
                <Text style={ss.puttLbl}>1-PUTT</Text>
                {putts.total > 0 && (
                  <Text style={ss.puttPct}>{Math.round((putts.one / putts.total) * 100)}%</Text>
                )}
              </View>
              <View style={ss.puttCard}>
                <Text style={[ss.puttVal, { color: GREEN }]}>{putts.two}</Text>
                <Text style={ss.puttLbl}>2-PUTT</Text>
                {putts.total > 0 && (
                  <Text style={ss.puttPct}>{Math.round((putts.two / putts.total) * 100)}%</Text>
                )}
              </View>
              <View style={ss.puttCard}>
                <Text style={[ss.puttVal, { color: RED }]}>{putts.three}</Text>
                <Text style={ss.puttLbl}>3-PUTT+</Text>
                {putts.total > 0 && (
                  <Text style={ss.puttPct}>{Math.round((putts.three / putts.total) * 100)}%</Text>
                )}
              </View>
            </View>
          </View>
        )}

        {/* ── CLUB DISTANCES ── */}
        {clubDists.length > 0 && (
          <View style={ss.section}>
            <Text style={ss.sectionLabel}>CLUB DISTANCES  ·  avg yards</Text>
            {clubDists.map((c, i) => (
              <View key={c.short} style={ss.clubRow}>
                <Text style={[ss.clubShort, { color: CAT_COLOR[c.category] }]}>{c.short}</Text>
                <HBar fraction={c.avgYards / (clubDists[0]?.avgYards ?? 1)} color={CAT_COLOR[c.category]} delay={i * 80} />
                <Text style={ss.clubCount}>{c.avgYards}y</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── HANDICAP TREND ── */}
        {hcpHistory.length >= 2 && (
          <View style={ss.section}>
            <Text style={ss.sectionLabel}>HANDICAP TREND  ·  {hcpHistory.length} calculations</Text>
            <View style={ss.hcpMeta}>
              <View style={ss.hcpMetaItem}>
                <Text style={ss.hcpMetaVal}>{hcpHistory[0].index.toFixed(1)}</Text>
                <Text style={ss.hcpMetaLbl}>STARTED</Text>
              </View>
              <View style={[ss.hcpMetaItem, { alignItems: 'center' }]}>
                {hcpHistory[hcpHistory.length - 1].index < hcpHistory[0].index
                  ? <Text style={[ss.hcpDelta, { color: GREEN }]}>▼ {(hcpHistory[0].index - hcpHistory[hcpHistory.length - 1].index).toFixed(1)}</Text>
                  : <Text style={[ss.hcpDelta, { color: RED }]}>▲ {(hcpHistory[hcpHistory.length - 1].index - hcpHistory[0].index).toFixed(1)}</Text>
                }
                <Text style={ss.hcpMetaLbl}>CHANGE</Text>
              </View>
              <View style={[ss.hcpMetaItem, { alignItems: 'flex-end' }]}>
                <Text style={ss.hcpMetaVal}>{hcpHistory[hcpHistory.length - 1].index.toFixed(1)}</Text>
                <Text style={ss.hcpMetaLbl}>NOW</Text>
              </View>
            </View>
            <TrendChart data={hcpHistory} />
          </View>
        )}

        {rounds === 0 && !loading && (
          <View style={ss.empty}>
            <Text style={ss.emptyTitle}>No rounds yet</Text>
            <Text style={ss.emptySub}>Play a round and log your shots to see stats here</Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ─── trend chart ─────────────────────────────────────────────────────────────

function TrendChart({ data }: { data: HcpEntry[] }) {
  const [w, setW] = useState(0);
  const CHART_H = 90;
  const PAD = 16;

  if (data.length < 2) return null;

  const vals  = data.map(d => d.index);
  const min   = Math.min(...vals);
  const max   = Math.max(...vals);
  const range = Math.max(max - min, 1);
  const inner = w - PAD * 2;

  function px(i: number) { return PAD + (i / (data.length - 1)) * inner; }
  function py(v: number) { return PAD + ((v - min) / range) * (CHART_H - PAD * 2); }

  const points = data.map((d, i) => ({ x: px(i), y: py(d.index), v: d.index }));

  return (
    <View
      style={{ height: CHART_H + 20 }}
      onLayout={e => setW(e.nativeEvent.layout.width)}
    >
      {w > 0 && (
        <>
          {/* Connecting lines */}
          {points.slice(1).map((p, i) => {
            const prev = points[i];
            const dx = p.x - prev.x;
            const dy = p.y - prev.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            const cx = (prev.x + p.x) / 2;
            const cy = (prev.y + p.y) / 2;
            const improving = p.v < prev.v;
            return (
              <View key={i} style={{
                position: 'absolute',
                left: cx - len / 2,
                top: cy - 1,
                width: len, height: 2,
                backgroundColor: improving ? GREEN : RED,
                transform: [{ rotate: `${angle}deg` }],
              }} />
            );
          })}
          {/* Dots */}
          {points.map((p, i) => {
            const isLast = i === points.length - 1;
            return (
              <View key={i} style={{
                position: 'absolute',
                left: p.x - 5, top: p.y - 5,
                width: 10, height: 10, borderRadius: 5,
                backgroundColor: isLast ? GOLD : '#000',
                borderWidth: 2, borderColor: GOLD,
              }} />
            );
          })}
          {/* First and last labels */}
          <Text style={{ position: 'absolute', left: points[0].x - 14, top: points[0].y + 8, fontSize: 9, color: '#fff', fontFamily: FFB }}>
            {points[0].v.toFixed(1)}
          </Text>
          <Text style={{ position: 'absolute', left: points[points.length - 1].x - 14, top: points[points.length - 1].y + 8, fontSize: 9, color: GOLD, fontFamily: FFB }}>
            {points[points.length - 1].v.toFixed(1)}
          </Text>
        </>
      )}
    </View>
  );
}

// ─── styles ─────────────────────────────────────────────────────────────────

const ss = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  // ── header ──
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  headerBtn:  { width: 40, alignItems: 'flex-start' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerLogo: { width: 28, height: 28 },
  headerSubtitle: {
    fontFamily: FFB, fontSize: 9, color: GOLD, letterSpacing: 2.5, marginTop: 3,
  },

  scroll: { padding: 20 },

  // ── pills ──
  pillRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  pill: {
    flex: 1, backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingVertical: 14, alignItems: 'center',
  },
  pillVal: { fontFamily: FFB, fontSize: 28, color: GOLD },
  pillLbl: { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 2, marginTop: 3 },

  // ── section ──
  section: {
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c',
    padding: 16, marginBottom: 12,
  },
  sectionLabel: {
    fontFamily: FFB, fontSize: 10, color: '#fff',
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 14,
  },

  // ── fairway ──
  fairwayWrap:  { flexDirection: 'row', gap: 6 },
  fairwayZone: {
    flex: 1, borderRadius: 10, padding: 10, minHeight: 120,
    borderWidth: 1,
  },
  roughZone: { backgroundColor: 'rgba(139,69,19,0.10)', borderColor: 'rgba(139,69,19,0.18)' },
  fairZone:  { backgroundColor: 'rgba(74,222,128,0.05)', borderColor: 'rgba(74,222,128,0.12)' },
  zoneLabel: { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 1.5, textTransform: 'uppercase' },
  zoneCount: { fontFamily: FFB, fontSize: 22, marginTop: 2 },
  dotGrid:   { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  fairwayPct:{ fontFamily: FFB, fontSize: 10, color: GREEN, marginTop: 4, opacity: 0.8 },

  // ── club usage ──
  clubRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  clubShort: { fontFamily: FFB, fontSize: 12, width: 28, letterSpacing: 0.3 },
  clubCount: { fontFamily: FFB, fontSize: 12, color: '#fff', width: 40, textAlign: 'right' },
  legend:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  legendItem:{ flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendLbl: { fontFamily: FFB, fontSize: 10, color: '#fff', textTransform: 'capitalize' },

  // ── scoring ──
  vBarRow: { flexDirection: 'row', gap: 10 },
  vBarCol: { flex: 1, alignItems: 'center', gap: 6 },
  vBarCount: { fontFamily: FFB, fontSize: 14 },
  vBarLabel: { fontFamily: FFB, fontSize: 9, color: '#fff', textAlign: 'center', letterSpacing: 0.5 },

  // ── putting ──
  puttRow:  { flexDirection: 'row', gap: 10 },
  puttCard: {
    flex: 1, backgroundColor: '#1c1c1c', borderRadius: 10,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingVertical: 14, alignItems: 'center',
  },
  puttVal: { fontFamily: FFB, fontSize: 26 },
  puttLbl: { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 1, marginTop: 2 },
  puttPct: { fontFamily: FFB, fontSize: 11, color: '#fff', marginTop: 2 },

  // ── empty ──
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyTitle: { fontFamily: FFB, fontSize: 16, color: '#fff', textAlign: 'center' },
  emptySub:   { fontFamily: FFB, fontSize: 13, color: '#444', textAlign: 'center', marginTop: 8, paddingHorizontal: 32 },

  // ── handicap trend ──
  hcpMeta:     { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  hcpMetaItem: { flex: 1 },
  hcpMetaVal:  { fontFamily: FFB, fontSize: 24, color: GOLD },
  hcpMetaLbl:  { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 1, marginTop: 2 },
  hcpDelta:    { fontFamily: FFB, fontSize: 22 },
});
