import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Image, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { uploadImage } from '../../../src/lib/uploadImage';
import { useDynamicColors, derivePalette } from '../../../src/lib/SocietyThemeContext';

const GOLD = '#D4AF37';
const GREEN = '#4ade80';
const RED = '#f87171';
const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

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
      <Text style={[prev.name, { color: palette.text, fontFamily: FFB }]} numberOfLines={1}>
        {name || 'Your Society'}
      </Text>
      <Text style={[prev.sub, { color: palette.accent, fontFamily: FFB }]}>Loading…</Text>
    </View>
  );
}

export default function SocietyBrandingScreen() {
  const router  = useRouter();
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

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

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

  if (loading || societyLoading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={hit} style={s.headerLeft}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerTitle}>Society Branding</Text>
          <Text style={s.headerSub}>admin</Text>
        </View>
        <TouchableOpacity onPress={save} disabled={saving} hitSlop={hit} style={s.headerRight}>
          <Text style={[s.saveBtn, saving && { opacity: 0.4 }]}>
            {saving ? 'Saving…' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {/* Splash Preview */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>LOADING SCREEN PREVIEW</Text>
          <SplashPreview
            name={name}
            logoUri={displayUri}
            primary={primaryColor}
            secondary={secondaryColor}
          />
          <Text style={s.hint}>This is exactly what members see when they open the app.</Text>
        </View>

        {/* Logo */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>SOCIETY LOGO</Text>
          <View style={s.logoCard}>
            <View style={s.logoRow}>
              <TouchableOpacity onPress={pickLogo} activeOpacity={0.8}>
                <View style={[s.logoCircle, { borderColor: primaryColor }]}>
                  {displayUri
                    ? <Image source={{ uri: displayUri }} style={s.logoImg} />
                    : <View style={[s.logoPlaceholder, { backgroundColor: primaryColor + '22' }]}>
                        <Text style={s.logoPlaceholderIcon}>⛳</Text>
                      </View>
                  }
                </View>
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <TouchableOpacity
                  style={s.uploadBtn}
                  onPress={pickLogo} activeOpacity={0.8}
                >
                  <Text style={s.uploadBtnText}>
                    {displayUri ? 'Change Logo' : 'Upload Logo'}
                  </Text>
                </TouchableOpacity>
                <Text style={s.hint}>Square PNG or JPEG · max 10 MB{'\n'}Used in the splash screen and app header.</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Name */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>SOCIETY NAME</Text>
          <View style={s.inputCard}>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholderTextColor="#444"
              placeholder="e.g. Titan Golf Society"
            />
          </View>
        </View>

        {/* Tagline */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>TAGLINE</Text>
          <View style={s.inputCard}>
            <TextInput
              style={s.input}
              value={tagline}
              onChangeText={setTagline}
              placeholderTextColor="#444"
              placeholder="e.g. Tour life. No excuses."
              maxLength={60}
            />
          </View>
          <Text style={s.hint}>Shown on the home screen · max 60 characters</Text>
        </View>

        {/* Background Colour */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>BACKGROUND COLOUR</Text>
          <Text style={s.hint2}>Choose a dark colour — this becomes the app background.</Text>
          <ColorSwatches swatches={BG_SWATCHES} selected={primaryColor} onSelect={setPrimaryColor} />
          <HexInput label="Custom hex" value={primaryHex} onChange={applyPrimaryHex} accent={primaryColor} />
        </View>

        {/* Accent Colour */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>ACCENT COLOUR</Text>
          <Text style={s.hint2}>Icons, highlights, active tabs — choose a light or vibrant colour.</Text>
          <ColorSwatches swatches={ACCENT_SWATCHES} selected={secondaryColor} onSelect={setSecondaryColor} />
          <HexInput label="Custom hex" value={secondaryHex} onChange={applySecondaryHex} accent={secondaryColor} />
        </View>

        <TouchableOpacity
          style={[s.saveButton, saving && { opacity: 0.5 }]}
          onPress={save} disabled={saving} activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color="#000" />
            : <Text style={s.saveButtonText}>Save Branding</Text>
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
        {swatches.map(s => {
          const isOn = selected.toLowerCase() === s.hex.toLowerCase();
          return (
            <TouchableOpacity
              key={s.hex}
              style={[sw.swatch, { backgroundColor: s.hex }, isOn && sw.swatchOn]}
              onPress={() => onSelect(s.hex)}
              activeOpacity={0.8}
            >
              {isOn && <Text style={sw.tick}>✓</Text>}
            </TouchableOpacity>
          );
        })}
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
        style={[hi.input, { borderColor: valid ? GOLD : RED }]}
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={7}
        placeholder="#000000"
        placeholderTextColor="#444"
      />
    </View>
  );
}

const hit = { top: 12, bottom: 12, left: 12, right: 12 };

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  headerLeft:   { flex: 1, alignItems: 'flex-start' },
  headerCenter: { flex: 2, alignItems: 'center' },
  headerRight:  { flex: 1, alignItems: 'flex-end' },
  headerLogo:   { width: 24, height: 24, marginBottom: 2 },
  back:         { fontSize: 14, color: GOLD, fontFamily: FFB },
  headerTitle:  { fontSize: 15, color: '#fff', fontFamily: FFB, letterSpacing: 0.5 },
  headerSub:    { fontSize: 9, color: '#fff', fontFamily: FFB },
  saveBtn:      { fontSize: 14, fontFamily: FFB, color: GOLD },

  scroll:   { padding: 20, paddingBottom: 60 },
  section:  { marginBottom: 28 },

  sectionLabel: {
    fontSize: 10, fontFamily: FFB, color: '#fff',
    letterSpacing: 2, marginBottom: 8,
  },
  hint:  { fontSize: 12, fontFamily: FFB, color: '#fff', marginTop: 8, lineHeight: 17 },
  hint2: { fontSize: 12, fontFamily: FFB, color: '#fff', marginBottom: 12 },

  // Logo card
  logoCard: {
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c',
    padding: 16,
  },
  logoRow:             { flexDirection: 'row', gap: 16, alignItems: 'center' },
  logoCircle: {
    width: 88, height: 88, borderRadius: 44,
    borderWidth: 3, overflow: 'hidden',
  },
  logoImg:             { width: '100%', height: '100%' },
  logoPlaceholder:     { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoPlaceholderIcon: { fontSize: 36 },
  uploadBtn: {
    backgroundColor: GOLD, borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 16,
    alignItems: 'center', marginBottom: 8,
  },
  uploadBtnText: { fontSize: 14, fontFamily: FFB, color: '#000' },

  // Inputs
  inputCard: {
    backgroundColor: '#111', borderRadius: 12,
    borderWidth: 1, borderColor: '#1c1c1c',
  },
  input: {
    paddingHorizontal: 14, paddingVertical: 14,
    fontSize: 15, fontFamily: FFB, color: '#fff',
  },

  // Save button
  saveButton: {
    backgroundColor: GOLD, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  saveButtonText: { fontSize: 15, fontFamily: FFB, color: '#000', letterSpacing: 0.5 },
});

const prev = StyleSheet.create({
  box: {
    borderRadius: 16, height: 200,
    alignItems: 'center', justifyContent: 'center', gap: 10,
    overflow: 'hidden',
  },
  logo: { width: 80, height: 80 },
  name: { fontSize: 18, fontWeight: '800', letterSpacing: 1 },
  sub:  { fontSize: 11, fontWeight: '600', letterSpacing: 2 },
});

const sw = StyleSheet.create({
  wrap:     { marginBottom: 10 },
  grid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 8 },
  swatch: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 2, borderColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  swatchOn: { borderWidth: 3, borderColor: GOLD, transform: [{ scale: 1.12 }] },
  tick:     { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  label:    { fontSize: 11, fontFamily: FFB, color: '#fff', minHeight: 16 },
});

const hi = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  preview: { width: 32, height: 32, borderRadius: 8 },
  input: {
    flex: 1, backgroundColor: '#111', borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, fontFamily: FFB, color: '#fff',
  },
});
