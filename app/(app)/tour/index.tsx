import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Image, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { getStandings } from '../../../src/lib/scoring';
import { fonts, spacing, radius } from '../../../src/lib/theme';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { teamLogos } from '../../../src/lib/assets';
import type { Competition, CompetitionDay, Match, Team } from '../../../src/types';

export default function TourScreen() {
  const colors = useDynamicColors();
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    header: {
      paddingTop: 60,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerSub: { fontSize: fonts.xs, color: colors.gold, fontWeight: '700', letterSpacing: 2, marginBottom: 4 },
    title: { fontSize: fonts.xxl, fontWeight: '800', color: colors.white, letterSpacing: 0.5, marginBottom: spacing.xs },
    liveBadge: {
      alignSelf: 'flex-start',
      backgroundColor: 'rgba(34,197,94,0.12)',
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: 'rgba(34,197,94,0.3)',
    },
    liveBadgeText: { fontSize: fonts.xs, color: '#22c55e', fontWeight: '700', letterSpacing: 1 },
    scroll: { padding: spacing.md, paddingBottom: 40 },
    sectionLabel: {
      fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted,
      letterSpacing: 2, marginBottom: spacing.sm, marginTop: spacing.sm,
    },
    standingsCard: {
      backgroundColor: colors.card, borderRadius: radius.md,
      borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: spacing.lg,
    },
    standingRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      paddingVertical: 10, paddingHorizontal: spacing.md,
    },
    rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
    pos: { width: 18, fontSize: fonts.sm, color: colors.textMuted, fontWeight: '700', textAlign: 'center' },
    posGold: { color: colors.gold },
    logo: { width: 26, height: 26 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    teamName: { flex: 1, fontSize: fonts.sm, fontWeight: '700', color: colors.white },
    teamNameGold: { color: colors.gold },
    record: { fontSize: fonts.xs, color: colors.textMuted, width: 72, textAlign: 'right' },
    pts: { fontSize: fonts.lg, fontWeight: '800', color: colors.textSecondary, minWidth: 28, textAlign: 'right' },
    ptsGold: { color: colors.gold },
    ptsLabel: { fontSize: fonts.xs, color: colors.textMuted, width: 22 },
    noResults: { fontSize: fonts.sm, color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
    dayCard: {
      backgroundColor: colors.card, borderRadius: radius.md,
      borderWidth: 1, borderColor: colors.border,
      padding: spacing.md, marginBottom: spacing.sm,
    },
    dayCardLive: { borderColor: 'rgba(34,197,94,0.4)' },
    dayCardDone: { opacity: 0.65 },
    dayTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
    dayNum: { fontSize: fonts.xs, fontWeight: '700', color: colors.gold, letterSpacing: 1.5 },
    badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: colors.bg },
    badgeLive: {
      backgroundColor: 'rgba(34,197,94,0.12)',
      borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)',
    },
    badgeText: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5 },
    badgeTextLive: { color: '#22c55e' },
    courseName: { fontSize: fonts.lg, fontWeight: '700', color: colors.white, marginBottom: spacing.sm },
    dayBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    dayCount: { fontSize: fonts.xs, color: colors.textMuted },
    chevron: { fontSize: 20, color: colors.textMuted, lineHeight: 22 },
  }), [colors]);

  const router = useRouter();
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [days, setDays] = useState<CompetitionDay[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    const { data: comp } = await supabase
      .from('competitions')
      .select('*')
      .eq('status', 'active')
      .limit(1)
      .single();

    if (!comp) { setLoading(false); setRefreshing(false); return; }
    setCompetition(comp as Competition);

    const [{ data: daysData }, { data: matchesData }, { data: teamsData }] = await Promise.all([
      supabase.from('competition_days').select('*').eq('competition_id', comp.id).order('day_number'),
      supabase.from('matches').select('*').eq('competition_id', comp.id),
      supabase.from('teams').select('*').order('sort_order'),
    ]);

    if (daysData) setDays(daysData as CompetitionDay[]);
    if (matchesData) setMatches(matchesData as Match[]);
    if (teamsData) setTeams(teamsData as Team[]);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    load();
    const sub = supabase
      .channel('tour-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, load)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, []);

  const standings = getStandings((matches as any[]).filter((m: any) => m.home_team_id && m.away_team_id));
  const enriched = standings.map(s => {
    const t = teams.find(t => t.id === s.teamId);
    return { ...s, name: t?.name ?? '—', accent_color: t?.accent_color ?? colors.textMuted };
  });

  function dayInfo(dayId: string) {
    const dayMatches = matches.filter(m => m.day_id === dayId);
    const complete = dayMatches.filter(m => m.status === 'complete').length;
    const live = dayMatches.filter(m => m.status === 'in_progress').length;
    const total = dayMatches.length;
    const isLive = live > 0;
    const isDone = complete === total && total > 0;
    return { complete, live, total, isLive, isDone };
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Text style={styles.headerSub}>SOCIETY COMPETITION</Text>
        <Text style={styles.title}>{competition?.name ?? 'Tour'}</Text>
        {competition?.status === 'active' && (
          <View style={styles.liveBadge}>
            <Text style={styles.liveBadgeText}>● LIVE</Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.gold} size="large" /></View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={colors.gold}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {/* Standings */}
          <Text style={styles.sectionLabel}>STANDINGS</Text>
          <View style={styles.standingsCard}>
            {enriched.length === 0 && (
              <Text style={styles.noResults}>No results yet — get playing!</Text>
            )}
            {enriched.map((s, i) => (
              <View key={s.teamId} style={[styles.standingRow, i < enriched.length - 1 && styles.rowBorder]}>
                <Text style={[styles.pos, i === 0 && styles.posGold]}>{i + 1}</Text>
                {teamLogos[s.name]
                  ? <Image source={teamLogos[s.name]} style={styles.logo} resizeMode="contain" />
                  : <View style={[styles.dot, { backgroundColor: s.accent_color }]} />
                }
                <Text style={[styles.teamName, i === 0 && styles.teamNameGold]}>{s.name}</Text>
                <Text style={styles.record}>{s.w}W {s.h}H {s.l}L</Text>
                <Text style={[styles.pts, i === 0 && styles.ptsGold]}>{s.pts}</Text>
                <Text style={styles.ptsLabel}>pts</Text>
              </View>
            ))}
          </View>

          {/* Schedule */}
          <Text style={styles.sectionLabel}>SCHEDULE</Text>
          {days.map(day => {
            const { complete, live, total, isLive, isDone } = dayInfo(day.id);
            const statusLabel = isDone ? 'Complete' : isLive ? 'Live' : 'Upcoming';
            return (
              <TouchableOpacity
                key={day.id}
                style={[styles.dayCard, isLive && styles.dayCardLive, isDone && styles.dayCardDone]}
                onPress={() => router.push(`/(app)/tour/day/${day.id}` as any)}
                activeOpacity={0.75}
              >
                <View style={styles.dayTop}>
                  <Text style={styles.dayNum}>DAY {day.day_number}</Text>
                  <View style={[styles.badge, isLive && styles.badgeLive]}>
                    <Text style={[styles.badgeText, isLive && styles.badgeTextLive]}>{statusLabel}</Text>
                  </View>
                </View>
                <Text style={styles.courseName}>{day.course_name ?? 'TBC'}</Text>
                <View style={styles.dayBottom}>
                  <Text style={styles.dayCount}>
                    {complete}/{total} complete{live > 0 ? `  ·  ${live} live` : ''}
                  </Text>
                  <Text style={styles.chevron}>›</Text>
                </View>
              </TouchableOpacity>
            );
          })}
          {days.length === 0 && <Text style={styles.noResults}>No days scheduled yet.</Text>}
        </ScrollView>
      )}
    </View>
  );
}
