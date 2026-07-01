import { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { BrokenRecord } from '../lib/records';
import { colors, fonts, radius, spacing } from '../lib/theme';

interface Props {
  records: BrokenRecord[];
  onDismiss: () => void;
}

// Orbiting gold particle
function Particle({ angle, radius: r, delay }: { angle: number; radius: number; delay: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.spring(scale,   { toValue: 1, friction: 5, tension: 100, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  const x = Math.cos((angle * Math.PI) / 180) * r;
  const y = Math.sin((angle * Math.PI) / 180) * r;

  return (
    <Animated.View style={{
      position: 'absolute',
      width: 6, height: 6, borderRadius: 3,
      backgroundColor: colors.gold,
      transform: [{ translateX: x }, { translateY: y }, { scale }],
      opacity,
    }} />
  );
}

export default function RecordCelebration({ records, onDismiss }: Props) {
  const trophyScale   = useRef(new Animated.Value(0)).current;
  const titleOpacity  = useRef(new Animated.Value(0)).current;
  const titleTranslY  = useRef(new Animated.Value(20)).current;
  const cardOpacity   = useRef(new Animated.Value(0)).current;
  const cardTranslY   = useRef(new Animated.Value(30)).current;
  const pulse         = useRef(new Animated.Value(1)).current;
  const glowOpacity   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Trophy springs in
    Animated.spring(trophyScale, {
      toValue: 1, friction: 4, tension: 60, useNativeDriver: true,
    }).start();

    // Glow fades in
    Animated.timing(glowOpacity, {
      toValue: 1, duration: 600, useNativeDriver: true,
    }).start();

    // Trophy pulses continuously
    Animated.delay(400).start(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1.0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
    });

    // Title slides in
    Animated.sequence([
      Animated.delay(500),
      Animated.parallel([
        Animated.timing(titleOpacity,  { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(titleTranslY,  { toValue: 0, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
    ]).start();

    // Cards slide in
    Animated.sequence([
      Animated.delay(900),
      Animated.parallel([
        Animated.timing(cardOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(cardTranslY, { toValue: 0, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  const PARTICLE_ANGLES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

  return (
    <Modal transparent animationType="fade" visible statusBarTranslucent>
      <View style={ss.overlay}>

        {/* Gold radial glow */}
        <Animated.View style={[ss.glow, { opacity: glowOpacity }]} />

        {/* Trophy */}
        <View style={ss.trophyWrap}>
          {PARTICLE_ANGLES.map((angle, i) => (
            <Particle key={angle} angle={angle} radius={70} delay={300 + i * 40} />
          ))}
          <Animated.Text style={[ss.trophy, { transform: [{ scale: Animated.multiply(trophyScale, pulse) }] }]}>
            🏆
          </Animated.Text>
        </View>

        {/* Title */}
        <Animated.View style={{ opacity: titleOpacity, transform: [{ translateY: titleTranslY }], alignItems: 'center' }}>
          <Text style={ss.newRecord}>NEW SOCIETY RECORD{records.length > 1 ? 'S' : ''}!</Text>
          <View style={ss.divider} />
        </Animated.View>

        {/* Record cards */}
        <Animated.View style={[ss.cards, { opacity: cardOpacity, transform: [{ translateY: cardTranslY }] }]}>
          {records.map(r => (
            <View key={r.type} style={ss.card}>
              <Text style={ss.cardIcon}>{r.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={ss.cardLabel}>{r.label}</Text>
                {r.prevHolder && r.oldValue != null && (
                  <Text style={ss.cardPrev}>
                    Previous: {r.prevHolder} — {r.oldValue} {r.unit}
                  </Text>
                )}
                {!r.prevHolder && (
                  <Text style={ss.cardPrev}>First ever record set!</Text>
                )}
              </View>
              <Text style={ss.cardValue}>{r.newValue}</Text>
            </View>
          ))}
        </Animated.View>

        {/* Dismiss */}
        <Animated.View style={{ opacity: cardOpacity }}>
          <TouchableOpacity style={ss.dismissBtn} onPress={onDismiss} activeOpacity={0.8}>
            <Text style={ss.dismissText}>Incredible! 🎉</Text>
          </TouchableOpacity>
        </Animated.View>

      </View>
    </Modal>
  );
}

const ss = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(7,11,16,0.97)',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  glow: {
    position: 'absolute',
    width: 300, height: 300, borderRadius: 150,
    backgroundColor: 'rgba(212,175,55,0.08)',
    top: '50%', left: '50%',
    transform: [{ translateX: -150 }, { translateY: -240 }],
  },
  trophyWrap: {
    width: 120, height: 120,
    alignItems: 'center', justifyContent: 'center',
  },
  trophy: { fontSize: 72, lineHeight: 80 },

  newRecord: {
    fontSize: fonts.xl, fontWeight: '900', color: colors.gold,
    letterSpacing: 3, textTransform: 'uppercase', textAlign: 'center',
    marginBottom: spacing.sm,
  },
  divider: {
    width: 120, height: 2, borderRadius: 1,
    backgroundColor: colors.gold, opacity: 0.4,
  },

  cards: { width: '100%', gap: spacing.sm },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.goldBorder,
    padding: spacing.md,
  },
  cardIcon:  { fontSize: 28 },
  cardLabel: { fontSize: fonts.sm, fontWeight: '800', color: colors.white, marginBottom: 2 },
  cardPrev:  { fontSize: fonts.xs, color: colors.textMuted },
  cardValue: { fontSize: fonts.xxl, fontWeight: '900', color: colors.gold },

  dismissBtn: {
    backgroundColor: colors.gold, borderRadius: radius.full,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
  },
  dismissText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg },
});
