import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';

const CLUBS = ['Driver','3W','5W','3i','4i','5i','6i','7i','8i','9i','PW','GW','SW','LW'];
const TARGETS = [50,75,100,125,150,175,200,225,250,275,300];
const SHAPES = [
  { key: 'hook',     label: '⟵⟵', tip: 'Hook' },
  { key: 'draw',     label: '⟵',   tip: 'Draw' },
  { key: 'straight', label: '↑',   tip: 'Straight' },
  { key: 'fade',     label: '⟶',   tip: 'Fade' },
  { key: 'slice',    label: '⟶⟶', tip: 'Slice' },
];
const QUALITY = [
  { key: 'poor',  label: '❌', tip: 'Poor' },
  { key: 'ok',    label: '✓',  tip: 'OK' },
  { key: 'flush', label: '🔥', tip: 'Flush' },
];

interface Shot {
  id: string;
  club: string;
  carry: number | null;
  shape: string | null;
  quality: string | null;
  created_at: string;
}

export default function RangeSessionScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();

  const [shots, setShots]       = useState<Shot[]>([]);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);

  const [club,    setClub]    = useState('7i');
  const [carry,   setCarry]   = useState('');
  const [shape,   setShape]   = useState<string>('straight');
  const [quality, setQuality] = useState<string>('ok');
  const [showTargets, setShowTargets] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: player } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (player) setPlayerId((player as any).id);
      const { data } = await supabase
        .from('range_shots')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false });
      if (data) setShots(data as Shot[]);
      setLoading(false);
    }
    load();
  }, [sessionId]);

  async function logShot() {
    if (!playerId) return;
    setSaving(true);
    const { data, error } = await supabase.from('range_shots').insert({
      session_id: sessionId,
      player_id: playerId,
      club,
      carry: carry ? parseInt(carry) : null,
      shape,
      quality,
    }).select().single();
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setShots(prev => [data as Shot, ...prev]);
    setCarry('');
  }

  async function deleteShot(id: string) {
    await supabase.from('range_shots').delete().eq('id', id);
    setShots(prev => prev.filter(s => s.id !== id));
  }

  async function endSession() {
    router.back();
  }

  // Stats for current club
  const clubShots = shots.filter(s => s.club === club && s.carry);
  const carries = clubShots.map(s => s.carry!);
  const avg = carries.length ? Math.round(carries.reduce((a, b) => a + b, 0) / carries.length) : null;
  const max = carries.length ? Math.max(...carries) : null;

  if (loading) return (
    <View style={s.centered}><ActivityIndicator color={colors.gold} size="large" /></View>
  );

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* ── Fixed top panel ─────────────────────────────────────── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>DRIVING RANGE</Text>
        <View style={s.headerRight}>
          <TouchableOpacity style={s.binBtn} onPress={() => setShowTargets(true)} activeOpacity={0.8}>
            <Text style={s.binIcon}>🔭</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.endBtn} onPress={endSession} activeOpacity={0.8}>
            <Text style={s.endBtnText}>End</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Club selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.clubScroll} contentContainerStyle={s.clubRow}>
        {CLUBS.map(c => (
          <TouchableOpacity
            key={c}
            style={[s.clubChip, club === c && s.clubChipOn]}
            onPress={() => setClub(c)}
            activeOpacity={0.7}
          >
            <Text style={[s.clubChipText, club === c && s.clubChipTextOn]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Club stats banner */}
      {avg !== null && (
        <View style={s.statsBanner}>
          <View style={s.statItem}>
            <Text style={s.statVal}>{avg}</Text>
            <Text style={s.statLbl}>AVG YDS</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statItem}>
            <Text style={s.statVal}>{max}</Text>
            <Text style={s.statLbl}>MAX YDS</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statItem}>
            <Text style={s.statVal}>{clubShots.length}</Text>
            <Text style={s.statLbl}>SHOTS</Text>
          </View>
        </View>
      )}

      {/* Carry input */}
      <View style={s.inputCard}>
        <Text style={s.inputLabel}>CARRY (YARDS)</Text>
        <TextInput
          style={s.carryInput}
          value={carry}
          onChangeText={setCarry}
          keyboardType="number-pad"
          placeholder="e.g. 150"
          placeholderTextColor={colors.textMuted}
          maxLength={3}
        />
      </View>

      {/* Shape picker */}
      <View style={s.inputCard}>
        <Text style={s.inputLabel}>BALL FLIGHT</Text>
        <View style={s.shapeRow}>
          {SHAPES.map(sh => (
            <TouchableOpacity
              key={sh.key}
              style={[s.shapeBtn, shape === sh.key && s.shapeBtnOn]}
              onPress={() => setShape(sh.key)}
              activeOpacity={0.7}
            >
              <Text style={[s.shapeIcon, shape === sh.key && s.shapeIconOn]}>{sh.label}</Text>
              <Text style={[s.shapeTip, shape === sh.key && s.shapeTipOn]}>{sh.tip}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Quality picker */}
      <View style={s.inputCard}>
        <Text style={s.inputLabel}>QUALITY</Text>
        <View style={s.qualRow}>
          {QUALITY.map(q => (
            <TouchableOpacity
              key={q.key}
              style={[s.qualBtn, quality === q.key && s.qualBtnOn]}
              onPress={() => setQuality(q.key)}
              activeOpacity={0.7}
            >
              <Text style={s.qualIcon}>{q.label}</Text>
              <Text style={[s.qualTip, quality === q.key && s.qualTipOn]}>{q.tip}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Log button */}
      <TouchableOpacity
        style={[s.logBtn, saving && s.logBtnOff]}
        onPress={logShot}
        disabled={saving}
        activeOpacity={0.85}
      >
        {saving
          ? <ActivityIndicator color={colors.bg} />
          : <Text style={s.logBtnText}>Log Shot · {club}{carry ? ` · ${carry} yds` : ''}</Text>
        }
      </TouchableOpacity>

      {/* ── Scrollable shot history ──────────────────────────────── */}
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {shots.length > 0 && (
          <>
            <Text style={s.historyLabel}>THIS SESSION · {shots.length} SHOTS</Text>
            {shots.map(shot => (
              <View key={shot.id} style={s.shotRow}>
                <View style={s.shotClub}>
                  <Text style={s.shotClubText}>{shot.club}</Text>
                </View>
                <View style={s.shotDetails}>
                  {shot.carry && <Text style={s.shotCarry}>{shot.carry} yds</Text>}
                  <View style={s.shotMeta}>
                    {shot.shape && <Text style={s.shotTag}>{SHAPES.find(sh => sh.key === shot.shape)?.tip ?? shot.shape}</Text>}
                    {shot.quality && <Text style={[s.shotTag, shot.quality === 'flush' && s.shotTagFlush, shot.quality === 'poor' && s.shotTagPoor]}>{QUALITY.find(q => q.key === shot.quality)?.label} {QUALITY.find(q => q.key === shot.quality)?.tip}</Text>}
                  </View>
                </View>
                <TouchableOpacity onPress={() => deleteShot(shot.id)} style={s.deleteBtn} activeOpacity={0.7}>
                  <Text style={s.deleteBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {shots.length === 0 && (
          <View style={s.emptyHint}>
            <Text style={s.emptyHintText}>Select a club, enter your carry distance and log your first shot 🏌️</Text>
          </View>
        )}

      </ScrollView>

      {/* Target distance picker modal */}
      <Modal visible={showTargets} transparent animationType="slide" onRequestClose={() => setShowTargets(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowTargets(false)}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>🔭 RANGE FINDER</Text>
            <Text style={s.modalSub}>Set your target distance then select a club</Text>
            <View style={s.targetsGrid}>
              {TARGETS.map(t => (
                <TouchableOpacity
                  key={t}
                  style={[s.targetBtn, carry === String(t) && s.targetBtnOn]}
                  onPress={() => { setCarry(String(t)); setShowTargets(false); }}
                  activeOpacity={0.75}
                >
                  <Text style={[s.targetYds, carry === String(t) && s.targetYdsOn]}>{t}</Text>
                  <Text style={s.targetLbl}>yds</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={s.modalCancel} onPress={() => setShowTargets(false)} activeOpacity={0.7}>
              <Text style={s.modalCancelText}>Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },

  header: {
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn:      { minWidth: 60 },
  backText:     { fontSize: fonts.md, color: colors.gold, fontWeight: '600' },
  headerTitle:  { fontSize: fonts.sm, fontWeight: '800', color: colors.white, letterSpacing: 2 },
  headerRight:  { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  endBtn:       { backgroundColor: colors.cardAlt, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border },
  endBtnText:   { fontSize: fonts.xs, color: colors.textMuted, fontWeight: '700' },
  binBtn:       { padding: spacing.xs },
  binIcon:      { fontSize: 22 },

  clubScroll: { borderBottomWidth: 1, borderBottomColor: colors.border },
  clubRow:    { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  clubChip:   { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.full, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  clubChipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  clubChipText:    { fontSize: fonts.sm, fontWeight: '700', color: colors.textMuted },
  clubChipTextOn:  { color: colors.bg },

  statsBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  statItem:   { alignItems: 'center', paddingHorizontal: spacing.xl },
  statVal:    { fontSize: fonts.xl, fontWeight: '900', color: colors.gold },
  statLbl:    { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginTop: 2 },
  statDivider: { width: 1, height: 28, backgroundColor: colors.border },

  scroll: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 40 },

  inputCard: {
    backgroundColor: colors.card, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
    marginHorizontal: spacing.md,
  },
  inputLabel: { fontSize: 9, fontWeight: '800', color: colors.textMuted, letterSpacing: 2, marginBottom: spacing.sm },
  carryInput: {
    fontSize: 48, fontWeight: '900', color: colors.white, textAlign: 'center',
    paddingVertical: spacing.sm,
  },

  shapeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.xs },
  shapeBtn:    { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  shapeBtnOn:  { backgroundColor: colors.goldDim, borderColor: colors.gold },
  shapeIcon:   { fontSize: fonts.lg, color: colors.textMuted, fontWeight: '700' },
  shapeIconOn: { color: colors.gold },
  shapeTip:    { fontSize: 9, color: colors.textMuted, marginTop: 2, fontWeight: '600' },
  shapeTipOn:  { color: colors.gold },

  qualRow: { flexDirection: 'row', gap: spacing.md, justifyContent: 'center' },
  qualBtn:    { flex: 1, alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  qualBtnOn:  { backgroundColor: colors.goldDim, borderColor: colors.gold },
  qualIcon:   { fontSize: fonts.xl },
  qualTip:    { fontSize: fonts.xs, color: colors.textMuted, marginTop: 4, fontWeight: '600' },
  qualTipOn:  { color: colors.white },

  logBtn:    { backgroundColor: colors.gold, borderRadius: radius.lg, paddingVertical: spacing.lg, alignItems: 'center', marginBottom: spacing.sm, marginHorizontal: spacing.md },
  logBtnOff: { opacity: 0.5 },
  logBtnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg, letterSpacing: 1 },

  historyLabel: { fontSize: 9, fontWeight: '800', color: colors.textMuted, letterSpacing: 2, marginBottom: spacing.sm },

  shotRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm, marginBottom: spacing.xs,
  },
  shotClub:    { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  shotClubText: { fontSize: fonts.sm, fontWeight: '800', color: colors.gold },
  shotDetails: { flex: 1 },
  shotCarry:   { fontSize: fonts.md, fontWeight: '800', color: colors.white },
  shotMeta:    { flexDirection: 'row', gap: spacing.xs, marginTop: 2 },
  shotTag:     { fontSize: fonts.xs, color: colors.textMuted, backgroundColor: colors.cardAlt, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  shotTagFlush: { color: colors.gold },
  shotTagPoor:  { color: colors.red },
  deleteBtn:   { padding: spacing.sm },
  deleteBtnText: { fontSize: fonts.sm, color: colors.textMuted },

  emptyHint: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyHintText: { fontSize: fonts.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },

  modalOverlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet:     { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: 48, borderTopWidth: 1, borderTopColor: colors.border },
  modalTitle:     { fontSize: fonts.sm, fontWeight: '900', color: colors.white, letterSpacing: 2, textAlign: 'center', marginBottom: spacing.xs },
  modalSub:       { fontSize: fonts.xs, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.lg },
  targetsGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center', marginBottom: spacing.lg },
  targetBtn:      { width: 68, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  targetBtnOn:    { backgroundColor: colors.goldDim, borderColor: colors.gold },
  targetYds:      { fontSize: fonts.lg, fontWeight: '800', color: colors.white },
  targetYdsOn:    { color: colors.gold },
  targetLbl:      { fontSize: 9, color: colors.textMuted, fontWeight: '600', marginTop: 1 },
  modalCancel:    { alignItems: 'center', paddingVertical: spacing.md },
  modalCancelText: { fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600' },
});
