// Edit an existing Season's division setup (Ricky, via Dave, 2026-09-16).
// season-create.tsx only ever writes season_divisions once, at creation —
// there was no way to go back and fix a division count/size mistake (Ricky
// put 20 players into one division while testing, so there was nothing to
// see the promotion/relegation split actually do). This reuses that same
// divisions editor against an existing season: update in place, insert any
// newly-added rows, delete any removed ones (season_entries.division_id is
// ON DELETE SET NULL, so a removed division just unassigns its entrants
// rather than orphaning anything). Doesn't touch who's already assigned —
// admin re-runs Publish/Re-Publish from the Seasons list afterwards to
// redistribute by handicap into the new setup.
import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Image,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { titanLogo } from '../../../src/lib/assets';
import { goBack } from '../../../src/lib/navigation';

const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';

interface DivisionRow { id: string | null; name: string; targetSize: string; }

export default function SeasonEditScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { localLogo, logoUrl } = useSocietyTheme();
  const { id: seasonId } = useLocalSearchParams<{ id: string }>();
  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [seasonName, setSeasonName] = useState('');
  const [divisions, setDivisions] = useState<DivisionRow[]>([]);
  const [promotionPlaces, setPromotionPlaces] = useState(3);
  const [relegationPlaces, setRelegationPlaces] = useState(3);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!seasonId) return;
    (async () => {
      const [{ data: season }, { data: divs }] = await Promise.all([
        supabase.from('seasons').select('name').eq('id', seasonId).maybeSingle(),
        supabase.from('season_divisions')
          .select('id, name, target_player_count, promotion_places, relegation_places')
          .eq('season_id', seasonId).order('display_order', { ascending: true }),
      ]);
      setSeasonName((season as any)?.name ?? '');
      const rows = (divs ?? []) as any[];
      setDivisions(rows.map(d => ({ id: d.id, name: d.name, targetSize: String(d.target_player_count) })));
      const middle = rows.find(d => d.promotion_places > 0 && d.relegation_places > 0) ?? rows[0];
      if (middle) {
        setPromotionPlaces(middle.promotion_places || 3);
        setRelegationPlaces(middle.relegation_places || 3);
      }
      setLoading(false);
    })();
  }, [seasonId]);

  if (!fontsLoaded || loading) return <View style={[s.container, { backgroundColor: dc.bg }]} />;

  function updateDivision(i: number, field: 'name' | 'targetSize', value: string) {
    setDivisions(prev => prev.map((d, idx) => idx === i ? { ...d, [field]: value } : d));
  }
  function addDivision() {
    setDivisions(prev => [...prev, { id: null, name: `Division ${prev.length + 1}`, targetSize: '20' }]);
  }
  function removeDivision(i: number) {
    if (divisions.length <= 1) return;
    setDivisions(prev => prev.filter((_, idx) => idx !== i));
  }

  const canSave = divisions.length > 0 && divisions.every(d => d.name.trim().length > 0 && Number(d.targetSize) > 0);

  async function save() {
    if (!seasonId || !canSave) return;
    setSaving(true);
    try {
      const { data: existingDivs } = await supabase.from('season_divisions').select('id').eq('season_id', seasonId);
      const existingIds = new Set(((existingDivs ?? []) as any[]).map(d => d.id as string));
      const keptIds = new Set(divisions.filter(d => d.id).map(d => d.id as string));
      const removedIds = [...existingIds].filter(id => !keptIds.has(id));

      if (removedIds.length > 0) {
        await supabase.from('season_divisions').delete().in('id', removedIds);
      }

      for (let i = 0; i < divisions.length; i++) {
        const d = divisions[i];
        const payload = {
          season_id: seasonId, name: d.name.trim(), display_order: i,
          target_player_count: Number(d.targetSize),
          // Spec §6.1 — top division: no promotion; bottom division: no relegation.
          promotion_places: i === 0 ? 0 : promotionPlaces,
          relegation_places: i === divisions.length - 1 ? 0 : relegationPlaces,
        };
        if (d.id) {
          await supabase.from('season_divisions').update(payload as any).eq('id', d.id);
        } else {
          await supabase.from('season_divisions').insert(payload as any);
        }
      }

      Alert.alert('Saved', 'Division setup updated. Use Publish/Re-Publish on the Seasons list to redistribute entrants into it.', [
        { text: 'Done', onPress: () => router.replace('/(app)/admin/season-manage' as any) },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save changes');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />
      <View style={[s.header, { borderBottomColor: dc.border }]}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/admin/season-manage')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={[s.back, { color: dc.gold }]}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)} style={s.headerLogo} resizeMode="contain" />
          <Text style={[s.headerSub, { color: GREEN }]}>EDIT SEASON</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={s.sectionLabel}>{seasonName.toUpperCase()}</Text>
        <Text style={s.hint}>
          Changes here only affect division names/sizes, not who's already placed. Run Publish/Re-Publish
          from the Seasons list afterwards to redistribute entrants by handicap into the new setup.
        </Text>

        <Text style={[s.sectionLabel, { marginTop: 24 }]}>DIVISIONS</Text>
        {divisions.map((d, i) => (
          <View key={d.id ?? `new-${i}`} style={s.rowCard}>
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

        <TouchableOpacity
          style={[s.createBtn, (!canSave || saving) && { opacity: 0.4 }]}
          onPress={save}
          disabled={!canSave || saving}
          activeOpacity={0.85}
        >
          {saving ? <ActivityIndicator color="#000" /> : <Text style={s.createBtnText}>Save Changes</Text>}
        </TouchableOpacity>
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

  createBtn: { marginTop: 28, backgroundColor: GREEN, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  createBtnText: { fontFamily: FFB, fontSize: 15, color: '#000' },
});
