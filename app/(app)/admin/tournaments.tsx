import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Share, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';

type Competition = {
  id: string;
  name: string;
  year: number | null;
  format: string;
  status: string;
  created_at: string;
  pin?: string | null;
  days?: { course_name: string | null; play_date: string | null }[];
};

type Champion = {
  year: number;
  award_name: string;
  winner_name: string;
  winner_type: string;
  detail: string | null;
};

export default function AdminTournaments() {
  const router = useRouter();
  const { societyId, loading: societyLoading } = useAdminSociety();
  const [comps, setComps]           = useState<Competition[]>([]);
  const [champions, setChampions]   = useState<Champion[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!societyId) return;
    const [{ data: compsData }, { data: champsData }] = await Promise.all([
      supabase
        .from('competitions')
        .select('id, name, year, format, status, created_at, pin, competition_days(course_name, play_date)')
        .eq('society_id', societyId)
        .order('created_at', { ascending: false }),
      supabase
        .from('champions')
        .select('year, award_name, winner_name, winner_type, detail')
        .eq('society_id', societyId)
        .order('year', { ascending: false }),
    ]);
    if (compsData) setComps(compsData.map((c: any) => ({ ...c, days: c.competition_days ?? [] })));
    if (champsData) setChampions(champsData as Champion[]);
    setLoading(false);
    setRefreshing(false);
  }, [societyId]);

  useEffect(() => { if (!societyLoading) load(); }, [societyLoading, load]);

  function sharePin(comp: Competition) {
    const pin = String(comp.pin ?? '').replace(/[^0-9]/g, '');
    if (!pin) { Alert.alert('No PIN', 'This competition has no PIN set.'); return; }
    const formatted = `${pin.slice(0, 3)} ${pin.slice(3)}`;
    Share.share({ message: `Join ${comp.name} on Titan Golf — your PIN is: ${formatted}` });
  }

  const active    = comps.filter(c => c.status === 'active');
  const completed = comps.filter(c => c.status === 'complete');
  const draft     = comps.filter(c => c.status === 'draft');

  if (loading || societyLoading) {
    return <View style={s.container}><Text style={s.loading}>Loading…</Text></View>;
  }

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Tournaments</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />}
      >
        {/* Champions wall */}
        {champions.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>CHAMPIONS</Text>
            {(() => {
              const years = [...new Set(champions.map(c => c.year))].sort((a, b) => b - a);
              return years.map(year => {
                const yearChamps = champions.filter(c => c.year === year);
                const tour    = yearChamps.find(c => c.award_name.toLowerCase().includes('tour') || c.award_name.toLowerCase().includes('champion'));
                const kronos  = yearChamps.find(c => c.award_name.toLowerCase().includes('kronos'));
                return (
                  <View key={year} style={s.champCard}>
                    <Text style={s.champYear}>{year}</Text>
                    <View style={s.champInner}>
                      {tour && (
                        <View style={s.champRow}>
                          <Text style={s.champAward}>🏆 {tour.award_name}</Text>
                          <Text style={s.champName}>{tour.winner_name}</Text>
                          {tour.detail && <Text style={s.champDetail}>{tour.detail}</Text>}
                        </View>
                      )}
                      {kronos && (
                        <View style={[s.champRow, { borderTopWidth: tour ? 1 : 0, borderTopColor: colors.border, marginTop: tour ? spacing.sm : 0, paddingTop: tour ? spacing.sm : 0 }]}>
                          <Text style={s.champAward}>⚡ {kronos.award_name}</Text>
                          <Text style={s.champName}>{kronos.winner_name}</Text>
                          {kronos.detail && <Text style={s.champDetail}>{kronos.detail}</Text>}
                        </View>
                      )}
                      {yearChamps.filter(c => c !== tour && c !== kronos).map((ch, i) => (
                        <View key={i} style={[s.champRow, { borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.sm, paddingTop: spacing.sm }]}>
                          <Text style={s.champAward}>🎖 {ch.award_name}</Text>
                          <Text style={s.champName}>{ch.winner_name}</Text>
                          {ch.detail && <Text style={s.champDetail}>{ch.detail}</Text>}
                        </View>
                      ))}
                    </View>
                  </View>
                );
              });
            })()}
          </View>
        )}

        {/* Active competitions */}
        {active.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>ACTIVE</Text>
            {active.map(c => <CompCard key={c.id} comp={c} onSharePin={() => sharePin(c)} />)}
          </View>
        )}

        {/* Draft competitions */}
        {draft.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>DRAFT</Text>
            {draft.map(c => <CompCard key={c.id} comp={c} onSharePin={() => sharePin(c)} />)}
          </View>
        )}

        {/* Completed competitions */}
        {completed.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>COMPLETED</Text>
            {completed.map(c => <CompCard key={c.id} comp={c} onSharePin={() => sharePin(c)} />)}
          </View>
        )}

        {comps.length === 0 && champions.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>🏆</Text>
            <Text style={s.emptyTitle}>No tournaments yet</Text>
            <Text style={s.emptySub}>Create competitions from the admin panel or website</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function CompCard({ comp, onSharePin }: { comp: Competition; onSharePin: () => void }) {
  const statusColor = comp.status === 'active' ? colors.green : comp.status === 'complete' ? colors.textMuted : colors.gold;
  const statusLabel = comp.status === 'active' ? 'LIVE' : comp.status === 'complete' ? 'DONE' : 'DRAFT';
  const pin = String(comp.pin ?? '').replace(/[^0-9]/g, '');
  const courses = (comp.days ?? []).map((d: any) => d.course_name).filter(Boolean);
  const uniqueCourses = [...new Set(courses)];

  return (
    <View style={s.compCard}>
      <View style={s.compCardTop}>
        <View style={{ flex: 1 }}>
          <Text style={s.compName}>{comp.name}</Text>
          {uniqueCourses.length > 0 && (
            <Text style={s.compMeta}>{uniqueCourses.slice(0, 2).join(' · ')}{uniqueCourses.length > 2 ? ` +${uniqueCourses.length - 2}` : ''}</Text>
          )}
          <Text style={s.compMeta}>{formatDate(comp.created_at)}</Text>
        </View>
        <View style={[s.statusBadge, { borderColor: statusColor }]}>
          <Text style={[s.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      {/* PIN row */}
      <View style={s.pinRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.pinLabel}>TOURNAMENT PIN</Text>
          <Text style={s.pinValue}>{pin ? `${pin.slice(0, 3)} ${pin.slice(3)}` : '—'}</Text>
        </View>
        {pin && (
          <TouchableOpacity style={s.shareBtn} onPress={onSharePin} activeOpacity={0.8}>
            <Text style={s.shareBtnText}>Share PIN</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.bg, paddingTop: 56 },
  loading:      { color: colors.textMuted, textAlign: 'center', marginTop: 80 },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, marginBottom: spacing.md },
  back:         { color: colors.gold, fontSize: fonts.md, fontWeight: '600' },
  headerTitle:  { fontSize: fonts.xl, fontWeight: '800', color: colors.white },
  section:      { paddingHorizontal: spacing.md, marginBottom: spacing.lg },
  sectionLabel: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.sm },
  champCard:    { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.goldBorder, padding: spacing.md, marginBottom: spacing.sm },
  champYear:    { fontSize: fonts.xs, fontWeight: '800', color: colors.gold, letterSpacing: 2, marginBottom: spacing.sm },
  champInner:   {},
  champRow:     {},
  champAward:   { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1 },
  champName:    { fontSize: fonts.lg, fontWeight: '800', color: colors.white, marginTop: 2 },
  champDetail:  { fontSize: fonts.xs, color: colors.textSecondary, marginTop: 2 },
  compCard:     { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  compCardTop:  { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.md },
  compName:     { fontSize: fonts.md, fontWeight: '700', color: colors.white, marginBottom: 2 },
  compMeta:     { fontSize: fonts.xs, color: colors.textMuted },
  statusBadge:  { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  statusText:   { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  pinRow:       { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: spacing.sm },
  pinLabel:     { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1 },
  pinValue:     { fontSize: fonts.lg, fontWeight: '800', color: colors.gold, letterSpacing: 4, marginTop: 2 },
  shareBtn:     { backgroundColor: colors.goldDim, borderWidth: 1, borderColor: colors.goldBorder, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  shareBtnText: { color: colors.gold, fontSize: fonts.xs, fontWeight: '700' },
  empty:        { alignItems: 'center', paddingTop: 80, gap: spacing.sm },
  emptyEmoji:   { fontSize: 48 },
  emptyTitle:   { fontSize: fonts.lg, fontWeight: '700', color: colors.white },
  emptySub:     { fontSize: fonts.sm, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.xl },
});
