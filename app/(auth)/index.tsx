import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { titanLogo } from '../../src/lib/assets';
import { colors, fonts, spacing, radius } from '../../src/lib/theme';

export default function LandingScreen() {
  const router = useRouter();

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      <View style={s.hero}>
        <Image source={titanLogo} style={s.logo} resizeMode="contain" />
        <Text style={s.appName}>TITAN GOLF</Text>
        <Text style={s.tagline}>The society scoring platform</Text>
      </View>

      <View style={s.actions}>
        <TouchableOpacity
          style={s.primary}
          onPress={() => router.push('/(auth)/create-society' as any)}
          activeOpacity={0.85}
        >
          <Text style={s.primaryText}>Create a Society</Text>
          <Text style={s.primarySub}>Set up your society and invite players</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.secondary}
          onPress={() => router.push('/(auth)/join' as any)}
          activeOpacity={0.85}
        >
          <Text style={s.secondaryText}>Join a Society</Text>
          <Text style={s.secondarySub}>Enter your society PIN to get started</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.link}
          onPress={() => router.push('/(auth)/sign-in' as any)}
          activeOpacity={0.7}
        >
          <Text style={s.linkText}>
            Already have an account?{'  '}
            <Text style={{ color: colors.gold }}>Sign in</Text>
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={s.footer}>Titan Golf · v1.0</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.xl },

  hero:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  logo:    { width: 180, height: 180 },
  appName: { fontSize: fonts.xxl, fontWeight: '800', color: colors.white, letterSpacing: 4 },
  tagline: { fontSize: fonts.sm, color: colors.textSecondary, letterSpacing: 1 },

  actions: { paddingBottom: spacing.xxl, gap: spacing.md },

  primary: {
    backgroundColor: colors.gold, borderRadius: radius.lg,
    paddingVertical: spacing.md + 4, alignItems: 'center',
  },
  primaryText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg },
  primarySub:  { fontSize: fonts.xs, color: colors.bg, opacity: 0.65, marginTop: 2 },

  secondary: {
    backgroundColor: colors.card, borderRadius: radius.lg,
    paddingVertical: spacing.md + 4, alignItems: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  secondaryText: { fontSize: fonts.md, fontWeight: '800', color: colors.white },
  secondarySub:  { fontSize: fonts.xs, color: colors.textMuted, marginTop: 2 },

  link:     { alignItems: 'center', paddingVertical: spacing.sm },
  linkText: { fontSize: fonts.sm, color: colors.textSecondary },

  footer: { textAlign: 'center', fontSize: fonts.xs, color: colors.textMuted, paddingBottom: spacing.md },
});
