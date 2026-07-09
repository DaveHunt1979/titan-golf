/**
 * Concept Preview — TITAN premium Locker Room screen
 * Accessible from Admin → Concept Preview (Locker Room)
 */
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Image, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useSocietyTheme } from '../../../src/lib/SocietyThemeContext';

const GOLD   = '#D4AF37';
const GREEN  = '#22c55e';
const { width: SCREEN_W } = Dimensions.get('window');

type Club = {
  id: string;
  name: string;
  short_name: string;
  nfc_tag_id: string | null;
  in_bag: boolean;
  sort_order: number;
  brand: string | null;
  model: string | null;
};

function shortNfc(raw: string): string {
  return 'NFC-' + raw.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase();
}

function lastSyncedLabel(clubs: Club[]): string {
  const tagged = clubs.filter(c => c.nfc_tag_id);
  if (tagged.length === 0) return 'No tags linked';
  return 'All up to date';
}

export default function ConceptLockerScreen() {
  const { societyId } = useSocietyTheme();
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
  });

  const [playerName,  setPlayerName]  = useState('');
  const [nickname,    setNickname]    = useState<string | null>(null);
  const [avatarUrl,   setAvatarUrl]   = useState<string | null>(null);
  const [initials,    setInitials]    = useState('?');
  const [handicap,    setHandicap]    = useState<number | null>(null);
  const [clubs,       setClubs]       = useState<Club[]>([]);
  const [notifCount,  setNotifCount]  = useState(0);
  const [loading,     setLoading]     = useState(true);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: player } = await supabase
      .from('players')
      .select('id, display_name, avatar_url, handicap_index, nickname')
      .eq('auth_uid', user.id)
      .maybeSingle();

    if (player) {
      const p = player as any;
      setPlayerName(p.display_name ?? '');
      setNickname(p.nickname ?? null);
      setInitials((p.display_name ?? '?').charAt(0).toUpperCase());
      setAvatarUrl(p.avatar_url ?? null);
      setHandicap(p.handicap_index ?? null);

      const { data: clubRows } = await supabase
        .from('clubs')
        .select('*')
        .eq('player_id', p.id)
        .order('sort_order');
      setClubs((clubRows ?? []) as Club[]);
    }

    const { data: notifs } = await supabase
      .from('notifications').select('id').limit(5);
    setNotifCount((notifs as any)?.length ?? 0);

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const bagClubs  = clubs.filter(c => c.in_bag);
  const tagged    = clubs.filter(c => c.nfc_tag_id);
  const isReady   = fontsLoaded && !loading;

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={s.headerSide}
        >
          <Ionicons name="chevron-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image
            source={require('../../../assets/TitanAppLogo.png')}
            style={s.headerLogo}
            resizeMode="contain"
          />
        </View>
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
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

          {/* ── Page title ── */}
          <Text style={s.pageTitle}>Locker Room</Text>

          {/* ── Profile card ── */}
          <View style={s.profileCard}>
            {/* Avatar */}
            <View style={s.avatarWrap}>
              {avatarUrl
                ? <Image source={{ uri: avatarUrl }} style={s.avatarImg} />
                : (
                  <View style={s.avatarPlaceholder}>
                    <Text style={s.avatarInitial}>{initials}</Text>
                  </View>
                )
              }
              <View style={s.avatarRing} />
            </View>

            {/* Info */}
            <View style={s.profileInfo}>
              <Text style={s.profileName}>{playerName || 'Golfer'}</Text>
              <View style={s.badgeRow}>
                <View style={s.eliteDot} />
                <Text style={s.eliteText}>{nickname ?? 'Elite'}</Text>
              </View>
              <View style={s.statsRow}>
                <View style={s.statBox}>
                  <Text style={s.statLabel}>HANDICAP</Text>
                  <Text style={s.statValue}>
                    {handicap != null ? String(handicap) : '—'}
                  </Text>
                </View>
                <View style={s.statDivider} />
                <View style={s.statBox}>
                  <Text style={s.statLabel}>CLUBS LINKED</Text>
                  <Text style={s.statValue}>{bagClubs.length} clubs linked</Text>
                </View>
              </View>
            </View>
          </View>

          {/* ── My Bag header ── */}
          <View style={s.bagHeader}>
            <View>
              <Text style={s.bagTitle}>My Bag</Text>
              <Text style={s.bagSubtitle}>Clubs and assigned NFC tags</Text>
            </View>
            <TouchableOpacity
              style={s.addClubBtn}
              onPress={() => router.push('/(app)/profile/bag' as any)}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={14} color={GOLD} />
              <Text style={s.addClubText}>Add Club</Text>
            </TouchableOpacity>
          </View>

          {/* ── Club rows ── */}
          <View style={s.clubList}>
            {bagClubs.length === 0 ? (
              <View style={s.emptyBag}>
                <Text style={s.emptyBagText}>No clubs in your bag yet</Text>
              </View>
            ) : (
              bagClubs.map((club, idx) => (
                <TouchableOpacity
                  key={club.id}
                  style={[s.clubRow, idx === bagClubs.length - 1 && s.clubRowLast]}
                  onPress={() => router.push('/(app)/profile/bag' as any)}
                  activeOpacity={0.7}
                >
                  {/* Icon */}
                  <View style={s.clubIconWrap}>
                    <Ionicons name="golf-outline" size={16} color={GOLD} />
                  </View>

                  {/* Name */}
                  <Text style={s.clubName}>{club.name}</Text>

                  {/* NFC badge */}
                  <View style={s.clubRight}>
                    {club.nfc_tag_id ? (
                      <View style={s.nfcBadge}>
                        <Text style={s.nfcText}>{shortNfc(club.nfc_tag_id)}</Text>
                      </View>
                    ) : (
                      <View style={s.nfcBadgeEmpty}>
                        <Text style={s.nfcTextEmpty}>UNLINKED</Text>
                      </View>
                    )}
                    <Ionicons name="chevron-forward" size={14} color="#444" style={{ marginLeft: 8 }} />
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>

          {/* ── Quick links ── */}
          <View style={s.quickLinks}>
            <TouchableOpacity
              style={s.quickLink}
              onPress={() => router.push('/(app)/admin/concept-stats' as any)}
              activeOpacity={0.75}
            >
              <View style={s.quickLinkLeft}>
                <View style={s.quickLinkIcon}>
                  <Ionicons name="bar-chart-outline" size={18} color={GOLD} />
                </View>
                <View>
                  <Text style={s.quickLinkTitle}>My Stats</Text>
                  <Text style={s.quickLinkSub}>Scoring, drives, putting & distances</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#444" />
            </TouchableOpacity>
            <View style={s.quickLinkDivider} />
            <TouchableOpacity
              style={s.quickLink}
              onPress={() => router.push('/(app)/profile/rounds' as any)}
              activeOpacity={0.75}
            >
              <View style={s.quickLinkLeft}>
                <View style={s.quickLinkIcon}>
                  <Ionicons name="golf-outline" size={18} color={GOLD} />
                </View>
                <View>
                  <Text style={s.quickLinkTitle}>Round History</Text>
                  <Text style={s.quickLinkSub}>All your past rounds & scores</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#444" />
            </TouchableOpacity>
            <View style={s.quickLinkDivider} />
            <TouchableOpacity
              style={s.quickLink}
              onPress={() => router.push('/(app)/profile/handicap' as any)}
              activeOpacity={0.75}
            >
              <View style={s.quickLinkLeft}>
                <View style={s.quickLinkIcon}>
                  <Ionicons name="trending-down-outline" size={18} color={GOLD} />
                </View>
                <View>
                  <Text style={s.quickLinkTitle}>Handicap Calculator</Text>
                  <Text style={s.quickLinkSub}>Recalculate your index</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#444" />
            </TouchableOpacity>
          </View>

          {/* ── Bottom stats bar ── */}
          <View style={s.statsBar}>
            <View style={s.statsCol}>
              <Ionicons name="sync-outline" size={18} color={GREEN} />
              <Text style={s.statsColLabel}>TAGS SYNCED</Text>
              <Text style={s.statsColValue}>{lastSyncedLabel(clubs)}</Text>
            </View>
            <View style={s.statsColDivider} />
            <View style={s.statsCol}>
              <Ionicons name="time-outline" size={18} color={GOLD} />
              <Text style={s.statsColLabel}>LAST UPDATED</Text>
              <Text style={s.statsColValue}>
                {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
            <View style={s.statsColDivider} />
            <View style={s.statsCol}>
              <Ionicons name="checkmark-circle-outline" size={18} color={GOLD} />
              <Text style={s.statsColLabel}>ACTIVE TAGS</Text>
              <Text style={s.statsColValue}>{tagged.length}/{bagClubs.length} Active</Text>
            </View>
          </View>

          {/* Watermark */}
          <View style={s.watermark}>
            <Text style={s.watermarkText}>CONCEPT PREVIEW · NOT LIVE</Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────
const FF = 'JUSTSans';

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#000000' },
  centered:{ flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll:  { paddingBottom: 48 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12,
    backgroundColor: '#000000',
  },
  headerSide:   { width: 40 },
  headerCenter: { alignItems: 'center' },
  headerLogo:   { width: 36, height: 36 },
  bellWrap:     { position: 'relative' },
  notifDot: {
    position: 'absolute', top: -1, right: -1,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: GOLD, borderWidth: 1.5, borderColor: '#000',
  },

  // Page title
  pageTitle: {
    fontFamily: FF, fontSize: 36, color: '#ffffff',
    paddingHorizontal: 20, paddingBottom: 20,
    letterSpacing: -0.5,
  },

  // Profile card
  profileCard: {
    marginHorizontal: 16,
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1c1c1c',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 16,
    marginBottom: 28,
  },
  avatarWrap:       { position: 'relative' },
  avatarImg:        { width: 72, height: 72, borderRadius: 36 },
  avatarPlaceholder:{
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: `${GOLD}18`, alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial:    { fontFamily: FF, fontSize: 28, color: GOLD },
  avatarRing: {
    position: 'absolute', top: -2, left: -2,
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 1.5, borderColor: `${GOLD}50`,
  },

  profileInfo:  { flex: 1, gap: 6 },
  profileName:  { fontFamily: FF, fontSize: 20, color: '#ffffff', letterSpacing: -0.3 },
  badgeRow:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eliteDot:     { width: 7, height: 7, borderRadius: 4, backgroundColor: GREEN },
  eliteText:    { fontFamily: FF, fontSize: 12, color: GREEN },

  statsRow:     { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  statBox:      { flex: 1, gap: 2 },
  statDivider:  { width: 1, height: 28, backgroundColor: '#2c2c2c', marginHorizontal: 12 },
  statLabel:    { fontFamily: FF, fontSize: 9, color: '#6b7280', letterSpacing: 1.5 },
  statValue:    { fontFamily: FF, fontSize: 13, color: '#ffffff' },

  // My Bag header
  bagHeader: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: 16, marginBottom: 12,
  },
  bagTitle:    { fontFamily: FF, fontSize: 18, color: '#ffffff', marginBottom: 2 },
  bagSubtitle: { fontFamily: FF, fontSize: 11, color: '#6b7280' },
  addClubBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: GOLD, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  addClubText: { fontFamily: FF, fontSize: 12, color: GOLD },

  // Club list
  clubList: {
    marginHorizontal: 16,
    backgroundColor: '#111111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1c1c1c',
    overflow: 'hidden',
    marginBottom: 20,
  },
  clubRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
    gap: 12,
  },
  clubRowLast: { borderBottomWidth: 0 },
  clubIconWrap: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: `${GOLD}0d`,
    borderWidth: 1, borderColor: `${GOLD}25`,
    alignItems: 'center', justifyContent: 'center',
  },
  clubName:  { flex: 1, fontFamily: FF, fontSize: 15, color: '#ffffff' },
  clubRight: { flexDirection: 'row', alignItems: 'center' },
  nfcBadge: {
    borderWidth: 1, borderColor: `${GOLD}60`,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: `${GOLD}0d`,
  },
  nfcText:      { fontFamily: FF, fontSize: 11, color: GOLD, letterSpacing: 0.5 },
  nfcBadgeEmpty:{
    borderWidth: 1, borderColor: '#333',
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
  },
  nfcTextEmpty: { fontFamily: FF, fontSize: 10, color: '#444', letterSpacing: 0.5 },
  emptyBag:     { padding: 24, alignItems: 'center' },
  emptyBagText: { fontFamily: FF, fontSize: 13, color: '#6b7280' },

  // Quick links
  quickLinks: {
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden',
  },
  quickLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 14,
  },
  quickLinkLeft:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  quickLinkIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: `${GOLD}0d`, borderWidth: 1, borderColor: `${GOLD}25`,
    alignItems: 'center', justifyContent: 'center',
  },
  quickLinkTitle:   { fontFamily: FF, fontSize: 14, color: '#ffffff', marginBottom: 2 },
  quickLinkSub:     { fontFamily: FF, fontSize: 11, color: '#6b7280' },
  quickLinkDivider: { height: 1, backgroundColor: '#1c1c1c', marginHorizontal: 14 },

  // Stats bar
  statsBar: {
    marginHorizontal: 16,
    backgroundColor: '#111111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1c1c1c',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    marginBottom: 24,
  },
  statsCol: {
    flex: 1, alignItems: 'center', gap: 4,
  },
  statsColDivider: {
    width: 1, height: 36, backgroundColor: '#1c1c1c',
  },
  statsColLabel: { fontFamily: FF, fontSize: 9, color: '#6b7280', letterSpacing: 1.5, marginTop: 4 },
  statsColValue: { fontFamily: FF, fontSize: 12, color: '#ffffff' },

  // Watermark
  watermark:     { alignItems: 'center', paddingVertical: 16 },
  watermarkText: { fontFamily: FF, fontSize: 10, color: '#2a2a2a', letterSpacing: 2 },
});
