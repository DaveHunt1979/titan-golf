import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { goBack } from '../../../src/lib/navigation';
import { runSwindleSimulation, deleteSwindleSimulation } from '../../../src/lib/simulateSwindle';

const GOLD = '#D4AF37';
const FF   = 'JUSTSans';
const FFB  = 'JUSTSans-ExBold';

interface SimRow { id: string; name: string; status: string }

export default function SwindleSimulateScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { societyId } = useSocietyTheme();
  const [fontsLoaded] = useFonts({ 'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'), 'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf') });

  const [entrantCount, setEntrantCount] = useState(20);
  const [format, setFormat] = useState<'stableford' | 'stroke'>('stableford');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sims, setSims] = useState<SimRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  async function loadSims() {
    setLoadingList(true);
    const { data } = await supabase.from('swindle_games').select('id,name,status')
      .eq('society_id', societyId).eq('is_simulation', true).order('created_at', { ascending: false });
    setSims((data ?? []) as any[]);
    setLoadingList(false);
  }
  useEffect(() => { if (societyId) loadSims(); }, [societyId]);

  async function run() {
    if (!societyId) return;
    setRunning(true);
    setError(null);
    setProgress('Starting...');
    try {
      const result = await runSwindleSimulation({ societyId, entrantCount, format, onProgress: setProgress });
      Alert.alert('Simulation complete', `${result.gameName}\n\nWinner: ${result.winnerName} (${result.winnerScore})\n${result.playerCount} real member${result.playerCount === 1 ? '' : 's'} entered.`);
      await loadSims();
    } catch (e: any) {
      // Inline, not a native popup (standing UI convention) — keeps the
      // "not enough real members" message on screen while the admin lowers
      // the entrant stepper.
      setError(String(e?.message ?? e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  function confirmDelete(sim: SimRow) {
    Alert.alert('Delete simulation', `Delete "${sim.name}"? This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteSwindleSimulation(sim.id); loadSims(); } },
    ]);
  }

  if (!fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  return (
    <View style={[s.root, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />
      <View style={[s.header, { borderBottomColor: dc.border }]}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/admin/hub-swindle')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={s.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: dc.cardText }]}>SIMULATE SWINDLE</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Text style={[s.sub, { color: dc.textSecondary }]}>
          Build and fully score a Swindle to find where it breaks. Uses only this society's real members — if there aren't enough for the entrant count you pick, it'll tell you rather than making anyone up.
        </Text>

        <Text style={[s.label, { color: dc.cardText }]}>FORMAT</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
          {(['stableford', 'stroke'] as const).map(f => (
            <TouchableOpacity
              key={f}
              style={[s.formatChip, { borderColor: dc.border, backgroundColor: dc.card }, format === f && s.formatChipOn]}
              onPress={() => setFormat(f)}
              activeOpacity={0.8}
            >
              <Text style={[s.formatChipText, { color: dc.cardText }, format === f && s.formatChipTextOn]}>
                {f === 'stableford' ? 'Stableford' : 'Stroke Play'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[s.label, { color: dc.cardText }]}>ENTRANTS ({entrantCount})</Text>
        <View style={s.stepper}>
          <TouchableOpacity style={[s.stepperBtn, entrantCount <= 4 && s.stepperBtnOff]} onPress={() => setEntrantCount(n => Math.max(4, n - 4))} disabled={entrantCount <= 4}>
            <Text style={s.stepperBtnText}>–</Text>
          </TouchableOpacity>
          <Text style={[s.stepperValue, { color: dc.cardText }]}>{entrantCount} players</Text>
          <TouchableOpacity style={[s.stepperBtn, entrantCount >= 100 && s.stepperBtnOff]} onPress={() => setEntrantCount(n => Math.min(100, n + 4))} disabled={entrantCount >= 100}>
            <Text style={s.stepperBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={[s.runBtn, running && { opacity: 0.6 }]} onPress={run} disabled={running} activeOpacity={0.85}>
          {running ? <ActivityIndicator color="#000" /> : <Text style={s.runBtnText}>Run Full Simulation</Text>}
        </TouchableOpacity>
        {progress && <Text style={[s.progress, { color: dc.textSecondary }]}>{progress}</Text>}
        {error && (
          <View style={s.errorCard}>
            <Ionicons name="alert-circle-outline" size={18} color="#f87171" style={{ marginTop: 1 }} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <Text style={[s.sectionHeader, { color: dc.cardText }]}>PAST SIMULATIONS</Text>
        {loadingList ? (
          <ActivityIndicator color={GOLD} style={{ marginTop: 12 }} />
        ) : sims.length === 0 ? (
          <Text style={[s.hint, { color: dc.textSecondary }]}>None yet.</Text>
        ) : sims.map(sim => (
          <View key={sim.id} style={[s.simRow, { backgroundColor: dc.card, borderColor: dc.border }]}>
            <Text style={[s.simName, { color: dc.cardText, flex: 1 }]} numberOfLines={1}>{sim.name}</Text>
            <TouchableOpacity onPress={() => confirmDelete(sim)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="trash-outline" size={18} color="#f87171" />
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1 },
  back: { fontFamily: FFB, fontSize: 13, color: GOLD },
  title: { fontFamily: FFB, fontSize: 12, letterSpacing: 1 },
  formatChip: { flex: 1, borderRadius: 10, borderWidth: 1, paddingVertical: 12, alignItems: 'center' },
  formatChipOn: { backgroundColor: 'rgba(212,175,55,0.12)', borderColor: GOLD },
  formatChipText: { fontFamily: FFB, fontSize: 13 },
  formatChipTextOn: { color: GOLD },
  sub: { fontFamily: FF, fontSize: 13, lineHeight: 19, marginBottom: 24 },
  label: { fontFamily: FFB, fontSize: 10, letterSpacing: 1.5, marginBottom: 10 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#1c1c1c', padding: 6, marginBottom: 24 },
  stepperBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(212,175,55,0.12)', alignItems: 'center', justifyContent: 'center' },
  stepperBtnOff: { opacity: 0.3 },
  stepperBtnText: { fontFamily: FFB, fontSize: 20, color: GOLD },
  stepperValue: { fontFamily: FFB, fontSize: 14 },
  hint: { fontFamily: FF, fontSize: 11 },
  runBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginBottom: 8 },
  runBtnText: { fontFamily: FFB, fontSize: 14, color: '#000', letterSpacing: 0.5 },
  progress: { fontFamily: FF, fontSize: 12, textAlign: 'center', marginBottom: 24 },
  errorCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 8, marginBottom: 16,
    backgroundColor: 'rgba(248,113,113,0.08)',
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)', padding: 14,
  },
  errorText: { flex: 1, fontFamily: FF, fontSize: 12, lineHeight: 18, color: '#f87171' },
  sectionHeader: { fontFamily: FFB, fontSize: 10, letterSpacing: 1.5, marginTop: 16, marginBottom: 12 },
  simRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8 },
  simName: { fontFamily: FFB, fontSize: 13 },
});
