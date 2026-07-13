import { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Image,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';

const GOLD    = '#D4AF37';
const GREEN   = '#4ade80';
const RED     = '#f87171';
const OVERLAY = 'rgba(0,0,0,0.85)';
const FF      = 'JUSTSans';
const FFB     = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

type Target = 'front' | 'centre' | 'back';
interface Pin { lat: number; lng: number }
interface Pins { front: Pin | null; centre: Pin | null; back: Pin | null }
interface HoleRow {
  hole_number: number; par: number; stroke_index: number;
  front_lat: number | null; front_lng: number | null;
  green_lat: number | null; green_lng: number | null;
  back_lat: number | null; back_lng: number | null;
}
interface Weather { windSpeed: number; windDir: number; temp: number }
interface ElevInfo { diff: number; adjusted: number }

function haversineYards(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371000;
  const φ1 = la1 * Math.PI / 180, φ2 = la2 * Math.PI / 180;
  const Δφ = (la2 - la1) * Math.PI / 180, Δλ = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.09361);
}

function cardinal(deg: number): string {
  return ['N','NE','E','SE','S','SW','W','NW'][Math.round(deg / 45) % 8];
}

export default function RangefinderScreen() {
  const { courseName: pCourse, holeNumber: pHole } = useLocalSearchParams<{ courseName?: string; holeNumber?: string }>();
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [player, setPlayer] = useState<Pin | null>(null);
  const [gpsOk, setGpsOk]   = useState(false);

  const [courses, setCourses]         = useState<string[]>([]);
  const [selectedCourse, setSelected] = useState<string | null>(pCourse ?? null);
  const [holes, setHoles]             = useState<HoleRow[]>([]);
  const [holeIdx, setHoleIdx]         = useState(pHole ? parseInt(pHole) - 1 : 0);

  const [pins, setPins]           = useState<Pins>({ front: null, centre: null, back: null });
  const [activeTarget, setTarget] = useState<Target>('centre');

  const [weather, setWeather]         = useState<Weather | null>(null);
  const [elev, setElev]               = useState<ElevInfo | null>(null);
  const [elevLoading, setElevLoading] = useState(false);

  const weatherFetched = useRef(false);
  const mapRef = useRef<MapView>(null);
  const hole = holes[holeIdx] ?? null;

  // ── GPS ──────────────────────────────────────────────────────────
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 2 },
        loc => {
          setPlayer({ lat: loc.coords.latitude, lng: loc.coords.longitude });
          setGpsOk(true);
        },
      );
    })();
    return () => { sub?.remove(); };
  }, []);

  // ── Load course list ──────────────────────────────────────────────
  useEffect(() => {
    if (pCourse) return;
    supabase.from('course_holes').select('course_name').then(({ data }) => {
      if (data) setCourses([...new Set((data as any[]).map(r => r.course_name))].sort());
    });
  }, []);

  // ── Load holes for selected course ───────────────────────────────
  useEffect(() => {
    if (!selectedCourse) return;
    supabase.from('course_holes')
      .select('hole_number,par,stroke_index,front_lat,front_lng,green_lat,green_lng,back_lat,back_lng')
      .eq('course_name', selectedCourse)
      .order('hole_number')
      .then(({ data }) => { if (data) setHoles(data as HoleRow[]); });
  }, [selectedCourse]);

  // ── Compute pins from hole row ────────────────────────────────────
  useEffect(() => {
    if (!hole) return;
    const centre = hole.green_lat && hole.green_lng
      ? { lat: hole.green_lat, lng: hole.green_lng } : null;
    const front = hole.front_lat && hole.front_lng
      ? { lat: hole.front_lat, lng: hole.front_lng }
      : centre ? { lat: centre.lat - 0.000137, lng: centre.lng } : null;
    const back = hole.back_lat && hole.back_lng
      ? { lat: hole.back_lat, lng: hole.back_lng }
      : centre ? { lat: centre.lat + 0.000137, lng: centre.lng } : null;
    setPins({ front, centre, back });
    setElev(null);
  }, [hole?.hole_number, selectedCourse]);

  // ── Fit map when hole changes ─────────────────────────────────────
  useEffect(() => {
    const centre = pins.centre;
    if (!mapRef.current || !centre) return;
    const coords = player
      ? [{ latitude: player.lat, longitude: player.lng }, { latitude: centre.lat, longitude: centre.lng }]
      : [{ latitude: centre.lat, longitude: centre.lng }];
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: { top: 80, right: 60, bottom: 80, left: 60 }, animated: true,
    });
  }, [hole?.hole_number]);

  // ── Weather (once GPS acquired) ───────────────────────────────────
  useEffect(() => {
    if (!player || weatherFetched.current) return;
    weatherFetched.current = true;
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${player.lat.toFixed(4)}&longitude=${player.lng.toFixed(4)}&current_weather=true&wind_speed_unit=mph&temperature_unit=celsius`,
    )
      .then(r => r.json())
      .then(d => {
        const cw = d.current_weather;
        if (cw) setWeather({ windSpeed: Math.round(cw.windspeed), windDir: cw.winddirection, temp: Math.round(cw.temperature) });
      })
      .catch(() => {});
  }, [player]);

  // ── Elevation (when player + pin known) ──────────────────────────
  useEffect(() => {
    const centre = pins.centre;
    if (!player || !centre || elevLoading) return;
    setElevLoading(true);
    fetch('https://api.open-elevation.com/api/v1/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: [
        { latitude: player.lat, longitude: player.lng },
        { latitude: centre.lat, longitude: centre.lng },
      ]}),
    })
      .then(r => r.json())
      .then(d => {
        const res = d.results;
        if (res?.length === 2) {
          const diff = Math.round(res[1].elevation - res[0].elevation);
          const baseDist = haversineYards(player.lat, player.lng, centre.lat, centre.lng);
          setElev({ diff, adjusted: Math.round(baseDist + diff * 1.09) });
        }
      })
      .catch(() => {})
      .finally(() => setElevLoading(false));
  }, [pins.centre?.lat, pins.centre?.lng, player?.lat, player?.lng]);

  const distTo = (t: Target) => {
    const p = pins[t];
    return player && p ? haversineYards(player.lat, player.lng, p.lat, p.lng) : null;
  };
  const dFront  = distTo('front');
  const dCentre = distTo('centre');
  const dBack   = distTo('back');
  const dActive = distTo(activeTarget);

  const centre = pins.centre;
  const initialRegion = centre
    ? { latitude: centre.lat, longitude: centre.lng, latitudeDelta: 0.004, longitudeDelta: 0.004 }
    : undefined;

  // ── Course selector ───────────────────────────────────────────────
  if (!selectedCourse || !fontsLoaded) {
    return (
      <View style={s.root}>
        <StatusBar style="light" />

        <View style={s.selHeader}>
          <TouchableOpacity onPress={() => router.back()} style={s.headerSide} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
            <Text style={s.headerSub}>RANGEFINDER</Text>
          </View>
          <View style={s.headerSide} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 8 }} showsVerticalScrollIndicator={false}>
          <Text style={s.sectionLabel}>SELECT COURSE</Text>
          {courses.map(c => (
            <TouchableOpacity
              key={c}
              style={s.courseCard}
              onPress={() => { setSelected(c); setHoleIdx(0); }}
              activeOpacity={0.8}
            >
              <Text style={s.courseName}>{c}</Text>
              <Ionicons name="chevron-forward" size={18} color={GOLD} />
            </TouchableOpacity>
          ))}
          {courses.length === 0 && (
            <Text style={s.empty}>No courses available</Text>
          )}
        </ScrollView>
      </View>
    );
  }

  // ── Main rangefinder ──────────────────────────────────────────────
  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* Map — full screen background */}
      {initialRegion ? (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          mapType="satellite"
          initialRegion={initialRegion}
          showsUserLocation={gpsOk}
          showsMyLocationButton={false}
          pitchEnabled={false}
          rotateEnabled={false}
        >
          {pins.front && (
            <Marker
              coordinate={{ latitude: pins.front.lat, longitude: pins.front.lng }}
              draggable anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}
              onDragEnd={e => setPins(p => ({ ...p, front: { lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude } }))}
            >
              <View style={[s.pinMarker, { borderColor: GREEN }]}>
                <Text style={[s.pinMarkerText, { color: GREEN }]}>F</Text>
              </View>
            </Marker>
          )}
          {pins.centre && (
            <Marker
              coordinate={{ latitude: pins.centre.lat, longitude: pins.centre.lng }}
              draggable anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}
              onDragEnd={e => setPins(p => ({ ...p, centre: { lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude } }))}
            >
              <View style={[s.pinMarker, { borderColor: GOLD }]}>
                <Text style={[s.pinMarkerText, { color: GOLD }]}>C</Text>
              </View>
            </Marker>
          )}
          {pins.back && (
            <Marker
              coordinate={{ latitude: pins.back.lat, longitude: pins.back.lng }}
              draggable anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}
              onDragEnd={e => setPins(p => ({ ...p, back: { lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude } }))}
            >
              <View style={[s.pinMarker, { borderColor: RED }]}>
                <Text style={[s.pinMarkerText, { color: RED }]}>B</Text>
              </View>
            </Marker>
          )}
          {player && pins[activeTarget] && (
            <Polyline
              coordinates={[
                { latitude: player.lat, longitude: player.lng },
                { latitude: pins[activeTarget]!.lat, longitude: pins[activeTarget]!.lng },
              ]}
              strokeColor={GREEN}
              strokeWidth={2}
              lineDashPattern={[10, 5]}
            />
          )}
        </MapView>
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />
      )}

      {/* Header overlay */}
      <View style={s.mapHeader}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerSide} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setSelected(null)} activeOpacity={0.7} style={s.headerCenter}>
          <Text style={s.mapHole}>
            {hole ? `HOLE ${hole.hole_number}  ·  PAR ${hole.par}` : 'SELECT HOLE'}
          </Text>
          <Text style={s.mapCourse}>{selectedCourse}  ↕</Text>
        </TouchableOpacity>
        <View style={[s.gpsChip, s.headerSide, { justifyContent: 'flex-end' }]}>
          <View style={[s.gpsDot, { backgroundColor: gpsOk ? GREEN : '#f59e0b' }]} />
          <Text style={s.gpsText}>GPS</Text>
        </View>
      </View>

      {/* Distance HUD */}
      <View style={s.hud}>
        {(['front', 'centre', 'back'] as Target[]).map(t => {
          const d = t === 'front' ? dFront : t === 'centre' ? dCentre : dBack;
          const active = activeTarget === t;
          return (
            <TouchableOpacity
              key={t}
              style={[s.hudCol, active && s.hudColActive]}
              onPress={() => setTarget(t)}
              activeOpacity={0.7}
            >
              <Text style={[s.hudLabel, active && { color: GREEN }]}>{t.toUpperCase()}</Text>
              <Text style={[s.hudNum, active && { color: GREEN }]}>
                {d !== null ? d : '—'}
              </Text>
              <Text style={[s.hudYds, active && { color: GREEN }]}>yds</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Info strip — weather + elevation */}
      <View style={s.infoStrip}>
        {weather ? (
          <>
            <Text style={[s.windArrow, { transform: [{ rotate: `${(weather.windDir + 180) % 360}deg` }] }]}>↑</Text>
            <Text style={s.infoText}>{cardinal(weather.windDir)} {weather.windSpeed} mph</Text>
            <View style={s.infoDot} />
            <Text style={s.infoText}>{weather.temp}°C</Text>
          </>
        ) : (
          <Text style={s.infoText}>Acquiring weather…</Text>
        )}
        {elev !== null && (
          <>
            <View style={s.infoDot} />
            <Text style={[s.infoText, { color: elev.diff > 0 ? RED : GREEN }]}>
              {elev.diff > 0 ? '▲' : '▼'} {Math.abs(elev.diff)}m · {elev.adjusted} adj
            </Text>
          </>
        )}
        {elevLoading && !elev && (
          <>
            <View style={s.infoDot} />
            <Text style={s.infoText}>slope…</Text>
          </>
        )}
      </View>

      {/* Bottom bar — hole nav + active distance */}
      <View style={s.bottomBar}>
        <TouchableOpacity
          style={[s.holeBtn, holeIdx === 0 && s.holeBtnOff]}
          onPress={() => setHoleIdx(i => Math.max(0, i - 1))}
          disabled={holeIdx === 0}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={16} color={holeIdx === 0 ? '#333' : GOLD} />
          <Text style={[s.holeBtnText, holeIdx === 0 && { color: '#333' }]}>
            H{holes[holeIdx - 1]?.hole_number ?? '—'}
          </Text>
        </TouchableOpacity>

        <View style={s.measureBox}>
          <Text style={s.measureDist}>{dActive !== null ? `${dActive}` : '—'}</Text>
          <Text style={s.measureYds}>yds to {activeTarget}</Text>
        </View>

        <TouchableOpacity
          style={[s.holeBtn, s.holeBtnRight, holeIdx >= holes.length - 1 && s.holeBtnOff]}
          onPress={() => setHoleIdx(i => Math.min(holes.length - 1, i + 1))}
          disabled={holeIdx >= holes.length - 1}
          activeOpacity={0.7}
        >
          <Text style={[s.holeBtnText, holeIdx >= holes.length - 1 && { color: '#333' }]}>
            H{holes[holeIdx + 1]?.hole_number ?? '—'}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={holeIdx >= holes.length - 1 ? '#333' : GOLD} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },

  // ── Shared header ────────────────────────────────────────────────
  headerSide:   { width: 40, alignItems: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', gap: 2 },
  headerLogo:   { width: 28, height: 28 },
  headerSub:    { fontFamily: FF, fontSize: 9, color: GOLD, letterSpacing: 2.5 },

  // ── Course selector ──────────────────────────────────────────────
  selHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: '#000',
  },
  sectionLabel: { fontFamily: FF, fontSize: 10, color: '#555', letterSpacing: 2, marginBottom: 4, marginTop: 4 },
  courseCard:   { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 16, flexDirection: 'row', alignItems: 'center' },
  courseName:   { fontFamily: FFB, fontSize: 15, color: '#fff', flex: 1 },
  empty:        { fontFamily: FF, fontSize: 14, color: '#555', textAlign: 'center', paddingTop: 40 },

  // ── Map header overlay ───────────────────────────────────────────
  mapHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: OVERLAY,
  },
  mapHole:   { fontFamily: FFB, fontSize: 13, color: '#fff', letterSpacing: 1.5, textAlign: 'center' },
  mapCourse: { fontFamily: FF, fontSize: 11, color: '#666', marginTop: 2, textAlign: 'center' },
  gpsChip:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  gpsDot:    { width: 8, height: 8, borderRadius: 4 },
  gpsText:   { fontFamily: FFB, fontSize: 10, color: '#555', letterSpacing: 1 },

  // ── Distance HUD ─────────────────────────────────────────────────
  hud: {
    flexDirection: 'row',
    backgroundColor: OVERLAY,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  hudCol: {
    flex: 1, alignItems: 'center', paddingVertical: 8,
    borderRadius: 12,
  },
  hudColActive: {
    backgroundColor: 'rgba(74,222,128,0.08)',
    borderWidth: 1, borderColor: 'rgba(74,222,128,0.25)',
  },
  hudLabel: { fontFamily: FF, fontSize: 9, color: '#444', letterSpacing: 2, marginBottom: 2 },
  hudNum:   { fontFamily: FFB, fontSize: 52, color: '#444', lineHeight: 58 },
  hudYds:   { fontFamily: FF, fontSize: 11, color: '#444', marginTop: 1, letterSpacing: 1 },

  // ── Info strip ───────────────────────────────────────────────────
  infoStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: OVERLAY,
    paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  windArrow: { fontFamily: FFB, fontSize: 14, color: '#fff' },
  infoText:  { fontFamily: FF, fontSize: 11, color: '#888', letterSpacing: 0.5 },
  infoDot:   { width: 3, height: 3, borderRadius: 2, backgroundColor: '#333' },

  // ── Pin markers on map ───────────────────────────────────────────
  pinMarker: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },
  pinMarkerText: { fontFamily: FFB, fontSize: 11 },

  // ── Bottom bar ───────────────────────────────────────────────────
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: OVERLAY,
    paddingHorizontal: 16,
    paddingBottom: 36, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
  },
  holeBtn:      { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8, paddingVertical: 4, minWidth: 60 },
  holeBtnRight: { justifyContent: 'flex-end' },
  holeBtnOff:   { opacity: 0.3 },
  holeBtnText:  { fontFamily: FFB, fontSize: 13, color: GOLD },
  measureBox:   { flex: 1, alignItems: 'center' },
  measureDist:  { fontFamily: FFB, fontSize: 42, color: GREEN, lineHeight: 46 },
  measureYds:   { fontFamily: FF, fontSize: 11, color: '#666', marginTop: 1, letterSpacing: 1 },
});
