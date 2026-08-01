import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Dimensions, Image } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { initDb } from '../src/lib/localDb';
import { titanLogo } from '../src/lib/assets';

const { width: SW, height: SH } = Dimensions.get('window');
const BALL_SIZE  = 90;
const splashBg   = require('../assets/splash-screen.png');
const crackGlass = require('../assets/crack_glass.png');

// ── Animated splash ────────────────────────────────────────────────────────
function AnimatedSplash({ onComplete }: { onComplete: () => void }) {
  const ballScale    = useRef(new Animated.Value(0)).current;
  const ballOpacity  = useRef(new Animated.Value(1)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const crackOpacity = useRef(new Animated.Value(0)).current;
  const shakeX       = useRef(new Animated.Value(0)).current;
  const bgOpacity    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fade in background immediately
    Animated.timing(bgOpacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();

    // Ball smash sequence
    Animated.sequence([
      // Pause — let background settle
      Animated.delay(250),
      // Ball appears as tiny dot
      Animated.timing(ballScale, { toValue: 0.04, duration: 200, useNativeDriver: true }),
      // Rockets toward viewer
      Animated.timing(ballScale, {
        toValue: 14,
        duration: 550,
        useNativeDriver: true,
        // easeIn curve — accelerates like a real ball
      }),
      // Impact: flash + crack glass + shake in parallel
      Animated.parallel([
        Animated.timing(flashOpacity, { toValue: 1, duration: 80, useNativeDriver: true }),
        Animated.timing(crackOpacity, { toValue: 1, duration: 80, useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(shakeX, { toValue: 14,  duration: 40, useNativeDriver: true }),
          Animated.timing(shakeX, { toValue: -14, duration: 40, useNativeDriver: true }),
          Animated.timing(shakeX, { toValue: 10,  duration: 35, useNativeDriver: true }),
          Animated.timing(shakeX, { toValue: -10, duration: 35, useNativeDriver: true }),
          Animated.timing(shakeX, { toValue: 5,   duration: 30, useNativeDriver: true }),
          Animated.timing(shakeX, { toValue: 0,   duration: 30, useNativeDriver: true }),
        ]),
      ]),
      // Hold white flash briefly
      Animated.delay(120),
      // Flash, crack, and ball fade out — splash image revealed
      Animated.parallel([
        Animated.timing(flashOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(crackOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(ballOpacity,  { toValue: 0, duration: 300, useNativeDriver: true }),
      ]),
      // Hold on splash for a moment
      Animated.delay(700),
    ]).start(() => onComplete());
  }, []);

  return (
    <View style={ss.root}>
      {/* Background splash image */}
      <Animated.Image
        source={splashBg}
        style={[StyleSheet.absoluteFillObject, { opacity: bgOpacity }]}
        resizeMode="cover"
      />

      {/* Shake wrapper — everything inside shakes on impact */}
      <Animated.View style={[StyleSheet.absoluteFillObject, { transform: [{ translateX: shakeX }] }]}>
        {/* Golf ball — white circle with Titan logo */}
        <Animated.View
          style={[
            ss.ball,
            {
              transform: [{ scale: ballScale }],
              opacity: ballOpacity,
            },
          ]}
        >
          <Image source={titanLogo} style={ss.ballLogo} resizeMode="contain" />
        </Animated.View>
      </Animated.View>

      {/* Cracked glass overlay — fades in on impact */}
      <Animated.Image
        source={crackGlass}
        style={[StyleSheet.absoluteFillObject, { opacity: crackOpacity }]}
        resizeMode="cover"
      />

      {/* White impact flash — sits above everything */}
      <Animated.View style={[StyleSheet.absoluteFillObject, ss.flash, { opacity: flashOpacity }]} />
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
  ball: {
    width: BALL_SIZE,
    height: BALL_SIZE,
    borderRadius: BALL_SIZE / 2,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    // Subtle golf ball shadow
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 20,
  },
  ballLogo: {
    width: BALL_SIZE * 0.55,
    height: BALL_SIZE * 0.55,
  },
  flash: {
    backgroundColor: '#ffffff',
  },
});
