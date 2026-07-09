/**
 * Concept Preview — TITAN premium Rangefinder UI
 * Course hero image stands in for Apple Maps satellite view.
 * All overlay elements (FCB HUD, hole strip, wind) are the real design.
 */
import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';

const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const RED    = '#f87171';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';
const DARK   = 'rgba(0,0,0,0.88)';
const { width: W, height: H } = Dimensions.get('window');

type Target = 'front' | 'centre' | 'back';

// ── Mock data ─────────────────────────────────────────────────
const MOCK_HOLES = [
  { hole: 1,  par: 4, si: 7,  front: 158, centre: 172, back: 186 },
  { hole: 2,  par: 3, si: 15, front:  92, centre: 108, back: 120 },
  { hole: 3,  par: 5, si: 1,  front: 298, centre: 318, back: 334 },
  { hole: 4,  par: 4, si: 11, front: 146, centre: 162, back: 176 },
  { hole: 5,  par: 4, si: 5,  front: 168, centre: 184, back: 197 },
  { hole: 6,  par: 3, si: 17, front:  78, centre:  94, back: 106 },
  { hole: 7,  par: 4, si: 9,  front: 152, centre: 168, back: 182 },
  { hole: 8,  par: 4, si: 3,  front: 192, centre: 210, back: 224 },
  { hole: 9,  par: 5, si: 13, front: 278, centre: 296, back: 312 },
  { hole: 10, par: 4, si: 2,  front: 208, centre: 226, back: 240 },
  { hole: 11, par: 4, si: 8,  front: 138, centre: 154, back: 168 },
  { hole: 12, par: 3, si: 16, front:  84, centre:  98, back: 112 },
  { hole: 13, par: 4, si: 6,  front: 174, centre: 192, back: 204 },
  { hole: 14, par: 5, si: 4,  front: 268, centre: 288, back: 302 },
  { hole: 15, par: 4, si: 10, front: 148, centre: 166, back: 178 },
  { hole: 16, par: 3, si: 18, front:  72, centre:  88, back:  98 },
  { hole: 17, par: 4, si: 12, front: 144, centre: 160, back: 174 },
  { hole: 18, par: 5, si: 14, front: 282, centre: 300, back: 316 },
];

const WIND = { dir: 'NE', speed: 12, temp: 17 };
const ELEV = { diff: 3, adjusted: 171 };

const TARGET_COLORS: Record<Target, string> = {
  front:  GREEN,
  centre: GOLD,
  back:   RED,
};

const TARGET_LABELS: Record<Target, string> = {
  front:  'F',
  centre: 'C',
  back:   'B',
};

export default function ConceptRangefinderScreen() {
  const router = useRouter();
  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [holeIdx,  setHoleIdx]  = useState(6); // start on hole 7
  const [target,   setTarget]   = useState<Target>('centre');
  const [gpsOk,    setGpsOk]    = useState(true);

  if (!fontsLoaded) return null;

  const hole   = MOCK_HOLES[holeIdx];
  const dist   = hole[target];
  const color  = TARGET_COLORS[target];
  const holeStripRef = null;

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* ── Map background (course photo standing in for Apple Maps) ── */}
      <Image
        source={require('../../../assets/hero-course.jpeg')}
        style={s.mapBg}
        resizeMode="cover"
      />
      {/* light dark tint over image so UI stays readable */}
      <View style={s.mapTint} />

      {/* ── TITAN badge (top-left) ── */}
      <View style={s.titanBadge}>
        <Image source={require('../../../assets/TitanAppLogo.png')} style={s.titanLogo} resizeMode="contain" />
      </View>

      {/* ── GPS chip (top-right) ── */}
      <View style={s.gpsBadge}>
        <View style={[s.gpsDot, { backgroundColor: gpsOk ? GREEN : '#f59e0b' }]} />
        <Text style={s.gpsText}>GPS</Text>
      </View>

      {/* ── Header overlay ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={s.headerBack}>
          <Ionicons name="chevron-back" size={26} color="#ffffff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerHole}>HOLE {hole.hole} · PAR {hole.par}</Text>
          <Text style={s.headerCourse}>West Cliffs · SI {hole.si}</Text>
        </View>
        <TouchableOpacity style={s.headerBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="layers-outline" size={22} color={GOLD} />
        </TouchableOpacity>
      </View>

      {/* ── Main FCB distance panel (bottom overlay) ── */}
      <View style={s.panel}>

        {/* Wind / elevation strip */}
        <View style={s.weatherStrip}>
          <Text style={[s.windArrow, { transform: [{ rotate: '45deg' }] }]}>↑</Text>
          <Text style={s.weatherText}>{WIND.dir} {WIND.speed}mph</Text>
          <View style={s.weatherDot} />
          <Text style={s.weatherText}>{WIND.temp}°C</Text>
          <View style={s.weatherDot} />
          <Ionicons name="trending-up-outline" size={12} color={RED} />
          <Text style={[s.weatherText, { color: RED }]}>+{ELEV.diff}m · {ELEV.adjusted} adj</Text>
        </View>

        {/* FCB selector */}
        <View style={s.fcbRow}>
          {(['front', 'centre', 'back'] as Target[]).map(t => {
            const active = target === t;
            const c = TARGET_COLORS[t];
            const d = hole[t];
            return (
              <TouchableOpacity
                key={t}
                style={[s.fcbPill, active && { backgroundColor: `${c}18`, borderColor: `${c}60` }]}
                onPress={() => setTarget(t)}
                activeOpacity={0.7}
              >
                <Text style={[s.fcbLetter, { color: active ? c : '#4b5563' }]}>
                  {TARGET_LABELS[t]}
                </Text>
                <Text style={[s.fcbDist, { color: active ? c : '#374151' }]}>{d}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Big active distance */}
        <View style={s.bigDistWrap}>
          <Text style={[s.bigDist, { color }]}>{dist}</Text>
          <Text style={[s.bigDistLabel, { color: `${color}80` }]}>
            yards to {target === 'front' ? 'front' : target === 'back' ? 'back' : 'centre'}
          </Text>
        </View>

        {/* Hole strip */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.holeStrip}
          style={s.holeStripWrap}
        >
          {MOCK_HOLES.map((h, i) => {
            const active = i === holeIdx;
            return (
              <TouchableOpacity
                key={h.hole}
                style={[s.holeTile, active && s.holeTileActive]}
                onPress={() => setHoleIdx(i)}
                activeOpacity={0.7}
              >
                <Text style={[s.holeTileNum, active && { color: GOLD }]}>{h.hole}</Text>
                <Text style={[s.holeTilePar, active && { color: `${GOLD}80` }]}>P{h.par}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Note about real version */}
        <Text style={s.conceptNote}>CONCEPT PREVIEW · Apple Maps satellite view in live app</Text>
      </View>

      {/* ── F / C / B pin markers floating on map (decorative in concept) ── */}
      <View style={[s.pinMarker, { top: H * 0.28, left: W * 0.42 }]}>
        <Text style={[s.pinLetter, { color: GREEN }]}>F</Text>
      </View>
      <View style={[s.pinMarker, { top: H * 0.22, left: W * 0.48 }]}>
        <Text style={[s.pinLetter, { color: GOLD }]}>C</Text>
      </View>
      <View style={[s.pinMarker, { top: H * 0.17, left: W * 0.44 }]}>
        <Text style={[s.pinLetter, { color: RED }]}>B</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },

  // Map
  mapBg:   { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  mapTint: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },

  // TITAN badge
  titanBadge: { position: 'absolute', top: 58, left: 16, zIndex: 20 },
  titanLogo:  { width: 28, height: 28 },

  // GPS badge
  gpsBadge: {
    position: 'absolute', top: 62, right: 16, zIndex: 20,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: '#1c1c1c',
  },
  gpsDot:  { width: 8, height: 8, borderRadius: 4 },
  gpsText: { fontFamily: FFB, fontSize: 10, color: '#6b7280', letterSpacing: 1 },

  // Header
  header: {
    position: 'absolute', top: 100, left: 0, right: 0, zIndex: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: DARK,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerBack:   { width: 36 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerHole:   { fontFamily: FFB, fontSize: 14, color: '#ffffff', letterSpacing: 1.5 },
  headerCourse: { fontFamily: FF, fontSize: 11, color: '#6b7280', marginTop: 2 },

  // Pin markers (decorative)
  pinMarker: {
    position: 'absolute', zIndex: 10,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderWidth: 2, borderColor: GOLD,
    alignItems: 'center', justifyContent: 'center',
  },
  pinLetter: { fontFamily: FFB, fontSize: 13 },

  // Bottom panel
  panel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: DARK,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
    paddingTop: 14, paddingBottom: 36,
  },

  // Weather strip
  weatherStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  windArrow:   { fontFamily: FFB, fontSize: 14, color: '#ffffff' },
  weatherText: { fontFamily: FF, fontSize: 12, color: '#9ca3af' },
  weatherDot:  { width: 3, height: 3, borderRadius: 2, backgroundColor: '#374151' },

  // FCB selector
  fcbRow: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 14,
  },
  fcbPill: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12,
    backgroundColor: '#0d0d0d', borderWidth: 1, borderColor: '#1c1c1c', gap: 4,
  },
  fcbLetter: { fontFamily: FFB, fontSize: 16, letterSpacing: 1 },
  fcbDist:   { fontFamily: FFB, fontSize: 22 },

  // Big distance
  bigDistWrap: { alignItems: 'center', paddingVertical: 16 },
  bigDist:     { fontFamily: FFB, fontSize: 96, lineHeight: 102, letterSpacing: -3 },
  bigDistLabel:{ fontFamily: FF, fontSize: 13, letterSpacing: 1, marginTop: -4 },

  // Hole strip
  holeStripWrap: { maxHeight: 66, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  holeStrip:     { paddingHorizontal: 12, paddingVertical: 8, gap: 6, alignItems: 'center' },
  holeTile: {
    width: 40, height: 50, borderRadius: 10,
    backgroundColor: '#111111', borderWidth: 1, borderColor: '#1c1c1c',
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  holeTileActive: { borderColor: GOLD, borderWidth: 1.5 },
  holeTileNum:    { fontFamily: FFB, fontSize: 14, color: '#ffffff' },
  holeTilePar:    { fontFamily: FF, fontSize: 9, color: '#6b7280' },

  conceptNote: {
    fontFamily: FF, fontSize: 9, color: '#1f1f1f',
    textAlign: 'center', paddingTop: 6, letterSpacing: 1.5,
  },
});
