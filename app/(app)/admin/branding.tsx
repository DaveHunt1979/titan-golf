import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Image, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { uploadImage } from '../../../src/lib/uploadImage';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';

const SWATCHES = [
  { label: 'Gold',     hex: '#D4AF37' },
  { label: 'Navy',     hex: '#1B3A5C' },
  { label: 'Forest',   hex: '#2D6A4F' },
  { label: 'Crimson',  hex: '#9B2335' },
  { label: 'Purple',   hex: '#6B3FA0' },
  { label: 'Steel',    hex: '#4A5568' },
  { label: 'Teal',     hex: '#2B8A8A' },
  { label: 'Copper',   hex: '#C2611F' },
  { label: 'Sky',      hex: '#0284C7' },
  { label: 'Rose',     hex: '#BE185D' },
  { label: 'Emerald',  hex: '#059669' },
  { label: 'Midnight', hex: '#312e81' },
];

export default function SocietyBrandingScreen() {
  const router = useRouter();
  const { societyId, loading: societyLoading } = useAdminSociety();

  const [name, setName]                       = useState('');
  const [tagline, setTagline]                 = useState('');
  const [primaryColor, setPrimaryColor]       = useState(colors.gold);
  const [secondaryColor, setSecondaryColor]   = useState('#1B3A5C');
  const [logoUrl, setLogoUrl]                 = useState<string | null>(null);
  const [logoLocalUri, setLogoLocalUri]       = useState<string | null>(null);
  const [loading, setLoading]                 = useState(true);
  const [saving, setSaving]                   = useState(false);

  useEffect(() => {
    if (societyLoading || !societyId) return;
    (async () => {
      const { data } = await supabase
        .from('societies')
        .select('name, tagline, primary_color, secondary_color, logo_url')
        .eq('id', societyId)
        .single();
      if (data) {
        setName((data as any).name ?? '');
        setTagline((data as any).tagline ?? '');
        setPrimaryColor((data as any).primary_color ?? colors.gold);
        setSecondaryColor((data as any).secondary_color ?? '#1B3A5C');
        setLogoUrl((data as any).logo_url ?? null);
      }
      setLoading(false);
    })();
  }, [societyId, societyLoading]);

  async function pickLogo() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (!result.canceled) {
      setLogoLocalUri(result.assets[0].uri);
    }
  }

  async function save() {
    if (!societyId) return;
    setSaving(true);
    try {
      let finalLogoUrl = logoUrl;

      if (logoLocalUri) {
        finalLogoUrl = await uploadImage(logoLocalUri, 'society-assets', `${societyId}/logo.jpg`);
      }

      const { error } = await supabase
        .from('societies')
        .update({
          name: name.trim() || undefined,
          tagline: tagline.trim() || null,
          primary_color: primaryColor,
          secondary_color: secondaryColor,
          logo_url: finalLogoUrl,
        } as any)
        .eq('id', societyId);

      if (error) throw error;
      if (finalLogoUrl !== logoUrl) setLogoUrl(finalLogoUrl);
      setLogoLocalUri(null);
      Alert.alert('Saved', 'Society branding updated.');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  const displayUri = logoLocalUri ?? logoUrl;

  if (loading || societyLoading) {
    return (
      <View style={[s.container, s.centered]}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={hit}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Society Branding</Text>
        <TouchableOpacity onPress={save} disabled={saving} hitSlop={hit}>
          <Text style={[s.saveBtn, saving && { opacity: 0.4 }]}>
            {saving ? 'Saving…' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {/* Logo */}
        <View style={s.logoSection}>
          <TouchableOpacity onPress={pickLogo} activeOpacity={0.8}>
            <View style={[s.logoCircle, { borderColor: primaryColor }]}>
              {displayUri
                ? <Image source={{ uri: displayUri }} style={s.logoImg} />
                : (
                  <View style={[s.logoPlaceholder, { backgroundColor: primaryColor + '22' }]}>
                    <Text style={s.logoPlaceholderIcon}>⛳</Text>
                  </View>
                )
              }
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={pickLogo} activeOpacity={0.7}>
            <Text style={[s.logoChangeText, { color: primaryColor }]}>
              {displayUri ? 'Change Logo' : 'Add Logo'}
            </Text>
          </TouchableOpacity>
          <Text style={s.logoHint}>Square image · PNG or JPEG · max 10 MB</Text>
        </View>

        {/* Name */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>SOCIETY NAME</Text>
          <View style={s.card}>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholderTextColor={colors.textMuted}
              placeholder="e.g. Titan Golf Society"
            />
          </View>
        </View>

        {/* Tagline */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>TAGLINE</Text>
          <View style={s.card}>
            <TextInput
              style={s.input}
              value={tagline}
              onChangeText={setTagline}
              placeholderTextColor={colors.textMuted}
              placeholder="e.g. Tour life. No excuses."
              maxLength={60}
            />
          </View>
          <Text style={s.hint}>Shown on the home screen · max 60 characters</Text>
        </View>

        {/* Primary Colour */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>PRIMARY COLOUR</Text>
          <ColorPicker selected={primaryColor} onSelect={setPrimaryColor} />
        </View>

        {/* Secondary Colour */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>SECONDARY COLOUR</Text>
          <ColorPicker selected={secondaryColor} onSelect={setSecondaryColor} />
        </View>

        {/* Live Preview */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>PREVIEW</Text>
          <View style={[s.previewCard, { borderColor: primaryColor + '55', backgroundColor: primaryColor + '0d' }]}>
            {displayUri
              ? <Image source={{ uri: displayUri }} style={s.previewLogo} />
              : <View style={[s.previewLogoDot, { backgroundColor: primaryColor }]} />
            }
            <View style={{ flex: 1 }}>
              <Text style={[s.previewName, { color: primaryColor }]}>{name || 'Society Name'}</Text>
              {tagline ? <Text style={s.previewTagline}>{tagline}</Text> : null}
            </View>
            <View style={[s.previewBadge, { backgroundColor: secondaryColor }]}>
              <Text style={s.previewBadgeText}>MEMBER</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={[s.saveButton, { backgroundColor: primaryColor }, saving && { opacity: 0.5 }]}
          onPress={save}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color={colors.bg} />
            : <Text style={s.saveButtonText}>Save Branding</Text>
          }
        </TouchableOpacity>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ColorPicker({ selected, onSelect }: { selected: string; onSelect: (hex: string) => void }) {
  const current = SWATCHES.find(sw => sw.hex === selected);
  return (
    <>
      <View style={cp.grid}>
        {SWATCHES.map(sw => (
          <TouchableOpacity
            key={sw.hex}
            style={[cp.swatch, { backgroundColor: sw.hex }, selected === sw.hex && cp.swatchOn]}
            onPress={() => onSelect(sw.hex)}
            activeOpacity={0.8}
          >
            {selected === sw.hex && <Text style={cp.tick}>✓</Text>}
          </TouchableOpacity>
        ))}
      </View>
      <Text style={cp.label}>{current?.label ?? ''}</Text>
    </>
  );
}

const hit = { top: 12, bottom: 12, left: 12, right: 12 };

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered:  { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back:        { fontSize: fonts.sm, color: colors.gold, fontWeight: '600' },
  headerTitle: { fontSize: fonts.md, fontWeight: '800', color: colors.white, letterSpacing: 0.5 },
  saveBtn:     { fontSize: fonts.sm, fontWeight: '700', color: colors.gold },
  scroll:      { padding: spacing.lg, paddingBottom: 60 },

  logoSection:          { alignItems: 'center', marginBottom: spacing.xl },
  logoCircle: {
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 3, overflow: 'hidden', marginBottom: spacing.sm,
  },
  logoImg:              { width: '100%', height: '100%' },
  logoPlaceholder:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoPlaceholderIcon:  { fontSize: 48 },
  logoChangeText:       { fontSize: fonts.sm, fontWeight: '700', marginBottom: spacing.xs },
  logoHint:             { fontSize: fonts.xs, color: colors.textMuted },

  section: { marginBottom: spacing.lg },
  sectionLabel: {
    fontSize: fonts.xs, fontWeight: '800', color: colors.textMuted,
    letterSpacing: 2, marginBottom: spacing.sm, textTransform: 'uppercase',
  },
  card: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  input: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    fontSize: fonts.md, color: colors.white,
  },
  hint: { fontSize: fonts.xs, color: colors.textMuted, marginTop: spacing.xs },

  previewCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderRadius: radius.md, borderWidth: 1, padding: spacing.md,
  },
  previewLogo:    { width: 36, height: 36, borderRadius: 18 },
  previewLogoDot: { width: 12, height: 12, borderRadius: 6 },
  previewName:    { fontSize: fonts.md, fontWeight: '800' },
  previewTagline: { fontSize: fonts.xs, color: colors.textSecondary, marginTop: 2 },
  previewBadge:   { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm },
  previewBadgeText: { fontSize: 9, fontWeight: '800', color: colors.white, letterSpacing: 1 },

  saveButton: {
    borderRadius: radius.md, paddingVertical: spacing.md,
    alignItems: 'center', marginTop: spacing.md,
  },
  saveButtonText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg, letterSpacing: 0.5 },
});

const cp = StyleSheet.create({
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm,
  },
  swatch: {
    width: 48, height: 48, borderRadius: 24,
    borderWidth: 2, borderColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  swatchOn: { borderColor: colors.white, transform: [{ scale: 1.12 }] },
  tick:     { color: colors.white, fontSize: 18, fontWeight: '800' },
  label:    { fontSize: fonts.xs, color: colors.textSecondary, marginTop: spacing.xs, minHeight: 16 },
});
