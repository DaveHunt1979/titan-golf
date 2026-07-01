import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, Image, ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../src/lib/supabase';
import { fonts, spacing, radius } from '../../src/lib/theme';
import { titanLogo } from '../../src/lib/assets';
import { useSocietyTheme, type ThemePalette } from '../../src/lib/SocietyThemeContext';
import type { Competition } from '../../src/types';

const CHAT_READ_KEY = 'chat_last_read';

export default function HomeScreen() {
  const router = useRouter();
  const { logoUrl, localLogo, societyName, palette } = useSocietyTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const [competition, setCompetition] = useState<Competition | null>(null);
  const [liveCount, setLiveCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [unread, setUnread] = useState(0);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: comp }, { data: { user } }] = await Promise.all([
        supabase.from('competitions').select('*').eq('status', 'active').neq('format', 'casual').order('created_at', { ascending: false }).limit(1).single(),
        supabase.auth.getUser(),
      ]);

      if (comp) {
        setCompetition(comp as Competition);
        const { count } = await supabase
          .from('matches')
          .select('*', { count: 'exact', head: true })
          .eq('competition_id', comp.id)
          .eq('status', 'in_progress');
        setLiveCount(count ?? 0);
      }

      if (user) {
        const { data: player } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
        if (player) setMyPlayerId((player as any).id);
      }

      setLoading(false);
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      checkUnread();
    }, [myPlayerId])
  );

  async function checkUnread() {
    const lastRead = await AsyncStorage.getItem(CHAT_READ_KEY);
    const since = lastRead ?? new Date(0).toISOString();
    let q = supabase.from('messages').select('*', { count: 'exact', head: true }).gt('created_at', since);
    if (myPlayerId) q = q.neq('player_id', myPlayerId);
    const { count } = await q;
    setUnread(count ?? 0);
  }

  useEffect(() => {
    const sub = supabase
      .channel('home-chat-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        if ((payload.new as any).player_id !== myPlayerId) {
          setUnread(prev => prev + 1);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [myPlayerId]);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View>
          <Text style={styles.society}>{societyName.toUpperCase()}</Text>
          <Text style={styles.season}>Season 2027</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.chatBtn}
            onPress={() => router.push('/(app)/range' as any)}
            activeOpacity={0.75}
          >
            <Text style={styles.chatBtnIcon}>🏌️</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.chatBtn}
            onPress={() => router.push('/(app)/chat' as any)}
            activeOpacity={0.75}
          >
            <Text style={styles.chatBtnIcon}>💬</Text>
            {unread > 0 && <View style={styles.unreadDot} />}
          </TouchableOpacity>
          <Image
            source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {loading && (
          <View style={styles.heroSkeleton}>
            <ActivityIndicator color={palette.accent} />
          </View>
        )}

        {!loading && competition && (
          <TouchableOpacity
            style={styles.tourHero}
            onPress={() => router.push('/(app)/tour' as any)}
            activeOpacity={0.85}
          >
            <View style={styles.tourHeroTop}>
              <View style={styles.livePill}>
                <View style={styles.liveDot} />
                <Text style={styles.livePillText}>LIVE</Text>
              </View>
              <Text style={styles.tourHeroLabel}>ACTIVE COMPETITION</Text>
            </View>
            <Text style={styles.tourHeroName}>{competition.name}</Text>
            <Text style={styles.tourHeroSub}>
              {liveCount > 0
                ? `${liveCount} match${liveCount !== 1 ? 'es' : ''} in progress`
                : 'View schedule and team standings'}
            </Text>
            <Text style={styles.tourHeroArrow}>View Tournament →</Text>
          </TouchableOpacity>
        )}

        {!loading && !competition && (
          <TouchableOpacity
            style={styles.tourHeroEmpty}
            onPress={() => router.push('/(app)/admin/build' as any)}
            activeOpacity={0.85}
          >
            <Text style={styles.tourEmptyTitle}>No Active Competition</Text>
            <Text style={styles.tourEmptySub}>Build your society's next tournament</Text>
            <Text style={styles.tourHeroArrow}>Build Tournament →</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.sectionLabel}>QUICK PLAY</Text>
        <View style={styles.grid}>
          <TouchableOpacity
            style={[styles.gridCard, styles.gridCardAccent]}
            onPress={() => router.push('/(app)/games/new' as any)}
            activeOpacity={0.8}
          >
            <Text style={[styles.gridTitle, { color: palette.bg }]}>+ New Game</Text>
            <Text style={[styles.gridSub, { color: palette.bg, opacity: 0.6 }]}>Start a casual round</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.gridCard}
            onPress={() => router.push('/(app)/score' as any)}
            activeOpacity={0.8}
          >
            <Text style={styles.gridTitle}>Matches</Text>
            <Text style={styles.gridSub}>Live & recent</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.grid}>
          <TouchableOpacity
            style={styles.gridCard}
            onPress={() => router.push('/(app)/tour' as any)}
            activeOpacity={0.8}
          >
            <Text style={styles.gridTitle}>Tour</Text>
            <Text style={styles.gridSub}>Days & schedule</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.gridCard}
            onPress={() => router.push('/(app)/leaderboard' as any)}
            activeOpacity={0.8}
          >
            <Text style={styles.gridTitle}>Standings</Text>
            <Text style={styles.gridSub}>Teams & Kronos</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>PRACTICE & ON-COURSE</Text>
        <TouchableOpacity
          style={styles.toolCard}
          onPress={() => router.push('/(app)/rangefinder' as any)}
          activeOpacity={0.8}
        >
          <View style={styles.toolLeft}>
            <Text style={styles.toolTitle}>📍 Rangefinder</Text>
            <Text style={styles.toolSub}>Front · Centre · Back · Wind · Elevation · Live GPS</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.toolCard}
          onPress={() => router.push('/(app)/range' as any)}
          activeOpacity={0.8}
        >
          <View style={styles.toolLeft}>
            <Text style={styles.toolTitle}>🏌️ Driving Range</Text>
            <Text style={styles.toolSub}>Log shots · Track distances · Build your bag profile</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>SOCIETY TOOLS</Text>
        <TouchableOpacity
          style={styles.toolCard}
          onPress={() => router.push('/(app)/admin/build' as any)}
          activeOpacity={0.8}
        >
          <View style={styles.toolLeft}>
            <Text style={styles.toolTitle}>Build a Tournament</Text>
            <Text style={styles.toolSub}>Ryder Cup · League · Multi-team · Custom</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.toolCard}
          onPress={() => router.push('/(app)/admin' as any)}
          activeOpacity={0.8}
        >
          <View style={styles.toolLeft}>
            <Text style={styles.toolTitle}>Society Admin</Text>
            <Text style={styles.toolSub}>Players · Teams · Seasons</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

function makeStyles(p: ThemePalette) {
  return StyleSheet.create({
    container:     { flex: 1, backgroundColor: p.bg },
    header: {
      paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg,
      borderBottomWidth: 1, borderBottomColor: p.border,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    society:       { fontSize: fonts.xs, fontWeight: '800', color: p.accent, letterSpacing: 2 },
    season:        { fontSize: fonts.xl, fontWeight: '800', color: p.text, marginTop: 4 },
    logo:          { width: 52, height: 52 },
    headerRight:   { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    chatBtn:       { padding: spacing.xs },
    chatBtnIcon:   { fontSize: 24 },
    unreadDot: {
      position: 'absolute', top: 0, right: 0,
      width: 11, height: 11, borderRadius: 6,
      backgroundColor: p.accent, borderWidth: 2, borderColor: p.bg,
    },
    scroll:        { padding: spacing.md, paddingBottom: 48 },
    heroSkeleton: {
      height: 140, backgroundColor: p.card, borderRadius: radius.lg,
      alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg,
      borderWidth: 1, borderColor: p.border,
    },
    tourHero: {
      backgroundColor: p.card, borderRadius: radius.lg, padding: spacing.lg,
      marginBottom: spacing.lg, borderWidth: 1, borderColor: p.goldBorder,
    },
    tourHeroEmpty: {
      backgroundColor: p.card, borderRadius: radius.lg, padding: spacing.lg,
      marginBottom: spacing.lg, borderWidth: 1, borderColor: p.border, borderStyle: 'dashed',
    },
    tourHeroTop:   { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    livePill: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      backgroundColor: 'rgba(34,197,94,0.12)', paddingHorizontal: 10, paddingVertical: 3,
      borderRadius: radius.full, borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)',
    },
    liveDot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
    livePillText:  { fontSize: fonts.xs, fontWeight: '700', color: '#22c55e', letterSpacing: 1 },
    tourHeroLabel: { fontSize: fonts.xs, fontWeight: '700', color: p.textMuted, letterSpacing: 1.5 },
    tourHeroName:  { fontSize: fonts.xl, fontWeight: '800', color: p.text, marginBottom: 4 },
    tourHeroSub:   { fontSize: fonts.sm, color: p.textSecondary, marginBottom: spacing.md },
    tourHeroArrow: { fontSize: fonts.sm, fontWeight: '700', color: p.accent },
    tourEmptyTitle:{ fontSize: fonts.lg, fontWeight: '700', color: p.textSecondary, marginBottom: 4 },
    tourEmptySub:  { fontSize: fonts.sm, color: p.textMuted, marginBottom: spacing.md },
    sectionLabel: {
      fontSize: fonts.xs, fontWeight: '700', color: p.textMuted,
      letterSpacing: 2, marginBottom: spacing.sm, marginTop: spacing.xs,
    },
    grid:          { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
    gridCard: {
      flex: 1, backgroundColor: p.card, borderRadius: radius.md,
      padding: spacing.md, borderWidth: 1, borderColor: p.border,
      minHeight: 78, justifyContent: 'center',
    },
    gridCardAccent:{ backgroundColor: p.accent, borderColor: p.accent },
    gridTitle:     { fontSize: fonts.md, fontWeight: '700', color: p.text, marginBottom: 3 },
    gridSub:       { fontSize: fonts.xs, color: p.textMuted },
    toolCard: {
      backgroundColor: p.card, borderRadius: radius.md, borderWidth: 1,
      borderColor: p.border, paddingVertical: spacing.md,
      paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center',
      marginBottom: spacing.sm,
    },
    toolLeft:      { flex: 1 },
    toolTitle:     { fontSize: fonts.md, fontWeight: '700', color: p.text, marginBottom: 2 },
    toolSub:       { fontSize: fonts.xs, color: p.textMuted },
    chevron:       { fontSize: 22, color: p.textMuted, lineHeight: 24 },
  });
}
