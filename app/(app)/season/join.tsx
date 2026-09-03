import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { goBack } from '../../../src/lib/navigation';

const GREEN = '#4ade80';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';

interface SeasonSummary {
  id: string; name: string; season_year: number;
  start_at: string | null; end_at: string | null;
}

// No approval step any more — holding the 6-digit PIN IS the authorization,
// because the admin is the one who handed it out (Dave, 2026-09-08). The
// seasons.join_requires_approval column and the admin requests screen are
// left in place but nothing routes through them.
type Step = 'pin' | 'preview' | 'already_entered';

export default function SeasonJoinScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [pin, setPin]           = useState('');
  const [step, setStep]         = useState<Step>('pin');
  const [season, setSeason]     = useState<SeasonSummary | null>(null);
  const [looking, setLooking]   = useState(false);
  const [joining, setJoining]   = useState(false);

  if (!fontsLoaded) return <View style={[s.container, { backgroundColor: dc.bg }]} />;

  async function findSeason() {
    const code = pin.trim();
    if (code.length !== 6) return;
    setLooking(true);
    const { data: found } = await supabase
      .from('seasons')
      .select('id, name, season_year, start_at, end_at')
      .eq('join_pin', code)
      .maybeSingle();
    if (!found) {
      setLooking(false);
      setSeason(null);
      setStep('pin');
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const { data: me } = user
      ? await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle()
      : { data: null };

    if (me) {
      const { data: entry } = await supabase
        .from('season_entries').select('id').eq('season_id', (found as any).id).eq('player_id', me.id).maybeSingle();
      setLooking(false);
      setSeason(found as SeasonSummary);
      setStep(entry ? 'already_entered' : 'preview');
      return;
    }

    setLooking(false);
    setSeason(found as SeasonSummary);
    setStep('preview');
  }

  async function joinSeason() {
    if (!season) return;
    setJoining(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setJoining(false); return; }
    const { data: me } = await supabase.from('players').select('id, handicap_index').eq('auth_uid', user.id).maybeSingle();
    if (!me) { setJoining(false); return; }

    const { error } = await supabase.from('season_entries').insert({
      season_id: season.id, player_id: (me as any).id,
      entry_handicap_index: (me as any).handicap_index ?? null,
      join_status: 'approved', qualification_status: 'provisional',
    } as any);
    setJoining(false);
    // 23505 = they're already entered, which is the same outcome as joining.
    if (error && (error as any).code !== '23505') { setStep('pin'); return; }
    setStep('already_entered');
  }

  return (
    <KeyboardAvoidingView style={[s.container, { backgroundColor: dc.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/season')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={22} color={GREEN} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>JOIN SEASON</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={s.body}>
        {step === 'pin' && (
          <>
            <View style={s.heroIconWrap}><Ionicons name="keypad-outline" size={28} color={GREEN} /></View>
            <Text style={s.title}>Enter Season PIN</Text>
            <Text style={s.sub}>Ask your organiser for the 6-digit Season PIN.</Text>
            <TextInput
              style={s.pinInput}
              value={pin}
              onChangeText={v => setPin(v.replace(/[^0-9]/g, '').slice(0, 6))}
              keyboardType="number-pad"
              placeholder="000000"
              placeholderTextColor="#333"
              maxLength={6}
              autoFocus
            />
            <TouchableOpacity
              style={[s.primaryBtn, pin.length !== 6 && { opacity: 0.4 }]}
              onPress={findSeason}
              disabled={pin.length !== 6 || looking}
              activeOpacity={0.85}
            >
              {looking ? <ActivityIndicator color="#000" /> : <Text style={s.primaryBtnText}>Find Season</Text>}
            </TouchableOpacity>
          </>
        )}

        {step === 'preview' && season && (
          <>
            <View style={s.heroIconWrap}><Ionicons name="trophy" size={28} color={GREEN} /></View>
            <Text style={s.title}>{season.name}</Text>
            <Text style={s.sub}>{season.season_year}</Text>
            <View style={s.summaryCard}>
              <View style={s.summaryRow}><Text style={s.summaryLabel}>Joining</Text><Text style={s.summaryValue}>Instant — the PIN is your entry</Text></View>
              <View style={s.summaryRow}><Text style={s.summaryLabel}>Rounds count</Text><Text style={s.summaryValue}>Casual, Tournament & Swindle rounds played with another app player</Text></View>
              <View style={s.summaryRow}><Text style={s.summaryLabel}>Solo rounds</Text><Text style={s.summaryValue}>Never count</Text></View>
            </View>
            <TouchableOpacity style={s.primaryBtn} onPress={joinSeason} disabled={joining} activeOpacity={0.85}>
              {joining ? <ActivityIndicator color="#000" /> : <Text style={s.primaryBtnText}>Join Season</Text>}
            </TouchableOpacity>
          </>
        )}

        {step === 'already_entered' && (
          <>
            <View style={s.heroIconWrap}><Ionicons name="checkmark-circle" size={28} color={GREEN} /></View>
            <Text style={s.title}>You're In</Text>
            <Text style={s.sub}>You're entered in {season?.name}.</Text>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingTop: 56 },

  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 },
  headerTitle: { fontFamily: FFB, fontSize: 13, color: '#fff', letterSpacing: 2 },

  body: { flex: 1, alignItems: 'center', paddingHorizontal: 28, paddingTop: 40 },

  heroIconWrap: {
    width: 56, height: 56, borderRadius: 16, backgroundColor: `${GREEN}20`, borderWidth: 1, borderColor: `${GREEN}40`,
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },
  title: { fontFamily: FFB, fontSize: 20, color: '#fff', textAlign: 'center', marginBottom: 6 },
  sub:   { fontFamily: FF, fontSize: 13, color: '#9ca3af', textAlign: 'center', lineHeight: 19, marginBottom: 24 },

  pinInput: {
    width: '100%', backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c', borderRadius: 14,
    paddingVertical: 18, textAlign: 'center', fontFamily: FFB, fontSize: 28, color: '#fff', letterSpacing: 10,
    marginBottom: 20,
  },

  primaryBtn: { width: '100%', backgroundColor: GREEN, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  primaryBtnText: { fontFamily: FFB, fontSize: 15, color: '#000' },

  summaryCard: { width: '100%', backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c', borderRadius: 14, padding: 16, marginBottom: 24, gap: 12 },
  summaryRow:   { gap: 3 },
  summaryLabel: { fontFamily: FFB, fontSize: 9, color: '#666', letterSpacing: 1 },
  summaryValue: { fontFamily: FFB, fontSize: 13, color: '#fff', lineHeight: 18 },
});
