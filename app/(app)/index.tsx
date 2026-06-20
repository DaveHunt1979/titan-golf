import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, Image, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../src/lib/theme';
import { titanLogo } from '../../src/lib/assets';
import type { Competition } from '../../src/types';

export default function HomeScreen() {
  const router = useRouter();
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [liveCount, setLiveCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: comp } = await supabase
        .from('competitions')
        .select('*')
        .eq('status', 'active')
        .neq('format', 'casual')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (comp) {
        setCompetition(comp as Competition);
        const { count } = await supabase
          .from('matches')
          .select('*', { count: 'exact', head: true })
          .eq('competition_id', comp.id)
          .eq('status', 'in_progress');
        setLiveCount(count ?? 0);
      }
      setLoading(false);
    })();
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View>
          <Text style={styles.society}>TITAN GOLF SOCIETY</Text>
          <Text style={styles.season}>Season 2027</Text>
        </View>
        <Image source={titanLogo} style={styles.logo} resizeMode="contain" />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Active competition */}
        {loading && (
          <View style={styles.heroSkeleton}>
            <ActivityIndicator color={colors.gold} />
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

        {/* Quick play */}
        <Text style={styles.sectionLabel}>QUICK PLAY</Text>
        <View style={styles.grid}>
          <TouchableOpacity
            style={[styles.gridCard, styles.gridCardGold]}
            onPress={() => router.push('/(app)/games/new' as any)}
            activeOpacity={0.8}
          >
            <Text style={[styles.gridTitle, { color: colors.bg }]}>+ New Game</Text>
            <Text style={[styles.gridSub, { color: 'rgba(7,11,16,0.6)' }]}>Start a casual round</Text>
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

        {/* Society tools */}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  society: { fontSize: fonts.xs, fontWeight: '800', color: colors.gold, letterSpacing: 2 },
  season: { fontSize: fonts.xl, fontWeight: '800', color: colors.white, marginTop: 4 },
  logo: { width: 52, height: 52 },
  scroll: { padding: spacing.md, paddingBottom: 48 },
  heroSkeleton: {
    height: 140, backgroundColor: colors.card, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  tourHero: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.goldBorder,
  },
  tourHeroEmpty: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  tourHeroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(34,197,94,0.12)',
    paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: radius.full, borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
  livePillText: { fontSize: fonts.xs, fontWeight: '700', color: '#22c55e', letterSpacing: 1 },
  tourHeroLabel: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5 },
  tourHeroName: { fontSize: fonts.xl, fontWeight: '800', color: colors.white, marginBottom: 4 },
  tourHeroSub: { fontSize: fonts.sm, color: colors.textSecondary, marginBottom: spacing.md },
  tourHeroArrow: { fontSize: fonts.sm, fontWeight: '700', color: colors.gold },
  tourEmptyTitle: { fontSize: fonts.lg, fontWeight: '700', color: colors.textSecondary, marginBottom: 4 },
  tourEmptySub: { fontSize: fonts.sm, color: colors.textMuted, marginBottom: spacing.md },
  sectionLabel: {
    fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted,
    letterSpacing: 2, marginBottom: spacing.sm, marginTop: spacing.xs,
  },
  grid: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  gridCard: {
    flex: 1, backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
    minHeight: 78, justifyContent: 'center',
  },
  gridCardGold: { backgroundColor: colors.gold, borderColor: colors.gold },
  gridTitle: { fontSize: fonts.md, fontWeight: '700', color: colors.white, marginBottom: 3 },
  gridSub: { fontSize: fonts.xs, color: colors.textMuted },
  toolCard: {
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, paddingVertical: spacing.md,
    paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center',
    marginBottom: spacing.sm,
  },
  toolLeft: { flex: 1 },
  toolTitle: { fontSize: fonts.md, fontWeight: '700', color: colors.white, marginBottom: 2 },
  toolSub: { fontSize: fonts.xs, color: colors.textMuted },
  chevron: { fontSize: 22, color: colors.textMuted, lineHeight: 24 },
});
