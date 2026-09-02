import { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Platform, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { titanLogo } from '../../../src/lib/assets';
import { goBack } from '../../../src/lib/navigation';
import { ukDateToDate, dateToUk, ukDateToIso } from '../../../src/lib/dateHelpers';

const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';

interface DivisionRow { name: string; targetSize: string; }
interface MajorRow { name: string; startDate: string; endDate: string; }

const DEFAULT_DIVISIONS: DivisionRow[] = [
  { name: 'Premier League', targetSize: '20' },
  { name: 'Championship',   targetSize: '20' },
  { name: 'League One',     targetSize: '20' },
  { name: 'League Two',     targetSize: '20' },
];

// Spec §11.4 recommended branding.
const DEFAULT_MAJORS: MajorRow[] = [
  { name: 'Titan Masters',             startDate: '', endDate: '' },
  { name: 'Titan Championship',        startDate: '', endDate: '' },
  { name: 'Titan Open',                startDate: '', endDate: '' },
  { name: 'Titan Season Championship', startDate: '', endDate: '' },
];

function genPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export default function SeasonCreateScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { localLogo, logoUrl } = useSocietyTheme();
  const { societyId } = useAdminSociety();
  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const currentYear = new Date().getFullYear();
  const [name, setName]               = useState(`Titan Season ${currentYear}`);
  const [seasonYear, setSeasonYear]   = useState(currentYear);
  const [startDate, setStartDate]     = useState(`01-01-${currentYear}`);
  const [endDate, setEndDate]         = useState(`31-12-${currentYear}`);
  const [regCloseDate, setRegCloseDate] = useState(`01-01-${currentYear}`);
  const [showPicker, setShowPicker]   = useState<'start' | 'end' | 'reg' | null>(null);

  const [divisions, setDivisions]         = useState<DivisionRow[]>(DEFAULT_DIVISIONS);
  const [promotionPlaces, setPromotionPlaces] = useState(3);
  const [relegationPlaces, setRelegationPlaces] = useState(3);
  const [minQualifyingRounds, setMinQualifyingRounds] = useState(20);
  const [handicapAllowance, setHandicapAllowance]     = useState(100);
  const [majors, setMajors]           = useState<MajorRow[]>(DEFAULT_MAJORS);
  const [majorPicker, setMajorPicker] = useState<{ index: number; field: 'start' | 'end' } | null>(null);

  const [saving, setSaving] = useState(false);

  if (!fontsLoaded) return <View style={[s.container, { backgroundColor: dc.bg }]} />;

  function updateDivision(i: number, field: keyof DivisionRow, value: string) {
    setDivisions(prev => prev.map((d, idx) => idx === i ? { ...d, [field]: value } : d));
  }
  function addDivision() {
    setDivisions(prev => [...prev, { name: `Division ${prev.length + 1}`, targetSize: '20' }]);
  }
  function removeDivision(i: number) {
    if (divisions.length <= 1) return;
    setDivisions(prev => prev.filter((_, idx) => idx !== i));
  }

  function updateMajor(i: number, field: keyof MajorRow, value: string) {
    setMajors(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: value } : m));
  }

  const canCreate = name.trim().length > 0
    && divisions.length > 0
    && divisions.every(d => d.name.trim().length > 0 && Number(d.targetSize) > 0)
    && majors.every(m => m.name.trim().length > 0 && m.startDate && m.endDate);

  async function createSeason() {
    if (!societyId || !canCreate) return;
    setSaving(true);
    try {
      const { data: season, error: seasonErr } = await supabase
        .from('seasons')
        .insert({
          society_id: societyId,
          name: name.trim(),
          season_year: seasonYear,
          registration_close_at: new Date(ukDateToIso(regCloseDate)).toISOString(),
          start_at: new Date(ukDateToIso(startDate)).toISOString(),
          end_at: new Date(ukDateToIso(endDate)).toISOString(),
          minimum_qualifying_rounds: minQualifyingRounds,
          counting_round_limit: minQualifyingRounds,
          handicap_allowance_percent: handicapAllowance,
          join_pin: genPin(),
          status: 'draft',
        } as any)
        .select('id')
        .single();
      if (seasonErr || !season) throw seasonErr ?? new Error('Season insert failed');

      const divisionRows = divisions.map((d, i) => ({
        season_id: (season as any).id,
        name: d.name.trim(),
        display_order: i,
        target_player_count: Number(d.targetSize),
        // Spec §6.1 — top division: no promotion; bottom division: no relegation; middle: both.
        promotion_places: i === 0 ? 0 : promotionPlaces,
        relegation_places: i === divisions.length - 1 ? 0 : relegationPlaces,
      }));
      const { error: divErr } = await supabase.from('season_divisions').insert(divisionRows as any);
      if (divErr) throw divErr;

      const majorRows = majors.map((m, i) => ({
        season_id: (season as any).id,
        sequence: i + 1,
        name: m.name.trim(),
        start_at: new Date(ukDateToIso(m.startDate)).toISOString(),
        end_at: new Date(ukDateToIso(m.endDate)).toISOString(),
        multiplier: 1.5,
        status: 'scheduled',
      }));
      const { error: majorErr } = await supabase.from('season_majors').insert(majorRows as any);
      if (majorErr) throw majorErr;

      Alert.alert('Season Created', `${name.trim()} is ready as a draft.`, [
        { text: 'Done', onPress: () => router.replace('/(app)/admin/season-manage' as any) },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not create Season');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />
      <View style={[s.header, { borderBottomColor: dc.border }]}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/admin/hub-season')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={[s.back, { color: dc.gold }]}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)} style={s.headerLogo} resizeMode="contain" />
          <Text style={[s.headerSub, { color: GREEN }]}>CREATE SEASON</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={s.sectionLabel}>BASICS</Text>
        <Text style={s.fieldLabel}>SEASON NAME</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder="e.g. Titan Season 2027" placeholderTextColor="#444" />

        <Text style={s.fieldLabel}>SEASON YEAR</Text>
        <View style={s.stepper}>
          <TouchableOpacity style={s.stepperBtn} onPress={() => setSeasonYear(y => y - 1)} activeOpacity={0.7}>
            <Text style={s.stepperBtnText}>–</Text>
          </TouchableOpacity>
          <Text style={s.stepperValue}>{seasonYear}</Text>
          <TouchableOpacity style={s.stepperBtn} onPress={() => setSeasonYear(y => y + 1)} activeOpacity={0.7}>
            <Text style={s.stepperBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.fieldLabel}>REGISTRATION CLOSES</Text>
        <TouchableOpacity style={s.input} onPress={() => setShowPicker('reg')} activeOpacity={0.8}>
          <Text style={s.inputText}>{regCloseDate}</Text>
        </TouchableOpacity>

        <Text style={s.fieldLabel}>SEASON START</Text>
        <TouchableOpacity style={s.input} onPress={() => setShowPicker('start')} activeOpacity={0.8}>
          <Text style={s.inputText}>{startDate}</Text>
        </TouchableOpacity>

        <Text style={s.fieldLabel}>SEASON END</Text>
        <TouchableOpacity style={s.input} onPress={() => setShowPicker('end')} activeOpacity={0.8}>
          <Text style={s.inputText}>{endDate}</Text>
        </TouchableOpacity>

        {showPicker && (
          <DateTimePicker
            value={ukDateToDate(showPicker === 'start' ? startDate : showPicker === 'end' ? endDate : regCloseDate)}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={(_event, selected) => {
              const target = showPicker;
              setShowPicker(null);
              if (!selected) return;
              const uk = dateToUk(selected);
              if (target === 'start') setStartDate(uk);
              else if (target === 'end') setEndDate(uk);
              else setRegCloseDate(uk);
            }}
          />
        )}

        <Text style={[s.sectionLabel, { marginTop: 28 }]}>DIVISIONS</Text>
        {divisions.map((d, i) => (
          <View key={i} style={s.rowCard}>
            <TextInput
              style={[s.input, { flex: 1.6 }]}
              value={d.name}
              onChangeText={v => updateDivision(i, 'name', v)}
              placeholder="Division name"
              placeholderTextColor="#444"
            />
            <TextInput
              style={[s.input, { flex: 0.7, textAlign: 'center' }]}
              value={d.targetSize}
              onChangeText={v => updateDivision(i, 'targetSize', v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="20"
              placeholderTextColor="#444"
            />
            <TouchableOpacity onPress={() => removeDivision(i)} disabled={divisions.length <= 1} style={s.removeBtn}>
              <Ionicons name="close" size={16} color={divisions.length <= 1 ? '#333' : RED} />
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity style={s.addBtn} onPress={addDivision} activeOpacity={0.7}>
          <Text style={s.addBtnText}>+ Add Division</Text>
        </TouchableOpacity>
        <Text style={s.hint}>Top division gets no promotion; bottom division gets no relegation — applied automatically.</Text>

        <Text style={s.fieldLabel}>PROMOTION / RELEGATION PLACES</Text>
        <View style={{ flexDirection: 'row', gap: 20 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.miniLabel}>Promoted</Text>
            <View style={s.stepper}>
              <TouchableOpacity style={s.stepperBtn} onPress={() => setPromotionPlaces(v => Math.max(0, v - 1))} activeOpacity={0.7}>
                <Text style={s.stepperBtnText}>–</Text>
              </TouchableOpacity>
              <Text style={s.stepperValue}>{promotionPlaces}</Text>
              <TouchableOpacity style={s.stepperBtn} onPress={() => setPromotionPlaces(v => v + 1)} activeOpacity={0.7}>
                <Text style={s.stepperBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.miniLabel}>Relegated</Text>
            <View style={s.stepper}>
              <TouchableOpacity style={s.stepperBtn} onPress={() => setRelegationPlaces(v => Math.max(0, v - 1))} activeOpacity={0.7}>
                <Text style={s.stepperBtnText}>–</Text>
              </TouchableOpacity>
              <Text style={s.stepperValue}>{relegationPlaces}</Text>
              <TouchableOpacity style={s.stepperBtn} onPress={() => setRelegationPlaces(v => v + 1)} activeOpacity={0.7}>
                <Text style={s.stepperBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <Text style={[s.sectionLabel, { marginTop: 28 }]}>QUALIFICATION</Text>
        <Text style={s.fieldLabel}>MINIMUM / BEST-X QUALIFYING ROUNDS</Text>
        <View style={s.stepper}>
          <TouchableOpacity style={s.stepperBtn} onPress={() => setMinQualifyingRounds(v => Math.max(1, v - 1))} activeOpacity={0.7}>
            <Text style={s.stepperBtnText}>–</Text>
          </TouchableOpacity>
          <Text style={s.stepperValue}>{minQualifyingRounds} rounds</Text>
          <TouchableOpacity style={s.stepperBtn} onPress={() => setMinQualifyingRounds(v => v + 1)} activeOpacity={0.7}>
            <Text style={s.stepperBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.fieldLabel}>HANDICAP ALLOWANCE</Text>
        <View style={s.stepper}>
          <TouchableOpacity style={s.stepperBtn} onPress={() => setHandicapAllowance(v => Math.max(0, v - 5))} activeOpacity={0.7}>
            <Text style={s.stepperBtnText}>–</Text>
          </TouchableOpacity>
          <Text style={s.stepperValue}>{handicapAllowance}%</Text>
          <TouchableOpacity style={s.stepperBtn} onPress={() => setHandicapAllowance(v => Math.min(150, v + 5))} activeOpacity={0.7}>
            <Text style={s.stepperBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        <Text style={[s.sectionLabel, { marginTop: 28 }]}>THE 4 MAJORS</Text>
        {majors.map((m, i) => (
          <View key={i} style={s.majorCard}>
            <Text style={s.majorNum}>MAJOR {i + 1}</Text>
            <TextInput
              style={s.input}
              value={m.name}
              onChangeText={v => updateMajor(i, 'name', v)}
              placeholder="Major name"
              placeholderTextColor="#444"
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <TouchableOpacity style={[s.input, { flex: 1 }]} onPress={() => setMajorPicker({ index: i, field: 'start' })} activeOpacity={0.8}>
                <Text style={m.startDate ? s.inputText : s.inputPlaceholder}>{m.startDate || 'Start'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.input, { flex: 1 }]} onPress={() => setMajorPicker({ index: i, field: 'end' })} activeOpacity={0.8}>
                <Text style={m.endDate ? s.inputText : s.inputPlaceholder}>{m.endDate || 'End'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
        {majorPicker && (
          <DateTimePicker
            value={ukDateToDate(majorPicker.field === 'start' ? majors[majorPicker.index].startDate : majors[majorPicker.index].endDate)}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={(_event, selected) => {
              const target = majorPicker;
              setMajorPicker(null);
              if (!selected || !target) return;
              updateMajor(target.index, target.field === 'start' ? 'startDate' : 'endDate', dateToUk(selected));
            }}
          />
        )}

        <TouchableOpacity
          style={[s.createBtn, (!canCreate || saving) && { opacity: 0.4 }]}
          onPress={createSeason}
          disabled={!canCreate || saving}
          activeOpacity={0.85}
        >
          {saving ? <ActivityIndicator color="#000" /> : <Text style={s.createBtnText}>Create Season (Draft)</Text>}
        </TouchableOpacity>
        <Text style={[s.hint, { textAlign: 'center', marginTop: 8 }]}>
          Created as a draft — registration, publishing and player approval come later.
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerCenter: { alignItems: 'center' },
  headerLogo:   { width: 36, height: 36 },
  headerSub:    { fontFamily: FFB, fontSize: 10, letterSpacing: 2, marginTop: 2 },
  back:         { fontFamily: FFB, fontSize: 14 },

  scroll: { padding: 20, paddingBottom: 60 },

  sectionLabel: { fontFamily: FFB, fontSize: 11, color: GREEN, letterSpacing: 2, marginBottom: 4 },
  fieldLabel: { fontSize: 11, fontFamily: FFB, color: '#fff', letterSpacing: 1.5, marginBottom: 6, marginTop: 16 },
  miniLabel:  { fontSize: 10, fontFamily: FFB, color: '#888', letterSpacing: 1, marginBottom: 6 },
  hint:       { fontSize: 11, fontFamily: FF, color: '#666', lineHeight: 15, marginTop: 8 },

  input: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 15, fontFamily: FFB, color: '#fff',
  },
  inputText: { fontFamily: FFB, fontSize: 15, color: '#fff' },
  inputPlaceholder: { fontFamily: FFB, fontSize: 15, color: '#444' },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 6 },
  stepperBtn: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: '#111',
    borderWidth: 1, borderColor: '#1c1c1c', alignItems: 'center', justifyContent: 'center',
  },
  stepperBtnText: { fontSize: 18, fontFamily: FFB, color: GREEN },
  stepperValue: { fontSize: 16, fontFamily: FFB, color: '#fff', minWidth: 88, textAlign: 'center' },

  rowCard: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
  removeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  addBtn: { borderWidth: 1.5, borderColor: '#2a2a2a', borderStyle: 'dashed', borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  addBtnText: { fontFamily: FFB, fontSize: 13, color: '#fff' },

  majorCard: { backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c', borderRadius: 14, padding: 12, marginBottom: 10 },
  majorNum:  { fontFamily: FFB, fontSize: 9, color: GREEN, letterSpacing: 1.5, marginBottom: 6 },

  createBtn: { marginTop: 28, backgroundColor: GREEN, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  createBtnText: { fontFamily: FFB, fontSize: 15, color: '#000' },
});
