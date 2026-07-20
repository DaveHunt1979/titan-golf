import { useEffect, useRef } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, Animated } from 'react-native';

export type EagleType = 'hole_in_one' | 'albatross' | 'eagle';

interface Props {
  visible: boolean;
  type: EagleType;
  playerName: string;
  hole: number;
  onDismiss: () => void;
}

const CONFIG: Record<EagleType, { emoji: string; label: string; sub: string; color: string }> = {
  hole_in_one: { emoji: '🏆', label: 'HOLE IN ONE!', sub: 'One in a million',  color: '#f59e0b' },
  albatross:   { emoji: '✨', label: 'ALBATROSS!',   sub: 'Three under par',   color: '#a855f7' },
  eagle:       { emoji: '🦅', label: 'EAGLE!',       sub: 'Two under par',     color: '#D4AF37' },
};

const FFB = 'JUSTSans-ExBold';
const FF  = 'JUSTSans';

export default function EagleAlert({ visible, type, playerName, hole, onDismiss }: Props) {
  const scale   = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const cfg = CONFIG[type];

  useEffect(() => {
    if (!visible) {
      scale.setValue(0);
      opacity.setValue(0);
      return;
    }

    Animated.parallel([
      Animated.spring(scale,   { toValue: 1, useNativeDriver: true, tension: 55, friction: 7 }),
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();

    const t = setTimeout(onDismiss, 4500);
    return () => clearTimeout(t);
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={onDismiss}>
      <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onDismiss}>
        <Animated.View style={[s.card, { transform: [{ scale }], opacity }]}>
          <View style={[s.ring, s.ring1, { borderColor: `${cfg.color}25` }]} />
          <View style={[s.ring, s.ring2, { borderColor: `${cfg.color}12` }]} />

          <Text style={s.emoji}>{cfg.emoji}</Text>
          <Text style={[s.label, { color: cfg.color }]}>{cfg.label}</Text>
          <Text style={s.player}>{playerName}</Text>
          <Text style={[s.hole, { color: 'rgba(255,255,255,0.35)' }]}>HOLE {hole}</Text>
          <Text style={[s.sub, { color: 'rgba(255,255,255,0.45)' }]}>{cfg.sub}</Text>

          <View style={[s.tapPill, { borderColor: `${cfg.color}35` }]}>
            <Text style={[s.tapText, { color: cfg.color }]}>TAP TO CONTINUE</Text>
          </View>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center', justifyContent: 'center',
  },
  card: { alignItems: 'center', paddingHorizontal: 40 },
  ring: { position: 'absolute', borderRadius: 999, borderWidth: 1 },
  ring1: { width: 220, height: 220 },
  ring2: { width: 320, height: 320 },
  emoji:  { fontSize: 88, marginBottom: 20 },
  label:  { fontFamily: FFB, fontSize: 44, letterSpacing: 1, textAlign: 'center', marginBottom: 14 },
  player: { fontFamily: FFB, fontSize: 22, color: '#ffffff', textAlign: 'center', marginBottom: 6 },
  hole:   { fontFamily: FFB, fontSize: 11, letterSpacing: 2, marginBottom: 4 },
  sub:    { fontFamily: FF,  fontSize: 14, letterSpacing: 0.3, marginBottom: 36 },
  tapPill: {
    borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 22, paddingVertical: 9,
  },
  tapText: { fontFamily: FFB, fontSize: 10, letterSpacing: 2 },
});
