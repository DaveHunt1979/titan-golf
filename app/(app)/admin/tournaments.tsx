import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, Share, Alert, Image, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import ConfirmDialog from '../../../src/components/ConfirmDialog';
import { goBack } from '../../../src/lib/navigation';
import { getFormatRules } from '../../../src/lib/tournamentFormat';

const GOLD = '#D4AF37';
const RED = '#f87171';
const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

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
  const [deleteTarget, setDeleteTarget] = useState<Competition | null>(null);
  const [deleting, setDeleting]         = useState(false);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

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

  if (loading || !fontsLoaded) return (
    <View style={{ flex:1, backgroundColor:'#000', alignItems:'center', justifyContent:'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  async function deleteTournament() {
    if (!deleteTarget) return;
    setDeleting(true);
    // competition_players/competition_days/matches/match_holes all cascade
    // off competitions(id) ON DELETE CASCADE — see supabase/schema.sql.
    const { error } = await supabase.from('competitions').delete().eq('id', deleteTarget.id);
    setDeleting(false);
    setDeleteTarget(null);
    if (error) { Alert.alert('Error', error.message); return; }
    load();
  }

  function sharePin(comp: Competition) {
    const pin = String(comp.pin ?? '').replace(/[^0-9]/g, '');
    if (!pin) { Alert.alert('No PIN', 'This competition has no PIN set.'); return; }
    const formatted = `${pin.slice(0, 3)} ${pin.slice(3)}`;
    Share.share({ message: `Join ${comp.name} on Titan Golf — your PIN is: ${formatted}` });
  }

  // Active/draft tournaments now live under the Live Tournaments tile —
  // History is purely the record of finished ones (+ champions/PINs).
  const completed = comps.filter(c => c.status === 'complete');

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/admin/hub-tournament')} hitSlop={hit} style={s.headerLeft}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} />
          <Text style={s.headerTitle}>TOURNAMENTS</Text>
          <Text style={s.headerSub}>admin</Text>
        </View>
        <TouchableOpacity
          style={s.newBtn}
          onPress={() => router.push('/(app)/admin/build' as any)}
          activeOpacity={0.8}
        >
          <Text style={s.newBtnText}>+ NEW</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={GOLD}
          />
        }
      >
        {/* Champions wall */}
        {champions.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>CHAMPIONS</Text>
            {(() => {
              const years = [...new Set(champions.map(c => c.year))].sort((a, b) => b - a);
              return years.map(year => {
                const yearChamps = champions.filter(c => c.year === year);
                const tour   = yearChamps.find(c => c.award_name.toLowerCase().includes('tour') || c.award_name.toLowerCase().includes('champion'));
                const kronos = yearChamps.find(c => c.award_name.toLowerCase().includes('kronos'));
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
                        <View style={[
                          s.champRow,
                          { borderTopWidth: tour ? 1 : 0, borderTopColor: '#1c1c1c', marginTop: tour ? 10 : 0, paddingTop: tour ? 10 : 0 },
                        ]}>
                          <Text style={s.champAward}>⚡ {kronos.award_name}</Text>
                          <Text style={s.champName}>{kronos.winner_name}</Text>
                          {kronos.detail && <Text style={s.champDetail}>{kronos.detail}</Text>}
                        </View>
                      )}
                      {yearChamps.filter(c => c !== tour && c !== kronos).map((ch, i) => (
                        <View key={i} style={[s.champRow, { borderTopWidth: 1, borderTopColor: '#1c1c1c', marginTop: 10, paddingTop: 10 }]}>
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

        {/* Completed competitions */}
        {completed.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>COMPLETED</Text>
            {completed.map(c => <CompCard key={c.id} comp={c} onSharePin={() => sharePin(c)} onDelete={() => setDeleteTarget(c)} />)}
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

      <ConfirmDialog
        visible={deleteTarget !== null}
        title="Delete Tournament"
        message={`Delete "${deleteTarget?.name}"? This removes all its days, matches and scores. This cannot be undone.`}
        confirmLabel={deleting ? 'Deleting…' : 'Delete Tournament'}
        destructive
        onConfirm={deleteTournament}
        onCancel={() => setDeleteTarget(null)}
      />
    </View>
  );
}

function CompCard({ comp, onSharePin, onDelete }: { comp: Competition; onSharePin: () => void; onDelete: () => void }) {
  const statusColor = GOLD;
  const statusLabel = 'COMPLETE';
  const pin = String(comp.pin ?? '').replace(/[^0-9]/g, '');
  const courses = (comp.days ?? []).map((d: any) => d.course_name).filter(Boolean);
  const uniqueCourses = [...new Set(courses)];

  return (
    <View style={s.compCard}>
      <View style={s.compCardTop}>
        <View style={{ flex: 1 }}>
          <Text style={s.compName}>{comp.name}</Text>
          <Text style={s.compFormat}>{getFormatRules(comp.format).label}</Text>
          {uniqueCourses.length > 0 && (
            <Text style={s.compMeta}>
              {uniqueCourses.slice(0, 2).join(' · ')}{uniqueCourses.length > 2 ? ` +${uniqueCourses.length - 2}` : ''}
            </Text>
          )}
          <Text style={s.compMeta}>{formatDate(comp.created_at)}</Text>
        </View>
        <View style={[s.statusBadge, { borderColor: statusColor, backgroundColor: statusColor + '1A' }]}>
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
      <TouchableOpacity style={s.deleteBtn} onPress={onDelete} activeOpacity={0.8}>
        <Text style={s.deleteBtnText}>Delete</Text>
      </TouchableOpacity>
    </View>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

const hit = { top: 12, bottom: 12, left: 12, right: 12 };

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  headerLeft:   { minWidth: 70, alignItems: 'flex-start' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerRight:  { minWidth: 70, alignItems: 'flex-end' },
  newBtn: {
    backgroundColor: GOLD + '1A', borderWidth: 1, borderColor: GOLD + '55',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5,
  },
  newBtnText: { fontFamily: FFB, fontSize: 11, color: GOLD, letterSpacing: 1 },
  headerLogo:   { width: 28, height: 28, marginBottom: 2 },
  headerTitle:  { fontFamily: FFB, fontSize: 15, color: '#fff', letterSpacing: 0.5 },
  headerSub:    { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 1, textTransform: 'uppercase' },
  back:         { fontFamily: FFB, fontSize: 14, color: GOLD },

  scroll: { padding: 20, paddingBottom: 48 },

  section:      { marginBottom: 28 },
  sectionLabel: {
    fontFamily: FFB, fontSize: 10, color: '#fff',
    letterSpacing: 1.5, marginBottom: 10, textTransform: 'uppercase',
  },

  // Champions
  champCard: {
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: GOLD + '44',
    padding: 16, marginBottom: 10,
  },
  champYear:   { fontFamily: FFB, fontSize: 10, color: GOLD, letterSpacing: 2, marginBottom: 10, textTransform: 'uppercase' },
  champInner:  {},
  champRow:    {},
  champAward:  { fontFamily: FFB, fontSize: 10, color: '#fff', letterSpacing: 1, textTransform: 'uppercase' },
  champName:   { fontFamily: FFB, fontSize: 18, color: '#fff', marginTop: 2 },
  champDetail: { fontFamily: FFB, fontSize: 11, color: '#fff', marginTop: 2 },

  // Competition cards
  compCard: {
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c',
    padding: 16, marginBottom: 10,
  },
  compCardTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  compName:    { fontFamily: FFB, fontSize: 16, color: '#fff', marginBottom: 2 },
  compFormat:  { fontFamily: FFB, fontSize: 13, color: '#fff', marginBottom: 2 },
  compMeta:    { fontFamily: FFB, fontSize: 11, color: '#fff' },

  statusBadge: {
    borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 3,
  },
  statusText: { fontFamily: FFB, fontSize: 10, letterSpacing: 1 },

  pinRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0a0a0a', borderRadius: 10,
    padding: 12,
  },
  pinLabel: { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 1, textTransform: 'uppercase' },
  pinValue: { fontFamily: FFB, fontSize: 20, color: GOLD, letterSpacing: 4, marginTop: 2 },
  shareBtn: {
    backgroundColor: GOLD + '1A', borderWidth: 1, borderColor: GOLD + '44',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6,
  },
  shareBtnText: { fontFamily: FFB, color: GOLD, fontSize: 11 },

  deleteBtn:     { marginTop: 8, backgroundColor: RED + '14', borderWidth: 1, borderColor: RED + '40', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  deleteBtnText: { fontFamily: FFB, fontSize: 12, color: RED, letterSpacing: 1 },

  empty:      { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontFamily: FFB, fontSize: 18, color: '#fff' },
  emptySub:   { fontFamily: FFB, fontSize: 14, color: '#fff', textAlign: 'center', paddingHorizontal: 28 },
});
