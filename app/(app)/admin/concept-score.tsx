/**
 * Concept Preview — TITAN premium Score Entry screen
 * Mock data — shows design only, no live match needed
 */
import { useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Image, Modal, Dimensions, Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';

const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const RED    = '#f87171';
const BLUE   = '#3b82f6';
const ORANGE = '#f97316';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';
const { width: W } = Dimensions.get('window');

// ── Mock data ─────────────────────────────────────────────────
const HOME_COLOR = GOLD;
const AWAY_COLOR = '#6366f1';

const PLAYERS = [
  { id: 'p1', name: 'Dave Hunt',     first: 'Dave',    team: 'home', hcp: 14, avatar: null },
  { id: 'p2', name: 'Mark Taylor',   first: 'Mark',    team: 'home', hcp: 8,  avatar: null },
  { id: 'p3', name: 'Ricky Snell',   first: 'Rick',    team: 'away', hcp: 6,  avatar: null },
  { id: 'p4', name: 'Paul Johnson',  first: 'Paul',    team: 'away', hcp: 18, avatar: null },
];

const COURSE_HOLES = [
  { hole: 1,  par: 4, si: 7,  yards: 385 },
  { hole: 2,  par: 3, si: 15, yards: 165 },
  { hole: 3,  par: 5, si: 1,  yards: 520 },
  { hole: 4,  par: 4, si: 11, yards: 365 },
  { hole: 5,  par: 4, si: 5,  yards: 410 },
  { hole: 6,  par: 3, si: 17, yards: 145 },
  { hole: 7,  par: 4, si: 9,  yards: 390 },
  { hole: 8,  par: 4, si: 3,  yards: 415 },
  { hole: 9,  par: 5, si: 13, yards: 495 },
  { hole: 10, par: 4, si: 2,  yards: 430 },
  { hole: 11, par: 4, si: 8,  yards: 355 },
  { hole: 12, par: 3, si: 16, yards: 175 },
  { hole: 13, par: 4, si: 6,  yards: 400 },
  { hole: 14, par: 5, si: 4,  yards: 510 },
  { hole: 15, par: 4, si: 10, yards: 375 },
  { hole: 16, par: 3, si: 18, yards: 155 },
  { hole: 17, par: 4, si: 12, yards: 360 },
  { hole: 18, par: 5, si: 14, yards: 505 },
];

// h=home wins, a=away wins, f=halved, .=unplayed
const INITIAL_HOLES = 'hhfahff...........';

// Mock gross scores per player per hole
const MOCK_SCORES: Record<string, Record<number, number>> = {
  p1: { 1: 4, 2: 3, 3: 6, 4: 5, 5: 4, 6: 2, 7: 4 },
  p2: { 1: 4, 2: 3, 3: 5, 4: 4, 5: 4, 6: 3, 7: 4 },
  p3: { 1: 5, 2: 3, 3: 5, 4: 4, 5: 5, 6: 3, 7: 4 },
  p4: { 1: 5, 2: 4, 3: 6, 4: 5, 5: 5, 6: 3, 7: 5 },
};

// Stableford pts per player per played hole (pre-calculated from MOCK_SCORES + handicaps)
const MOCK_PTS: Record<string, Record<number, number>> = {
  p1: { 1: 3, 2: 2, 3: 2, 4: 2, 5: 3, 6: 3, 7: 3 },
  p2: { 1: 3, 2: 2, 3: 3, 4: 2, 5: 3, 6: 2, 7: 2 },
  p3: { 1: 1, 2: 2, 3: 3, 4: 2, 5: 2, 6: 2, 7: 2 },
  p4: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 3, 7: 2 },
};

// Running stableford totals (sum of MOCK_PTS rows)
const PLAYER_PTS: Record<string, number> = { p1: 18, p2: 17, p3: 14, p4: 15 };

function initials(name: string) { return name.charAt(0).toUpperCase(); }

function holeResultColor(c: string): string {
  if (c === 'h') return HOME_COLOR;
  if (c === 'a') return AWAY_COLOR;
  if (c === 'f') return '#4b5563';
  return 'transparent';
}

function scoreVsPar(gross: number, par: number, shots: number): 'eagle' | 'birdie' | 'par' | 'bogey' | 'double' {
  const net = gross - shots;
  const diff = net - par;
  if (diff <= -2) return 'eagle';
  if (diff === -1) return 'birdie';
  if (diff === 0)  return 'par';
  if (diff === 1)  return 'bogey';
  return 'double';
}

function ptsColor(pts: number): string {
  if (pts >= 4) return GOLD;
  if (pts === 3) return GREEN;
  if (pts === 2) return BLUE;
  if (pts === 1) return ORANGE;
  return RED;
}

const SCORE_COLORS = { eagle: GOLD, birdie: GREEN, par: BLUE, bogey: ORANGE, double: RED };

// ── Avatar circle ─────────────────────────────────────────────
function Avatar({ name, color, size = 36 }: { name: string; color: string; size?: number }) {
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: `${color}20`,
      borderWidth: 1.5, borderColor: `${color}60`,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ fontFamily: FF, fontSize: size * 0.4, color }}>{initials(name)}</Text>
    </View>
  );
}

// ── Score entry sheet ─────────────────────────────────────────
function ScoreSheet({
  visible, playerIdx, players, holeInfo, onSubmit, onClose,
}: {
  visible: boolean;
  playerIdx: number;
  players: typeof PLAYERS;
  holeInfo: typeof COURSE_HOLES[0];
  onSubmit: (score: number, fairway: string | null, putts: number | null) => void;
  onClose: () => void;
}) {
  const [score,   setScore]   = useState<number | null>(null);
  const [fairway, setFairway] = useState<'left' | 'centre' | 'right' | null>(null);
  const [putts,   setPutts]   = useState<number | null>(null);
  const player = players[playerIdx];
  if (!player) return null;
  const teamColor = player.team === 'home' ? HOME_COLOR : AWAY_COLOR;
  const scores = Array.from({ length: 9 }, (_, i) => i + 1);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={sh.overlay}>
        <View style={sh.sheet}>
          <View style={sh.handle} />

          {/* Player header */}
          <View style={sh.playerRow}>
            <Avatar name={player.name} color={teamColor} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={sh.playerName}>{player.name}</Text>
              <Text style={sh.playerInfo}>HCP {player.hcp} · Hole {holeInfo.hole} · Par {holeInfo.par} · SI {holeInfo.si}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>

          {/* Score picker */}
          <Text style={sh.pickerLabel}>GROSS SCORE</Text>
          <View style={sh.scoreGrid}>
            {scores.map(n => {
              const on = score === n;
              const diff = n - holeInfo.par;
              let accent = '#6b7280';
              if (diff <= -2) accent = GOLD;
              else if (diff === -1) accent = GREEN;
              else if (diff === 0)  accent = BLUE;
              else if (diff === 1)  accent = ORANGE;
              else accent = RED;
              return (
                <TouchableOpacity
                  key={n}
                  style={[sh.scoreBtn, on && { backgroundColor: `${accent}20`, borderColor: accent }]}
                  onPress={() => setScore(n)}
                  activeOpacity={0.7}
                >
                  <Text style={[sh.scoreBtnText, on && { color: accent }]}>{n}</Text>
                  {on && <Text style={[sh.scoreDiff, { color: accent }]}>
                    {diff === 0 ? 'PAR' : diff < 0 ? `${diff}` : `+${diff}`}
                  </Text>}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Fairway (par 4+) */}
          {holeInfo.par >= 4 && (
            <>
              <Text style={sh.pickerLabel}>FAIRWAY</Text>
              <View style={sh.fairwayRow}>
                {(['left', 'centre', 'right'] as const).map(d => (
                  <TouchableOpacity
                    key={d}
                    style={[sh.fairwayBtn, fairway === d && sh.fairwayBtnOn]}
                    onPress={() => setFairway(prev => prev === d ? null : d)}
                    activeOpacity={0.7}
                  >
                    <Text style={[sh.fairwayText, fairway === d && sh.fairwayTextOn]}>
                      {d.charAt(0).toUpperCase() + d.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* Putts */}
          <Text style={sh.pickerLabel}>PUTTS</Text>
          <View style={sh.puttsRow}>
            {[1, 2, 3, 4].map(n => (
              <TouchableOpacity
                key={n}
                style={[sh.puttsBtn, putts === n && sh.puttsBtnOn]}
                onPress={() => setPutts(prev => prev === n ? null : n)}
                activeOpacity={0.7}
              >
                <Text style={[sh.puttsText, putts === n && sh.puttsTextOn]}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Submit */}
          <TouchableOpacity
            style={[sh.submitBtn, !score && sh.submitBtnOff]}
            onPress={() => { if (score) { onSubmit(score, fairway, putts); setScore(null); setFairway(null); setPutts(null); } }}
            activeOpacity={0.8}
            disabled={!score}
          >
            <Text style={sh.submitText}>
              {playerIdx < players.length - 1 ? `Next Player →` : '✓ Save Hole'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────
export default function ConceptScoreScreen() {
  const router = useRouter();
  const [fontsLoaded] = useFonts({
    'JUSTSans':         require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold':  require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [holesStr,    setHolesStr]    = useState(INITIAL_HOLES);
  const [activeHole,  setActiveHole]  = useState(8); // first unplayed
  const [page,        setPage]        = useState(0);
  const [showScore,   setShowScore]   = useState(false);
  const [scorePlayer, setScorePlayer] = useState(0);

  const pagerRef    = useRef<ScrollView>(null);
  const holeStripRef = useRef<ScrollView>(null);

  const holeChars  = holesStr.split('');
  const currentHole = holeChars.findIndex(c => c === '.') + 1 || 19;
  const holeInfo   = COURSE_HOLES.find(h => h.hole === activeHole)!;
  const { homeUp, played } = (() => {
    let up = 0, done = 0;
    for (const c of holeChars) {
      if (c === 'h') { up++; done++; }
      else if (c === 'a') { up--; done++; }
      else if (c === 'f') done++;
    }
    return { homeUp: up, played: done };
  })();

  const statusText = homeUp === 0
    ? 'All Square'
    : homeUp > 0
      ? `Dave & Mark  ${homeUp} Up`
      : `Rick & Paul  ${Math.abs(homeUp)} Up`;
  const holesLeft = 18 - played;
  const statusColor = homeUp >= 0 ? HOME_COLOR : AWAY_COLOR;

  function openScore() {
    setScorePlayer(0);
    setShowScore(true);
  }

  function handleScoreSubmit(_score: number, _fw: string | null, _putts: number | null) {
    if (scorePlayer < PLAYERS.length - 1) {
      setScorePlayer(p => p + 1);
    } else {
      setShowScore(false);
      setScorePlayer(0);
      // Mark hole as halved (demo)
      const chars = [...holeChars];
      chars[activeHole - 1] = 'f';
      setHolesStr(chars.join(''));
      const next = chars.findIndex(c => c === '.') + 1;
      if (next > 0 && next <= 18) setActiveHole(next);
    }
  }

  if (!fontsLoaded) return null;

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerSide} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={require('../../../assets/TitanAppLogo.png')} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerSub}>West Cliffs · 4BBB Matchplay</Text>
        </View>
        <TouchableOpacity style={s.headerSide} onPress={() => router.push('/(app)/rangefinder' as any)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="scan-outline" size={22} color={GOLD} />
        </TouchableOpacity>
      </View>

      {/* ── Live status banner ── */}
      <View style={s.statusBanner}>
        <Text style={[s.statusMain, { color: statusColor }]}>{statusText}</Text>
        <Text style={s.statusSub}>
          {played === 0 ? 'Not started' : holesLeft > 0 ? `${holesLeft} holes to play` : 'Match complete'}
        </Text>
      </View>

      {/* ── Hole strip (scrollable, bigger tiles) ── */}
      <ScrollView
        ref={holeStripRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.holeStrip}
        style={s.holeStripWrap}
      >
        {COURSE_HOLES.map(h => {
          const c = holeChars[h.hole - 1] ?? '.';
          const isActive = h.hole === activeHole;
          const isPlayed = c !== '.';
          const isCurrent = h.hole === currentHole;
          const resultColor = holeResultColor(c);

          return (
            <TouchableOpacity
              key={h.hole}
              style={[
                s.holeTile,
                isActive && s.holeTileActive,
                isPlayed && { backgroundColor: `${resultColor}22`, borderColor: `${resultColor}60` },
              ]}
              onPress={() => {
                setActiveHole(h.hole);
                if (isPlayed) openScore();
              }}
              activeOpacity={0.7}
            >
              <Text style={[s.holeTileNum, isActive && { color: GOLD }]}>{h.hole}</Text>
              <Text style={[s.holeTilePar, isActive && { color: `${GOLD}80` }]}>P{h.par}</Text>
              {isPlayed && (() => {
                // Best-ball pts for home team on this hole
                const bp = Math.max(MOCK_PTS.p1?.[h.hole] ?? 0, MOCK_PTS.p2?.[h.hole] ?? 0);
                const pc = ptsColor(bp);
                return (
                  <Text style={[s.holeTilePts, { color: pc }]}>{bp}</Text>
                );
              })()}
              {isCurrent && !isPlayed && (
                <View style={[s.holeTileDot, { backgroundColor: GOLD, opacity: 0.5 }]} />
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      {/* 9-hole labels */}
      <View style={s.halfLabels}>
        <Text style={s.halfLabel}>FRONT 9</Text>
        <Text style={s.halfLabel}>BACK 9</Text>
      </View>

      {/* ── Page swiper ── */}
      <ScrollView
        ref={pagerRef}
        horizontal pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={e => setPage(Math.round(e.nativeEvent.contentOffset.x / W))}
        style={{ flex: 1 }}
      >
        {/* ── Page 0: Current hole ── */}
        <ScrollView style={{ width: W }} showsVerticalScrollIndicator={false} contentContainerStyle={s.pageContent}>

          {/* Hole info card */}
          <View style={s.holeCard}>
            <View style={s.holeCardTop}>
              {/* Big hole number */}
              <View style={s.holeNumberBlock}>
                <Text style={s.holeWord}>HOLE</Text>
                <Text style={s.holeBig}>{activeHole}</Text>
                <View style={s.holeChips}>
                  <View style={s.holeChip}><Text style={s.holeChipText}>Par {holeInfo.par}</Text></View>
                  <View style={s.holeChip}><Text style={s.holeChipText}>SI {holeInfo.si}</Text></View>
                  <View style={s.holeChip}><Text style={s.holeChipText}>{holeInfo.yards}y</Text></View>
                </View>
              </View>

              {/* Divider */}
              <View style={s.holeCardDivider} />

              {/* Mini leaderboard */}
              <View style={s.leaderboard}>
                {PLAYERS.map((p, i) => {
                  const teamColor = p.team === 'home' ? HOME_COLOR : AWAY_COLOR;
                  const pts = PLAYER_PTS[p.id];
                  const isLeader = i === 0;
                  return (
                    <View key={p.id} style={s.lbRow}>
                      <Avatar name={p.name} color={teamColor} size={32} />
                      <Text style={[s.lbName, !isLeader && { opacity: 0.5 }]} numberOfLines={1}>{p.first}</Text>
                      <Text style={[s.lbPts, { color: isLeader ? GOLD : '#6b7280' }]}>
                        {pts}pts
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Gets a shot row */}
            <View style={s.shotRow}>
              <View style={s.shotBadge}>
                <Ionicons name="golf-outline" size={12} color={GOLD} />
                <Text style={s.shotText}>Gets a shot: Dave, Paul</Text>
              </View>
            </View>

            {/* Quick actions */}
            <View style={s.actionsRow}>
              <TouchableOpacity style={s.actionBtn} onPress={() => router.push('/(app)/rangefinder' as any)} activeOpacity={0.7}>
                <Ionicons name="scan-outline" size={20} color={GOLD} />
                <Text style={s.actionLabel}>RANGE</Text>
              </TouchableOpacity>
              <View style={s.actionSep} />
              <TouchableOpacity style={s.actionBtn} activeOpacity={0.7}>
                <Ionicons name="analytics-outline" size={20} color={GOLD} />
                <Text style={s.actionLabel}>SHOTS</Text>
              </TouchableOpacity>
              <View style={s.actionSep} />
              <TouchableOpacity style={s.actionBtn} activeOpacity={0.7}>
                <Ionicons name="mic-outline" size={20} color={GOLD} />
                <Text style={s.actionLabel}>CADDIE</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Undo / back a hole */}
          {played > 0 && (
            <TouchableOpacity
              style={s.undoBtn}
              onPress={() => {
                const last = holeChars.map((c, i) => c !== '.' ? i + 1 : 0).filter(Boolean).pop();
                if (last) { setActiveHole(last); openScore(); }
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-undo-outline" size={16} color="#6b7280" />
              <Text style={s.undoBtnText}>Go back · edit hole {played}</Text>
            </TouchableOpacity>
          )}

          {/* Page hint */}
          <View style={s.pageHint}>
            <View style={[s.pageDot, page === 0 && s.pageDotActive]} />
            <View style={[s.pageDot, page === 1 && s.pageDotActive]} />
            <View style={[s.pageDot, page === 2 && s.pageDotActive]} />
          </View>
        </ScrollView>

        {/* ── Page 1: Front 9 scorecard ── */}
        <ScrollView style={{ width: W }} showsVerticalScrollIndicator={false} contentContainerStyle={s.pageContent}>
          <ScorecardPage half="front" holeChars={holeChars} />
        </ScrollView>

        {/* ── Page 2: Back 9 scorecard ── */}
        <ScrollView style={{ width: W }} showsVerticalScrollIndicator={false} contentContainerStyle={s.pageContent}>
          <ScorecardPage half="back" holeChars={holeChars} />
        </ScrollView>
      </ScrollView>

      {/* ── Enter score CTA ── */}
      {currentHole <= 18 && (
        <View style={s.ctaWrap}>
          <TouchableOpacity style={s.ctaBtn} onPress={openScore} activeOpacity={0.85}>
            <Ionicons name="create-outline" size={20} color="#000" />
            <Text style={s.ctaText}>Enter Score · Hole {activeHole}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Score entry sheet ── */}
      <ScoreSheet
        visible={showScore}
        playerIdx={scorePlayer}
        players={PLAYERS}
        holeInfo={holeInfo}
        onSubmit={handleScoreSubmit}
        onClose={() => setShowScore(false)}
      />
    </View>
  );
}

// ── Scorecard page ────────────────────────────────────────────
function ScorecardPage({ half, holeChars }: { half: 'front' | 'back'; holeChars: string[] }) {
  const holes = COURSE_HOLES.filter(h => half === 'front' ? h.hole <= 9 : h.hole > 9);
  const totalPar = holes.reduce((a, h) => a + h.par, 0);

  return (
    <View style={sc.container}>
      <Text style={sc.title}>{half === 'front' ? 'FRONT 9' : 'BACK 9'}</Text>

      {/* Header row */}
      <View style={sc.headerRow}>
        <Text style={[sc.cell, sc.labelCell]}>PLAYER</Text>
        {holes.map(h => (
          <Text key={h.hole} style={[sc.cell, sc.holeCell, h.hole === (half === 'front' ? 8 : 15) && { color: GOLD }]}>
            {h.hole}
          </Text>
        ))}
        <Text style={[sc.cell, sc.totalCell]}>TOT</Text>
      </View>

      {/* Par row */}
      <View style={[sc.row, { backgroundColor: '#0a0a0a' }]}>
        <Text style={[sc.cell, sc.labelCell, { color: GOLD }]}>PAR</Text>
        {holes.map(h => <Text key={h.hole} style={[sc.cell, sc.holeCell, { color: GOLD }]}>{h.par}</Text>)}
        <Text style={[sc.cell, sc.totalCell, { color: GOLD }]}>{totalPar}</Text>
      </View>

      {/* SI row */}
      <View style={sc.row}>
        <Text style={[sc.cell, sc.labelCell, { color: '#6b7280' }]}>SI</Text>
        {holes.map(h => <Text key={h.hole} style={[sc.cell, sc.holeCell, { color: '#6b7280', fontSize: 9 }]}>{h.si}</Text>)}
        <Text style={[sc.cell, sc.totalCell, { color: '#6b7280' }]}>—</Text>
      </View>

      {/* Player rows */}
      {PLAYERS.map((p, pi) => {
        const teamColor = p.team === 'home' ? HOME_COLOR : AWAY_COLOR;
        let total = 0;
        return (
          <View key={p.id} style={[sc.row, pi % 2 === 0 && { backgroundColor: '#0d0d0d' }]}>
            <View style={[sc.cell, sc.labelCell, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: teamColor }} />
              <Text style={{ fontFamily: FF, fontSize: 11, color: '#ffffff' }} numberOfLines={1}>{p.first}</Text>
            </View>
            {holes.map(h => {
              const gross = MOCK_SCORES[p.id]?.[h.hole];
              const shots = h.si <= p.hcp ? 1 : 0;
              const result = gross ? scoreVsPar(gross, h.par, shots) : null;
              const color = result ? SCORE_COLORS[result] : '#444';
              if (gross) total += gross;
              const pts = MOCK_PTS[p.id]?.[h.hole];
              return (
                <View key={h.hole} style={[sc.cell, sc.holeCell, { gap: 2 }]}>
                  {gross ? (
                    <>
                      <View style={[sc.scorePill, { borderColor: `${color}50`, backgroundColor: `${color}12` }]}>
                        <Text style={[sc.scorePillText, { color }]}>{gross}</Text>
                      </View>
                      <Text style={[sc.ptsText, { color: ptsColor(pts ?? 0) }]}>
                        {pts ?? ''}
                      </Text>
                    </>
                  ) : (
                    <Text style={{ fontFamily: FF, fontSize: 11, color: '#333', textAlign: 'center' }}>—</Text>
                  )}
                </View>
              );
            })}
            <Text style={[sc.cell, sc.totalCell, { color: total > 0 ? '#ffffff' : '#333' }]}>
              {total > 0 ? total : '—'}
            </Text>
          </View>
        );
      })}

      <Text style={sc.swipeHint}>← Swipe to switch view</Text>
    </View>
  );
}

// ── Main styles ───────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 56, paddingHorizontal: 16, paddingBottom: 8,
  },
  headerSide:   { width: 40 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerLogo:   { width: 28, height: 28, marginBottom: 2 },
  headerSub:    { fontFamily: FF, fontSize: 11, color: '#6b7280', letterSpacing: 0.5 },

  // Status banner
  statusBanner: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16 },
  statusMain:   { fontFamily: FF, fontSize: 22, letterSpacing: -0.3 },
  statusSub:    { fontFamily: FF, fontSize: 12, color: '#6b7280', marginTop: 2 },

  // Hole strip
  holeStripWrap: { maxHeight: 72 },
  holeStrip:     { paddingHorizontal: 12, paddingVertical: 6, gap: 6, alignItems: 'center' },
  holeTile: {
    width: 42, height: 58, borderRadius: 10,
    backgroundColor: '#111111', borderWidth: 1, borderColor: '#1c1c1c',
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  holeTileActive: { borderColor: GOLD, borderWidth: 1.5 },
  holeTileNum:    { fontFamily: FF, fontSize: 14, color: '#ffffff' },
  holeTilePar:    { fontFamily: FF, fontSize: 9, color: '#6b7280' },
  holeTileDot:    { width: 6, height: 6, borderRadius: 3, marginTop: 1 },
  holeTilePts:    { fontFamily: FFB, fontSize: 12, marginTop: 1 },

  halfLabels: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingHorizontal: 12, paddingBottom: 4,
  },
  halfLabel: { fontFamily: FF, fontSize: 8, color: '#333', letterSpacing: 1.5 },

  // Page content
  pageContent: { padding: 16, paddingBottom: 24 },

  // Hole card
  holeCard: {
    backgroundColor: '#111111', borderRadius: 16,
    borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden',
    marginBottom: 12,
  },
  holeCardTop:     { flexDirection: 'row', padding: 16, gap: 12 },
  holeCardDivider: { width: 1, backgroundColor: '#1c1c1c' },

  // Hole number block
  holeNumberBlock: { width: 100, alignItems: 'flex-start', justifyContent: 'center', gap: 6 },
  holeWord:        { fontFamily: FF, fontSize: 10, color: '#6b7280', letterSpacing: 2 },
  holeBig:         { fontFamily: FF, fontSize: 64, color: '#ffffff', lineHeight: 68, letterSpacing: -2 },
  holeChips:       { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  holeChip: {
    borderWidth: 1, borderColor: '#2c2c2c', borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  holeChipText: { fontFamily: FF, fontSize: 10, color: '#6b7280' },

  // Leaderboard
  leaderboard: { flex: 1, justifyContent: 'center', gap: 8 },
  lbRow:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lbName:      { flex: 1, fontFamily: FF, fontSize: 13, color: '#ffffff' },
  lbPts:       { fontFamily: FFB, fontSize: 13 },

  // Gets a shot
  shotRow: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: '#1a1a1a',
  },
  shotBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: `${GOLD}0d`, borderWidth: 1, borderColor: `${GOLD}25`,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  shotText: { fontFamily: FF, fontSize: 12, color: GOLD },

  // Quick actions
  actionsRow: {
    flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#1a1a1a',
  },
  actionBtn:   { flex: 1, alignItems: 'center', paddingVertical: 14, gap: 4 },
  actionLabel: { fontFamily: FF, fontSize: 9, color: '#6b7280', letterSpacing: 1.5 },
  actionSep:   { width: 1, backgroundColor: '#1a1a1a' },

  // Undo
  undoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#111111', borderRadius: 12, borderWidth: 1, borderColor: '#1c1c1c',
    paddingVertical: 12, marginBottom: 12,
  },
  undoBtnText: { fontFamily: FF, fontSize: 13, color: '#6b7280' },

  // Page dots
  pageHint:       { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: 8 },
  pageDot:        { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2c2c2c' },
  pageDotActive:  { backgroundColor: GOLD, width: 18 },

  // CTA
  ctaWrap: { paddingHorizontal: 16, paddingBottom: 32, paddingTop: 8, backgroundColor: '#000' },
  ctaBtn: {
    backgroundColor: GOLD, borderRadius: 14,
    paddingVertical: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  ctaText: { fontFamily: FF, fontSize: 17, color: '#000000' },
});

// ── Scorecard styles ──────────────────────────────────────────
const sc = StyleSheet.create({
  container:  { backgroundColor: '#111111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden', marginBottom: 12 },
  title:      { fontFamily: FF, fontSize: 10, color: GOLD, letterSpacing: 2, padding: 12, paddingBottom: 4 },
  headerRow:  { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', backgroundColor: '#0a0a0a' },
  row:        { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#141414' },
  cell:       { alignItems: 'center', justifyContent: 'center' },
  labelCell:  { width: 64, paddingLeft: 10 },
  holeCell:   { flex: 1, fontFamily: FF, fontSize: 11, color: '#6b7280', textAlign: 'center' },
  totalCell:  { width: 36, fontFamily: FFB, fontSize: 11, color: '#ffffff', textAlign: 'center' },
  scorePill:  { borderWidth: 1, borderRadius: 5, paddingHorizontal: 4, paddingVertical: 1, minWidth: 20, alignItems: 'center' },
  scorePillText: { fontFamily: FF, fontSize: 11 },
  ptsText:    { fontFamily: FFB, fontSize: 10, textAlign: 'center' },
  swipeHint:  { fontFamily: FF, fontSize: 10, color: '#2a2a2a', textAlign: 'center', padding: 10, letterSpacing: 1 },
});

// ── Score sheet styles ────────────────────────────────────────
const sh = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#111111', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 40,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#333', alignSelf: 'center', marginVertical: 14 },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  playerName: { fontFamily: FF, fontSize: 18, color: '#ffffff' },
  playerInfo: { fontFamily: FF, fontSize: 11, color: '#6b7280', marginTop: 2 },

  pickerLabel: { fontFamily: FF, fontSize: 9, color: GOLD, letterSpacing: 2, marginBottom: 10, marginTop: 16 },

  scoreGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  scoreBtn: {
    width: 56, height: 56, borderRadius: 12,
    backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2c2c2c',
    alignItems: 'center', justifyContent: 'center',
  },
  scoreBtnText: { fontFamily: FF, fontSize: 20, color: '#6b7280' },
  scoreDiff:    { fontFamily: FF, fontSize: 8, marginTop: 1 },

  fairwayRow: { flexDirection: 'row', gap: 8 },
  fairwayBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2c2c2c', alignItems: 'center',
  },
  fairwayBtnOn:  { backgroundColor: `${GOLD}15`, borderColor: GOLD },
  fairwayText:   { fontFamily: FF, fontSize: 13, color: '#6b7280' },
  fairwayTextOn: { color: GOLD },

  puttsRow: { flexDirection: 'row', gap: 8 },
  puttsBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2c2c2c', alignItems: 'center',
  },
  puttsBtnOn:  { backgroundColor: `${BLUE}15`, borderColor: BLUE },
  puttsText:   { fontFamily: FF, fontSize: 16, color: '#6b7280' },
  puttsTextOn: { color: BLUE },

  submitBtn: {
    marginTop: 24, backgroundColor: GOLD, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  submitBtnOff: { opacity: 0.35 },
  submitText:   { fontFamily: FF, fontSize: 16, color: '#000000' },
});
