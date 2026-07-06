import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../src/lib/theme';

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

  const area = areaInfo ? AREA_META[areaInfo.areaType] : null;
  const accent = areaInfo?.primaryColor ?? colors.gold;

  // ── Step: Code entry ──────────────────────────────────────────
  if (step === 'code') {
    return (
      <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={[s.scroll, s.codeScroll]} keyboardShouldPersistTaps="handled">

          <Text style={s.logoText}>⛳</Text>
          <Text style={s.heading}>Join Titan Golf</Text>
          <Text style={s.sub}>Enter the 6-character code your admin sent you.</Text>

          {/* Code boxes */}
          <View style={{ position: 'relative', marginBottom: spacing.lg }}>
            <View style={s.codeBoxes}>
              {Array.from({ length: 6 }).map((_, i) => (
                <View key={i} style={[s.codeBox, code.length === i && s.codeBoxActive, code[i] && { borderColor: accent }]}>
                  <Text style={[s.codeChar, code[i] && { color: accent }]}>{code[i] ?? ''}</Text>
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
              <ActivityIndicator color={colors.gold} size="small" />
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

              <TouchableOpacity style={[s.btn, { backgroundColor: accent }]} onPress={() => setStep('profile')} activeOpacity={0.8}>
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

      <View style={s.header}>
        <TouchableOpacity onPress={() => setStep('code')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Your Profile</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {area && (
          <View style={[s.areaCard, { borderColor: accent, marginBottom: spacing.xl }]}>
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
          placeholderTextColor={colors.textMuted}
          autoFocus
        />

        <Text style={[s.fieldLabel, { marginTop: spacing.lg }]}>Handicap Index (optional)</Text>
        <TextInput
          style={s.input}
          value={handicap}
          onChangeText={setHandicap}
          placeholder="e.g. 14.2"
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
        />
        <Text style={s.hint}>You can update this in your profile at any time.</Text>

        <TouchableOpacity
          style={[s.btn, { backgroundColor: accent }, saving && { opacity: 0.5 }]}
          onPress={joinArea}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving ? <ActivityIndicator color={colors.bg} /> : <Text style={s.btnText}>Complete Setup</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll:    { padding: spacing.lg, paddingBottom: 60 },
  codeScroll:{ alignItems: 'center', paddingTop: 80 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back:        { fontSize: fonts.sm, fontWeight: '600', color: colors.gold },
  headerTitle: { fontSize: fonts.md, fontWeight: '800', color: colors.white },

  logoText: { fontSize: 64, marginBottom: spacing.lg },
  heading:  { fontSize: fonts.xxl, fontWeight: '800', color: colors.white, marginBottom: spacing.xs, textAlign: 'center' },
  sub: {
    fontSize: fonts.sm, color: colors.textMuted, textAlign: 'center',
    lineHeight: 20, marginBottom: spacing.xl, paddingHorizontal: spacing.md,
  },

  codeBoxes: { flexDirection: 'row', gap: spacing.sm },
  codeBox: {
    width: 44, height: 56, borderRadius: radius.sm,
    backgroundColor: colors.card, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  codeBoxActive: { borderColor: colors.gold },
  codeChar:      { fontSize: fonts.xxl, fontWeight: '800', color: colors.white },
  codeOverlay:   { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0 },

  lookingRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  lookingText: { fontSize: fonts.sm, color: colors.textMuted },

  areaCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 2,
    padding: spacing.md, marginBottom: spacing.md, width: '100%',
  },
  areaIcon:  { fontSize: 32 },
  areaFound: { fontSize: fonts.xs, color: colors.textMuted, fontWeight: '600' },
  areaName:  { fontSize: fonts.lg, fontWeight: '800' },
  areaSub:   { fontSize: fonts.sm, color: colors.textMuted, marginTop: 2 },

  btn: {
    borderRadius: radius.md, paddingVertical: spacing.md,
    alignItems: 'center', marginTop: spacing.lg, width: '100%',
  },
  btnText:  { fontSize: fonts.md, fontWeight: '800', color: colors.bg, letterSpacing: 0.5 },
  clearBtn: { marginTop: spacing.md },
  clearText: { fontSize: fonts.sm, color: colors.textMuted, textDecorationLine: 'underline' },

  fieldLabel: {
    fontSize: fonts.xs, fontWeight: '800', color: colors.textMuted,
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    fontSize: fonts.md, color: colors.white,
  },
  hint: { fontSize: fonts.xs, color: colors.textMuted, marginTop: spacing.xs },
});
