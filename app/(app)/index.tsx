import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, Image, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../src/lib/supabase';
import { spacing, radius } from '../../src/lib/theme';
import { titanLogo } from '../../src/lib/assets';
import { useSocietyTheme } from '../../src/lib/SocietyThemeContext';

const SOCIETY_ID = '00000000-0000-0000-0000-000000000001';

export default function HomeScreen() {
  const router = useRouter();
  const { logoUrl, localLogo, societyName, palette } = useSocietyTheme();

  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [memberTypes, setMemberTypes] = useState<string[]>([]);
  const [isPrivileged, setIsPrivileged] = useState(false);

  // live stats
  const [casualGames, setCasualGames]   = useState(0);
  const [tourName, setTourName]         = useState<string | null>(null);
  const [tourLive, setTourLive]         = useState(0);
  const [swindleName, setSwindleName]   = useState<string | null>(null);
  const [swindleCount, setSwindleCount] = useState(0);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();

    const [
      { data: comp },
      { count: casualCount },
      { count: tourCount },
      { data: swindleData },
    ] = await Promise.all([
      supabase.from('competitions').select('id,name').eq('status', 'active').neq('format', 'casual').limit(1).single(),
      supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'in_progress').is('competition_id', null),
      supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'in_progress').not('competition_id', 'is', null),
      supabase.from('swindle_games').select('name,swindle_entries(count)').eq('status', 'open').order('created_at', { ascending: false }).limit(1).single(),
    ]);

    setCasualGames(casualCount ?? 0);
    setTourName(comp?.name ?? null);
    setTourLive(tourCount ?? 0);
    setSwindleName((swindleData as any)?.name ?? null);
    setSwindleCount((swindleData as any)?.swindle_entries?.[0]?.count ?? 0);

    if (user) {
      const { data: playerRow } = await supabase.from('players').select('id').eq('auth_uid', user.id).single();
      if (playerRow) {
        const { data: sm } = await supabase.from('society_members')
          .select('membership_types, role')
          .eq('society_id', SOCIETY_ID)
          .eq('player_id', (playerRow as any).id)
          .single();
        const role = (sm as any)?.role ?? '';
        const priv = role === 'admin' || role === 'owner';
        setIsPrivileged(priv);
        setMemberTypes(priv ? ['casual', 'tour', 'swindle'] : ((sm as any)?.membership_types ?? []));
      }
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const hasArea = (a: string) => isPrivileged || memberTypes.includes(a);

  const logoSrc = localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo);

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={s.header}>
        <Image source={logoSrc} style={s.logo} resizeMode="contain" />
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text style={[s.societyName, { color: palette.accent }]}>{societyName.toUpperCase()}</Text>
          <Text style={s.tagline}>Choose your game</Text>
        </View>
      </View>

      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator color={palette.accent} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={palette.accent} />}
        >

          {/* ── Three main area tiles ── */}
          <AreaTile
            icon="🏌️"
            label="Casual Golf"
            sub={casualGames > 0 ? `${casualGames} game${casualGames !== 1 ? 's' : ''} in progress` : 'Pick-up games with the boys'}
            color="#4ade80"
            locked={!hasArea('casual')}
            onPress={() => hasArea('casual') ? router.push('/(app)/score' as any) : router.push('/(app)/join' as any)}
          />
          <AreaTile
            icon="🏆"
            label="Tournament"
            sub={tourName ?? (tourLive > 0 ? `${tourLive} matches live` : 'Competitive team play')}
            color="#D4AF37"
            locked={!hasArea('tour')}
            live={tourLive > 0}
            onPress={() => hasArea('tour') ? router.push('/(app)/tour' as any) : router.push('/(app)/join' as any)}
          />
          <AreaTile
            icon="💰"
            label="The Swindle"
            sub={swindleName ?? (swindleCount > 0 ? `${swindleCount} entered` : 'Weekly money competition')}
            color="#a78bfa"
            locked={!hasArea('swindle')}
            onPress={() => hasArea('swindle') ? router.push('/(app)/swindle' as any) : router.push('/(app)/join' as any)}
          />

          {/* ── Utility row ── */}
          <View style={s.utilRow}>
            <TouchableOpacity
              style={s.utilTile}
              onPress={() => router.push('/(app)/rangefinder' as any)}
              activeOpacity={0.8}
            >
              <Text style={s.utilIcon}>🔭</Text>
              <Text style={s.utilLabel}>Rangefinder</Text>
              <Text style={s.utilSub}>Front · Centre · Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.utilTile}
              onPress={() => router.push('/(app)/range' as any)}
              activeOpacity={0.8}
            >
              <Text style={s.utilIcon}>⛳</Text>
              <Text style={s.utilLabel}>Driving Range</Text>
              <Text style={s.utilSub}>Track shots & distances</Text>
            </TouchableOpacity>
          </View>

        </ScrollView>
      )}
    </View>
  );
}

function AreaTile({
  icon, label, sub, color, locked, live, onPress,
}: {
  icon: string; label: string; sub: string; color: string;
  locked: boolean; live?: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[tile.wrap, { borderLeftColor: locked ? '#374151' : color }, locked && tile.locked]}
      onPress={onPress}
      activeOpacity={0.82}
    >
      <Text style={[tile.icon, locked && { opacity: 0.35 }]}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <View style={tile.labelRow}>
          <Text style={[tile.label, locked && tile.labelLocked]}>{label}</Text>
          {live && !locked && (
            <View style={tile.livePill}>
              <View style={tile.liveDot} />
              <Text style={tile.liveText}>LIVE</Text>
            </View>
          )}
        </View>
        <Text style={tile.sub} numberOfLines={1}>
          {locked ? 'Ask Rick for access' : sub}
        </Text>
      </View>
      {locked
        ? <Text style={tile.lock}>🔒</Text>
        : <Text style={[tile.arrow, { color }]}>›</Text>}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#070b10' },
  header: {
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg,
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: '#1c2030',
  },
  logo:        { width: 44, height: 44, borderRadius: 10 },
  societyName: { fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  tagline:     { fontSize: 20, fontWeight: '800', color: '#ffffff', marginTop: 2 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll:      { padding: spacing.md, paddingBottom: 48 },
  utilRow:     { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  utilTile: {
    flex: 1, backgroundColor: '#1c1c1e', borderRadius: radius.lg,
    borderWidth: 1, borderColor: '#2c2c2e',
    padding: spacing.md, paddingVertical: 18, alignItems: 'flex-start',
  },
  utilIcon:  { fontSize: 28, marginBottom: 8 },
  utilLabel: { fontSize: 14, fontWeight: '800', color: '#ffffff', marginBottom: 3 },
  utilSub:   { fontSize: 11, color: '#6b7280', lineHeight: 16 },
});

const tile = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: '#1c1c1e', borderRadius: radius.lg,
    borderWidth: 1, borderColor: '#2c2c2e', borderLeftWidth: 5,
    paddingVertical: 22, paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  locked:      { opacity: 0.6 },
  icon:        { fontSize: 34, width: 42, textAlign: 'center' },
  labelRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: 5 },
  label:       { fontSize: 20, fontWeight: '900', color: '#ffffff', letterSpacing: 0.2 },
  labelLocked: { color: '#6b7280' },
  sub:         { fontSize: 13, color: '#6b7280', lineHeight: 18 },
  arrow:       { fontSize: 32, fontWeight: '300', lineHeight: 36 },
  lock:        { fontSize: 18 },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(34,197,94,0.12)', paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)',
  },
  liveDot:  { width: 5, height: 5, borderRadius: 3, backgroundColor: '#22c55e' },
  liveText: { fontSize: 9, fontWeight: '800', color: '#22c55e', letterSpacing: 1 },
});
