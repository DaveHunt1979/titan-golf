import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { titanLogo } from '../../../src/lib/assets';

// ── TITAN design constants ─────────────────────────────────────
const GOLD = '#D4AF37';
const GREEN = '#4ade80';
const FF   = 'JUSTSans';
const FFB  = 'JUSTSans-ExBold';

type RecordType = 'best_gross_18' | 'best_stableford_18' | 'most_birdies_round' | 'most_eagles_round';

interface RecordEntry {
  type: RecordType;
  playerName: string;
  value: number;
  courseName: string | null;
  achievedAt: string | null;
}

const RECORD_DEFS: Array<{
  type: RecordType; label: string; icon: string; unit: string; better: 'lower' | 'higher';
}> = [
  { type: 'best_gross_18',      label: 'Best Gross Round',        icon: '🏌️', unit: 'strokes', better: 'lower'  },
  { type: 'best_stableford_18', label: 'Best Stableford Round',   icon: '⭐',  unit: 'pts',    better: 'higher' },
  { type: 'most_birdies_round', label: 'Most Birdies in a Round', icon: '🐦',  unit: 'birdies',better: 'higher' },
  { type: 'most_eagles_round',  label: 'Most Eagles in a Round',  icon: '🦅',  unit: 'eagles', better: 'higher' },
];

// ── Grand opening animated record card ────────────────────────
function RecordCard({
  def, entry, slideY, opacity, dc,
}: {
  def: typeof RECORD_DEFS[0];
  entry: RecordEntry | null;
  slideY: Animated.Value;
  opacity: Animated.Value;
  dc: ReturnType<typeof useDynamicColors>;
}) {
  return (
    <Animated.View style={{ opacity, transform: [{ translateY: slideY }] }}>
      <View style={[ss.card, { backgroundColor: dc.card, borderColor: dc.border }]}>
        <View style={ss.cardHeader}>
          <Text style={ss.cardIcon}>{def.icon}</Text>
          <Text style={[ss.cardLabel, { color: dc.cardText }]}>{def.label}</Text>
        </View>

        {entry ? (
          <>
            <View style={ss.valueRow}>
              <Text style={[ss.valueNum, { color: dc.gold }]}>{entry.value}</Text>
              <Text style={[ss.valueUnit, { color: dc.cardText }]}>{def.unit}</Text>
            </View>
            <Text style={[ss.holderName, { color: dc.cardText }]}>{entry.playerName}</Text>
            {entry.courseName && (
              <Text style={[ss.courseName, { color: dc.cardText }]} numberOfLines={1}>{entry.courseName}</Text>
            )}
            {entry.achievedAt && (
              <Text style={[ss.achievedDate, { color: dc.cardText }]}>{formatDate(entry.achievedAt)}</Text>
            )}
          </>
        ) : (
          <View style={ss.vacant}>
            <Text style={[ss.vacantText, { color: dc.cardText }]}>Not yet set</Text>
            <Text style={[ss.vacantSub, { color: dc.textSecondary }]}>Play a round to claim this record</Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

// ── Main screen ───────────────────────────────────────────────
export default function RecordsScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { localLogo, logoUrl } = useSocietyTheme();
  const [records, setRecords] = useState<Partial<Record<RecordType, RecordEntry>>>({});
  const [societyName, setSocietyName] = useState('Society');
  const [opened, setOpened] = useState(false);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  // Grand opening animation values
  const trophyScale  = useRef(new Animated.Value(0)).current;
  const trophyPulse  = useRef(new Animated.Value(1)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleSlideY  = useRef(new Animated.Value(-24)).current;
  const glowScale    = useRef(new Animated.Value(0.3)).current;
  const glowOpacity  = useRef(new Animated.Value(0)).current;
  const scrollOpacity = useRef(new Animated.Value(0)).current;

  // Per-card animations (4 records)
  const cardSlides  = useRef(RECORD_DEFS.map(() => new Animated.Value(50))).current;
  const cardOpacity = useRef(RECORD_DEFS.map(() => new Animated.Value(0))).current;

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!opened) return;
    runGrandOpening();
  }, [opened]);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setOpened(true); return; }

    const { data: player } = await supabase
      .from('players').select('id').eq('auth_uid', user.id).maybeSingle();
    if (!player) { setOpened(true); return; }

    const pid = (player as any).id as string;

    const [memberRes, recordsRes] = await Promise.all([
      supabase
        .from('society_members')
        .select('societies(name), society_id')
        .eq('player_id', pid)
        .limit(1)
        .maybeSingle(),
      supabase
        .from('society_members')
        .select('society_id')
        .eq('player_id', pid)
        .limit(1)
        .maybeSingle(),
    ]);

    const societyId = (memberRes.data as any)?.society_id;
    setSocietyName((memberRes.data as any)?.societies?.name ?? 'Society');

    if (societyId) {
      const { data: rows } = await supabase
        .from('society_records')
        .select('*')
        .eq('society_id', societyId);

      const map: Partial<Record<RecordType, RecordEntry>> = {};
      for (const r of (rows ?? []) as any[]) {
        map[r.record_type as RecordType] = {
          type:        r.record_type,
          playerName:  r.player_name,
          value:       Number(r.value),
          courseName:  r.course_name ?? null,
          achievedAt:  r.achieved_at ?? null,
        };
      }
      setRecords(map);
    }

    setOpened(true);
  }

  function runGrandOpening() {
    // Trophy springs in with glow
    Animated.parallel([
      Animated.spring(trophyScale, { toValue: 1, friction: 3, tension: 50, useNativeDriver: true }),
      Animated.timing(glowOpacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.spring(glowScale,   { toValue: 1, friction: 5, tension: 40, useNativeDriver: true }),
    ]).start();

    // Trophy pulses
    Animated.delay(600).start(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(trophyPulse, { toValue: 1.08, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(trophyPulse, { toValue: 1.0,  duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
    });

    // Title slides down
    Animated.sequence([
      Animated.delay(400),
      Animated.parallel([
        Animated.timing(titleOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(titleSlideY,  { toValue: 0, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
    ]).start();

    // Scroll area fades in
    Animated.sequence([
      Animated.delay(700),
      Animated.timing(scrollOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();

    // Record cards stagger in
    RECORD_DEFS.forEach((_, i) => {
      Animated.sequence([
        Animated.delay(800 + i * 180),
        Animated.parallel([
          Animated.timing(cardOpacity[i], { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.spring(cardSlides[i],  { toValue: 0, friction: 7, tension: 80, useNativeDriver: true }),
        ]),
      ]).start();
    });
  }

  if (!opened || !fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: dc.bg }}><StatusBar style="light" /></View>;
  }

  return (
    <View style={[ss.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={ss.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[ss.back, { color: dc.gold }]}>← Back</Text>
        </TouchableOpacity>
        <Image source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)} style={ss.headerLogo} resizeMode="contain" />
        <View style={{ width: 56 }} />
      </View>

      {/* Hero trophy */}
      <View style={ss.heroArea}>
        <Animated.View style={[ss.glow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
        <Animated.Text style={[ss.trophyEmoji, { transform: [{ scale: Animated.multiply(trophyScale, trophyPulse) }] }]}>
          🏆
        </Animated.Text>
        <Animated.View style={{ opacity: titleOpacity, transform: [{ translateY: titleSlideY }], alignItems: 'center' }}>
          <Text style={[ss.wallTitle, { color: dc.gold }]}>WALL OF RECORDS</Text>
          <Text style={[ss.societyName, { color: dc.cardText }]}>{societyName}</Text>
          <View style={[ss.titleDivider, { backgroundColor: dc.gold }]} />
        </Animated.View>
      </View>

      {/* Records */}
      <Animated.ScrollView
        style={{ opacity: scrollOpacity }}
        contentContainerStyle={ss.scroll}
        showsVerticalScrollIndicator={false}
      >
        {RECORD_DEFS.map((def, i) => (
          <RecordCard
            key={def.type}
            def={def}
            entry={records[def.type] ?? null}
            slideY={cardSlides[i]}
            opacity={cardOpacity[i]}
            dc={dc}
          />
        ))}
        <View style={{ height: 40 }} />
      </Animated.ScrollView>
    </View>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const ss = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 8,
  },
  back:       { fontSize: 14, fontFamily: FFB, color: GOLD },
  headerLogo: { width: 80, height: 28 },

  heroArea: {
    alignItems: 'center', paddingTop: 12, paddingBottom: 24,
    position: 'relative',
  },
  glow: {
    position: 'absolute',
    width: 220, height: 220, borderRadius: 110,
    backgroundColor: 'rgba(212,175,55,0.10)',
    top: -20,
  },
  trophyEmoji: { fontSize: 72, lineHeight: 80, marginBottom: 12 },
  wallTitle: {
    fontSize: 22, fontFamily: FFB, color: GOLD,
    letterSpacing: 4, textTransform: 'uppercase',
  },
  societyName: {
    fontSize: 14, fontFamily: FFB, color: '#fff',
    letterSpacing: 2, textTransform: 'uppercase', marginTop: 4,
  },
  titleDivider: {
    width: 80, height: 2, borderRadius: 1,
    backgroundColor: GOLD, opacity: 0.35, marginTop: 12,
  },

  scroll: { paddingHorizontal: 20 },

  card: {
    borderRadius: 14, borderWidth: 1,
    padding: 16, marginBottom: 16,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardIcon:   { fontSize: 22 },
  cardLabel:  { fontSize: 11, fontFamily: FFB, color: '#fff', letterSpacing: 1.5, textTransform: 'uppercase' },

  valueRow:  { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  valueNum:  { fontSize: 48, fontFamily: FFB, color: GOLD, lineHeight: 52 },
  valueUnit: { fontSize: 14, fontFamily: FFB, color: '#fff', marginBottom: 8 },

  holderName:   { fontSize: 18, fontFamily: FFB, color: '#fff', marginTop: 2 },
  courseName:   { fontSize: 11, fontFamily: FFB, color: '#fff', marginTop: 3 },
  achievedDate: { fontSize: 11, fontFamily: FFB, color: '#fff', marginTop: 2, opacity: 0.7 },

  vacant:    { paddingVertical: 16, alignItems: 'center' },
  vacantText:{ fontSize: 16, fontFamily: FFB, color: '#fff' },
  vacantSub: { fontSize: 11, fontFamily: FFB, color: '#444', marginTop: 4 },
});
