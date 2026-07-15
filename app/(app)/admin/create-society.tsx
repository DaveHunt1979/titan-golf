import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';

const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const RED    = '#f87171';
const PURPLE = '#a78bfa';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

const SWATCHES = [
  { label: 'Gold',    hex: '#D4AF37' },
  { label: 'Navy',    hex: '#1B3A5C' },
  { label: 'Forest',  hex: '#2D6A4F' },
  { label: 'Crimson', hex: '#9B2335' },
  { label: 'Purple',  hex: '#6B3FA0' },
  { label: 'Steel',   hex: '#4A5568' },
  { label: 'Teal',    hex: '#2B8A8A' },
  { label: 'Copper',  hex: '#C2611F' },
];

const PLANS = [
  {
    id: 'free' as const,
    label: 'Free',
    price: '£0 / mo',
    features: ['1 active competition', 'Up to 20 players', 'Scoring & leaderboard'],
  },
  {
    id: 'society' as const,
    label: 'Society',
    price: '£9 / mo',
    features: ['Unlimited competitions', 'Unlimited players', 'Info board & live feed'],
  },
  {
    id: 'club' as const,
    label: 'Club',
    price: '£29 / mo',
    features: ['Everything in Society', 'Multiple team groups', 'Analytics & exports'],
  },
];

function toSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

type PlanTier = 'free' | 'society' | 'club';

export default function CreateSocietyScreen() {
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [step, setStep]               = useState(0);
  const [societyName, setSocietyName] = useState('');
  const [adminName, setAdminName]     = useState('');
  const [primaryColor, setPrimaryColor] = useState('#D4AF37');
  const [plan, setPlan]               = useState<PlanTier>('society');
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState<{ pin: string; name: string } | null>(null);

  const slug          = toSlug(societyName);
  const canProceed0   = societyName.trim().length > 1 && adminName.trim().length > 1;
  const selectedSwatch = SWATCHES.find(s => s.hex === primaryColor);

  async function create() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); Alert.alert('Error', 'Not signed in.'); return; }
    const { data, error } = await supabase.rpc('create_society_with_owner', {
      p_name:          societyName.trim(),
      p_slug:          slug,
      p_primary_color: primaryColor,
      p_plan_tier:     plan,
      p_owner_name:    adminName.trim(),
      p_auth_uid:      user.id,
    });
    setLoading(false);
    if (error || !data?.[0]) {
      Alert.alert('Error', error?.message ?? 'Could not create society.');
      return;
    }
    setResult({ pin: data[0].join_pin, name: societyName.trim() });
    setStep(3);
  }

  if (!fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  // ── Step 0: Details ──────────────────────────────────────────
  if (step === 0) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <StatusBar style="light" />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={hit}>
            <Text style={styles.back}>✕ Close</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Image source={titanLogo} style={styles.logo} resizeMode="contain" />
            <Text style={styles.headerTitle}>NEW SOCIETY</Text>
            <Text style={styles.headerSub}>step 1 of 3</Text>
          </View>
          <View style={{ width: 70 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.stepTitle}>Name your Society</Text>
          <Text style={styles.stepSub}>This is what your members will see when they join.</Text>

          <Text style={styles.fieldLabel}>SOCIETY NAME</Text>
          <TextInput
            style={styles.input}
            value={societyName}
            onChangeText={setSocietyName}
            placeholder="e.g. Titan Golf Society"
            placeholderTextColor="#444"
            autoFocus
          />
          {societyName.length > 1 && (
            <Text style={styles.hint}>Identifier: {slug}</Text>
          )}

          <Text style={[styles.fieldLabel, { marginTop: 24 }]}>YOUR NAME</Text>
          <TextInput
            style={styles.input}
            value={adminName}
            onChangeText={setAdminName}
            placeholder="e.g. Rick Jones"
            placeholderTextColor="#444"
          />
          <Text style={styles.hint}>You'll be the society owner and admin.</Text>

          <TouchableOpacity
            style={[styles.btn, !canProceed0 && styles.btnDisabled]}
            onPress={() => setStep(1)}
            disabled={!canProceed0}
            activeOpacity={0.8}
          >
            <Text style={styles.btnText}>Next →</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Step 1: Branding ─────────────────────────────────────────
  if (step === 1) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setStep(0)} hitSlop={hit}>
            <Text style={styles.back}>‹ Back</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Image source={titanLogo} style={styles.logo} resizeMode="contain" />
            <Text style={styles.headerTitle}>NEW SOCIETY</Text>
            <Text style={styles.headerSub}>step 2 of 3</Text>
          </View>
          <View style={{ width: 70 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.stepTitle}>Society Colours</Text>
          <Text style={styles.stepSub}>Pick a primary colour for your society branding.</Text>

          <View style={[styles.previewBanner, { backgroundColor: primaryColor }]}>
            <Text style={styles.previewName}>{societyName}</Text>
          </View>

          <View style={styles.swatchGrid}>
            {SWATCHES.map(s => (
              <TouchableOpacity
                key={s.hex}
                style={[styles.swatch, { backgroundColor: s.hex }, primaryColor === s.hex && styles.swatchOn]}
                onPress={() => setPrimaryColor(s.hex)}
                activeOpacity={0.8}
              >
                {primaryColor === s.hex && <Text style={styles.swatchTick}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.swatchLabel}>{selectedSwatch?.label ?? ''}</Text>

          <TouchableOpacity style={styles.btn} onPress={() => setStep(2)} activeOpacity={0.8}>
            <Text style={styles.btnText}>Next →</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── Step 2: Plan ─────────────────────────────────────────────
  if (step === 2) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setStep(1)} hitSlop={hit}>
            <Text style={styles.back}>‹ Back</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Image source={titanLogo} style={styles.logo} resizeMode="contain" />
            <Text style={styles.headerTitle}>NEW SOCIETY</Text>
            <Text style={styles.headerSub}>step 3 of 3</Text>
          </View>
          <View style={{ width: 70 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.stepTitle}>Choose a Plan</Text>
          <Text style={styles.stepSub}>You can upgrade at any time.</Text>

          {PLANS.map(p => (
            <TouchableOpacity
              key={p.id}
              style={[styles.planCard, plan === p.id && { borderColor: primaryColor, borderWidth: 2 }]}
              onPress={() => setPlan(p.id)}
              activeOpacity={0.8}
            >
              <View style={styles.planTop}>
                <Text style={[styles.planName, plan === p.id && { color: primaryColor }]}>{p.label}</Text>
                <Text style={styles.planPrice}>{p.price}</Text>
              </View>
              {p.features.map(f => (
                <View key={f} style={styles.planFeatureRow}>
                  <Text style={[styles.planTick, plan === p.id && { color: primaryColor }]}>✓</Text>
                  <Text style={styles.planFeature}>{f}</Text>
                </View>
              ))}
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: primaryColor }, loading && styles.btnDisabled]}
            onPress={create}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color="#000" />
              : <Text style={styles.btnText}>Create Society</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── Step 3: Success ──────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={[styles.scroll, styles.successScroll]}>
        <View style={[styles.successBadge, { backgroundColor: primaryColor + '22', borderColor: primaryColor }]}>
          <Text style={{ fontSize: 48 }}>⛳</Text>
        </View>

        <Text style={styles.successTitle}>{result?.name}</Text>
        <Text style={styles.successSub}>
          Share the PIN below with your members. They'll enter it in the app to join your society.
        </Text>

        <View style={[styles.pinCard, { borderColor: primaryColor }]}>
          <Text style={styles.pinLabel}>JOIN PIN</Text>
          <Text style={[styles.pinNumber, { color: primaryColor }]}>
            {result?.pin.slice(0, 3)}{' '}{result?.pin.slice(3)}
          </Text>
          <Text style={styles.pinHint}>Members enter this PIN when they sign up</Text>
        </View>

        <TouchableOpacity
          style={[styles.btn, { backgroundColor: primaryColor }]}
          onPress={() => router.replace('/(app)/admin' as any)}
          activeOpacity={0.8}
        >
          <Text style={styles.btnText}>Go to Society Admin</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const hit = { top: 12, bottom: 12, left: 12, right: 12 };

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  back: { fontSize: 13, fontFamily: FFB, color: GOLD, width: 70 },
  headerCenter: { alignItems: 'center', gap: 2 },
  logo: { width: 28, height: 28, marginBottom: 2 },
  headerTitle: { fontSize: 12, fontFamily: FFB, color: '#fff', letterSpacing: 1.5 },
  headerSub: { fontSize: 9, fontFamily: FFB, color: '#fff' },

  scroll: { padding: 20, paddingBottom: 60 },
  stepTitle: { fontSize: 22, fontFamily: FFB, color: '#fff', marginBottom: 6 },
  stepSub: { fontSize: 13, fontFamily: FFB, color: '#fff', lineHeight: 20, marginBottom: 24 },

  fieldLabel: {
    fontSize: 11, fontFamily: FFB, color: '#fff',
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6,
  },
  input: {
    backgroundColor: '#111', borderRadius: 12,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, fontFamily: FFB, color: '#fff', marginBottom: 6,
  },
  hint: { fontSize: 11, fontFamily: FFB, color: '#fff', marginBottom: 16 },

  btn: {
    backgroundColor: GOLD, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 24,
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { fontSize: 15, fontFamily: FFB, color: '#000', letterSpacing: 0.5 },

  previewBanner: {
    borderRadius: 12, paddingVertical: 20,
    alignItems: 'center', marginBottom: 24,
  },
  previewName: { fontSize: 18, fontFamily: FFB, color: '#fff', letterSpacing: 0.5 },

  swatchGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 16,
    justifyContent: 'center', marginBottom: 10,
  },
  swatch: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'transparent',
  },
  swatchOn:   { borderColor: '#fff' },
  swatchTick: { fontSize: 24, color: '#fff', fontFamily: FFB },
  swatchLabel: { textAlign: 'center', fontSize: 13, fontFamily: FFB, color: '#fff', marginBottom: 20, minHeight: 20 },

  planCard: {
    backgroundColor: '#111', borderRadius: 12,
    borderWidth: 1, borderColor: '#1c1c1c',
    padding: 16, marginBottom: 12,
  },
  planTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  planName:  { fontSize: 17, fontFamily: FFB, color: '#fff' },
  planPrice: { fontSize: 13, fontFamily: FFB, color: '#fff' },
  planFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  planTick:    { fontSize: 13, fontFamily: FFB, color: '#fff', width: 18 },
  planFeature: { fontSize: 13, fontFamily: FFB, color: '#fff' },

  successScroll: { alignItems: 'center', paddingTop: 80 },
  successBadge: {
    width: 100, height: 100, borderRadius: 50, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  successTitle: { fontSize: 22, fontFamily: FFB, color: '#fff', marginBottom: 6, textAlign: 'center' },
  successSub: {
    fontSize: 13, fontFamily: FFB, color: '#fff', textAlign: 'center',
    lineHeight: 20, marginBottom: 24, paddingHorizontal: 20,
  },
  pinCard: {
    backgroundColor: '#111', borderRadius: 14, borderWidth: 2,
    padding: 24, alignItems: 'center', marginBottom: 24, width: '100%',
  },
  pinLabel:  { fontSize: 11, fontFamily: FFB, color: '#fff', letterSpacing: 3, marginBottom: 10 },
  pinNumber: { fontSize: 56, fontFamily: FFB, letterSpacing: 6, marginBottom: 6 },
  pinHint:   { fontSize: 11, fontFamily: FFB, color: '#fff' },
});
