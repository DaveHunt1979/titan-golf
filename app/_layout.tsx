import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Dimensions, Platform } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { supabase } from '../src/lib/supabase';
import { initDb } from '../src/lib/localDb';

const { width: SW, height: SH } = Dimensions.get('window');
const IS_PAD  = Platform.OS === 'ios' && !!(Platform as any).isPad;
const splashBg     = require('../assets/splash-screen.png');
const splashBgiPad = IS_PAD ? require('../assets/splash-screen-ipad.png') : null;

// ── Animated splash ────────────────────────────────────────────────────────
function AnimatedSplash({ onComplete }: { onComplete: () => void }) {
  const bgOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(bgOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.delay(3000),
    ]).start(() => onComplete());
  }, []);

  return (
    <View style={ss.root}>
      <Animated.Image
        source={splashBgiPad ?? splashBg}
        style={[StyleSheet.absoluteFillObject, { opacity: bgOpacity, width: SW, height: SH }]}
        resizeMode="cover"
      />
    </View>
  );
}

// ── Root layout ────────────────────────────────────────────────────────────
type Gate = 'booting' | 'open';

export default function RootLayout() {
  const router     = useRouter();
  const segments   = useSegments();
  const [gate, setGate] = useState<Gate>('booting');

  const gateRef       = useRef<Gate>('booting');
  const proceededRef  = useRef(false);
  const routerRef     = useRef(router);
  const segmentsRef   = useRef(segments);
  const authResultRef = useRef<{ resolved: boolean; hasSession: boolean }>({ resolved: false, hasSession: false });
  const animDoneRef   = useRef(false);

  routerRef.current  = router;
  segmentsRef.current = segments;

  function redirect(hasSession: boolean) {
    const inAuth = segmentsRef.current[0] === '(auth)';
    if (!hasSession && !inAuth) routerRef.current.replace('/(auth)');
    else if (hasSession && inAuth) routerRef.current.replace('/(app)');
  }

  function tryProceed() {
    if (proceededRef.current) return;
    if (!authResultRef.current.resolved || !animDoneRef.current) return;
    proceededRef.current = true;
    gateRef.current = 'open';
    setGate('open');
    redirect(authResultRef.current.hasSession);
  }

  function onAuthResolved(hasSession: boolean) {
    authResultRef.current = { resolved: true, hasSession };
    tryProceed();
  }

  function onAnimComplete() {
    animDoneRef.current = true;
    tryProceed();
  }

  // Lock iPad to landscape, iPhone to portrait
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const lock = (Platform as any).isPad
      ? ScreenOrientation.OrientationLock.LANDSCAPE
      : ScreenOrientation.OrientationLock.PORTRAIT_UP;
    ScreenOrientation.lockAsync(lock).catch(() => {});
  }, []);

  useEffect(() => {
    async function init() {
      try {
        await initDb();
        const { data: { session } } = await supabase.auth.getSession();
        onAuthResolved(!!session);
      } catch {
        onAuthResolved(false);
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
    return <AnimatedSplash onComplete={onAnimComplete} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Slot />
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const ss = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
