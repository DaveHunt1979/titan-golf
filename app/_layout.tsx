import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Dimensions, Easing } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { colors } from '../src/lib/theme';
import { titanLogo, hosts } from '../src/lib/assets';

const { width: SW, height: SH } = Dimensions.get('window');
const HOST_HEIGHT = SH * 0.62;

type Gate = 'booting' | 'open';

function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const logoOpacity    = useRef(new Animated.Value(0)).current;
  const logoScale      = useRef(new Animated.Value(0.4)).current;
  const logoTranslateY = useRef(new Animated.Value(0)).current;
  const hostsOpacity   = useRef(new Animated.Value(0)).current;
  const birdieX        = useRef(new Animated.Value(-SW)).current;
  const chipX          = useRef(new Animated.Value(SW)).current;
  const line1Opacity   = useRef(new Animated.Value(0)).current;
  const line2Opacity   = useRef(new Animated.Value(0)).current;
  const screenOpacity  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const swish1 = Animated.sequence([
      Animated.parallel([
        Animated.timing(logoOpacity, { toValue: 1,   duration: 350, useNativeDriver: true }),
        Animated.timing(logoScale,   { toValue: 1,   duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.delay(320),
      Animated.parallel([
        Animated.timing(logoOpacity,    { toValue: 0,   duration: 220, useNativeDriver: true }),
        Animated.timing(logoScale,      { toValue: 2.6, duration: 260, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(logoTranslateY, { toValue: -60, duration: 260, useNativeDriver: true }),
      ]),
    ]);

    const rest = Animated.sequence([
      Animated.parallel([
        Animated.timing(logoOpacity, { toValue: 1,   duration: 320, useNativeDriver: true }),
        Animated.timing(logoScale,   { toValue: 1,   duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.delay(280),
      Animated.parallel([
        Animated.timing(logoOpacity,    { toValue: 0,   duration: 220, useNativeDriver: true }),
        Animated.timing(logoScale,      { toValue: 2.6, duration: 260, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(logoTranslateY, { toValue: -60, duration: 260, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(hostsOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(birdieX,      { toValue: 0, friction: 7,   tension: 65, useNativeDriver: true }),
        Animated.spring(chipX,        { toValue: 0, friction: 7,   tension: 65, useNativeDriver: true }),
      ]),
      Animated.delay(250),
      Animated.timing(line1Opacity, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.delay(100),
      Animated.timing(line2Opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.delay(1400),
      Animated.timing(screenOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]);

    swish1.start(({ finished }) => {
      if (!finished) return;
      // Reset between swishes using setValue (avoids duration:0 native driver issue)
      logoScale.setValue(0.4);
      logoTranslateY.setValue(0);
      rest.start(({ finished: done }) => { if (done) onDone(); });
    });
  }, []);

  return (
    <Animated.View style={[ss.screen, { opacity: screenOpacity }]}>

      {/* Hosts — pinned to bottom, slide in from sides */}
      <Animated.Image
        source={hosts.birdieBody}
        style={[ss.hostLeft, {
          opacity: hostsOpacity,
          transform: [{ translateX: birdieX }],
        }]}
        resizeMode="contain"
      />
      <Animated.Image
        source={hosts.chipBody}
        style={[ss.hostRight, {
          opacity: hostsOpacity,
          transform: [{ translateX: chipX }],
        }]}
        resizeMode="contain"
      />

      {/* Logo — centered, appears then whooshes out */}
      <Animated.Image
        source={titanLogo}
        style={[ss.logo, {
          opacity: logoOpacity,
          transform: [{ scale: logoScale }, { translateY: logoTranslateY }],
        }]}
        resizeMode="contain"
      />

      {/* Text — sits above the hosts */}
      <Animated.Text style={[ss.line1, { opacity: line1Opacity }]}>
        POWERED BY TITAN HOSTS
      </Animated.Text>
      <Animated.Text style={[ss.line2, { opacity: line2Opacity }]}>
        CHIP & BIRDIE
      </Animated.Text>

    </Animated.View>
  );
}

export default function RootLayout() {
  const router   = useRouter();
  const segments = useSegments();
  const [gate, setGate] = useState<Gate>('booting');
  const gateRef         = useRef<Gate>('booting');
  const splashDoneRef   = useRef(false);
  const authResultRef   = useRef<{ hasSession: boolean } | null>(null);
  const proceededRef    = useRef(false);
  const routerRef       = useRef(router);
  const segmentsRef     = useRef(segments);

  // Keep refs current on every render without re-running the effect
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

  function onSplashDone() {
    splashDoneRef.current = true;
    if (authResultRef.current !== null) {
      proceed(authResultRef.current.hasSession);
    }
  }

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      authResultRef.current = { hasSession: !!session };
      if (splashDoneRef.current) {
        proceed(!!session);
      }
    }
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_ev, session) => {
      if (gateRef.current !== 'open') return;
      redirect(!!session);
    });
    return () => subscription.unsubscribe();
  }, []); // run once — router/segments accessed via refs

  if (gate !== 'open') {
    return <AnimatedSplash onDone={onSplashDone} />;
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
  },
  // Hosts: absolute, anchored to bottom, each half the screen width
  hostLeft: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: SW / 2,
    height: HOST_HEIGHT,
  },
  hostRight: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: SW / 2,
    height: HOST_HEIGHT,
  },
  // Logo: absolute, centered on screen
  logo: {
    position: 'absolute',
    width: 160,
    height: 160,
    alignSelf: 'center',
  },
  // Text: absolute, sits well above the hosts' heads (~10mm above)
  line1: {
    position: 'absolute',
    bottom: HOST_HEIGHT + 140,
    alignSelf: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 4,
  },
  line2: {
    position: 'absolute',
    bottom: HOST_HEIGHT + 84,
    alignSelf: 'center',
    fontSize: 44,
    fontWeight: '900',
    fontStyle: 'italic',
    color: colors.gold,
    letterSpacing: 3,
  },
});
