/**
 * Concept Preview — TITAN premium home screen redesign
 * Accessible only from Admin → Concept Preview
 * Safe sandbox: touches nothing live, no production routes changed
 */
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, RefreshControl, Dimensions, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { SvgXml } from 'react-native-svg';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { PLAY_SVG, EVENT_SVG, CLUBHOUSE_SVG, CADDIE_SVG, PRACTICE_SVG, LOCKER_SVG, tintSvg } from '../../../src/lib/tileIcons';

const { width: SCREEN_W } = Dimensions.get('window');
const GOLD = '#D4AF37';
const FF   = 'JUSTSans';
const FFB  = 'JUSTSans-ExBold';

// ── Tile definitions (matches concept grid) ───────────────────
const TILES: {
  key: string;
  label: string;
  sub: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  area: string;
  route: string;
}[] = [
  { key: 'play',      label: 'Play',        sub: 'Casual round',                icon: 'golf-outline',       area: 'casual',  route: '/(app)/admin/concept-casual' },
  { key: 'events',    label: 'Events',      sub: 'Tournaments & leagues',        icon: 'trophy-outline',     area: 'tour',    route: '/(app)/tour' },
  { key: 'clubhouse', label: 'Clubhouse',   sub: 'Swindles, roll-ups & more',   icon: 'people-outline',     area: 'swindle', route: '/(app)/admin/concept-swindle' },
  { key: 'caddie',    label: 'Caddie',      sub: 'GPS, yardages & course guide', icon: 'navigate-outline',  area: 'casual',  route: '/(app)/admin/concept-rangefinder' },
  { key: 'practice',  label: 'Practice',    sub: 'Driving range & training',    icon: 'bar-chart-outline',  area: 'casual',  route: '/(app)/admin/concept-practice' },
  { key: 'locker',    label: 'Locker Room', sub: 'Stats, handicap & equipment', icon: 'shield-outline',     area: 'casual',  route: '/(app)/admin/concept-locker' },
];

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning,';
  if (h < 17) return 'Good afternoon,';
  return 'Good evening,';
}

function firstName(displayName: string): string {
  return displayName.split(' ')[0] ?? displayName;
}

export default function ConceptPreviewScreen() {
  const colors = useDynamicColors();
  const { societyId } = useSocietyTheme();
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
  });

  const [memberTypes, setMemberTypes] = useState<string[]>([]);
  const [playerName,  setPlayerName]  = useState('');
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [notifCount,  setNotifCount]  = useState(0);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: playerRow } = await supabase
      .from('players').select('id, display_name').eq('auth_uid', user.id).single();

    if (playerRow) {
      setPlayerName((playerRow as any).display_name ?? '');
      const { data: sm } = await supabase
        .from('society_members').select('membership_types, role')
        .eq('society_id', societyId)
        .eq('player_id', (playerRow as any).id).single();
      const role = (sm as any)?.role ?? '';
      const isPrivileged = role === 'admin' || role === 'owner';
      setMemberTypes(isPrivileged ? ['casual', 'tour', 'swindle'] : ((sm as any)?.membership_types ?? []));
    }

    const { data: notifs } = await supabase
      .from('notifications').select('id').order('created_at', { ascending: false }).limit(5);
    setNotifCount((notifs as any)?.length ?? 0);

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const hasArea = (a: string) => memberTypes.length === 0 || memberTypes.includes(a);

  const handleTile = (tile: typeof TILES[number]) => {
    if (!hasArea(tile.area)) {
      router.push('/(app)/join' as any);
      return;
    }
    router.push(tile.route as any);
  };

  // Gate on both font load and data load
  const isReady = fontsLoaded && !loading;

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* ── TITAN header — always visible ── */}
      <View style={s.header}>
        {/* Back chevron */}
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={s.headerSide}
        >
          <Ionicons name="chevron-back" size={24} color="#ffffff" />
        </TouchableOpacity>

        {/* T-mark icon only — no text */}
        <View style={s.headerCenter}>
          <Image
            source={require('../../../assets/TitanAppLogo.png')}
            style={s.headerLogo}
            resizeMode="contain"
          />
        </View>

        {/* Bell */}
        <View style={[s.headerSide, { alignItems: 'flex-end' }]}>
          <View style={s.bellWrap}>
            <Ionicons name="notifications-outline" size={24} color="#ffffff" />
            {notifCount > 0 && <View style={s.notifDot} />}
          </View>
        </View>
      </View>

      {!isReady ? (
        <View style={s.centered}>
          <ActivityIndicator color={GOLD} size="large" />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={GOLD}
            />
          }
        >
          {/* ── Greeting block ── */}
          <View style={s.greetingBlock}>
            <Text style={s.greetingSub}>{getGreeting()}</Text>
            <Text style={s.greetingName}>{firstName(playerName) || 'Golfer'}</Text>
            <Text style={s.courseName}>West Cliffs Golf Links</Text>
            <View style={s.weatherRow}>
              <Ionicons name="sunny-outline" size={13} color="#6b7280" />
              <Text style={s.weatherText}>Today · 18°C · Light Wind</Text>
            </View>
          </View>

          {/* ── Hero image ── */}
          <View style={s.heroWrap}>
            <Image
              source={require('../../../assets/hero-course.jpeg')}
              style={s.heroImage}
              resizeMode="cover"
            />

            {/* ── Next Tee Time card ── */}
            <View style={s.teetime}>
              <View style={s.teetimeLeft}>
                <Text style={s.teetimeLabel}>NEXT TEE TIME</Text>
                <Text style={s.teetimeTime}>10:30 · Hole 1</Text>
                <Text style={s.teetimeOpponent}>vs Instigators</Text>
              </View>
              <TouchableOpacity style={s.viewBtn} activeOpacity={0.8}>
                <Text style={s.viewBtnText}>VIEW</Text>
                <Ionicons name="chevron-forward" size={11} color={GOLD} />
              </TouchableOpacity>
            </View>
          </View>

          {/* ── 6-tile grid ── */}
          <View style={s.grid}>
            {TILES.map((tile) => {
              const locked = !hasArea(tile.area);
              return (
                <TouchableOpacity
                  key={tile.key}
                  style={[s.tile, locked && s.tileLocked]}
                  onPress={() => handleTile(tile)}
                  activeOpacity={0.75}
                >
                  <View style={[s.tileIconWrap, locked && s.tileIconWrapLocked]}>
                    <Ionicons
                      name={locked ? 'lock-closed-outline' : tile.icon}
                      size={22}
                      color={locked ? '#444' : GOLD}
                    />
                  </View>
                  <Text style={[s.tileLabel, locked && s.tileLabelLocked]}>
                    {tile.label}
                  </Text>
                  <Text style={s.tileSub} numberOfLines={2}>
                    {locked ? 'Ask Rick for access' : tile.sub}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Preview watermark */}
          <View style={s.watermark}>
            <Text style={s.watermarkText}>CONCEPT PREVIEW · NOT LIVE</Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────
const TILE_W = Math.floor((SCREEN_W - 16 * 2 - 10) / 2);

const s = StyleSheet.create({
  root:     { flex: 1, backgroundColor: '#000000' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll:   { paddingBottom: 40 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: '#000000',
  },
  headerSide:   { width: 40 },
  headerCenter: { alignItems: 'center' },
  headerLogo:   { width: 36, height: 36 },
  bellWrap:     { position: 'relative' },
  notifDot: {
    position: 'absolute', top: -1, right: -1,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: GOLD,
    borderWidth: 1.5, borderColor: '#000',
  },

  // Greeting
  greetingBlock: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18 },
  greetingSub:   { fontFamily: FFB, fontSize: 15, color: '#fff' },
  greetingName:  { fontFamily: FFB, fontSize: 40, color: '#ffffff', lineHeight: 46, letterSpacing: -0.5 },
  courseName:    { fontFamily: FFB, fontSize: 13, color: '#fff', marginTop: 8 },
  weatherRow:    { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  weatherText:   { fontFamily: FFB, fontSize: 12, color: '#fff' },

  // Hero
  heroWrap: {
    marginHorizontal: 16,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 20,
    backgroundColor: '#0a0f14',
  },
  heroPlaceholder: {
    height: 200,
    backgroundColor: '#0a0f14',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  heroImage: {
    // Use when Dave supplies a course photo
    width: '100%' as const,
    height: 200,
  },
  heroPlaceholderText: {
    fontFamily: FFB,
    fontSize: 10,
    color: `${GOLD}40`,
    letterSpacing: 2.5,
  },

  // Tee time card
  teetime: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.9)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  teetimeLeft:     { gap: 2 },
  teetimeLabel:    { fontFamily: FFB, fontSize: 9, color: GOLD, letterSpacing: 2 },
  teetimeTime:     { fontFamily: FFB, fontSize: 22, color: '#ffffff', marginTop: 1 },
  teetimeOpponent: { fontFamily: FFB, fontSize: 12, color: '#fff', marginTop: 1 },
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderColor: GOLD,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  viewBtnText: { fontFamily: FFB, fontSize: 11, color: GOLD, letterSpacing: 0.5 },

  // Grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 10,
  },
  tile: {
    width: TILE_W,
    backgroundColor: '#111111',
    borderRadius: 14,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: '#1c1c1c',
  },
  tileLocked: { opacity: 0.45 },
  tileIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${GOLD}35`,
    backgroundColor: `${GOLD}0d`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileIconWrapLocked: {
    borderColor: '#333',
    backgroundColor: 'transparent',
  },
  tileLabel:       { fontFamily: FFB, fontSize: 15, color: '#ffffff', letterSpacing: -0.2 },
  tileLabelLocked: { color: '#fff' },
  tileSub:         { fontFamily: FFB, fontSize: 11, color: '#fff', lineHeight: 15 },

  // Watermark
  watermark: { alignItems: 'center', paddingVertical: 24 },
  watermarkText: {
    fontFamily: FFB,
    fontSize: 10,
    color: '#2a2a2a',
    letterSpacing: 2,
  },
});
