import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Image, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { uploadImage } from '../../../src/lib/uploadImage';
import { fonts, spacing, radius } from '../../../src/lib/theme';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { derivePalette } from '../../../src/lib/SocietyThemeContext';
import { titanLogo } from '../../../src/lib/assets';

const BG_SWATCHES = [
  { label: 'Midnight',   hex: '#0A0A1A' },
  { label: 'Deep Navy',  hex: '#000035' },
  { label: 'Royal Navy', hex: '#001F5B' },
  { label: 'Navy',       hex: '#003087' },
  { label: 'Forest',     hex: '#0D3321' },
  { label: 'Dark Slate', hex: '#1A1A2E' },
  { label: 'Graphite',   hex: '#1C1C1E' },
  { label: 'Espresso',   hex: '#1A0A00' },
];

const ACCENT_SWATCHES = [
  { label: 'Gold',    hex: '#D4AF37' },
  { label: 'Silver',  hex: '#C4CEDB' },
  { label: 'Steel',   hex: '#8898A8' },
  { label: 'White',   hex: '#F0F0F0' },
  { label: 'Sky',     hex: '#0284C7' },
  { label: 'Emerald', hex: '#059669' },
  { label: 'Teal',    hex: '#2B8A8A' },
  { label: 'Crimson', hex: '#9B2335' },
  { label: 'Purple',  hex: '#6B3FA0' },
  { label: 'Copper',  hex: '#C2611F' },
  { label: 'Rose',    hex: '#BE185D' },
  { label: 'Lime',    hex: '#65A30D' },
];

function isValidHex(h: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(h);
}

function SplashPreview({ name, logoUri, primary, secondary }: {
  name: string; logoUri: string | null; primary: string; secondary: string;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const palette = derivePalette(primary, secondary);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.12, duration: 700, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.0,  duration: 700, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  return (
    <View style={[prev.box, { backgroundColor: palette.bg }]}>
      <Animated.Image
        source={logoUri ? { uri: logoUri } : titanLogo}
        style={[prev.logo, { transform: [{ scale }] }]}
        resizeMode="contain"
      />
      <Text style={[prev.name, { color: palette.text }]} numberOfLines={1}>
        {name || 'Your Society'}
      </Text>
      <Text style={[prev.sub, { color: palette.accent }]}>Loading…</Text>
    </View>
  );
}

export default function SocietyBrandingScreen() {
  const router  = useRouter();
  const colors  = useDynamicColors();
  const { societyId, loading: societyLoading } = useAdminSociety();

  const [name,           setName]           = useState('');
  const [tagline,        setTagline]        = useState('');
  const [primaryColor,   setPrimaryColor]   = useState('#001F5B');
  const [secondaryColor, setSecondaryColor] = useState('#C4CEDB');
  const [primaryHex,     setPrimaryHex]     = useState('#001F5B');
  const [secondaryHex,   setSecondaryHex]   = useState('#C4CEDB');
  const [logoUrl,        setLogoUrl]        = useState<string | null>(null);
  const [logoLocalUri,   setLogoLocalUri]   = useState<string | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [saving,         setSaving]         = useState(false);

  const styles = useMemo(() => makeStyles(colors), [colors]);

  useEffect(() => {
    if (secondaryHex !== secondaryColor) setSecondaryHex(secondaryColor);
  }, [secondaryColor]);

  useEffect(() => {
    if (primaryHex !== primaryColor) setPrimaryHex(primaryColor);
  }, [primaryColor]);

  useEffect(() => {
    if (societyLoading || !societyId) return;
    (async () => {
      const { data } = await supabase
        .from('societies')
        .select('name, tagline, primary_color, secondary_color, logo_url')
        .eq('id', societyId)
        .single();
      if (data) {
        const d = data as any;
        setName(d.name ?? '');
        setTagline(d.tagline ?? '');
        const pc = d.primary_color   ?? '#001F5B';
        const sc = d.secondary_color ?? '#C4CEDB';
        setPrimaryColor(pc);   setPrimaryHex(pc);
        setSecondaryColor(sc); setSecondaryHex(sc);
        setLogoUrl(d.logo_url ?? null);
      }
      setLoading(false);
    })();
  }, [societyId, societyLoading]);

  function applyPrimaryHex(raw: string) {
    const h = raw.startsWith('#') ? raw : '#' + raw;
    setPrimaryHex(h);
    if (isValidHex(h)) setPrimaryColor(h);
  }

  function applySecondaryHex(raw: string) {
    const h = raw.startsWith('#') ? raw : '#' + raw;
    setSecondaryHex(h);
    if (isValidHex(h)) setSecondaryColor(h);
  }

  async function pickLogo() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: true, aspect: [1, 1], quality: 0.85,
    });
    if (!result.canceled) setLogoLocalUri(result.assets[0].uri);
  }

  async function save() {
    if (!societyId) return;
    setSaving(true);
    try {
      let finalLogoUrl = logoUrl;
      if (logoLocalUri) {
        finalLogoUrl = await uploadImage(logoLocalUri, 'society-assets', `${societyId}/logo.jpg`);
      }
      const { error } = await supabase.from('societies').update({
        name:            name.trim() || undefined,
        tagline:         tagline.trim() || null,
        primary_color:   primaryColor,
        secondary_color: secondaryColor,
        logo_url:        finalLogoUrl,
      } as any).eq('id', societyId);
      if (error) throw error;
      if (finalLogoUrl !== logoUrl) setLogoUrl(finalLogoUrl);
      setLogoLocalUri(null);
      Alert.alert('Saved ✓', 'Branding saved. Restart the app to see the new splash screen.');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  const displayUri = logoLocalUri ?? logoUrl;

  if (loading || societyLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={hit}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Society Branding</Text>
        <TouchableOpacity onPress={save} disabled={saving} hitSlop={hit}>
          <Text style={[styles.saveBtn, saving && { opacity: 0.4 }]}>
            {saving ? 'Saving…' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* Splash Preview */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>LOADING SCREEN PREVIEW</Text>
          <SplashPreview
            name={name}
            logoUri={displayUri}
            primary={primaryColor}
            secondary={secondaryColor}
          />
          <Text style={styles.hint}>This is exactly what members see when they open the app.</Text>
        </View>

        {/* Logo */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SOCIETY LOGO</Text>
          <View style={styles.logoRow}>
            <TouchableOpacity onPress={pickLogo} activeOpacity={0.8}>
              <View style={[styles.logoCircle, { borderColor: primaryColor }]}>
                {displayUri
                  ? <Image source={{ uri: displayUri }} style={styles.logoImg} />
                  : <View style={[styles.logoPlaceholder, { backgroundColor: primaryColor + '22' }]}>
                      <Text style={styles.logoPlaceholderIcon}>⛳</Text>
                    </View>
                }
              </View>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <TouchableOpacity
                style={[styles.uploadBtn, { borderColor: primaryColor }]}
                onPress={pickLogo} activeOpacity={0.8}
              >
                <Text style={[styles.uploadBtnText, { color: primaryColor }]}>
                  {displayUri ? 'Change Logo' : 'Upload Logo'}
                </Text>
              </TouchableOpacity>
              <Text style={styles.hint}>Square PNG or JPEG · max 10 MB{'\n'}Used in the splash screen and app header.</Text>
            </View>
          </View>
        </View>

        {/* Name */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SOCIETY NAME</Text>
          <View style={styles.card}>
            <TextInput style={styles.input} value={name} onChangeText={setName}
              placeholderTextColor={colors.textMuted} placeholder="e.g. Titan Golf Society" />
          </View>
        </View>

        {/* Tagline */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>TAGLINE</Text>
          <View style={styles.card}>
            <TextInput style={styles.input} value={tagline} onChangeText={setTagline}
              placeholderTextColor={colors.textMuted} placeholder="e.g. Tour life. No excuses."
              maxLength={60} />
          </View>
          <Text style={styles.hint}>Shown on the home screen · max 60 characters</Text>
        </View>

        {/* Primary Colour */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>BACKGROUND COLOUR</Text>
          <Text style={styles.hint2}>Choose a dark colour — this becomes the app background.</Text>
          <ColorSwatches swatches={BG_SWATCHES} selected={primaryColor} onSelect={setPrimaryColor} />
          <HexInput label="Custom hex" value={primaryHex} onChange={applyPrimaryHex} accent={primaryColor} />
        </View>

        {/* Secondary Colour */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ACCENT COLOUR</Text>
          <Text style={styles.hint2}>Icons, highlights, active tabs — choose a light or vibrant colour.</Text>
          <ColorSwatches swatches={ACCENT_SWATCHES} selected={secondaryColor} onSelect={setSecondaryColor} />
          <HexInput label="Custom hex" value={secondaryHex} onChange={applySecondaryHex} accent={secondaryColor} />
        </View>

        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: primaryColor }, saving && { opacity: 0.5 }]}
          onPress={save} disabled={saving} activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color="#ffffff" />
            : <Text style={styles.saveButtonText}>Save Branding</Text>
          }
        </TouchableOpacity>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ColorSwatches({ swatches, selected, onSelect }: {
  swatches: { label: string; hex: string }[];
  selected: string;
  onSelect: (hex: string) => void;
}) {
  const selectedSwatch = swatches.find(s => s.hex.toLowerCase() === selected.toLowerCase());
  return (
    <View style={sw.wrap}>
      <View style={sw.grid}>
        {swatches.map(s => (
          <TouchableOpacity
            key={s.hex}
            style={[sw.swatch, { backgroundColor: s.hex }, selected.toLowerCase() === s.hex.toLowerCase() && sw.swatchOn]}
            onPress={() => onSelect(s.hex)}
            activeOpacity={0.8}
          >
            {selected.toLowerCase() === s.hex.toLowerCase() && <Text style={sw.tick}>✓</Text>}
          </TouchableOpacity>
        ))}
      </View>
      {selectedSwatch && <Text style={sw.label}>{selectedSwatch.label}</Text>}
    </View>
  );
}

function HexInput({ label, value, onChange, accent }: {
  label: string; value: string; onChange: (v: string) => void; accent: string;
}) {
  const valid = isValidHex(value);
  return (
    <View style={hi.row}>
      <View style={[hi.preview, { backgroundColor: valid ? value : '#444' }]} />
      <TextInput
        style={[hi.input, { borderColor: valid ? accent : '#f87171' }]}
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={7}
        placeholder="#000000"
        placeholderTextColor="#556677"
      />
    </View>
  );
}

const hit = { top: 12, bottom: 12, left: 12, right: 12 };

function makeStyles(c: ReturnType<typeof useDynamicColors>) {
  return StyleSheet.create({
    container:  { flex: 1, backgroundColor: c.bg },
    centered:   { alignItems: 'center', justifyContent: 'center' },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    back:        { fontSize: fonts.sm, color: c.gold, fontWeight: '600' },
    headerTitle: { fontSize: fonts.md, fontWeight: '800', color: c.white, letterSpacing: 0.5 },
    saveBtn:     { fontSize: fonts.sm, fontWeight: '700', color: c.gold },
    scroll:      { padding: spacing.lg, paddingBottom: 60 },
    section:     { marginBottom: spacing.xl },
    sectionLabel: {
      fontSize: fonts.xs, fontWeight: '800', color: c.textMuted,
      letterSpacing: 2, marginBottom: spacing.xs, textTransform: 'uppercase',
    },
    hint:  { fontSize: fonts.xs, color: c.textMuted, marginTop: spacing.xs, lineHeight: 17 },
    hint2: { fontSize: fonts.xs, color: c.textSecondary, marginBottom: spacing.sm },
    card: {
      backgroundColor: c.card, borderRadius: radius.md,
      borderWidth: 1, borderColor: c.border,
    },
    input: {
      paddingHorizontal: spacing.md, paddingVertical: spacing.md,
      fontSize: fonts.md, color: c.white,
    },
    logoRow:     { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
    logoCircle: {
      width: 88, height: 88, borderRadius: 44,
      borderWidth: 3, overflow: 'hidden',
    },
    logoImg:             { width: '100%', height: '100%' },
    logoPlaceholder:     { flex: 1, alignItems: 'center', justifyContent: 'center' },
    logoPlaceholderIcon: { fontSize: 36 },
    uploadBtn: {
      borderWidth: 1.5, borderRadius: radius.md, borderStyle: 'dashed',
      paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
      alignItems: 'center', marginBottom: spacing.xs,
    },
    uploadBtnText: { fontSize: fonts.sm, fontWeight: '700' },
    saveButton: {
      borderRadius: radius.md, paddingVertical: spacing.md,
      alignItems: 'center', marginTop: spacing.md,
    },
    saveButtonText: { fontSize: fonts.md, fontWeight: '800', color: '#ffffff', letterSpacing: 0.5 },
  });
}

const prev = StyleSheet.create({
  box: {
    borderRadius: radius.lg, height: 200,
    alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    overflow: 'hidden',
  },
  logo: { width: 80, height: 80 },
  name: { fontSize: fonts.lg, fontWeight: '800', letterSpacing: 1 },
  sub:  { fontSize: fonts.xs, fontWeight: '600', letterSpacing: 2 },
});

const sw = StyleSheet.create({
  wrap:     { marginBottom: spacing.sm },
  grid:     { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xs },
  swatch:   { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  swatchOn: { borderColor: '#ffffff', transform: [{ scale: 1.12 }] },
  tick:     { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  label:    { fontSize: fonts.xs, color: '#8899aa', minHeight: 16 },
});

const hi = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  preview: { width: 32, height: 32, borderRadius: 8 },
  input:   { flex: 1, backgroundColor: '#0d1520', borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: fonts.md, color: '#ffffff', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
});
