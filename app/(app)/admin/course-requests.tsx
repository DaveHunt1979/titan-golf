import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { goBack } from '../../../src/lib/navigation';
import { titanLogo } from '../../../src/lib/assets';
import { usePlatformAdmin } from '../../../src/lib/usePlatformAdmin';

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';

interface RequestRow {
  id: string;
  course_name: string;
  club_location: string | null;
  notes: string | null;
  status: 'pending' | 'fulfilled' | 'declined';
  created_at: string;
  society_name: string;
  requester_name: string;
}

export default function CourseRequestsScreen() {
  const router = useRouter();
  const { isPlatformAdmin, loading: platformLoading } = usePlatformAdmin();
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [busyId, setBusyId]     = useState<string | null>(null);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('course_requests')
      .select('id,course_name,club_location,notes,status,created_at,societies(name),players(display_name)')
      .order('created_at', { ascending: false });
    setRequests(((data ?? []) as any[]).map(r => ({
      id: r.id,
      course_name: r.course_name,
      club_location: r.club_location,
      notes: r.notes,
      status: r.status,
      created_at: r.created_at,
      society_name: r.societies?.name ?? '—',
      requester_name: r.players?.display_name ?? '—',
    })));
    setLoading(false);
  }, []);

  useEffect(() => { if (isPlatformAdmin) load(); }, [isPlatformAdmin, load]);

  async function resolve(id: string, status: 'fulfilled' | 'declined') {
    setBusyId(id);
    const { error } = await supabase.from('course_requests')
      .update({ status, resolved_at: new Date().toISOString() } as any)
      .eq('id', id);
    setBusyId(null);
    if (error) { Alert.alert('Error', error.message); return; }
    await load();
  }

  if (!fontsLoaded || platformLoading) {
    return (
      <View style={[s.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={GOLD} size="large" />
      </View>
    );
  }

  if (!isPlatformAdmin) {
    return (
      <View style={[s.container, { alignItems: 'center', justifyContent: 'center', padding: 30 }]}>
        <StatusBar style="light" />
        <Text style={s.emptyTitle}>Not available</Text>
        <Text style={s.emptyHint}>This is a Dave/Rick-only screen.</Text>
        <TouchableOpacity style={s.emptyBtn} onPress={() => goBack(router, '/(app)/admin/hub-platform')} activeOpacity={0.8}>
          <Text style={s.emptyBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const pending = requests.filter(r => r.status === 'pending');
  const resolved = requests.filter(r => r.status !== 'pending');

  return (
    <View style={s.container}>
      <StatusBar style="light" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/admin/hub-platform')} hitSlop={hit} style={s.headerLeft}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerTitle}>Course Requests</Text>
          <Text style={s.headerSub}>god admin</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={GOLD} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          <Text style={s.sectionLabel}>{pending.length} PENDING</Text>
          {pending.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>📭</Text>
              <Text style={s.emptyHint}>No pending requests.</Text>
            </View>
          ) : pending.map(r => (
            <View key={r.id} style={s.card}>
              <Text style={s.courseName}>{r.course_name}</Text>
              <Text style={s.meta}>{r.requester_name} · {r.society_name}</Text>
              {!!r.notes && <Text style={s.notes}>{r.notes}</Text>}
              <View style={s.btnRow}>
                <TouchableOpacity
                  style={[s.actionBtn, { borderColor: GREEN + '55', backgroundColor: GREEN + '15' }]}
                  onPress={() => resolve(r.id, 'fulfilled')}
                  disabled={busyId === r.id}
                  activeOpacity={0.8}
                >
                  {busyId === r.id ? <ActivityIndicator size="small" color={GREEN} /> : <Text style={[s.actionBtnText, { color: GREEN }]}>Mark Fulfilled</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.actionBtn, { borderColor: RED + '55', backgroundColor: RED + '15' }]}
                  onPress={() => resolve(r.id, 'declined')}
                  disabled={busyId === r.id}
                  activeOpacity={0.8}
                >
                  <Text style={[s.actionBtnText, { color: RED }]}>Decline</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          {resolved.length > 0 && (
            <>
              <Text style={[s.sectionLabel, { marginTop: 24 }]}>RESOLVED</Text>
              {resolved.map(r => (
                <View key={r.id} style={[s.card, { opacity: 0.6 }]}>
                  <Text style={s.courseName}>{r.course_name}</Text>
                  <Text style={s.meta}>{r.requester_name} · {r.society_name}</Text>
                  <Text style={[s.statusTag, { color: r.status === 'fulfilled' ? GREEN : RED }]}>
                    {r.status.toUpperCase()}
                  </Text>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}
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
  headerLeft: { width: 60 },
  headerCenter: { alignItems: 'center' },
  headerLogo: { width: 24, height: 24, marginBottom: 2 },
  headerTitle: { fontSize: 15, color: '#fff', fontFamily: FFB, letterSpacing: 0.5 },
  headerSub: { fontSize: 9, color: GOLD, fontFamily: FFB },
  back: { fontSize: 14, color: GOLD, fontFamily: FFB },

  scroll: { padding: 20, paddingBottom: 60 },
  sectionLabel: { fontSize: 10, fontFamily: FFB, color: '#fff', letterSpacing: 2, marginBottom: 10 },

  card: {
    backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c',
    padding: 16, marginBottom: 10,
  },
  courseName: { fontSize: 16, fontFamily: FFB, color: '#fff' },
  meta: { fontSize: 12, fontFamily: FFB, color: '#888', marginTop: 4 },
  notes: { fontSize: 13, fontFamily: FF, color: '#ccc', marginTop: 8, lineHeight: 18 },
  statusTag: { fontSize: 11, fontFamily: FFB, marginTop: 8, letterSpacing: 1 },

  btnRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  actionBtn: { flex: 1, borderRadius: 10, borderWidth: 1, paddingVertical: 10, alignItems: 'center' },
  actionBtnText: { fontSize: 13, fontFamily: FFB },

  empty: { alignItems: 'center', paddingTop: 40 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontFamily: FFB, color: '#fff', marginBottom: 8 },
  emptyHint: { fontSize: 13, fontFamily: FFB, color: '#888', textAlign: 'center' },
  emptyBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, marginTop: 16 },
  emptyBtnText: { fontSize: 14, fontFamily: FFB, color: '#000' },
});
