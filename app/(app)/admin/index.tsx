import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, Share, Clipboard, Image, useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { titanLogo } from '../../../src/lib/assets';
import { IS_PAD } from '../../../src/lib/useDeviceLayout';

const GOLD   = '#D4AF37';
const RED    = '#f87171';
const PURPLE = '#a78bfa';
const BLUE   = '#60a5fa';
const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';

const BUCKETS = [
  { key: 'swindle',    label: 'Swindle',    sub: 'Weekly games & money list',      icon: 'cash-outline'     as const, accent: PURPLE, route: '/(app)/admin/swindle' },
  { key: 'tournament', label: 'Tournament', sub: 'Branding, teams & schedule',     icon: 'trophy-outline'   as const, accent: GOLD,   route: '/(app)/admin/hub-tournament' },
  { key: 'platform',   label: 'Platform',   sub: 'Players, courses & the rest',    icon: 'settings-outline' as const, accent: BLUE,   route: '/(app)/admin/hub-platform' },
] as const;

export default function SocietyAdminScreen() {
  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const router = useRouter();
  const dc = useDynamicColors();
  const { localLogo, logoUrl } = useSocietyTheme();
  const { width: winW } = useWindowDimensions();
  const contentW = IS_PAD ? winW - 220 : winW;
  const tileW = Math.floor((contentW - 40 - 10) / 2);
  const { societyId, loading: societyLoading } = useAdminSociety();
  const [societyName, setSocietyName] = useState('');
  const [joinPin, setJoinPin]         = useState('');
  const [loading, setLoading]         = useState(true);
  const [deleting, setDeleting]       = useState(false);

  useEffect(() => {
    if (societyLoading) return;
    if (!societyId) { setLoading(false); return; }
    (async () => {
      try {
        const { data } = await supabase
          .from('societies').select('name, join_pin').eq('id', societyId).single();
        if (data) {
          setSocietyName((data as any).name ?? '');
          setJoinPin(String((data as any).join_pin ?? '').replace(/[^0-9]/g, ''));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [societyId, societyLoading]);

  async function deleteSociety() {
    Alert.alert(
      `Delete ${societyName}?`,
      'This will permanently remove all competitions, scores, and player memberships. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Society',
          style: 'destructive',
          onPress: () => Alert.alert(
            'Are you absolutely sure?',
            `Type of data that will be lost: all matches, all scores, all season data, all memberships. "${societyName}" will be gone forever.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Yes, delete everything',
                style: 'destructive',
                onPress: async () => {
                  setDeleting(true);
                  const { error } = await supabase.rpc('delete_society', { p_society_id: societyId });
                  setDeleting(false);
                  if (error) { Alert.alert('Error', error.message); return; }
                  await supabase.auth.signOut();
                  router.replace('/(auth)' as any);
                },
              },
            ],
          ),
        },
      ],
    );
  }

  async function generatePin() {
    const newPin = String(Math.floor(100000 + Math.random() * 900000));
    const { error } = await supabase
      .from('societies')
      .update({ join_pin: newPin } as any)
      .eq('id', societyId);
    if (error) { Alert.alert('Error', error.message); return; }
    setJoinPin(newPin);
  }

  async function sharePin() {
    const formatted = `${joinPin.slice(0, 3)} ${joinPin.slice(3)}`;
    try {
      await Share.share({ message: `Join ${societyName} on Titan Golf — your PIN is: ${formatted}` });
    } catch {
      Clipboard.setString(joinPin);
      Alert.alert('Copied', 'PIN copied to clipboard.');
    }
  }

  if (loading || societyLoading || !fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: dc.bg, alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar style="light" /><ActivityIndicator color={dc.gold} size="large" />
      </View>
    );
  }

  if (!societyId) {
    return (
      <View style={{ flex: 1, backgroundColor: dc.bg, alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar style="light" />
        <Text style={{ color: '#fff', fontFamily: FFB, fontSize: 14, textAlign: 'center', paddingHorizontal: 32 }}>
          No society found.{'\n'}Create one from the landing screen or contact your admin.
        </Text>
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { borderBottomColor: dc.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={[s.back, { color: dc.gold }]}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)} style={s.headerLogo} resizeMode="contain" />
          <Text style={[s.headerSub, { color: dc.gold }]}>ADMIN</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* SOCIETY */}
        <View style={s.section}>
          <View style={[s.card, { backgroundColor: dc.card, borderColor: dc.border }]}>
            <Text style={[s.cardLabel, { color: dc.cardText }]}>Society</Text>
            <Text style={[s.cardValue, { color: dc.cardText }]}>{societyName}</Text>
          </View>
          <View style={[s.card, { backgroundColor: dc.card, borderColor: dc.border, marginTop: 8 }]}>
            <Text style={[s.cardLabel, { color: dc.cardText }]}>Player Join PIN</Text>
            {joinPin ? (
              <>
                <Text style={s.pinValue}>{joinPin.slice(0, 3)} {joinPin.slice(3)}</Text>
                <Text style={[s.hint, { color: dc.cardText }]}>Share this PIN so new players can join your society</Text>
                <TouchableOpacity style={s.pinShareBtn} onPress={sharePin} activeOpacity={0.8}>
                  <Text style={s.pinShareBtnText}>Share PIN</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={[s.hint, { color: dc.cardText, marginTop: 4 }]}>No join PIN generated yet</Text>
                <TouchableOpacity style={s.pinShareBtn} onPress={generatePin} activeOpacity={0.8}>
                  <Text style={s.pinShareBtnText}>Generate PIN</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* THE THREE BUCKETS — same square-tile language as the home screen grid */}
        <View style={s.grid}>
          {BUCKETS.map(b => (
            <TouchableOpacity
              key={b.key}
              style={[s.tile, { width: tileW, backgroundColor: dc.card, borderColor: dc.border }]}
              onPress={() => router.push(b.route as any)}
              activeOpacity={0.75}
            >
              <View style={[s.tileIcon, { backgroundColor: `${b.accent}18`, borderColor: `${b.accent}55` }]}>
                <Ionicons name={b.icon} size={24} color={b.accent} />
              </View>
              <Text style={[s.tileLabel, { color: dc.cardText }]} numberOfLines={1}>{b.label}</Text>
              <Text style={[s.tileSub, { color: dc.textSecondary }]} numberOfLines={2}>{b.sub}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* DANGER ZONE */}
        <View style={[s.section, { marginTop: 24 }]}>
          <Text style={[s.sectionLabel, { color: RED }]}>DANGER ZONE</Text>
          <TouchableOpacity
            style={s.deleteCard}
            onPress={deleteSociety}
            disabled={deleting}
            activeOpacity={0.8}
          >
            {deleting
              ? <ActivityIndicator color={RED} />
              : <>
                  <Text style={s.deleteTitle}>Delete Society</Text>
                  <Text style={s.deleteSub}>Permanently removes all data — cannot be undone</Text>
                </>
            }
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerCenter: { alignItems: 'center' },
  headerLogo:   { width: 36, height: 36 },
  headerSub:    { fontFamily: FFB, fontSize: 10, letterSpacing: 2, marginTop: 2 },
  back:         { fontFamily: FFB, fontSize: 14 },

  scroll:  { padding: 20, paddingBottom: 60 },
  section: { marginBottom: 28 },

  sectionLabel: {
    fontFamily: FFB, fontSize: 10,
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10,
  },

  card: {
    borderRadius: 14,
    borderWidth: 1, padding: 16,
  },
  cardLabel: {
    fontFamily: FFB, fontSize: 10, letterSpacing: 1, marginBottom: 4,
    textTransform: 'uppercase',
  },
  cardValue: { fontFamily: FFB, fontSize: 16 },
  hint: { fontFamily: FFB, fontSize: 12, marginTop: 6 },

  pinValue: { fontFamily: FFB, fontSize: 28, color: GOLD, letterSpacing: 6, marginTop: 4 },
  pinShareBtn: {
    marginTop: 10, backgroundColor: GOLD + '22',
    borderRadius: 10, paddingVertical: 10,
    alignItems: 'center', borderWidth: 1, borderColor: GOLD + '55',
  },
  pinShareBtnText: { fontFamily: FFB, fontSize: 14, color: GOLD },

  // Tile grid — matches the home screen's square-tile language exactly
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 28 },
  tile: {
    borderRadius: 14, padding: 16, gap: 6,
    borderWidth: 1,
  },
  tileIcon: {
    width: 44, height: 44, borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  tileLabel: { fontFamily: FFB, fontSize: 15, letterSpacing: -0.2 },
  tileSub:   { fontFamily: FFB, fontSize: 11, lineHeight: 15 },

  deleteCard: {
    backgroundColor: 'rgba(248,113,113,0.08)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)',
    padding: 16, alignItems: 'center',
  },
  deleteTitle: { fontFamily: FFB, fontSize: 16, color: RED },
  deleteSub:   { fontFamily: FFB, fontSize: 12, color: RED, opacity: 0.7, marginTop: 4 },
});
