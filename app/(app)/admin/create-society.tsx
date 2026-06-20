import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';

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
  const [step, setStep] = useState(0);

  const [societyName, setSocietyName] = useState('');
  const [adminName, setAdminName]     = useState('');
  const [primaryColor, setPrimaryColor] = useState('#D4AF37');
  const [plan, setPlan]               = useState<PlanTier>('society');
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState<{ pin: string; name: string } | null>(null);

  const slug         = toSlug(societyName);
  const canProceed0  = societyName.trim().length > 1 && adminName.trim().length > 1;
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
            <Text style={styles.back}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.stepPill}>1 of 3</Text>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.stepTitle}>Name your Society</Text>
          <Text style={styles.stepSub}>This is what your members will see when they join.</Text>

          <Text style={styles.fieldLabel}>Society Name</Text>
          <TextInput
            style={styles.input}
            value={societyName}
            onChangeText={setSocietyName}
            placeholder="e.g. Titan Golf Society"
            placeholderTextColor={colors.textMuted}
            autoFocus
          />
          {societyName.length > 1 && (
            <Text style={styles.hint}>Identifier: {slug}</Text>
          )}

          <Text style={[styles.fieldLabel, { marginTop: spacing.xl }]}>Your Name</Text>
          <TextInput
            style={styles.input}
            value={adminName}
            onChangeText={setAdminName}
            placeholder="e.g. Rick Jones"
            placeholderTextColor={colors.textMuted}
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
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.stepPill}>2 of 3</Text>
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
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.stepPill}>3 of 3</Text>
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
              ? <ActivityIndicator color={colors.bg} />
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
  container:   { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back:        { fontSize: fonts.sm, fontWeight: '600', color: colors.gold },
  stepPill: {
    fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted,
    letterSpacing: 1, textTransform: 'uppercase',
  },
  scroll:      { padding: spacing.lg, paddingBottom: 60 },
  stepTitle:   { fontSize: fonts.xxl, fontWeight: '800', color: colors.white, marginBottom: spacing.xs },
  stepSub:     { fontSize: fonts.sm, color: colors.textMuted, lineHeight: 20, marginBottom: spacing.xl },
  fieldLabel: {
    fontSize: fonts.xs, fontWeight: '800', color: colors.textMuted,
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    fontSize: fonts.md, color: colors.white, marginBottom: spacing.xs,
  },
  hint:        { fontSize: fonts.xs, color: colors.textMuted, marginBottom: spacing.md },
  btn: {
    backgroundColor: colors.gold, borderRadius: radius.md,
    paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xl,
  },
  btnDisabled: { opacity: 0.4 },
  btnText:     { fontSize: fonts.md, fontWeight: '800', color: colors.bg, letterSpacing: 0.5 },

  previewBanner: {
    borderRadius: radius.md, paddingVertical: spacing.lg,
    alignItems: 'center', marginBottom: spacing.xl,
  },
  previewName: { fontSize: fonts.xl, fontWeight: '800', color: colors.white, letterSpacing: 0.5 },

  swatchGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md,
    justifyContent: 'center', marginBottom: spacing.sm,
  },
  swatch: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'transparent',
  },
  swatchOn:    { borderColor: colors.white },
  swatchTick:  { fontSize: 24, color: colors.white, fontWeight: '800' },
  swatchLabel: { textAlign: 'center', fontSize: fonts.sm, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.lg, minHeight: 20 },

  planCard: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  planTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  planName:  { fontSize: fonts.lg, fontWeight: '800', color: colors.white },
  planPrice: { fontSize: fonts.sm, fontWeight: '600', color: colors.textMuted },
  planFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: 4 },
  planTick:    { fontSize: fonts.sm, color: colors.textMuted, width: 18 },
  planFeature: { fontSize: fonts.sm, color: colors.textSecondary },

  successScroll: { alignItems: 'center', paddingTop: 80 },
  successBadge: {
    width: 100, height: 100, borderRadius: 50, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg,
  },
  successTitle: { fontSize: fonts.xxl, fontWeight: '800', color: colors.white, marginBottom: spacing.xs, textAlign: 'center' },
  successSub: {
    fontSize: fonts.sm, color: colors.textMuted, textAlign: 'center',
    lineHeight: 20, marginBottom: spacing.xl, paddingHorizontal: spacing.lg,
  },
  pinCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 2,
    padding: spacing.xl, alignItems: 'center', marginBottom: spacing.xl, width: '100%',
  },
  pinLabel:  { fontSize: fonts.xs, fontWeight: '800', color: colors.textMuted, letterSpacing: 3, marginBottom: spacing.sm },
  pinNumber: { fontSize: 56, fontWeight: '900', letterSpacing: 6, marginBottom: spacing.xs },
  pinHint:   { fontSize: fonts.xs, color: colors.textMuted },
});
