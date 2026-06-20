import { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { supabase } from '../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../src/lib/theme';
import { titanLogo } from '../src/lib/assets';

type Gate = 'booting' | 'locked' | 'open';

export default function RootLayout() {
  const router   = useRouter();
  const segments = useSegments();
  const [gate, setGate] = useState<Gate>('booting');
  const gateRef = useRef<Gate>('booting');

  function updateGate(g: Gate) {
    gateRef.current = g;
    setGate(g);
  }

  const redirect = useCallback((hasSession: boolean) => {
    const inAuth = segments[0] === '(auth)';
    if (!hasSession && !inAuth) router.replace('/(auth)');
    else if (hasSession && inAuth) router.replace('/(app)');
  }, [segments, router]);

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && !__DEV__) {
        const [hw, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        if (hw && enrolled) {
          updateGate('locked');
          tryBiometric();
          return;
        }
      }
      updateGate('open');
      redirect(!!session);
    }
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_ev, session) => {
      if (gateRef.current !== 'open') return;
      redirect(!!session);
    });
    return () => subscription.unsubscribe();
  }, [redirect]);

  async function tryBiometric() {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Titan Golf',
      fallbackLabel: 'Use Passcode',
    });
    if (result.success) {
      updateGate('open');
      router.replace('/(app)');
    }
  }

  async function signOutAndUnlock() {
    await supabase.auth.signOut();
    updateGate('open');
    router.replace('/(auth)');
  }

  if (gate !== 'open') {
    return (
      <View style={ls.container}>
        <Image source={titanLogo} style={ls.logo} resizeMode="contain" />
        <Text style={ls.title}>TITAN GOLF</Text>
        {gate === 'locked' && (
          <>
            <TouchableOpacity style={ls.unlockBtn} onPress={tryBiometric} activeOpacity={0.85}>
              <Text style={ls.unlockText}>Unlock</Text>
            </TouchableOpacity>
            <TouchableOpacity style={ls.signOutBtn} onPress={signOutAndUnlock} activeOpacity={0.7}>
              <Text style={ls.signOutText}>Sign out</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Slot />
    </View>
  );
}

const ls = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', gap: spacing.md,
  },
  logo:       { width: 120, height: 120 },
  title:      { fontSize: fonts.xxl, fontWeight: '800', color: colors.white, letterSpacing: 4 },
  unlockBtn: {
    backgroundColor: colors.gold, borderRadius: radius.lg,
    paddingVertical: spacing.md, paddingHorizontal: spacing.xxl, marginTop: spacing.lg,
  },
  unlockText:  { fontSize: fonts.md, fontWeight: '800', color: colors.bg },
  signOutBtn:  { marginTop: spacing.sm },
  signOutText: { fontSize: fonts.sm, color: colors.textMuted },
});
