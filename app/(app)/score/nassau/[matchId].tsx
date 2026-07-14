import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView, Image } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../../src/lib/supabase';

// ── TITAN constants ──────────────────────────────────────────────────────────
const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../../assets/TitanAppLogo.png');

// ── Types ────────────────────────────────────────────────────────────────────
interface CourseHole { hole_number: number; par: number; stroke_index: number; }
interface Match { id: string; home_player_ids: string[]; away_player_ids: string[]; day: { course_name: string } | null; }

// Nassau: compare gross scores between home and away per hole
// Returns: front diff (holes 1-9), back diff (holes 10-18), total diff
function nassauCalc(homeIds: string[], awayIds: string[], scores: Record<string, Record<number, number>>, holes: CourseHole[]) {
  let front = 0, back = 0;
  for (const hole of holes) {
    const homeScore = Math.min(...homeIds.map(id => scores[id]?.[hole.hole_number] ?? 99));
    const awayScore = Math.min(...awayIds.map(id => scores[id]?.[hole.hole_number] ?? 99));
    if (homeScore === 99 || awayScore === 99) continue;
    const diff = homeScore < awayScore ? -1 : homeScore > awayScore ? 1 : 0;
    if (hole.hole_number <= 9) front += diff;
    else back += diff;
  }
  return { front, back, total: front + back };
}

function betLabel(diff: number, homeLabel: string, awayLabel: string) {
  if (diff === 0) return 'A/S';
  const lead = Math.abs(diff);
  return diff < 0 ? `${homeLabel} ${lead}UP` : `${awayLabel} ${lead}UP`;
}

// ── Screen ───────────────────────────────────────────────────────────────────
export default function NassauScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const [match, setMatch]     = useState<Match | null>(null);
  const [holes, setHoles]     = useState<CourseHole[]>([]);
  const [names, setNames]     = useState<Record<string, string>>({});
  const [scores, setScores]   = useState<Record<string, Record<number, number>>>({});
  const [holeIdx, setHoleIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  useEffect(() => { load(); }, [matchId]);

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" />
      <ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  async function load() {
    const { data: m } = await supabase.from('matches').select('*,day:day_id(course_name)').eq('id', matchId).single();
    if (!m) { setLoading(false); return; }
    setMatch(m as any);
    const { data: h } = await supabase.from('course_holes').select('hole_number,par,stroke_index').eq('course_name', (m as any).day?.course_name).order('hole_number');
    if (h) setHoles(h as CourseHole[]);
    const allIds = [...((m as any).home_player_ids ?? []), ...((m as any).away_player_ids ?? [])];
    if (allIds.length) {
      const { data: p } = await supabase.from('players').select('id,display_name').in('id', allIds);
      if (p) { const n: Record<string,string> = {}; (p as any[]).forEach(x => n[x.id] = x.display_name.split(' ')[0]); setNames(n); }
    }
    const { data: ex } = await supabase.from('match_holes').select('player_id,hole_number,gross_score').eq('match_id', matchId);
    if (ex) {
      const sc: Record<string, Record<number, number>> = {};
      allIds.forEach((id: string) => { sc[id] = {}; });
      (ex as any[]).forEach(r => { if (r.gross_score != null) { if (!sc[r.player_id]) sc[r.player_id] = {}; sc[r.player_id][r.hole_number] = r.gross_score; } });
      setScores(sc);
    }
    setLoading(false);
  }

  const hole = holes[holeIdx];
  const allPlayers = [...(match?.home_player_ids ?? []), ...(match?.away_player_ids ?? [])];

  function getScore(pid: string) { return hole ? (scores[pid]?.[hole.hole_number] ?? hole.par) : 0; }
  function setPlayerScore(pid: string, v: number) {
    if (!hole) return;
    setScores(prev => ({ ...prev, [pid]: { ...(prev[pid] ?? {}), [hole.hole_number]: Math.max(1, v) } }));
  }

  async function save() {
    if (!match || !hole || saving) return;
    setSaving(true);
    for (const pid of allPlayers) {
      const g = scores[pid]?.[hole.hole_number] ?? hole.par;
      await supabase.from('match_holes').upsert({ match_id: matchId, player_id: pid, hole_number: hole.hole_number, gross_score: g }, { onConflict: 'match_id,player_id,hole_number' });
    }
    setSaving(false);
  }

  async function next() {
    await save();
    if (holeIdx < holes.length - 1) { setHoleIdx(holeIdx + 1); return; }
    if (!match) return;
    await supabase.from('matches').update({ status: 'complete' }).eq('id', matchId);
    const { front, back, total } = nassauCalc(match.home_player_ids, match.away_player_ids, scores, holes);
    const hn = match.home_player_ids.map(id => names[id] ?? '?').join(' & ');
    const an = match.away_player_ids.map(id => names[id] ?? '?').join(' & ');
    const msg = `Front: ${betLabel(front, hn, an)}\nBack: ${betLabel(back, hn, an)}\nTotal: ${betLabel(total, hn, an)}`;
    Alert.alert('Nassau Complete!', msg, [{ text: 'Done', onPress: () => router.back() }]);
  }

  const { front, back, total } = match
    ? nassauCalc(match.home_player_ids, match.away_player_ids, scores, holes.slice(0, holeIdx))
    : { front: 0, back: 0, total: 0 };

  const homeLabel = match?.home_player_ids.map(id => names[id] ?? '?').join(' & ') ?? 'Home';
  const awayLabel = match?.away_player_ids.map(id => names[id] ?? '?').join(' & ') ?? 'Away';

  if (!match || !hole) return null;

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.logo} resizeMode="contain" />
          <Text style={s.headerSub}>NASSAU</Text>
        </View>
        <View style={s.headerSpacer} />
      </View>

      {/* 3 bets */}
      <View style={s.bets}>
        {[
          { label: 'FRONT 9', value: betLabel(front, homeLabel, awayLabel), diff: front },
          { label: 'BACK 9',  value: betLabel(back,  homeLabel, awayLabel), diff: back  },
          { label: 'OVERALL', value: betLabel(total, homeLabel, awayLabel), diff: total  },
        ].map((b, i) => (
          <View key={b.label} style={[s.bet, i < 2 && s.betBorder]}>
            <Text style={s.betLabel}>{b.label}</Text>
            <Text style={[s.betValue, b.diff === 0 && { color: '#888' }]} numberOfLines={2}>{b.value}</Text>
          </View>
        ))}
      </View>

      {/* Matchup */}
      <View style={s.matchupRow}>
        <Text style={[s.matchupName, { textAlign: 'left', color: GREEN }]} numberOfLines={1}>{homeLabel}</Text>
        <Text style={s.vs}>VS</Text>
        <Text style={[s.matchupName, { textAlign: 'right', color: RED }]} numberOfLines={1}>{awayLabel}</Text>
      </View>

      {/* Hole card */}
      <View style={s.holeCard}>
        <Text style={s.holeNum}>Hole {hole.hole_number}</Text>
        <Text style={s.holeMeta}>Par {hole.par}  ·  SI {hole.stroke_index}</Text>
      </View>

      {/* Players */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.playersWrap}>
        {allPlayers.map(pid => {
          const isHome = match.home_player_ids.includes(pid);
          const sc = getScore(pid);
          const isBirdie = sc < hole.par;
          const isBogey  = sc > hole.par;
          return (
            <View key={pid} style={s.playerRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.playerName}>{names[pid] ?? '?'}</Text>
                <Text style={[s.playerSide, { color: isHome ? GREEN : RED }]}>{isHome ? 'HOME' : 'AWAY'}</Text>
              </View>
              <View style={s.stepper}>
                <TouchableOpacity style={s.stepBtn} onPress={() => setPlayerScore(pid, sc - 1)} activeOpacity={0.7}>
                  <Text style={s.stepBtnTxt}>−</Text>
                </TouchableOpacity>
                <View style={[s.scoreDisp, isBirdie && s.birdie, isBogey && s.bogey]}>
                  <Text style={[s.scoreTxt, isBirdie && { color: GREEN }, isBogey && { color: RED }]}>{sc}</Text>
                </View>
                <TouchableOpacity style={s.stepBtn} onPress={() => setPlayerScore(pid, sc + 1)} activeOpacity={0.7}>
                  <Text style={s.stepBtnTxt}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Navigation */}
      <View style={s.nav}>
        <TouchableOpacity
          style={[s.navBtn, holeIdx === 0 && s.dim]}
          onPress={async () => { await save(); setHoleIdx(Math.max(0, holeIdx - 1)); }}
          disabled={holeIdx === 0 || saving}
          activeOpacity={0.7}
        >
          <Text style={s.navTxt}>← Prev</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.navBtn, s.navPrimary, saving && s.dim]}
          onPress={next}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color="#000" size="small" />
            : <Text style={[s.navTxt, { color: '#000' }]}>{holeIdx === holes.length - 1 ? 'Finish →' : 'Next →'}</Text>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#000' },

  // Header
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  backBtn:      { width: 70 },
  back:         { fontSize: 13, fontFamily: FFB, color: GOLD },
  headerCenter: { alignItems: 'center', gap: 4 },
  logo:         { width: 28, height: 28 },
  headerSub:    { fontSize: 9, fontFamily: FF, color: '#555', letterSpacing: 1.5 },
  headerSpacer: { width: 70 },

  // Bets strip
  bets:         { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  bet:          { flex: 1, alignItems: 'center', paddingVertical: 10 },
  betBorder:    { borderRightWidth: 1, borderRightColor: '#1c1c1c' },
  betLabel:     { fontSize: 8, fontFamily: FFB, color: '#555', letterSpacing: 1.5, marginBottom: 3, textTransform: 'uppercase' },
  betValue:     { fontSize: 11, fontFamily: FFB, color: GOLD, textAlign: 'center' },

  // Matchup
  matchupRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  matchupName:  { fontSize: 11, fontFamily: FFB, flex: 1 },
  vs:           { fontSize: 11, fontFamily: FFB, color: '#555', marginHorizontal: 8 },

  // Hole card
  holeCard:     { alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1c1c1c', backgroundColor: '#111', marginHorizontal: 16, marginTop: 12, borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c' },
  holeNum:      { fontSize: 28, fontFamily: FFB, color: '#fff' },
  holeMeta:     { fontSize: 11, fontFamily: FF, color: '#555', marginTop: 2 },

  // Players
  playersWrap:  { padding: 16, gap: 16 },
  playerRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 14 },
  playerName:   { fontSize: 16, fontFamily: FFB, color: '#fff' },
  playerSide:   { fontSize: 9, fontFamily: FFB, letterSpacing: 1.5, marginTop: 2, textTransform: 'uppercase' },

  // Stepper
  stepper:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn:      { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#222', alignItems: 'center', justifyContent: 'center' },
  stepBtnTxt:   { fontSize: 22, fontFamily: FF, color: '#fff' },
  scoreDisp:    { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a1a', borderWidth: 2, borderColor: '#222' },
  birdie:       { borderColor: GREEN, backgroundColor: 'rgba(74,222,128,0.1)' },
  bogey:        { borderColor: RED,   backgroundColor: 'rgba(248,113,113,0.1)' },
  scoreTxt:     { fontSize: 24, fontFamily: FFB, color: '#fff' },

  // Nav
  nav:          { flexDirection: 'row', gap: 12, padding: 16, paddingBottom: 40, borderTopWidth: 1, borderTopColor: '#1c1c1c' },
  navBtn:       { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#1c1c1c', backgroundColor: '#111' },
  navPrimary:   { backgroundColor: GOLD, borderColor: GOLD },
  dim:          { opacity: 0.35 },
  navTxt:       { fontSize: 15, fontFamily: FFB, color: '#fff' },
});
