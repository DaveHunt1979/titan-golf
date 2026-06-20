import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../src/lib/theme';

type Step = 'pin' | 'role' | 'profile';
type Role = 'member' | 'spectator';

interface SocietyInfo {
  id: string;
  name: string;
  primary_color: string;
}

export default function JoinScreen() {
  const router = useRouter();
  const pinRef = useRef<TextInput>(null);

  const [step, setStep]           = useState<Step>('pin');
  const [pin, setPin]             = useState('');
  const [looking, setLooking]     = useState(false);
  const [society, setSociety]     = useState<SocietyInfo | null>(null);
  const [role, setRole]           = useState<Role>('member');
  const [displayName, setDisplayName] = useState('');
  const [handicap, setHandicap]   = useState('');
  const [saving, setSaving]       = useState(false);

  // Auto-lookup when 6 digits entered
  useEffect(() => {
    if (pin.length === 6) {
      lookupPin(pin);
    } else {
      setSociety(null);
    }
  }, [pin]);

  async function lookupPin(p: string) {
    setLooking(true);
    const { data, error } = await supabase.rpc('lookup_society_by_pin', { p_pin: p });
    setLooking(false);
    if (error || !data?.[0]) {
      Alert.alert('PIN not found', 'No society matches that PIN. Ask your society admin for the correct code.', [
        { text: 'Try again', onPress: () => { setPin(''); pinRef.current?.focus(); } },
      ]);
      return;
    }
    setSociety({ id: data[0].id, name: data[0].name, primary_color: data[0].primary_color });
  }

  async function joinSociety() {
    if (!displayName.trim()) {
      Alert.alert('Name required', 'Please enter your display name.');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc('join_society_by_pin', {
      p_pin:          pin,
      p_display_name: displayName.trim(),
      p_handicap:     role === 'member' && handicap ? parseFloat(handicap) : null,
      p_role:         role,
    });
    setSaving(false);
    if (error || !data?.[0]) {
      Alert.alert('Error', error?.message ?? 'Could not join society. Please try again.');
      return;
    }
    router.replace('/(app)');
  }

  const accentColor = society?.primary_color ?? colors.gold;

  // ── Step: PIN entry ──────────────────────────────────────────
  if (step === 'pin') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <StatusBar style="light" />

        <ScrollView contentContainerStyle={[styles.scroll, styles.pinScroll]} keyboardShouldPersistTaps="handled">
          <View style={styles.logoArea}>
            <Text style={styles.logoText}>⛳</Text>
          </View>

          <Text style={styles.heading}>Join your Society</Text>
          <Text style={styles.sub}>
            Enter the 6-digit PIN your society admin shared with you.
          </Text>

          {/* PIN display boxes with invisible TextInput overlay */}
          <View style={{ position: 'relative', marginBottom: spacing.lg }}>
            <View style={styles.pinBoxes}>
              {Array.from({ length: 6 }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.pinBox,
                    pin.length === i && styles.pinBoxActive,
                    pin[i] && { borderColor: accentColor },
                  ]}
                >
                  <Text style={[styles.pinChar, pin[i] && { color: accentColor }]}>
                    {pin[i] ?? ''}
                  </Text>
                </View>
              ))}
            </View>
            <TextInput
              ref={pinRef}
              style={styles.pinOverlayInput}
              value={pin}
              onChangeText={v => setPin(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              caretHidden
            />
          </View>

          {looking && (
            <View style={styles.lookingRow}>
              <ActivityIndicator color={colors.gold} size="small" />
              <Text style={styles.lookingText}>Looking up PIN…</Text>
            </View>
          )}

          {society && !looking && (
            <>
              <View style={[styles.societyCard, { borderColor: accentColor }]}>
                <View style={[styles.societyDot, { backgroundColor: accentColor }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.societyFound}>Society found</Text>
                  <Text style={[styles.societyName, { color: accentColor }]}>{society.name}</Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.btn, { backgroundColor: accentColor }]}
                onPress={() => setStep('role')}
                activeOpacity={0.8}
              >
                <Text style={styles.btnText}>Join {society.name} →</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity
            style={styles.clearBtn}
            onPress={() => { setPin(''); setSociety(null); pinRef.current?.focus(); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.clearText}>{pin.length > 0 ? 'Clear' : ' '}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Step: Role selection ─────────────────────────────────────
  if (step === 'role') {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />

        <View style={styles.header}>
          <TouchableOpacity onPress={() => setStep('pin')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>How are you joining?</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: spacing.xl }]}>
          <View style={[styles.societyCard, { borderColor: accentColor, marginBottom: spacing.xl }]}>
            <View style={[styles.societyDot, { backgroundColor: accentColor }]} />
            <Text style={[styles.societyName, { color: accentColor }]}>{society?.name}</Text>
          </View>

          <TouchableOpacity
            style={[styles.roleCard, role === 'member' && { borderColor: accentColor, backgroundColor: 'rgba(255,255,255,0.04)' }]}
            onPress={() => setRole('member')}
            activeOpacity={0.8}
          >
            <View style={styles.roleIconWrap}>
              <Text style={styles.roleIcon}>🏌️</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.roleTitle}>Playing</Text>
              <Text style={styles.roleSub}>I'm competing in the tour</Text>
            </View>
            {role === 'member' && <View style={[styles.roleTick, { backgroundColor: accentColor }]}><Text style={styles.roleTickText}>✓</Text></View>}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.roleCard, role === 'spectator' && { borderColor: accentColor, backgroundColor: 'rgba(255,255,255,0.04)' }]}
            onPress={() => setRole('spectator')}
            activeOpacity={0.8}
          >
            <View style={styles.roleIconWrap}>
              <Text style={styles.roleIcon}>👀</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.roleTitle}>Watching</Text>
              <Text style={styles.roleSub}>I'm spectating — following the action</Text>
            </View>
            {role === 'spectator' && <View style={[styles.roleTick, { backgroundColor: accentColor }]}><Text style={styles.roleTickText}>✓</Text></View>}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: accentColor, marginTop: spacing.xl }]}
            onPress={() => setStep('profile')}
            activeOpacity={0.8}
          >
            <Text style={styles.btnText}>Continue →</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── Step: Profile setup ──────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => setStep('role')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Your Profile</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.societyCard, { borderColor: accentColor, marginBottom: spacing.xl }]}>
          <View style={[styles.societyDot, { backgroundColor: accentColor }]} />
          <View>
            <Text style={styles.societyFound}>Joining as {role === 'spectator' ? 'Spectator' : 'Player'}</Text>
            <Text style={[styles.societyName, { color: accentColor }]}>{society?.name}</Text>
          </View>
        </View>

        <Text style={styles.fieldLabel}>Your Name</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="e.g. John Smith"
          placeholderTextColor={colors.textMuted}
          autoFocus
        />

        {role === 'member' && (
          <>
            <Text style={[styles.fieldLabel, { marginTop: spacing.lg }]}>Handicap Index (optional)</Text>
            <TextInput
              style={styles.input}
              value={handicap}
              onChangeText={setHandicap}
              placeholder="e.g. 14.2"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
            />
            <Text style={styles.hint}>You can update this in your profile at any time.</Text>
          </>
        )}

        <TouchableOpacity
          style={[styles.btn, { backgroundColor: accentColor }, saving && { opacity: 0.5 }]}
          onPress={joinSociety}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color={colors.bg} />
            : <Text style={styles.btnText}>Complete Setup</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll:    { padding: spacing.lg, paddingBottom: 60 },
  pinScroll: { alignItems: 'center', paddingTop: 80 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back:        { fontSize: fonts.sm, fontWeight: '600', color: colors.gold },
  headerTitle: { fontSize: fonts.md, fontWeight: '800', color: colors.white },

  logoArea:  { marginBottom: spacing.xl },
  logoText:  { fontSize: 64 },
  heading:   { fontSize: fonts.xxl, fontWeight: '800', color: colors.white, marginBottom: spacing.xs, textAlign: 'center' },
  sub: {
    fontSize: fonts.sm, color: colors.textMuted, textAlign: 'center',
    lineHeight: 20, marginBottom: spacing.xl, paddingHorizontal: spacing.md,
  },

  pinBoxes:  { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  pinBox: {
    width: 44, height: 56, borderRadius: radius.sm,
    backgroundColor: colors.card, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  pinBoxActive: { borderColor: colors.gold },
  pinChar:      { fontSize: fonts.xxl, fontWeight: '800', color: colors.white },
  pinOverlayInput: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    opacity: 0,
  },

  lookingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  lookingText: { fontSize: fonts.sm, color: colors.textMuted },

  societyCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 2,
    padding: spacing.md, marginBottom: spacing.md, width: '100%',
  },
  societyDot:   { width: 12, height: 12, borderRadius: 6 },
  societyFound: { fontSize: fonts.xs, color: colors.textMuted, fontWeight: '600' },
  societyName:  { fontSize: fonts.lg, fontWeight: '800' },

  btn: {
    backgroundColor: colors.gold, borderRadius: radius.md,
    paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.lg, width: '100%',
  },
  btnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg, letterSpacing: 0.5 },

  clearBtn:  { marginTop: spacing.md },
  clearText: { fontSize: fonts.sm, color: colors.textMuted, textDecorationLine: 'underline' },

  roleCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 2,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md,
  },
  roleIconWrap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  roleIcon:  { fontSize: 28 },
  roleTitle: { fontSize: fonts.lg, fontWeight: '800', color: colors.white, marginBottom: 2 },
  roleSub:   { fontSize: fonts.sm, color: colors.textMuted },
  roleTick:  { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  roleTickText: { fontSize: 13, fontWeight: '800', color: colors.bg },

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
