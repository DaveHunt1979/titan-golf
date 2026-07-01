import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { colors, fonts, radius, spacing } from '../../../src/lib/theme';

interface Round {
  matchId: string;
  courseName: string;
  coursePar: number;
  playDate: string | null;
  holesPlayed: number;
  grossTotal: number;
  fairwaysHit: number;
  fairwaysTracked: number;
  totalPutts: number;
  puttsTracked: number;
}

export default function RoundsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rounds,  setRounds]  = useState<Round[]>([]);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: player } = await supabase
      .from('players').select('id').eq('auth_uid', user.id).maybeSingle();
    if (!player) { setLoading(false); return; }

    const pid = (player as any).id as string;

    const { data: matches } = await supabase
      .from('matches')
      .select('id, day:day_id(play_date, course_name, course_par)')
      .or(`home_player_ids.cs.{${pid}},away_player_ids.cs.{${pid}}`)
      .eq('status', 'complete');

    const matchIds = (matches ?? []).map((m: any) => m.id);
    if (matchIds.length === 0) { setLoading(false); return; }

    const infoMap: Record<string, { courseName: string; coursePar: number; playDate: string | null }> = {};
    for (const m of (matches ?? []) as any[]) {
      infoMap[m.id] = {
        courseName: m.day?.course_name ?? 'Unknown Course',
        coursePar:  m.day?.course_par  ?? 72,
        playDate:   m.day?.play_date   ?? null,
      };
    }

    const [holesRes, statsRes] = await Promise.all([
      supabase
        .from('match_holes')
        .select('match_id, gross_score')
        .eq('player_id', pid)
        .in('match_id', matchIds)
        .not('gross_score', 'is', null),
      supabase
        .from('hole_stats')
        .select('match_id, fairway_hit, putts')
        .eq('player_id', pid)
        .in('match_id', matchIds),
    ]);

    const grossMap: Record<string, number[]> = {};
    for (const r of (holesRes.data ?? []) as any[]) {
      if (!grossMap[r.match_id]) grossMap[r.match_id] = [];
      grossMap[r.match_id].push(r.gross_score);
    }

    const statMap: Record<string, { fh: number; ft: number; tp: number; pt: number }> = {};
    for (const r of (statsRes.data ?? []) as any[]) {
      if (!statMap[r.match_id]) statMap[r.match_id] = { fh: 0, ft: 0, tp: 0, pt: 0 };
      if (r.fairway_hit !== null) {
        statMap[r.match_id].ft++;
        if (r.fairway_hit) statMap[r.match_id].fh++;
      }
      if (r.putts != null) {
        statMap[r.match_id].pt++;
        statMap[r.match_id].tp += r.putts;
      }
    }

    const list: Round[] = Object.keys(infoMap)
      .filter(id => grossMap[id]?.length)
      .map(id => {
        const info = infoMap[id];
        const gross = grossMap[id] ?? [];
        const st = statMap[id] ?? { fh: 0, ft: 0, tp: 0, pt: 0 };
        return {
          matchId:          id,
          courseName:       info.courseName,
          coursePar:        info.coursePar,
          playDate:         info.playDate,
          holesPlayed:      gross.length,
          grossTotal:       gross.reduce((a, b) => a + b, 0),
          fairwaysHit:      st.fh,
          fairwaysTracked:  st.ft,
          totalPutts:       st.tp,
          puttsTracked:     st.pt,
        };
      });

    list.sort((a, b) => {
      if (!a.playDate && !b.playDate) return 0;
      if (!a.playDate) return 1;
      if (!b.playDate) return -1;
      return b.playDate.localeCompare(a.playDate);
    });

    setRounds(list);
    setLoading(false);
  }

  if (loading) {
    return (
      <View style={[ss.container, ss.centered]}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  return (
    <View style={ss.container}>
      <StatusBar style="light" />

      <View style={ss.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={ss.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={ss.title}>Round History</Text>
        <View style={{ width: 56 }} />
      </View>

      <ScrollView contentContainerStyle={ss.scroll} showsVerticalScrollIndicator={false}>
        {rounds.length === 0 ? (
          <View style={ss.empty}>
            <Text style={ss.emptyTitle}>No rounds yet</Text>
            <Text style={ss.emptySub}>Complete a round to see your history here</Text>
          </View>
        ) : (
          rounds.map(r => {
            const diff = r.holesPlayed >= 18 ? r.grossTotal - r.coursePar : null;
            const avgPutts = r.puttsTracked > 0
              ? (r.totalPutts / r.puttsTracked).toFixed(1)
              : null;
            return (
              <TouchableOpacity
                key={r.matchId}
                style={ss.card}
                onPress={() => router.push(`/(app)/profile/round/${r.matchId}` as any)}
                activeOpacity={0.75}
              >
                <View style={ss.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={ss.courseName} numberOfLines={1}>{r.courseName}</Text>
                    <Text style={ss.date}>{formatDate(r.playDate)}</Text>
                  </View>
                  <View style={ss.scoreBox}>
                    <Text style={ss.gross}>{r.grossTotal}</Text>
                    {diff !== null && (
                      <Text style={[ss.toPar, { color: toParColor(diff) }]}>{toParStr(diff)}</Text>
                    )}
                    {r.holesPlayed < 18 && (
                      <Text style={ss.holesTag}>{r.holesPlayed}H</Text>
                    )}
                  </View>
                </View>

                {(r.fairwaysTracked > 0 || r.puttsTracked > 0) && (
                  <View style={ss.chips}>
                    {r.fairwaysTracked > 0 && (
                      <View style={ss.chip}>
                        <Text style={ss.chipText}>
                          FWY {r.fairwaysHit}/{r.fairwaysTracked}
                          {' '}({Math.round((r.fairwaysHit / r.fairwaysTracked) * 100)}%)
                        </Text>
                      </View>
                    )}
                    {avgPutts !== null && (
                      <View style={ss.chip}>
                        <Text style={ss.chipText}>{avgPutts} putts / hole</Text>
                      </View>
                    )}
                  </View>
                )}

                <Text style={ss.drillLink}>View hole-by-hole →</Text>
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function toParStr(n: number) {
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `${n}`;
}

function toParColor(n: number) {
  if (n < 0) return colors.green;
  if (n > 5) return colors.red;
  return colors.textSecondary;
}

const ss = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered:  { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back:  { fontSize: fonts.sm, fontWeight: '600', color: colors.gold },
  title: { fontSize: fonts.lg, fontWeight: '800', color: colors.white, letterSpacing: 0.5 },

  scroll: { padding: spacing.lg },

  card: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  cardTop:    { flexDirection: 'row', alignItems: 'center' },
  courseName: { fontSize: fonts.sm, fontWeight: '700', color: colors.white, marginBottom: 2 },
  date:       { fontSize: fonts.xs, color: colors.textMuted },
  scoreBox:   { alignItems: 'flex-end', gap: 2 },
  gross:      { fontSize: fonts.xl, fontWeight: '800', color: colors.white },
  toPar:      { fontSize: fonts.xs, fontWeight: '700' },
  holesTag:   { fontSize: fonts.xs, color: colors.gold, fontWeight: '700' },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  chip: {
    backgroundColor: colors.cardAlt, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
  },
  chipText:  { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  drillLink: { fontSize: fonts.xs, color: colors.gold, marginTop: spacing.sm, fontWeight: '600' },

  empty:      { alignItems: 'center', paddingTop: 80 },
  emptyTitle: { fontSize: fonts.md, fontWeight: '700', color: colors.textSecondary },
  emptySub:   { fontSize: fonts.sm, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs, paddingHorizontal: spacing.xl },
});
