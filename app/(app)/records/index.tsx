import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { colors, fonts, radius, spacing } from '../../../src/lib/theme';

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
  def, entry, slideY, opacity,
}: {
  def: typeof RECORD_DEFS[0];
  entry: RecordEntry | null;
  slideY: Animated.Value;
  opacity: Animated.Value;
}) {
  return (
    <Animated.View style={[ss.card, { opacity, transform: [{ translateY: slideY }] }]}>
      <View style={ss.cardHeader}>
        <Text style={ss.cardIcon}>{def.icon}</Text>
        <Text style={ss.cardLabel}>{def.label}</Text>
      </View>

      {entry ? (
        <>
          <View style={ss.valueRow}>
            <Text style={ss.valueNum}>{entry.value}</Text>
            <Text style={ss.valueUnit}>{def.unit}</Text>
          </View>
          <Text style={ss.holderName}>{entry.playerName}</Text>
          {entry.courseName && (
            <Text style={ss.courseName} numberOfLines={1}>{entry.courseName}</Text>
          )}
          {entry.achievedAt && (
            <Text style={ss.achievedDate}>{formatDate(entry.achievedAt)}</Text>
          )}
        </>
      ) : (
        <View style={ss.vacant}>
          <Text style={ss.vacantText}>Not yet set</Text>
          <Text style={ss.vacantSub}>Play a round to claim this record</Text>
        </View>
      )}
    </Animated.View>
  );
}

// ── Main screen ───────────────────────────────────────────────
export default function RecordsScreen() {
  const router = useRouter();
  const [records, setRecords] = useState<Partial<Record<RecordType, RecordEntry>>>({});
  const [societyName, setSocietyName] = useState('Society');
  const [opened, setOpened] = useState(false);

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

  return (
    <View style={ss.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={ss.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={ss.back}>← Back</Text>
        </TouchableOpacity>
        <View style={{ width: 56 }} />
      </View>

      {/* Hero trophy */}
      <View style={ss.heroArea}>
        <Animated.View style={[ss.glow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
        <Animated.Text style={[ss.trophyEmoji, { transform: [{ scale: Animated.multiply(trophyScale, trophyPulse) }] }]}>
          🏆
        </Animated.Text>
        <Animated.View style={{ opacity: titleOpacity, transform: [{ translateY: titleSlideY }], alignItems: 'center' }}>
          <Text style={ss.wallTitle}>WALL OF RECORDS</Text>
          <Text style={ss.societyName}>{societyName}</Text>
          <View style={ss.titleDivider} />
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
  container: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
  },
  back: { fontSize: fonts.sm, fontWeight: '600', color: colors.gold },

  heroArea: {
    alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.xl,
    position: 'relative',
  },
  glow: {
    position: 'absolute',
    width: 220, height: 220, borderRadius: 110,
    backgroundColor: 'rgba(212,175,55,0.10)',
    top: -20,
  },
  trophyEmoji: { fontSize: 72, lineHeight: 80, marginBottom: spacing.md },
  wallTitle: {
    fontSize: fonts.xl, fontWeight: '900', color: colors.gold,
    letterSpacing: 4, textTransform: 'uppercase',
  },
  societyName: {
    fontSize: fonts.sm, color: colors.textMuted,
    letterSpacing: 2, textTransform: 'uppercase', marginTop: 4,
  },
  titleDivider: {
    width: 80, height: 2, borderRadius: 1,
    backgroundColor: colors.gold, opacity: 0.35, marginTop: spacing.sm,
  },

  scroll: { paddingHorizontal: spacing.lg },

  card: {
    backgroundColor: colors.card, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  cardIcon:   { fontSize: 22 },
  cardLabel:  { fontSize: fonts.xs, fontWeight: '800', color: colors.textMuted, letterSpacing: 1.5, textTransform: 'uppercase' },

  valueRow:  { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs },
  valueNum:  { fontSize: 48, fontWeight: '900', color: colors.gold, lineHeight: 52 },
  valueUnit: { fontSize: fonts.sm, color: colors.textMuted, marginBottom: 8, fontWeight: '600' },

  holderName:   { fontSize: fonts.lg, fontWeight: '800', color: colors.white, marginTop: 2 },
  courseName:   { fontSize: fonts.xs, color: colors.textMuted, marginTop: 3 },
  achievedDate: { fontSize: fonts.xs, color: colors.textMuted, marginTop: 2, opacity: 0.7 },

  vacant:    { paddingVertical: spacing.md, alignItems: 'center' },
  vacantText:{ fontSize: fonts.md, fontWeight: '700', color: colors.textMuted },
  vacantSub: { fontSize: fonts.xs, color: colors.textMuted, marginTop: 4, opacity: 0.6 },
});
