import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { titanLogo } from '../../../src/lib/assets';

const GOLD     = '#D4AF37';
const GREEN    = '#4ade80';
const RED      = '#f87171';
const BLUE     = '#3b82f6';
const DARKBLUE = '#1e3a8a';
const PLAIN    = '#ffffff';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';

interface Breakdown { eagles: number; birdies: number; pars: number; bogeys: number; doubles: number; }

interface Round {
  matchId: string;
  isSolo: boolean;
  roundFormat: string | null;
  createdAt: string;
  courseName: string;
  coursePar: number;
  playDate: string | null;
  holesPlayed: number;
  grossTotal: number;
  fairwaysHit: number;
  fairwaysTracked: number;
  totalPutts: number;
  puttsTracked: number;
  breakdown: Breakdown;
}

// Gross strokes vs par only — same classification used everywhere else in the app.
function scoreVsPar(gross: number, par: number): 'eagle' | 'birdie' | 'par' | 'bogey' | 'double' {
  const diff = gross - par;
  if (diff <= -2) return 'eagle';
  if (diff === -1) return 'birdie';
  if (diff === 0)  return 'par';
  if (diff === 1)  return 'bogey';
  return 'double';
}

export default function RoundsScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { localLogo, logoUrl } = useSocietyTheme();
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
      .select('id, created_at, round_format, home_player_ids, away_player_ids, day:day_id(play_date, course_name, course_par)')
      .or(`home_player_ids.cs.{${pid}},away_player_ids.cs.{${pid}}`)
      .eq('status', 'complete');

    const matchIds = (matches ?? []).map((m: any) => m.id);
    if (matchIds.length === 0) { setLoading(false); return; }

    const infoMap: Record<string, { createdAt: string; courseName: string; coursePar: number; playDate: string | null; isSolo: boolean; roundFormat: string | null }> = {};
    for (const m of (matches ?? []) as any[]) {
      infoMap[m.id] = {
        isSolo:      (m.away_player_ids ?? []).length === 0 && (m.home_player_ids ?? []).length === 1,
        roundFormat: m.round_format ?? null,
        createdAt:   m.created_at,
        courseName:  m.day?.course_name ?? 'Unknown Course',
        coursePar:   m.day?.course_par  ?? 72,
        playDate:    m.day?.play_date   ?? null,
      };
    }

    const courseNames = [...new Set(Object.values(infoMap).map(i => i.courseName))];

    const [holesRes, statsRes, courseHolesRes] = await Promise.all([
      supabase
        .from('match_holes')
        .select('match_id, hole_number, gross_score')
        .eq('player_id', pid)
        .in('match_id', matchIds)
        .not('gross_score', 'is', null),
      supabase
        .from('hole_stats')
        .select('match_id, fairway_hit, putts')
        .eq('player_id', pid)
        .in('match_id', matchIds),
      courseNames.length
        ? supabase.from('course_holes').select('course_name, hole_number, par').in('course_name', courseNames)
        : Promise.resolve({ data: [] }),
    ]);

    // course_name -> hole_number -> par
    const parLookup: Record<string, Record<number, number>> = {};
    for (const c of (courseHolesRes.data ?? []) as any[]) {
      if (!parLookup[c.course_name]) parLookup[c.course_name] = {};
      parLookup[c.course_name][c.hole_number] = c.par;
    }

    const grossMap: Record<string, number[]> = {};
    const breakdownMap: Record<string, Breakdown> = {};
    for (const r of (holesRes.data ?? []) as any[]) {
      if (!grossMap[r.match_id]) grossMap[r.match_id] = [];
      grossMap[r.match_id].push(r.gross_score);

      const courseName = infoMap[r.match_id]?.courseName;
      const par = courseName ? parLookup[courseName]?.[r.hole_number] : null;
      if (par != null) {
        if (!breakdownMap[r.match_id]) breakdownMap[r.match_id] = { eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0 };
        const cat = scoreVsPar(r.gross_score, par);
        if (cat === 'eagle') breakdownMap[r.match_id].eagles++;
        else if (cat === 'birdie') breakdownMap[r.match_id].birdies++;
        else if (cat === 'par') breakdownMap[r.match_id].pars++;
        else if (cat === 'bogey') breakdownMap[r.match_id].bogeys++;
        else breakdownMap[r.match_id].doubles++;
      }
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
          isSolo:           info.isSolo,
          roundFormat:      info.roundFormat,
          createdAt:        info.createdAt,
          courseName:       info.courseName,
          coursePar:        info.coursePar,
          playDate:         info.playDate,
          holesPlayed:      gross.length,
          grossTotal:       gross.reduce((a, b) => a + b, 0),
          fairwaysHit:      st.fh,
          fairwaysTracked:  st.ft,
          totalPutts:       st.tp,
          puttsTracked:     st.pt,
          breakdown:        breakdownMap[id] ?? { eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0 },
        };
      });

    list.sort((a, b) => {
      if (a.playDate && b.playDate && a.playDate !== b.playDate)
        return b.playDate.localeCompare(a.playDate);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    setRounds(list);
    setLoading(false);
  }

  if (loading || !fontsLoaded) {
    return (
      <View style={[ss.loadingContainer, { backgroundColor: dc.bg }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={dc.gold} size="large" />
      </View>
    );
  }

  return (
    <View style={[ss.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[ss.header, { borderBottomColor: dc.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={ss.headerSide}
        >
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>

        <View style={ss.headerCenter}>
          <Image source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)} style={ss.logo} resizeMode="contain" />
          <Text style={[ss.headerSubtitle, { color: dc.gold }]}>ROUND HISTORY</Text>
        </View>

        <View style={[ss.headerSide, { alignItems: 'flex-end' }]} />
      </View>

      <ScrollView contentContainerStyle={ss.scroll} showsVerticalScrollIndicator={false}>
        {rounds.length === 0 ? (
          <View style={ss.empty}>
            <Ionicons name="trophy-outline" size={40} color={GOLD} style={{ marginBottom: 12 }} />
            <Text style={ss.emptyTitle}>No rounds yet</Text>
            <Text style={ss.emptySub}>Complete a round to see your history here</Text>
          </View>
        ) : (
          rounds.map(r => {
            const diff = r.holesPlayed >= 18 ? r.grossTotal - r.coursePar : null;
            const avgPutts = r.puttsTracked > 0
              ? (r.totalPutts / r.puttsTracked).toFixed(1)
              : null;
            const b = r.breakdown;
            const badges = [
              { label: 'EAGLE',  count: b.eagles,  bg: GOLD,      fg: '#000' },
              { label: 'BIRDIE', count: b.birdies, bg: RED,       fg: '#000' },
              { label: 'PAR',    count: b.pars,    bg: '#262626', fg: PLAIN },
              { label: 'BOGEY',  count: b.bogeys,  bg: '#1e3a5f', fg: BLUE },
              { label: 'DBL+',   count: b.doubles, bg: '#1e1b4b', fg: DARKBLUE },
            ].filter(t => t.count > 0);

            return (
              <TouchableOpacity
                key={r.matchId}
                style={[ss.card, { backgroundColor: dc.card, borderColor: dc.border }]}
                onPress={() => router.push((r.roundFormat === 'team_stableford' ? `/(app)/score/teamstableford/${r.matchId}` : r.isSolo ? `/(app)/score/solo/${r.matchId}` : `/(app)/score/enter/${r.matchId}`) as any)}
                activeOpacity={0.75}
              >
                {/* Top row */}
                <View style={ss.cardTop}>
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="trophy" size={13} color={GOLD} />
                      <Text style={ss.courseName} numberOfLines={1}>{r.courseName}</Text>
                    </View>
                    <Text style={ss.date}>{formatDate(r.playDate)}</Text>
                  </View>
                  <View style={ss.scoreBox}>
                    <Text allowFontScaling={false} style={ss.gross}>{r.grossTotal}</Text>
                    {diff !== null && (
                      <Text allowFontScaling={false} style={[ss.toPar, { color: toParColor(diff) }]}>{toParStr(diff)}</Text>
                    )}
                    {r.holesPlayed < 18 && (
                      <Text allowFontScaling={false} style={ss.holesTag}>NH</Text>
                    )}
                  </View>
                </View>

                {/* Scoring breakdown badges */}
                {badges.length > 0 && (
                  <View style={ss.badgeRow}>
                    {badges.map(t => (
                      <View key={t.label} style={[ss.badge, { backgroundColor: t.bg }]}>
                        <Text allowFontScaling={false} style={[ss.badgeCount, { color: t.fg }]}>{t.count}</Text>
                        <Text allowFontScaling={false} style={[ss.badgeLabel, { color: t.fg }]}>{t.label}</Text>
                      </View>
                    ))}
                  </View>
                )}

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
                  <Text style={ss.drillLink}>View full scorecard</Text>
                  <Ionicons name="chevron-forward" size={14} color={dc.gold} />
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
  return '#ffffff';
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
    fontFamily: FFB,
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
    marginBottom: 12,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  courseName: {
    fontFamily: FFB,
    fontSize: 15,
    color: '#fff',
    flexShrink: 1,
  },
  date: {
    fontFamily: FFB,
    fontSize: 12,
    color: '#fff',
    marginTop: 2,
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
    fontFamily: FFB,
    fontSize: 12,
  },
  holesTag: {
    fontFamily: FFB,
    fontSize: 12,
    color: GOLD,
  },

  badgeRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 12,
  },
  badge: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  badgeCount: {
    fontFamily: FFB,
    fontSize: 16,
    lineHeight: 19,
  },
  badgeLabel: {
    fontFamily: FFB,
    fontSize: 7,
    letterSpacing: 0.5,
    opacity: 0.85,
    marginTop: 1,
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
    fontFamily: FFB,
    fontSize: 11,
    color: '#fff',
  },

  drillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 4,
  },
  drillLink: {
    fontFamily: FFB,
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
    color: '#fff',
  },
  emptySub: {
    fontFamily: FFB,
    fontSize: 13,
    color: '#ffffff',
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 32,
  },
});
