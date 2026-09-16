// Mashie-only native events calendar (Dave, 2026-09-16) — rebuilds
// mashiegolf.co.uk/event-schedule/ in-app rather than just linking out to it.
// Data is a hardcoded snapshot (src/lib/mashieEvents.ts, pulled 2026-09-16) —
// Mashie's own calendar has no API and no per-event page to link to, so this
// needs a manual refresh whenever their schedule changes materially. Mashie's
// own booking process is "contact memberships@mashiegolf.co.uk" (confirmed —
// there's no booking button anywhere on their real site either), so Enquire
// opens a pre-filled email to that same address rather than faking a booking
// flow that doesn't exist on their end.
import { useMemo, useState } from 'react';
import {
  View, Text, SectionList, TouchableOpacity, StyleSheet, Image, Linking, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { useDynamicColors } from '../../src/lib/SocietyThemeContext';
import { goBack } from '../../src/lib/navigation';
import { MASHIE_EVENTS, type MashieEvent } from '../../src/lib/mashieEvents';

const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';
const GREEN = '#4ade80';
const GOLD  = '#D4AF37';

const SERIES_COLOR: Record<string, string> = {
  'Summer Series': '#f5a623',
  'Winter Series': '#60a5fa',
  'Amateur Golf Events': GREEN,
  'Networking Events': '#a78bfa',
  'MAJOR': GOLD,
};

const FILTERS = [
  { value: 'All', label: 'All' },
  { value: 'Summer Series', label: 'Summer' },
  { value: 'Winter Series', label: 'Winter' },
  { value: 'Amateur Golf Events', label: 'Amateur' },
  { value: 'Networking Events', label: 'Networking' },
  { value: 'MAJOR', label: 'MAJOR' },
];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthYearKey(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00`);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function dayOfMonth(dateIso: string): number {
  return Number(dateIso.slice(8, 10));
}

export default function MashieEventsScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const [filter, setFilter] = useState('All');

  const [fontsLoaded] = useFonts({
    [FF]:  require('../../assets/fonts/JUSTSans-Regular.otf'),
    [FFB]: require('../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const sections = useMemo(() => {
    const filtered = filter === 'All' ? MASHIE_EVENTS : MASHIE_EVENTS.filter(e => e.series === filter);
    const byMonth = new Map<string, MashieEvent[]>();
    for (const e of filtered) {
      const key = monthYearKey(e.date);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(e);
    }
    return [...byMonth.entries()].map(([title, data]) => ({ title: title.toUpperCase(), data }));
  }, [filter]);

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: dc.bg }}><StatusBar style="light" /></View>;

  function enquire(e: MashieEvent) {
    const d = new Date(`${e.date}T00:00:00`);
    const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const subject = encodeURIComponent(`Booking Enquiry: ${e.title} — ${dateStr}`);
    const body = encodeURIComponent(`Hi MASHIE team,\n\nI'd like to book a place on ${e.title} at ${e.venue} on ${dateStr}.\n\nThanks!`);
    Linking.openURL(`mailto:memberships@mashiegolf.co.uk?subject=${subject}&body=${body}`);
  }

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/')} style={s.headerBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color={dc.cardText} />
        </TouchableOpacity>
        <Text style={[s.title, { color: dc.cardText }]}>MASHIE EVENTS</Text>
        <View style={s.headerBtn} />
      </View>

      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={s.filterScroll} contentContainerStyle={s.filterRow}
      >
        {FILTERS.map(({ value, label }) => {
          const active = filter === value;
          const color = value === 'All' ? dc.gold : SERIES_COLOR[value];
          return (
            <TouchableOpacity
              key={value}
              onPress={() => setFilter(value)}
              style={[s.chip, { borderColor: color, backgroundColor: active ? `${color}30` : 'transparent' }]}
              activeOpacity={0.8}
            >
              <Text style={[s.chipText, { color }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <SectionList
        sections={sections}
        keyExtractor={(item, idx) => `${item.date}-${item.title}-${idx}`}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => (
          <View style={[s.sectionHeader, { backgroundColor: dc.bg }]}>
            <Text style={[s.sectionHeaderText, { color: dc.gold }]}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const color = SERIES_COLOR[item.series] ?? dc.gold;
          const isOpen = item.openTo === 'Open Event';
          return (
            <View style={[s.card, { backgroundColor: dc.card, borderColor: dc.border }]}>
              <View style={[s.dateBox, { backgroundColor: `${color}20`, borderColor: `${color}50` }]}>
                <Text style={[s.dateDay, { color }]}>{dayOfMonth(item.date)}</Text>
                <Text style={[s.dateWeekday, { color }]}>{item.weekday.toUpperCase()}</Text>
              </View>

              <View style={{ flex: 1 }}>
                <View style={s.seriesRow}>
                  <View style={[s.seriesDot, { backgroundColor: color }]} />
                  <Text style={[s.seriesLabel, { color }]}>{item.series.toUpperCase()}</Text>
                </View>
                <Text style={[s.eventTitle, { color: dc.cardText }]} numberOfLines={2}>{item.title}</Text>
                <View style={s.metaRow}>
                  <Ionicons name="location-outline" size={12} color={dc.textSecondary} />
                  <Text style={[s.venueText, { color: dc.textSecondary }]} numberOfLines={1}>{item.venue}</Text>
                  <View style={[s.openToPill, {
                    backgroundColor: isOpen ? `${GREEN}22` : `${GOLD}22`,
                    borderColor: isOpen ? `${GREEN}55` : `${GOLD}55`,
                  }]}>
                    <Text style={[s.openToText, { color: isOpen ? GREEN : GOLD }]}>
                      {isOpen ? 'OPEN TO ALL' : 'MEMBERS'}
                    </Text>
                  </View>
                </View>

                <View style={s.footerRow}>
                  <View style={s.sponsorRow}>
                    {item.sponsorLogos.slice(0, 3).map((url, i) => (
                      <View key={i} style={s.sponsorChip}>
                        <Image source={{ uri: url }} style={s.sponsorLogo} resizeMode="contain" />
                      </View>
                    ))}
                  </View>
                  <TouchableOpacity style={[s.enquireBtn, { backgroundColor: color }]} onPress={() => enquire(item)} activeOpacity={0.85}>
                    <Ionicons name="mail-outline" size={12} color="#000" />
                    <Text style={s.enquireBtnText}>ENQUIRE</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        }}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingTop: 56 },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  headerBtn: { width: 36, alignItems: 'center' },
  title:     { fontFamily: FFB, fontSize: 13, letterSpacing: 2 },

  filterScroll: { flexGrow: 0, marginBottom: 4 },
  filterRow:    { paddingHorizontal: 16, gap: 8, paddingBottom: 12 },
  chip:         { borderWidth: 1.5, borderRadius: 99, paddingHorizontal: 14, height: 34, justifyContent: 'center', alignItems: 'center' },
  chipText:     { fontFamily: FFB, fontSize: 11, letterSpacing: 0.5 },

  sectionHeader:     { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  sectionHeaderText: { fontFamily: FFB, fontSize: 12, letterSpacing: 2 },

  listContent: { paddingHorizontal: 16, paddingBottom: 120 },

  card:    { flexDirection: 'row', gap: 12, borderRadius: 16, borderWidth: 1, padding: 12, marginBottom: 10 },
  dateBox: { width: 56, height: 56, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dateDay: { fontFamily: FFB, fontSize: 20, lineHeight: 22 },
  dateWeekday: { fontFamily: FFB, fontSize: 9, letterSpacing: 1, marginTop: 1 },

  seriesRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  seriesDot:   { width: 6, height: 6, borderRadius: 3 },
  seriesLabel: { fontFamily: FFB, fontSize: 9, letterSpacing: 1 },
  eventTitle:  { fontFamily: FFB, fontSize: 15, marginBottom: 4 },

  metaRow:      { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  venueText:    { fontFamily: FF, fontSize: 11, marginRight: 4 },
  openToPill:   { borderWidth: 1, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
  openToText:   { fontFamily: FFB, fontSize: 9, letterSpacing: 0.5 },

  footerRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  sponsorRow:  { flexDirection: 'row', gap: 6 },
  sponsorChip: { width: 26, height: 26, borderRadius: 6, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 3 },
  sponsorLogo: { width: '100%', height: '100%' },

  enquireBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 },
  enquireBtnText: { fontFamily: FFB, fontSize: 10, letterSpacing: 0.5, color: '#000' },
});
