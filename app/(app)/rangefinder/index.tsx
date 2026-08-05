import { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Image, TextInput, Alert, ActivityIndicator,
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
import { ensureDb } from '../../../src/lib/localDb';
import { searchCourse, getCourseHoles, cleanCourseNameForSearch, GICourseResult, GIHoleData } from '../../../src/lib/golfIntelligence';

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
  tee_lat?: number | null; tee_lng?: number | null;
  yellow_yards?: number | null; white_yards?: number | null;
  blue_yards?: number | null; red_yards?: number | null;
}
interface Weather { windSpeed: number; windDir: number; temp: number }
interface ElevInfo { diffFt: number; adjustYards: number }
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

function bearingDeg(la1: number, lo1: number, la2: number, lo2: number): number {
  const φ1 = la1 * Math.PI / 180, φ2 = la2 * Math.PI / 180;
  const Δλ = (lo2 - lo1) * Math.PI / 180;
  return (Math.atan2(Math.sin(Δλ) * Math.cos(φ2), Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)) * 180 / Math.PI + 360) % 360;
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
  const { courseName: pCourse, holeNumber: pHole, fromMatchId } = useLocalSearchParams<{ courseName?: string; holeNumber?: string; fromMatchId?: string }>();
  const router = useRouter();
  const goBack = () => fromMatchId
    ? router.replace(`/(app)/score/enter/${fromMatchId}` as any)
    : router.back();
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

  const [giQuery, setGiQuery]       = useState('');
  const [giResults, setGiResults]   = useState<GICourseResult[]>([]);
  const [giSearching, setGiSearching] = useState(false);
  const giMode = useRef(false);

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

  // ── Reset GI mode when course is cleared ────────────────────────
  useEffect(() => {
    if (!selectedCourse) giMode.current = false;
  }, [selectedCourse]);

  // ── Seed the GI search box with a cleaned course name ────────────
  useEffect(() => {
    if (selectedCourse) setGiQuery(cleanCourseNameForSearch(selectedCourse));
  }, [selectedCourse]);

  // ── Load holes for selected course ───────────────────────────────
  useEffect(() => {
    if (!selectedCourse || giMode.current) return;
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
    const tee = (hole?.tee_lat != null && hole?.tee_lng != null)
      ? { latitude: hole.tee_lat!, longitude: hole.tee_lng! }
      : null;
    const coords = tee
      ? [tee, { latitude: centre.lat, longitude: centre.lng }]
      : [{ latitude: centre.lat, longitude: centre.lng }];
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: { top: 100, right: 80, bottom: 220, left: 100 }, animated: true,
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

  // ── Elevation (tee-to-green; falls back to player position) ─────
  useEffect(() => {
    const centre = pins.centre;
    const fromPt = (hole?.tee_lat != null && hole?.tee_lng != null)
      ? { lat: hole.tee_lat!, lng: hole.tee_lng! }
      : player;
    if (!fromPt || !centre || elevLoading) return;
    setElevLoading(true);
    fetch('https://api.open-elevation.com/api/v1/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: [
        { latitude: fromPt.lat, longitude: fromPt.lng },
        { latitude: centre.lat, longitude: centre.lng },
      ]}),
    })
      .then(r => r.json())
      .then(d => {
        const res = d.results;
        if (res?.length === 2) {
          const diffFt = Math.round((res[1].elevation - res[0].elevation) * 3.28084);
          setElev({ diffFt, adjustYards: Math.round(diffFt / 10) });
        }
      })
      .catch(() => {})
      .finally(() => setElevLoading(false));
  }, [pins.centre?.lat, pins.centre?.lng, player?.lat, player?.lng, hole?.tee_lat, hole?.tee_lng]);

  function toHoleRows(giHoles: GIHoleData[]): HoleRow[] {
    return giHoles.map(h => ({
      hole_number:  h.holeNumber,
      par:          h.par ?? 4,
      stroke_index: h.strokeIndex ?? 1,
      front_lat:    h.front_lat ?? null,
      front_lng:    h.front_lng ?? null,
      green_lat:    h.green_lat,
      green_lng:    h.green_lng,
      back_lat:     h.back_lat ?? null,
      back_lng:     h.back_lng ?? null,
      tee_lat:      h.tee_lat ?? null,
      tee_lng:      h.tee_lng ?? null,
      yellow_yards: h.yellow_yards ?? null,
      white_yards:  h.white_yards ?? null,
      blue_yards:   h.blue_yards ?? null,
      red_yards:    h.red_yards ?? null,
    }));
  }

  async function selectGiCourse(publicId: string, name: string) {
    setGiSearching(true);
    try {
      // Check 30-day SQLite cache first
      const db = await ensureDb();
      if (db) {
        const cached = await db.getFirstAsync(
          'SELECT holes_json FROM gi_course_cache WHERE public_id = ? AND cached_at > ?',
          [publicId, Date.now() - 30 * 24 * 60 * 60 * 1000],
        ) as { holes_json: string } | null;
        if (cached?.holes_json) {
          const rows = toHoleRows(JSON.parse(cached.holes_json) as GIHoleData[]);
          giMode.current = true;
          setHoles(rows);
          setSelected(name);
          setHoleIdx(0);
          setGiResults([]);
          setGiQuery('');
          return;
        }
      }
      // Fetch from API
      const giHoles = await getCourseHoles(publicId);
      if (giHoles.length === 0) {
        Alert.alert('No GPS data', 'Golf Intelligence has no GPS data for this course yet.');
        return;
      }
      if (db) {
        await db.runAsync(
          'INSERT OR REPLACE INTO gi_course_cache (public_id, course_name, holes_json, cached_at) VALUES (?, ?, ?, ?)',
          [publicId, name, JSON.stringify(giHoles), Date.now()],
        ).catch(() => {});
      }
      const rows = toHoleRows(giHoles);
      giMode.current = true;
      setHoles(rows);
      setSelected(name);
      setHoleIdx(0);
      setGiResults([]);
      setGiQuery('');
    } catch {
      Alert.alert('Error', 'Could not load course GPS data. Check your connection.');
    } finally {
      setGiSearching(false);
    }
  }

  async function runGiSearch() {
    const q = giQuery.trim();
    if (!q) return;
    setGiSearching(true);
    setGiResults([]);
    try {
      const results = await searchCourse(q);
      setGiResults(results.slice(0, 10));
      if (results.length === 0) Alert.alert('No results', `No courses found for "${q}"`);
    } catch {
      Alert.alert('Error', 'Course search failed. Check your connection.');
    } finally {
      setGiSearching(false);
    }
  }

  const teeOrigin: { lat: number; lng: number } | null =
    (hole?.tee_lat != null && hole?.tee_lng != null)
      ? { lat: hole.tee_lat!, lng: hole.tee_lng! }
      : null;
  const distOrigin = teeOrigin ?? player;

  const distTo = (t: Target) => {
    const p = pins[t];
    return distOrigin && p ? haversineYards(distOrigin.lat, distOrigin.lng, p.lat, p.lng) : null;
  };
  const dFront  = distTo('front');
  const dCentre = distTo('centre');
  const dBack   = distTo('back');
  const dActive = distTo(activeTarget);

  const centre = pins.centre;
  const initialRegion = teeOrigin
    ? { latitude: teeOrigin.lat, longitude: teeOrigin.lng, latitudeDelta: 0.006, longitudeDelta: 0.006 }
    : centre
    ? { latitude: centre.lat, longitude: centre.lng, latitudeDelta: 0.004, longitudeDelta: 0.004 }
    : undefined;

  // ── Course selector ───────────────────────────────────────────────
  if (!selectedCourse || !fontsLoaded) {
    return (
      <View style={[s.root, { backgroundColor: dc.bg }]}>
        <StatusBar style="light" />

        <View style={[s.selHeader, { backgroundColor: dc.bg }]}>
          <TouchableOpacity onPress={goBack} style={s.headerSide} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={24} color={dc.gold} />
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Image source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)} style={s.headerLogo} resizeMode="contain" />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Image source={titanLogo} style={{ width: 20, height: 20 }} resizeMode="contain" />
              <Text style={s.headerSub}>TITAN GPS</Text>
            </View>
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

          <Text style={[s.sectionLabel, { color: dc.cardText, marginTop: 24 }]}>SEARCH GOLF INTELLIGENCE</Text>
          <View style={[s.giSearchRow, { backgroundColor: dc.card, borderColor: dc.border }]}>
            <TextInput
              style={[s.giInput, { color: dc.cardText }]}
              placeholder="Course name..."
              placeholderTextColor={dc.textMuted}
              value={giQuery}
              onChangeText={setGiQuery}
              onSubmitEditing={runGiSearch}
              returnKeyType="search"
              autoCorrect={false}
            />
            <TouchableOpacity onPress={runGiSearch} style={s.giSearchBtn} disabled={giSearching}>
              {giSearching
                ? <ActivityIndicator size="small" color={GOLD} />
                : <Ionicons name="search" size={20} color={GOLD} />}
            </TouchableOpacity>
          </View>

          {giResults.map(r => (
            <TouchableOpacity
              key={r.publicId}
              style={[s.courseCard, { backgroundColor: dc.card, borderColor: dc.border }]}
              onPress={() => selectGiCourse(r.publicId, r.name)}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={[s.courseName, { color: dc.cardText }]}>{r.name}</Text>
                {r.location ? <Text style={[s.giLocation, { color: dc.textMuted }]}>{r.location}</Text> : null}
              </View>
              <Ionicons name="navigate-outline" size={18} color={GOLD} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ── Main rangefinder ──────────────────────────────────────────────
  const windAdj = (() => {
    if (!weather || !distOrigin || !pins[activeTarget]) return 0;
    const shot = bearingDeg(distOrigin.lat, distOrigin.lng, pins[activeTarget]!.lat, pins[activeTarget]!.lng);
    const headwind = weather.windSpeed * Math.cos((weather.windDir - shot) * Math.PI / 180);
    return Math.round(headwind * 0.5);
  })();
  const effectiveDist = dActive !== null ? dActive + (elev?.adjustYards ?? 0) + windAdj : null;
  const clubRec = recommendClub(effectiveDist, clubAvgs);

  const bottomPanelHeight = 200;

  const teeYards = [
    { label: 'B', yards: hole?.blue_yards,   color: '#3b82f6' },
    { label: 'W', yards: hole?.white_yards,  color: '#e5e7eb' },
    { label: 'Y', yards: hole?.yellow_yards, color: '#eab308' },
    { label: 'R', yards: hole?.red_yards,    color: '#ef4444' },
  ].filter(t => t.yards != null);

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* ── Full-screen map ── */}
      {initialRegion ? (
        <MapView
          ref={mapRef}
          style={s.mapFull}
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

          {/* Tee marker */}
          {hole?.tee_lat != null && hole?.tee_lng != null && (
            <Marker
              coordinate={{ latitude: hole.tee_lat, longitude: hole.tee_lng }}
              anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}
            >
              <View style={s.teeMarker} />
            </Marker>
          )}

          {distOrigin && pins[activeTarget] && (
            <Polyline
              coordinates={[
                { latitude: distOrigin.lat, longitude: distOrigin.lng },
                { latitude: pins[activeTarget]!.lat, longitude: pins[activeTarget]!.lng },
              ]}
              strokeColor="#fff"
              strokeWidth={1.5}
              lineDashPattern={[6, 4]}
            />
          )}
        </MapView>
      ) : (
        <View style={[s.mapFull, { backgroundColor: '#111' }]} />
      )}

      {/* ── TOP HEADER ── */}
      <View style={s.topHeader}>
        <View style={s.headerRow}>
          <TouchableOpacity onPress={goBack} style={s.headerBackBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>

          <View style={s.headerBrand}>
            <Image source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)} style={s.headerBrandLogo} resizeMode="contain" />
            <Text style={s.headerBrandText}>TITAN GPS</Text>
          </View>

          <View style={s.headerRight}>
            <View style={[s.gpsDot, { backgroundColor: gpsOk ? GREEN : '#f59e0b' }]} />
            {weather && <Text style={s.gpsText}>{weather.windSpeed}mph {cardinal(weather.windDir)}</Text>}
          </View>
        </View>

        <View style={s.holeInfoRow}>
          {hole ? (
            <>
              <Text style={s.holeInfoBig}>HOLE {String(hole.hole_number).padStart(2, '0')}</Text>
              <Text style={s.holeInfoSep}>·</Text>
              <Text style={s.holeInfoSub}>PAR {hole.par}</Text>
              <Text style={s.holeInfoSep}>·</Text>
              <Text style={s.holeInfoSub}>SI {hole.stroke_index}</Text>
            </>
          ) : (
            <Text style={s.holeInfoSub}>{selectedCourse}</Text>
          )}
        </View>
      </View>

      {/* ── DISTANCE CARDS — left column ── */}
      <View style={s.distCol}>
        {([
          { t: 'front'  as Target, icon: 'arrow-up-outline'   as const, label: 'FRONT', d: dFront  },
          { t: 'centre' as Target, icon: 'flag'               as const, label: 'FLAG',  d: dCentre },
          { t: 'back'   as Target, icon: 'arrow-down-outline' as const, label: 'BACK',  d: dBack   },
        ]).map(({ t, icon, label, d }) => {
          const active = activeTarget === t;
          return (
            <TouchableOpacity
              key={t}
              onPress={() => setTarget(t)}
              activeOpacity={0.75}
              style={[s.distCard, active && s.distCardActive]}
            >
              <Ionicons name={icon} size={16} color={active ? GOLD : 'rgba(255,255,255,0.5)'} style={s.distIcon} />
              <Text style={[s.distNum, { color: active ? '#fff' : 'rgba(255,255,255,0.45)', fontSize: active ? 22 : 18 }]}>
                {d !== null ? d : '—'}
              </Text>
              <Text style={[s.distLabel, { color: active ? GOLD : 'rgba(255,255,255,0.35)' }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── WIND COMPASS ── */}
      {weather && (
        <View style={[s.compassCircle, { bottom: bottomPanelHeight + 20, right: 16 }]}>
          <View style={[s.compassNeedle, { transform: [{ rotate: `${weather.windDir}deg` }] }]}>
            <View style={s.needleHead} />
            <View style={s.needleTail} />
          </View>
          <View style={s.compassCentre} />
          <Text style={s.compassLabel}>{cardinal(weather.windDir)}</Text>
        </View>
      )}

      {/* ── BOTTOM PANEL ── */}
      <View style={s.bottomPanel}>
        {/* Active distance — hero number */}
        <View style={s.distHero}>
          <Text style={s.distHeroNum}>{dActive !== null ? dActive : '—'}</Text>
          <View style={s.distHeroMeta}>
            <Text style={s.distHeroLabel}>
              {activeTarget === 'front' ? 'FRONT' : activeTarget === 'back' ? 'BACK' : 'FLAG'}
              {' · '}
              {teeOrigin ? 'FROM TEE' : 'FROM HERE'}
            </Text>
            {(elev || windAdj !== 0) && effectiveDist !== null && (
              <Text style={s.distHeroAdj}>
                {[
                  elev ? (elev.diffFt >= 0 ? `↑${elev.diffFt}ft` : `↓${Math.abs(elev.diffFt)}ft`) : null,
                  windAdj !== 0 ? (windAdj > 0 ? `+${windAdj}yd` : `${windAdj}yd`) : null,
                ].filter(Boolean).join(' · ')}
                {' → play '}
                <Text style={{ color: GOLD }}>{effectiveDist}</Text>
                {' yds'}
              </Text>
            )}
            {clubRec && (
              <Text style={s.distHeroClub}>🏌 {clubRec.club} · {clubRec.dist} yds avg</Text>
            )}
          </View>
        </View>

        <View style={s.panelDivider} />

        {/* Hole navigation */}
        <View style={s.bottomHoleNav}>
          <TouchableOpacity
            style={s.holeNavArrow}
            onPress={() => setHoleIdx(i => Math.max(0, i - 1))}
            disabled={holeIdx === 0}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={26} color={holeIdx === 0 ? '#333' : '#fff'} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setSelected(null)} activeOpacity={0.7} style={s.holeNavCenter}>
            <Text style={s.holeNavLabel}>HOLE</Text>
            <Text style={s.holeNavNum}>{hole ? String(hole.hole_number).padStart(2, '0') : '—'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.holeNavArrow}
            onPress={() => setHoleIdx(i => Math.min(holes.length - 1, i + 1))}
            disabled={holeIdx >= holes.length - 1}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-forward" size={26} color={holeIdx >= holes.length - 1 ? '#333' : '#fff'} />
          </TouchableOpacity>
        </View>

        {/* Tee yardage strip */}
        {teeYards.length > 0 && (
          <View style={s.yardageStrip}>
            {teeYards.map(ty => (
              <View key={ty.label} style={s.yardageChip}>
                <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: ty.color, marginRight: 5 }} />
                <Text style={s.yardageChipText}>{ty.yards}</Text>
                <Text style={s.yardageChipLabel}> yds</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },

  // ── Course selector ──────────────────────────────────────────────
  headerSide:   { width: 40, alignItems: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', gap: 2 },
  headerLogo:   { width: 24, height: 24 },
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
  giSearchRow:  { flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, height: 48, marginBottom: 8 },
  giInput:      { flex: 1, fontFamily: FF, fontSize: 14, height: 48 },
  giSearchBtn:  { paddingLeft: 10, height: 48, justifyContent: 'center' },
  giLocation:   { fontFamily: FF, fontSize: 12, marginTop: 2 },

  // ── Map ──────────────────────────────────────────────────────────
  mapFull: StyleSheet.absoluteFillObject,

  // ── Pin dots ─────────────────────────────────────────────────────
  pinDot: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.8, shadowRadius: 4,
  },
  pinDotText: { fontFamily: FFB, fontSize: 12, color: '#000' },
  teeMarker: {
    width: 12, height: 12, backgroundColor: '#fff',
    borderRadius: 2, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.5)',
  },

  // ── Top header ───────────────────────────────────────────────────
  topHeader: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingTop: 52, paddingBottom: 10, paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderBottomWidth: 1, borderBottomColor: 'rgba(212,175,55,0.18)',
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  headerBackBtn: { width: 36, alignItems: 'flex-start' },
  headerBrand: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
  },
  headerBrandLogo: { width: 22, height: 22 },
  headerBrandText: { fontFamily: FFB, fontSize: 13, color: GOLD, letterSpacing: 2.5 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 5, width: 90, justifyContent: 'flex-end' },
  gpsDot:  { width: 7, height: 7, borderRadius: 3.5 },
  gpsText: { fontFamily: FFB, fontSize: 10, color: 'rgba(255,255,255,0.6)' },

  holeInfoRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 8, gap: 6,
  },
  holeInfoBig: { fontFamily: FFB, fontSize: 13, color: '#fff', letterSpacing: 1.5 },
  holeInfoSep: { fontFamily: FF, fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  holeInfoSub: { fontFamily: FF, fontSize: 12, color: 'rgba(255,255,255,0.6)', letterSpacing: 0.5 },

  // ── Distance cards — left column ─────────────────────────────────
  distCol: {
    position: 'absolute', left: 14, top: 145,
    gap: 6,
  },
  distCard: {
    width: 78, height: 70,
    backgroundColor: 'rgba(0,0,0,0.68)',
    borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
    gap: 2,
  },
  distCardActive: {
    borderColor: GOLD,
    borderWidth: 1.5,
    backgroundColor: 'rgba(0,0,0,0.82)',
  },
  distIcon:  { marginBottom: 1 },
  distNum:   { fontFamily: FFB, lineHeight: 24 },
  distLabel: { fontFamily: FFB, fontSize: 8, letterSpacing: 1.5 },

  // ── Wind compass ─────────────────────────────────────────────────
  compassCircle: {
    position: 'absolute',
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.70)',
    borderWidth: 1.5, borderColor: GOLD,
    alignItems: 'center', justifyContent: 'center',
  },
  compassNeedle: {
    position: 'absolute', width: 2, height: 30,
    alignItems: 'center', justifyContent: 'space-between',
  },
  needleHead:    { width: 7, height: 7, borderRadius: 4, backgroundColor: GOLD },
  needleTail:    { width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
  compassCentre: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#fff' },
  compassLabel:  { position: 'absolute', bottom: 4, fontFamily: FFB, fontSize: 7, color: '#fff', letterSpacing: 1 },

  // ── Bottom panel ─────────────────────────────────────────────────
  bottomPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(5,5,5,0.92)',
    borderTopWidth: 1, borderTopColor: 'rgba(212,175,55,0.22)',
    paddingBottom: 36, paddingTop: 14,
    alignItems: 'center',
  },

  // Active distance hero
  distHero: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 24, gap: 14,
    marginBottom: 4,
  },
  distHeroNum: {
    fontFamily: FFB, fontSize: 54, color: '#fff',
    lineHeight: 58, letterSpacing: -2,
    textShadowColor: GOLD, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },
  distHeroMeta: { flex: 1, gap: 3 },
  distHeroLabel: {
    fontFamily: FFB, fontSize: 10, color: GOLD, letterSpacing: 2,
  },
  distHeroAdj: {
    fontFamily: FF, fontSize: 11, color: 'rgba(255,255,255,0.55)', lineHeight: 16,
  },
  distHeroClub: {
    fontFamily: FFB, fontSize: 12, color: GOLD,
  },

  panelDivider: {
    width: '88%', height: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginVertical: 10,
  },

  // Hole navigation
  bottomHoleNav: {
    flexDirection: 'row', alignItems: 'center',
    width: '100%', justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  holeNavArrow: {
    width: 48, alignItems: 'center', justifyContent: 'center', paddingVertical: 4,
  },
  holeNavCenter: { alignItems: 'center' },
  holeNavLabel: {
    fontFamily: FFB, fontSize: 9, color: GOLD, letterSpacing: 2.5,
  },
  holeNavNum: {
    fontFamily: FFB, fontSize: 38, color: '#fff',
    lineHeight: 42, letterSpacing: -1,
  },

  // Tee yardages
  yardageStrip: {
    flexDirection: 'row', gap: 6,
    marginTop: 8, paddingHorizontal: 16,
    flexWrap: 'wrap', justifyContent: 'center',
  },
  yardageChip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
  },
  yardageChipText: { fontFamily: FFB, fontSize: 12, color: '#fff' },
  yardageChipLabel: { fontFamily: FF, fontSize: 10, color: 'rgba(255,255,255,0.4)' },
});
