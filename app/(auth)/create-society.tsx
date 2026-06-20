import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../src/lib/theme';
import { titanLogo } from '../../src/lib/assets';

const SOCIETY_COLORS = [
  '#D4AF37', '#1e3a8a', '#166534', '#7c3aed',
  '#dc2626', '#0891b2', '#9a3412', '#374151',
];

const PLANS = [
  { id: 'free',    label: 'Free',    price: 'Free forever', sub: 'Up to 20 players · 1 active competition' },
  { id: 'society', label: 'Society', price: '£9.99/month',  sub: 'Unlimited players & competitions' },
  { id: 'club',    label: 'Club',    price: '£24.99/month', sub: 'Multi-admin · white label · priority support' },
];

export default function CreateSocietyScreen() {
  const router = useRouter();
  const [step, setStep]         = useState(0);
  const [creating, setCreating] = useState(false);
  const [done, setDone]         = useState(false);

  const [societyName, setSocietyName] = useState('');
  const [ownerName, setOwnerName]     = useState('');
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [color, setColor]             = useState(SOCIETY_COLORS[0]);
  const [plan, setPlan]               = useState('free');
  const [pin, setPin]                 = useState('');

  function slugify(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  function next() {
    if (step === 0) {
      if (!societyName.trim()) { Alert.alert('Required', 'Please enter a society name.'); return; }
      if (!ownerName.trim())   { Alert.alert('Required', 'Please enter your name.'); return; }
      setStep(1);
    } else if (step === 1) {
      if (!email.trim())        { Alert.alert('Required', 'Please enter your email.'); return; }
      if (password.length < 6)  { Alert.alert('Password too short', 'Minimum 6 characters.'); return; }
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    } else if (step === 3) {
      create();
    }
  }

  async function create() {
    setCreating(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
      });
      if (authError) throw authError;
      if (!authData.user) throw new Error('Could not create account — please try again.');

      const { data, error } = await supabase.rpc('create_society_with_owner', {
        p_name:          societyName.trim(),
        p_slug:          slugify(societyName.trim()),
        p_primary_color: color,
        p_plan_tier:     plan,
        p_owner_name:    ownerName.trim(),
        p_auth_uid:      authData.user.id,
      });
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      setPin(row.join_pin ?? '');
      setDone(true);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Something went wrong.');
    } finally {
      setCreating(false);
    }
  }

  if (creating) {
    return (
      <View style={[s.container, s.centered]}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.gold} size="large" />
        <Text style={s.creatingText}>Building your society…</Text>
      </View>
    );
  }

  if (done) {
    return (
      <View style={[s.container, s.centered]}>
        <StatusBar style="light" />
        <Image source={titanLogo} style={{ width: 100, height: 100, marginBottom: spacing.lg }} resizeMode="contain" />
        <Text style={s.successTitle}>{societyName}</Text>
        <Text style={s.successSub}>Your society is live!</Text>
        <View style={s.pinCard}>
          <Text style={s.pinLabel}>PLAYER JOIN PIN</Text>
          <Text style={s.pinNumber}>{pin.slice(0, 3)} {pin.slice(3)}</Text>
          <Text style={s.pinHint}>Share this with your players so they can join</Text>
        </View>
        <TouchableOpacity style={s.enterBtn} onPress={() => router.replace('/(app)' as any)} activeOpacity={0.85}>
          <Text style={s.enterBtnText}>Enter the App</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const STEPS = [
    { title: 'Your Society',    sub: "What's your society called?" },
    { title: 'Admin Account',   sub: 'Create your admin login' },
    { title: 'Society Branding',sub: 'Pick your society colour' },
    { title: 'Choose a Plan',   sub: 'You can change this any time' },
  ];

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity
          onPress={() => step === 0 ? router.back() : setStep(step - 1)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={s.dots}>
          {[0, 1, 2, 3].map(i => (
            <View key={i} style={[s.dot, i <= step && s.dotOn]} />
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={s.stepLabel}>STEP {step + 1} OF 4</Text>
        <Text style={s.stepTitle}>{STEPS[step].title}</Text>
        <Text style={s.stepSub}>{STEPS[step].sub}</Text>

        {step === 0 && (
          <View style={s.card}>
            <Field label="Society Name" value={societyName} onChange={setSocietyName}
              placeholder="e.g. Titan Golf Society" autoFocus />
            <Div />
            <Field label="Your Full Name" value={ownerName} onChange={setOwnerName}
              placeholder="Your name" />
            {societyName.trim() ? (
              <Text style={s.slugPreview}>slug: {slugify(societyName.trim())}</Text>
            ) : null}
          </View>
        )}

        {step === 1 && (
          <View style={s.card}>
            <Field label="Email Address" value={email} onChange={setEmail}
              placeholder="admin@example.com" keyboardType="email-address"
              autoCapitalize="none" autoFocus />
            <Div />
            <Field label="Password" value={password} onChange={setPassword}
              placeholder="Min. 6 characters" secure />
          </View>
        )}

        {step === 2 && (
          <View style={s.card}>
            <View style={s.colorGrid}>
              {SOCIETY_COLORS.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[s.swatch, { backgroundColor: c }, color === c && s.swatchOn]}
                  onPress={() => setColor(c)}
                  activeOpacity={0.8}
                />
              ))}
            </View>
            <View style={[s.colorPreview, { backgroundColor: color + '22', borderColor: color + '55' }]}>
              <View style={[s.colorDot, { backgroundColor: color }]} />
              <Text style={[s.colorName, { color }]}>{societyName || 'Your Society'}</Text>
            </View>
          </View>
        )}

        {step === 3 && (
          <View style={{ gap: spacing.sm }}>
            {PLANS.map(p => (
              <TouchableOpacity
                key={p.id}
                style={[s.planCard, plan === p.id && s.planOn]}
                onPress={() => setPlan(p.id)}
                activeOpacity={0.8}
              >
                <View style={s.planRow}>
                  <Text style={[s.planName, plan === p.id && { color: colors.gold }]}>{p.label}</Text>
                  <Text style={[s.planPrice, plan === p.id && { color: colors.gold }]}>{p.price}</Text>
                </View>
                <Text style={s.planSub}>{p.sub}</Text>
                {plan === p.id && (
                  <View style={s.planCheck}>
                    <Text style={{ color: colors.bg, fontSize: 10, fontWeight: '800' }}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        <TouchableOpacity style={s.nextBtn} onPress={next} activeOpacity={0.85}>
          <Text style={s.nextBtnText}>{step === 3 ? 'Create Society' : 'Next'}</Text>
        </TouchableOpacity>
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
  container:    { flex: 1, backgroundColor: colors.bg },
  centered:     { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
  },
  back:   { fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600' },
  dots:   { flexDirection: 'row', gap: 6 },
  dot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotOn:  { backgroundColor: colors.gold },
  scroll: { padding: spacing.lg, paddingBottom: 80 },

  stepLabel: { fontSize: fonts.xs, fontWeight: '800', color: colors.textMuted, letterSpacing: 2, textTransform: 'uppercase' },
  stepTitle: { fontSize: fonts.xxl, fontWeight: '800', color: colors.white, marginTop: spacing.xs, marginBottom: spacing.xs },
  stepSub:   { fontSize: fonts.sm, color: colors.textSecondary, marginBottom: spacing.lg },

  card: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: spacing.md,
  },
  fieldRow:   { paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  fieldLabel: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: 4 },
  fieldInput: { fontSize: fonts.md, color: colors.white },
  slugPreview: { fontSize: fonts.xs, color: colors.textMuted, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },

  colorGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm,
    justifyContent: 'center', padding: spacing.md,
  },
  swatch:   { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: colors.white, transform: [{ scale: 1.1 }] },
  colorPreview: {
    margin: spacing.md, marginTop: 0, borderRadius: radius.md,
    borderWidth: 1, padding: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
  },
  colorDot:  { width: 12, height: 12, borderRadius: 6 },
  colorName: { fontSize: fonts.md, fontWeight: '700' },

  planCard: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, position: 'relative',
  },
  planOn:    { borderColor: colors.goldBorder, backgroundColor: colors.goldDim },
  planRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  planName:  { fontSize: fonts.md, fontWeight: '800', color: colors.white },
  planPrice: { fontSize: fonts.sm, fontWeight: '700', color: colors.textSecondary },
  planSub:   { fontSize: fonts.xs, color: colors.textMuted },
  planCheck: {
    position: 'absolute', top: spacing.sm, right: spacing.sm,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center',
  },

  nextBtn: {
    backgroundColor: colors.gold, borderRadius: radius.md,
    paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.lg,
  },
  nextBtnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg },

  creatingText: { fontSize: fonts.md, color: colors.textSecondary, marginTop: spacing.lg },

  successTitle: { fontSize: fonts.xxl, fontWeight: '800', color: colors.white, textAlign: 'center' },
  successSub:   { fontSize: fonts.sm, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.xl },
  pinCard: {
    backgroundColor: colors.card, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.goldBorder,
    padding: spacing.xl, alignItems: 'center', marginHorizontal: spacing.xl,
  },
  pinLabel:  { fontSize: fonts.xs, fontWeight: '800', color: colors.textMuted, letterSpacing: 2 },
  pinNumber: { fontSize: 48, fontWeight: '800', color: colors.gold, letterSpacing: 8, marginVertical: spacing.md },
  pinHint:   { fontSize: fonts.xs, color: colors.textSecondary, textAlign: 'center' },
  enterBtn: {
    backgroundColor: colors.gold, borderRadius: radius.md,
    paddingVertical: spacing.md, paddingHorizontal: spacing.xxl, marginTop: spacing.xl,
  },
  enterBtnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg },
});
