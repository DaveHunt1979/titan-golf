import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, ActivityIndicator, Alert, Modal, Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

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
  { key: 'poor',  label: 'POOR',  color: RED },
  { key: 'ok',    label: 'OK',    color: '#aaa' },
  { key: 'flush', label: 'FLUSH', color: GOLD },
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

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

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

  if (loading || !fontsLoaded) return (
    <View style={s.centered}><ActivityIndicator color={GOLD} size="large" /></View>
  );

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* ── Header ─────────────────────────────────────────────────── */}
      <View style={s.header}>
        {/* Left: back chevron */}
        <TouchableOpacity onPress={() => router.back()} style={s.headerLeft} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={GOLD} />
        </TouchableOpacity>

        {/* Centre: logo + subtitle */}
        <View style={s.headerCentre}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerSub}>DRIVING RANGE</Text>
        </View>

        {/* Right: telescope + End pill */}
        <View style={s.headerRight}>
          <TouchableOpacity onPress={() => setShowTargets(true)} activeOpacity={0.7} style={s.iconBtn}>
            <Ionicons name="telescope-outline" size={22} color="#555" />
          </TouchableOpacity>
          <TouchableOpacity style={s.endBtn} onPress={endSession} activeOpacity={0.8}>
            <Text style={s.endBtnText}>End</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Club selector strip ─────────────────────────────────────── */}
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

      {/* ── Stats banner ───────────────────────────────────────────── */}
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

      {/* ── Scrollable body ─────────────────────────────────────────── */}
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* Carry input */}
        <View style={s.inputCard}>
          <Text style={s.inputLabel}>CARRY (YARDS)</Text>
          <TextInput
            style={s.carryInput}
            value={carry}
            onChangeText={setCarry}
            keyboardType="number-pad"
            placeholder="e.g. 150"
            placeholderTextColor="#333"
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
            {QUALITY.map(q => {
              const isOn = quality === q.key;
              return (
                <TouchableOpacity
                  key={q.key}
                  style={[s.qualBtn, isOn && s.qualBtnOn]}
                  onPress={() => setQuality(q.key)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.qualLabel, isOn && { color: q.color }]}>{q.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Log Shot button */}
        <TouchableOpacity
          style={[s.logBtn, saving && s.logBtnOff]}
          onPress={logShot}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator color="#000" />
            : <Text style={s.logBtnText}>Log Shot · {club}{carry ? ` · ${carry} yds` : ''}</Text>
          }
        </TouchableOpacity>

        {/* Shot history */}
        {shots.length > 0 && (
          <>
            <Text style={s.historyLabel}>THIS SESSION · {shots.length} SHOTS</Text>
            {shots.map(shot => (
              <View key={shot.id} style={s.shotRow}>
                {/* Club badge */}
                <View style={s.shotClub}>
                  <Text style={s.shotClubText}>{shot.club}</Text>
                </View>
                {/* Details */}
                <View style={s.shotDetails}>
                  {shot.carry && <Text style={s.shotCarry}>{shot.carry} yds</Text>}
                  <View style={s.shotMeta}>
                    {shot.shape && (
                      <Text style={s.shotTag}>{SHAPES.find(sh => sh.key === shot.shape)?.tip ?? shot.shape}</Text>
                    )}
                    {shot.quality && (
                      <Text style={[
                        s.shotTag,
                        shot.quality === 'flush' && { color: GOLD },
                        shot.quality === 'poor'  && { color: RED },
                        shot.quality === 'ok'    && { color: '#555' },
                      ]}>
                        {QUALITY.find(q => q.key === shot.quality)?.label}
                      </Text>
                    )}
                  </View>
                </View>
                {/* Delete */}
                <TouchableOpacity onPress={() => deleteShot(shot.id)} style={s.deleteBtn} activeOpacity={0.7}>
                  <Ionicons name="trash-outline" size={18} color="#333" />
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {shots.length === 0 && (
          <View style={s.emptyHint}>
            <Text style={s.emptyHintText}>Select a club, enter your carry distance and log your first shot</Text>
          </View>
        )}

      </ScrollView>

      {/* ── Target distance modal ───────────────────────────────────── */}
      <Modal visible={showTargets} transparent animationType="slide" onRequestClose={() => setShowTargets(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowTargets(false)}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>TARGET DISTANCE</Text>
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
  container: { flex: 1, backgroundColor: '#000' },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },

  // Header
  header: {
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft:   { minWidth: 44, alignItems: 'flex-start' },
  headerCentre: { alignItems: 'center' },
  headerLogo:   { width: 28, height: 28 },
  headerSub:    { fontFamily: FF, fontSize: 9, color: GOLD, letterSpacing: 2.5, marginTop: 3 },
  headerRight:  { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 80, justifyContent: 'flex-end' },
  iconBtn:      { padding: 4 },
  endBtn: {
    backgroundColor: 'transparent',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#1c1c1c',
  },
  endBtnText: { fontFamily: FF, fontSize: 12, color: '#555' },

  // Club strip
  clubScroll: {},
  clubRow:    { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  clubChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#222',
  },
  clubChipOn:      { backgroundColor: GOLD, borderColor: GOLD },
  clubChipText:    { fontFamily: FF, fontSize: 13, color: '#555' },
  clubChipTextOn:  { fontFamily: FFB, color: '#000' },

  // Stats banner
  statsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#1c1c1c',
    paddingVertical: 12,
  },
  statItem:    { alignItems: 'center', paddingHorizontal: 28 },
  statVal:     { fontFamily: FFB, fontSize: 22, color: GOLD },
  statLbl:     { fontFamily: FF, fontSize: 9, color: '#555', letterSpacing: 2, marginTop: 2 },
  statDivider: { width: 1, height: 28, backgroundColor: '#222' },

  // Scroll body
  scroll: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 },

  // Input cards
  inputCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1c1c1c',
    padding: 16,
    marginBottom: 10,
  },
  inputLabel: { fontFamily: FF, fontSize: 10, color: '#555', letterSpacing: 2, marginBottom: 10 },
  carryInput: {
    fontFamily: FFB,
    fontSize: 48,
    color: '#fff',
    textAlign: 'center',
    paddingVertical: 8,
  },

  // Shape picker
  shapeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  shapeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#222',
  },
  shapeBtnOn:  { backgroundColor: `${GOLD}15`, borderColor: `${GOLD}40` },
  shapeIcon:   { fontFamily: FFB, fontSize: 16, color: '#444' },
  shapeIconOn: { color: GOLD },
  shapeTip:    { fontFamily: FF, fontSize: 10, color: '#444', marginTop: 3 },
  shapeTipOn:  { color: GOLD },

  // Quality picker
  qualRow: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  qualBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#222',
  },
  qualBtnOn:  { backgroundColor: `${GOLD}15`, borderColor: `${GOLD}40` },
  qualLabel:  { fontFamily: FFB, fontSize: 13, color: '#444' },

  // Log button
  logBtn:     { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 10 },
  logBtnOff:  { opacity: 0.5 },
  logBtnText: { fontFamily: FFB, fontSize: 16, color: '#000' },

  // History
  historyLabel: { fontFamily: FF, fontSize: 10, color: '#555', letterSpacing: 2, marginBottom: 10, marginTop: 6 },

  shotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1c1c1c',
    padding: 10,
    marginBottom: 6,
  },
  shotClub: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#1c1c1c',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  shotClubText: { fontFamily: FFB, fontSize: 13, color: GOLD },
  shotDetails:  { flex: 1 },
  shotCarry:    { fontFamily: FFB, fontSize: 15, color: '#fff' },
  shotMeta:     { flexDirection: 'row', gap: 6, marginTop: 3 },
  shotTag: {
    fontFamily: FF,
    fontSize: 11,
    color: '#555',
    backgroundColor: '#1c1c1c',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  deleteBtn: { padding: 8 },

  // Empty
  emptyHint:     { alignItems: 'center', paddingVertical: 40 },
  emptyHintText: { fontFamily: FF, fontSize: 14, color: '#444', textAlign: 'center' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 48,
    borderTopWidth: 1,
    borderTopColor: '#1c1c1c',
  },
  modalTitle:  { fontFamily: FFB, fontSize: 12, color: '#fff', letterSpacing: 2, textAlign: 'center', marginBottom: 6 },
  modalSub:    { fontFamily: FF, fontSize: 12, color: '#555', textAlign: 'center', marginBottom: 20 },
  targetsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginBottom: 20 },
  targetBtn: {
    width: 68,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#222',
  },
  targetBtnOn:    { backgroundColor: GOLD, borderColor: GOLD },
  targetYds:      { fontFamily: FFB, fontSize: 18, color: '#fff' },
  targetYdsOn:    { color: '#000' },
  targetLbl:      { fontFamily: FF, fontSize: 10, color: '#555', marginTop: 1 },
  modalCancel:    { alignItems: 'center', paddingVertical: 14 },
  modalCancelText: { fontFamily: FF, fontSize: 14, color: GOLD },
});
