import { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Image,
} from 'react-native';
import MapView, { Marker, Polyline, Polygon } from 'react-native-maps';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { titanLogo } from '../../../src/lib/assets';

const GOLD    = '#D4AF37'; // StyleSheet fallback
const GREEN   = '#4ade80';
const RED     = '#f87171';
const OVERLAY = 'rgba(0,0,0,0.85)';
const FF      = 'JUSTSans';
const FFB     = 'JUSTSans-ExBold';

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
interface OsmFeature { id: number; golfType: string; coords: { latitude: number; longitude: number }[] }

const GOLF_COLORS: Record<string, { fill: string; stroke: string }> = {
  fairway:      { fill: 'rgba(60,140,30,0.5)',   stroke: 'rgba(60,140,30,0.7)' },
  green:        { fill: 'rgba(40,200,60,0.65)',  stroke: 'rgba(40,200,60,0.85)' },
  bunker:       { fill: 'rgba(230,205,120,0.75)',stroke: 'rgba(190,165,70,0.9)' },
  water_hazard: { fill: 'rgba(30,130,255,0.5)',  stroke: 'rgba(30,130,255,0.75)' },
  lateral_water_hazard: { fill: 'rgba(30,130,255,0.45)', stroke: 'rgba(30,130,255,0.7)' },
  tee:          { fill: 'rgba(80,170,80,0.5)',   stroke: 'rgba(80,170,80,0.7)' },
  rough:        { fill: 'rgba(50,100,20,0.25)',  stroke: 'transparent' },
  path:         { fill: 'rgba(180,170,150,0.3)', stroke: 'rgba(150,140,120,0.5)' },
};

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

const DEFAULT_CLUBS: [string, number][] = [
  ['Driver',250],['3W',230],['5W',210],['4i',185],['5i',175],
  ['6i',165],['7i',155],['8i',145],['9i',135],['PW',120],['GW',105],['SW',90],['LW',75],
];

function recommendClub(yards: number | null, avgs: Record<string, number>): { club: string; dist: number } | null {
  if (yards === null) return null;
  const table: [string, number][] = Object.keys(avgs).length > 0
    ? (Object.entries(avgs) as [string, number][]).sort((a, b) => b[1] - a[1])
    : DEFAULT_CLUBS;
  let best = table[0];
  let bestDiff = Math.abs(table[0][1] - yards);
  for (const entry of table) {
    const diff = Math.abs(entry[1] - yards);
    if (diff < bestDiff) { bestDiff = diff; best = entry; }
  }
  return { club: best[0], dist: best[1] };
}

export default function RangefinderScreen() {
  const { courseName: pCourse, holeNumber: pHole } = useLocalSearchParams<{ courseName?: string; holeNumber?: string }>();
  const router = useRouter();
  const dc = useDynamicColors();
  const { localLogo, logoUrl } = useSocietyTheme();

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

  const [clubAvgs, setClubAvgs] = useState<Record<string, number>>({});
  const [osmFeatures, setOsmFeatures] = useState<OsmFeature[]>([]);
  const [osmLoading, setOsmLoading] = useState(false);

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

  // ── Fetch OSM golf features for course ───────────────────────────
  useEffect(() => {
    if (!selectedCourse) return;
    setOsmFeatures([]);
    setOsmLoading(true);

    // Strip trailing "Golf Club/Course/Links" for a broader name match
    const term = selectedCourse.replace(/\s*(golf\s*)?(club|course|links|park)?\s*$/i, '').trim();

    // Try name-based area search first; also include bbox if we have coordinates
    const lats: number[] = [], lngs: number[] = [];
    holes.forEach(h => {
      if (h.green_lat) lats.push(h.green_lat);
      if (h.front_lat) lats.push(h.front_lat);
      if (h.back_lat)  lats.push(h.back_lat);
      if (h.green_lng) lngs.push(h.green_lng);
      if (h.front_lng) lngs.push(h.front_lng);
      if (h.back_lng)  lngs.push(h.back_lng);
    });

    let query: string;
    if (lats.length > 0) {
      const pad = 0.012;
      const s = Math.min(...lats) - pad, n = Math.max(...lats) + pad;
      const w = Math.min(...lngs) - pad, e = Math.max(...lngs) + pad;
      query = `[out:json][timeout:25];(way[golf=fairway](${s},${w},${n},${e});way[golf=green](${s},${w},${n},${e});way[golf=bunker](${s},${w},${n},${e});way[golf=water_hazard](${s},${w},${n},${e});way[golf=lateral_water_hazard](${s},${w},${n},${e});way[golf=tee](${s},${w},${n},${e});way[golf=rough](${s},${w},${n},${e}););out geom;`;
    } else {
      // No coordinates — search by name
      query = `[out:json][timeout:25];(relation[name~"${term}",i][leisure=golf_course];way[name~"${term}",i][leisure=golf_course];)->.course;way[golf~"fairway|green|bunker|water_hazard|tee|rough"](area.course);out geom;`;
    }

    fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    })
      .then(r => r.json())
      .then(d => {
        const features: OsmFeature[] = (d.elements ?? [])
          .filter((el: any) => el.geometry?.length > 2 && el.tags?.golf)
          .map((el: any) => ({
            id: el.id,
            golfType: el.tags.golf as string,
            coords: el.geometry.map((g: any) => ({ latitude: g.lat, longitude: g.lon })),
          }));
        setOsmFeatures(features);
      })
      .catch(() => {})
      .finally(() => setOsmLoading(false));
  }, [selectedCourse, holes]);

  // ── Load player's club averages for recommendations ───────────────
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: player } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (!player) return;
      const { data: shots } = await supabase.from('range_shots').select('club,carry').eq('player_id', (player as any).id).not('carry', 'is', null);
      if (!shots) return;
      const byClub: Record<string, number[]> = {};
      (shots as { club: string; carry: number }[]).forEach(s => {
        if (!byClub[s.club]) byClub[s.club] = [];
        byClub[s.club].push(s.carry);
      });
      const avgs: Record<string, number> = {};
      Object.entries(byClub).forEach(([club, vals]) => {
        avgs[club] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      });
      setClubAvgs(avgs);
    })();
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
      <View style={[s.root, { backgroundColor: dc.bg }]}>
        <StatusBar style="light" />

        <View style={[s.selHeader, { backgroundColor: dc.bg }]}>
          <TouchableOpacity onPress={() => router.back()} style={s.headerSide} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={24} color={dc.gold} />
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Image source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)} style={s.headerLogo} resizeMode="contain" />
            <Text style={s.headerSub}>RANGEFINDER</Text>
          </View>
          <View style={s.headerSide} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 8 }} showsVerticalScrollIndicator={false}>
          <Text style={[s.sectionLabel, { color: dc.cardText }]}>SELECT COURSE</Text>
          {courses.map(c => (
            <TouchableOpacity
              key={c}
              style={[s.courseCard, { backgroundColor: dc.card, borderColor: dc.border }]}
              onPress={() => { setSelected(c); setHoleIdx(0); }}
              activeOpacity={0.8}
            >
              <Text style={[s.courseName, { color: dc.cardText }]}>{c}</Text>
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
  const clubRec = recommendClub(dActive, clubAvgs);

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* ── Map area ── */}
      <View style={s.mapContainer}>
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
            {/* OSM course polygons — rendered back-to-front */}
            {['rough','fairway','tee','green','bunker','lateral_water_hazard','water_hazard'].flatMap(type =>
              osmFeatures
                .filter(f => f.golfType === type)
                .map(f => {
                  const c = GOLF_COLORS[type] ?? GOLF_COLORS.fairway;
                  return (
                    <Polygon
                      key={f.id}
                      coordinates={f.coords}
                      fillColor={c.fill}
                      strokeColor={c.stroke}
                      strokeWidth={1}
                    />
                  );
                })
            )}

            {pins.front && (
              <Marker
                coordinate={{ latitude: pins.front.lat, longitude: pins.front.lng }}
                draggable anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}
                onDragEnd={e => setPins(p => ({ ...p, front: { lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude } }))}
              >
                <View style={[s.pinDot, { backgroundColor: '#fff' }]}>
                  <Text style={s.pinDotText}>F</Text>
                </View>
              </Marker>
            )}
            {pins.centre && (
              <Marker
                coordinate={{ latitude: pins.centre.lat, longitude: pins.centre.lng }}
                draggable anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}
                onDragEnd={e => setPins(p => ({ ...p, centre: { lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude } }))}
              >
                <View style={[s.pinDot, { backgroundColor: GOLD }]}>
                  <Ionicons name="flag" size={13} color="#000" />
                </View>
              </Marker>
            )}
            {pins.back && (
              <Marker
                coordinate={{ latitude: pins.back.lat, longitude: pins.back.lng }}
                draggable anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}
                onDragEnd={e => setPins(p => ({ ...p, back: { lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude } }))}
              >
                <View style={[s.pinDot, { backgroundColor: '#fff' }]}>
                  <Text style={s.pinDotText}>B</Text>
                </View>
              </Marker>
            )}
            {player && pins[activeTarget] && (
              <Polyline
                coordinates={[
                  { latitude: player.lat, longitude: player.lng },
                  { latitude: pins[activeTarget]!.lat, longitude: pins[activeTarget]!.lng },
                ]}
                strokeColor="#fff"
                strokeWidth={1.5}
                lineDashPattern={[6, 4]}
              />
            )}
          </MapView>
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#111' }]} />
        )}

        {/* Distance panel — floating top-left, no card */}
        <View style={s.distPanel}>
          {(['front', 'centre', 'back'] as Target[]).map(t => {
            const d = t === 'front' ? dFront : t === 'centre' ? dCentre : dBack;
            const active = activeTarget === t;
            return (
              <TouchableOpacity key={t} onPress={() => setTarget(t)} activeOpacity={0.7} style={s.distRow}>
                <Text style={[s.distArrow, { color: active ? GOLD : 'rgba(255,255,255,0.45)' }]}>
                  {t === 'front' ? '↑' : t === 'centre' ? '●' : '↓'}
                </Text>
                <Text style={[s.distNum, {
                  color: active ? GOLD : '#fff',
                  fontSize: active ? 18 : 14,
                  opacity: active ? 1 : 0.55,
                }]}>
                  {d !== null ? d : '—'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Back button — top left */}
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>

        {/* GPS dot — top right */}
        <View style={s.gpsChip}>
          <View style={[s.gpsDot, { backgroundColor: gpsOk ? GREEN : '#f59e0b' }]} />
          <Text style={s.gpsText}>GPS</Text>
        </View>

        {/* Club chip — bottom centre of map */}
        {clubRec && (
          <View style={s.clubChip}>
            <Ionicons name="golf-outline" size={13} color={GOLD} />
            <Text style={s.clubChipText}>{clubRec.club}</Text>
            <Text style={s.clubChipYds}>· {clubRec.dist} yds</Text>
          </View>
        )}

        {/* Wind compass — bottom left of map */}
        {weather && (
          <View style={s.compassCircle}>
            <View style={[s.compassNeedle, { transform: [{ rotate: `${weather.windDir}deg` }] }]}>
              <View style={s.needleHead} />
              <View style={s.needleTail} />
            </View>
            <View style={s.compassCentre} />
            <Text style={s.compassLabel}>{cardinal(weather.windDir)}</Text>
          </View>
        )}

        {/* Elevation — bottom right of map */}
        {elev && (
          <View style={s.elevBadge}>
            <Ionicons name={elev.diff > 0 ? 'trending-up' : 'trending-down'} size={14} color={elev.diff > 0 ? RED : GREEN} />
            <Text style={[s.elevText, { color: elev.diff > 0 ? RED : GREEN }]}>{elev.adjusted} adj</Text>
          </View>
        )}
      </View>

      {/* ── Bottom info section — solid black, not overlaid ── */}
      <View style={s.bottomSection}>
        <View style={s.holeRow}>
          <TouchableOpacity
            style={s.holeArrow}
            onPress={() => setHoleIdx(i => Math.max(0, i - 1))}
            disabled={holeIdx === 0}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={30} color={holeIdx === 0 ? '#333' : '#fff'} />
          </TouchableOpacity>

          <TouchableOpacity style={s.holeInfoBlock} onPress={() => setSelected(null)} activeOpacity={0.7}>
            <Text style={s.holeNum}>{hole ? String(hole.hole_number).padStart(2, '0') : '—'}</Text>
            <View style={s.holeMetas}>
              <Text style={s.holePar}>Par {hole?.par ?? '—'}</Text>
              <Text style={s.holeHcp}>Handicap {hole?.stroke_index ?? '—'}</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.holeArrow}
            onPress={() => setHoleIdx(i => Math.min(holes.length - 1, i + 1))}
            disabled={holeIdx >= holes.length - 1}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-forward" size={30} color={holeIdx >= holes.length - 1 ? '#333' : '#fff'} />
          </TouchableOpacity>
        </View>

        <Text style={s.courseNameText} numberOfLines={1}>{selectedCourse}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },

  // ── Course selector ──────────────────────────────────────────────
  headerSide:   { width: 40, alignItems: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', gap: 2 },
  headerLogo:   { width: 28, height: 28 },
  headerSub:    { fontFamily: FFB, fontSize: 9, color: GOLD, letterSpacing: 2.5 },
  selHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: '#000',
  },
  sectionLabel: { fontFamily: FFB, fontSize: 10, color: '#fff', letterSpacing: 2, marginBottom: 4, marginTop: 4 },
  courseCard:   { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 16, flexDirection: 'row', alignItems: 'center' },
  courseName:   { fontFamily: FFB, fontSize: 15, color: '#fff', flex: 1 },
  empty:        { fontFamily: FFB, fontSize: 14, color: '#fff', textAlign: 'center', paddingTop: 40 },

  // ── Map container ────────────────────────────────────────────────
  mapContainer: { flex: 1 },

  // ── Pin dots on map ──────────────────────────────────────────────
  pinDot: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.8, shadowRadius: 4,
  },
  pinDotText: { fontFamily: FFB, fontSize: 12, color: '#000' },

  // ── Floating distance panel ──────────────────────────────────────
  distPanel: {
    position: 'absolute', left: 14, top: 60,
    backgroundColor: 'rgba(0,0,0,0.68)',
    borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 6, paddingHorizontal: 10,
  },
  distRow:  { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 1 },
  distArrow: {
    fontFamily: FFB, fontSize: 13, width: 16, textAlign: 'center',
    color: 'rgba(255,255,255,0.6)',
  },
  distNum: {
    fontFamily: FFB,
  },

  // ── Back button ──────────────────────────────────────────────────
  backBtn: {
    position: 'absolute', top: 56, right: 14,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },

  // ── GPS chip ─────────────────────────────────────────────────────
  gpsChip: {
    position: 'absolute', top: 56, right: 58,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 14, paddingHorizontal: 8, paddingVertical: 5,
  },
  gpsDot:  { width: 7, height: 7, borderRadius: 4 },
  gpsText: { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 1 },

  // ── Club chip ────────────────────────────────────────────────────
  clubChip: {
    position: 'absolute', bottom: 16, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    marginHorizontal: 80, borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.4)',
    paddingHorizontal: 14, paddingVertical: 7,
  },
  clubChipText: { fontFamily: FFB, fontSize: 15, color: GOLD },
  clubChipYds:  { fontFamily: FFB, fontSize: 11, color: 'rgba(255,255,255,0.5)' },

  // ── Wind compass circle ──────────────────────────────────────────
  compassCircle: {
    position: 'absolute', bottom: 16, left: 14,
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderWidth: 1.5, borderColor: GOLD,
    alignItems: 'center', justifyContent: 'center',
  },
  compassNeedle: {
    position: 'absolute', width: 2, height: 32,
    alignItems: 'center', justifyContent: 'space-between',
  },
  needleHead:    { width: 7, height: 7, borderRadius: 4, backgroundColor: GOLD },
  needleTail:    { width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
  compassCentre: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#fff' },
  compassLabel:  { position: 'absolute', bottom: 4, fontFamily: FFB, fontSize: 8, color: '#fff', letterSpacing: 1 },

  // ── Elevation badge ──────────────────────────────────────────────
  elevBadge: {
    position: 'absolute', bottom: 16, right: 14,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6,
  },
  elevText: { fontFamily: FFB, fontSize: 11 },


  // ── Bottom info section ──────────────────────────────────────────
  bottomSection: {
    backgroundColor: '#000',
    borderTopWidth: 1, borderTopColor: '#1a1a1a',
    paddingTop: 12, paddingBottom: 30,
  },
  holeRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 4,
  },
  holeArrow: {
    width: 52, alignItems: 'center', justifyContent: 'center', paddingVertical: 8,
  },
  holeInfoBlock: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 12,
  },
  holeNum: {
    fontFamily: FFB, fontSize: 48, color: '#fff',
    lineHeight: 52, letterSpacing: -1,
  },
  holeMetas: { justifyContent: 'center', gap: 2 },
  holePar:   { fontFamily: FFB, fontSize: 15, color: '#fff' },
  holeHcp:   { fontFamily: FFB, fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  courseNameText: {
    fontFamily: FFB, fontSize: 11, color: 'rgba(255,255,255,0.35)',
    textAlign: 'center', marginTop: 6, letterSpacing: 0.5,
  },
});
