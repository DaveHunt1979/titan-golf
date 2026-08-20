import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { useSocietyRole } from '../../../src/lib/useSocietyRole';
import { goBack } from '../../../src/lib/navigation';

const GOLD = '#D4AF37';
const FFB  = 'JUSTSans-ExBold';
const FF   = 'JUSTSans';

interface Trip {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
}

function formatDates(start: string | null, end: string | null): string {
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return fmt(start);
  return 'Dates TBC';
}

export default function TripsListScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { societyId } = useSocietyTheme();
  const { isOwner, isAdmin } = useSocietyRole(societyId);
  const canManage = isOwner || isAdmin;
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    let active = true;
    async function load() {
      if (!societyId) { setLoading(false); return; }
      setLoading(true);
      const { data } = await supabase
        .from('society_trips')
        .select('id, name, start_date, end_date, location')
        .eq('society_id', societyId)
        .order('start_date', { ascending: true, nullsFirst: false });
      if (active) { setTrips((data as Trip[]) ?? []); setLoading(false); }
    }
    load();
    return () => { active = false; };
  }, [societyId]));

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[s.back, { color: dc.gold }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: dc.cardText }]}>Up & Coming</Text>
        {canManage ? (
          <TouchableOpacity onPress={() => router.push('/(app)/trips/new' as any)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="add-circle" size={28} color={dc.gold} />
          </TouchableOpacity>
        ) : <View style={{ width: 28 }} />}
      </View>

      <Text style={[s.subtitle, { color: dc.textSecondary }]}>Society-only trip information</Text>

      {canManage && (
        <TouchableOpacity
          style={[s.addBtn, { backgroundColor: dc.gold }]}
          onPress={() => router.push('/(app)/trips/new' as any)}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={18} color="#000" />
          <Text style={s.addBtnText}>Add New Trip</Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <ActivityIndicator color={dc.gold} style={{ marginTop: 40 }} />
      ) : trips.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="card-outline" size={40} color={dc.textSecondary} />
          <Text style={[s.emptyText, { color: dc.cardText }]}>No upcoming trips yet</Text>
          {canManage && (
            <Text style={[s.emptySub, { color: dc.textSecondary }]}>Tap Add New Trip above to add your first trip</Text>
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {trips.map(trip => (
            <TouchableOpacity
              key={trip.id}
              style={[s.card, { backgroundColor: dc.card, borderColor: dc.border }]}
              onPress={() => router.push(`/(app)/trips/${trip.id}` as any)}
              activeOpacity={0.85}
            >
              <View style={{ flex: 1 }}>
                <Text style={[s.cardName, { color: dc.cardText }]}>{trip.name}</Text>
                <Text style={[s.cardMeta, { color: dc.textSecondary }]}>{formatDates(trip.start_date, trip.end_date)}</Text>
                {trip.location && <Text style={[s.cardMeta, { color: dc.textSecondary }]}>{trip.location}</Text>}
              </View>
              <Ionicons name="chevron-forward" size={18} color={dc.textSecondary} />
            </TouchableOpacity>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
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

  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 12, paddingVertical: 14, marginHorizontal: 20, marginBottom: 16,
  },
  addBtnText: { fontSize: 15, fontFamily: FFB, color: '#000', letterSpacing: 0.5 },

  empty: { alignItems: 'center', marginTop: 60, gap: 8, paddingHorizontal: 40 },
  emptyText: { fontSize: 15, fontFamily: FFB, marginTop: 8 },
  emptySub:  { fontSize: 12, fontFamily: FF, textAlign: 'center' },

  scroll: { paddingHorizontal: 20, gap: 12 },
  card: {
    borderRadius: 14, borderWidth: 1, padding: 16,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  cardName: { fontSize: 15, fontFamily: FFB, marginBottom: 4 },
  cardMeta: { fontSize: 12, fontFamily: FF },
});
