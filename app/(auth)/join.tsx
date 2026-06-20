import { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../src/lib/theme';

interface Society {
  id: string;
  name: string;
  primary_color: string;
}

export default function JoinScreen() {
  const router   = useRouter();
  const inputRef = useRef<TextInput>(null);

  const [step, setStep]       = useState<'pin' | 'details' | 'creating'>('pin');
  const [pin, setPin]         = useState('');
  const [looking, setLooking] = useState(false);
  const [society, setSociety] = useState<Society | null>(null);

  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [handicap, setHandicap] = useState('');

  async function onPinChange(text: string) {
    const digits = text.replace(/\D/g, '').slice(0, 6);
    setPin(digits);
    if (digits.length === 6) {
      setLooking(true);
      const { data, error } = await supabase.rpc('lookup_society_by_pin', { p_pin: digits });
      setLooking(false);
      if (error || !data || (Array.isArray(data) && data.length === 0)) {
        Alert.alert('Invalid PIN', 'No society found. Please check and try again.');
        setPin('');
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      setSociety({ id: row.id, name: row.name, primary_color: row.primary_color });
      setStep('details');
    }
  }

  async function join() {
    if (!name.trim())       { Alert.alert('Required', 'Please enter your name.'); return; }
    if (!email.trim())      { Alert.alert('Required', 'Please enter your email.'); return; }
    if (password.length < 6){ Alert.alert('Password too short', 'Minimum 6 characters.'); return; }

    setStep('creating');
    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
      });
      if (authError) throw authError;
      if (!authData.user) throw new Error('Could not create account — please try again.');

      const { error } = await supabase.rpc('join_society_by_pin', {
        p_pin:          pin,
        p_display_name: name.trim(),
        p_handicap:     handicap ? parseFloat(handicap) : null,
        p_auth_uid:     authData.user.id,
        p_email:        email.trim().toLowerCase(),
      });
      if (error) throw error;

      router.replace('/(app)' as any);
    } catch (e: any) {
      setStep('details');
      Alert.alert('Error', e.message ?? 'Something went wrong.');
    }
  }

  if (step === 'creating') {
    return (
      <View style={[s.container, s.centered]}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.gold} size="large" />
        <Text style={s.creatingText}>Joining society…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity
          onPress={() => step === 'pin' ? router.back() : setStep('pin')}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>{step === 'pin' ? 'Join a Society' : 'Your Details'}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {step === 'pin' && (
          <>
            <Text style={s.subtitle}>Enter the 6-digit PIN your society admin gave you</Text>
            <TouchableOpacity
              style={s.pinArea}
              onPress={() => inputRef.current?.focus()}
              activeOpacity={1}
            >
              <View style={s.pinBoxes}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      s.pinBox,
                      pin.length === i && s.pinBoxActive,
                      pin.length > i  && s.pinBoxFilled,
                    ]}
                  >
                    <Text style={s.pinDigit}>{pin[i] ?? ''}</Text>
                  </View>
                ))}
              </View>
              <TextInput
                ref={inputRef}
                value={pin}
                onChangeText={onPinChange}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
                style={s.hiddenInput}
              />
            </TouchableOpacity>
            {looking && <ActivityIndicator color={colors.gold} style={{ marginTop: spacing.lg }} />}
          </>
        )}

        {step === 'details' && society && (
          <>
            <View style={[s.societyCard, { borderColor: society.primary_color + '66' }]}>
              <View style={[s.societyDot, { backgroundColor: society.primary_color }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.societyName}>{society.name}</Text>
                <Text style={s.societyCaption}>You're joining this society</Text>
              </View>
            </View>

            <Text style={s.sectionLabel}>CREATE YOUR ACCOUNT</Text>
            <View style={s.card}>
              <Field label="Your Name" value={name} onChange={setName} placeholder="Full name" autoFocus />
              <Div />
              <Field label="Email" value={email} onChange={setEmail}
                placeholder="your@email.com" keyboardType="email-address" autoCapitalize="none" />
              <Div />
              <Field label="Password" value={password} onChange={setPassword}
                placeholder="Min. 6 characters" secure />
              <Div />
              <Field label="Handicap Index" value={handicap} onChange={setHandicap}
                placeholder="e.g. 14.2  (optional)" keyboardType="decimal-pad" />
            </View>

            <TouchableOpacity style={s.joinBtn} onPress={join} activeOpacity={0.85}>
              <Text style={s.joinBtnText}>Join Society</Text>
            </TouchableOpacity>
          </>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, value, onChange, placeholder, keyboardType, autoCapitalize, autoFocus, secure }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; keyboardType?: any; autoCapitalize?: any;
  autoFocus?: boolean; secure?: boolean;
}) {
  return (
    <View style={s.fieldRow}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={s.fieldInput} value={value} onChangeText={onChange}
        placeholder={placeholder} placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType} autoCapitalize={autoCapitalize ?? 'words'}
        autoFocus={autoFocus} secureTextEntry={secure}
      />
    </View>
  );
}

function Div() {
  return <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: spacing.md }} />;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered:  { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
  },
  back:  { fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600' },
  title: { fontSize: fonts.lg, fontWeight: '800', color: colors.white },

  scroll:   { padding: spacing.lg, paddingBottom: 80 },
  subtitle: { fontSize: fonts.sm, color: colors.textSecondary, marginBottom: spacing.xl, textAlign: 'center' },

  pinArea:  { alignItems: 'center', position: 'relative' },
  pinBoxes: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  pinBox: {
    width: 44, height: 56, borderRadius: radius.md,
    backgroundColor: colors.card, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  pinBoxActive: { borderColor: colors.gold },
  pinBoxFilled: { borderColor: colors.goldBorder, backgroundColor: colors.goldDim },
  pinDigit:     { fontSize: fonts.xl, fontWeight: '800', color: colors.white },
  hiddenInput:  { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0 },

  societyCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, padding: spacing.md, marginBottom: spacing.lg,
  },
  societyDot:     { width: 14, height: 14, borderRadius: 7 },
  societyName:    { fontSize: fonts.md, fontWeight: '800', color: colors.white },
  societyCaption: { fontSize: fonts.xs, color: colors.textMuted, marginTop: 2 },

  sectionLabel: {
    fontSize: fonts.xs, fontWeight: '800', color: colors.textMuted,
    letterSpacing: 2, marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: spacing.md,
  },
  fieldRow:   { paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  fieldLabel: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: 4 },
  fieldInput: { fontSize: fonts.md, color: colors.white },

  joinBtn:     { backgroundColor: colors.gold, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  joinBtnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg },

  creatingText: { fontSize: fonts.md, color: colors.textSecondary, marginTop: spacing.lg },
});
