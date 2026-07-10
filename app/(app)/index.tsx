import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl, Dimensions, Linking,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../src/lib/supabase';
import { resolveAvatar, titanLogo } from '../../src/lib/assets';
import { useSocietyTheme } from '../../src/lib/SocietyThemeContext';

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const CHAT_READ_KEY = 'chat_last_read';
const { width: SW } = Dimensions.get('window');
const TILE_W = Math.floor((SW - 32 - 10) / 2);

function greet(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning,';
  if (h < 17) return 'Good afternoon,';
  return 'Good evening,';
}

const TILES = [
  { key: 'play',      label: 'Play',        sub: 'Start a casual round',        icon: 'golf-outline'      as const, area: 'casual',  route: '/(app)/score'       },
  { key: 'events',    label: 'Events',       sub: 'Tournaments & leagues',        icon: 'trophy-outline'    as const, area: 'tour',    route: '/(app)/tour'        },
  { key: 'clubhouse', label: 'Clubhouse',    sub: 'Swindles & roll-ups',          icon: 'people-outline'    as const, area: 'swindle', route: '/(app)/swindle'     },
  { key: 'caddie',    label: 'Caddie',       sub: 'GPS, yardages & distances',    icon: 'navigate-outline'  as const, area: 'casual',  route: '/(app)/rangefinder' },
  { key: 'practice',  label: 'Practice',     sub: 'Driving range & tracking',     icon: 'bar-chart-outline' as const, area: 'casual',  route: '/(app)/range'       },
  { key: 'locker',    label: 'Locker Room',  sub: 'Stats, handicap & equipment',  icon: 'shield-outline'    as const, area: 'casual',  route: '/(app)/profile'     },
] as const;

export default function HomeScreen() {
  const router = useRouter();
  const { societyId: SOCIETY_ID } = useSocietyTheme();

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [playerName,   setPlayerName]   = useState('');
  const [avatarUrl,    setAvatarUrl]    = useState<string | null>(null);
  const [playerId,     setPlayerId]     = useState<string | null>(null);
  const [memberTypes,  setMemberTypes]  = useState<string[]>([]);
  const [isPrivileged, setIsPrivileged] = useState(false);
  const [unread,       setUnread]       = useState(0);
  const [casualCount,  setCasualCount]  = useState(0);
  const [tourName,     setTourName]     = useState<string | null>(null);
  const [tourLive,     setTourLive]     = useState(0);
  const [swindleName,  setSwindleName]  = useState<string | null>(null);
  const [swindleCount, setSwindleCount] = useState(0);

  async function checkUnread(pid: string | null) {
    const lastRead = await AsyncStorage.getItem(CHAT_READ_KEY);
    const since = lastRead ?? new Date(0).toISOString();
    let q = supabase.from('messages').select('*', { count: 'exact', head: true }).gt('created_at', since);
    if (pid) q = q.neq('player_id', pid);
    const { count } = await q;
    setUnread(count ?? 0);
  }

  useEffect(() => {
    const sub = supabase.channel('home-chat-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        if ((payload.new as any).player_id !== playerId) setUnread(prev => prev + 1);
      })
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [playerId]);

  useFocusEffect(useCallback(() => { checkUnread(playerId); }, [playerId]));

  const load = useCallback(async () => {
    if (!SOCIETY_ID) return;

    const { data: { user } } = await supabase.auth.getUser();

    const [
      { data: comp },
      { count: casual },
      { count: tourCount },
      { data: swindleData },
    ] = await Promise.all([
      supabase.from('competitions').select('id,name').eq('status', 'active').neq('format', 'casual').limit(1).single(),
      supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'in_progress').is('competition_id', null),
      supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'in_progress').not('competition_id', 'is', null),
      supabase.from('swindle_games').select('name,swindle_entries(count)').eq('status', 'open').order('created_at', { ascending: false }).limit(1).single(),
    ]);

    setCasualCount(casual ?? 0);
    setTourName((comp as any)?.name ?? null);
    setTourLive(tourCount ?? 0);
    setSwindleName((swindleData as any)?.name ?? null);
    setSwindleCount((swindleData as any)?.swindle_entries?.[0]?.count ?? 0);

    if (user) {
      const { data: playerRow } = await supabase
        .from('players').select('id, display_name, avatar_url').eq('auth_uid', user.id).single();
      if (playerRow) {
        const p = playerRow as any;
        setPlayerId(p.id);
        setPlayerName(p.display_name ?? '');
        setAvatarUrl(p.avatar_url ?? null);
        checkUnread(p.id);

        const { data: sm } = await supabase.from('society_members')
          .select('membership_types, role')
          .eq('society_id', SOCIETY_ID)
          .eq('player_id', p.id)
          .single();
        const role = (sm as any)?.role ?? '';
        const priv = role === 'admin' || role === 'owner';
        setIsPrivileged(priv);
        setMemberTypes(priv ? ['casual', 'tour', 'swindle'] : ((sm as any)?.membership_types ?? []));
      }
    }

    setLoading(false);
    setRefreshing(false);
  }, [SOCIETY_ID]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const hasArea = (area: string) =>
    area === 'casual' || isPrivileged || memberTypes.length === 0 || memberTypes.includes(area);

  const tileSub = (key: string, def: string): string => {
    if (key === 'play'     ) return casualCount  > 0 ? `${casualCount} game${casualCount !== 1 ? 's' : ''} in progress` : def;
    if (key === 'events'   ) return tourName      ? tourName      : (tourLive    > 0 ? `${tourLive} matches live`                  : def);
    if (key === 'clubhouse') return swindleName   ? `${swindleName}${swindleCount > 0 ? ` · ${swindleCount} in` : ''}`             : def;
    return def;
  };

  const isLive = (key: string) =>
    (key === 'play' && casualCount > 0) || (key === 'events' && tourLive > 0) || (key === 'clubhouse' && swindleCount > 0);

  const handleTile = (tile: typeof TILES[number]) => {
    if (!hasArea(tile.area)) { router.push('/(app)/join' as any); return; }
    router.push(tile.route as any);
  };

  const avatarSrc = resolveAvatar(playerId ?? '', avatarUrl);

  if (!fontsLoaded) return <View style={s.root} />;

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={s.header}>
        <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
        <View style={s.headerRight}>
          <TouchableOpacity
            onPress={() => router.push('/(app)/chat' as any)}
            style={s.bellBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chatbubble-outline" size={22} color="#ffffff" />
            {unread > 0 && <View style={s.notifDot} />}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/(app)/profile' as any)} activeOpacity={0.85}>
            {avatarSrc
              ? <Image source={avatarSrc} style={s.avatar} />
              : <View style={s.avatarFallback}><Ionicons name="person" size={16} color={GOLD} /></View>
            }
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={s.centered}><ActivityIndicator color={GOLD} size="large" /></View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={GOLD} />}
        >
          {/* ── Greeting ── */}
          <View style={s.greeting}>
            <Text style={s.greetSub}>{greet()}</Text>
            <Text style={s.greetName}>{playerName.split(' ')[0] || 'Golfer'}</Text>
          </View>

          {/* ── Hero image ── */}
          <View style={s.heroWrap}>
            <Image
              source={require('../../assets/hero-course.jpeg')}
              style={s.heroImage}
              resizeMode="cover"
            />
            <View style={s.heroCard}>
              <View style={s.heroCardLeft}>
                <Text style={s.heroCardLabel}>
                  {tourLive > 0 ? 'TOURNAMENT · LIVE' : swindleCount > 0 ? 'SWINDLE · OPEN' : casualCount > 0 ? 'CASUAL · IN PROGRESS' : 'TITAN GOLF'}
                </Text>
                <Text style={s.heroCardTitle}>
                  {tourLive > 0 ? (tourName ?? `${tourLive} matches live`) : swindleCount > 0 ? (swindleName ?? 'Open swindle') : casualCount > 0 ? `${casualCount} game${casualCount !== 1 ? 's' : ''} running` : 'Ready when you are'}
                </Text>
              </View>
              {(tourLive > 0 || swindleCount > 0 || casualCount > 0) && (
                <TouchableOpacity
                  style={s.heroCardBtn}
                  activeOpacity={0.8}
                  onPress={() => {
                    if (tourLive > 0)     router.push('/(app)/tour' as any);
                    else if (swindleCount > 0) router.push('/(app)/swindle' as any);
                    else                  router.push('/(app)/score' as any);
                  }}
                >
                  <Text style={s.heroCardBtnText}>VIEW</Text>
                  <Ionicons name="chevron-forward" size={11} color={GOLD} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* ── 6-tile grid ── */}
          <View style={s.grid}>
            {TILES.map(tile => {
              const locked = !hasArea(tile.area);
              const live   = !locked && isLive(tile.key);
              const sub    = locked ? 'Ask Rick for access' : tileSub(tile.key, tile.sub);
              return (
                <TouchableOpacity
                  key={tile.key}
                  style={[s.tile, locked && s.tileLocked]}
                  onPress={() => handleTile(tile)}
                  activeOpacity={0.75}
                >
                  <View style={[s.tileIcon, locked && s.tileIconLocked]}>
                    <Ionicons
                      name={locked ? 'lock-closed-outline' : tile.icon}
                      size={22}
                      color={locked ? '#444' : GOLD}
                    />
                  </View>
                  <Text style={[s.tileLabel, locked && s.tileLabelLocked]} numberOfLines={1}>
                    {tile.label}
                  </Text>
                  <Text style={s.tileSub} numberOfLines={2}>{sub}</Text>
                  {live && (
                    <View style={s.livePill}>
                      <View style={s.liveDot} />
                      <Text style={s.liveText}>LIVE</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Quick links ── */}
          <View style={s.quickRow}>
            <QuickBtn icon="chatbubbles-outline" label="Chat"        onPress={() => router.push('/(app)/chat' as any)}        badge={unread > 0 ? unread : undefined} />
            <QuickBtn icon="podium-outline"      label="Leaderboard" onPress={() => router.push('/(app)/leaderboard' as any)} />
            <QuickBtn icon="ribbon-outline"      label="Records"     onPress={() => router.push('/(app)/records' as any)}     />
            <QuickBtn icon="bag-outline"         label="Shop"        onPress={() => Linking.openURL('https://titangolf-web.vercel.app/')} />
          </View>

          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </View>
  );
}

function QuickBtn({ icon, label, onPress, badge }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  badge?: number;
}) {
  return (
    <TouchableOpacity style={s.quickBtn} onPress={onPress} activeOpacity={0.8}>
      <Ionicons name={icon} size={20} color={GOLD} />
      <Text style={s.quickLabel}>{label}</Text>
      {badge != null && (
        <View style={s.quickBadge}>
          <Text style={s.quickBadgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#000000' },
  centered:{ flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll:  { paddingHorizontal: 16, paddingBottom: 40 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingHorizontal: 20, paddingBottom: 16,
  },
  headerLogo:    { width: 32, height: 32 },
  headerRight:   { flexDirection: 'row', alignItems: 'center', gap: 16 },
  bellBtn:       { position: 'relative' },
  notifDot: {
    position: 'absolute', top: -2, right: -2,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: GOLD, borderWidth: 1.5, borderColor: '#000',
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 2, borderColor: GOLD,
  },
  avatarFallback: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 2, borderColor: GOLD,
    backgroundColor: '#111111', alignItems: 'center', justifyContent: 'center',
  },

  // Greeting
  greeting: { paddingTop: 4, paddingBottom: 24 },
  greetSub:  { fontFamily: FF,  fontSize: 15, color: '#6b7280' },
  greetName: { fontFamily: FFB, fontSize: 42, color: '#ffffff', lineHeight: 48, letterSpacing: -0.5 },

  // Hero image
  heroWrap: {
    marginBottom: 20, borderRadius: 14, overflow: 'hidden',
    backgroundColor: '#0a0f14',
  },
  heroImage: { width: '100%' as const, height: 200 },
  heroCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.92)',
    paddingHorizontal: 16, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)',
  },
  heroCardLeft:  { gap: 3 },
  heroCardLabel: { fontFamily: FF, fontSize: 9, color: GOLD, letterSpacing: 2 },
  heroCardTitle: { fontFamily: FFB, fontSize: 18, color: '#ffffff' },
  heroCardBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderColor: GOLD, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  heroCardBtnText: { fontFamily: FF, fontSize: 11, color: GOLD, letterSpacing: 0.5 },

  // Tile grid
  grid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  tile: {
    width: TILE_W, backgroundColor: '#111111',
    borderRadius: 14, padding: 16, gap: 6,
    borderWidth: 1, borderColor: '#1c1c1c',
  },
  tileLocked:     { opacity: 0.45 },
  tileIcon: {
    width: 44, height: 44, borderRadius: 12,
    borderWidth: 1, borderColor: `${GOLD}35`,
    backgroundColor: `${GOLD}0d`,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  tileIconLocked: { borderColor: '#333', backgroundColor: 'transparent' },
  tileLabel:       { fontFamily: FFB, fontSize: 15, color: '#ffffff', letterSpacing: -0.2 },
  tileLabelLocked: { color: '#555' },
  tileSub:         { fontFamily: FF,  fontSize: 11, color: '#6b7280', lineHeight: 15 },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, alignSelf: 'flex-start',
    backgroundColor: `${GREEN}12`, paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 20, borderWidth: 1, borderColor: `${GREEN}30`,
  },
  liveDot:  { width: 5, height: 5, borderRadius: 3, backgroundColor: GREEN },
  liveText: { fontFamily: FFB, fontSize: 9, color: GREEN, letterSpacing: 1 },

  // Quick links
  quickRow: { flexDirection: 'row', gap: 8 },
  quickBtn: {
    flex: 1, backgroundColor: '#111111', borderRadius: 12,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingVertical: 14, alignItems: 'center', gap: 5,
    position: 'relative',
  },
  quickLabel:    { fontFamily: FF, fontSize: 10, color: '#6b7280', letterSpacing: 0.3 },
  quickBadge: {
    position: 'absolute', top: 6, right: 6,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  quickBadgeText: { fontFamily: FFB, fontSize: 9, color: '#000' },
});
