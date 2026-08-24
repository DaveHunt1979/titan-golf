import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, Share, Alert, Image, ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import ConfirmDialog from '../../../src/components/ConfirmDialog';
import { goBack } from '../../../src/lib/navigation';
import { getFormatRules } from '../../../src/lib/tournamentFormat';

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

type Competition = {
  id: string; name: string; format: string; pin: string | null; status: string;
  days?: { course_name: string | null }[];
};

// Amendments to a tournament that's already LIVE happen here — not via
// History, which is now purely for finished tournaments/PINs. Late roster
// changes, drawing pairings and activating each day still route into
// admin/draw.tsx.
// DRAFT tournaments also show up here now (Rick's brief, 2026-08-22, section
// 4.8) — previously there was no way to find your way back to an unfinished
// draft at all once you'd navigated away from Build. "Resume Building"
// routes straight back into admin/build.tsx's now-edit-capable wizard.
export default function LiveTournaments() {
  const router = useRouter();
  const { societyId, loading: societyLoading } = useAdminSociety();
  const [comps, setComps]           = useState<Competition[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Competition | null>(null);
  const [deleting, setDeleting]         = useState(false);
  const [completeTarget, setCompleteTarget] = useState<Competition | null>(null);
  const [completing, setCompleting]         = useState(false);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const load = useCallback(async () => {
    if (!societyId) return;
    const { data } = await supabase
      .from('competitions')
      .select('id, name, format, pin, status, competition_days(course_name)')
      .eq('society_id', societyId)
      .in('status', ['active', 'draft'])
      .order('created_at', { ascending: false });
    if (data) setComps(data.map((c: any) => ({ ...c, days: c.competition_days ?? [] })));
    setLoading(false);
    setRefreshing(false);
  }, [societyId]);

  useEffect(() => { if (!societyLoading) load(); }, [societyLoading, load]);
  useFocusEffect(useCallback(() => { if (!societyLoading) load(); }, [societyLoading, load]));

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  async function deleteTournament() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('competitions').delete().eq('id', deleteTarget.id);
    setDeleting(false);
    setDeleteTarget(null);
    if (error) { Alert.alert('Error', error.message); return; }
    load();
  }

  async function completeTournament() {
    if (!completeTarget) return;
    setCompleting(true);
    const { error } = await supabase.from('competitions').update({ status: 'complete' }).eq('id', completeTarget.id);
    setCompleting(false);
    setCompleteTarget(null);
    if (error) { Alert.alert('Error', error.message); return; }
    load();
  }

  function sharePin(comp: Competition) {
    const pin = String(comp.pin ?? '').replace(/[^0-9]/g, '');
    if (!pin) { Alert.alert('No PIN', 'This competition has no PIN set.'); return; }
    Share.share({ message: `Join ${comp.name} on Titan Golf — your PIN is: ${pin.slice(0, 3)} ${pin.slice(3)}` });
  }

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/admin/hub-tournament')} hitSlop={hit} style={s.headerLeft}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} />
          <Text style={s.headerTitle}>LIVE TOURNAMENTS</Text>
          <Text style={s.headerSub}>admin</Text>
        </View>
        <View style={s.headerRight} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={GOLD} />}
      >
        {comps.map(c => {
          const pin = String(c.pin ?? '').replace(/[^0-9]/g, '');
          const courses = [...new Set((c.days ?? []).map(d => d.course_name).filter(Boolean))];
          const isDraft = c.status === 'draft';
          return (
            <View key={c.id} style={s.compCard}>
              <View style={s.compCardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={s.compName}>{c.name}</Text>
                  <Text style={s.compFormat}>{getFormatRules(c.format).label}</Text>
                  {courses.length > 0 && (
                    <Text style={s.compMeta}>{courses.slice(0, 2).join(' · ')}{courses.length > 2 ? ` +${courses.length - 2}` : ''}</Text>
                  )}
                </View>
                <View style={[s.statusBadge, isDraft && s.statusBadgeDraft]}>
                  <Text style={[s.statusText, isDraft && s.statusTextDraft]}>{isDraft ? 'DRAFT' : 'LIVE'}</Text>
                </View>
              </View>

              {isDraft ? (
                <>
                  <TouchableOpacity style={s.manageBtn} onPress={() => router.push(`/(app)/admin/build?id=${c.id}` as any)} activeOpacity={0.8}>
                    <Text style={s.manageBtnText}>RESUME BUILDING</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.deleteBtn} onPress={() => setDeleteTarget(c)} activeOpacity={0.8}>
                    <Text style={s.deleteBtnText}>Delete</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={s.pinRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.pinLabel}>TOURNAMENT PIN</Text>
                      <Text style={s.pinValue}>{pin ? `${pin.slice(0, 3)} ${pin.slice(3)}` : '—'}</Text>
                    </View>
                    {pin && (
                      <TouchableOpacity style={s.shareBtn} onPress={() => sharePin(c)} activeOpacity={0.8}>
                        <Text style={s.shareBtnText}>Share PIN</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <TouchableOpacity style={s.manageBtn} onPress={() => router.push(`/(app)/admin/draw?id=${c.id}` as any)} activeOpacity={0.8}>
                    <Text style={s.manageBtnText}>MAKE AMENDS</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.manageBtn} onPress={() => router.push(`/(app)/admin/prizes?id=${c.id}` as any)} activeOpacity={0.8}>
                    <Text style={s.manageBtnText}>PRIZE CATEGORIES</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.manageBtn} onPress={() => router.push(`/(app)/admin/news?id=${c.id}` as any)} activeOpacity={0.8}>
                    <Text style={s.manageBtnText}>TITAN NEWS</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.completeBtn} onPress={() => setCompleteTarget(c)} activeOpacity={0.8}>
                    <Text style={s.completeBtnText}>COMPLETE TOURNAMENT</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.deleteBtn} onPress={() => setDeleteTarget(c)} activeOpacity={0.8}>
                    <Text style={s.deleteBtnText}>Delete</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          );
        })}

        {comps.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>⛳</Text>
            <Text style={s.emptyTitle}>No tournaments yet</Text>
            <Text style={s.emptySub}>Start one in Build and it'll show up here — as a draft, then live</Text>
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

      <ConfirmDialog
        visible={completeTarget !== null}
        title="Complete Tournament"
        message={`Mark "${completeTarget?.name}" as finished and move it to History/Archive? Players will still be able to view results.`}
        confirmLabel={completing ? 'Completing…' : 'Complete Tournament'}
        onConfirm={completeTournament}
        onCancel={() => setCompleteTarget(null)}
      />
    </View>
  );
}

const hit = { top: 12, bottom: 12, left: 12, right: 12 };

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  headerLeft:   { width: 70, alignItems: 'flex-start' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerRight:  { width: 70 },
  headerLogo:   { width: 28, height: 28, marginBottom: 2 },
  headerTitle:  { fontFamily: FFB, fontSize: 14, color: '#fff', letterSpacing: 0.5 },
  headerSub:    { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 1, textTransform: 'uppercase' },
  back:         { fontFamily: FFB, fontSize: 14, color: GOLD },

  scroll: { padding: 20, paddingBottom: 48 },

  compCard: { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 16, marginBottom: 10 },
  compCardTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  compName:    { fontFamily: FFB, fontSize: 16, color: '#fff', marginBottom: 2 },
  compFormat:  { fontFamily: FFB, fontSize: 13, color: '#fff', marginBottom: 2 },
  compMeta:    { fontFamily: FFB, fontSize: 11, color: '#fff' },

  statusBadge:      { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, borderColor: GREEN, backgroundColor: GREEN + '1A' },
  statusText:       { fontFamily: FFB, fontSize: 10, letterSpacing: 1, color: GREEN },
  statusBadgeDraft: { borderColor: GOLD, backgroundColor: GOLD + '1A' },
  statusTextDraft:  { color: GOLD },

  pinRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0a0a0a', borderRadius: 10, padding: 12 },
  pinLabel: { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 1, textTransform: 'uppercase' },
  pinValue: { fontFamily: FFB, fontSize: 20, color: GOLD, letterSpacing: 4, marginTop: 2 },
  shareBtn: { backgroundColor: GOLD + '1A', borderWidth: 1, borderColor: GOLD + '44', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  shareBtnText: { fontFamily: FFB, color: GOLD, fontSize: 11 },

  manageBtn:     { marginTop: 10, backgroundColor: GOLD + '1A', borderWidth: 1, borderColor: GOLD + '55', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  manageBtnText: { fontFamily: FFB, fontSize: 12, color: GOLD, letterSpacing: 1 },
  completeBtn:     { marginTop: 8, backgroundColor: GREEN + '14', borderWidth: 1, borderColor: GREEN + '55', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  completeBtnText: { fontFamily: FFB, fontSize: 12, color: GREEN, letterSpacing: 1 },
  deleteBtn:     { marginTop: 8, backgroundColor: RED + '14', borderWidth: 1, borderColor: RED + '40', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  deleteBtnText: { fontFamily: FFB, fontSize: 12, color: RED, letterSpacing: 1 },

  empty:      { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontFamily: FFB, fontSize: 18, color: '#fff' },
  emptySub:   { fontFamily: FFB, fontSize: 14, color: '#fff', textAlign: 'center', paddingHorizontal: 28 },
});
