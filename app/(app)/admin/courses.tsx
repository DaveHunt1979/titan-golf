import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { searchUKClubs, getUKClub, clubLocation, type UKClub } from '../../../src/lib/ukgolf';
import { scanScorecardFromCamera, scanScorecardFromLibrary } from '../../../src/lib/scanScorecard';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';

interface CourseRow { name: string; par: number; holeCount: number; }
interface HoleConfig { par: 3 | 4 | 5; si: string; }

function defaultHoles(): HoleConfig[] {
  return Array.from({ length: 18 }, (_, i) => ({ par: 4 as 3 | 4 | 5, si: String(i + 1) }));
}

export default function CoursesScreen() {
  const router = useRouter();
  const { societyId, loading: societyLoading } = useAdminSociety();
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]     = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [step, setStep]       = useState<'name' | 'holes'>('name');
  const [courseName, setCourseName] = useState('');
  const [holes, setHoles]     = useState<HoleConfig[]>(defaultHoles());
  const [saving, setSaving]   = useState(false);
  const [gbQuery, setGbQuery]         = useState('');
  const [gbResults, setGbResults]     = useState<UKClub[]>([]);
  const [gbSearching, setGbSearching] = useState(false);
  const [gbError, setGbError]         = useState('');
  const [pendingLat, setPendingLat]   = useState<number | null>(null);
  const [pendingLng, setPendingLng]   = useState<number | null>(null);
  const [scanning, setScanning]       = useState(false);

  const loadCourses = useCallback(async () => {
    const { data } = await supabase.from('course_holes').select('course_name, par');
    if (data) {
      const map: Record<string, { totalPar: number; count: number }> = {};
      for (const row of data as any[]) {
        if (!map[row.course_name]) map[row.course_name] = { totalPar: 0, count: 0 };
        map[row.course_name].totalPar += row.par;
        map[row.course_name].count++;
      }
      setCourses(
        Object.entries(map)
          .map(([name, v]) => ({ name, par: v.totalPar, holeCount: v.count }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!societyLoading) loadCourses();
  }, [societyLoading, loadCourses]);

  async function openEdit(name: string) {
    const { data } = await supabase
      .from('course_holes')
      .select('hole_number, par, stroke_index')
      .eq('course_name', name)
      .order('hole_number');

    const loaded = defaultHoles();
    if (data) {
      for (const row of data as any[]) {
        const idx = (row.hole_number as number) - 1;
        if (idx >= 0 && idx < 18) {
          loaded[idx] = { par: row.par as 3 | 4 | 5, si: String(row.stroke_index ?? idx + 1) };
        }
      }
    }
    setEditingName(name);
    setCourseName(name);
    setHoles(loaded);
    setStep('holes');
    setModal(true);
  }

  function openNew() {
    setEditingName(null);
    setCourseName('');
    setHoles(defaultHoles());
    setStep('name');
    setModal(true);
  }

  async function runSearch() {
    if (!gbQuery.trim()) return;
    setGbSearching(true);
    setGbError('');
    setGbResults([]);
    try {
      const results = await searchUKClubs(gbQuery.trim());
      setGbResults(results);
      if (results.length === 0) setGbError('No courses found — try a different name.');
    } catch (e: any) {
      setGbError(e.message ?? 'Search failed');
    } finally {
      setGbSearching(false);
    }
  }

  async function importFromUK(club: UKClub) {
    setGbSearching(true);
    try {
      const full = await getUKClub(club.id);
      setCourseName(full?.name ?? club.name);
      setPendingLat(full?.lat ?? null);
      setPendingLng(full?.lng ?? null);
    } catch {
      setCourseName(club.name);
      setPendingLat(null);
      setPendingLng(null);
    } finally {
      setGbSearching(false);
    }
    setHoles(defaultHoles());
    setGbResults([]);
    setGbQuery('');
    setStep('holes');
  }

  async function scanScorecard(source: 'camera' | 'library') {
    setScanning(true);
    try {
      const scannedHoles = source === 'camera'
        ? await scanScorecardFromCamera()
        : await scanScorecardFromLibrary();

      const updated = defaultHoles();
      for (const h of scannedHoles) {
        const idx = h.hole - 1;
        if (idx >= 0 && idx < 18) {
          updated[idx] = {
            par: ([3, 4, 5].includes(h.par ?? 0) ? h.par : 4) as 3 | 4 | 5,
            si:  h.si !== null ? String(h.si) : String(idx + 1),
          };
        }
      }
      setHoles(updated);
      Alert.alert('Scorecard Scanned', `${scannedHoles.length} holes read. Check the data below and tap Save.`);
    } catch (e: any) {
      if (e.message !== 'Cancelled') Alert.alert('Scan Failed', e.message ?? 'Could not read scorecard.');
    } finally {
      setScanning(false);
    }
  }

  function promptScanSource() {
    Alert.alert('Scan Scorecard', 'How would you like to scan?', [
      { text: 'Take Photo', onPress: () => scanScorecard('camera') },
      { text: 'Choose from Library', onPress: () => scanScorecard('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function setPar(idx: number, par: 3 | 4 | 5) {
    setHoles(prev => prev.map((h, i) => i === idx ? { ...h, par } : h));
  }

  function setSI(idx: number, val: string) {
    setHoles(prev => prev.map((h, i) => i === idx ? { ...h, si: val } : h));
  }

  async function save() {
    const name = courseName.trim();
    if (!name) { Alert.alert('Required', 'Please enter a course name.'); return; }
    setSaving(true);
    try {
      if (editingName) {
        await supabase.from('course_holes').delete().eq('course_name', editingName);
      }
      const rows = holes.map((h, i) => ({
        course_name: name,
        hole_number: i + 1,
        par: h.par,
        stroke_index: parseInt(h.si, 10) || i + 1,
      }));
      const { error } = await supabase.from('course_holes').insert(rows);
      if (error) throw error;
      if (pendingLat !== null && pendingLng !== null) {
        await supabase.from('courses').upsert({ name, lat: pendingLat, lng: pendingLng });
      }
      setPendingLat(null);
      setPendingLng(null);
      setModal(false);
      await loadCourses();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save course.');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!editingName) return;
    Alert.alert(
      `Delete "${editingName}"?`,
      'This removes all hole data for this course.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setSaving(true);
            const { error } = await supabase.from('course_holes').delete().eq('course_name', editingName);
            if (!error) await supabase.from('courses').delete().eq('name', editingName);
            setSaving(false);
            if (error) { Alert.alert('Error', error.message); return; }
            setModal(false);
            await loadCourses();
          },
        },
      ],
    );
  }

  const front9Par = holes.slice(0, 9).reduce((s, h) => s + h.par, 0);
  const back9Par  = holes.slice(9).reduce((s, h) => s + h.par, 0);
  const totalPar  = front9Par + back9Par;

  if (loading || societyLoading) {
    return (
      <View style={[s.container, s.centered]}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={hit}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Courses</Text>
        <TouchableOpacity onPress={openNew} hitSlop={hit}>
          <Text style={s.addBtn}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {courses.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>⛳</Text>
            <Text style={s.emptyTitle}>No courses yet</Text>
            <Text style={s.emptyHint}>
              Add your courses so players can select them when starting a round.
            </Text>
            <TouchableOpacity style={s.emptyBtn} onPress={openNew} activeOpacity={0.8}>
              <Text style={s.emptyBtnText}>Add First Course</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {courses.map(c => (
              <TouchableOpacity
                key={c.name}
                style={s.courseRow}
                onPress={() => openEdit(c.name)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.courseName}>{c.name}</Text>
                  <Text style={s.courseMeta}>{c.holeCount} holes · Par {c.par}</Text>
                </View>
                <Text style={s.arrow}>›</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={s.addRowBtn} onPress={openNew} activeOpacity={0.8}>
              <Text style={s.addRowBtnText}>+ Add Another Course</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <Modal
        visible={modal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModal(false)}
      >
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <TouchableOpacity
              onPress={() => step === 'holes' && !editingName ? setStep('name') : setModal(false)}
              hitSlop={hit}
            >
              <Text style={s.modalCancel}>
                {step === 'holes' && !editingName ? '‹ Back' : 'Cancel'}
              </Text>
            </TouchableOpacity>
            <Text style={s.modalTitle} numberOfLines={1}>
              {editingName ?? (step === 'name' ? 'New Course' : courseName.trim() || 'New Course')}
            </Text>
            {step === 'holes' ? (
              <TouchableOpacity onPress={save} disabled={saving} hitSlop={hit}>
                <Text style={[s.modalSave, saving && { opacity: 0.4 }]}>
                  {saving ? 'Saving…' : 'Save'}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => {
                  if (!courseName.trim()) { Alert.alert('Required', 'Enter a course name.'); return; }
                  setStep('holes');
                }}
                hitSlop={hit}
              >
                <Text style={s.modalSave}>Next →</Text>
              </TouchableOpacity>
            )}
          </View>

          {step === 'name' && (
            <ScrollView contentContainerStyle={s.namePad} keyboardShouldPersistTaps="handled">
              <Text style={s.sectionLabel}>COURSE NAME</Text>
              <View style={s.nameCard}>
                <TextInput
                  style={s.nameInput}
                  value={courseName}
                  onChangeText={setCourseName}
                  placeholder="e.g. West Cliffs"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="words"
                />
              </View>
              <Text style={s.nameHint}>
                Type a name and tap Next, or search the UK Golf database to import the course name.
              </Text>

              <Text style={[s.sectionLabel, { marginTop: spacing.xl }]}>SEARCH UK GOLF COURSES</Text>
              <View style={s.searchRow}>
                <TextInput
                  style={s.searchInput}
                  value={gbQuery}
                  onChangeText={v => { setGbQuery(v); setGbError(''); setGbResults([]); }}
                  placeholder="e.g. Princes, Wentworth…"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="words"
                  returnKeyType="search"
                  onSubmitEditing={runSearch}
                />
                <TouchableOpacity
                  style={[s.searchBtn, gbSearching && { opacity: 0.5 }]}
                  onPress={runSearch}
                  disabled={gbSearching}
                  activeOpacity={0.8}
                >
                  {gbSearching
                    ? <ActivityIndicator color={colors.bg} size="small" />
                    : <Text style={s.searchBtnText}>Search</Text>
                  }
                </TouchableOpacity>
              </View>

              {!!gbError && <Text style={s.gbError}>{gbError}</Text>}

              {gbResults.length > 0 && (
                <View style={s.resultsList}>
                  {gbResults.map(c => (
                    <TouchableOpacity
                      key={c.id}
                      style={s.resultRow}
                      onPress={() => importFromUK(c)}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.resultName}>{c.name}</Text>
                        <Text style={s.resultMeta}>{clubLocation(c)}</Text>
                      </View>
                      <Text style={s.resultImport}>Import →</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </ScrollView>
          )}

          {step === 'holes' && (
            <ScrollView contentContainerStyle={s.holesPad} keyboardShouldPersistTaps="handled">

              {/* Scan scorecard */}
              <TouchableOpacity
                style={[s.scanBtn, scanning && { opacity: 0.5 }]}
                onPress={promptScanSource}
                disabled={scanning}
                activeOpacity={0.8}
              >
                {scanning
                  ? <ActivityIndicator color={colors.gold} size="small" />
                  : <Text style={s.scanBtnText}>📷  Scan Scorecard</Text>
                }
              </TouchableOpacity>
              {scanning && <Text style={s.scanHint}>Reading scorecard with AI — this takes a few seconds…</Text>}

              {/* Par summary */}
              <View style={s.parSummary}>
                <View style={s.parItem}>
                  <Text style={s.parLabel}>OUT</Text>
                  <Text style={s.parValue}>{front9Par}</Text>
                </View>
                <View style={s.parDivider} />
                <View style={s.parItem}>
                  <Text style={s.parLabel}>IN</Text>
                  <Text style={s.parValue}>{back9Par}</Text>
                </View>
                <View style={s.parDivider} />
                <View style={s.parItem}>
                  <Text style={s.parLabel}>TOTAL</Text>
                  <Text style={[s.parValue, { color: colors.gold }]}>{totalPar}</Text>
                </View>
              </View>

              {/* Column header */}
              <View style={s.holeHeader}>
                <Text style={[s.holeHeaderText, { width: 32 }]}>HOLE</Text>
                <Text style={[s.holeHeaderText, { flex: 1, textAlign: 'center' }]}>PAR</Text>
                <Text style={[s.holeHeaderText, { width: 44, textAlign: 'right' }]}>SI</Text>
              </View>

              <Text style={s.nineLabel}>FRONT 9</Text>
              {holes.slice(0, 9).map((h, i) => (
                <HoleRow key={i} index={i} hole={h} onPar={setPar} onSI={setSI} />
              ))}

              <Text style={[s.nineLabel, { marginTop: spacing.md }]}>BACK 9</Text>
              {holes.slice(9).map((h, i) => (
                <HoleRow key={i + 9} index={i + 9} hole={h} onPar={setPar} onSI={setSI} />
              ))}

              {editingName && (
                <TouchableOpacity
                  style={s.deleteBtn}
                  onPress={confirmDelete}
                  disabled={saving}
                  activeOpacity={0.8}
                >
                  <Text style={s.deleteBtnText}>Delete Course</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

function HoleRow({ index, hole, onPar, onSI }: {
  index: number;
  hole: HoleConfig;
  onPar: (i: number, par: 3 | 4 | 5) => void;
  onSI:  (i: number, val: string) => void;
}) {
  return (
    <View style={s.holeRow}>
      <Text style={s.holeNum}>{index + 1}</Text>
      <View style={s.parChips}>
        {([3, 4, 5] as const).map(p => (
          <TouchableOpacity
            key={p}
            style={[s.parChip, hole.par === p && s.parChipOn]}
            onPress={() => onPar(index, p)}
            activeOpacity={0.7}
          >
            <Text style={[s.parChipText, hole.par === p && s.parChipTextOn]}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={s.siInput}
        value={hole.si}
        onChangeText={v => onSI(index, v)}
        keyboardType="number-pad"
        maxLength={2}
      />
    </View>
  );
}

const hit = { top: 12, bottom: 12, left: 12, right: 12 };

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered:  { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back:        { fontSize: fonts.sm, color: colors.gold, fontWeight: '600' },
  headerTitle: { fontSize: fonts.md, fontWeight: '800', color: colors.white, letterSpacing: 0.5 },
  addBtn:      { fontSize: fonts.sm, fontWeight: '700', color: colors.gold },
  scroll:      { padding: spacing.lg, paddingBottom: 60 },

  courseRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  courseName: { fontSize: fonts.md, fontWeight: '700', color: colors.white },
  courseMeta: { fontSize: fonts.xs, color: colors.textMuted, marginTop: 2 },
  arrow:      { fontSize: 22, color: colors.textMuted },

  addRowBtn: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.goldBorder, borderStyle: 'dashed',
    paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm,
  },
  addRowBtnText: { fontSize: fonts.sm, fontWeight: '700', color: colors.gold },

  empty:      { alignItems: 'center', paddingTop: 80 },
  emptyIcon:  { fontSize: 52, marginBottom: spacing.md },
  emptyTitle: { fontSize: fonts.xl, fontWeight: '800', color: colors.white, marginBottom: spacing.xs },
  emptyHint: {
    fontSize: fonts.sm, color: colors.textMuted,
    textAlign: 'center', marginBottom: spacing.xl,
    paddingHorizontal: spacing.xl, lineHeight: 20,
  },
  emptyBtn: {
    backgroundColor: colors.gold, borderRadius: radius.md,
    paddingVertical: spacing.md, paddingHorizontal: spacing.xl,
  },
  emptyBtnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg },

  // Modal
  modal: { flex: 1, backgroundColor: colors.bg },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modalCancel: { fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600', minWidth: 60 },
  modalTitle:  { fontSize: fonts.md, fontWeight: '800', color: colors.white, flex: 1, textAlign: 'center', marginHorizontal: spacing.sm },
  modalSave:   { fontSize: fonts.sm, color: colors.gold, fontWeight: '700', minWidth: 60, textAlign: 'right' },

  // Name step
  namePad:   { padding: spacing.lg },
  sectionLabel: {
    fontSize: fonts.xs, fontWeight: '800', color: colors.textMuted,
    letterSpacing: 2, marginBottom: spacing.sm,
  },
  nameCard:  { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  nameInput: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: fonts.md, color: colors.white },
  nameHint:  { fontSize: fonts.xs, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 18 },

  // Holes step
  holesPad: { padding: spacing.lg, paddingBottom: 80 },

  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldDim,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 44,
  },
  scanBtnText: { fontSize: fonts.sm, fontWeight: '800', color: colors.gold },
  scanHint: { fontSize: fonts.xs, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.md },

  parSummary: {
    flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md,
    marginBottom: spacing.md, alignItems: 'center',
  },
  parItem:    { flex: 1, alignItems: 'center' },
  parLabel:   { fontSize: fonts.xs, color: colors.textMuted, fontWeight: '700', letterSpacing: 1 },
  parValue:   { fontSize: fonts.xl, fontWeight: '800', color: colors.white, marginTop: 2 },
  parDivider: { width: 1, height: 32, backgroundColor: colors.border },

  holeHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs, paddingHorizontal: 4 },
  holeHeaderText: { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5 },

  nineLabel: {
    fontSize: fonts.xs, fontWeight: '800', color: colors.gold,
    letterSpacing: 2, marginBottom: spacing.xs,
  },

  holeRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.xs + 2, paddingHorizontal: spacing.sm,
    marginBottom: 4, gap: spacing.sm,
  },
  holeNum:   { width: 28, fontSize: fonts.sm, fontWeight: '700', color: colors.textMuted, textAlign: 'right' },
  parChips:  { flex: 1, flexDirection: 'row', gap: 4 },
  parChip: {
    flex: 1, height: 30, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  parChipOn:     { backgroundColor: colors.goldDim, borderColor: colors.goldBorder },
  parChipText:   { fontSize: fonts.sm, fontWeight: '700', color: colors.textMuted },
  parChipTextOn: { color: colors.gold },

  siInput: {
    width: 40, height: 30, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardAlt,
    color: colors.white, fontSize: fonts.sm, fontWeight: '700',
    textAlign: 'center',
  },

  deleteBtn: {
    marginTop: spacing.xl,
    backgroundColor: 'rgba(248,113,113,0.08)',
    borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)',
    paddingVertical: spacing.md, alignItems: 'center',
  },
  deleteBtnText: { fontSize: fonts.sm, fontWeight: '800', color: colors.red },

  // Golfbert search
  searchRow: { flexDirection: 'row', gap: spacing.sm },
  searchInput: {
    flex: 1, backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: fonts.md, color: colors.white,
  },
  searchBtn: {
    backgroundColor: colors.gold, borderRadius: radius.md,
    paddingHorizontal: spacing.md, justifyContent: 'center', alignItems: 'center',
    minWidth: 76,
  },
  searchBtnText: { fontSize: fonts.sm, fontWeight: '800', color: colors.bg },
  gbError: { fontSize: fonts.xs, color: colors.red, marginTop: spacing.sm },
  resultsList: {
    marginTop: spacing.sm, backgroundColor: colors.card,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  resultName:   { fontSize: fonts.sm, fontWeight: '700', color: colors.white },
  resultMeta:   { fontSize: fonts.xs, color: colors.textMuted, marginTop: 2 },
  resultImport: { fontSize: fonts.sm, fontWeight: '700', color: colors.gold, marginLeft: spacing.sm },
});
