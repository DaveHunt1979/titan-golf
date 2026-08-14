import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { useSocietyRole } from '../../../src/lib/useSocietyRole';

const FFB = 'JUSTSans-ExBold';
const FF  = 'JUSTSans';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function Field({ label, value, onChangeText, placeholder, dc }: {
  label: string; value: string; onChangeText: (t: string) => void; placeholder: string;
  dc: ReturnType<typeof useDynamicColors>;
}) {
  return (
    <>
      <Text style={[s.fieldLabel, { color: dc.textSecondary }]}>{label}</Text>
      <TextInput
        style={[s.input, { backgroundColor: dc.card, borderColor: dc.border, color: dc.cardText }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#666"
      />
    </>
  );
}

export default function NewTripScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { societyId } = useSocietyTheme();
  const { playerId, isOwner, loading: roleLoading } = useSocietyRole(societyId);

  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [location, setLocation] = useState('');
  const [airport, setAirport] = useState('');
  const [outboundFlight, setOutboundFlight] = useState('');
  const [returnFlight, setReturnFlight] = useState('');
  const [totalCost, setTotalCost] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) { Alert.alert('Trip name required', 'Enter a name for the trip.'); return; }
    if (startDate.trim() && !DATE_RE.test(startDate.trim())) { Alert.alert('Invalid start date', 'Enter as YYYY-MM-DD, e.g. 2027-06-10.'); return; }
    if (endDate.trim() && !DATE_RE.test(endDate.trim())) { Alert.alert('Invalid end date', 'Enter as YYYY-MM-DD, e.g. 2027-06-14.'); return; }
    if (!societyId) return;

    setSaving(true);
    const { error } = await supabase.from('society_trips').insert({
      society_id: societyId,
      name: name.trim(),
      start_date: startDate.trim() || null,
      end_date: endDate.trim() || null,
      location: location.trim() || null,
      airport: airport.trim() || null,
      outbound_flight: outboundFlight.trim() || null,
      return_flight: returnFlight.trim() || null,
      total_cost: totalCost.trim() || null,
      created_by: playerId,
    });
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    router.back();
  }

  if (!roleLoading && !isOwner) {
    return (
      <View style={[s.container, { backgroundColor: dc.bg }]}>
        <StatusBar style="light" />
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}><Text style={[s.back, { color: dc.gold }]}>← Back</Text></TouchableOpacity>
        </View>
        <Text style={[s.notice, { color: dc.textSecondary }]}>Only the society owner can add trips.</Text>
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[s.back, { color: dc.gold }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: dc.cardText }]}>New Trip</Text>
        <View style={{ width: 56 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Field label="TRIP NAME"       value={name}           onChangeText={setName}           placeholder="e.g. Titan Tour 2027" dc={dc} />
        <Field label="START DATE"      value={startDate}      onChangeText={setStartDate}      placeholder="YYYY-MM-DD"           dc={dc} />
        <Field label="END DATE"        value={endDate}        onChangeText={setEndDate}        placeholder="YYYY-MM-DD"           dc={dc} />
        <Field label="LOCATION"        value={location}       onChangeText={setLocation}       placeholder="e.g. Praia D'El Rey, Portugal" dc={dc} />
        <Field label="AIRPORT"         value={airport}        onChangeText={setAirport}        placeholder="e.g. Lisbon (LIS)"    dc={dc} />
        <Field label="OUTBOUND FLIGHT" value={outboundFlight} onChangeText={setOutboundFlight} placeholder="e.g. TAP 1359 | LHR > LIS" dc={dc} />
        <Field label="RETURN FLIGHT"   value={returnFlight}   onChangeText={setReturnFlight}   placeholder="e.g. TAP 1358 | LIS > LHR" dc={dc} />
        <Field label="TOTAL COST"      value={totalCost}      onChangeText={setTotalCost}      placeholder="e.g. £1,250 per person" dc={dc} />

        <TouchableOpacity style={[s.saveBtn, { backgroundColor: dc.gold }, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} activeOpacity={0.85}>
          {saving ? <ActivityIndicator color="#000" /> : <Text style={s.saveBtnText}>Save Trip</Text>}
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 8,
  },
  back:  { fontSize: 14, fontFamily: FFB },
  title: { fontSize: 16, fontFamily: FFB },
  notice: { fontSize: 14, fontFamily: FF, textAlign: 'center', marginTop: 60, paddingHorizontal: 40 },

  scroll: { paddingHorizontal: 20, paddingTop: 12 },
  fieldLabel: { fontSize: 11, fontFamily: FFB, letterSpacing: 1.5, marginBottom: 6, marginTop: 16 },
  input: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 15, fontFamily: FF,
  },
  saveBtn: { borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 28 },
  saveBtnText: { fontSize: 15, fontFamily: FFB, color: '#000', letterSpacing: 0.5 },
});
