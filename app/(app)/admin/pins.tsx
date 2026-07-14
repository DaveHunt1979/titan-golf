import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, Image,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';

// ── TITAN constants ───────────────────────────────────────────
const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const RED    = '#f87171';
const PURPLE = '#a78bfa';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

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
  front:  { label: 'FRONT',  color: GREEN, col: { lat: 'front_lat', lng: 'front_lng' } },
  centre: { label: 'CENTRE', color: GOLD,  col: { lat: 'green_lat', lng: 'green_lng' } },
  back:   { label: 'BACK',   color: RED,   col: { lat: 'back_lat',  lng: 'back_lng'  } },
};

export default function PinsScreen() {
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [courses, setCourses]               = useState<string[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [holes, setHoles]                   = useState<CourseHole[]>([]);
  const [selectedHole, setSelectedHole]     = useState<number | null>(null);
  const [activePinType, setActivePinType]   = useState<PinType>('centre');
  const [pending, setPending]               = useState<Partial<Record<PinType, PinSet>>>({});
  const [deviceLocation, setDeviceLocation] = useState<PinSet | null>(null);
  const [saving, setSaving]                 = useState(false);
  const [loading, setLoading]               = useState(true);

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

  if (loading || !fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
      </View>
    );
  }

  // ── Map view ──────────────────────────────────────────────────
  if (selectedCourse && selectedHole !== null) {
    const hole = holes.find(h => h.hole_number === selectedHole);

    const existingPins: Record<PinType, PinSet | null> = {
      front:  hole?.front_lat  ? { lat: hole.front_lat,  lng: hole.front_lng!  } : null,
      centre: hole?.green_lat  ? { lat: hole.green_lat,  lng: hole.green_lng!  } : null,
      back:   hole?.back_lat   ? { lat: hole.back_lat,   lng: hole.back_lng!   } : null,
    };

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
            const isSet    = !!(visiblePins[type]);
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
                onDragEnd={e => setPending(p => ({
                  ...p,
                  [type]: { lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude },
                }))}
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
              ? <ActivityIndicator color="#000" />
              : <Text style={s.saveBtnText}>
                  Save {Object.keys(pending).map(t => PIN_CONFIG[t as PinType].label).join(' + ')} Pin{Object.keys(pending).length > 1 ? 's' : ''}
                </Text>
            }
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Hole list ─────────────────────────────────────────────────
  if (selectedCourse) {
    return (
      <View style={s.container}>
        <StatusBar style="light" />
        <View style={s.header}>
          <TouchableOpacity onPress={() => setSelectedCourse(null)} style={s.headerSide}>
            <Text style={s.backText}>‹ Back</Text>
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Image source={titanLogo} style={s.logo} resizeMode="contain" />
            <Text style={s.title}>{selectedCourse}</Text>
            <Text style={s.subtitle}>Tap a hole to set front, centre and back pins</Text>
          </View>
          <View style={s.headerSide} />
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
                  {([['front', hasF, GREEN], ['centre', hasC, GOLD], ['back', hasB, RED]] as [string, boolean, string][]).map(([label, set, clr]) => (
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

  // ── Course list ───────────────────────────────────────────────
  return (
    <View style={s.container}>
      <StatusBar style="light" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerSide}>
          <Text style={s.backText}>‹ Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.logo} resizeMode="contain" />
          <Text style={s.title}>Course Pins</Text>
          <Text style={s.subtitle}>Set front, centre and back pins per hole for the rangefinder</Text>
        </View>
        <View style={s.headerSide} />
      </View>
      <ScrollView contentContainerStyle={s.scroll}>
        {courses.map(c => (
          <TouchableOpacity
            key={c}
            style={s.courseRow}
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
  container: { flex: 1, backgroundColor: '#000' },

  header: {
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
    flexDirection: 'row', alignItems: 'center',
  },
  headerSide:   { width: 72 },
  headerCenter: { flex: 1, alignItems: 'center', gap: 2 },
  logo:         { width: 24, height: 24, marginBottom: 2 },
  title:        { fontSize: 15, fontFamily: FFB, color: '#fff' },
  subtitle:     { fontSize: 9, fontFamily: FF, color: '#555' },
  backText:     { fontSize: 15, fontFamily: FFB, color: GOLD },

  scroll: { padding: 16, paddingBottom: 60 },

  courseRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#111', borderRadius: 14,
    padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#1c1c1c',
  },
  courseName: { flex: 1, fontSize: 15, fontFamily: FFB, color: '#fff' },
  chevron:    { fontSize: 18, fontFamily: FF, color: '#555' },

  holeRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#111', borderRadius: 14,
    padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#1c1c1c', gap: 10,
  },
  holeRowComplete: { borderColor: 'rgba(212,175,55,0.4)' },
  holeNum: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#1c1c1c', alignItems: 'center', justifyContent: 'center',
  },
  holeNumText: { fontSize: 14, fontFamily: FFB, color: '#fff' },
  holePar:     { fontSize: 13, fontFamily: FF, color: '#555', width: 44 },
  pinDots:     { flex: 1, flexDirection: 'row', gap: 12, justifyContent: 'center' },
  pinDotWrap:  { alignItems: 'center', gap: 2 },
  pinDot:      { width: 10, height: 10, borderRadius: 5 },
  pinDotLabel: { fontSize: 8, fontFamily: FFB },

  mapHeader: {
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12,
    backgroundColor: '#000', borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
    flexDirection: 'row', alignItems: 'flex-start', gap: 14,
  },
  mapHeaderCenter: { flex: 1 },
  mapTitle: { fontSize: 15, fontFamily: FFB, color: '#fff' },
  mapSub:   { fontSize: 9, fontFamily: FF, color: '#555', marginTop: 2 },

  pinTypeRow: {
    flexDirection: 'row', gap: 10, padding: 10,
    backgroundColor: '#000', borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  pinTypeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: '#1c1c1c', backgroundColor: '#111',
  },
  pinTypeDot:   { width: 10, height: 10, borderRadius: 5 },
  pinTypeLabel: { fontSize: 10, fontFamily: FFB, color: '#555', letterSpacing: 0.5 },
  pinTypeCheck: { fontSize: 10, fontFamily: FFB },

  mapFull: { flex: 1 },
  mapPin: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.8)', borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  mapPinText: { fontSize: 13, fontFamily: FFB },

  mapFooter: {
    backgroundColor: '#000', padding: 20, paddingBottom: 40,
    borderTopWidth: 1, borderTopColor: '#1c1c1c',
  },
  coordText: { fontSize: 11, fontFamily: FF, color: '#555', textAlign: 'center', marginBottom: 10 },
  saveBtn: {
    backgroundColor: GOLD, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  saveBtnOff:  { opacity: 0.35 },
  saveBtnText: { fontSize: 14, fontFamily: FFB, color: '#000', letterSpacing: 0.5 },
});
