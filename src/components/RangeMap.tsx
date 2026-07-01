import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { colors, fonts, spacing, radius } from '../lib/theme';

interface Props {
  courseName: string | null | undefined;
  holeNumber: number;
}

function haversineYards(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180, Δλ = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.09361);
}

export default function RangeMap({ courseName, holeNumber }: Props) {
  const [green, setGreen] = useState<{ lat: number; lng: number } | null>(null);
  const [player, setPlayer] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setGreen(null);
    setLoading(true);
    if (!courseName) { setLoading(false); return; }
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
        setLoading(false);
      });
  }, [courseName, holeNumber]);

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 5 },
        (loc) => setPlayer({ lat: loc.coords.latitude, lng: loc.coords.longitude })
      );
    })();
    return () => { sub?.remove(); };
  }, []);

  if (loading || !green) return null;

  const distance = player ? haversineYards(player.lat, player.lng, green.lat, green.lng) : null;

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        mapType="satellite"
        initialRegion={{
          latitude: green.lat,
          longitude: green.lng,
          latitudeDelta: 0.003,
          longitudeDelta: 0.003,
        }}
        showsUserLocation={!!player}
        showsMyLocationButton={false}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        <Marker coordinate={{ latitude: green.lat, longitude: green.lng }} anchor={{ x: 0.5, y: 1 }}>
          <Text style={{ fontSize: 24 }}>⛳</Text>
        </Marker>
        {player && (
          <Polyline
            coordinates={[
              { latitude: player.lat, longitude: player.lng },
              { latitude: green.lat, longitude: green.lng },
            ]}
            strokeColor={colors.gold}
            strokeWidth={2}
            lineDashPattern={[8, 4]}
          />
        )}
      </MapView>
      <View style={styles.badge}>
        {distance !== null ? (
          <>
            <Text style={styles.badgeNum}>{distance}</Text>
            <Text style={styles.badgeLbl}>YDS TO GREEN</Text>
          </>
        ) : (
          <Text style={styles.badgeLbl}>GPS LOCATING…</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 180, borderRadius: radius.lg, overflow: 'hidden',
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.gold,
  },
  map: { flex: 1 },
  badge: {
    position: 'absolute', top: spacing.sm, right: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.78)', borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    alignItems: 'center', borderWidth: 1, borderColor: colors.gold,
  },
  badgeNum: { fontSize: fonts.xxl, fontWeight: '900', color: colors.gold, lineHeight: 28 },
  badgeLbl: { fontSize: 9, fontWeight: '700', color: colors.gold, letterSpacing: 1 },
});
