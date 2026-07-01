import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../src/lib/theme';
import { titanLogo } from '../../src/lib/assets';

export default function SignInScreen() {
  const router = useRouter();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);

  async function signIn() {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Required', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setLoading(false);
    if (error) Alert.alert('Sign in failed', error.message);
    // Root layout handles redirect via onAuthStateChange
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar style="light" />
      <TouchableOpacity style={s.back} onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={s.backText}>← Back</Text>
      </TouchableOpacity>
      <View style={s.inner}>
        <View style={s.logoArea}>
          <Image source={titanLogo} style={s.logo} resizeMode="contain" />
          <Text style={s.appName}>TITAN GOLF</Text>
          <Text style={s.tagline}>The society scoring platform</Text>
        </View>
        <View style={s.form}>
          <Text style={s.label}>Email</Text>
          <TextInput
            style={s.input} value={email} onChangeText={setEmail}
            placeholder="your@email.com" placeholderTextColor={colors.textMuted}
            keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
            returnKeyType="next"
          />
          <Text style={[s.label, { marginTop: spacing.md }]}>Password</Text>
          <TextInput
            style={s.input} value={password} onChangeText={setPassword}
            placeholder="••••••••" placeholderTextColor={colors.textMuted}
            secureTextEntry returnKeyType="done" onSubmitEditing={signIn}
          />
          <TouchableOpacity
            style={[s.button, loading && s.buttonDisabled]}
            onPress={signIn} disabled={loading} activeOpacity={0.8}
          >
            {loading ? <ActivityIndicator color={colors.bg} /> : <Text style={s.buttonText}>Sign In</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  back:      { position: 'absolute', top: 56, left: spacing.xl, zIndex: 10 },
  backText:  { fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600' },
  inner:     { flex: 1, paddingHorizontal: spacing.xl, justifyContent: 'center' },
  logoArea:  { alignItems: 'center', marginBottom: spacing.xxl },
  logo:      { width: 120, height: 120, marginBottom: spacing.md },
  appName:   { fontSize: fonts.xxl, fontWeight: '800', color: colors.white, letterSpacing: 4 },
  tagline:   { fontSize: fonts.sm, color: colors.textSecondary, marginTop: spacing.xs, letterSpacing: 1 },
  form: {
    backgroundColor: colors.card, borderRadius: radius.lg,
    padding: spacing.lg, borderWidth: 1, borderColor: colors.border,
  },
  label:          { fontSize: fonts.sm, color: colors.textSecondary, marginBottom: spacing.xs, letterSpacing: 0.5 },
  input: {
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4, fontSize: fonts.md, color: colors.white,
  },
  button:         { backgroundColor: colors.gold, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.lg },
  buttonDisabled: { opacity: 0.6 },
  buttonText:     { fontSize: fonts.md, fontWeight: '700', color: colors.bg, letterSpacing: 1 },
});
