import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../../src/lib/theme';

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

  if (loading) return <View style={s.centered}><ActivityIndicator color={colors.gold} size="large" /></View>;
  if (!match || !hole) return null;

  return (
    <View style={s.container}>
      <StatusBar style="light" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>← Back</Text></TouchableOpacity>
        <Text style={s.title}>BINGO BANGO BONGO</Text>
        <View style={{ width: 60 }} />
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

      <View style={s.holeCard}>
        <Text style={s.holeNum}>Hole {hole.hole_number}</Text>
        <Text style={s.holeMeta}>Par {hole.par}  ·  SI {hole.stroke_index}</Text>
      </View>

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

      <View style={s.nav}>
        <TouchableOpacity style={[s.navBtn, holeIdx === 0 && s.dim]} onPress={async () => { await save(); setHoleIdx(Math.max(0, holeIdx - 1)); }} disabled={holeIdx === 0 || saving} activeOpacity={0.7}>
          <Text style={s.navTxt}>← Prev</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.navBtn, s.navPrimary, saving && s.dim]} onPress={next} disabled={saving} activeOpacity={0.8}>
          {saving ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={[s.navTxt, { color: colors.bg }]}>{holeIdx === holes.length - 1 ? 'Finish →' : 'Next →'}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container:  { flex: 1, backgroundColor: colors.bg },
  centered:   { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  back:       { fontSize: fonts.sm, fontWeight: '600', color: colors.gold },
  title:      { fontSize: 10, fontWeight: '800', color: colors.white, letterSpacing: 1 },
  totalsScroll:{ maxHeight: 80, borderBottomWidth: 1, borderBottomColor: colors.border },
  totals:     { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, alignItems: 'center' },
  totalItem:  { alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minWidth: 64 },
  totalName:  { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, marginBottom: 2 },
  totalPts:   { fontSize: fonts.xl, fontWeight: '900', color: colors.gold },
  totalLbl:   { fontSize: 8, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginTop: 1 },
  holeCard:   { alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  holeNum:    { fontSize: 28, fontWeight: '900', color: colors.white },
  holeMeta:   { fontSize: fonts.xs, color: colors.textMuted, fontWeight: '600', marginTop: 2 },
  pointsWrap: { padding: spacing.lg, gap: spacing.lg },
  pointSection:{ backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  pointHeader:{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  pointEmoji: { fontSize: 24 },
  pointLabel: { fontSize: fonts.sm, fontWeight: '800', color: colors.gold },
  pointSub:   { fontSize: fonts.xs, color: colors.textMuted, marginTop: 1 },
  playerBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  playerBtn:  { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardAlt },
  playerBtnOn:{ borderColor: colors.gold, backgroundColor: colors.goldDim },
  playerBtnTxt:   { fontSize: fonts.sm, fontWeight: '700', color: colors.textSecondary },
  playerBtnTxtOn: { color: colors.white },
  nav:        { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, paddingBottom: 40, borderTopWidth: 1, borderTopColor: colors.border },
  navBtn:     { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  navPrimary: { backgroundColor: colors.gold, borderColor: colors.gold },
  dim:        { opacity: 0.35 },
  navTxt:     { fontSize: fonts.md, fontWeight: '800', color: colors.white },
});
