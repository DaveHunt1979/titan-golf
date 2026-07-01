import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../../src/lib/supabase';
import { colors, fonts, radius, spacing } from '../../../../src/lib/theme';

interface HoleRow {
  holeNumber: number;
  gross: number | null;
  stablefordPts: number | null;
  fairwayDirection: 'left' | 'centre' | 'right' | null;
  putts: number | null;
  clubs: string[];
}

export default function RoundDetailScreen() {
  const router   = useRouter();
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const [loading,    setLoading]    = useState(true);
  const [courseName, setCourseName] = useState('Round');
  const [playDate,   setPlayDate]   = useState<string | null>(null);
  const [coursePar,  setCoursePar]  = useState(72);
  const [holes,      setHoles]      = useState<HoleRow[]>([]);

  useEffect(() => { if (matchId) load(); }, [matchId]);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: player } = await supabase
      .from('players').select('id').eq('auth_uid', user.id).maybeSingle();
    if (!player) { setLoading(false); return; }

    const pid = (player as any).id as string;

    const [matchRes, holesRes, statsRes, shotsRes] = await Promise.all([
      supabase
        .from('matches')
        .select('day:day_id(play_date, course_name, course_par)')
        .eq('id', matchId)
        .maybeSingle(),
      supabase
        .from('match_holes')
        .select('hole_number, gross_score, stableford_pts')
        .eq('match_id', matchId)
        .eq('player_id', pid)
        .order('hole_number'),
      supabase
        .from('hole_stats')
        .select('hole_number, fairway_direction, putts')
        .eq('match_id', matchId)
        .eq('player_id', pid),
      supabase
        .from('shots')
        .select('hole_number, clubs(short)')
        .eq('match_id', matchId)
        .eq('player_id', pid)
        .order('id'),
    ]);

    const day = (matchRes.data as any)?.day;
    if (day) {
      setCourseName(day.course_name ?? 'Unknown Course');
      setPlayDate(day.play_date ?? null);
      setCoursePar(day.course_par ?? 72);
    }

    // Index stats and shots by hole
    const statByHole: Record<number, { fairwayDirection: 'left' | 'centre' | 'right' | null; putts: number | null }> = {};
    for (const r of (statsRes.data ?? []) as any[]) {
      statByHole[r.hole_number] = { fairwayDirection: r.fairway_direction ?? null, putts: r.putts ?? null };
    }

    const clubsByHole: Record<number, string[]> = {};
    for (const r of (shotsRes.data ?? []) as any[]) {
      const hn = r.hole_number as number;
      if (!clubsByHole[hn]) clubsByHole[hn] = [];
      const short = (r.clubs as any)?.short;
      if (short) clubsByHole[hn].push(short);
    }

    const rows: HoleRow[] = ((holesRes.data ?? []) as any[]).map(r => ({
      holeNumber:       r.hole_number,
      gross:            r.gross_score ?? null,
      stablefordPts:    r.stableford_pts ?? null,
      fairwayDirection: statByHole[r.hole_number]?.fairwayDirection ?? null,
      putts:            statByHole[r.hole_number]?.putts ?? null,
      clubs:            clubsByHole[r.hole_number] ?? [],
    }));

    setHoles(rows);
    setLoading(false);
  }

  const totalGross      = holes.reduce((s, h) => s + (h.gross ?? 0), 0);
  const totalPts        = holes.reduce((s, h) => s + (h.stablefordPts ?? 0), 0);
  const totalPutts      = holes.reduce((s, h) => s + (h.putts ?? 0), 0);
  const puttsTracked    = holes.filter(h => h.putts != null).length;
  const fairwaysTracked = holes.filter(h => h.fairwayDirection != null).length;
  const fairwaysHit     = holes.filter(h => h.fairwayDirection === 'centre').length;
  const holesPlayed     = holes.filter(h => h.gross != null).length;
  const toPar           = holesPlayed >= 18 ? totalGross - coursePar : null;

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
        <View style={{ alignItems: 'center' }}>
          <Text style={ss.title} numberOfLines={1}>{courseName}</Text>
          {playDate && <Text style={ss.subtitle}>{formatDate(playDate)}</Text>}
        </View>
        <View style={{ width: 56 }} />
      </View>

      <ScrollView contentContainerStyle={ss.scroll} showsVerticalScrollIndicator={false}>

        {/* Summary row */}
        <View style={ss.summaryRow}>
          <SumCard label="SCORE" value={String(totalGross)} sub={toPar != null ? toParStr(toPar) : undefined} subColor={toPar != null ? toParColor(toPar) : undefined} />
          <SumCard label="STABLEFORD" value={String(totalPts)} sub="pts" />
          {puttsTracked > 0 && (
            <SumCard label="PUTTS" value={String(totalPutts)} sub={`${puttsTracked} holes`} />
          )}
          {fairwaysTracked > 0 && (
            <SumCard label="FWY" value={`${fairwaysHit}/${fairwaysTracked}`} sub={`${Math.round((fairwaysHit / fairwaysTracked) * 100)}%`} />
          )}
        </View>

        {/* Column headers */}
        <View style={ss.tableHead}>
          <Text style={[ss.headCell, { width: 32 }]}>H</Text>
          <Text style={[ss.headCell, { width: 36 }]}>SCORE</Text>
          <Text style={[ss.headCell, { width: 36 }]}>PTS</Text>
          <Text style={[ss.headCell, { width: 32 }]}>FWY</Text>
          <Text style={[ss.headCell, { width: 28 }]}>P</Text>
          <Text style={[ss.headCell, { flex: 1 }]}>CLUBS</Text>
        </View>

        {holes.map((h, i) => (
          <View key={h.holeNumber} style={[ss.row, i % 2 === 0 && ss.rowAlt]}>
            <Text style={[ss.cell, ss.holeNum]}>{h.holeNumber}</Text>
            <Text style={[ss.cell, { width: 36, color: scoreCellColor(h.stablefordPts), fontWeight: '700' }]}>
              {h.gross ?? '—'}
            </Text>
            <View style={{ width: 36, alignItems: 'flex-start' }}>
              {h.stablefordPts != null
                ? <View style={[ss.ptsBadge, { backgroundColor: ptsBadgeBg(h.stablefordPts) }]}>
                    <Text style={[ss.ptsText, { color: ptsBadgeColor(h.stablefordPts) }]}>{h.stablefordPts}</Text>
                  </View>
                : <Text style={ss.cell}>—</Text>}
            </View>
            <Text style={[ss.cell, { width: 32, fontSize: 14 }]}>{fairwayIcon(h.fairwayDirection)}</Text>
            <Text style={[ss.cell, { width: 28 }]}>{h.putts ?? '—'}</Text>
            <Text style={[ss.cell, { flex: 1, color: colors.textMuted, fontSize: fonts.xs }]} numberOfLines={1}>
              {h.clubs.length > 0 ? h.clubs.join(' · ') : ''}
            </Text>
          </View>
        ))}

        {holes.length === 0 && (
          <View style={ss.empty}>
            <Text style={ss.emptyText}>No hole data recorded</Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function SumCard({ label, value, sub, subColor }: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <View style={ss.sumCard}>
      <Text style={ss.sumVal}>{value}</Text>
      <Text style={ss.sumLbl}>{label}</Text>
      {sub ? <Text style={[ss.sumSub, subColor ? { color: subColor } : {}]}>{sub}</Text> : null}
    </View>
  );
}

function fairwayIcon(dir: 'left' | 'centre' | 'right' | null) {
  if (dir === 'left')   return '◀';
  if (dir === 'centre') return '●';
  if (dir === 'right')  return '▶';
  return '—';
}

function scoreCellColor(pts: number | null) {
  if (pts == null) return colors.textSecondary;
  if (pts >= 4) return '#D4AF37';
  if (pts === 3) return colors.green;
  if (pts === 2) return colors.white;
  if (pts === 1) return '#f97316';
  return colors.red;
}

function ptsBadgeBg(pts: number) {
  if (pts >= 4) return 'rgba(212,175,55,0.15)';
  if (pts === 3) return 'rgba(74,222,128,0.12)';
  if (pts === 2) return 'rgba(59,130,246,0.12)';
  if (pts === 1) return 'rgba(249,115,22,0.12)';
  return 'rgba(248,113,113,0.12)';
}

function ptsBadgeColor(pts: number) {
  if (pts >= 4) return '#D4AF37';
  if (pts === 3) return colors.green;
  if (pts === 2) return '#3b82f6';
  if (pts === 1) return '#f97316';
  return colors.red;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
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
  back:     { fontSize: fonts.sm, fontWeight: '600', color: colors.gold },
  title:    { fontSize: fonts.md, fontWeight: '800', color: colors.white, maxWidth: 200, textAlign: 'center' },
  subtitle: { fontSize: fonts.xs, color: colors.textMuted, marginTop: 2 },

  scroll: { padding: spacing.md },

  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  sumCard: {
    flex: 1, backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.sm, alignItems: 'center',
  },
  sumVal: { fontSize: fonts.lg, fontWeight: '800', color: colors.gold },
  sumLbl: { fontSize: 8, fontWeight: '800', color: colors.textMuted, letterSpacing: 1, marginTop: 1 },
  sumSub: { fontSize: fonts.xs, color: colors.textMuted, marginTop: 1 },

  tableHead: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    marginBottom: 2,
  },
  headCell: { fontSize: 9, fontWeight: '800', color: colors.textMuted, letterSpacing: 1 },

  row:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: 8, borderRadius: radius.sm },
  rowAlt: { backgroundColor: 'rgba(255,255,255,0.02)' },
  cell:   { fontSize: fonts.sm, color: colors.textSecondary },
  holeNum:{ width: 32, fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted },

  ptsBadge: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  ptsText:  { fontSize: fonts.xs, fontWeight: '800' },

  empty:     { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: fonts.sm, color: colors.textMuted },
});
