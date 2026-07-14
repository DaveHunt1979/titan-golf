import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../src/lib/supabase';

const GOLD = '#D4AF37';
const FF   = 'JUSTSans';
const FFB  = 'JUSTSans-ExBold';
const titanLogo = require('../../assets/TitanAppLogo.png');

export default function SignInScreen() {
  const router = useRouter();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../assets/fonts/JUSTSans-ExBold.otf'),
  });
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#000' }}><StatusBar style="light" /></View>;

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
          <View style={s.divider} />
          <Text style={s.appName}>TITAN GOLF</Text>
          <Text style={s.tagline}>The society scoring platform</Text>
        </View>
        <View style={s.form}>
          <Text style={s.label}>EMAIL</Text>
          <TextInput
            style={s.input} value={email} onChangeText={setEmail}
            placeholder="your@email.com" placeholderTextColor="#444"
            keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
            returnKeyType="next"
          />
          <Text style={[s.label, { marginTop: 20 }]}>PASSWORD</Text>
          <TextInput
            style={s.input} value={password} onChangeText={setPassword}
            placeholder="••••••••" placeholderTextColor="#444"
            secureTextEntry returnKeyType="done" onSubmitEditing={signIn}
          />
          <TouchableOpacity
            style={[s.button, loading && s.buttonDisabled]}
            onPress={signIn} disabled={loading} activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color="#000" />
              : <Text style={s.buttonText}>Sign In</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#000' },
  back:           { position: 'absolute', top: 56, left: 24, zIndex: 10 },
  backText:       { fontSize: 14, color: GOLD, fontFamily: FF },
  inner:          { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  logoArea:       { alignItems: 'center', marginBottom: 40 },
  logo:           { width: 120, height: 36, marginBottom: 16 },
  divider:        { width: 60, height: 1, backgroundColor: GOLD, marginBottom: 20 },
  appName:        { fontSize: 28, fontFamily: FFB, color: '#fff', letterSpacing: 4 },
  tagline:        { fontSize: 13, fontFamily: FF, color: '#555', marginTop: 6, letterSpacing: 1 },
  form: {
    backgroundColor: '#111', borderRadius: 12,
    padding: 20, borderWidth: 1, borderColor: '#1c1c1c',
  },
  label: {
    fontSize: 10, fontFamily: FFB, color: '#555',
    letterSpacing: 1.5, marginBottom: 8,
  },
  input: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c',
    borderRadius: 12, paddingHorizontal: 16,
    paddingVertical: 14, fontSize: 16, fontFamily: FFB, color: '#fff',
  },
  button:         { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  buttonDisabled: { opacity: 0.6 },
  buttonText:     { fontSize: 16, fontFamily: FFB, color: '#000', letterSpacing: 1 },
});
