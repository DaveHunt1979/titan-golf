import '../src/lib/fontScaleCap'; // caps iOS Dynamic Type app-wide — must run before anything renders
import { useEffect, useRef, useState } from 'react';
import { View, Image, StyleSheet, Animated, Dimensions, Platform } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { supabase } from '../src/lib/supabase';
import { initDb } from '../src/lib/localDb';
import { titanLogo } from '../src/lib/assets';

const { width: SW, height: SH } = Dimensions.get('window');
const IS_PAD  = Platform.OS === 'ios' && !!(Platform as any).isPad;
const splashBg     = require('../assets/splash-screen.png');
const splashBgiPad = IS_PAD ? require('../assets/splash-screen-ipad.png') : null;
const featureIntroBg = require('../assets/feature-intro.png');

// ── Fade-in / hold / fade-out image beat — used for both screen 1 (splash)
// and screen 2 (feature intro). Fully automatic, no tap — Dave, 2026-09-10:
// "I don't think we should click on the image to go on, I like the load,
// fade, load fade, logo and then in".
function FadeImageStage({ source, holdMs, onComplete }: { source: any; holdMs: number; onComplete: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.delay(holdMs),
      Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start(() => onComplete());
  }, []);

  return (
    <View style={ss.root}>
      <Animated.Image
        source={source}
        style={[StyleSheet.absoluteFillObject, { opacity, width: SW, height: SH }]}
        resizeMode="cover"
      />
    </View>
  );
}

// ── Pulsating logo (screen 3) — the closing "here we go" beat before the
// app opens. Was invisible on device even as a plain static <Image> with
// zero animation — root cause was the source asset itself, not this
// component: assets/teams/"Titan Logo.png" had a space in its filename,
// which Metro's dev asset server silently failed to serve at this very
// early point in the boot sequence (no error, just never loads). Renamed
// to TitanLogo.png (src/lib/assets.ts) and it renders reliably.
function PulsingLogo({ onComplete }: { onComplete: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale   = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.delay(1400),
      Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start(() => onComplete());

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.12, duration: 550, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1,    duration: 550, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <View style={ss.root}>
      <Animated.Image
        source={titanLogo}
        style={{ width: 180, height: 75, opacity, transform: [{ scale }] }}
        resizeMode="contain"
      />
    </View>
  );
}

// ── Root layout ────────────────────────────────────────────────────────────
// Boot sequence on every cold start (hard-closed and reopened — backgrounding
// and resuming doesn't remount this component, so it never replays there):
// splash fades in/out → feature intro fades in/out → pulsing logo → app,
// fully automatic, no tap (Dave, 2026-09-10).
type Stage = 'splash' | 'intro' | 'pulse' | 'open';

export default function RootLayout() {
  const router     = useRouter();
  const segments   = useSegments();
  const [stage, setStage] = useState<Stage>('splash');

  const stageRef      = useRef<Stage>('splash');
  const proceededRef  = useRef(false);
  const routerRef     = useRef(router);
  const segmentsRef   = useRef(segments);
  const authResultRef = useRef<{ resolved: boolean; hasSession: boolean }>({ resolved: false, hasSession: false });
  const pulseDoneRef  = useRef(false);

  routerRef.current  = router;
  segmentsRef.current = segments;

  function redirect(hasSession: boolean) {
    const inAuth = segmentsRef.current[0] === '(auth)';
    if (!hasSession && !inAuth) routerRef.current.replace('/(auth)');
    else if (hasSession && inAuth) routerRef.current.replace('/(app)');
  }

  // Only the final (pulse → open) transition waits on both conditions —
  // same "don't flash a screen before we know which one" guard the original
  // single-stage gate used, just moved to the last beat of the sequence.
  function tryOpen() {
    if (proceededRef.current) return;
    if (!authResultRef.current.resolved || !pulseDoneRef.current) return;
    proceededRef.current = true;
    stageRef.current = 'open';
    setStage('open');
    redirect(authResultRef.current.hasSession);
  }

  function onAuthResolved(hasSession: boolean) {
    authResultRef.current = { resolved: true, hasSession };
    tryOpen();
  }

  function onSplashComplete() { stageRef.current = 'intro'; setStage('intro'); }
  function onIntroComplete()  { stageRef.current = 'pulse'; setStage('pulse'); }
  function onPulseComplete()  { pulseDoneRef.current = true; tryOpen(); }

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
      if (stageRef.current !== 'open') return;
      redirect(!!session);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Every stage gets its own `key` so React remounts fresh rather than
  // reusing the previous instance — splash and intro are both
  // FadeImageStage at the same tree position, and without a key React
  // updates that instance's props in place instead of remounting it, which
  // left the [] -dep fade effect never re-running for the second stage
  // (Dave, 2026-09-10: "there is no pulsating logo anymore" — it never got
  // past the intro screen to reach it).
  if (stage === 'splash') return <FadeImageStage key="splash" source={splashBgiPad ?? splashBg} holdMs={1600} onComplete={onSplashComplete} />;
  if (stage === 'intro')  return <FadeImageStage key="intro" source={featureIntroBg} holdMs={2200} onComplete={onIntroComplete} />;
  if (stage === 'pulse')  return <PulsingLogo onComplete={onPulseComplete} />;

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
