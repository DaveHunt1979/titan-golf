import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView, Image } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../../src/lib/supabase';

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../../assets/images/titan-logo.png');

interface CourseHole { hole_number: number; par: number; stroke_index: number; }
interface Match { id: string; home_player_ids: string[]; day: { course_name: string } | null; }

type BBBPoint = 'bingo' | 'bango' | 'bongo';
interface HoleBBB { bingo: string | null; bango: string | null; bongo: string | null; }

const BBB_LABELS: Record<BBBPoint, { emoji: string; label: string; sub: string }> = {
  bingo: { emoji: '⛳', label: 'BINGO', sub: 'First on the green' },
  bango: { emoji: '📍', label: 'BANGO', sub: 'Closest to pin when all on' },
  bongo: { emoji: '🏌️', label: 'BONGO', sub: 'First to hole out' },
};

export default function BBBScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const [match, setMatch]     = useState<Match | null>(null);
  const [holes, setHoles]     = useState<CourseHole[]>([]);
  const [names, setNames]     = useState<Record<string, string>>({});
  const [bbbData, setBbbData] = useState<Record<number, HoleBBB>>({});
  const [holeIdx, setHoleIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  useEffect(() => { load(); }, [matchId]);

  async function load() {
    const { data: m } = await supabase.from('matches').select('*,day:day_id(course_name)').eq('id', matchId).single();
    if (!m) { setLoading(false); return; }
    setMatch(m as any);
    const { data: h } = await supabase.from('course_holes').select('hole_number,par,stroke_index').eq('course_name', (m as any).day?.course_name).order('hole_number');
    if (h) setHoles(h as CourseHole[]);
    const ids = (m as any).home_player_ids ?? [];
    if (ids.length) {
      const { data: p } = await supabase.from('players').select('id,display_name').in('id', ids);
      if (p) { const n: Record<string,string> = {}; (p as any[]).forEach(x => n[x.id] = x.display_name.split(' ')[0]); setNames(n); }
    }
    // Load existing BBB data from result_str JSON
    const { data: matchData } = await supabase.from('matches').select('result_str').eq('id', matchId).single();
    if (matchData && (matchData as any).result_str) {
      try {
        const parsed = JSON.parse((matchData as any).result_str);
        if (parsed.bbb) setBbbData(parsed.bbb);
      } catch {}
    }
    setLoading(false);
  }

  const hole = holes[holeIdx];
  const players = match?.home_player_ids ?? [];
  const holeBBB = hole ? (bbbData[hole.hole_number] ?? { bingo: null, bango: null, bongo: null }) : { bingo: null, bango: null, bongo: null };

  function assign(point: BBBPoint, pid: string) {
    if (!hole) return;
    setBbbData(prev => ({
      ...prev,
      [hole.hole_number]: {
        ...(prev[hole.hole_number] ?? { bingo: null, bango: null, bongo: null }),
        [point]: prev[hole.hole_number]?.[point] === pid ? null : pid,
      },
    }));
  }

  async function save() {
    if (!match || saving) return;
    setSaving(true);
    // Save BBB data as JSON in result_str
    const { data: existing } = await supabase.from('matches').select('result_str').eq('id', matchId).single();
    let parsed: any = {};
    try { if ((existing as any)?.result_str) parsed = JSON.parse((existing as any).result_str); } catch {}
    parsed.bbb = bbbData;
    await supabase.from('matches').update({ result_str: JSON.stringify(parsed) }).eq('id', matchId);

    // Also save stableford_pts for each player per hole based on BBB points earned
    if (hole) {
      for (const pid of players) {
        const pts = (['bingo', 'bango', 'bongo'] as BBBPoint[]).filter(p => bbbData[hole.hole_number]?.[p] === pid).length;
        await supabase.from('match_holes').upsert({ match_id: matchId, player_id: pid, hole_number: hole.hole_number, stableford_pts: pts }, { onConflict: 'match_id,player_id,hole_number' });
      }
    }
    setSaving(false);
  }

  async function next() {
    await save();
    if (holeIdx < holes.length - 1) { setHoleIdx(holeIdx + 1); return; }
    await supabase.from('matches').update({ status: 'complete' }).eq('id', matchId);
    // Calculate total points per player
    const totals: Record<string, number> = {};
    players.forEach(id => { totals[id] = 0; });
    for (const h of holes) {
      const hd = bbbData[h.hole_number];
      if (!hd) continue;
      (['bingo', 'bango', 'bongo'] as BBBPoint[]).forEach(p => {
        if (hd[p] && totals[hd[p]!] !== undefined) totals[hd[p]!]++;
      });
    }
    const summary = players.sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0))
      .map(id => `${names[id] ?? id}: ${totals[id]} pts`).join('\n');
    Alert.alert('BBB Complete!', summary, [{ text: 'Done', onPress: () => router.back() }]);
  }

  // Running totals
  const totals: Record<string, number> = {};
  players.forEach(id => { totals[id] = 0; });
  holes.slice(0, holeIdx).forEach(h => {
    const hd = bbbData[h.hole_number];
    if (!hd) return;
    (['bingo', 'bango', 'bongo'] as BBBPoint[]).forEach(p => { if (hd[p] && totals[hd[p]!] !== undefined) totals[hd[p]!]++; });
  });

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" />
      <ActivityIndicator color={GOLD} size="large" />
    </View>
  );
  if (!match || !hole) return null;

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerLeft}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.logo} resizeMode="contain" />
          <Text style={s.subtitle}>BINGO BANGO BONGO</Text>
        </View>
        <View style={s.headerRight} />
      </View>

      {/* Running totals */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.totalsScroll}>
        <View style={s.totals}>
          {players.map(id => (
            <View key={id} style={s.totalItem}>
              <Text style={s.totalName}>{names[id] ?? '?'}</Text>
              <Text style={s.totalPts}>{totals[id]}</Text>
              <Text style={s.totalLbl}>PTS</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Hole card */}
      <View style={s.holeCard}>
        <Text style={s.holeNum}>Hole {hole.hole_number}</Text>
        <Text style={s.holeMeta}>Par {hole.par}  ·  SI {hole.stroke_index}</Text>
      </View>

      {/* Points sections */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.pointsWrap}>
        {(['bingo', 'bango', 'bongo'] as BBBPoint[]).map(point => {
          const info = BBB_LABELS[point];
          return (
            <View key={point} style={s.pointSection}>
              <View style={s.pointHeader}>
                <Text style={s.pointEmoji}>{info.emoji}</Text>
                <View>
                  <Text style={s.pointLabel}>{info.label}</Text>
                  <Text style={s.pointSub}>{info.sub}</Text>
                </View>
              </View>
              <View style={s.playerBtns}>
                {players.map(pid => {
                  const selected = holeBBB[point] === pid;
                  return (
                    <TouchableOpacity
                      key={pid}
                      style={[s.playerBtn, selected && s.playerBtnOn]}
                      onPress={() => assign(point, pid)}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.playerBtnTxt, selected && s.playerBtnTxtOn]}>{names[pid] ?? '?'}</Text>
                    </TouchableOpacity>
                  );
                })}
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
            : <Text style={s.navTxtPrimary}>{holeIdx === holes.length - 1 ? 'Finish →' : 'Next →'}</Text>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#000' },

  // Header
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  headerLeft:      { width: 60, justifyContent: 'center' },
  headerCenter:    { flex: 1, alignItems: 'center', gap: 4 },
  headerRight:     { width: 60 },
  back:            { fontSize: 14, fontFamily: FFB, color: GOLD },
  logo:            { width: 28, height: 28 },
  subtitle:        { fontSize: 9, fontFamily: FF, color: '#555', letterSpacing: 1.5 },

  // Running totals
  totalsScroll:    { maxHeight: 80, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  totals:          { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingVertical: 10, alignItems: 'center' },
  totalItem:       { alignItems: 'center', backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', paddingHorizontal: 14, paddingVertical: 8, minWidth: 64 },
  totalName:       { fontSize: 11, fontFamily: FFB, color: '#555', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 1.5 },
  totalPts:        { fontSize: 22, fontFamily: FFB, color: GOLD },
  totalLbl:        { fontSize: 8, fontFamily: FFB, color: '#555', letterSpacing: 1.5, marginTop: 1 },

  // Hole card
  holeCard:        { alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  holeNum:         { fontSize: 28, fontFamily: FFB, color: '#fff' },
  holeMeta:        { fontSize: 11, fontFamily: FF, color: '#555', marginTop: 2 },

  // Points sections
  pointsWrap:      { padding: 20, gap: 14 },
  pointSection:    { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 16 },
  pointHeader:     { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  pointEmoji:      { fontSize: 24 },
  pointLabel:      { fontSize: 14, fontFamily: FFB, color: GOLD, letterSpacing: 1.5 },
  pointSub:        { fontSize: 11, fontFamily: FF, color: '#555', marginTop: 2 },

  // Player buttons
  playerBtns:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  playerBtn:       { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: '#222', backgroundColor: '#1a1a1a' },
  playerBtnOn:     { borderColor: GOLD, backgroundColor: 'rgba(212,175,55,0.15)' },
  playerBtnTxt:    { fontSize: 14, fontFamily: FFB, color: '#888' },
  playerBtnTxtOn:  { color: '#fff' },

  // Nav
  nav:             { flexDirection: 'row', gap: 12, padding: 20, paddingBottom: 40, borderTopWidth: 1, borderTopColor: '#1c1c1c' },
  navBtn:          { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#1c1c1c', backgroundColor: '#111' },
  navPrimary:      { backgroundColor: GOLD, borderColor: GOLD },
  dim:             { opacity: 0.35 },
  navTxt:          { fontSize: 15, fontFamily: FFB, color: '#fff' },
  navTxtPrimary:   { fontSize: 15, fontFamily: FFB, color: '#000' },
});
