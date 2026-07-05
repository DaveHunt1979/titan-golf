import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, Modal, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';

const SPLITS = [
  { label: '50 / 30 / 20', value: [50, 30, 20] },
  { label: '60 / 40', value: [60, 40] },
  { label: 'Winner takes all', value: [100] },
  { label: '40 / 30 / 20 / 10', value: [40, 30, 20, 10] },
];

function genCode() {
  return Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
}

export default function SwindleCreate() {
  const router = useRouter();
  const [name,          setName]          = useState('');
  const [course,        setCourse]        = useState('');
  const [courses,       setCourses]       = useState<string[]>([]);
  const [showPicker,    setShowPicker]    = useState(false);
  const [courseSearch,  setCourseSearch]  = useState('');
  const [fee,           setFee]           = useState('5');
  const [currency,      setCurrency]      = useState('£');
  const [splitIdx,      setSplitIdx]      = useState(0);
  const [saving,        setSaving]        = useState(false);

  useEffect(() => {
    supabase.from('course_holes').select('course_name').then(({ data }) => {
      if (data) {
        const names = [...new Set((data as any[]).map(r => r.course_name).filter(Boolean))].sort() as string[];
        setCourses(names);
      }
    });
  }, []);

  async function create() {
    if (!name.trim()) { Alert.alert('Name required'); return; }
    const entryFee = parseFloat(fee);
    if (isNaN(entryFee) || entryFee < 0) { Alert.alert('Invalid entry fee'); return; }
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    const { data: player } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
    if (!player) { setSaving(false); return; }

    let code = genCode();
    let attempts = 0;
    while (attempts < 5) {
      const { data, error } = await supabase.from('swindle_games').insert({
        name: name.trim(),
        course_name: course.trim() || null,
        entry_fee: entryFee,
        currency,
        prize_split: SPLITS[splitIdx].value,
        join_code: code,
        status: 'open',
        created_by: player.id,
        game_date: new Date().toISOString().split('T')[0],
      }).select('id').single();

      if (!error && data) {
        // Auto-enter the creator
        await supabase.from('swindle_entries').insert({ game_id: data.id, player_id: player.id });
        setSaving(false);
        router.replace(`/(app)/swindle/${data.id}` as any);
        return;
      }
      if (error?.code === '23505') { code = genCode(); attempts++; continue; }
      Alert.alert('Error', error?.message ?? 'Could not create game');
      break;
    }
    setSaving(false);
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>New Swindle</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.form}>
        <Field label="GAME NAME" hint="e.g. Tuesday Swindle">
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Tuesday Swindle" placeholderTextColor={colors.textMuted} />
        </Field>

        <Field label="COURSE (OPTIONAL)">
          <TouchableOpacity
            style={[s.input, s.pickerBtn]}
            onPress={() => { setCourseSearch(''); setShowPicker(true); }}
            activeOpacity={0.8}
          >
            <Text style={course ? s.pickerBtnText : s.pickerBtnPlaceholder}>
              {course || 'Select course…'}
            </Text>
            <Text style={s.pickerArrow}>›</Text>
          </TouchableOpacity>
        </Field>

        <Field label="ENTRY FEE">
          <View style={s.feeRow}>
            {['£', '$', '€'].map(c => (
              <TouchableOpacity key={c} style={[s.currencyBtn, currency === c && s.currencyBtnActive]} onPress={() => setCurrency(c)}>
                <Text style={[s.currencyText, currency === c && s.currencyTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
            <TextInput
              style={[s.input, { flex: 1 }]}
              value={fee}
              onChangeText={setFee}
              keyboardType="decimal-pad"
              placeholder="5"
              placeholderTextColor={colors.textMuted}
            />
          </View>
        </Field>

        <Field label="PRIZE SPLIT">
          {SPLITS.map((sp, i) => (
            <TouchableOpacity key={i} style={[s.splitOption, splitIdx === i && s.splitOptionActive]} onPress={() => setSplitIdx(i)}>
              <Text style={[s.splitText, splitIdx === i && s.splitTextActive]}>{sp.label}</Text>
              <View style={s.splitPills}>
                {sp.value.map((v, j) => (
                  <View key={j} style={[s.pill, splitIdx === i && s.pillActive]}>
                    <Text style={[s.pillText, splitIdx === i && s.pillTextActive]}>{j + 1}{j === 0 ? 'st' : j === 1 ? 'nd' : j === 2 ? 'rd' : 'th'} {v}%</Text>
                  </View>
                ))}
              </View>
            </TouchableOpacity>
          ))}
        </Field>

        <TouchableOpacity style={[s.createBtn, saving && s.createBtnDisabled]} onPress={create} disabled={saving} activeOpacity={0.85}>
          <Text style={s.createBtnText}>{saving ? 'Creating…' : 'Create Swindle'}</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Course picker modal */}
      <Modal visible={showPicker} animationType="slide" transparent>
        <View style={s.pickerOverlay}>
          <View style={s.pickerSheet}>
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>Select Course</Text>
              <TouchableOpacity onPress={() => setShowPicker(false)}>
                <Text style={s.pickerClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={s.pickerSearch}
              placeholder="Search courses…"
              placeholderTextColor={colors.textMuted}
              value={courseSearch}
              onChangeText={setCourseSearch}
              autoFocus
            />
            <FlatList
              data={courses.filter(c => c.toLowerCase().includes(courseSearch.toLowerCase()))}
              keyExtractor={item => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[s.pickerItem, course === item && s.pickerItemActive]}
                  onPress={() => { setCourse(item); setShowPicker(false); }}
                  activeOpacity={0.8}
                >
                  <Text style={[s.pickerItemText, course === item && s.pickerItemTextActive]}>{item}</Text>
                  {course === item && <Text style={s.pickerTick}>✓</Text>}
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={s.pickerEmpty}>No courses found</Text>}
            />
            <TouchableOpacity style={s.pickerClear} onPress={() => { setCourse(''); setShowPicker(false); }}>
              <Text style={s.pickerClearText}>Clear selection</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}{hint ? <Text style={s.fieldHint}> — {hint}</Text> : null}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  container:         { flex: 1, backgroundColor: colors.bg, paddingTop: 56 },
  header:            { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, marginBottom: spacing.lg, gap: spacing.md },
  backBtn:           { paddingVertical: spacing.xs },
  backText:          { color: colors.gold, fontSize: fonts.md, fontWeight: '600' },
  title:             { fontSize: fonts.xl, fontWeight: '800', color: colors.white },
  form:              { padding: spacing.md, gap: spacing.lg, paddingBottom: 48 },
  field:             { gap: spacing.sm },
  fieldLabel:        { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5 },
  fieldHint:         { fontWeight: '400', letterSpacing: 0 },
  input:             { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, color: colors.white, fontSize: fonts.md },
  feeRow:            { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  currencyBtn:       { width: 40, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  currencyBtnActive: { borderColor: colors.gold, backgroundColor: colors.goldDim },
  currencyText:      { color: colors.textMuted, fontSize: fonts.md, fontWeight: '700' },
  currencyTextActive:{ color: colors.gold },
  splitOption:       { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  splitOptionActive: { borderColor: colors.gold, backgroundColor: colors.goldDim },
  splitText:         { color: colors.textSecondary, fontWeight: '700', fontSize: fonts.sm },
  splitTextActive:   { color: colors.gold },
  splitPills:        { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  pill:              { backgroundColor: colors.cardAlt, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  pillActive:        { backgroundColor: 'rgba(212,175,55,0.2)' },
  pillText:          { fontSize: 10, fontWeight: '600', color: colors.textMuted },
  pillTextActive:    { color: colors.gold },
  createBtn:           { backgroundColor: colors.gold, borderRadius: radius.lg, paddingVertical: 16, alignItems: 'center', marginTop: spacing.md },
  createBtnDisabled:   { opacity: 0.6 },
  createBtnText:       { color: colors.bg, fontSize: fonts.lg, fontWeight: '800', letterSpacing: 0.5 },
  pickerBtn:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerBtnText:       { color: colors.white, fontSize: fonts.md, flex: 1 },
  pickerBtnPlaceholder:{ color: colors.textMuted, fontSize: fonts.md, flex: 1 },
  pickerArrow:         { color: colors.textMuted, fontSize: 20 },
  pickerOverlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  pickerSheet:         { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: 40, maxHeight: '75%' },
  pickerHeader:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerTitle:         { fontSize: fonts.lg, fontWeight: '800', color: colors.white },
  pickerClose:         { fontSize: fonts.lg, color: colors.textMuted, paddingHorizontal: spacing.sm },
  pickerSearch:        { margin: spacing.md, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.white, fontSize: fonts.md },
  pickerItem:          { paddingHorizontal: spacing.md, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center' },
  pickerItemActive:    { backgroundColor: colors.goldDim },
  pickerItemText:      { flex: 1, fontSize: fonts.md, color: colors.textSecondary },
  pickerItemTextActive:{ color: colors.gold, fontWeight: '700' },
  pickerTick:          { color: colors.gold, fontWeight: '800' },
  pickerEmpty:         { color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.xl, fontSize: fonts.sm },
  pickerClear:         { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.xs },
  pickerClearText:     { color: colors.textMuted, fontSize: fonts.sm },
});
