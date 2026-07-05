import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text,
  TouchableOpacity, View, Dimensions,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../../src/lib/supabase';
import { colors, fonts, radius, spacing } from '../../../../src/lib/theme';
import { speakDebrief } from '../../../../src/lib/caddie';

const { width: SW } = Dimensions.get('window');

// ─── types ───────────────────────────────────────────────────────────────────

interface HoleRow {
  holeNumber: number;
  par: number | null;
  gross: number | null;
  stablefordPts: number | null;
  fairwayDirection: 'left' | 'centre' | 'right' | null;
  putts: number | null;
  clubs: string[];
}

interface ShotPin { lat: number; lng: number }

interface CourseHoleGeo {
  holeNumber: number;
  par: number;
  greenLat: number | null;
  greenLng: number | null;
  frontLat: number | null;
  frontLng: number | null;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function fairwayIcon(dir: 'left' | 'centre' | 'right' | null) {
  if (dir === 'left')   return '◀';
  if (dir === 'centre') return '●';
  if (dir === 'right')  return '▶';
  return '—';
}

function scoreCellColor(pts: number | null) {
  if (pts == null) return colors.textSecondary;
  if (pts >= 4)    return '#D4AF37';
  if (pts === 3)   return colors.green;
  if (pts === 2)   return colors.white;
  if (pts === 1)   return '#f97316';
  return colors.red ?? '#f87171';
}

function ptsBadgeBg(pts: number) {
  if (pts >= 4) return 'rgba(212,175,55,0.15)';
  if (pts === 3) return 'rgba(74,222,128,0.12)';
  if (pts === 2) return 'rgba(59,130,246,0.12)';
  if (pts === 1) return 'rgba(249,115,22,0.12)';
  return 'rgba(248,113,113,0.12)';
}

function ptsBadgeColor(pts: number) {
  if (pts >= 4) return '#D4AF37';
  if (pts === 3) return colors.green;
  if (pts === 2) return '#3b82f6';
  if (pts === 1) return '#f97316';
  return colors.red ?? '#f87171';
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function toParStr(n: number) { return n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`; }
function toParColor(n: number) {
  if (n < 0) return colors.green;
  if (n > 5) return colors.red ?? '#f87171';
  return colors.textSecondary;
}

// ─── sub-components ───────────────────────────────────────────────────────────

function SumCard({ label, value, sub, subColor }: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <View style={ss.sumCard}>
      <Text style={ss.sumVal}>{value}</Text>
      <Text style={ss.sumLbl}>{label}</Text>
      {sub ? <Text style={[ss.sumSub, subColor ? { color: subColor } : {}]}>{sub}</Text> : null}
    </View>
  );
}

// ─── main screen ─────────────────────────────────────────────────────────────

export default function RoundDetailScreen() {
  const router   = useRouter();
  const { matchId } = useLocalSearchParams<{ matchId: string }>();

  const [loading,      setLoading]      = useState(true);
  const [courseName,   setCourseName]   = useState('Round');
  const [playDate,     setPlayDate]     = useState<string | null>(null);
  const [coursePar,    setCoursePar]    = useState(72);
  const [playerName,   setPlayerName]   = useState('');
  const [holes,        setHoles]        = useState<HoleRow[]>([]);
  const [courseGeo,    setCourseGeo]    = useState<Record<number, CourseHoleGeo>>({});
  const [shotsByHole,  setShotsByHole]  = useState<Record<number, ShotPin[]>>({});

  const [activeTab,    setActiveTab]    = useState<'scorecard' | 'shotmap'>('scorecard');
  const [mapHole,      setMapHole]      = useState(1);
  const [debriefing,   setDebriefing]   = useState(false);

  const mapRef = useRef<MapView>(null);

  useEffect(() => { if (matchId) load(); }, [matchId]);

  // Fit map when hole changes
  useEffect(() => {
    if (activeTab !== 'shotmap') return;
    const shots = shotsByHole[mapHole] ?? [];
    const geo   = courseGeo[mapHole];
    const coords: { latitude: number; longitude: number }[] = [];
    shots.forEach(s => coords.push({ latitude: s.lat, longitude: s.lng }));
    if (geo?.greenLat && geo?.greenLng) coords.push({ latitude: geo.greenLat, longitude: geo.greenLng });
    if (coords.length >= 2) {
      mapRef.current?.fitToCoordinates(coords, { edgePadding: { top: 60, bottom: 80, left: 40, right: 40 }, animated: true });
    } else if (coords.length === 1) {
      mapRef.current?.animateToRegion({ latitude: coords[0].latitude, longitude: coords[0].longitude, latitudeDelta: 0.003, longitudeDelta: 0.003 }, 400);
    }
  }, [mapHole, activeTab, shotsByHole, courseGeo]);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: player } = await supabase
      .from('players').select('id, display_name').eq('auth_uid', user.id).maybeSingle();
    if (!player) { setLoading(false); return; }

    const pid = (player as any).id as string;
    setPlayerName((player as any).display_name ?? '');

    const [matchRes, holesRes, statsRes, shotsRes] = await Promise.all([
      supabase
        .from('matches')
        .select('day:day_id(play_date, course_name, course_par)')
        .eq('id', matchId)
        .maybeSingle(),
      supabase
        .from('match_holes')
        .select('hole_number, gross_score, stableford_pts')
        .eq('match_id', matchId)
        .eq('player_id', pid)
        .order('hole_number'),
      supabase
        .from('hole_stats')
        .select('hole_number, fairway_direction, putts')
        .eq('match_id', matchId)
        .eq('player_id', pid),
      supabase
        .from('shots')
        .select('hole_number, clubs(short), lat, lng')
        .eq('match_id', matchId)
        .eq('player_id', pid)
        .order('id'),
    ]);

    const day = (matchRes.data as any)?.day;
    const cName = day?.course_name ?? null;
    if (day) {
      setCourseName(cName ?? 'Unknown Course');
      setPlayDate(day.play_date ?? null);
      setCoursePar(day.course_par ?? 72);
    }

    // Load course hole geometry if we have a course name
    let geoMap: Record<number, CourseHoleGeo> = {};
    if (cName) {
      const { data: geoRows } = await supabase
        .from('course_holes')
        .select('hole_number, par, green_lat, green_lng, front_lat, front_lng')
        .eq('course_name', cName)
        .order('hole_number');
      for (const r of (geoRows ?? []) as any[]) {
        geoMap[r.hole_number] = {
          holeNumber: r.hole_number,
          par:        r.par ?? 4,
          greenLat:   r.green_lat ?? null,
          greenLng:   r.green_lng ?? null,
          frontLat:   r.front_lat ?? null,
          frontLng:   r.front_lng ?? null,
        };
      }
      setCourseGeo(geoMap);
    }

    // Index stats by hole
    const statByHole: Record<number, { fairwayDirection: 'left' | 'centre' | 'right' | null; putts: number | null }> = {};
    for (const r of (statsRes.data ?? []) as any[]) {
      statByHole[r.hole_number] = { fairwayDirection: r.fairway_direction ?? null, putts: r.putts ?? null };
    }

    // Index clubs and GPS shots by hole
    const clubsByHole: Record<number, string[]> = {};
    const shotPinsByHole: Record<number, ShotPin[]> = {};
    for (const r of (shotsRes.data ?? []) as any[]) {
      const hn    = r.hole_number as number;
      const short = (r.clubs as any)?.short;
      if (short) { if (!clubsByHole[hn]) clubsByHole[hn] = []; clubsByHole[hn].push(short); }
      if (r.lat != null && r.lng != null) {
        if (!shotPinsByHole[hn]) shotPinsByHole[hn] = [];
        shotPinsByHole[hn].push({ lat: r.lat, lng: r.lng });
      }
    }
    setShotsByHole(shotPinsByHole);

    const rows: HoleRow[] = ((holesRes.data ?? []) as any[]).map(r => ({
      holeNumber:       r.hole_number,
      par:              geoMap[r.hole_number]?.par ?? null,
      gross:            r.gross_score ?? null,
      stablefordPts:    r.stableford_pts ?? null,
      fairwayDirection: statByHole[r.hole_number]?.fairwayDirection ?? null,
      putts:            statByHole[r.hole_number]?.putts ?? null,
      clubs:            clubsByHole[r.hole_number] ?? [],
    }));

    setHoles(rows);
    setLoading(false);
  }

  // ── computed stats ──────────────────────────────────────────────────────────
  const totalGross      = holes.reduce((s, h) => s + (h.gross ?? 0), 0);
  const totalPts        = holes.reduce((s, h) => s + (h.stablefordPts ?? 0), 0);
  const totalPutts      = holes.reduce((s, h) => s + (h.putts ?? 0), 0);
  const puttsTracked    = holes.filter(h => h.putts != null).length;
  const fairwaysTracked = holes.filter(h => h.fairwayDirection != null).length;
  const fairwaysHit     = holes.filter(h => h.fairwayDirection === 'centre').length;
  const holesPlayed     = holes.filter(h => h.gross != null).length;
  const toPar           = holesPlayed >= 18 ? totalGross - coursePar : null;

  const birdies   = holes.filter(h => (h.stablefordPts ?? 0) >= 3 && h.gross != null).length;
  const bogeys    = holes.filter(h => (h.stablefordPts ?? 0) === 1 && h.gross != null).length;
  const doubles   = holes.filter(h => (h.stablefordPts ?? 0) === 0 && h.gross != null).length;
  const bestHole  = holes.reduce<HoleRow | null>((b, h) => !b || (h.stablefordPts ?? -99) > (b.stablefordPts ?? -99) ? h : b, null);
  const worstHole = holes.reduce<HoleRow | null>((w, h) => {
    if (h.gross == null || h.par == null) return w;
    if (!w || !w.gross || !w.par) return h;
    return (h.gross - h.par) > (w.gross - w.par) ? h : w;
  }, null);

  const hasGpsShots = Object.values(shotsByHole).some(s => s.length > 0);

  async function handleDebrief() {
    if (debriefing || holesPlayed < 9) return;
    setDebriefing(true);
    await speakDebrief({
      player:         playerName || 'mate',
      course:         courseName,
      gross:          totalGross,
      toPar:          toPar ?? totalGross - coursePar,
      stablefordPts:  totalPts,
      putts:          totalPutts,
      fairwaysHit,
      fairwaysTracked,
      birdies,
      bogeys,
      doubles,
      bestHole:  bestHole  ? { hole: bestHole.holeNumber,  pts: bestHole.stablefordPts ?? 0 } : null,
      worstHole: worstHole ? { hole: worstHole.holeNumber, gross: worstHole.gross ?? 0, par: worstHole.par ?? 4 } : null,
    });
    setDebriefing(false);
  }

  // ── current hole for shot map ───────────────────────────────────────────────
  const mapHoleShots  = shotsByHole[mapHole] ?? [];
  const mapHoleGeo    = courseGeo[mapHole] ?? null;
  const mapHoleRow    = holes.find(h => h.holeNumber === mapHole);
  const totalHoles    = holes.length || 18;

  if (loading) {
    return (
      <View style={[ss.container, ss.centered]}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  return (
    <View style={ss.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={ss.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={ss.back}>← Back</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={ss.title} numberOfLines={1}>{courseName}</Text>
          {playDate && <Text style={ss.subtitle}>{formatDate(playDate)}</Text>}
        </View>
        <TouchableOpacity
          style={[ss.debriefBtn, debriefing && ss.debriefBtnBusy]}
          onPress={handleDebrief}
          disabled={debriefing || holesPlayed < 9}
          activeOpacity={0.8}
        >
          <Text style={ss.debriefBtnText}>{debriefing ? '🎙 …' : '🎙 Debrief'}</Text>
        </TouchableOpacity>
      </View>

      {/* Summary row — always visible */}
      <View style={ss.summaryRow}>
        <SumCard label="SCORE" value={String(totalGross)} sub={toPar != null ? toParStr(toPar) : undefined} subColor={toPar != null ? toParColor(toPar) : undefined} />
        <SumCard label="STABLEFORD" value={String(totalPts)} sub="pts" />
        {puttsTracked > 0 && <SumCard label="PUTTS" value={String(totalPutts)} sub={`${puttsTracked} holes`} />}
        {fairwaysTracked > 0 && <SumCard label="FWY" value={`${fairwaysHit}/${fairwaysTracked}`} sub={`${Math.round((fairwaysHit / fairwaysTracked) * 100)}%`} />}
      </View>

      {/* Tab bar */}
      <View style={ss.tabBar}>
        <TouchableOpacity style={[ss.tab, activeTab === 'scorecard' && ss.tabOn]} onPress={() => setActiveTab('scorecard')}>
          <Text style={[ss.tabText, activeTab === 'scorecard' && ss.tabTextOn]}>SCORECARD</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[ss.tab, activeTab === 'shotmap' && ss.tabOn]} onPress={() => setActiveTab('shotmap')}>
          <Text style={[ss.tabText, activeTab === 'shotmap' && ss.tabTextOn]}>SHOT MAP</Text>
        </TouchableOpacity>
      </View>

      {/* ── Scorecard tab ─────────────────────────────────────────────── */}
      {activeTab === 'scorecard' && (
        <ScrollView contentContainerStyle={ss.scroll} showsVerticalScrollIndicator={false}>
          <View style={ss.tableHead}>
            <Text style={[ss.headCell, { width: 32 }]}>H</Text>
            <Text style={[ss.headCell, { width: 36 }]}>SCORE</Text>
            <Text style={[ss.headCell, { width: 36 }]}>PTS</Text>
            <Text style={[ss.headCell, { width: 32 }]}>FWY</Text>
            <Text style={[ss.headCell, { width: 28 }]}>P</Text>
            <Text style={[ss.headCell, { flex: 1 }]}>CLUBS</Text>
          </View>

          {holes.map((h, i) => (
            <View key={h.holeNumber} style={[ss.row, i % 2 === 0 && ss.rowAlt]}>
              <Text style={[ss.cell, ss.holeNum]}>{h.holeNumber}</Text>
              <Text style={[ss.cell, { width: 36, color: scoreCellColor(h.stablefordPts), fontWeight: '700' }]}>
                {h.gross ?? '—'}
              </Text>
              <View style={{ width: 36, alignItems: 'flex-start' }}>
                {h.stablefordPts != null
                  ? <View style={[ss.ptsBadge, { backgroundColor: ptsBadgeBg(h.stablefordPts) }]}>
                      <Text style={[ss.ptsText, { color: ptsBadgeColor(h.stablefordPts) }]}>{h.stablefordPts}</Text>
                    </View>
                  : <Text style={ss.cell}>—</Text>}
              </View>
              <Text style={[ss.cell, { width: 32, fontSize: 14 }]}>{fairwayIcon(h.fairwayDirection)}</Text>
              <Text style={[ss.cell, { width: 28 }]}>{h.putts ?? '—'}</Text>
              <Text style={[ss.cell, { flex: 1, color: colors.textMuted, fontSize: fonts.xs }]} numberOfLines={1}>
                {h.clubs.length > 0 ? h.clubs.join(' · ') : ''}
              </Text>
            </View>
          ))}

          {holes.length === 0 && (
            <View style={ss.empty}>
              <Text style={ss.emptyText}>No hole data recorded</Text>
            </View>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* ── Shot map tab ───────────────────────────────────────────────── */}
      {activeTab === 'shotmap' && (
        <View style={{ flex: 1 }}>
          {!hasGpsShots ? (
            <View style={[ss.centered, { flex: 1, gap: spacing.sm }]}>
              <Text style={{ fontSize: 36 }}>📍</Text>
              <Text style={ss.emptyTitle}>No shot locations yet</Text>
              <Text style={ss.emptySub}>GPS is captured automatically when you log a shot during a round via the voice caddie.</Text>
            </View>
          ) : (
            <>
              {/* Satellite map */}
              <MapView
                ref={mapRef}
                style={{ flex: 1 }}
                mapType="satellite"
                initialRegion={
                  mapHoleShots[0]
                    ? { latitude: mapHoleShots[0].lat, longitude: mapHoleShots[0].lng, latitudeDelta: 0.004, longitudeDelta: 0.004 }
                    : mapHoleGeo?.greenLat != null
                      ? { latitude: mapHoleGeo.greenLat, longitude: mapHoleGeo.greenLng!, latitudeDelta: 0.004, longitudeDelta: 0.004 }
                      : { latitude: 51.5, longitude: -1.8, latitudeDelta: 0.05, longitudeDelta: 0.05 }
                }
              >
                {/* Shot markers */}
                {mapHoleShots.map((s, idx) => (
                  <Marker
                    key={`shot-${idx}`}
                    coordinate={{ latitude: s.lat, longitude: s.lng }}
                    anchor={{ x: 0.5, y: 0.5 }}
                  >
                    <View style={[ss.shotDot, idx === 0 && ss.shotDotFirst, idx === mapHoleShots.length - 1 && ss.shotDotLast]}>
                      <Text style={ss.shotDotText}>{idx + 1}</Text>
                    </View>
                  </Marker>
                ))}

                {/* Shot path polyline */}
                {mapHoleShots.length > 1 && (
                  <Polyline
                    coordinates={mapHoleShots.map(s => ({ latitude: s.lat, longitude: s.lng }))}
                    strokeColor="rgba(212,175,55,0.9)"
                    strokeWidth={2}
                    lineDashPattern={[6, 3]}
                  />
                )}

                {/* Pin marker */}
                {mapHoleGeo?.greenLat != null && (
                  <Marker
                    coordinate={{ latitude: mapHoleGeo.greenLat!, longitude: mapHoleGeo.greenLng! }}
                    anchor={{ x: 0.5, y: 1 }}
                  >
                    <View style={ss.pinMarker}>
                      <Text style={ss.pinText}>⛳</Text>
                    </View>
                  </Marker>
                )}
              </MapView>

              {/* Hole info overlay (top) */}
              <View style={ss.mapOverlayTop}>
                <Text style={ss.mapHoleLabel}>HOLE {mapHole}</Text>
                {mapHoleRow && (
                  <Text style={ss.mapHoleStats}>
                    {mapHoleRow.gross != null ? `${mapHoleRow.gross} gross` : '—'}
                    {mapHoleRow.stablefordPts != null ? `  ·  ${mapHoleRow.stablefordPts} pts` : ''}
                    {mapHoleRow.par != null ? `  ·  par ${mapHoleRow.par}` : ''}
                  </Text>
                )}
                <Text style={ss.mapShotCount}>
                  {mapHoleShots.length > 0 ? `${mapHoleShots.length} shot${mapHoleShots.length !== 1 ? 's' : ''} tracked` : 'No GPS data for this hole'}
                </Text>
              </View>

              {/* Hole nav (bottom) */}
              <View style={ss.holeNav}>
                <TouchableOpacity
                  style={[ss.holeNavArrow, mapHole <= 1 && ss.holeNavArrowOff]}
                  onPress={() => setMapHole(h => Math.max(1, h - 1))}
                  disabled={mapHole <= 1}
                >
                  <Text style={ss.holeNavArrowText}>‹</Text>
                </TouchableOpacity>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ss.holePills}>
                  {Array.from({ length: totalHoles }, (_, i) => i + 1).map(n => {
                    const hasData = (shotsByHole[n]?.length ?? 0) > 0;
                    return (
                      <TouchableOpacity
                        key={n}
                        style={[ss.holePill, n === mapHole && ss.holePillOn, !hasData && ss.holePillEmpty]}
                        onPress={() => setMapHole(n)}
                      >
                        <Text style={[ss.holePillText, n === mapHole && ss.holePillTextOn]}>{n}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <TouchableOpacity
                  style={[ss.holeNavArrow, mapHole >= totalHoles && ss.holeNavArrowOff]}
                  onPress={() => setMapHole(h => Math.min(totalHoles, h + 1))}
                  disabled={mapHole >= totalHoles}
                >
                  <Text style={ss.holeNavArrowText}>›</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const ss = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered:  { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back:     { fontSize: fonts.sm, fontWeight: '600', color: colors.gold },
  title:    { fontSize: fonts.md, fontWeight: '800', color: colors.white, maxWidth: 160, textAlign: 'center' },
  subtitle: { fontSize: fonts.xs, color: colors.textMuted, marginTop: 2 },

  debriefBtn:     { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.goldBorder, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  debriefBtnBusy: { opacity: 0.5 },
  debriefBtnText: { fontSize: fonts.xs, fontWeight: '800', color: colors.gold },

  summaryRow: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, paddingBottom: 0 },
  sumCard: {
    flex: 1, backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.sm, alignItems: 'center',
  },
  sumVal: { fontSize: fonts.lg, fontWeight: '800', color: colors.gold },
  sumLbl: { fontSize: 8, fontWeight: '800', color: colors.textMuted, letterSpacing: 1, marginTop: 1 },
  sumSub: { fontSize: fonts.xs, color: colors.textMuted, marginTop: 1 },

  tabBar: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border,
    marginTop: spacing.md,
  },
  tab:        { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabOn:      { borderBottomWidth: 2, borderBottomColor: colors.gold },
  tabText:    { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.2 },
  tabTextOn:  { color: colors.gold },

  scroll: { padding: spacing.md },

  tableHead: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 2,
  },
  headCell: { fontSize: 9, fontWeight: '800', color: colors.textMuted, letterSpacing: 1 },
  row:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: 8, borderRadius: radius.sm },
  rowAlt: { backgroundColor: 'rgba(255,255,255,0.02)' },
  cell:   { fontSize: fonts.sm, color: colors.textSecondary },
  holeNum:{ width: 32, fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted },
  ptsBadge: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  ptsText:  { fontSize: fonts.xs, fontWeight: '800' },

  empty:     { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: fonts.sm, color: colors.textMuted },
  emptyTitle: { fontSize: fonts.lg, fontWeight: '700', color: colors.textSecondary },
  emptySub:   { fontSize: fonts.sm, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.xl },

  // Shot map
  shotDot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(212,175,55,0.85)',
    borderWidth: 1.5, borderColor: colors.white,
    alignItems: 'center', justifyContent: 'center',
  },
  shotDotFirst: { backgroundColor: '#4ade80' },
  shotDotLast:  { backgroundColor: colors.gold },
  shotDotText:  { fontSize: 9, fontWeight: '800', color: colors.bg },

  pinMarker: { alignItems: 'center' },
  pinText:   { fontSize: 22 },

  mapOverlayTop: {
    position: 'absolute', top: 0, left: 0, right: 0,
    backgroundColor: 'rgba(7,11,16,0.75)',
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm,
    gap: 2,
  },
  mapHoleLabel: { fontSize: fonts.xs, fontWeight: '800', color: colors.gold, letterSpacing: 1.5 },
  mapHoleStats: { fontSize: fonts.sm, fontWeight: '700', color: colors.white },
  mapShotCount: { fontSize: fonts.xs, color: colors.textMuted },

  holeNav: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(7,11,16,0.9)',
    paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  holeNavArrow:     { width: 36, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  holeNavArrowOff:  { opacity: 0.25 },
  holeNavArrowText: { fontSize: 24, fontWeight: '300', color: colors.gold },

  holePills:    { flexDirection: 'row', gap: 6, paddingHorizontal: spacing.xs },
  holePill:     { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  holePillOn:   { backgroundColor: colors.gold, borderColor: colors.gold },
  holePillEmpty:{ opacity: 0.35 },
  holePillText:     { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted },
  holePillTextOn:   { color: colors.bg },
});
