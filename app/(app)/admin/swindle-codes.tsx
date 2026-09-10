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

const PURPLE = '#a78bfa';
const FFB    = 'JUSTSans-ExBold';

export default function SwindleCodesScreen() {
  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const router = useRouter();
  const dc = useDynamicColors();
  const { societyId, loading: societyLoading } = useAdminSociety();

  const [societyName,    setSocietyName]    = useState('');
  const [swindleCode,    setSwindleCode]    = useState('');
  const [loading,        setLoading]        = useState(true);
  const [generatingCode, setGeneratingCode] = useState(false);

  useEffect(() => {
    if (societyLoading) return;
    if (!societyId) { setLoading(false); return; }
    (async () => {
      try {
        const { data } = await supabase.from('societies').select('name, swindle_join_code').eq('id', societyId).single();
        if (data) {
          setSocietyName((data as any).name ?? '');
          setSwindleCode((data as any).swindle_join_code ?? '');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [societyId, societyLoading]);

  async function generateSwindleCode() {
    setGeneratingCode(true);
    const { data, error } = await supabase.rpc('generate_area_codes', { p_society_id: societyId } as any);
    setGeneratingCode(false);
    if (error) { Alert.alert('Error', error.message); return; }
    const row = Array.isArray(data) ? data[0] : data;
    if (row) setSwindleCode(row.r_swindle_code ?? '');
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
        <TouchableOpacity onPress={() => goBack(router, '/(app)/admin/hub-swindle')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[s.back, { color: dc.gold }]}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={[s.headerSub, { color: dc.gold }]}>SWINDLE CODES</Text>
        </View>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[s.sectionLabel, { color: dc.cardText }]}>THE SWINDLE — JOIN CODE</Text>
        <View style={[s.card, { backgroundColor: dc.card, borderColor: swindleCode ? PURPLE + '44' : dc.border }]}>
          <Text style={[s.cardLabel, { color: PURPLE }]}>THE SWINDLE</Text>
          {swindleCode ? (
            <>
              <Text style={[s.areaCode, { color: PURPLE }]}>{swindleCode}</Text>
              <Text style={[s.cardHint, { color: dc.cardText }]}>Share this code for players joining The Swindle</Text>
              <TouchableOpacity
                style={[s.shareBtn, { borderColor: PURPLE + '55', backgroundColor: PURPLE + '15', marginTop: 12 }]}
                onPress={() => shareText(`Join ${societyName} on Titan Golf — The Swindle code: ${swindleCode}`, swindleCode)}
                activeOpacity={0.8}
              >
                <Text style={[s.shareBtnText, { color: PURPLE }]}>Share Swindle Code</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={[s.cardHint, { color: dc.cardText, marginTop: 6 }]}>No code generated yet.</Text>
              <TouchableOpacity
                style={[s.shareBtn, { borderColor: PURPLE + '55', backgroundColor: PURPLE + '15', marginTop: 12 }]}
                onPress={generateSwindleCode}
                disabled={generatingCode}
                activeOpacity={0.8}
              >
                {generatingCode
                  ? <ActivityIndicator color={PURPLE} size="small" />
                  : <Text style={[s.shareBtnText, { color: PURPLE }]}>Generate Code</Text>
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
  cardLabel:  { fontFamily: FFB, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 },
  cardHint:   { fontFamily: FFB, fontSize: 12, lineHeight: 18 },

  areaCode: { fontFamily: FFB, fontSize: 28, letterSpacing: 6, marginVertical: 10 },

  shareBtn: { flex: 1, borderRadius: 10, borderWidth: 1, paddingVertical: 10, alignItems: 'center' },
  shareBtnText: { fontFamily: FFB, fontSize: 13 },
});
