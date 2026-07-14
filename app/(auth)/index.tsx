import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';

const GOLD = '#D4AF37';
const FF   = 'JUSTSans';
const FFB  = 'JUSTSans-ExBold';
const titanLogo = require('../../assets/TitanAppLogo.png');

export default function LandingScreen() {
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../assets/fonts/JUSTSans-ExBold.otf'),
  });
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#000' }}><StatusBar style="light" /></View>;

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      <View style={s.hero}>
        <Image source={titanLogo} style={s.logo} resizeMode="contain" />
        <View style={s.divider} />
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
            <Text style={{ color: GOLD, fontFamily: FF }}>Sign in</Text>
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={s.footer}>Titan Golf · v1.0</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 24 },

  hero:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  logo:    { width: 120, height: 36 },
  divider: { width: 60, height: 1, backgroundColor: GOLD },
  appName: { fontSize: 28, fontFamily: FFB, color: '#fff', letterSpacing: 4 },
  tagline: { fontSize: 13, fontFamily: FF, color: '#555', letterSpacing: 1 },

  actions: { paddingBottom: 40, gap: 12 },

  primary: {
    backgroundColor: GOLD, borderRadius: 12,
    paddingVertical: 18, alignItems: 'center',
  },
  primaryText: { fontSize: 16, fontFamily: FFB, color: '#000' },
  primarySub:  { fontSize: 12, fontFamily: FF, color: '#000', opacity: 0.65, marginTop: 2 },

  secondary: {
    backgroundColor: '#111', borderRadius: 12,
    paddingVertical: 18, alignItems: 'center',
    borderWidth: 1, borderColor: '#1c1c1c',
  },
  secondaryText: { fontSize: 16, fontFamily: FFB, color: '#fff' },
  secondarySub:  { fontSize: 12, fontFamily: FF, color: '#555', marginTop: 2 },

  link:     { alignItems: 'center', paddingVertical: 8 },
  linkText: { fontSize: 14, fontFamily: FF, color: '#555' },

  footer: { textAlign: 'center', fontSize: 12, fontFamily: FF, color: '#444', paddingBottom: 16 },
});
