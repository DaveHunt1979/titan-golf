import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Image } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { supabase } from '../../lib/supabase';

const GOLD   = '#D4AF37';
const BG     = '#0a0a0a';
const BORDER = '#1c1c1c';
const MUTED  = '#6b7280';
const RED    = '#f87171';
const titanLogo = require('../../../assets/TitanAppLogo.png');

const TEE_COLORS: Record<string, { dot: string; label: string }> = {
  blue:   { dot: '#3b82f6', label: 'B' },
  white:  { dot: '#e5e7eb', label: 'W' },
  yellow: { dot: '#eab308', label: 'Y' },
  red:    { dot: '#ef4444', label: 'R' },
};

interface Props {
  courseName: string | null | undefined;
  holeNumber: number;
  par: number | null;
  strokeIndex: number | null;
  yardage: number | null;
  teeYardages: Record<string, number> | null;
}

function haversineYards(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180, Δλ = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.09361);
}

// Pulsing "LIVE" dot — the one bit of broadcast-graphic flair beyond what
// HoleInfoPanel/LeaderboardPanel already do, kept to a simple opacity loop
// rather than anything that could jank on the iPad sat in a buggy all day.
function LiveDot() {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[gs.liveDot, { opacity: pulse }]} />;
}

export default function GPSPanel({ courseName, holeNumber, par, strokeIndex, yardage, teeYardages }: Props) {
  const [green, setGreen] = useState<{ lat: number; lng: number } | null>(null);
  const [player, setPlayer] = useState<{ lat: number; lng: number } | null>(null);
  const [loadedHole, setLoadedHole] = useState<number | null>(null);

  useEffect(() => {
    setGreen(null);
    setLoadedHole(null);
    if (!courseName) return;
    supabase
      .from('course_holes')
      .select('green_lat,green_lng')
      .eq('course_name', courseName)
      .eq('hole_number', holeNumber)
      .single()
      .then(({ data }) => {
        if (data?.green_lat && data?.green_lng) {
          setGreen({ lat: (data as any).green_lat, lng: (data as any).green_lng });
        }
        setLoadedHole(holeNumber);
      });
  }, [courseName, holeNumber]);

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 5 },
        loc => setPlayer({ lat: loc.coords.latitude, lng: loc.coords.longitude }),
      );
    })();
    return () => { sub?.remove(); };
  }, []);

  const distance = (player && green) ? haversineYards(player.lat, player.lng, green.lat, green.lng) : null;

  const teeRows = teeYardages
    ? Object.entries(teeYardages).filter(([k, v]) => TEE_COLORS[k] && v > 0).sort((a, b) => b[1] - a[1])
    : yardage ? [['white', yardage] as [string, number]] : [];

  const noGpsYet = loadedHole === holeNumber && !green;

  return (
    <View style={gs.root}>
      {green ? (
        <MapView
          key={holeNumber}
          style={gs.map}
          mapType="satellite"
          initialRegion={{ latitude: green.lat, longitude: green.lng, latitudeDelta: 0.0035, longitudeDelta: 0.0035 }}
          showsUserLocation={!!player}
          showsMyLocationButton={false}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
        >
          <Marker coordinate={{ latitude: green.lat, longitude: green.lng }} anchor={{ x: 0.5, y: 1 }}>
            <Text style={{ fontSize: 30 }}>⛳</Text>
          </Marker>
          {player && (
            <Polyline
              coordinates={[{ latitude: player.lat, longitude: player.lng }, { latitude: green.lat, longitude: green.lng }]}
              strokeColor={GOLD}
              strokeWidth={3}
              lineDashPattern={[10, 6]}
            />
          )}
        </MapView>
      ) : (
        <View style={gs.mapFallback}>
          <Text style={gs.mapFallbackText}>{noGpsYet ? 'GPS not mapped for this hole yet' : 'LOCATING…'}</Text>
        </View>
      )}

      {/* ── Top HUD ── */}
      <View style={gs.topBar} pointerEvents="none">
        <View style={gs.topLeft}>
          <LiveDot />
          <Text style={gs.liveText}>LIVE</Text>
        </View>
        <Image source={titanLogo} style={gs.watermark} resizeMode="contain" />
      </View>

      <View style={gs.holeChip} pointerEvents="none">
        <Text style={gs.holeChipLabel}>HOLE</Text>
        <Text style={gs.holeChipNum}>{holeNumber}</Text>
        <View style={gs.holeChipBadges}>
          {par != null && (
            <View style={gs.miniBadge}><Text style={gs.miniBadgeText}>PAR {par}</Text></View>
          )}
          {strokeIndex != null && (
            <View style={[gs.miniBadge, { borderColor: MUTED }]}><Text style={[gs.miniBadgeText, { color: MUTED }]}>SI {strokeIndex}</Text></View>
          )}
        </View>
      </View>

      {/* ── Bottom lower-third: distance + tees ── */}
      <View style={gs.lowerThird} pointerEvents="none">
        <View style={gs.distanceBlock}>
          {distance !== null ? (
            <>
              <Text style={gs.distanceNum}>{distance}</Text>
              <Text style={gs.distanceUnit}>YDS TO GREEN</Text>
            </>
          ) : (
            <Text style={gs.distanceUnit}>{green ? 'GPS LOCATING…' : ' '}</Text>
          )}
        </View>
        {teeRows.length > 0 && (
          <View style={gs.teeRow}>
            {teeRows.map(([key, yards]) => {
              const tc = TEE_COLORS[key] ?? { dot: '#fff', label: key[0]?.toUpperCase() ?? '?' };
              return (
                <View key={key} style={gs.teeChip}>
                  <View style={[gs.teeDot, { backgroundColor: tc.dot }]} />
                  <Text style={gs.teeYards}>{yards}</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}

const gs = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, borderLeftWidth: 1, borderRightWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  map: { flex: 1 },
  mapFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  mapFallbackText: { color: MUTED, fontSize: 13, fontFamily: 'JUSTSans-ExBold', letterSpacing: 1 },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 18, paddingHorizontal: 20,
  },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  liveDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: RED },
  liveText: { color: '#fff', fontSize: 10, fontFamily: 'JUSTSans-ExBold', letterSpacing: 2 },
  watermark: { width: 26, height: 26, opacity: 0.55 },

  holeChip: {
    position: 'absolute', top: 60, left: 20,
    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 14,
    borderWidth: 1, borderColor: `${GOLD}60`,
    paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', minWidth: 90,
  },
  holeChipLabel: { color: MUTED, fontSize: 9, fontFamily: 'JUSTSans-ExBold', letterSpacing: 2 },
  holeChipNum: { color: GOLD, fontSize: 40, fontFamily: 'JUSTSans-ExBold', lineHeight: 44 },
  holeChipBadges: { flexDirection: 'row', gap: 6, marginTop: 6 },
  miniBadge: { borderWidth: 1, borderColor: GOLD, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  miniBadgeText: { color: GOLD, fontSize: 10, fontFamily: 'JUSTSans-ExBold' },

  lowerThird: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderTopWidth: 1, borderTopColor: `${GOLD}40`,
    paddingTop: 16, paddingBottom: 20, paddingHorizontal: 20,
    alignItems: 'center', gap: 10,
  },
  distanceBlock: { alignItems: 'center' },
  distanceNum: { color: GOLD, fontSize: 54, fontFamily: 'JUSTSans-ExBold', lineHeight: 58 },
  distanceUnit: { color: '#fff', fontSize: 11, fontFamily: 'JUSTSans-ExBold', letterSpacing: 2, marginTop: 2 },
  teeRow: { flexDirection: 'row', gap: 14 },
  teeChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  teeDot: { width: 8, height: 8, borderRadius: 4 },
  teeYards: { color: '#9ca3af', fontSize: 12, fontFamily: 'JUSTSans-ExBold' },
});
