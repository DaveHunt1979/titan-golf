import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Image, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { usePlatformAdmin } from '../../../src/lib/usePlatformAdmin';
import { uploadImage } from '../../../src/lib/uploadImage';
import { goBack } from '../../../src/lib/navigation';

const GOLD = '#D4AF37';
const GREEN = '#4ade80';
const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

export default function SocietyBrandingScreen() {
  const router  = useRouter();
  const { societyId: paramSocietyId } = useLocalSearchParams<{ societyId?: string }>();
  const { societyId: activeSocietyId, loading: activeLoading } = useAdminSociety();
  const { isPlatformAdmin, loading: platformLoading } = usePlatformAdmin();

  // A God-tier admin can be sent here to edit a society other than the one
  // they currently have active (e.g. from the Societies list) — gated on
  // is_platform_admin so a regular society admin can't edit someone else's
  // society just by guessing a societyId in the URL.
  const isForeign = !!paramSocietyId;
  const societyId = isForeign ? paramSocietyId : activeSocietyId;
  const societyLoading = isForeign ? platformLoading : activeLoading;

  const [name,           setName]           = useState('');
  const [tagline,        setTagline]        = useState('');
  const [logoUrl,        setLogoUrl]        = useState<string | null>(null);
  const [logoLocalUri,   setLogoLocalUri]   = useState<string | null>(null);
  const [heroUrl,        setHeroUrl]        = useState<string | null>(null);
  const [heroLocalUri,   setHeroLocalUri]   = useState<string | null>(null);
  const [instagramUrl,   setInstagramUrl]   = useState('');
  const [loading,        setLoading]        = useState(true);
  const [saving,         setSaving]         = useState(false);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  useEffect(() => {
    if (societyLoading || !societyId) return;
    (async () => {
      const { data } = await supabase
        .from('societies')
        .select('name, tagline, logo_url, hero_url, instagram_url')
        .eq('id', societyId)
        .single();
      if (data) {
        const d = data as any;
        setName(d.name ?? '');
        setTagline(d.tagline ?? '');
        setLogoUrl(d.logo_url ?? null);
        setHeroUrl(d.hero_url ?? null);
        setInstagramUrl(d.instagram_url ?? '');
      }
      setLoading(false);
    })();
  }, [societyId, societyLoading]);

  async function pickLogo() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: true, aspect: [1, 1], quality: 0.85,
    });
    if (!result.canceled) setLogoLocalUri(result.assets[0].uri);
  }

  async function pickHero() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: true, aspect: [16, 9], quality: 0.85,
    });
    if (!result.canceled) setHeroLocalUri(result.assets[0].uri);
  }

  async function save() {
    if (!societyId) return;
    setSaving(true);
    try {
      let finalLogoUrl = logoUrl;
      if (logoLocalUri) {
        finalLogoUrl = await uploadImage(logoLocalUri, 'society-assets', `${societyId}/logo.jpg`);
      }
      let finalHeroUrl = heroUrl;
      if (heroLocalUri) {
        finalHeroUrl = await uploadImage(heroLocalUri, 'society-assets', `${societyId}/hero.jpg`);
      }
      const rawInsta = instagramUrl.trim();
      let normalizedInsta = rawInsta;
      if (rawInsta && !rawInsta.startsWith('http')) {
        normalizedInsta = `https://www.instagram.com/${rawInsta.replace(/^@/, '')}/`;
      }
      const { error } = await supabase.from('societies').update({
        name:            name.trim() || undefined,
        tagline:         tagline.trim() || null,
        logo_url:        finalLogoUrl,
        hero_url:        finalHeroUrl,
        instagram_url:   normalizedInsta || null,
      } as any).eq('id', societyId);
      if (error) throw error;
      if (finalLogoUrl !== logoUrl) setLogoUrl(finalLogoUrl);
      if (finalHeroUrl !== heroUrl) setHeroUrl(finalHeroUrl);
      setLogoLocalUri(null);
      setHeroLocalUri(null);
      setInstagramUrl(normalizedInsta);
      Alert.alert('Saved ✓', 'Branding saved. Restart the app to see the new splash screen.');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  const displayUri = logoLocalUri ?? logoUrl;
  const displayHeroUri = heroLocalUri ?? heroUrl;

  if (loading || societyLoading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  if (isForeign && !isPlatformAdmin) {
    return (
      <View style={[s.container, { alignItems: 'center', justifyContent: 'center', padding: 30 }]}>
        <StatusBar style="light" />
        <Text style={s.headerTitle}>Not available</Text>
        <Text style={[s.hint, { textAlign: 'center', marginTop: 8 }]}>This is a Dave/Rick-only screen.</Text>
        <TouchableOpacity style={s.saveButton} onPress={() => goBack(router, '/(app)/admin/hub-tournament')} activeOpacity={0.8}>
          <Text style={s.saveButtonText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const backTarget = isForeign ? `/(app)/admin/society-detail/${societyId}` : '/(app)/admin/hub-tournament';

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, backTarget)} hitSlop={hit} style={s.headerLeft}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerTitle}>Society Branding</Text>
          <Text style={s.headerSub}>{isForeign ? 'god admin' : 'admin'}</Text>
        </View>
        <TouchableOpacity onPress={save} disabled={saving} hitSlop={hit} style={s.headerRight}>
          <Text style={[s.saveBtn, saving && { opacity: 0.4 }]}>
            {saving ? 'Saving…' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {/* Logo */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>SOCIETY LOGO</Text>
          <View style={s.logoCard}>
            <View style={s.logoRow}>
              <TouchableOpacity onPress={pickLogo} activeOpacity={0.8}>
                <View style={[s.logoCircle, { borderColor: GOLD }]}>
                  {displayUri
                    ? <Image source={{ uri: displayUri }} style={s.logoImg} />
                    : <View style={[s.logoPlaceholder, { backgroundColor: GOLD + '22' }]}>
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

        {/* Hero image */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>HOME HERO PHOTO</Text>
          <TouchableOpacity onPress={pickHero} activeOpacity={0.8}>
            {displayHeroUri
              ? <Image source={{ uri: displayHeroUri }} style={s.heroPreview} resizeMode="cover" />
              : <View style={[s.heroPreview, s.heroPlaceholder]}>
                  <Text style={s.logoPlaceholderIcon}>🖼️</Text>
                </View>
            }
          </TouchableOpacity>
          <TouchableOpacity style={s.uploadBtn} onPress={pickHero} activeOpacity={0.8}>
            <Text style={s.uploadBtnText}>{displayHeroUri ? 'Change Hero Photo' : 'Upload Hero Photo'}</Text>
          </TouchableOpacity>
          <Text style={s.hint}>Widescreen photo · max 10 MB{'\n'}Replaces the course photo on members' Home screen. Leave blank to keep the default.</Text>
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

        {/* Social Media */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>SOCIAL MEDIA</Text>
          <View style={s.inputCard}>
            <TextInput
              style={s.input}
              value={instagramUrl}
              onChangeText={setInstagramUrl}
              placeholderTextColor="#444"
              placeholder="@yoursociety or full URL"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>
          <Text style={s.hint}>Enter @handle or https://www.instagram.com/yoursociety</Text>
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
  heroPreview: {
    width: '100%', aspectRatio: 16 / 9, borderRadius: 12,
    overflow: 'hidden', marginBottom: 10, backgroundColor: '#111',
  },
  heroPlaceholder: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#1c1c1c' },
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

