import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Modal, Image, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { searchUKClubs, getUKClub, clubLocation, type UKClub } from '../../../src/lib/ukgolf';
import { scanScorecardFromCamera, scanScorecardFromLibrary, type ScannedCourse } from '../../../src/lib/scanScorecard';

const GOLD = '#D4AF37';
const GREEN = '#4ade80';
const RED = '#f87171';
const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

interface CourseRow { name: string; par: number; holeCount: number; incomplete: boolean; }
interface HoleConfig { par: 3 | 4 | 5; si: string; teeYardages: Record<string, number>; }

function defaultHoles(): HoleConfig[] {
  return Array.from({ length: 18 }, (_, i) => ({ par: 4 as 3 | 4 | 5, si: String(i + 1), teeYardages: {} }));
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
  const [searchQuery, setSearchQuery] = useState('');

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const loadCourses = useCallback(async () => {
    const { data } = await supabase.from('course_holes').select('course_name, par');
    if (data) {
      const map: Record<string, { totalPar: number; count: number; allPar4: boolean }> = {};
      for (const row of data as any[]) {
        if (!map[row.course_name]) map[row.course_name] = { totalPar: 0, count: 0, allPar4: true };
        map[row.course_name].totalPar += row.par;
        map[row.course_name].count++;
        if (row.par !== 4) map[row.course_name].allPar4 = false;
      }
      setCourses(
        Object.entries(map)
          .map(([name, v]) => ({ name, par: v.totalPar, holeCount: v.count, incomplete: v.allPar4 }))
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
      .select('hole_number, par, stroke_index, tee_yardages')
      .eq('course_name', name)
      .order('hole_number');

    const loaded = defaultHoles();
    if (data) {
      for (const row of data as any[]) {
        const idx = (row.hole_number as number) - 1;
        if (idx >= 0 && idx < 18) {
          loaded[idx] = { par: row.par as 3 | 4 | 5, si: String(row.stroke_index ?? idx + 1), teeYardages: row.tee_yardages ?? {} };
        }
      }
    }
    setEditingName(name);
    setCourseName(name);
    setHoles(loaded);
    setStep('name');
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

  function scannedToHoleConfig(holes: ScannedCourse['holes']): HoleConfig[] {
    return holes.map((h, i) => ({
      par:         ([3, 4, 5].includes(h.par ?? 0) ? h.par : 4) as 3 | 4 | 5,
      si:          h.si !== null ? String(h.si) : String(i + 1),
      teeYardages: h.tees ?? (h.yardage ? { white: h.yardage } : {}),
    }));
  }

  function buildCombinedHoles(a: HoleConfig[], b: HoleConfig[]): HoleConfig[] {
    const rank = (arr: HoleConfig[]) => {
      const sorted = arr.map((h, i) => ({ i, si: parseInt(h.si, 10) || i + 1 }))
        .sort((x, y) => x.si - y.si);
      const map = new Map<number, number>();
      sorted.forEach(({ i }, rank) => map.set(i, rank));
      return map;
    };
    const rankA = rank(a);
    const rankB = rank(b);
    return [
      ...a.map((h, i) => ({ par: h.par, si: String((rankA.get(i) ?? i) * 2 + 1), teeYardages: h.teeYardages })),
      ...b.map((h, i) => ({ par: h.par, si: String((rankB.get(i) ?? i) * 2 + 2), teeYardages: h.teeYardages })),
    ];
  }

  async function saveAllScanned(prefix: string, scannedCourses: ScannedCourse[]) {
    setScanning(true);
    try {
      type CourseToBeSaved = { name: string; holeConfigs: HoleConfig[] };
      const toSave: CourseToBeSaved[] = [];

      const named = scannedCourses.map(c => ({
        shortName: c.name ?? 'Course',
        fullName:  prefix ? `${prefix} - ${c.name ?? 'Course'}` : (c.name ?? 'Course'),
        configs:   scannedToHoleConfig(c.holes),
      }));

      for (const c of named) {
        toSave.push({ name: c.fullName, holeConfigs: c.configs });
      }

      for (let i = 0; i < named.length; i++) {
        for (let j = i + 1; j < named.length; j++) {
          const a = named[i];
          const b = named[j];
          const comboName = prefix
            ? `${prefix} - ${a.shortName} & ${b.shortName}`
            : `${a.shortName} & ${b.shortName}`;
          toSave.push({ name: comboName, holeConfigs: buildCombinedHoles(a.configs, b.configs) });
        }
      }

      for (const course of toSave) {
        await supabase.from('course_holes').delete().eq('course_name', course.name);
        const rows = course.holeConfigs.map((h, i) => ({
          course_name:  course.name,
          hole_number:  i + 1,
          par:          h.par,
          stroke_index: parseInt(h.si, 10) || i + 1,
          tee_yardages: h.teeYardages,
          yardage:      h.teeYardages.white ?? h.teeYardages.yellow ?? null,
        }));
        const { error } = await supabase.from('course_holes').insert(rows);
        if (error) throw error;
      }

      const individCount = named.length;
      const comboCount   = toSave.length - named.length;
      const list = toSave.map(c => `• ${c.name}`).join('\n');
      Alert.alert(
        'All Courses Saved',
        `Saved ${individCount} courses and ${comboCount} combination${comboCount !== 1 ? 's' : ''}:\n\n${list}\n\nYou can edit any course to adjust stroke indices.`,
      );
      setModal(false);
      await loadCourses();
    } catch (e: any) {
      Alert.alert('Error saving courses', e.message ?? 'Could not save.');
    } finally {
      setScanning(false);
    }
  }

  function applyScannedCourse(course: ScannedCourse) {
    const configs = scannedToHoleConfig(course.holes);
    const updated = defaultHoles();
    configs.forEach((h, i) => { if (i < 18) updated[i] = h; });
    setHoles(updated);
  }

  async function scanScorecard(source: 'camera' | 'library') {
    setScanning(true);
    try {
      const scannedCourses = source === 'camera'
        ? await scanScorecardFromCamera()
        : await scanScorecardFromLibrary();

      if (scannedCourses.length === 0) {
        Alert.alert('Scan Failed', 'No holes found — try a clearer photo.');
        return;
      }

      if (scannedCourses.length === 1) {
        applyScannedCourse(scannedCourses[0]);
        Alert.alert('Scorecard Scanned', `${scannedCourses[0].holes.length} holes read. Check the data below and tap Save.`);
        return;
      }

      const prefix = courseName.trim();
      const courseList = scannedCourses.map(c => c.name ?? 'Unnamed').join(', ');
      const comboCount = (scannedCourses.length * (scannedCourses.length - 1)) / 2;

      Alert.alert(
        `${scannedCourses.length} Courses Found`,
        `Detected: ${courseList}\n\nSave all ${scannedCourses.length} individual courses + ${comboCount} combinations in one go?`,
        [
          {
            text: `Save All (${scannedCourses.length + comboCount} courses)`,
            onPress: () => saveAllScanned(prefix, scannedCourses),
          },
          {
            text: 'Load one manually…',
            onPress: () => {
              const picks = scannedCourses.map(c => ({
                text: `${c.name ?? 'Unnamed'} (${c.holes.length}H)`,
                onPress: () => {
                  applyScannedCourse(c);
                  if (c.name && !prefix) setCourseName(c.name);
                },
              }));
              picks.push({ text: 'Cancel', onPress: () => {} } as any);
              Alert.alert('Pick a course to load', 'Select which 9-hole loop to load into the editor:', picks as any);
            },
          },
          { text: 'Cancel', style: 'cancel' as const },
        ],
      );
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
        course_name:  name,
        hole_number:  i + 1,
        par:          h.par,
        stroke_index: parseInt(h.si, 10) || i + 1,
        tee_yardages: h.teeYardages ?? {},
        yardage:      h.teeYardages?.white ?? h.teeYardages?.yellow ?? null,
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

  if (loading || societyLoading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={hit} style={s.headerLeft}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerTitle}>Courses</Text>
          <Text style={s.headerSub}>admin</Text>
        </View>
        <TouchableOpacity onPress={openNew} hitSlop={hit} style={s.headerRight}>
          <Text style={s.addBtn}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {/* Live search */}
      {courses.length > 3 && (
        <View style={s.searchWrap}>
          <TextInput
            style={s.courseSearchInput}
            placeholder="Search courses…"
            placeholderTextColor="#444"
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
            autoCorrect={false}
          />
        </View>
      )}

      <ScrollView contentContainerStyle={s.scroll}>
        {(() => {
          const filtered = searchQuery.trim()
            ? courses.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
            : courses;
          if (courses.length === 0) return (
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
          );
          if (filtered.length === 0) return (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>🔍</Text>
              <Text style={s.emptyTitle}>No matches</Text>
              <Text style={s.emptyHint}>No courses match "{searchQuery}"</Text>
            </View>
          );
          return (
            <>
              {filtered.map(c => (
                <TouchableOpacity
                  key={c.name}
                  style={s.courseRow}
                  onPress={() => openEdit(c.name)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.courseName}>{c.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={s.courseMeta}>{c.holeCount} holes · Par {c.par}</Text>
                      {c.incomplete && (
                        <Text style={s.incompleteTag}>⚠️ Card needed</Text>
                      )}
                    </View>
                  </View>
                  <Text style={s.arrow}>›</Text>
                </TouchableOpacity>
              ))}
              {!searchQuery && (
                <TouchableOpacity style={s.addRowBtn} onPress={openNew} activeOpacity={0.8}>
                  <Text style={s.addRowBtnText}>+ Add Another Course</Text>
                </TouchableOpacity>
              )}
            </>
          );
        })()}
      </ScrollView>

      <Modal
        visible={modal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModal(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.modal}>
          {/* Modal header */}
          <View style={s.modalHeader}>
            <TouchableOpacity
              onPress={() => step === 'holes' && !editingName ? setStep('name') : setModal(false)}
              hitSlop={hit}
              style={s.modalHeaderLeft}
            >
              <Text style={s.modalCancel}>
                {step === 'holes' && !editingName ? '‹ Back' : 'Cancel'}
              </Text>
            </TouchableOpacity>
            <View style={s.modalHeaderCenter}>
              <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
              <Text style={s.modalTitle} numberOfLines={1}>
                {editingName ?? (step === 'name' ? 'New Course' : courseName.trim() || 'New Course')}
              </Text>
              <Text style={s.headerSub}>courses</Text>
            </View>
            {step === 'holes' ? (
              <TouchableOpacity onPress={save} disabled={saving} hitSlop={hit} style={s.modalHeaderRight}>
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
                style={s.modalHeaderRight}
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
                  placeholderTextColor="#444"
                  autoCapitalize="words"
                />
              </View>
              <Text style={s.nameHint}>
                Type a name and tap Next, or search the UK Golf database to import the course name.
              </Text>

              <Text style={[s.sectionLabel, { marginTop: 24 }]}>SEARCH UK GOLF COURSES</Text>
              <View style={s.searchRow}>
                <TextInput
                  style={s.searchInput}
                  value={gbQuery}
                  onChangeText={v => { setGbQuery(v); setGbError(''); setGbResults([]); }}
                  placeholder="e.g. Princes, Wentworth…"
                  placeholderTextColor="#444"
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
                    ? <ActivityIndicator color="#000" size="small" />
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
                  ? <ActivityIndicator color={GOLD} size="small" />
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
                  <Text style={[s.parValue, { color: GOLD }]}>{totalPar}</Text>
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

              <Text style={[s.nineLabel, { marginTop: 16 }]}>BACK 9</Text>
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
        </KeyboardAvoidingView>
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
  container: { flex: 1, backgroundColor: '#000' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  headerLeft:   { flex: 1, alignItems: 'flex-start' },
  headerCenter: { flex: 2, alignItems: 'center' },
  headerRight:  { flex: 1, alignItems: 'flex-end' },
  headerLogo:   { width: 24, height: 24, marginBottom: 2 },
  back:         { fontSize: 14, color: GOLD, fontFamily: FFB },
  headerTitle:  { fontSize: 15, color: '#fff', fontFamily: FFB, letterSpacing: 0.5 },
  headerSub:    { fontSize: 9, color: '#555', fontFamily: FF },
  addBtn:       { fontSize: 14, color: GOLD, fontFamily: FFB },

  searchWrap:        { paddingHorizontal: 20, paddingBottom: 10 },
  courseSearchInput: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    color: '#fff', fontSize: 15, fontFamily: FFB,
  },
  scroll: { padding: 20, paddingBottom: 60 },

  courseRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingVertical: 14, paddingHorizontal: 16,
    marginBottom: 10,
  },
  courseName:    { fontSize: 15, fontFamily: FFB, color: '#fff' },
  courseMeta:    { fontSize: 12, fontFamily: FF, color: '#555', marginTop: 2 },
  incompleteTag: { fontSize: 12, color: '#f59e0b', fontFamily: FFB },
  arrow:         { fontSize: 22, color: '#555' },

  addRowBtn: {
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: GOLD, borderStyle: 'dashed',
    paddingVertical: 14, alignItems: 'center', marginTop: 8,
  },
  addRowBtnText: { fontSize: 14, fontFamily: FFB, color: GOLD },

  empty:      { alignItems: 'center', paddingTop: 80 },
  emptyIcon:  { fontSize: 52, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontFamily: FFB, color: '#fff', marginBottom: 8 },
  emptyHint: {
    fontSize: 14, fontFamily: FF, color: '#555',
    textAlign: 'center', marginBottom: 24,
    paddingHorizontal: 24, lineHeight: 20,
  },
  emptyBtn: {
    backgroundColor: GOLD, borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 24,
  },
  emptyBtnText: { fontSize: 15, fontFamily: FFB, color: '#000' },

  // Modal
  modal: { flex: 1, backgroundColor: '#000' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  modalHeaderLeft:   { flex: 1, alignItems: 'flex-start' },
  modalHeaderCenter: { flex: 2, alignItems: 'center' },
  modalHeaderRight:  { flex: 1, alignItems: 'flex-end' },
  modalCancel: { fontSize: 14, fontFamily: FF, color: '#555' },
  modalTitle:  { fontSize: 15, fontFamily: FFB, color: '#fff', letterSpacing: 0.5 },
  modalSave:   { fontSize: 14, fontFamily: FFB, color: GOLD },

  // Name step
  namePad:   { padding: 20 },
  sectionLabel: {
    fontSize: 10, fontFamily: FFB, color: '#555',
    letterSpacing: 2, marginBottom: 8,
  },
  nameCard:  {
    backgroundColor: '#111', borderRadius: 12,
    borderWidth: 1, borderColor: '#1c1c1c',
  },
  nameInput: {
    paddingHorizontal: 14, paddingVertical: 14,
    fontSize: 15, fontFamily: FFB, color: '#fff',
  },
  nameHint:  { fontSize: 12, fontFamily: FF, color: '#555', marginTop: 8, lineHeight: 18 },

  // Holes step
  holesPad: { padding: 20, paddingBottom: 80 },

  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(212,175,55,0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.3)',
    paddingVertical: 14,
    marginBottom: 10,
    minHeight: 44,
  },
  scanBtnText: { fontSize: 14, fontFamily: FFB, color: GOLD },
  scanHint: { fontSize: 12, fontFamily: FF, color: '#555', textAlign: 'center', marginBottom: 14 },

  parSummary: {
    flexDirection: 'row', backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c', padding: 14,
    marginBottom: 16, alignItems: 'center',
  },
  parItem:    { flex: 1, alignItems: 'center' },
  parLabel:   { fontSize: 10, fontFamily: FFB, color: '#555', letterSpacing: 1 },
  parValue:   { fontSize: 20, fontFamily: FFB, color: '#fff', marginTop: 2 },
  parDivider: { width: 1, height: 32, backgroundColor: '#1c1c1c' },

  holeHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, paddingHorizontal: 4 },
  holeHeaderText: { fontSize: 9, fontFamily: FFB, color: '#555', letterSpacing: 1.5 },

  nineLabel: {
    fontSize: 10, fontFamily: FFB, color: GOLD,
    letterSpacing: 2, marginBottom: 6,
  },

  holeRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#111', borderRadius: 10,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingVertical: 6, paddingHorizontal: 10,
    marginBottom: 4, gap: 8,
  },
  holeNum:   { width: 28, fontSize: 14, fontFamily: FFB, color: '#555', textAlign: 'right' },
  parChips:  { flex: 1, flexDirection: 'row', gap: 4 },
  parChip: {
    flex: 1, height: 30, borderRadius: 8,
    borderWidth: 1, borderColor: '#1c1c1c', backgroundColor: '#1a1a1a',
    alignItems: 'center', justifyContent: 'center',
  },
  parChipOn:     { backgroundColor: 'rgba(212,175,55,0.15)', borderColor: 'rgba(212,175,55,0.4)' },
  parChipText:   { fontSize: 14, fontFamily: FFB, color: '#555' },
  parChipTextOn: { color: GOLD },

  siInput: {
    width: 40, height: 30, borderRadius: 8,
    borderWidth: 1, borderColor: '#1c1c1c', backgroundColor: '#1a1a1a',
    color: '#fff', fontSize: 14, fontFamily: FFB,
    textAlign: 'center',
  },

  deleteBtn: {
    marginTop: 24,
    backgroundColor: 'rgba(248,113,113,0.08)',
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)',
    paddingVertical: 14, alignItems: 'center',
  },
  deleteBtnText: { fontSize: 14, fontFamily: FFB, color: RED },

  // UK Golf search
  searchRow: { flexDirection: 'row', gap: 10 },
  searchInput: {
    flex: 1, backgroundColor: '#111', borderRadius: 12,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, fontFamily: FFB, color: '#fff',
  },
  searchBtn: {
    backgroundColor: GOLD, borderRadius: 12,
    paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center',
    minWidth: 76,
  },
  searchBtnText: { fontSize: 14, fontFamily: FFB, color: '#000' },
  gbError: { fontSize: 12, fontFamily: FF, color: RED, marginTop: 8 },
  resultsList: {
    marginTop: 10, backgroundColor: '#111',
    borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c',
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  resultName:   { fontSize: 14, fontFamily: FFB, color: '#fff' },
  resultMeta:   { fontSize: 12, fontFamily: FF, color: '#555', marginTop: 2 },
  resultImport: { fontSize: 14, fontFamily: FFB, color: GOLD, marginLeft: 10 },
});
