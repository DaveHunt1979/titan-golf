import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, PanResponder, type ViewStyle, type StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const FFB = 'JUSTSans-ExBold';
const SWIPE_W = 76;

// Pure-JS swipe-to-delete — react-native-gesture-handler isn't installed in
// this project (only an optional peer dep of expo-router), so Swipeable
// would need a new native module + pod install + rebuild before it'd even
// show up in the sim. PanResponder needs no native dep, works immediately.
//
// Lifted verbatim from the swipe-to-delete already shipping on the Swindle
// list (app/(app)/swindle/index.tsx) so the gesture feels identical
// everywhere: drag the row sideways, a red bin slides in from the right,
// tap it to delete.
export default function SwipeableRow({
  children,
  onDelete,
  enabled = true,
  radius = 14,
  style,
}: {
  children: React.ReactNode;
  onDelete: () => void;
  enabled?: boolean;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => enabled && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => {
        const base = isOpen.current ? -SWIPE_W : 0;
        translateX.setValue(Math.max(-SWIPE_W, Math.min(0, base + g.dx)));
      },
      onPanResponderRelease: (_, g) => {
        const base = isOpen.current ? -SWIPE_W : 0;
        const shouldOpen = base + g.dx < -SWIPE_W / 2;
        isOpen.current = shouldOpen;
        Animated.spring(translateX, { toValue: shouldOpen ? -SWIPE_W : 0, useNativeDriver: true, bounciness: 0 }).start();
      },
    })
  ).current;

  if (!enabled) return <>{children}</>;

  return (
    <View style={style}>
      <View style={[sw.deleteWrap, { borderRadius: radius }]}>
        <TouchableOpacity style={sw.deleteBtn} onPress={onDelete} activeOpacity={0.8}>
          <Ionicons name="trash-outline" size={18} color="#fff" />
          <Text style={sw.deleteText}>Delete</Text>
        </TouchableOpacity>
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const sw = StyleSheet.create({
  deleteWrap: { position: 'absolute', top: 0, bottom: 0, right: 0, width: SWIPE_W, overflow: 'hidden' },
  deleteBtn:  { flex: 1, backgroundColor: '#f87171', alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: '#fff', fontFamily: FFB, fontSize: 11, marginTop: 2 },
});
