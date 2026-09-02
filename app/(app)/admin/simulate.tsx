import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { goBack } from '../../../src/lib/navigation';
import { runTournamentSimulation, deleteSimulation } from '../../../src/lib/simulateTournament';
import { FORMAT_RULES, type FormatId } from '../../../src/lib/tournamentFormat';

const GOLD = '#D4AF37';
const FF   = 'JUSTSans';
const FFB  = 'JUSTSans-ExBold';

const SIMULATABLE_FORMATS = (Object.keys(FORMAT_RULES) as FormatId[]).filter(id => FORMAT_RULES[id].available);

interface SimRow { id: string; name: string; created_at: string; status: string; settings: any }

export default function SimulateScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { societyId } = useSocietyTheme();
  const [fontsLoaded] = useFonts({ 'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'), 'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf') });

  const [formatId, setFormatId] = useState<FormatId>('titan_way');
  const rules = FORMAT_RULES[formatId];
  const isRyderCup = formatId === 'ryder_cup';

  const [numTeams, setNumTeams] = useState(6);
  const [numPlayers, setNumPlayers] = useState(20);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [sims, setSims] = useState<SimRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // Every format has its own valid team-count range (or none, for
  // individual formats) — jumping straight to a value that's actually
  // legal for whatever's picked, rather than leaving a stale number from
  // a previous format that Go Live would've rejected anyway.
  useEffect(() => {
    if (!rules.isTeamFormat) return;
    if (isRyderCup) { setNumTeams(2); return; }
    const min = rules.minTeams ?? 2;
    const max = rules.maxTeams ?? 16;
    setNumTeams(n => {
      let v = Math.min(Math.max(n, min), max);
      if (rules.requiresEvenTeams && v % 2 !== 0) v = Math.min(v + 1, max);
      if (rules.requiresOddTeams && v % 2 === 0) v = Math.min(v + 1, max);
      return v;
    });
  }, [formatId]);

  async function loadSims() {
    setLoadingList(true);
    const { data } = await supabase.from('competitions').select('id,name,created_at,status,settings')
      .eq('society_id', societyId).eq('is_simulation', true).order('created_at', { ascending: false });
    setSims((data ?? []) as any[]);
    setLoadingList(false);
  }
  useEffect(() => { if (societyId) loadSims(); }, [societyId]);

  async function run() {
    if (!societyId) return;
    setRunning(true);
    setProgress('Starting...');
    try {
      const result = await runTournamentSimulation({
        societyId, formatId, numTeams, numPlayers, onProgress: setProgress,
      });
      Alert.alert(
        'Simulation complete',
        `${result.competitionName}\n\nChampion: ${result.championName}${result.kronosChampionName ? `\nKronos champion: ${result.kronosChampionName}` : ''}\n${result.syntheticPlayerCount} synthetic players created.`,
      );
      await loadSims();
    } catch (e: any) {
      // This tool exists to find breakage — surface the real error, don't
      // swallow it into a generic "something went wrong".
      Alert.alert('Simulation failed', String(e?.message ?? e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  function confirmDelete(sim: SimRow) {
    Alert.alert('Delete simulation', `Delete "${sim.name}" and everything in it? This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteSimulation(sim.id); loadSims(); } },
    ]);
  }

  if (!fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  const teamMin = rules.minTeams ?? 2;
  const teamMax = rules.maxTeams ?? 16;
  const teamStep = rules.requiresEvenTeams || rules.requiresOddTeams ? 2 : 1;

  return (
    <View style={[s.root, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />
      <View style={[s.header, { borderBottomColor: dc.border }]}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/admin/hub-tournament')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={s.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: dc.cardText }]}>SIMULATE</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Text style={[s.sub, { color: dc.textSecondary }]}>
          Build and fully play out a complete tournament at whatever scale you pick — real scoring engine, real draw logic — so you can find where a format breaks before it happens with real players. Uses real society members first, fills any gap with clearly-labelled synthetic players.
        </Text>

        <Text style={[s.label, { color: dc.cardText }]}>FORMAT</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }} contentContainerStyle={{ gap: 8 }}>
          {SIMULATABLE_FORMATS.map(id => (
            <TouchableOpacity
              key={id}
              style={[s.formatChip, { borderColor: dc.border, backgroundColor: dc.card }, formatId === id && s.formatChipOn]}
              onPress={() => setFormatId(id)}
              activeOpacity={0.8}
            >
              <Text style={[s.formatChipText, { color: dc.cardText }, formatId === id && s.formatChipTextOn]}>{FORMAT_RULES[id].label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {rules.isTeamFormat ? (
          isRyderCup ? (
            <Text style={[s.hint, { color: dc.textSecondary, marginTop: -8 }]}>Ryder Cup is always 2 sides of 4 — 8 players.</Text>
          ) : (
            <>
              <Text style={[s.label, { color: dc.cardText }]}>TEAMS ({numTeams})</Text>
              <View style={s.stepper}>
                <TouchableOpacity style={[s.stepperBtn, numTeams <= teamMin && s.stepperBtnOff]} onPress={() => setNumTeams(n => Math.max(teamMin, n - teamStep))} disabled={numTeams <= teamMin}>
                  <Text style={s.stepperBtnText}>–</Text>
                </TouchableOpacity>
                <Text style={[s.stepperValue, { color: dc.cardText }]}>{numTeams} teams · {numTeams * 4} players</Text>
                <TouchableOpacity style={[s.stepperBtn, numTeams >= teamMax && s.stepperBtnOff]} onPress={() => setNumTeams(n => Math.min(teamMax, n + teamStep))} disabled={numTeams >= teamMax}>
                  <Text style={s.stepperBtnText}>+</Text>
                </TouchableOpacity>
              </View>
              <Text style={[s.hint, { color: dc.textSecondary }]}>
                {rules.label} allows {teamMin}–{teamMax} teams{rules.requiresEvenTeams ? ' (even numbers only)' : rules.requiresOddTeams ? ' (odd numbers only)' : ''}, 4 players each.
              </Text>
            </>
          )
        ) : (
          <>
            <Text style={[s.label, { color: dc.cardText }]}>PLAYERS ({numPlayers})</Text>
            <View style={s.stepper}>
              <TouchableOpacity style={[s.stepperBtn, numPlayers <= 4 && s.stepperBtnOff]} onPress={() => setNumPlayers(n => Math.max(4, n - 4))} disabled={numPlayers <= 4}>
                <Text style={s.stepperBtnText}>–</Text>
              </TouchableOpacity>
              <Text style={[s.stepperValue, { color: dc.cardText }]}>{numPlayers} players</Text>
              <TouchableOpacity style={[s.stepperBtn, numPlayers >= 100 && s.stepperBtnOff]} onPress={() => setNumPlayers(n => Math.min(100, n + 4))} disabled={numPlayers >= 100}>
                <Text style={s.stepperBtnText}>+</Text>
              </TouchableOpacity>
            </View>
            <Text style={[s.hint, { color: dc.textSecondary }]}>Grouped {'4'} per tee time, {rules.defaultDays} round{rules.defaultDays === 1 ? '' : 's'}.</Text>
          </>
        )}

        <TouchableOpacity style={[s.runBtn, running && { opacity: 0.6 }]} onPress={run} disabled={running} activeOpacity={0.85}>
          {running ? <ActivityIndicator color="#000" /> : <Text style={s.runBtnText}>Run Full Simulation</Text>}
        </TouchableOpacity>
        {progress && <Text style={[s.progress, { color: dc.textSecondary }]}>{progress}</Text>}

        <Text style={[s.sectionHeader, { color: dc.cardText }]}>PAST SIMULATIONS</Text>
        {loadingList ? (
          <ActivityIndicator color={GOLD} style={{ marginTop: 12 }} />
        ) : sims.length === 0 ? (
          <Text style={[s.hint, { color: dc.textSecondary }]}>None yet.</Text>
        ) : sims.map(sim => (
          <View key={sim.id} style={[s.simRow, { backgroundColor: dc.card, borderColor: dc.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[s.simName, { color: dc.cardText }]} numberOfLines={1}>{sim.name}</Text>
              <Text style={[s.simSub, { color: dc.textSecondary }]}>{sim.settings?.format_type ?? '?'} · {sim.status}</Text>
            </View>
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
  sub: { fontFamily: FF, fontSize: 13, lineHeight: 19, marginBottom: 24 },
  label: { fontFamily: FFB, fontSize: 10, letterSpacing: 1.5, marginBottom: 10 },
  formatChip: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  formatChipOn: { backgroundColor: 'rgba(212,175,55,0.12)', borderColor: GOLD },
  formatChipText: { fontFamily: FFB, fontSize: 12 },
  formatChipTextOn: { color: GOLD },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#1c1c1c', padding: 6, marginBottom: 8 },
  stepperBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(212,175,55,0.12)', alignItems: 'center', justifyContent: 'center' },
  stepperBtnOff: { opacity: 0.3 },
  stepperBtnText: { fontFamily: FFB, fontSize: 20, color: GOLD },
  stepperValue: { fontFamily: FFB, fontSize: 14 },
  hint: { fontFamily: FF, fontSize: 11, marginBottom: 24 },
  runBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginBottom: 8 },
  runBtnText: { fontFamily: FFB, fontSize: 14, color: '#000', letterSpacing: 0.5 },
  progress: { fontFamily: FF, fontSize: 12, textAlign: 'center', marginBottom: 24 },
  sectionHeader: { fontFamily: FFB, fontSize: 10, letterSpacing: 1.5, marginTop: 16, marginBottom: 12 },
  simRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8 },
  simName: { fontFamily: FFB, fontSize: 13 },
  simSub: { fontFamily: FF, fontSize: 11, marginTop: 2 },
});
