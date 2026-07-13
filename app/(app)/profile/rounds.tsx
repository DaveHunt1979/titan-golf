import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

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

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

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

  if (loading || !fontsLoaded) {
    return (
      <View style={ss.loadingContainer}>
        <StatusBar style="light" />
        <ActivityIndicator color={GOLD} size="large" />
      </View>
    );
  }

  return (
    <View style={ss.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={ss.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={ss.headerSide}
        >
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>

        <View style={ss.headerCenter}>
          <Image source={titanLogo} style={ss.logo} resizeMode="contain" />
          <Text style={ss.headerSubtitle}>ROUND HISTORY</Text>
        </View>

        <View style={[ss.headerSide, { alignItems: 'flex-end' }]} />
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
                {/* Top row */}
                <View style={ss.cardTop}>
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Text style={ss.courseName} numberOfLines={1}>{r.courseName}</Text>
                    <Text style={ss.date}>{formatDate(r.playDate)}</Text>
                  </View>
                  <View style={ss.scoreBox}>
                    <Text style={ss.gross}>{r.grossTotal}</Text>
                    {diff !== null && (
                      <Text style={[ss.toPar, { color: toParColor(diff) }]}>{toParStr(diff)}</Text>
                    )}
                    {r.holesPlayed < 18 && (
                      <Text style={ss.holesTag}>NH</Text>
                    )}
                  </View>
                </View>

                {/* Stats chips */}
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

                {/* View hole-by-hole row */}
                <View style={ss.drillRow}>
                  <Text style={ss.drillLink}>View hole-by-hole</Text>
                  <Ionicons name="chevron-forward" size={14} color={GOLD} />
                </View>
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
  if (n < 0) return GREEN;
  if (n > 5) return RED;
  return '#aaa';
}

const ss = StyleSheet.create({
  loadingContainer: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, backgroundColor: '#000' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1c',
  },
  headerSide: {
    width: 40,
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  logo: {
    width: 28,
    height: 28,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontFamily: FF,
    fontSize: 9,
    color: GOLD,
    letterSpacing: 2.5,
  },

  scroll: { padding: 20 },

  card: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1c1c1c',
    padding: 14,
    marginBottom: 10,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  courseName: {
    fontFamily: FFB,
    fontSize: 15,
    color: '#fff',
    marginBottom: 2,
  },
  date: {
    fontFamily: FF,
    fontSize: 12,
    color: '#555',
  },
  scoreBox: {
    alignItems: 'flex-end',
    gap: 2,
  },
  gross: {
    fontFamily: FFB,
    fontSize: 28,
    color: '#fff',
  },
  toPar: {
    fontFamily: FF,
    fontSize: 12,
  },
  holesTag: {
    fontFamily: FF,
    fontSize: 12,
    color: GOLD,
  },

  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  chip: {
    backgroundColor: '#1c1c1c',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: {
    fontFamily: FF,
    fontSize: 11,
    color: '#555',
  },

  drillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 4,
  },
  drillLink: {
    fontFamily: FF,
    fontSize: 12,
    color: GOLD,
  },

  empty: {
    alignItems: 'center',
    paddingTop: 80,
  },
  emptyTitle: {
    fontFamily: FFB,
    fontSize: 16,
    color: '#555',
  },
  emptySub: {
    fontFamily: FF,
    fontSize: 13,
    color: '#444',
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 32,
  },
});
