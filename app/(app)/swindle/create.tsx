import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, Modal, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';

const HCP_ALLOWANCES = [
  { value: 100, label: 'Full',    desc: '100%'    },
  { value: 90,  label: '9/10',   desc: '90%'     },
  { value: 75,  label: '¾',      desc: '75%'     },
  { value: 0,   label: 'Scratch', desc: 'Off hcp' },
] as const;

const SPLITS = [
  { label: '50 / 30 / 20', value: [50, 30, 20] },
  { label: '60 / 40', value: [60, 40] },
  { label: 'Winner takes all', value: [100] },
  { label: '40 / 30 / 20 / 10', value: [40, 30, 20, 10] },
];

type CourseHole = { hole_number: number; par: number };

function genCode() {
  return Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
}

export default function SwindleCreate() {
  const router = useRouter();
  const [name,          setName]          = useState('');
  const [course,        setCourse]        = useState('');
  const [courses,       setCourses]       = useState<string[]>([]);
  const [courseHoles,   setCourseHoles]   = useState<CourseHole[]>([]);
  const [showPicker,    setShowPicker]    = useState(false);
  const [courseSearch,  setCourseSearch]  = useState('');
  const [fee,           setFee]           = useState('5');
  const [currency,      setCurrency]      = useState('£');
  const [splitIdx,      setSplitIdx]      = useState(0);
  const [format,        setFormat]        = useState<'stableford' | 'stroke'>('stableford');
  const [twosEnabled,   setTwosEnabled]   = useState(false);
  const [twosFee,       setTwosFee]       = useState('');
  const [ntpEnabled,    setNtpEnabled]    = useState(false);
  const [ntpHole,       setNtpHole]       = useState<number | null>(null);
  const [ntpFee,        setNtpFee]        = useState('');
  const [ldEnabled,     setLdEnabled]     = useState(false);
  const [ldHole,        setLdHole]        = useState<number | null>(null);
  const [ldFee,         setLdFee]         = useState('');
  const [isRecurring,   setIsRecurring]   = useState(false);
  const [recurringDay,  setRecurringDay]  = useState<string>('saturday');
  const [saving,        setSaving]        = useState(false);
  const [hcpAllowance, setHcpAllowance] = useState(100);
  const [slope,        setSlope]        = useState('113');
  const [cRating,      setCRating]      = useState('');

  useEffect(() => {
    supabase.from('course_holes').select('course_name').then(({ data }) => {
      if (data) {
        const names = [...new Set((data as any[]).map(r => r.course_name).filter(Boolean))].sort() as string[];
        setCourses(names);
      }
    });
  }, []);

  useEffect(() => {
    if (!course) { setCourseHoles([]); setNtpHole(null); setLdHole(null); return; }
    supabase.from('course_holes').select('hole_number,par').eq('course_name', course).order('hole_number')
      .then(({ data }) => { if (data) setCourseHoles(data as CourseHole[]); });
  }, [course]);

  const par3s = courseHoles.filter(h => h.par === 3);
  const par5s = courseHoles.filter(h => h.par === 5);

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
        is_recurring: isRecurring,
        recurring_day: isRecurring ? recurringDay : null,
        format,
        hcp_allowance: hcpAllowance,
        slope_rating:  parseInt(slope) || 113,
        course_rating: cRating.trim() ? parseFloat(cRating) || null : null,
        twos_enabled: twosEnabled,
        twos_fee: twosEnabled && twosFee ? parseFloat(twosFee) || 0 : 0,
        ntp_hole: ntpEnabled ? ntpHole : null,
        ntp_fee: ntpEnabled && ntpFee ? parseFloat(ntpFee) || 0 : 0,
        ld_hole: ldEnabled ? ldHole : null,
        ld_fee: ldEnabled && ldFee ? parseFloat(ldFee) || 0 : 0,
      }).select('id').single();

      if (!error && data) {
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

        {/* Format toggle */}
        <Field label="FORMAT">
          <View style={s.toggleRow}>
            {(['stableford', 'stroke'] as const).map(f => (
              <TouchableOpacity key={f} style={[s.toggleBtn, format === f && s.toggleBtnActive]} onPress={() => setFormat(f)} activeOpacity={0.8}>
                <Text style={[s.toggleText, format === f && s.toggleTextActive]}>
                  {f === 'stableford' ? 'Stableford' : 'Stroke Play'}
                </Text>
                <Text style={[s.toggleSub, format === f && s.toggleSubActive]}>
                  {f === 'stableford' ? 'Higher pts wins' : 'Lowest net wins'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Field>

        {/* Handicap allowance */}
        <Field label="HANDICAP ALLOWANCE">
          <View style={s.toggleRow}>
            {HCP_ALLOWANCES.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[s.toggleBtn, hcpAllowance === opt.value && s.toggleBtnActive]}
                onPress={() => setHcpAllowance(opt.value)}
                activeOpacity={0.8}
              >
                <Text style={[s.toggleText, hcpAllowance === opt.value && s.toggleTextActive]}>
                  {opt.label}
                </Text>
                <Text style={[s.toggleSub, hcpAllowance === opt.value && s.toggleSubActive]}>
                  {opt.desc}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Field>

        {/* Name */}
        <Field label="GAME NAME" hint="e.g. Tuesday Swindle">
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Tuesday Swindle" placeholderTextColor={colors.textMuted} />
        </Field>

        {/* Course */}
        <Field label="COURSE (OPTIONAL)">
          <TouchableOpacity style={[s.input, s.pickerBtn]} onPress={() => { setCourseSearch(''); setShowPicker(true); }} activeOpacity={0.8}>
            <Text style={course ? s.pickerBtnText : s.pickerBtnPlaceholder}>{course || 'Select course…'}</Text>
            <Text style={s.pickerArrow}>›</Text>
          </TouchableOpacity>
        </Field>

        {/* Slope & course rating */}
        <Field label="SLOPE & RATING" hint="from scorecard — leave blank if unknown">
          <View style={s.feeRow}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.slotLabel}>SLOPE</Text>
              <TextInput
                style={s.input}
                value={slope}
                onChangeText={setSlope}
                keyboardType="number-pad"
                placeholder="113"
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.slotLabel}>COURSE RATING</Text>
              <TextInput
                style={s.input}
                value={cRating}
                onChangeText={setCRating}
                keyboardType="decimal-pad"
                placeholder="= par"
                placeholderTextColor={colors.textMuted}
              />
            </View>
          </View>
        </Field>

        {/* Entry fee */}
        <Field label="ENTRY FEE">
          <View style={s.feeRow}>
            {['£', '$', '€'].map(c => (
              <TouchableOpacity key={c} style={[s.currencyBtn, currency === c && s.currencyBtnActive]} onPress={() => setCurrency(c)}>
                <Text style={[s.currencyText, currency === c && s.currencyTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
            <TextInput style={[s.input, { flex: 1 }]} value={fee} onChangeText={setFee} keyboardType="decimal-pad" placeholder="5" placeholderTextColor={colors.textMuted} />
          </View>
        </Field>

        {/* Prize split */}
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

        {/* Recurring */}
        <Field label="RECURRING GAME">
          <TouchableOpacity
            style={[s.sidePotCard, isRecurring && s.sidePotCardActive]}
            onPress={() => setIsRecurring(v => !v)}
            activeOpacity={0.8}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.sidePotTitle, isRecurring && s.sidePotTitleActive]}>Weekly Roll-Up</Text>
              <Text style={s.sidePotDesc}>Players tap "I'm in" each week to enter — perfect for Saturday or Sunday morning swindles</Text>
            </View>
            <View style={[s.toggle, isRecurring && s.toggleOn]}>
              <View style={[s.toggleKnob, isRecurring && s.toggleKnobOn]} />
            </View>
          </TouchableOpacity>
          {isRecurring && (
            <View style={s.holePickRow}>
              {(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as const).map(day => (
                <TouchableOpacity
                  key={day}
                  style={[s.holePill, recurringDay === day && s.holePillActive]}
                  onPress={() => setRecurringDay(day)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.holePillNum, recurringDay === day && s.holePillNumActive]}>
                    {day.charAt(0).toUpperCase() + day.slice(1, 3)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </Field>

        {/* Two's competition */}
        <Field label="TWO'S COMPETITION">
          <TouchableOpacity
            style={[s.sidePotCard, twosEnabled && s.sidePotCardActive]}
            onPress={() => setTwosEnabled(v => !v)}
            activeOpacity={0.8}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.sidePotTitle, twosEnabled && s.sidePotTitleActive]}>Two's Pot</Text>
              <Text style={s.sidePotDesc}>Extra pot shared between anyone who scores 2 or lower on any hole</Text>
            </View>
            <View style={[s.toggle, twosEnabled && s.toggleOn]}>
              <View style={[s.toggleKnob, twosEnabled && s.toggleKnobOn]} />
            </View>
          </TouchableOpacity>
          {twosEnabled && (
            <View style={s.feeRow}>
              <Text style={s.sideFeeLabel}>Extra fee per player</Text>
              <TextInput
                style={[s.input, s.sideFeeInput]}
                value={twosFee}
                onChangeText={setTwosFee}
                keyboardType="decimal-pad"
                placeholder={`${currency}2`}
                placeholderTextColor={colors.textMuted}
              />
            </View>
          )}
        </Field>

        {/* Nearest the pin */}
        <Field label="NEAREST THE PIN">
          <TouchableOpacity
            style={[s.sidePotCard, ntpEnabled && s.sidePotCardActive]}
            onPress={() => setNtpEnabled(v => !v)}
            activeOpacity={0.8}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.sidePotTitle, ntpEnabled && s.sidePotTitleActive]}>NTP Pot</Text>
              <Text style={s.sidePotDesc}>Side pot for the closest tee shot to the pin on a par 3</Text>
            </View>
            <View style={[s.toggle, ntpEnabled && s.toggleOn]}>
              <View style={[s.toggleKnob, ntpEnabled && s.toggleKnobOn]} />
            </View>
          </TouchableOpacity>
          {ntpEnabled && (
            <>
              {par3s.length > 0 ? (
                <>
                  <Text style={s.holePickLabel}>PICK HOLE (PAR 3)</Text>
                  <View style={s.holePickRow}>
                    {par3s.map(h => (
                      <TouchableOpacity
                        key={h.hole_number}
                        style={[s.holePill, ntpHole === h.hole_number && s.holePillActive]}
                        onPress={() => setNtpHole(h.hole_number)}
                        activeOpacity={0.8}
                      >
                        <Text style={[s.holePillNum, ntpHole === h.hole_number && s.holePillNumActive]}>{h.hole_number}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              ) : (
                <Text style={s.holePickLabel}>{course ? 'No par 3s found for this course' : 'Select a course to pick the hole'}</Text>
              )}
              <View style={s.feeRow}>
                <Text style={s.sideFeeLabel}>Extra fee per player</Text>
                <TextInput
                  style={[s.input, s.sideFeeInput]}
                  value={ntpFee}
                  onChangeText={setNtpFee}
                  keyboardType="decimal-pad"
                  placeholder={`${currency}2`}
                  placeholderTextColor={colors.textMuted}
                />
              </View>
            </>
          )}
        </Field>

        {/* Longest drive */}
        <Field label="LONGEST DRIVE">
          <TouchableOpacity
            style={[s.sidePotCard, ldEnabled && s.sidePotCardActive]}
            onPress={() => setLdEnabled(v => !v)}
            activeOpacity={0.8}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.sidePotTitle, ldEnabled && s.sidePotTitleActive]}>Longest Drive Pot</Text>
              <Text style={s.sidePotDesc}>Side pot for the longest drive in the fairway on a par 5</Text>
            </View>
            <View style={[s.toggle, ldEnabled && s.toggleOn]}>
              <View style={[s.toggleKnob, ldEnabled && s.toggleKnobOn]} />
            </View>
          </TouchableOpacity>
          {ldEnabled && (
            <>
              {par5s.length > 0 ? (
                <>
                  <Text style={s.holePickLabel}>PICK HOLE (PAR 5)</Text>
                  <View style={s.holePickRow}>
                    {par5s.map(h => (
                      <TouchableOpacity
                        key={h.hole_number}
                        style={[s.holePill, ldHole === h.hole_number && s.holePillActive]}
                        onPress={() => setLdHole(h.hole_number)}
                        activeOpacity={0.8}
                      >
                        <Text style={[s.holePillNum, ldHole === h.hole_number && s.holePillNumActive]}>{h.hole_number}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              ) : (
                <Text style={s.holePickLabel}>{course ? 'No par 5s found for this course' : 'Select a course to pick the hole'}</Text>
              )}
              <View style={s.feeRow}>
                <Text style={s.sideFeeLabel}>Extra fee per player</Text>
                <TextInput
                  style={[s.input, s.sideFeeInput]}
                  value={ldFee}
                  onChangeText={setLdFee}
                  keyboardType="decimal-pad"
                  placeholder={`${currency}2`}
                  placeholderTextColor={colors.textMuted}
                />
              </View>
            </>
          )}
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
  container:          { flex: 1, backgroundColor: colors.bg, paddingTop: 56 },
  header:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, marginBottom: spacing.lg, gap: spacing.md },
  backBtn:            { paddingVertical: spacing.xs },
  backText:           { color: colors.gold, fontSize: fonts.md, fontWeight: '600' },
  title:              { fontSize: fonts.xl, fontWeight: '800', color: colors.white },
  form:               { padding: spacing.md, gap: spacing.lg, paddingBottom: 48 },
  field:              { gap: spacing.sm },
  fieldLabel:         { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5 },
  fieldHint:          { fontWeight: '400', letterSpacing: 0 },
  input:              { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, color: colors.white, fontSize: fonts.md },
  feeRow:             { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  currencyBtn:        { width: 40, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  currencyBtnActive:  { borderColor: colors.gold, backgroundColor: colors.goldDim },
  currencyText:       { color: colors.textMuted, fontSize: fonts.md, fontWeight: '700' },
  currencyTextActive: { color: colors.gold },
  splitOption:        { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  splitOptionActive:  { borderColor: colors.gold, backgroundColor: colors.goldDim },
  splitText:          { color: colors.textSecondary, fontWeight: '700', fontSize: fonts.sm },
  splitTextActive:    { color: colors.gold },
  splitPills:         { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  pill:               { backgroundColor: colors.cardAlt, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  pillActive:         { backgroundColor: 'rgba(212,175,55,0.2)' },
  pillText:           { fontSize: 10, fontWeight: '600', color: colors.textMuted },
  pillTextActive:     { color: colors.gold },
  createBtn:          { backgroundColor: colors.gold, borderRadius: radius.lg, paddingVertical: 16, alignItems: 'center', marginTop: spacing.md },
  createBtnDisabled:  { opacity: 0.6 },
  createBtnText:      { color: colors.bg, fontSize: fonts.lg, fontWeight: '800', letterSpacing: 0.5 },

  toggleRow:          { flexDirection: 'row', gap: spacing.sm },
  toggleBtn:          { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  toggleBtnActive:    { borderColor: colors.gold, backgroundColor: colors.goldDim },
  toggleText:         { fontSize: fonts.sm, fontWeight: '700', color: colors.textSecondary },
  toggleTextActive:   { color: colors.gold },
  toggleSub:          { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  toggleSubActive:    { color: 'rgba(212,175,55,0.7)' },

  sidePotCard:        { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.md },
  sidePotCardActive:  { borderColor: colors.gold, backgroundColor: colors.goldDim },
  sidePotTitle:       { fontSize: fonts.sm, fontWeight: '700', color: colors.textSecondary, marginBottom: 2 },
  sidePotTitleActive: { color: colors.gold },
  sidePotDesc:        { fontSize: 11, color: colors.textMuted, lineHeight: 15 },

  toggle:             { width: 44, height: 24, borderRadius: 12, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', paddingHorizontal: 2 },
  toggleOn:           { backgroundColor: colors.gold, borderColor: colors.gold },
  toggleKnob:         { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.textMuted },
  toggleKnobOn:       { backgroundColor: colors.bg, marginLeft: 20 },

  slotLabel:          { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1 },
  sideFeeLabel:       { fontSize: fonts.xs, color: colors.textMuted, fontWeight: '600', flex: 1 },
  sideFeeInput:       { width: 80 },

  holePickLabel:      { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1 },
  holePickRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  holePill:           { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  holePillActive:     { borderColor: colors.gold, backgroundColor: colors.goldDim },
  holePillNum:        { fontSize: fonts.md, fontWeight: '800', color: colors.textSecondary },
  holePillNumActive:  { color: colors.gold },

  pickerBtn:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerBtnText:      { color: colors.white, fontSize: fonts.md, flex: 1 },
  pickerBtnPlaceholder: { color: colors.textMuted, fontSize: fonts.md, flex: 1 },
  pickerArrow:        { color: colors.textMuted, fontSize: 20 },
  pickerOverlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  pickerSheet:        { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: 40, maxHeight: '75%' },
  pickerHeader:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerTitle:        { fontSize: fonts.lg, fontWeight: '800', color: colors.white },
  pickerClose:        { fontSize: fonts.lg, color: colors.textMuted, paddingHorizontal: spacing.sm },
  pickerSearch:       { margin: spacing.md, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.white, fontSize: fonts.md },
  pickerItem:         { paddingHorizontal: spacing.md, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center' },
  pickerItemActive:   { backgroundColor: colors.goldDim },
  pickerItemText:     { flex: 1, fontSize: fonts.md, color: colors.textSecondary },
  pickerItemTextActive: { color: colors.gold, fontWeight: '700' },
  pickerTick:         { color: colors.gold, fontWeight: '800' },
  pickerEmpty:        { color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.xl, fontSize: fonts.sm },
  pickerClear:        { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.xs },
  pickerClearText:    { color: colors.textMuted, fontSize: fonts.sm },
});
