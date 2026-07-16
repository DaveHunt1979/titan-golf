import { useCallback, useEffect, useRef, useState } from 'react';
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
import { useSocietyTheme, useDynamicColors } from '../../src/lib/SocietyThemeContext';

const GOLD = '#D4AF37'; // fallback for StyleSheet only — JSX uses dc.gold
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
  { key: 'play',      label: 'Play',        sub: 'Start a casual round',        icon: 'golf-outline'   as const, area: 'casual',  route: '/(app)/score'   },
  { key: 'events',    label: 'Events',       sub: 'Tournaments & leagues',        icon: 'trophy-outline' as const, area: 'tour',    route: '/(app)/tour'    },
  { key: 'clubhouse', label: 'Clubhouse',    sub: 'Swindles & roll-ups',          icon: 'people-outline' as const, area: 'swindle', route: '/(app)/swindle' },
  { key: 'locker',    label: 'Locker Room',  sub: 'Stats, handicap & equipment',  icon: 'shield-outline' as const, area: 'casual',  route: '/(app)/profile' },
] as const;

type FriendRound = { playerId: string; name: string; courseName: string; hole: number; pts: number; matchId: string; };

export default function HomeScreen() {
  const router = useRouter();
  const { societyId: SOCIETY_ID, localLogo, logoUrl, societyName } = useSocietyTheme();
  const dc = useDynamicColors();

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [loading,        setLoading]        = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);
  const [playerName,     setPlayerName]     = useState('');
  const [avatarUrl,      setAvatarUrl]      = useState<string | null>(null);
  const [playerId,       setPlayerId]       = useState<string | null>(null);
  const [handicapIndex,  setHandicapIndex]  = useState<number | null>(null);
  const [memberTypes,    setMemberTypes]    = useState<string[]>([]);
  const [isPrivileged,   setIsPrivileged]   = useState(false);
  const [unread,         setUnread]         = useState(0);
  const [casualCount,    setCasualCount]    = useState(0);
  const [tourName,       setTourName]       = useState<string | null>(null);
  const [tourLive,       setTourLive]       = useState(0);
  const [swindleName,    setSwindleName]    = useState<string | null>(null);
  const [swindleCount,   setSwindleCount]   = useState(0);
  const [friendRounds,   setFriendRounds]   = useState<FriendRound[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  useFocusEffect(useCallback(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); }, []));

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

    // Get player row first so we can filter matches to this player only
    let pid: string | null = null;
    if (user) {
      const { data: pr } = await supabase.from('players').select('id, display_name, avatar_url, handicap_index').eq('auth_uid', user.id).single();
      if (pr) {
        const p = pr as any;
        pid = p.id;
        setPlayerId(p.id);
        setPlayerName(p.display_name ?? '');
        setAvatarUrl(p.avatar_url ?? null);
        setHandicapIndex(p.handicap_index ?? null);
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

    const casualQuery = pid
      ? supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'in_progress').is('competition_id', null).contains('home_player_ids', [pid])
      : supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'in_progress').is('competition_id', null).eq('id', 'none');

    const [
      { data: comp },
      { count: casual },
      { count: tourCount },
      { data: swindleData },
    ] = await Promise.all([
      supabase.from('competitions').select('id,name').eq('status', 'active').neq('format', 'casual').limit(1).single(),
      casualQuery,
      supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'in_progress').not('competition_id', 'is', null),
      supabase.from('swindle_games').select('name,swindle_entries(count)').eq('status', 'open').order('created_at', { ascending: false }).limit(1).single(),
    ]);

    setCasualCount(casual ?? 0);
    setTourName((comp as any)?.name ?? null);
    setTourLive(tourCount ?? 0);
    setSwindleName((swindleData as any)?.name ?? null);
    setSwindleCount((swindleData as any)?.swindle_entries?.[0]?.count ?? 0);

    // Friends on a round
    if (pid && SOCIETY_ID) {
      const { data: memberRows } = await supabase
        .from('society_members').select('player_id')
        .eq('society_id', SOCIETY_ID).neq('player_id', pid);
      const memberIds = (memberRows ?? []).map((m: any) => m.player_id as string);

      if (memberIds.length > 0) {
        const { data: activeMatches } = await supabase
          .from('matches').select('id,course_name,home_player_ids,away_player_ids')
          .eq('status', 'in_progress').limit(50);

        const friendMatches = (activeMatches ?? []).filter((m: any) => {
          const ids: string[] = [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])];
          return ids.some(id => memberIds.includes(id));
        });

        if (friendMatches.length > 0) {
          const matchIds = friendMatches.map((m: any) => m.id);
          const playingFriendIds = [...new Set(
            friendMatches.flatMap((m: any): string[] => [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])])
              .filter((id: string) => memberIds.includes(id))
          )];

          const [{ data: holesData }, { data: friendPlayersData }] = await Promise.all([
            supabase.from('match_holes').select('player_id,stableford_pts,hole_number,match_id').in('match_id', matchIds),
            supabase.from('players').select('id,display_name').in('id', playingFriendIds),
          ]);

          const nameMap: Record<string, string> = {};
          for (const p of (friendPlayersData ?? []) as any[]) nameMap[p.id] = p.display_name;

          const stats: Record<string, { pts: number; maxHole: number }> = {};
          for (const h of (holesData ?? []) as any[]) {
            if (playingFriendIds.includes(h.player_id)) {
              if (!stats[h.player_id]) stats[h.player_id] = { pts: 0, maxHole: 0 };
              stats[h.player_id].pts += h.stableford_pts ?? 0;
              if (h.hole_number > stats[h.player_id].maxHole) stats[h.player_id].maxHole = h.hole_number;
            }
          }

          setFriendRounds(playingFriendIds.map(id => {
            const match = friendMatches.find((m: any) => {
              const ids: string[] = [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])];
              return ids.includes(id);
            });
            return {
              playerId: id,
              name: nameMap[id] ?? 'Unknown',
              courseName: match?.course_name ?? 'Course',
              hole: Math.min((stats[id]?.maxHole ?? 0) + 1, 18),
              pts: stats[id]?.pts ?? 0,
              matchId: match?.id ?? '',
            };
          }));
        } else {
          setFriendRounds([]);
        }
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
    <View style={[s.root, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={[s.header, { justifyContent: 'flex-end' }]}>
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
              ? <Image source={avatarSrc} style={[s.avatar, { borderColor: dc.gold }]} />
              : <View style={[s.avatarFallback, { borderColor: dc.gold }]}><Ionicons name="person" size={16} color={dc.gold} /></View>
            }
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={s.centered}><ActivityIndicator color={dc.gold} size="large" /></View>
      ) : (
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={dc.gold} />}
        >
          {/* ── Greeting ── */}
          <View style={s.greeting}>
            <Text style={s.greetSub}>{greet()}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={s.greetName}>{playerName.split(' ')[0] || 'Golfer'}</Text>
              {handicapIndex != null && (
                <View style={s.hcpChip}>
                  <Text style={s.hcpLabel}>HCP</Text>
                  <Text style={s.hcpValue}>{handicapIndex % 1 === 0 ? handicapIndex.toFixed(0) : handicapIndex.toFixed(1)}</Text>
                </View>
              )}
            </View>
          </View>

          {/* ── Hero ── */}
          <View style={s.heroWrap}>
            <View style={[s.heroLogoSection, { backgroundColor: dc.bg }]}>
              <Image
                source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)}
                style={s.heroSocietyLogo}
                resizeMode="cover"
              />
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
                  style={[s.tile, { backgroundColor: dc.card, borderColor: dc.border }, locked && s.tileLocked]}
                  onPress={() => handleTile(tile)}
                  activeOpacity={0.75}
                >
                  <View style={[
                    s.tileIcon,
                    { backgroundColor: locked ? 'transparent' : dc.iconBoxBg, borderColor: locked ? '#333' : dc.iconBoxBorder },
                  ]}>
                    <Ionicons
                      name={locked ? 'lock-closed-outline' : tile.icon}
                      size={22}
                      color={locked ? '#444' : dc.iconBoxIcon}
                    />
                  </View>
                  <Text style={[s.tileLabel, { color: dc.cardText }, locked && s.tileLabelLocked]} numberOfLines={1}>
                    {tile.label}
                  </Text>
                  <Text style={[s.tileSub, { color: dc.textSecondary }]} numberOfLines={2}>{sub}</Text>
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

          {/* ── Friends on a Round ── */}
          <View style={{ marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text style={[s.sectionTitle, { marginBottom: 0 }]}>FRIENDS ON A ROUND</Text>
              <TouchableOpacity onPress={() => router.push('/(app)/friends' as any)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ fontFamily: 'JUSTSans-ExBold', fontSize: 9, color: GOLD, letterSpacing: 1 }}>SEE ALL →</Text>
              </TouchableOpacity>
            </View>
            {friendRounds.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
                {friendRounds.map(fr => (
                  <TouchableOpacity
                    key={fr.playerId}
                    style={[s.friendCard, { backgroundColor: dc.card, borderColor: dc.border }]}
                    onPress={() => router.push(`/(app)/score/${fr.matchId}` as any)}
                    activeOpacity={0.8}
                  >
                    <View style={s.friendAvatar}>
                      <Text style={s.friendAvatarText}>{(fr.name[0] ?? '?').toUpperCase()}</Text>
                    </View>
                    <Text style={[s.friendName, { color: dc.cardText }]} numberOfLines={1}>{fr.name.split(' ')[0]}</Text>
                    <Text style={s.friendCourse} numberOfLines={1}>{fr.courseName}</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                      <View style={s.holeChip}>
                        <Text style={s.holeChipText}>Hole {fr.hole}</Text>
                      </View>
                      <Text style={[s.friendPts, { color: dc.gold }]}>{fr.pts}<Text style={s.friendPtsLabel}> pts</Text></Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <TouchableOpacity
                style={[s.noFriendsCard, { backgroundColor: dc.card, borderColor: dc.border }]}
                onPress={() => router.push('/(app)/friends' as any)}
                activeOpacity={0.8}
              >
                <Text style={s.noFriendsText}>No friends on a round at this time</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                  <Text style={s.noFriendsSub}>View all members</Text>
                  <Ionicons name="chevron-forward" size={11} color="#555" />
                </View>
              </TouchableOpacity>
            )}
          </View>

          {/* ── Quick links ── */}
          <View style={s.quickRow}>
            <QuickBtn icon="chatbubbles-outline" label="Chat"    cardBg={dc.card} iconColor={dc.iconBoxIcon} textColor={dc.cardText} onPress={() => router.push('/(app)/chat' as any)}    badge={unread > 0 ? unread : undefined} badgeColor={dc.gold} />
            <QuickBtn icon="ribbon-outline"      label="Records" cardBg={dc.card} iconColor={dc.iconBoxIcon} textColor={dc.cardText} onPress={() => router.push('/(app)/records' as any)} />
            <QuickBtn icon="time-outline"        label="History" cardBg={dc.card} iconColor={dc.iconBoxIcon} textColor={dc.cardText} onPress={() => router.push('/(app)/profile/rounds' as any)} />
            <QuickBtn icon="bag-outline"         label="Shop"    cardBg={dc.card} iconColor={dc.iconBoxIcon} textColor={dc.cardText} onPress={() => Linking.openURL('https://titangolf-web.vercel.app/')} />
          </View>

          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </View>
  );
}

function QuickBtn({ icon, label, cardBg, iconColor, textColor, onPress, badge, badgeColor }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  cardBg: string;
  iconColor: string;
  textColor: string;
  onPress: () => void;
  badge?: number;
  badgeColor?: string;
}) {
  return (
    <TouchableOpacity style={[s.quickBtn, { backgroundColor: cardBg }]} onPress={onPress} activeOpacity={0.8}>
      <Ionicons name={icon} size={20} color={iconColor} />
      <Text style={[s.quickLabel, { color: textColor }]}>{label}</Text>
      {badge != null && (
        <View style={[s.quickBadge, { backgroundColor: badgeColor ?? iconColor }]}>
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
  greetSub:  { fontFamily: FFB,  fontSize: 15, color: '#fff' },
  greetName: { fontFamily: FFB, fontSize: 42, color: '#ffffff', lineHeight: 48, letterSpacing: -0.5 },

  // Hero
  heroWrap: {
    marginBottom: 20, borderRadius: 14, overflow: 'hidden',
    backgroundColor: '#0a0f14',
  },
  heroLogoSection: {
    paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
  },
  heroSocietyLogo: { width: '100%' as const, height: 160 },

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
  tileLabelLocked: { color: '#fff' },
  tileSub:         { fontFamily: FFB,  fontSize: 11, color: '#fff', lineHeight: 15 },
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
  quickLabel:    { fontFamily: FFB, fontSize: 10, color: '#fff', letterSpacing: 0.3 },
  quickBadge: {
    position: 'absolute', top: 6, right: 6,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  quickBadgeText: { fontFamily: FFB, fontSize: 9, color: '#000' },

  // HCP chip
  hcpChip:  { backgroundColor: `${GOLD}15`, borderWidth: 1, borderColor: `${GOLD}40`, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, alignItems: 'center' },
  hcpLabel: { fontFamily: FFB, fontSize: 8, color: GOLD, letterSpacing: 1.5 },
  hcpValue: { fontFamily: FFB, fontSize: 16, color: GOLD, lineHeight: 18 },

  // Friends on a round
  sectionTitle:    { fontFamily: FFB, fontSize: 10, color: '#888', letterSpacing: 1.5, marginBottom: 10 },
  friendCard:      { width: 140, borderRadius: 14, borderWidth: 1, padding: 12 },
  friendAvatar:    { width: 36, height: 36, borderRadius: 18, backgroundColor: `${GOLD}15`, borderWidth: 1, borderColor: `${GOLD}30`, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  friendAvatarText:{ fontFamily: FFB, fontSize: 15, color: GOLD },
  friendName:      { fontFamily: FFB, fontSize: 13, color: '#fff' },
  friendCourse:    { fontFamily: FFB, fontSize: 10, color: '#666', marginTop: 1 },
  holeChip:        { backgroundColor: '#1c1c1c', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  holeChipText:    { fontFamily: FFB, fontSize: 9, color: '#888', letterSpacing: 0.5 },
  friendPts:       { fontFamily: FFB, fontSize: 15, color: GOLD },
  friendPtsLabel:  { fontFamily: FFB, fontSize: 9, color: '#555' },

  noFriendsCard:   { borderRadius: 14, borderWidth: 1, padding: 14 },
  noFriendsText:   { fontFamily: FFB, fontSize: 13, color: '#555' },
  noFriendsSub:    { fontFamily: FFB, fontSize: 10, color: '#444' },
});
