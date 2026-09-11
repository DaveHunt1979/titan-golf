import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../../src/lib/supabase';
import { uploadImage } from '../../../src/lib/uploadImage';
import { goBack } from '../../../src/lib/navigation';

const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const RED    = '#f87171';
const PURPLE = '#a78bfa';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

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
  const [plan, setPlan]               = useState<PlanTier>('society');
  const [logoUri, setLogoUri]         = useState<string | null>(null);
  const [heroUri, setHeroUri]         = useState<string | null>(null);
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState<{ pin: string; name: string } | null>(null);

  const slug        = toSlug(societyName);
  const canProceed0 = societyName.trim().length > 1 && adminName.trim().length > 1;

  async function pickImage(target: 'logo' | 'hero') {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: true,
      aspect: target === 'logo' ? [1, 1] : [16, 9],
      quality: 0.85,
    });
    if (result.canceled) return;
    if (target === 'logo') setLogoUri(result.assets[0].uri);
    else setHeroUri(result.assets[0].uri);
  }

  async function create() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); Alert.alert('Error', 'Not signed in.'); return; }
    const { data, error } = await supabase.rpc('create_society_with_owner', {
      p_name:          societyName.trim(),
      p_slug:          slug,
      p_primary_color: GOLD,
      p_plan_tier:     plan,
      p_owner_name:    adminName.trim(),
      p_auth_uid:      user.id,
    });
    if (error || !data?.[0]) {
      setLoading(false);
      Alert.alert('Error', error?.message ?? 'Could not create society.');
      return;
    }
    const newSocietyId = data[0].out_society_id;

    if (logoUri || heroUri) {
      try {
        const updates: Record<string, string> = {};
        if (logoUri) updates.logo_url = await uploadImage(logoUri, 'society-assets', `${newSocietyId}/logo.jpg`);
        if (heroUri) updates.hero_url = await uploadImage(heroUri, 'society-assets', `${newSocietyId}/hero.jpg`);
        await supabase.from('societies').update(updates as any).eq('id', newSocietyId);
      } catch (e: any) {
        // Society already exists at this point — a failed image upload
        // shouldn't block finishing setup, just means no image for now
        // (can still be added later via Admin → Branding).
        Alert.alert('Image upload failed', `${e.message ?? 'Could not upload your image(s)'} — you can add them later from Admin → Branding.`);
      }
    }

    setLoading(false);
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
          <TouchableOpacity onPress={() => goBack(router, '/(app)/admin/hub-platform')} hitSlop={hit}>
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
          <Text style={styles.stepTitle}>Society Branding</Text>
          <Text style={styles.stepSub}>Add your society logo and hero photo.</Text>

          <Text style={styles.fieldLabel}>LOGO &amp; HERO IMAGE</Text>
          <Text style={styles.hint}>Optional — you can always add or change these later in Admin → Branding.</Text>

          <View style={styles.imageRow}>
            <TouchableOpacity style={styles.imagePickerSquare} onPress={() => pickImage('logo')} activeOpacity={0.8}>
              {logoUri
                ? <Image source={{ uri: logoUri }} style={styles.imagePickerSquareImg} resizeMode="cover" />
                : <Text style={styles.imagePickerLabel}>+ Logo</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity style={styles.imagePickerWide} onPress={() => pickImage('hero')} activeOpacity={0.8}>
              {heroUri
                ? <Image source={{ uri: heroUri }} style={styles.imagePickerWideImg} resizeMode="cover" />
                : <Text style={styles.imagePickerLabel}>+ Hero Photo</Text>
              }
            </TouchableOpacity>
          </View>

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
              style={[styles.planCard, plan === p.id && { borderColor: GOLD, borderWidth: 2 }]}
              onPress={() => setPlan(p.id)}
              activeOpacity={0.8}
            >
              <View style={styles.planTop}>
                <Text style={[styles.planName, plan === p.id && { color: GOLD }]}>{p.label}</Text>
                <Text style={styles.planPrice}>{p.price}</Text>
              </View>
              {p.features.map(f => (
                <View key={f} style={styles.planFeatureRow}>
                  <Text style={[styles.planTick, plan === p.id && { color: GOLD }]}>✓</Text>
                  <Text style={styles.planFeature}>{f}</Text>
                </View>
              ))}
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: GOLD }, loading && styles.btnDisabled]}
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
        <View style={[styles.successBadge, { backgroundColor: GOLD + '22', borderColor: GOLD }]}>
          <Text style={{ fontSize: 48 }}>⛳</Text>
        </View>

        <Text style={styles.successTitle}>{result?.name}</Text>
        <Text style={styles.successSub}>
          Share the PIN below with your members. They'll enter it in the app to join your society.
        </Text>

        <View style={[styles.pinCard, { borderColor: GOLD }]}>
          <Text style={styles.pinLabel}>JOIN PIN</Text>
          <Text style={[styles.pinNumber, { color: GOLD }]}>
            {result?.pin.slice(0, 3)}{' '}{result?.pin.slice(3)}
          </Text>
          <Text style={styles.pinHint}>Members enter this PIN when they sign up</Text>
        </View>

        <TouchableOpacity
          style={[styles.btn, { backgroundColor: GOLD }]}
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
  back: { fontSize: 13, fontFamily: FFB, color: GOLD, minWidth: 70 },
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

  imageRow: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  imagePickerSquare: {
    width: 84, height: 84, borderRadius: 12,
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c',
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  imagePickerSquareImg: { width: '100%', height: '100%' },
  imagePickerWide: {
    flex: 1, height: 84, borderRadius: 12,
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c',
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  imagePickerWideImg: { width: '100%', height: '100%' },
  imagePickerLabel: { fontSize: 12, fontFamily: FFB, color: '#666' },

  btn: {
    backgroundColor: GOLD, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 24,
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { fontSize: 15, fontFamily: FFB, color: '#000', letterSpacing: 0.5 },

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
