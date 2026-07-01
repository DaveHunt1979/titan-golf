import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';

const CLUBS = ['Driver','3W','5W','3i','4i','5i','6i','7i','8i','9i','PW','GW','SW','LW'];

interface Session {
  id: string;
  created_at: string;
  notes: string | null;
  shot_count?: number;
}

interface ClubAvg {
  club: string;
  avg: number;
  max: number;
  count: number;
}

export default function RangeHomeScreen() {
  const router = useRouter();
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [clubAvgs, setClubAvgs] = useState<ClubAvg[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: player } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (player) setPlayerId((player as any).id);
    })();
  }, []);

  useFocusEffect(useCallback(() => {
    if (playerId) loadData(playerId);
  }, [playerId]));

  async function loadData(pid: string) {
    setLoading(true);
    const [{ data: sessionData }, { data: shotData }] = await Promise.all([
      supabase.from('range_sessions').select('id,created_at,notes').eq('player_id', pid).order('created_at', { ascending: false }).limit(10),
      supabase.from('range_shots').select('club,carry').eq('player_id', pid).not('carry', 'is', null),
    ]);

    if (sessionData) {
      const sessionsWithCount = await Promise.all(
        (sessionData as Session[]).map(async sess => {
          const { count } = await supabase.from('range_shots').select('*', { count: 'exact', head: true }).eq('session_id', sess.id);
          return { ...sess, shot_count: count ?? 0 };
        })
      );
      setSessions(sessionsWithCount);
    }

    if (shotData) {
      const byClub: Record<string, number[]> = {};
      (shotData as { club: string; carry: number }[]).forEach(s => {
        if (!byClub[s.club]) byClub[s.club] = [];
        byClub[s.club].push(s.carry);
      });
      const avgs: ClubAvg[] = CLUBS
        .filter(c => byClub[c] && byClub[c].length > 0)
        .map(c => {
          const vals = byClub[c];
          return {
            club: c,
            avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
            max: Math.max(...vals),
            count: vals.length,
          };
        });
      setClubAvgs(avgs);
    }
    setLoading(false);
  }

  async function startSession() {
    if (!playerId || starting) return;
    setStarting(true);
    const { data, error } = await supabase.from('range_sessions').insert({ player_id: playerId }).select().single();
    setStarting(false);
    if (error || !data) { Alert.alert('Error', error?.message ?? 'Could not start session'); return; }
    router.push(`/(app)/range/${(data as any).id}` as any);
  }

  async function deleteSession(id: string) {
    Alert.alert('Delete Session', 'Remove this range session and all its shots?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await supabase.from('range_shots').delete().eq('session_id', id);
        await supabase.from('range_sessions').delete().eq('id', id);
        setSessions(prev => prev.filter(s => s.id !== id));
        if (playerId) loadData(playerId);
      }},
    ]);
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>DRIVING RANGE</Text>
        <View style={{ minWidth: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Start session */}
        <TouchableOpacity style={s.startBtn} onPress={startSession} disabled={starting} activeOpacity={0.85}>
          {starting
            ? <ActivityIndicator color={colors.bg} />
            : <>
                <Text style={s.startBtnIcon}>🏌️</Text>
                <Text style={s.startBtnText}>Start Range Session</Text>
                <Text style={s.startBtnSub}>Log shots, track distances, build your bag profile</Text>
              </>
          }
        </TouchableOpacity>

        {/* Club distance averages */}
        {clubAvgs.length > 0 && (
          <>
            <Text style={s.sectionLabel}>YOUR BAG · CARRY DISTANCES</Text>
            <View style={s.bagCard}>
              {clubAvgs.map((c, i) => (
                <View key={c.club} style={[s.bagRow, i < clubAvgs.length - 1 && s.bagRowBorder]}>
                  <Text style={s.bagClub}>{c.club}</Text>
                  <View style={s.bagBar}>
                    <View style={[s.bagBarFill, { width: `${Math.round((c.avg / (clubAvgs[0]?.avg || 1)) * 100)}%` }]} />
                  </View>
                  <Text style={s.bagAvg}>{c.avg} <Text style={s.bagYds}>yds</Text></Text>
                  <Text style={s.bagMax}>↑{c.max}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Recent sessions */}
        {sessions.length > 0 && (
          <>
            <Text style={s.sectionLabel}>RECENT SESSIONS</Text>
            {sessions.map(sess => (
              <TouchableOpacity
                key={sess.id}
                style={s.sessionCard}
                onPress={() => router.push(`/(app)/range/${sess.id}` as any)}
                onLongPress={() => deleteSession(sess.id)}
                activeOpacity={0.8}
              >
                <View style={s.sessionLeft}>
                  <Text style={s.sessionDate}>{formatDate(sess.created_at)}</Text>
                  <Text style={s.sessionCount}>{sess.shot_count} shots logged</Text>
                </View>
                <Text style={s.sessionArrow}>›</Text>
              </TouchableOpacity>
            ))}
            <Text style={s.longPressHint}>Long press a session to delete</Text>
          </>
        )}

        {!loading && sessions.length === 0 && (
          <View style={s.emptyState}>
            <Text style={s.emptyIcon}>⛳</Text>
            <Text style={s.emptyTitle}>No sessions yet</Text>
            <Text style={s.emptySub}>Hit Start Range Session to begin tracking your distances</Text>
          </View>
        )}

        {loading && <ActivityIndicator color={colors.gold} style={{ marginTop: spacing.xl }} />}

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  header: {
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn:     { minWidth: 60 },
  backText:    { fontSize: fonts.md, color: colors.gold, fontWeight: '600' },
  headerTitle: { fontSize: fonts.sm, fontWeight: '800', color: colors.white, letterSpacing: 2 },

  scroll: { padding: spacing.md, paddingBottom: 100 },

  startBtn: {
    backgroundColor: colors.gold, borderRadius: radius.xl,
    paddingVertical: spacing.xl, alignItems: 'center',
    marginBottom: spacing.xl,
  },
  startBtnIcon: { fontSize: 40, marginBottom: spacing.sm },
  startBtnText: { fontSize: fonts.lg, fontWeight: '900', color: colors.bg, letterSpacing: 1 },
  startBtnSub:  { fontSize: fonts.xs, color: 'rgba(7,11,16,0.6)', marginTop: spacing.xs, textAlign: 'center', paddingHorizontal: spacing.lg },

  sectionLabel: { fontSize: 9, fontWeight: '800', color: colors.textMuted, letterSpacing: 2, marginBottom: spacing.sm, marginTop: spacing.md },

  bagCard: {
    backgroundColor: colors.card, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden', marginBottom: spacing.md,
  },
  bagRow:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  bagRowBorder:  { borderBottomWidth: 1, borderBottomColor: colors.border },
  bagClub:       { width: 42, fontSize: fonts.sm, fontWeight: '800', color: colors.white },
  bagBar:        { flex: 1, height: 6, backgroundColor: colors.cardAlt, borderRadius: 3, marginHorizontal: spacing.sm, overflow: 'hidden' },
  bagBarFill:    { height: '100%', backgroundColor: colors.gold, borderRadius: 3 },
  bagAvg:        { width: 70, fontSize: fonts.sm, fontWeight: '800', color: colors.gold, textAlign: 'right' },
  bagYds:        { fontSize: fonts.xs, fontWeight: '600', color: colors.textMuted },
  bagMax:        { width: 44, fontSize: fonts.xs, color: colors.textMuted, textAlign: 'right' },

  sessionCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.xs,
  },
  sessionLeft:  { flex: 1 },
  sessionDate:  { fontSize: fonts.md, fontWeight: '700', color: colors.white },
  sessionCount: { fontSize: fonts.xs, color: colors.textMuted, marginTop: 2 },
  sessionArrow: { fontSize: fonts.xl, color: colors.textMuted },
  longPressHint: { fontSize: fonts.xs, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm, opacity: 0.5 },

  emptyState: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyIcon:  { fontSize: 48, marginBottom: spacing.md },
  emptyTitle: { fontSize: fonts.lg, fontWeight: '800', color: colors.white, marginBottom: spacing.xs },
  emptySub:   { fontSize: fonts.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
});
