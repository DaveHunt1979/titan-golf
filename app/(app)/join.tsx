import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../src/lib/supabase';

const GOLD = '#D4AF37';
const FF   = 'JUSTSans';
const FFB  = 'JUSTSans-ExBold';
const titanLogo = require('../../assets/TitanAppLogo.png');

const AREA_META: Record<string, { icon: string; label: string; sub: string; color: string }> = {
  casual:  { icon: '🏌️', label: 'Casual Golf',  sub: 'Pick-up games with the boys',  color: '#4ade80' },
  tour:    { icon: '🏆', label: 'The Tour',      sub: 'Competitive team tournament',  color: '#D4AF37' },
  swindle: { icon: '💰', label: 'The Swindle',   sub: 'Weekly money competition',     color: '#a78bfa' },
};

type Step = 'code' | 'profile';

interface AreaInfo {
  societyId: string;
  societyName: string;
  primaryColor: string;
  areaType: string;
}

export default function JoinScreen() {
  const router = useRouter();
  const codeRef = useRef<TextInput>(null);

  const [fontsLoaded] = useFonts({
    [FF]:  require('../../assets/fonts/JUSTSans-Regular.otf'),
    [FFB]: require('../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [step, setStep]               = useState<Step>('code');
  const [code, setCode]               = useState('');
  const [looking, setLooking]         = useState(false);
  const [areaInfo, setAreaInfo]       = useState<AreaInfo | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [handicap, setHandicap]       = useState('');
  const [saving, setSaving]           = useState(false);

  // Pre-fill existing player profile if already signed in
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('players').select('display_name,handicap_index').eq('auth_uid', user.id).single();
      if (data) {
        setDisplayName((data as any).display_name ?? '');
        setHandicap((data as any).handicap_index != null ? String((data as any).handicap_index) : '');
      }
    })();
  }, []);

  // Auto-lookup when 6 chars entered
  useEffect(() => {
    if (code.length === 6) lookupCode(code);
    else setAreaInfo(null);
  }, [code]);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#000' }}><StatusBar style="light" /></View>;
  }

  async function lookupCode(c: string) {
    setLooking(true);
    const { data, error } = await supabase.rpc('lookup_by_area_code', { p_code: c.toUpperCase() });
    setLooking(false);
    if (error || !data?.[0]) {
      Alert.alert('Code not found', 'No area matches that code. Ask your admin for the correct code.', [
        { text: 'Try again', onPress: () => { setCode(''); codeRef.current?.focus(); } },
      ]);
      return;
    }
    const d = data[0];
    setAreaInfo({ societyId: d.society_id, societyName: d.society_name, primaryColor: d.primary_color, areaType: d.area_type });
  }

  async function joinArea() {
    if (!displayName.trim()) {
      Alert.alert('Name required', 'Please enter your display name.');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc('join_by_area_code', {
      p_code:         code.toUpperCase(),
      p_display_name: displayName.trim(),
      p_handicap:     handicap ? parseFloat(handicap) : null,
    });
    setSaving(false);
    if (error || !data?.[0]) {
      Alert.alert('Error', error?.message ?? 'Could not join. Please try again.');
      return;
    }
    router.replace('/(app)');
  }

  const area   = areaInfo ? AREA_META[areaInfo.areaType] : null;
  const accent = areaInfo?.primaryColor ?? GOLD;

  // ── Step: Code entry ──────────────────────────────────────────
  if (step === 'code') {
    return (
      <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={[s.scroll, s.codeScroll]} keyboardShouldPersistTaps="handled">

          {/* Titan logo */}
          <Image source={titanLogo} style={s.logoImg} resizeMode="contain" />

          <Text style={s.heading}>Join Titan Golf</Text>
          <Text style={s.sub}>Enter the 6-character code your admin sent you.</Text>

          {/* Code boxes */}
          <View style={{ position: 'relative', marginBottom: 24 }}>
            <View style={s.codeBoxes}>
              {Array.from({ length: 6 }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    s.codeBox,
                    code.length === i && s.codeBoxActive,
                    code[i] ? { borderColor: accent } : undefined,
                  ]}
                >
                  <Text style={[s.codeChar, code[i] ? { color: accent } : undefined]}>
                    {code[i] ?? ''}
                  </Text>
                </View>
              ))}
            </View>
            <TextInput
              ref={codeRef}
              style={s.codeOverlay}
              value={code}
              onChangeText={v => setCode(v.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase())}
              keyboardType="default"
              autoCapitalize="characters"
              maxLength={6}
              autoFocus
              caretHidden
            />
          </View>

          {looking && (
            <View style={s.lookingRow}>
              <ActivityIndicator color={GOLD} size="small" />
              <Text style={s.lookingText}>Checking code…</Text>
            </View>
          )}

          {areaInfo && area && !looking && (
            <>
              <View style={[s.areaCard, { borderColor: accent }]}>
                <Text style={s.areaIcon}>{area.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.areaFound}>{areaInfo.societyName}</Text>
                  <Text style={[s.areaName, { color: accent }]}>{area.label}</Text>
                  <Text style={s.areaSub}>{area.sub}</Text>
                </View>
              </View>

              <TouchableOpacity
                style={[s.btn, { backgroundColor: accent }]}
                onPress={() => setStep('profile')}
                activeOpacity={0.8}
              >
                <Text style={s.btnText}>Continue →</Text>
              </TouchableOpacity>
            </>
          )}

          {code.length > 0 && (
            <TouchableOpacity style={s.clearBtn} onPress={() => { setCode(''); setAreaInfo(null); }}>
              <Text style={s.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Step: Profile setup ───────────────────────────────────────
  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />

      {/* Header — three-column layout */}
      <View style={s.header}>
        <TouchableOpacity
          style={s.headerSide}
          onPress={() => setStep('code')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Your Profile</Text>
        <View style={s.headerSide} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {area && (
          <View style={[s.areaCard, { borderColor: accent, marginBottom: 28 }]}>
            <Text style={s.areaIcon}>{area.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.areaFound}>Joining</Text>
              <Text style={[s.areaName, { color: accent }]}>{area.label}</Text>
            </View>
          </View>
        )}

        <Text style={s.fieldLabel}>Your Name</Text>
        <TextInput
          style={s.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="e.g. John Smith"
          placeholderTextColor="#555"
          autoFocus
        />

        <Text style={[s.fieldLabel, { marginTop: 20 }]}>Handicap Index (optional)</Text>
        <TextInput
          style={s.input}
          value={handicap}
          onChangeText={setHandicap}
          placeholder="e.g. 14.2"
          placeholderTextColor="#555"
          keyboardType="decimal-pad"
        />
        <Text style={s.hint}>You can update this in your profile at any time.</Text>

        <TouchableOpacity
          style={[s.btn, { backgroundColor: accent }, saving && { opacity: 0.5 }]}
          onPress={joinArea}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color="#000" />
            : <Text style={s.btnText}>Complete Setup</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#000' },
  scroll:     { padding: 16, paddingBottom: 60 },
  codeScroll: { alignItems: 'center', paddingTop: 80 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1c',
  },
  headerSide:  { width: 60 },
  headerTitle: { fontFamily: FFB, fontSize: 16, color: '#fff', textAlign: 'center' },
  back:        { fontFamily: FFB, fontSize: 14, color: GOLD },

  // Logo & headings
  logoImg: { width: 120, height: 36, marginBottom: 20, resizeMode: 'contain' },
  heading: {
    fontFamily: FFB,
    fontSize: 28,
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  sub: {
    fontFamily: FFB,
    fontSize: 14,
    color: '#fff',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
    paddingHorizontal: 16,
  },

  // Code boxes
  codeBoxes: { flexDirection: 'row', gap: 8 },
  codeBox: {
    width: 44,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#111',
    borderWidth: 2,
    borderColor: '#1c1c1c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBoxActive: { borderColor: GOLD },
  codeChar:      { fontFamily: FFB, fontSize: 22, color: '#fff' },
  codeOverlay:   { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0 },

  // Looking row
  lookingRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  lookingText: { fontFamily: FF, fontSize: 14, color: '#555' },

  // Area card
  areaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 2,
    padding: 14,
    marginBottom: 12,
    width: '100%',
  },
  areaIcon:  { fontSize: 32 },
  areaFound: { fontFamily: FF, fontSize: 11, color: '#555' },
  areaName:  { fontFamily: FFB, fontSize: 17 },
  areaSub:   { fontFamily: FF, fontSize: 13, color: '#555', marginTop: 2 },

  // Button
  btn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
    width: '100%',
  },
  btnText: { fontFamily: FFB, fontSize: 16, color: '#000', letterSpacing: 0.5 },

  // Clear
  clearBtn:  { marginTop: 12 },
  clearText: { fontFamily: FF, fontSize: 13, color: '#555', textDecorationLine: 'underline' },

  // Profile fields
  fieldLabel: {
    fontFamily: FFB,
    fontSize: 11,
    color: '#555',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1c1c1c',
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: '#fff',
    fontFamily: FF,
  },
  hint: { fontFamily: FF, fontSize: 12, color: '#555', marginTop: 6 },
});
