import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { colors, fonts, spacing } from '../src/lib/theme';
import { titanLogo } from '../src/lib/assets';

type Gate = 'booting' | 'open';

function LoadingSplash() {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 850, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.94, duration: 850, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <View style={ss.screen}>
      <Animated.Image
        source={titanLogo}
        style={[ss.logo, { transform: [{ scale: pulse }] }]}
        resizeMode="contain"
      />
      <Text style={ss.title}>TITAN GOLF</Text>
    </View>
  );
}

export default function RootLayout() {
  const router      = useRouter();
  const segments    = useSegments();
  const [gate, setGate] = useState<Gate>('booting');
  const gateRef       = useRef<Gate>('booting');
  const proceededRef  = useRef(false);
  const routerRef     = useRef(router);
  const segmentsRef   = useRef(segments);

  routerRef.current   = router;
  segmentsRef.current = segments;

  function updateGate(g: Gate) {
    gateRef.current = g;
    setGate(g);
  }

  function redirect(hasSession: boolean) {
    const inAuth = segmentsRef.current[0] === '(auth)';
    if (!hasSession && !inAuth) routerRef.current.replace('/(auth)');
    else if (hasSession && inAuth) routerRef.current.replace('/(app)');
  }

  function proceed(hasSession: boolean) {
    if (proceededRef.current) return;
    proceededRef.current = true;
    updateGate('open');
    redirect(hasSession);
  }

  useEffect(() => {
    async function init() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        proceed(!!session);
      } catch {
        proceed(false);
      }
    }
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_ev, session) => {
      if (gateRef.current !== 'open') return;
      redirect(!!session);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (gate !== 'open') {
    return <LoadingSplash />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Slot />
    </View>
  );
}

const ss = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  logo:  { width: 140, height: 140 },
  title: { fontSize: fonts.xxl, fontWeight: '800', color: colors.white, letterSpacing: 4 },
});
