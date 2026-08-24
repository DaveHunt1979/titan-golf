import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Platform, Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { goBack } from '../../../src/lib/navigation';
import PrizeCategoriesEditor from '../../../src/components/PrizeCategoriesEditor';

const GOLD  = '#D4AF37';
const FF   = 'JUSTSans';
const FFB  = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

// Thin screen wrapper — the actual category CRUD lives in
// PrizeCategoriesEditor so the Tournament Builder can reuse the exact same
// component as one of its own steps (Rick's brief, section 4.7) instead of
// a second prize system.
export default function AdminPrizesScreen() {
  const { id: competitionId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    [FF]:  require('../../../assets/fonts/JUSTSans-Regular.otf'),
    [FFB]: require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [compName, setCompName] = useState('');
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    if (!competitionId) return;
    const { data } = await supabase.from('competitions').select('name').eq('id', competitionId).single();
    if (data) setCompName((data as any).name);
    setLoading(false);
  }, [competitionId]);

  useEffect(() => { load(); }, [load]);

  if (!fontsLoaded || loading) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" />
      <ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, `/(app)/admin/draw?id=${competitionId}`)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Image source={titanLogo} style={s.logo} resizeMode="contain" />
          <Text style={s.headerTitle}>PRIZE CATEGORIES</Text>
          <Text style={s.headerSub} numberOfLines={1}>{compName}</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <PrizeCategoriesEditor competitionId={competitionId} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 32, paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  back:        { fontFamily: FFB, fontSize: 13, color: GOLD },
  logo:        { width: 24, height: 24, marginBottom: 2 },
  headerTitle: { fontFamily: FFB, fontSize: 12, color: '#fff', letterSpacing: 1 },
  headerSub:   { fontFamily: FF, fontSize: 11, color: '#888', marginTop: 2, maxWidth: 160, textAlign: 'center' },
  scroll:      { padding: 16, paddingBottom: 60 },
});
