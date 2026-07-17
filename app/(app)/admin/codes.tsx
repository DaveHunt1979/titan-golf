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

const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const PURPLE = '#a78bfa';
const FFB    = 'JUSTSans-ExBold';

export default function CodesScreen() {
  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const router = useRouter();
  const dc = useDynamicColors();
  const { societyId, loading: societyLoading } = useAdminSociety();

  const [societyName,           setSocietyName]           = useState('');
  const [joinPin,               setJoinPin]               = useState('');
  const [casualCode,            setCasualCode]            = useState('');
  const [tourCode,              setTourCode]              = useState('');
  const [swindleCode,           setSwindleCode]           = useState('');
  const [activeTournamentName,  setActiveTournamentName]  = useState('');
  const [activeTournamentPin,   setActiveTournamentPin]   = useState('');
  const [loading,               setLoading]               = useState(true);
  const [generatingPin,         setGeneratingPin]         = useState(false);

  useEffect(() => {
    if (societyLoading) return;
    if (!societyId) { setLoading(false); return; }
    (async () => {
      try {
        const [{ data }, { data: activeComp }] = await Promise.all([
          supabase.from('societies').select('name, join_pin, casual_join_code, tour_join_code, swindle_join_code').eq('id', societyId).single(),
          supabase.from('competitions').select('name, pin').eq('society_id', societyId).eq('status', 'active').limit(1).maybeSingle(),
        ]);
        if (data) {
          setSocietyName((data as any).name ?? '');
          setJoinPin(String((data as any).join_pin ?? '').replace(/[^0-9]/g, ''));
          setCasualCode((data as any).casual_join_code ?? '');
          setTourCode((data as any).tour_join_code ?? '');
          setSwindleCode((data as any).swindle_join_code ?? '');
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

  async function generatePin() {
    setGeneratingPin(true);
    const newPin = String(Math.floor(100000 + Math.random() * 900000));
    const { error } = await supabase.from('societies').update({ join_pin: newPin } as any).eq('id', societyId);
    setGeneratingPin(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setJoinPin(newPin);
  }

  async function shareText(text: string, fallbackKey: string) {
    try {
      await Share.share({ message: text });
    } catch {
      Clipboard.setString(fallbackKey);
      Alert.alert('Copied', 'Copied to clipboard.');
    }
  }

  function pinFmt(pin: string) {
    return pin.length >= 6 ? `${pin.slice(0, 3)} ${pin.slice(3)}` : pin;
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

      {/* Header */}
      <View style={[s.header, { borderBottomColor: dc.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[s.back, { color: dc.gold }]}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={[s.headerSub, { color: dc.gold }]}>CODES &amp; PINS</Text>
        </View>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Society Join PIN */}
        <Text style={[s.sectionLabel, { color: dc.cardText }]}>SOCIETY JOIN PIN</Text>
        <View style={[s.card, { backgroundColor: dc.card, borderColor: dc.border }]}>
          <Text style={[s.cardHint, { color: dc.cardText }]}>
            New players enter this 6-digit PIN in Titan Golf to join your society.
          </Text>
          {joinPin ? (
            <>
              <Text style={s.bigPin}>{pinFmt(joinPin)}</Text>
              <View style={s.btnRow}>
                <TouchableOpacity
                  style={[s.shareBtn, { borderColor: GOLD + '55', backgroundColor: GOLD + '15' }]}
                  onPress={() => shareText(`Join ${societyName} on Titan Golf — your PIN is: ${pinFmt(joinPin)}`, joinPin)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.shareBtnText, { color: GOLD }]}>Share PIN</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.regenBtn, { borderColor: dc.border }]}
                  onPress={generatePin}
                  disabled={generatingPin}
                  activeOpacity={0.8}
                >
                  {generatingPin
                    ? <ActivityIndicator color={dc.gold} size="small" />
                    : <Text style={[s.regenBtnText, { color: dc.cardText }]}>Regenerate</Text>
                  }
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={[s.cardHint, { color: dc.cardText, marginTop: 8 }]}>No PIN generated yet.</Text>
              <TouchableOpacity
                style={[s.shareBtn, { borderColor: GOLD + '55', backgroundColor: GOLD + '15', marginTop: 12 }]}
                onPress={generatePin}
                disabled={generatingPin}
                activeOpacity={0.8}
              >
                {generatingPin
                  ? <ActivityIndicator color={GOLD} size="small" />
                  : <Text style={[s.shareBtnText, { color: GOLD }]}>Generate PIN</Text>
                }
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Active Tournament PIN */}
        {activeTournamentName ? (
          <>
            <Text style={[s.sectionLabel, { color: dc.cardText, marginTop: 24 }]}>ACTIVE TOURNAMENT</Text>
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
                <Text style={[s.cardHint, { color: dc.cardText, marginTop: 8 }]}>No PIN — run add_competition_pin.sql migration</Text>
              )}
            </View>
          </>
        ) : null}

        {/* Membership area codes */}
        <Text style={[s.sectionLabel, { color: dc.cardText, marginTop: 24 }]}>MEMBERSHIP AREA CODES</Text>
        {[
          { label: 'Casual Golf', code: casualCode,  color: GREEN  },
          { label: 'The Tour',    code: tourCode,    color: GOLD   },
          { label: 'The Swindle', code: swindleCode, color: PURPLE },
        ].map((area, idx) => (
          <View key={area.label} style={[s.card, { backgroundColor: dc.card, borderColor: area.code ? area.color + '44' : dc.border }, idx > 0 && { marginTop: 8 }]}>
            <Text style={[s.cardLabel, { color: area.color }]}>{area.label.toUpperCase()}</Text>
            {area.code ? (
              <>
                <Text style={[s.areaCode, { color: area.color }]}>{area.code}</Text>
                <Text style={[s.cardHint, { color: dc.cardText }]}>Share this code for players joining {area.label}</Text>
                <TouchableOpacity
                  style={[s.shareBtn, { borderColor: area.color + '55', backgroundColor: area.color + '15', marginTop: 12 }]}
                  onPress={() => shareText(`Join ${societyName} on Titan Golf — ${area.label} code: ${area.code}`, area.code)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.shareBtnText, { color: area.color }]}>Share {area.label} Code</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={[s.cardHint, { color: dc.cardText, marginTop: 6 }]}>
                Code not generated — run membership_areas migration
              </Text>
            )}
          </View>
        ))}

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
  back:         { fontFamily: FFB, fontSize: 14, width: 48 },

  scroll:       { padding: 20, paddingBottom: 60 },

  sectionLabel: {
    fontFamily: FFB, fontSize: 10, letterSpacing: 1.5,
    textTransform: 'uppercase', marginBottom: 10,
  },

  card: {
    borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 0,
  },
  cardTitle:  { fontFamily: FFB, fontSize: 16, marginTop: 6, marginBottom: 4 },
  cardLabel:  { fontFamily: FFB, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 },
  cardHint:   { fontFamily: FFB, fontSize: 12, lineHeight: 18 },

  bigPin: {
    fontFamily: FFB, fontSize: 36, color: GOLD,
    letterSpacing: 6, marginVertical: 12,
  },
  areaCode: {
    fontFamily: FFB, fontSize: 28, letterSpacing: 6, marginVertical: 10,
  },

  btnRow: { flexDirection: 'row', gap: 8 },
  shareBtn: {
    flex: 1, borderRadius: 10, borderWidth: 1,
    paddingVertical: 10, alignItems: 'center',
  },
  shareBtnText: { fontFamily: FFB, fontSize: 13 },
  regenBtn: {
    borderRadius: 10, borderWidth: 1,
    paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center',
  },
  regenBtnText: { fontFamily: FFB, fontSize: 13 },

  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8,
  },
  liveDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: GREEN,
  },
  liveText: { fontFamily: FFB, fontSize: 10, color: GREEN, letterSpacing: 1.5 },
});
