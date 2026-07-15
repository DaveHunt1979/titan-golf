import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, ScrollView, StyleSheet, Text,
  TouchableOpacity, View, Dimensions,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../../src/lib/supabase';
import { speakDebrief } from '../../../../src/lib/caddie';

// ─── TITAN design constants ───────────────────────────────────────────────────

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';

const titanLogo = require('../../../../assets/TitanAppLogo.png');

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
  if (pts == null) return '#9ca3af';
  if (pts >= 4)    return GOLD;
  if (pts === 3)   return GREEN;
  if (pts === 2)   return '#fff';
  if (pts === 1)   return '#f97316';
  return RED;
}

function ptsBadgeBg(pts: number) {
  if (pts >= 4) return 'rgba(212,175,55,0.15)';
  if (pts === 3) return 'rgba(74,222,128,0.12)';
  if (pts === 2) return 'rgba(59,130,246,0.12)';
  if (pts === 1) return 'rgba(249,115,22,0.12)';
  return 'rgba(248,113,113,0.12)';
}

function ptsBadgeColor(pts: number) {
  if (pts >= 4) return GOLD;
  if (pts === 3) return GREEN;
  if (pts === 2) return '#3b82f6';
  if (pts === 1) return '#f97316';
  return RED;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function toParStr(n: number) { return n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`; }
function toParColor(n: number) {
  if (n < 0) return GREEN;
  if (n > 5) return RED;
  return '#9ca3af';
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

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

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

  if (loading || !fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar style="light" />
        <ActivityIndicator color={GOLD} size="large" />
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
          {holes.length === 0 ? (
            <View style={ss.empty}>
              <Text style={ss.emptyText}>No hole data recorded</Text>
            </View>
          ) : (
            <>
              {([{ start: 1, label: 'FRONT 9' }, { start: 10, label: 'BACK 9' }] as const).map(({ start, label }) => {
                const nineHoles = Array.from({ length: 9 }, (_, i) => {
                  const n = start + i;
                  const played = holes.find(h => h.holeNumber === n);
                  return {
                    holeNumber: n,
                    par: played?.par ?? courseGeo[n]?.par ?? null,
                    gross: played?.gross ?? null,
                    stablefordPts: played?.stablefordPts ?? null,
                    putts: played?.putts ?? null,
                    fairwayDirection: played?.fairwayDirection ?? null,
                  };
                });
                const ninePar   = nineHoles.reduce((s, h) => s + (h.par ?? 0), 0);
                const nineGross = nineHoles.reduce((s, h) => s + (h.gross ?? 0), 0);
                const ninePts   = nineHoles.reduce((s, h) => s + (h.stablefordPts ?? 0), 0);
                const ninePutts = nineHoles.reduce((s, h) => s + (h.putts ?? 0), 0);
                const hasAny    = nineHoles.some(h => h.gross != null);
                return (
                  <View key={label} style={ss.nineBlock}>
                    {/* Column headers */}
                    <View style={[ss.scRow, ss.scHeadRow]}>
                      <Text style={[ss.scHead, { width: 38 }]}>{label}</Text>
                      <Text style={[ss.scHead, { width: 38 }]}>PAR</Text>
                      <Text style={[ss.scHead, { flex: 1 }]}>SCORE</Text>
                      <Text style={[ss.scHead, { flex: 1 }]}>PTS</Text>
                      <Text style={[ss.scHead, { width: 52 }]}>PUTTS</Text>
                    </View>

                    {nineHoles.map((h, idx) => {
                      const diff = h.gross != null && h.par != null ? h.gross - h.par : null;
                      const isEagle  = diff != null && diff <= -2;
                      const isBirdie = diff === -1;
                      const isBogey  = diff === 1;
                      const isDouble = diff != null && diff >= 2;
                      return (
                        <View key={h.holeNumber} style={[ss.scRow, idx % 2 === 1 && ss.scRowAlt]}>
                          <Text style={[ss.scCell, { width: 38, color: GOLD, fontFamily: FFB }]}>{h.holeNumber}</Text>
                          <Text style={[ss.scCell, { width: 38, color: '#6b7280' }]}>{h.par ?? '—'}</Text>
                          <View style={{ flex: 1, alignItems: 'center' }}>
                            {h.gross != null ? (
                              <View style={[
                                ss.scoreBox,
                                isEagle  && ss.eagleBox,
                                isBirdie && ss.birdieBox,
                                isBogey  && ss.bogeyBox,
                                isDouble && ss.doubleBox,
                              ]}>
                                <Text style={[ss.scoreBoxText, (isEagle || isBirdie) && { color: '#000' }]}>
                                  {h.gross}
                                </Text>
                              </View>
                            ) : <Text style={ss.scEmpty}>—</Text>}
                          </View>
                          <View style={{ flex: 1, alignItems: 'center' }}>
                            {h.stablefordPts != null ? (
                              <View style={[ss.ptsBadge, { backgroundColor: ptsBadgeBg(h.stablefordPts) }]}>
                                <Text style={[ss.ptsText, { color: ptsBadgeColor(h.stablefordPts) }]}>{h.stablefordPts}</Text>
                              </View>
                            ) : <Text style={ss.scEmpty}>—</Text>}
                          </View>
                          <Text style={[ss.scCell, { width: 52, color: h.putts != null ? '#fff' : '#444' }]}>
                            {h.putts ?? '—'}
                          </Text>
                        </View>
                      );
                    })}

                    {/* Nine total */}
                    {hasAny && (
                      <View style={[ss.scRow, ss.nineTotalRow]}>
                        <Text style={[ss.nineTotalLabel, { width: 38 }]}>TOT</Text>
                        <Text style={[ss.nineTotalVal, { width: 38 }]}>{ninePar || '—'}</Text>
                        <Text style={[ss.nineTotalVal, { flex: 1, color: GOLD, textAlign: 'center' }]}>{nineGross || '—'}</Text>
                        <Text style={[ss.nineTotalVal, { flex: 1, color: GREEN, textAlign: 'center' }]}>{ninePts}pts</Text>
                        <Text style={[ss.nineTotalVal, { width: 52 }]}>{ninePutts || '—'}</Text>
                      </View>
                    )}
                  </View>
                );
              })}

              {/* Grand total */}
              <View style={ss.grandTotal}>
                <View style={ss.grandRow}>
                  <Text style={ss.grandLabel}>GROSS</Text>
                  <Text style={ss.grandValue}>{totalGross}</Text>
                  {toPar != null && <Text style={[ss.grandToPar, { color: toParColor(toPar) }]}>{toParStr(toPar)}</Text>}
                </View>
                <View style={ss.grandDivider} />
                <View style={ss.grandRow}>
                  <Text style={ss.grandLabel}>STABLEFORD</Text>
                  <Text style={[ss.grandValue, { color: GREEN }]}>{totalPts} pts</Text>
                </View>
                {puttsTracked > 0 && (
                  <>
                    <View style={ss.grandDivider} />
                    <View style={ss.grandRow}>
                      <Text style={ss.grandLabel}>PUTTS</Text>
                      <Text style={ss.grandValue}>{totalPutts}</Text>
                    </View>
                  </>
                )}
              </View>
            </>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* ── Shot map tab ───────────────────────────────────────────────── */}
      {activeTab === 'shotmap' && (
        <View style={{ flex: 1 }}>
          {!hasGpsShots ? (
            <View style={[ss.centered, { flex: 1, gap: 8 }]}>
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
  container: { flex: 1, backgroundColor: '#000' },
  centered:  { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  back:     { fontSize: 14, fontFamily: FFB, color: GOLD },
  title:    { fontSize: 15, fontFamily: FFB, color: '#fff', maxWidth: 160, textAlign: 'center' },
  subtitle: { fontSize: 12, fontFamily: FFB, color: '#fff', marginTop: 2 },

  debriefBtn:     { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  debriefBtnBusy: { opacity: 0.5 },
  debriefBtnText: { fontSize: 12, fontFamily: FFB, color: GOLD },

  summaryRow: { flexDirection: 'row', gap: 8, padding: 16, paddingBottom: 0 },
  sumCard: {
    flex: 1, backgroundColor: '#111', borderRadius: 12,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingVertical: 8, alignItems: 'center',
  },
  sumVal: { fontSize: 20, fontFamily: FFB, color: GOLD },
  sumLbl: { fontSize: 8, fontFamily: FFB, color: '#fff', letterSpacing: 1, marginTop: 1 },
  sumSub: { fontSize: 12, fontFamily: FFB, color: '#fff', marginTop: 1 },

  tabBar: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
    marginTop: 16,
  },
  tab:        { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabOn:      { borderBottomWidth: 2, borderBottomColor: GOLD },
  tabText:    { fontSize: 12, fontFamily: FFB, color: '#fff', letterSpacing: 1.2 },
  tabTextOn:  { color: GOLD },

  scroll: { padding: 16, gap: 16 },

  // PGA-style scorecard
  nineBlock: { borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden', marginBottom: 0 },

  scRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 11, backgroundColor: '#111' },
  scRowAlt:  { backgroundColor: '#0d0d0d' },
  scHeadRow: { backgroundColor: '#1a1610', paddingVertical: 9 },
  scHead:    { fontSize: 9, fontFamily: FFB, color: GOLD, letterSpacing: 1.5, textAlign: 'center' },
  scCell:   { fontSize: 14, fontFamily: FFB, color: '#fff', textAlign: 'center' },
  scEmpty:  { fontSize: 13, color: '#444', fontFamily: FFB },

  scoreBox: {
    width: 34, height: 34, borderRadius: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  scoreBoxText: { fontSize: 14, fontFamily: FFB, color: '#fff' },
  eagleBox:  { backgroundColor: GOLD, borderRadius: 17 },
  birdieBox: { backgroundColor: GREEN, borderRadius: 17 },
  bogeyBox:  { borderWidth: 1.5, borderColor: '#f97316' },
  doubleBox: { borderWidth: 2, borderColor: RED },

  ptsBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4, minWidth: 30, alignItems: 'center' },
  ptsText:  { fontSize: 13, fontFamily: FFB },

  nineTotalRow:   { backgroundColor: '#1a1610', borderTopWidth: 1, borderTopColor: '#2a2218' },
  nineTotalLabel: { fontSize: 9, fontFamily: FFB, color: GOLD, letterSpacing: 1 },
  nineTotalVal:   { fontSize: 14, fontFamily: FFB, color: '#fff' },

  grandTotal: { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 16, gap: 10 },
  grandRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grandLabel: { flex: 1, fontSize: 11, fontFamily: FFB, color: '#6b7280', letterSpacing: 1 },
  grandValue: { fontSize: 22, fontFamily: FFB, color: '#fff' },
  grandToPar: { fontSize: 16, fontFamily: FFB },
  grandDivider: { height: 1, backgroundColor: '#1c1c1c' },

  empty:      { alignItems: 'center', paddingTop: 60 },
  emptyText:  { fontSize: 14, fontFamily: FFB, color: '#fff' },
  emptyTitle: { fontSize: 20, fontFamily: FFB, color: '#444' },
  emptySub:   { fontSize: 14, fontFamily: FFB, color: '#fff', textAlign: 'center', paddingHorizontal: 32 },

  // Shot map
  shotDot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(212,175,55,0.85)',
    borderWidth: 1.5, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  shotDotFirst: { backgroundColor: GREEN },
  shotDotLast:  { backgroundColor: GOLD },
  shotDotText:  { fontSize: 9, fontFamily: FFB, color: '#000' },

  pinMarker: { alignItems: 'center' },
  pinText:   { fontSize: 22 },

  mapOverlayTop: {
    position: 'absolute', top: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8,
    gap: 2,
  },
  mapHoleLabel: { fontSize: 12, fontFamily: FFB, color: GOLD, letterSpacing: 1.5 },
  mapHoleStats: { fontSize: 14, fontFamily: FFB, color: '#fff' },
  mapShotCount: { fontSize: 12, fontFamily: FFB, color: '#fff' },

  holeNav: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(7,11,16,0.9)',
    paddingVertical: 8, paddingHorizontal: 8,
    borderTopWidth: 1, borderTopColor: '#1c1c1c',
  },
  holeNavArrow:     { width: 36, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  holeNavArrowOff:  { opacity: 0.25 },
  holeNavArrowText: { fontSize: 24, fontFamily: FFB, color: GOLD },

  holePills:        { flexDirection: 'row', gap: 6, paddingHorizontal: 4 },
  holePill:         { width: 32, height: 32, borderRadius: 16, backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c', alignItems: 'center', justifyContent: 'center' },
  holePillOn:       { backgroundColor: GOLD, borderColor: GOLD },
  holePillEmpty:    { opacity: 0.35 },
  holePillText:     { fontSize: 12, fontFamily: FFB, color: '#fff' },
  holePillTextOn:   { color: '#000' },
});
