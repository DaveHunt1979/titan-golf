import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { goBack } from '../../../src/lib/navigation';
import { titanLogo, getSocietyLogo } from '../../../src/lib/assets';
import { usePlatformAdmin } from '../../../src/lib/usePlatformAdmin';

const GOLD = '#D4AF37';
const FF   = 'JUSTSans';
const FFB  = 'JUSTSans-ExBold';

interface SocietyRow {
  id: string;
  name: string;
  logo_url: string | null;
  primary_color: string | null;
  memberCount: number;
}

export default function SocietiesScreen() {
  const router = useRouter();
  const { isPlatformAdmin, loading: platformLoading } = usePlatformAdmin();
  const [societies, setSocieties] = useState<SocietyRow[]>([]);
  const [loading, setLoading]     = useState(true);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const load = useCallback(async () => {
    const [{ data: socs }, { data: members }] = await Promise.all([
      supabase.from('societies').select('id,name,logo_url,primary_color').order('name'),
      supabase.from('society_members').select('society_id'),
    ]);
    const counts: Record<string, number> = {};
    (members as any[] ?? []).forEach(m => { counts[m.society_id] = (counts[m.society_id] ?? 0) + 1; });
    setSocieties(((socs ?? []) as any[]).map(s => ({
      id: s.id, name: s.name, logo_url: s.logo_url, primary_color: s.primary_color,
      memberCount: counts[s.id] ?? 0,
    })));
    setLoading(false);
  }, []);

  useEffect(() => { if (isPlatformAdmin) load(); }, [isPlatformAdmin, load]);

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

  return (
    <View style={s.container}>
      <StatusBar style="light" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/admin/hub-platform')} hitSlop={hit} style={s.headerLeft}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerTitle}>Societies</Text>
          <Text style={s.headerSub}>god admin</Text>
        </View>
        <View style={s.headerRight} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={GOLD} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          <Text style={s.sectionLabel}>{societies.length} SOCIETIES ON TITAN</Text>
          {societies.map(soc => {
            const logo = getSocietyLogo(soc.name);
            return (
              <TouchableOpacity
                key={soc.id}
                style={s.card}
                onPress={() => router.push(`/(app)/admin/society-detail/${soc.id}` as any)}
                activeOpacity={0.75}
              >
                <View style={[s.logoCircle, { borderColor: soc.primary_color ?? GOLD }]}>
                  {logo
                    ? <Image source={logo} style={s.logoImg} resizeMode="contain" />
                    : soc.logo_url
                      ? <Image source={{ uri: soc.logo_url }} style={s.logoImg} resizeMode="contain" />
                      : <Text style={[s.logoInitial, { color: soc.primary_color ?? GOLD }]}>{soc.name[0]}</Text>
                  }
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.societyName}>{soc.name}</Text>
                  <Text style={s.societyMeta}>{soc.memberCount} member{soc.memberCount === 1 ? '' : 's'}</Text>
                </View>
                <Text style={s.arrow}>›</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const hit = { top: 12, bottom: 12, left: 12, right: 12 };

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  headerLeft:   { flex: 1, alignItems: 'flex-start' },
  headerCenter: { flex: 2, alignItems: 'center' },
  headerRight:  { flex: 1, alignItems: 'flex-end' },
  headerLogo:   { width: 24, height: 24, marginBottom: 2 },
  back:         { fontSize: 14, color: GOLD, fontFamily: FFB },
  headerTitle:  { fontSize: 15, color: '#fff', fontFamily: FFB, letterSpacing: 0.5 },
  headerSub:    { fontSize: 9, color: GOLD, fontFamily: FFB },

  scroll: { padding: 20, paddingBottom: 60 },
  sectionLabel: { fontSize: 10, fontFamily: FFB, color: '#fff', letterSpacing: 2, marginBottom: 10 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingVertical: 14, paddingHorizontal: 16, marginBottom: 10,
  },
  logoCircle: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  logoImg: { width: 32, height: 32 },
  logoInitial: { fontSize: 18, fontFamily: FFB },
  societyName: { fontSize: 15, fontFamily: FFB, color: '#fff' },
  societyMeta: { fontSize: 12, fontFamily: FFB, color: '#888', marginTop: 2 },
  arrow: { fontSize: 22, color: '#fff' },

  emptyTitle: { fontSize: 18, fontFamily: FFB, color: '#fff', marginBottom: 8 },
  emptyHint: { fontSize: 13, fontFamily: FFB, color: '#888', textAlign: 'center' },
  emptyBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, marginTop: 16 },
  emptyBtnText: { fontSize: 14, fontFamily: FFB, color: '#000' },
});
