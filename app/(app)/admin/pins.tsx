import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';

type PinType = 'front' | 'centre' | 'back';

interface CourseHole {
  course_name: string;
  hole_number: number;
  par: number;
  front_lat: number | null; front_lng: number | null;
  green_lat: number | null; green_lng: number | null;
  back_lat:  number | null; back_lng:  number | null;
}

interface PinSet { lat: number; lng: number }

const PIN_CONFIG: Record<PinType, { label: string; color: string; col: { lat: string; lng: string } }> = {
  front:  { label: 'FRONT',  color: '#22c55e', col: { lat: 'front_lat',  lng: 'front_lng'  } },
  centre: { label: 'CENTRE', color: colors.gold, col: { lat: 'green_lat',  lng: 'green_lng'  } },
  back:   { label: 'BACK',   color: '#ef4444', col: { lat: 'back_lat',   lng: 'back_lng'   } },
};

export default function PinsScreen() {
  const router = useRouter();

  const [courses, setCourses]             = useState<string[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [holes, setHoles]                 = useState<CourseHole[]>([]);
  const [selectedHole, setSelectedHole]   = useState<number | null>(null);
  const [activePinType, setActivePinType] = useState<PinType>('centre');
  const [pending, setPending]             = useState<Partial<Record<PinType, PinSet>>>({});
  const [deviceLocation, setDeviceLocation] = useState<PinSet | null>(null);
  const [saving, setSaving]               = useState(false);
  const [loading, setLoading]             = useState(true);

  useEffect(() => {
    loadCourses();
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setDeviceLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    })();
  }, []);

  async function loadCourses() {
    const { data } = await supabase.from('course_holes').select('course_name');
    if (data) setCourses([...new Set((data as any[]).map(r => r.course_name))].sort());
    setLoading(false);
  }

  async function loadHoles(courseName: string) {
    const { data } = await supabase
      .from('course_holes')
      .select('course_name,hole_number,par,front_lat,front_lng,green_lat,green_lng,back_lat,back_lng')
      .eq('course_name', courseName)
      .order('hole_number');
    if (data) setHoles(data as CourseHole[]);
  }

  async function savePins() {
    if (!selectedCourse || selectedHole === null || Object.keys(pending).length === 0) return;
    setSaving(true);

    const update: Record<string, number> = {};
    for (const [type, pin] of Object.entries(pending) as [PinType, PinSet][]) {
      const cfg = PIN_CONFIG[type];
      update[cfg.col.lat] = pin.lat;
      update[cfg.col.lng] = pin.lng;
    }

    const { error } = await supabase
      .from('course_holes')
      .update(update as any)
      .eq('course_name', selectedCourse)
      .eq('hole_number', selectedHole);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      await loadHoles(selectedCourse);
      setPending({});
      const saved = Object.keys(pending).map(t => PIN_CONFIG[t as PinType].label).join(', ');
      Alert.alert('Saved', `Pins saved for Hole ${selectedHole}: ${saved}`);
    }
    setSaving(false);
  }

  function handleMapPress(lat: number, lng: number) {
    setPending(p => ({ ...p, [activePinType]: { lat, lng } }));
  }

  if (loading) {
    return <View style={s.centered}><ActivityIndicator color={colors.gold} size="large" /></View>;
  }

  // ── Map view ────────────────────────────────────────────────────
  if (selectedCourse && selectedHole !== null) {
    const hole = holes.find(h => h.hole_number === selectedHole);

    const existingPins: Record<PinType, PinSet | null> = {
      front:  hole?.front_lat  ? { lat: hole.front_lat,  lng: hole.front_lng!  } : null,
      centre: hole?.green_lat  ? { lat: hole.green_lat,  lng: hole.green_lng!  } : null,
      back:   hole?.back_lat   ? { lat: hole.back_lat,   lng: hole.back_lng!   } : null,
    };

    // Visible pins = pending overrides existing
    const visiblePins: Record<PinType, PinSet | null> = {
      front:  pending.front  ?? existingPins.front,
      centre: pending.centre ?? existingPins.centre,
      back:   pending.back   ?? existingPins.back,
    };

    const anchor = visiblePins.centre ?? visiblePins.front ?? visiblePins.back ?? deviceLocation ?? { lat: 51.5, lng: -0.5 };
    const hasPins = Object.values(visiblePins).some(Boolean);
    const region = {
      latitude: anchor.lat, longitude: anchor.lng,
      latitudeDelta:  hasPins ? 0.0015 : (deviceLocation ? 0.005 : 0.05),
      longitudeDelta: hasPins ? 0.0015 : (deviceLocation ? 0.005 : 0.05),
    };

    const hasPending = Object.keys(pending).length > 0;

    return (
      <View style={s.container}>
        <StatusBar style="light" />

        <View style={s.mapHeader}>
          <TouchableOpacity onPress={() => { setSelectedHole(null); setPending({}); }}>
            <Text style={s.backText}>‹ Back</Text>
          </TouchableOpacity>
          <View style={s.mapHeaderCenter}>
            <Text style={s.mapTitle}>{selectedCourse} — Hole {selectedHole}</Text>
            <Text style={s.mapSub}>Tap green to place pin · Drag existing pins to reposition</Text>
          </View>
        </View>

        {/* Pin type selector */}
        <View style={s.pinTypeRow}>
          {(Object.entries(PIN_CONFIG) as [PinType, typeof PIN_CONFIG[PinType]][]).map(([type, cfg]) => {
            const isActive = activePinType === type;
            const isSet = !!(visiblePins[type]);
            return (
              <TouchableOpacity
                key={type}
                style={[s.pinTypeBtn, isActive && { borderColor: cfg.color, backgroundColor: `${cfg.color}18` }]}
                onPress={() => setActivePinType(type)}
                activeOpacity={0.75}
              >
                <View style={[s.pinTypeDot, { backgroundColor: isSet ? cfg.color : '#333' }]} />
                <Text style={[s.pinTypeLabel, isActive && { color: cfg.color }]}>{cfg.label}</Text>
                {isSet && <Text style={[s.pinTypeCheck, { color: cfg.color }]}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>

        <MapView
          style={s.mapFull}
          mapType="satellite"
          initialRegion={region}
          onPress={e => handleMapPress(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude)}
        >
          {(Object.entries(visiblePins) as [PinType, PinSet | null][]).map(([type, pin]) => {
            if (!pin) return null;
            const cfg = PIN_CONFIG[type];
            const isPending = !!pending[type];
            return (
              <Marker
                key={type}
                coordinate={{ latitude: pin.lat, longitude: pin.lng }}
                draggable
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                onDragEnd={e => setPending(p => ({ ...p, [type]: { lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude } }))}
              >
                <View style={[s.mapPin, { borderColor: cfg.color, opacity: isPending ? 1 : 0.7 }]}>
                  <Text style={[s.mapPinText, { color: cfg.color }]}>{type[0].toUpperCase()}</Text>
                </View>
              </Marker>
            );
          })}
        </MapView>

        <View style={s.mapFooter}>
          {visiblePins[activePinType] && (
            <Text style={s.coordText}>
              {activePinType.toUpperCase()}: {visiblePins[activePinType]!.lat.toFixed(6)}, {visiblePins[activePinType]!.lng.toFixed(6)}
              {pending[activePinType] ? ' (unsaved)' : ''}
            </Text>
          )}
          <TouchableOpacity
            style={[s.saveBtn, (!hasPending || saving) && s.saveBtnOff]}
            onPress={savePins}
            disabled={!hasPending || saving}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color={colors.bg} />
              : <Text style={s.saveBtnText}>
                  Save {Object.keys(pending).map(t => PIN_CONFIG[t as PinType].label).join(' + ')} Pin{Object.keys(pending).length > 1 ? 's' : ''}
                </Text>
            }
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Hole list ───────────────────────────────────────────────────
  if (selectedCourse) {
    return (
      <View style={s.container}>
        <StatusBar style="light" />
        <View style={s.header}>
          <TouchableOpacity onPress={() => setSelectedCourse(null)}>
            <Text style={s.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={s.title}>{selectedCourse}</Text>
          <Text style={s.subtitle}>Tap a hole to set front, centre and back pins</Text>
        </View>
        <ScrollView contentContainerStyle={s.scroll}>
          {holes.map(h => {
            const hasF = !!h.front_lat, hasC = !!h.green_lat, hasB = !!h.back_lat;
            const allSet = hasF && hasC && hasB;
            return (
              <TouchableOpacity
                key={h.hole_number}
                style={[s.holeRow, allSet && s.holeRowComplete]}
                onPress={() => { setSelectedHole(h.hole_number); setPending({}); setActivePinType('centre'); }}
                activeOpacity={0.75}
              >
                <View style={s.holeNum}>
                  <Text style={s.holeNumText}>{h.hole_number}</Text>
                </View>
                <Text style={s.holePar}>Par {h.par}</Text>
                <View style={s.pinDots}>
                  {([['front', hasF, '#22c55e'], ['centre', hasC, colors.gold], ['back', hasB, '#ef4444']] as [string, boolean, string][]).map(([label, set, clr]) => (
                    <View key={label} style={s.pinDotWrap}>
                      <View style={[s.pinDot, { backgroundColor: set ? clr : '#333' }]} />
                      <Text style={[s.pinDotLabel, { color: set ? clr : '#444' }]}>{label[0].toUpperCase()}</Text>
                    </View>
                  ))}
                </View>
                <Text style={s.chevron}>›</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  // ── Course list ─────────────────────────────────────────────────
  return (
    <View style={s.container}>
      <StatusBar style="light" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Course Pins</Text>
        <Text style={s.subtitle}>Set front, centre and back pins per hole for the rangefinder</Text>
      </View>
      <ScrollView contentContainerStyle={s.scroll}>
        {courses.map(c => (
          <TouchableOpacity
            key={c} style={s.courseRow}
            onPress={() => { setSelectedCourse(c); loadHoles(c); }}
            activeOpacity={0.75}
          >
            <Text style={s.courseName}>{c}</Text>
            <Text style={s.chevron}>›</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },

  header: {
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title:    { fontSize: fonts.xxl, fontWeight: '800', color: colors.white, letterSpacing: 1, marginTop: spacing.xs },
  subtitle: { fontSize: fonts.sm, color: colors.textMuted, marginTop: spacing.xs },
  backText: { fontSize: fonts.md, color: colors.gold, fontWeight: '600' },
  scroll:   { padding: spacing.md, paddingBottom: 60 },

  courseRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  courseName: { flex: 1, fontSize: fonts.md, fontWeight: '700', color: colors.white },
  chevron:    { fontSize: fonts.lg, color: colors.textMuted },

  holeRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border, gap: spacing.sm,
  },
  holeRowComplete: { borderColor: colors.goldBorder },
  holeNum: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center',
  },
  holeNumText: { fontSize: fonts.md, fontWeight: '800', color: colors.white },
  holePar:     { fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600', width: 44 },
  pinDots:     { flex: 1, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' },
  pinDotWrap:  { alignItems: 'center', gap: 2 },
  pinDot:      { width: 10, height: 10, borderRadius: 5 },
  pinDotLabel: { fontSize: 8, fontWeight: '800' },

  mapHeader: {
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
    backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.border,
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
  },
  mapHeaderCenter: { flex: 1 },
  mapTitle: { fontSize: fonts.lg, fontWeight: '800', color: colors.white },
  mapSub:   { fontSize: fonts.xs, color: colors.textMuted, marginTop: 2 },

  pinTypeRow: {
    flexDirection: 'row', gap: spacing.sm, padding: spacing.sm,
    backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  pinTypeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs, paddingVertical: spacing.sm, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
  },
  pinTypeDot:   { width: 10, height: 10, borderRadius: 5 },
  pinTypeLabel: { fontSize: fonts.xs, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.5 },
  pinTypeCheck: { fontSize: fonts.xs, fontWeight: '900' },

  mapFull: { flex: 1 },
  mapPin: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.8)', borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  mapPinText: { fontSize: fonts.sm, fontWeight: '900' },

  mapFooter: {
    backgroundColor: colors.bg, padding: spacing.lg, paddingBottom: 40,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  coordText: { fontSize: fonts.xs, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.sm },
  saveBtn: {
    backgroundColor: colors.gold, borderRadius: radius.lg,
    paddingVertical: spacing.md, alignItems: 'center',
  },
  saveBtnOff:  { opacity: 0.35 },
  saveBtnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg, letterSpacing: 0.5 },
});
