import { useEffect, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { colors } from '../src/lib/theme';
import { titanLogo, hosts } from '../src/lib/assets';

const { width: SW } = Dimensions.get('window');

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
    Animated.sequence([
      // Logo springs in
      Animated.parallel([
        Animated.timing(logoOpacity,    { toValue: 1,   duration: 450, useNativeDriver: true }),
        Animated.spring(logoScale,      { toValue: 1,   friction: 5,  tension: 90, useNativeDriver: true }),
      ]),
      Animated.delay(450),
      // Logo whooshes out
      Animated.parallel([
        Animated.timing(logoOpacity,    { toValue: 0,   duration: 280, useNativeDriver: true }),
        Animated.timing(logoScale,      { toValue: 2.8, duration: 320, useNativeDriver: true }),
        Animated.timing(logoTranslateY, { toValue: -50, duration: 320, useNativeDriver: true }),
      ]),
      // Birdie & Chip slide in from sides
      Animated.parallel([
        Animated.timing(hostsOpacity,   { toValue: 1,   duration: 200, useNativeDriver: true }),
        Animated.spring(birdieX,        { toValue: 0,   friction: 7,  tension: 65, useNativeDriver: true }),
        Animated.spring(chipX,          { toValue: 0,   friction: 7,  tension: 65, useNativeDriver: true }),
      ]),
      Animated.delay(250),
      // Text fades in
      Animated.timing(line1Opacity,     { toValue: 1,   duration: 350, useNativeDriver: true }),
      Animated.delay(100),
      Animated.timing(line2Opacity,     { toValue: 1,   duration: 400, useNativeDriver: true }),
      Animated.delay(1400),
      // Everything fades out
      Animated.timing(screenOpacity,    { toValue: 0,   duration: 500, useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) onDone(); });
  }, []);

  return (
    <Animated.View style={[ss.screen, { opacity: screenOpacity }]}>
      <View style={ss.top}>
        <Animated.Image
          source={titanLogo}
          style={[ss.logo, {
            opacity: logoOpacity,
            transform: [{ scale: logoScale }, { translateY: logoTranslateY }],
          }]}
          resizeMode="contain"
        />
        <Animated.Text style={[ss.line1, { opacity: line1Opacity }]}>
          POWERED BY TITAN HOSTS
        </Animated.Text>
        <Animated.Text style={[ss.line2, { opacity: line2Opacity }]}>
          CHIP & BIRDIE
        </Animated.Text>
      </View>
      <View style={ss.hostsRow}>
        <Animated.Image
          source={hosts.birdieBody}
          style={[ss.hostImg, { opacity: hostsOpacity, transform: [{ translateX: birdieX }] }]}
          resizeMode="cover"
        />
        <Animated.Image
          source={hosts.chipBody}
          style={[ss.hostImg, { opacity: hostsOpacity, transform: [{ translateX: chipX }] }]}
          resizeMode="cover"
        />
      </View>
    </Animated.View>
  );
}

export default function RootLayout() {
  const router   = useRouter();
  const segments = useSegments();
  const [gate, setGate]  = useState<Gate>('booting');
  const gateRef          = useRef<Gate>('booting');
  const splashDoneRef    = useRef(false);
  const authResultRef    = useRef<{ hasSession: boolean } | null>(null);

  function updateGate(g: Gate) {
    gateRef.current = g;
    setGate(g);
  }

  const redirect = useCallback((hasSession: boolean) => {
    const inAuth = segments[0] === '(auth)';
    if (!hasSession && !inAuth) router.replace('/(auth)');
    else if (hasSession && inAuth) router.replace('/(app)');
  }, [segments, router]);

  function proceed(hasSession: boolean) {
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
  }, [redirect]);

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
  },
  top: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 40,
  },
  logo: {
    width: 160,
    height: 160,
    marginBottom: 48,
  },
  line1: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 4,
  },
  line2: {
    fontSize: 44,
    fontWeight: '900',
    fontStyle: 'italic',
    color: colors.gold,
    letterSpacing: 3,
    marginTop: 6,
  },
  hostsRow: {
    height: 340,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  hostImg: {
    flex: 1,
    height: 340,
  },
});
