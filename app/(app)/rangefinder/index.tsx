import { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Dimensions,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';

const GREEN = '#4ade80';
const { height: SCREEN_H } = Dimensions.get('window');

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

  const [player, setPlayer] = useState<Pin | null>(null);
  const [gpsOk, setGpsOk]   = useState(false);

  const [courses, setCourses]           = useState<string[]>([]);
  const [selectedCourse, setSelected]   = useState<string | null>(pCourse ?? null);
  const [holes, setHoles]               = useState<HoleRow[]>([]);
  const [holeIdx, setHoleIdx]           = useState(pHole ? parseInt(pHole) - 1 : 0);

  const [pins, setPins]           = useState<Pins>({ front: null, centre: null, back: null });
  const [activeTarget, setTarget] = useState<Target>('centre');

  const [weather, setWeather]     = useState<Weather | null>(null);
  const [elev, setElev]           = useState<ElevInfo | null>(null);
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
    // Approximate front/back by ±15 yds (0.000137°) if not mapped yet
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

  // ── Derived distances ─────────────────────────────────────────────
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

  // ── Course selector screen ────────────────────────────────────────
  if (!selectedCourse) {
    return (
      <View style={s.container}>
        <StatusBar style="light" />
        <View style={s.selectorHeader}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
            <Text style={s.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={s.selectorTitle}>RANGEFINDER</Text>
          <View style={{ width: 60 }} />
        </View>
        <ScrollView contentContainerStyle={s.selectorScroll}>
          <Text style={s.sectionLabel}>SELECT COURSE</Text>
          {courses.map(c => (
            <TouchableOpacity
              key={c} style={s.selectorCard}
              onPress={() => { setSelected(c); setHoleIdx(0); }}
              activeOpacity={0.8}
            >
              <Text style={s.selectorName}>{c}</Text>
              <Text style={s.selectorArrow}>›</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ── Main rangefinder ──────────────────────────────────────────────
  return (
    <View style={s.container}>
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
              <View style={[s.pinMarker, { borderColor: '#22c55e' }]}>
                <Text style={s.pinMarkerText}>F</Text>
              </View>
            </Marker>
          )}
          {pins.centre && (
            <Marker
              coordinate={{ latitude: pins.centre.lat, longitude: pins.centre.lng }}
              draggable anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}
              onDragEnd={e => setPins(p => ({ ...p, centre: { lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude } }))}
            >
              <View style={[s.pinMarker, { borderColor: colors.gold }]}>
                <Text style={[s.pinMarkerText, { color: colors.gold }]}>C</Text>
              </View>
            </Marker>
          )}
          {pins.back && (
            <Marker
              coordinate={{ latitude: pins.back.lat, longitude: pins.back.lng }}
              draggable anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}
              onDragEnd={e => setPins(p => ({ ...p, back: { lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude } }))}
            >
              <View style={[s.pinMarker, { borderColor: '#ef4444' }]}>
                <Text style={[s.pinMarkerText, { color: '#ef4444' }]}>B</Text>
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
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={{ minWidth: 44 }}>
          <Text style={s.backText}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setSelected(null)} activeOpacity={0.7} style={s.headerCenter}>
          <Text style={s.headerHole}>
            {hole ? `HOLE ${hole.hole_number} · PAR ${hole.par}` : 'SELECT HOLE'}
          </Text>
          <Text style={s.headerCourse}>{selectedCourse} ↕</Text>
        </TouchableOpacity>
        <View style={s.gpsChip}>
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
              key={t} style={[s.hudCol, active && s.hudColActive]}
              onPress={() => setTarget(t)} activeOpacity={0.7}
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
            <Text
              style={[s.windArrow, { transform: [{ rotate: `${(weather.windDir + 180) % 360}deg` }] }]}
            >↑</Text>
            <Text style={s.infoText}>{cardinal(weather.windDir)} {weather.windSpeed} mph</Text>
            <View style={s.infoDot} />
            <Text style={s.infoText}>{weather.temp}°C</Text>
          </>
        ) : (
          <Text style={s.infoText}>Fetching weather…</Text>
        )}
        {elev !== null && (
          <>
            <View style={s.infoDot} />
            <Text style={[s.infoText, { color: elev.diff > 0 ? '#f87171' : GREEN }]}>
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

      {/* Bottom bar — hole nav + measure */}
      <View style={s.bottomBar}>
        <TouchableOpacity
          style={[s.holeBtn, holeIdx === 0 && s.holeBtnOff]}
          onPress={() => setHoleIdx(i => Math.max(0, i - 1))}
          disabled={holeIdx === 0} activeOpacity={0.7}
        >
          <Text style={s.holeBtnText}>‹ H{holes[holeIdx - 1]?.hole_number ?? '—'}</Text>
        </TouchableOpacity>

        <View style={s.measureBox}>
          <Text style={s.measureDist}>
            {dActive !== null ? `${dActive}` : '—'}
          </Text>
          <Text style={s.measureYds}>yds to {activeTarget}</Text>
        </View>

        <TouchableOpacity
          style={[s.holeBtn, holeIdx >= holes.length - 1 && s.holeBtnOff]}
          onPress={() => setHoleIdx(i => Math.min(holes.length - 1, i + 1))}
          disabled={holeIdx >= holes.length - 1} activeOpacity={0.7}
        >
          <Text style={s.holeBtnText}>H{holes[holeIdx + 1]?.hole_number ?? '—'} ›</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const OVERLAY = 'rgba(0,0,0,0.82)';

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  // ── Course selector ──────────────────────────────────────────────
  selectorHeader: {
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bg,
  },
  selectorTitle: { fontSize: fonts.sm, fontWeight: '800', color: colors.white, letterSpacing: 2 },
  selectorScroll: { padding: spacing.lg },
  sectionLabel: { fontSize: 9, fontWeight: '800', color: colors.textMuted, letterSpacing: 2, marginBottom: spacing.sm },
  selectorCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.xs,
  },
  selectorName: { flex: 1, fontSize: fonts.md, fontWeight: '700', color: colors.white },
  selectorArrow: { fontSize: fonts.xl, color: colors.textMuted },

  backText: { fontSize: fonts.xl, color: colors.gold, fontWeight: '600' },

  // ── Header overlay ───────────────────────────────────────────────
  header: {
    paddingTop: 56, paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: OVERLAY,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerHole: { fontSize: fonts.sm, fontWeight: '900', color: colors.white, letterSpacing: 1.5 },
  headerCourse: { fontSize: fonts.xs, color: colors.textMuted, marginTop: 1 },
  gpsChip: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 44, justifyContent: 'flex-end' },
  gpsDot: { width: 8, height: 8, borderRadius: 4 },
  gpsText: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted },

  // ── Distance HUD ─────────────────────────────────────────────────
  hud: {
    flexDirection: 'row',
    backgroundColor: OVERLAY,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  hudCol: {
    flex: 1, alignItems: 'center', paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  hudColActive: {
    backgroundColor: 'rgba(74,222,128,0.08)',
    borderWidth: 1, borderColor: 'rgba(74,222,128,0.3)',
  },
  hudLabel: { fontSize: 9, fontWeight: '800', color: '#555', letterSpacing: 1.5, marginBottom: 2 },
  hudNum: { fontSize: 52, fontWeight: '900', color: '#555', lineHeight: 58 },
  hudYds: { fontSize: fonts.xs, fontWeight: '700', color: '#555', marginTop: 1 },

  // ── Info strip ───────────────────────────────────────────────────
  infoStrip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: OVERLAY,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  windArrow: { fontSize: fonts.md, color: colors.white, fontWeight: '900' },
  infoText: { fontSize: fonts.xs, fontWeight: '600', color: '#aaa' },
  infoDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#444' },

  // ── Pin markers on map ───────────────────────────────────────────
  pinMarker: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },
  pinMarkerText: { fontSize: fonts.xs, fontWeight: '900', color: '#22c55e' },

  // ── Bottom bar ───────────────────────────────────────────────────
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: OVERLAY,
    paddingHorizontal: spacing.md,
    paddingBottom: 36, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
  },
  holeBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, minWidth: 60 },
  holeBtnOff: { opacity: 0.25 },
  holeBtnText: { fontSize: fonts.sm, fontWeight: '700', color: colors.gold, textAlign: 'center' },
  measureBox: { flex: 1, alignItems: 'center' },
  measureDist: { fontSize: 38, fontWeight: '900', color: GREEN, lineHeight: 42 },
  measureYds: { fontSize: fonts.xs, fontWeight: '600', color: '#888', marginTop: 1 },
});
