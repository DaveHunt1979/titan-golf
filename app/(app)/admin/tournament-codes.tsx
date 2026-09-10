import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Share, Clipboard, Alert, ActivityIndicator, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { titanLogo } from '../../../src/lib/assets';
import { goBack } from '../../../src/lib/navigation';

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const FFB   = 'JUSTSans-ExBold';

export default function TournamentCodesScreen() {
  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const router = useRouter();
  const dc = useDynamicColors();
  const { societyId, loading: societyLoading } = useAdminSociety();

  const [societyName,          setSocietyName]          = useState('');
  const [tourCode,             setTourCode]             = useState('');
  const [activeTournamentName, setActiveTournamentName] = useState('');
  const [activeTournamentPin,  setActiveTournamentPin]  = useState('');
  const [loading,              setLoading]              = useState(true);
  const [generatingCode,       setGeneratingCode]       = useState(false);

  useEffect(() => {
    if (societyLoading) return;
    if (!societyId) { setLoading(false); return; }
    (async () => {
      try {
        const [{ data }, { data: activeComp }] = await Promise.all([
          supabase.from('societies').select('name, tour_join_code').eq('id', societyId).single(),
          supabase.from('competitions').select('name, pin').eq('society_id', societyId).eq('status', 'active').limit(1).maybeSingle(),
        ]);
        if (data) {
          setSocietyName((data as any).name ?? '');
          setTourCode((data as any).tour_join_code ?? '');
        }
        if (activeComp) {
          setActiveTournamentName((activeComp as any).name ?? '');
          setActiveTournamentPin(String((activeComp as any).pin ?? '').replace(/[^0-9]/g, ''));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [societyId, societyLoading]);

  async function generateTourCode() {
    setGeneratingCode(true);
    const { data, error } = await supabase.rpc('generate_area_codes', { p_society_id: societyId } as any);
    setGeneratingCode(false);
    if (error) { Alert.alert('Error', error.message); return; }
    const row = Array.isArray(data) ? data[0] : data;
    if (row) setTourCode(row.r_tour_code ?? '');
  }

  async function shareText(text: string, fallbackKey: string) {
    try {
      await Share.share({ message: text });
    } catch {
      Clipboard.setString(fallbackKey);
      Alert.alert('Copied', 'Copied to clipboard.');
    }
  }

  if (loading || societyLoading || !fontsLoaded) {
    return (
      <View style={[s.container, { backgroundColor: dc.bg, alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={dc.gold} size="large" />
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />

      <View style={[s.header, { borderBottomColor: dc.border }]}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/admin/hub-tournament')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[s.back, { color: dc.gold }]}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={[s.headerSub, { color: dc.gold }]}>TOURNAMENT CODES</Text>
        </View>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {activeTournamentName ? (
          <>
            <Text style={[s.sectionLabel, { color: dc.cardText }]}>ACTIVE TOURNAMENT</Text>
            <View style={[s.card, { backgroundColor: dc.card, borderColor: GREEN + '44' }]}>
              <View style={s.livePill}>
                <View style={s.liveDot} />
                <Text style={s.liveText}>LIVE</Text>
              </View>
              <Text style={[s.cardTitle, { color: dc.cardText }]}>{activeTournamentName}</Text>
              <Text style={[s.cardHint, { color: dc.cardText }]}>Players enter this PIN to unlock the Tour tab.</Text>
              {activeTournamentPin ? (
                <>
                  <Text style={[s.bigPin, { color: GREEN }]}>{activeTournamentPin.split('').join('  ')}</Text>
                  <TouchableOpacity
                    style={[s.shareBtn, { borderColor: GREEN + '55', backgroundColor: GREEN + '15' }]}
                    onPress={() => shareText(`Join ${activeTournamentName} on Titan Golf — tournament PIN: ${activeTournamentPin}`, activeTournamentPin)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.shareBtnText, { color: GREEN }]}>Share Tournament PIN</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <Text style={[s.cardHint, { color: dc.cardText, marginTop: 8 }]}>No PIN set for this tournament.</Text>
              )}
            </View>
          </>
        ) : (
          <View style={[s.card, { backgroundColor: dc.card, borderColor: dc.border }]}>
            <Text style={[s.cardHint, { color: dc.cardText }]}>No tournament is currently live.</Text>
          </View>
        )}

        <Text style={[s.sectionLabel, { color: dc.cardText, marginTop: 24 }]}>THE TOUR — JOIN CODE</Text>
        <View style={[s.card, { backgroundColor: dc.card, borderColor: tourCode ? GOLD + '44' : dc.border }]}>
          <Text style={[s.cardLabel, { color: GOLD }]}>THE TOUR</Text>
          {tourCode ? (
            <>
              <Text style={[s.areaCode, { color: GOLD }]}>{tourCode}</Text>
              <Text style={[s.cardHint, { color: dc.cardText }]}>Share this code for players joining The Tour</Text>
              <TouchableOpacity
                style={[s.shareBtn, { borderColor: GOLD + '55', backgroundColor: GOLD + '15', marginTop: 12 }]}
                onPress={() => shareText(`Join ${societyName} on Titan Golf — The Tour code: ${tourCode}`, tourCode)}
                activeOpacity={0.8}
              >
                <Text style={[s.shareBtnText, { color: GOLD }]}>Share Tour Code</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={[s.cardHint, { color: dc.cardText, marginTop: 6 }]}>No code generated yet.</Text>
              <TouchableOpacity
                style={[s.shareBtn, { borderColor: GOLD + '55', backgroundColor: GOLD + '15', marginTop: 12 }]}
                onPress={generateTourCode}
                disabled={generatingCode}
                activeOpacity={0.8}
              >
                {generatingCode
                  ? <ActivityIndicator color={GOLD} size="small" />
                  : <Text style={[s.shareBtnText, { color: GOLD }]}>Generate Code</Text>
                }
              </TouchableOpacity>
            </>
          )}
        </View>

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerCenter: { alignItems: 'center' },
  headerLogo:   { width: 32, height: 32 },
  headerSub:    { fontFamily: FFB, fontSize: 10, letterSpacing: 2, marginTop: 2 },
  back:         { fontFamily: FFB, fontSize: 14, minWidth: 48 },

  scroll:       { padding: 20, paddingBottom: 60 },

  sectionLabel: {
    fontFamily: FFB, fontSize: 10, letterSpacing: 1.5,
    textTransform: 'uppercase', marginBottom: 10,
  },

  card: { borderRadius: 14, borderWidth: 1, padding: 16 },
  cardTitle:  { fontFamily: FFB, fontSize: 16, marginTop: 6, marginBottom: 4 },
  cardLabel:  { fontFamily: FFB, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 },
  cardHint:   { fontFamily: FFB, fontSize: 12, lineHeight: 18 },

  bigPin: { fontFamily: FFB, fontSize: 36, letterSpacing: 6, marginVertical: 12 },
  areaCode: { fontFamily: FFB, fontSize: 28, letterSpacing: 6, marginVertical: 10 },

  shareBtn: { flex: 1, borderRadius: 10, borderWidth: 1, paddingVertical: 10, alignItems: 'center' },
  shareBtnText: { fontFamily: FFB, fontSize: 13 },

  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: GREEN },
  liveText: { fontFamily: FFB, fontSize: 10, color: GREEN, letterSpacing: 1.5 },
});
