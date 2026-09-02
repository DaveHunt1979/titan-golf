import { useEffect, useRef } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, Animated } from 'react-native';

interface Props {
  visible: boolean;
  senderName: string;
  preview: string;
  onDismiss: () => void;
  onView: () => void;
}

const COLOR = '#4ade80';
const FFB = 'JUSTSans-ExBold';
const FF  = 'JUSTSans';

// Same visual grammar as EagleAlert (hole-in-one/eagle celebration) — rings,
// spring-in card, dark backdrop, auto-dismiss — reused here for a message
// arriving while the recipient is mid-round, so an incoming DM/chat message
// doesn't interrupt scoring with the plain system banner (Dave, 2026-09-02).
export default function MessageAlert({ visible, senderName, preview, onDismiss, onView }: Props) {
  const scale   = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

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
        <TouchableOpacity activeOpacity={0.9} onPress={onView}>
          <Animated.View style={[s.card, { transform: [{ scale }], opacity }]}>
            <View style={[s.ring, s.ring1, { borderColor: `${COLOR}25` }]} />
            <View style={[s.ring, s.ring2, { borderColor: `${COLOR}12` }]} />

            <Text style={s.emoji}>💬</Text>
            <Text style={[s.label, { color: COLOR }]}>NEW MESSAGE</Text>
            <Text style={s.player}>{senderName}</Text>
            <Text style={[s.sub, { color: 'rgba(255,255,255,0.55)' }]} numberOfLines={2}>{preview}</Text>

            <View style={[s.tapPill, { borderColor: `${COLOR}35` }]}>
              <Text style={[s.tapText, { color: COLOR }]}>TAP TO VIEW</Text>
            </View>
          </Animated.View>
        </TouchableOpacity>
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
  emoji:  { fontSize: 72, marginBottom: 20 },
  label:  { fontFamily: FFB, fontSize: 32, letterSpacing: 1, textAlign: 'center', marginBottom: 14 },
  player: { fontFamily: FFB, fontSize: 22, color: '#ffffff', textAlign: 'center', marginBottom: 8 },
  sub:    { fontFamily: FF,  fontSize: 15, letterSpacing: 0.2, textAlign: 'center', marginBottom: 36, paddingHorizontal: 12 },
  tapPill: {
    borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 22, paddingVertical: 9,
  },
  tapText: { fontFamily: FFB, fontSize: 10, letterSpacing: 2 },
});
