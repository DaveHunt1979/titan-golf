import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { useSocietyRole } from '../../../src/lib/useSocietyRole';
import ConfirmDialog from '../../../src/components/ConfirmDialog';

const FFB = 'JUSTSans-ExBold';
const FF  = 'JUSTSans';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Trip {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  airport: string | null;
  outbound_flight: string | null;
  return_flight: string | null;
  total_cost: string | null;
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function InfoCard({ label, value, dc }: { label: string; value: string; dc: ReturnType<typeof useDynamicColors> }) {
  return (
    <View style={[s.card, { backgroundColor: dc.card, borderColor: dc.border }]}>
      <Text style={[s.cardLabel, { color: dc.gold }]}>{label}</Text>
      <Text style={[s.cardValue, { color: dc.cardText }]}>{value}</Text>
    </View>
  );
}

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

export default function TripDetailScreen() {
  const router = useRouter();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const dc = useDynamicColors();
  const { societyId } = useSocietyTheme();
  const { isOwner, isAdmin } = useSocietyRole(societyId);
  const canManage = isOwner || isAdmin;

  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [location, setLocation] = useState('');
  const [airport, setAirport] = useState('');
  const [outboundFlight, setOutboundFlight] = useState('');
  const [returnFlight, setReturnFlight] = useState('');
  const [totalCost, setTotalCost] = useState('');

  function hydrateForm(t: Trip) {
    setName(t.name);
    setStartDate(t.start_date ?? '');
    setEndDate(t.end_date ?? '');
    setLocation(t.location ?? '');
    setAirport(t.airport ?? '');
    setOutboundFlight(t.outbound_flight ?? '');
    setReturnFlight(t.return_flight ?? '');
    setTotalCost(t.total_cost ?? '');
  }

  useFocusEffect(useCallback(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const { data } = await supabase.from('society_trips').select('*').eq('id', tripId).maybeSingle();
      if (active) {
        setTrip(data as Trip | null);
        if (data) hydrateForm(data as Trip);
        setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [tripId]));

  async function save() {
    if (!name.trim()) { Alert.alert('Trip name required', 'Enter a name for the trip.'); return; }
    if (startDate.trim() && !DATE_RE.test(startDate.trim())) { Alert.alert('Invalid start date', 'Enter as YYYY-MM-DD, e.g. 2027-06-10.'); return; }
    if (endDate.trim() && !DATE_RE.test(endDate.trim())) { Alert.alert('Invalid end date', 'Enter as YYYY-MM-DD, e.g. 2027-06-14.'); return; }

    setSaving(true);
    const { error } = await supabase.from('society_trips').update({
      name: name.trim(),
      start_date: startDate.trim() || null,
      end_date: endDate.trim() || null,
      location: location.trim() || null,
      airport: airport.trim() || null,
      outbound_flight: outboundFlight.trim() || null,
      return_flight: returnFlight.trim() || null,
      total_cost: totalCost.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', tripId);
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    const { data } = await supabase.from('society_trips').select('*').eq('id', tripId).maybeSingle();
    if (data) { setTrip(data as Trip); hydrateForm(data as Trip); }
    setEditing(false);
  }

  async function deleteTrip() {
    setConfirmingDelete(false);
    const { error } = await supabase.from('society_trips').delete().eq('id', tripId);
    if (error) { Alert.alert('Error', error.message); return; }
    router.back();
  }

  if (loading) {
    return (
      <View style={[s.container, { backgroundColor: dc.bg, justifyContent: 'center' }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={dc.gold} />
      </View>
    );
  }

  if (!trip) {
    return (
      <View style={[s.container, { backgroundColor: dc.bg }]}>
        <StatusBar style="light" />
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}><Text style={[s.back, { color: dc.gold }]}>← Back</Text></TouchableOpacity>
        </View>
        <Text style={[s.notice, { color: dc.textSecondary }]}>Trip not found.</Text>
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => (editing ? setEditing(false) : router.back())} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[s.back, { color: dc.gold }]}>← {editing ? 'Cancel' : 'Back'}</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: dc.cardText }]}>{editing ? 'Edit Trip' : 'Up & Coming'}</Text>
        {canManage && !editing ? (
          <TouchableOpacity onPress={() => setEditing(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="create-outline" size={22} color={dc.gold} />
          </TouchableOpacity>
        ) : <View style={{ width: 22 }} />}
      </View>

      {!editing && <Text style={[s.subtitle, { color: dc.textSecondary }]}>Society-only trip information</Text>}

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {editing ? (
          <>
            <Field label="TRIP NAME"       value={name}           onChangeText={setName}           placeholder="e.g. Titan Tour 2027" dc={dc} />
            <Field label="START DATE"      value={startDate}      onChangeText={setStartDate}      placeholder="YYYY-MM-DD"           dc={dc} />
            <Field label="END DATE"        value={endDate}        onChangeText={setEndDate}        placeholder="YYYY-MM-DD"           dc={dc} />
            <Field label="LOCATION"        value={location}       onChangeText={setLocation}       placeholder="e.g. Praia D'El Rey, Portugal" dc={dc} />
            <Field label="AIRPORT"         value={airport}        onChangeText={setAirport}        placeholder="e.g. Lisbon (LIS)"    dc={dc} />
            <Field label="OUTBOUND FLIGHT" value={outboundFlight} onChangeText={setOutboundFlight} placeholder="e.g. TAP 1359 | LHR > LIS" dc={dc} />
            <Field label="RETURN FLIGHT"   value={returnFlight}   onChangeText={setReturnFlight}   placeholder="e.g. TAP 1358 | LIS > LHR" dc={dc} />
            <Field label="TOTAL COST"      value={totalCost}      onChangeText={setTotalCost}      placeholder="e.g. £1,250 per person" dc={dc} />

            <TouchableOpacity style={[s.saveBtn, { backgroundColor: dc.gold }, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} activeOpacity={0.85}>
              {saving ? <ActivityIndicator color="#000" /> : <Text style={s.saveBtnText}>Save Changes</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={s.deleteBtn} onPress={() => setConfirmingDelete(true)} activeOpacity={0.85}>
              <Text style={s.deleteBtnText}>Delete Trip</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <InfoCard label="TRIP NAME" value={trip.name} dc={dc} />
            <InfoCard label="DATES" value={
              trip.start_date && trip.end_date ? `${fmt(trip.start_date)} – ${fmt(trip.end_date)}`
                : trip.start_date ? fmt(trip.start_date) : 'TBC'
            } dc={dc} />
            {trip.location && <InfoCard label="LOCATION" value={trip.location} dc={dc} />}
            {trip.airport && <InfoCard label="AIRPORT" value={trip.airport} dc={dc} />}
            {trip.outbound_flight && <InfoCard label="OUTBOUND FLIGHT" value={trip.outbound_flight} dc={dc} />}
            {trip.return_flight && <InfoCard label="RETURN FLIGHT" value={trip.return_flight} dc={dc} />}
            {trip.total_cost && <InfoCard label="TOTAL COST" value={trip.total_cost} dc={dc} />}

            <View style={[s.privacyCard, { borderColor: dc.gold }]}>
              <Text style={[s.cardLabel, { color: dc.gold }]}>PRIVACY</Text>
              <Text style={[s.cardValue, { color: dc.cardText }]}>Visible only to members of this society.</Text>
            </View>
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      <ConfirmDialog
        visible={confirmingDelete}
        title="Delete Trip"
        message={`Delete "${trip.name}"? This cannot be undone.`}
        confirmLabel="Delete Trip"
        destructive
        onConfirm={deleteTrip}
        onCancel={() => setConfirmingDelete(false)}
      />
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
  subtitle: { fontSize: 12, fontFamily: FF, paddingHorizontal: 20, marginBottom: 16 },
  notice: { fontSize: 14, fontFamily: FF, textAlign: 'center', marginTop: 60, paddingHorizontal: 40 },

  scroll: { paddingHorizontal: 20 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 12 },
  cardLabel: { fontFamily: FFB, fontSize: 10, letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' },
  cardValue: { fontFamily: FFB, fontSize: 16 },
  privacyCard: { borderRadius: 14, borderWidth: 1, padding: 16, backgroundColor: 'rgba(212,175,55,0.08)' },

  fieldLabel: { fontSize: 11, fontFamily: FFB, letterSpacing: 1.5, marginBottom: 6, marginTop: 16 },
  input: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 15, fontFamily: FF,
  },
  saveBtn: { borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 28 },
  saveBtnText: { fontSize: 15, fontFamily: FFB, color: '#000', letterSpacing: 0.5 },
  deleteBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 14, borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)', backgroundColor: 'rgba(248,113,113,0.08)' },
  deleteBtnText: { fontSize: 14, fontFamily: FFB, color: '#f87171' },
});
