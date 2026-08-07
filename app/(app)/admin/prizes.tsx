import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Modal, Platform, Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';

const GOLD = '#D4AF37';
const RED  = '#f87171';
const FF   = 'JUSTSans';
const FFB  = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

interface Payout { position: number; prize_money: string; }
interface PrizeCat {
  id: string; name: string; hcp_min: number | null; hcp_max: number | null;
  display_order: number;
  prize_payouts: { position: number; prize_money: number }[];
}

export default function AdminPrizesScreen() {
  const { id: competitionId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    [FF]:  require('../../../assets/fonts/JUSTSans-Regular.otf'),
    [FFB]: require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [compName, setCompName]       = useState('');
  const [categories, setCategories]   = useState<PrizeCat[]>([]);
  const [loading, setLoading]         = useState(true);

  const [modalOpen, setModalOpen]     = useState(false);
  const [editId, setEditId]           = useState<string | null>(null);
  const [editName, setEditName]       = useState('');
  const [editHcpMin, setEditHcpMin]   = useState('');
  const [editHcpMax, setEditHcpMax]   = useState('');
  const [editPayouts, setEditPayouts] = useState<Payout[]>([
    { position: 1, prize_money: '' },
    { position: 2, prize_money: '' },
    { position: 3, prize_money: '' },
  ]);
  const [saving, setSaving]           = useState(false);

  const [splitting, setSplitting] = useState(false);

  const load = useCallback(async () => {
    if (!competitionId) return;
    const [{ data: comp }, { data: cats }] = await Promise.all([
      supabase.from('competitions').select('name').eq('id', competitionId).single(),
      supabase.from('prize_categories')
        .select('id,name,hcp_min,hcp_max,display_order,prize_payouts(position,prize_money)')
        .eq('competition_id', competitionId)
        .order('display_order'),
    ]);
    if (comp) setCompName((comp as any).name);
    if (cats) setCategories(cats as unknown as PrizeCat[]);
    setLoading(false);
  }, [competitionId]);

  useEffect(() => { load(); }, [load]);

  async function autoSplitDivisions() {
    const { data: cpData } = await supabase
      .from('competition_players').select('handicap_index').eq('competition_id', competitionId);
    const hcps = (cpData as any[] ?? [])
      .map(cp => cp.handicap_index)
      .filter((h): h is number => h != null)
      .sort((a, b) => a - b);

    if (hcps.length < 3) {
      Alert.alert('Not enough players', 'Need at least 3 enrolled players with a handicap to auto-split into 3 divisions.');
      return;
    }

    // Cut on distinct handicap values, not raw sorted position — otherwise a
    // tie sitting on a tercile boundary produces a division with hcp_min >
    // hcp_max that no player can ever match (and its prize money never pays out).
    const distinctHcps = [...new Set(hcps)];
    if (distinctHcps.length < 3) {
      Alert.alert('Not enough handicap variety', 'Need at least 3 different handicap values among enrolled players to split into 3 meaningful divisions.');
      return;
    }
    const dn = distinctHcps.length;
    const div1Max = distinctHcps[Math.floor(dn / 3) - 1];
    const div2Max = distinctHcps[Math.floor((2 * dn) / 3) - 1];

    Alert.alert(
      'Auto-Split into 3 Divisions?',
      'This replaces any existing prize categories with 3 handicap divisions of roughly equal size, based on the players currently enrolled. Prize amounts will need to be re-entered.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Split', onPress: async () => {
          setSplitting(true);
          try {
            await supabase.from('prize_categories').delete().eq('competition_id', competitionId);
            const { error } = await supabase.from('prize_categories').insert([
              { competition_id: competitionId, name: 'Division 1', hcp_min: null,               hcp_max: div1Max,        display_order: 1 },
              { competition_id: competitionId, name: 'Division 2', hcp_min: div1Max + 0.1,       hcp_max: div2Max,        display_order: 2 },
              { competition_id: competitionId, name: 'Division 3', hcp_min: div2Max + 0.1,       hcp_max: null,           display_order: 3 },
            ]);
            if (error) { Alert.alert('Error', error.message); return; }
            await load();
          } catch (e: any) {
            Alert.alert('Error', e?.message ?? 'Could not split into divisions.');
          } finally {
            setSplitting(false);
          }
        }},
      ]
    );
  }

  function openAdd() {
    setEditId(null);
    setEditName('');
    setEditHcpMin('');
    setEditHcpMax('');
    setEditPayouts([
      { position: 1, prize_money: '' },
      { position: 2, prize_money: '' },
      { position: 3, prize_money: '' },
    ]);
    setModalOpen(true);
  }

  function openEdit(cat: PrizeCat) {
    setEditId(cat.id);
    setEditName(cat.name);
    setEditHcpMin(cat.hcp_min != null ? String(cat.hcp_min) : '');
    setEditHcpMax(cat.hcp_max != null ? String(cat.hcp_max) : '');
    const existing = [...cat.prize_payouts].sort((a, b) => a.position - b.position);
    setEditPayouts(existing.length > 0
      ? existing.map(p => ({ position: p.position, prize_money: String(p.prize_money) }))
      : [{ position: 1, prize_money: '' }, { position: 2, prize_money: '' }, { position: 3, prize_money: '' }]
    );
    setModalOpen(true);
  }

  function addPayoutRow() {
    const nextPos = editPayouts.length > 0 ? Math.max(...editPayouts.map(p => p.position)) + 1 : 1;
    setEditPayouts(prev => [...prev, { position: nextPos, prize_money: '' }]);
  }

  function removePayoutRow(idx: number) {
    setEditPayouts(prev => prev.filter((_, i) => i !== idx).map((p, i) => ({ ...p, position: i + 1 })));
  }

  function updatePayout(idx: number, value: string) {
    setEditPayouts(prev => prev.map((p, i) => i === idx ? { ...p, prize_money: value } : p));
  }

  async function save() {
    if (!editName.trim()) { Alert.alert('Name required'); return; }
    setSaving(true);

    const hcp_min = editHcpMin.trim() ? parseFloat(editHcpMin) : null;
    const hcp_max = editHcpMax.trim() ? parseFloat(editHcpMax) : null;
    const display_order = editId
      ? (categories.find(c => c.id === editId)?.display_order ?? categories.length + 1)
      : categories.length + 1;

    let categoryId = editId;

    if (editId) {
      const { error } = await supabase.from('prize_categories')
        .update({ name: editName.trim(), hcp_min, hcp_max })
        .eq('id', editId);
      if (error) { Alert.alert('Error', error.message); setSaving(false); return; }
    } else {
      const { data, error } = await supabase.from('prize_categories')
        .insert({ competition_id: competitionId, name: editName.trim(), hcp_min, hcp_max, display_order })
        .select('id').single();
      if (error || !data) { Alert.alert('Error', error?.message ?? 'Failed'); setSaving(false); return; }
      categoryId = (data as any).id;
    }

    // Replace payouts
    await supabase.from('prize_payouts').delete().eq('category_id', categoryId);
    const validPayouts = editPayouts
      .filter(p => p.prize_money.trim() !== '' && parseFloat(p.prize_money) > 0)
      .map(p => ({ category_id: categoryId, position: p.position, prize_money: parseFloat(p.prize_money) }));
    if (validPayouts.length > 0) {
      const { error } = await supabase.from('prize_payouts').insert(validPayouts);
      if (error) { Alert.alert('Error saving payouts', error.message); setSaving(false); return; }
    }

    setSaving(false);
    setModalOpen(false);
    await load();
  }

  async function deleteCategory(cat: PrizeCat) {
    Alert.alert('Delete category?', `"${cat.name}" and all its prize amounts will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await supabase.from('prize_categories').delete().eq('id', cat.id);
        await load();
      }},
    ]);
  }

  function formatRange(cat: PrizeCat) {
    if (cat.hcp_min != null && cat.hcp_max != null) return `HCP ${cat.hcp_min} – ${cat.hcp_max}`;
    if (cat.hcp_min != null) return `HCP ${cat.hcp_min}+`;
    if (cat.hcp_max != null) return `HCP up to ${cat.hcp_max}`;
    return 'All handicaps';
  }

  if (!fontsLoaded || loading) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" />
      <ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Image source={titanLogo} style={s.logo} resizeMode="contain" />
          <Text style={s.headerTitle}>PRIZE CATEGORIES</Text>
          <Text style={s.headerSub} numberOfLines={1}>{compName}</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.intro}>
          Define handicap bands and prize money per position. Players are automatically placed in their category.
        </Text>

        <TouchableOpacity style={s.splitBtn} onPress={autoSplitDivisions} disabled={splitting} activeOpacity={0.85}>
          {splitting
            ? <ActivityIndicator color={GOLD} size="small" />
            : <>
                <Ionicons name="git-branch-outline" size={16} color={GOLD} />
                <Text style={s.splitBtnText}>AUTO-SPLIT INTO 3 DIVISIONS</Text>
              </>
          }
        </TouchableOpacity>

        {categories.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyText}>No prize categories yet.{'\n'}Tap + ADD CATEGORY to get started.</Text>
          </View>
        ) : (
          categories.map(cat => (
            <View key={cat.id} style={s.catCard}>
              <View style={s.catHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={s.catName}>{cat.name}</Text>
                  <Text style={s.catRange}>{formatRange(cat)}</Text>
                </View>
                <TouchableOpacity onPress={() => openEdit(cat)} style={s.iconBtn}>
                  <Ionicons name="pencil-outline" size={18} color={GOLD} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteCategory(cat)} style={s.iconBtn}>
                  <Ionicons name="trash-outline" size={18} color={RED} />
                </TouchableOpacity>
              </View>

              {cat.prize_payouts.length > 0 ? (
                <View style={s.payoutList}>
                  {[...cat.prize_payouts].sort((a, b) => a.position - b.position).map(pp => (
                    <View key={pp.position} style={s.payoutRow}>
                      <Text style={s.payoutPos}>{ordinal(pp.position)}</Text>
                      <Text style={s.payoutAmt}>£{Number(pp.prize_money).toLocaleString('en-GB', { minimumFractionDigits: 0 })}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={s.noPayouts}>No prize amounts set</Text>
              )}
            </View>
          ))
        )}

        <TouchableOpacity style={s.addBtn} onPress={openAdd} activeOpacity={0.85}>
          <Ionicons name="add" size={18} color={GOLD} />
          <Text style={s.addBtnText}>ADD CATEGORY</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Edit / Add Modal */}
      <Modal visible={modalOpen} animationType="slide" presentationStyle="pageSheet">
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setModalOpen(false)}>
              <Text style={s.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.modalTitle}>{editId ? 'EDIT CATEGORY' : 'ADD CATEGORY'}</Text>
            <TouchableOpacity onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color={GOLD} size="small" /> : <Text style={s.modalSave}>Save</Text>}
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.modalScroll} keyboardShouldPersistTaps="handled">
            <Text style={s.fieldLabel}>CATEGORY NAME</Text>
            <TextInput
              style={s.input}
              value={editName}
              onChangeText={setEditName}
              placeholder="e.g. Category 1"
              placeholderTextColor="#444"
            />

            <Text style={s.fieldLabel}>HANDICAP RANGE</Text>
            <View style={s.hcpRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.hcpSub}>Min (leave blank = no limit)</Text>
                <TextInput
                  style={s.input}
                  value={editHcpMin}
                  onChangeText={setEditHcpMin}
                  placeholder="0"
                  placeholderTextColor="#444"
                  keyboardType="decimal-pad"
                />
              </View>
              <Text style={s.hcpDash}>–</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.hcpSub}>Max (leave blank = no limit)</Text>
                <TextInput
                  style={s.input}
                  value={editHcpMax}
                  onChangeText={setEditHcpMax}
                  placeholder="54"
                  placeholderTextColor="#444"
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            <View style={s.payoutsHeader}>
              <Text style={s.fieldLabel}>PRIZE AMOUNTS</Text>
              <TouchableOpacity
                onPress={addPayoutRow}
                disabled={editPayouts.length >= 6}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[s.addRow, editPayouts.length >= 6 && { opacity: 0.4 }]}>+ Add</Text>
              </TouchableOpacity>
            </View>

            {editPayouts.map((p, idx) => (
              <View key={idx} style={s.payoutEditRow}>
                <Text style={s.payoutEditPos}>{ordinal(p.position)}</Text>
                <View style={s.payoutInputWrap}>
                  <Text style={s.poundSign}>£</Text>
                  <TextInput
                    style={s.payoutInput}
                    value={p.prize_money}
                    onChangeText={v => updatePayout(idx, v)}
                    placeholder="0"
                    placeholderTextColor="#444"
                    keyboardType="decimal-pad"
                  />
                </View>
                {editPayouts.length > 1 && (
                  <TouchableOpacity onPress={() => removePayoutRow(idx)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle-outline" size={20} color="#555" />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function ordinal(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 32, paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  back:        { fontFamily: FFB, fontSize: 13, color: GOLD },
  logo:        { width: 24, height: 24, marginBottom: 2 },
  headerTitle: { fontFamily: FFB, fontSize: 12, color: '#fff', letterSpacing: 1 },
  headerSub:   { fontFamily: FF, fontSize: 11, color: '#888', marginTop: 2, maxWidth: 160, textAlign: 'center' },

  scroll: { padding: 16, paddingBottom: 60 },

  intro: { fontFamily: FF, fontSize: 13, color: '#888', lineHeight: 20, marginBottom: 20 },

  empty:     { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontFamily: FFB, fontSize: 14, color: '#555', textAlign: 'center', lineHeight: 22 },

  catCard:   { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 14, marginBottom: 12 },
  catHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  catName:   { fontFamily: FFB, fontSize: 16, color: '#fff', marginBottom: 2 },
  catRange:  { fontFamily: FF, fontSize: 12, color: '#888' },
  iconBtn:   { padding: 4, marginLeft: 8 },

  payoutList:  { borderTopWidth: 1, borderTopColor: '#1c1c1c', paddingTop: 10 },
  payoutRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  payoutPos:   { fontFamily: FFB, fontSize: 13, color: '#888', width: 40 },
  payoutAmt:   { fontFamily: FFB, fontSize: 16, color: GOLD },
  noPayouts:   { fontFamily: FF, fontSize: 12, color: '#555', fontStyle: 'italic' },

  addBtn:     { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: GOLD + '55', borderRadius: 12, paddingVertical: 14, justifyContent: 'center', marginTop: 8, backgroundColor: GOLD + '0D' },
  addBtnText: { fontFamily: FFB, fontSize: 13, color: GOLD, letterSpacing: 1 },

  splitBtn:     { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#333', borderRadius: 12, paddingVertical: 12, justifyContent: 'center', marginBottom: 20 },
  splitBtnText: { fontFamily: FFB, fontSize: 12, color: GOLD, letterSpacing: 0.5 },

  modal:       { flex: 1, backgroundColor: '#0a0a0a' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 60 : 24, paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  modalCancel: { fontFamily: FFB, fontSize: 14, color: '#888' },
  modalTitle:  { fontFamily: FFB, fontSize: 13, color: '#fff', letterSpacing: 1 },
  modalSave:   { fontFamily: FFB, fontSize: 14, color: GOLD },
  modalScroll: { padding: 20, paddingBottom: 60 },

  fieldLabel: { fontFamily: FFB, fontSize: 10, color: '#888', letterSpacing: 1.5, marginBottom: 8, marginTop: 20 },
  input:      { backgroundColor: '#111', borderRadius: 10, borderWidth: 1, borderColor: '#1c1c1c', padding: 14, fontFamily: FFB, fontSize: 15, color: '#fff' },

  hcpRow:  { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  hcpSub:  { fontFamily: FF, fontSize: 11, color: '#555', marginBottom: 6 },
  hcpDash: { fontFamily: FFB, fontSize: 20, color: '#555', paddingBottom: 14 },

  payoutsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addRow:        { fontFamily: FFB, fontSize: 12, color: GOLD },

  payoutEditRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  payoutEditPos:    { fontFamily: FFB, fontSize: 14, color: '#888', width: 36 },
  payoutInputWrap:  { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', borderRadius: 10, borderWidth: 1, borderColor: '#1c1c1c', paddingHorizontal: 12 },
  poundSign:        { fontFamily: FFB, fontSize: 16, color: '#555', marginRight: 4 },
  payoutInput:      { flex: 1, fontFamily: FFB, fontSize: 15, color: '#fff', paddingVertical: 12 },
});
