import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const GOLD     = '#D4AF37';
const RED      = '#f87171';
const BLUE     = '#3b82f6';
const DARKBLUE = '#1e3a8a';
const PLAIN    = '#ffffff';
const FFB      = 'JUSTSans-ExBold';

// Same eagle/birdie/par/bogey/double convention as score/enter, score/solo
// and spectate/[matchId].tsx — kept in sync manually (see
// project_scoring_architecture_debt memory), not shared, since a real
// dedupe was already deferred there.
const SCORE_COLORS: Record<string, string> = { eagle: GOLD, birdie: RED, par: PLAIN, bogey: BLUE, double: DARKBLUE };

function scoreVsPar(gross: number, par: number): string {
  const diff = gross - par;
  if (diff <= -2) return 'eagle';
  if (diff === -1) return 'birdie';
  if (diff === 0)  return 'par';
  if (diff === 1)  return 'bogey';
  return 'double';
}

interface CourseHole { hole_number: number; par: number; stroke_index: number; }

export interface RoundScorecardProps {
  startHole: number;
  allPlayerIds: string[];
  playerNames: Record<string, string>;
  holeData: Record<string, Record<number, { gross: number | null; pts: number | null }>>;
  courseHoles: CourseHole[];
  matchHomeIds: string[];
  holeChars: string[];
  homeColor: string;
  awayColor: string;
  isStrokePlay: boolean;
  roundFormat: string;
  secondaryFormat?: string | null;
  screenWidth: number;
  // Live scoring only (score/enter) — omit both for a read-only render
  // (Spectate mode, Dave 2026-08-21: "everyone spectating wants to see how
  // badly the others are scoring").
  onUndo?: () => void;
  lastPlayedHole?: number;
  saving?: boolean;
}

// Extracted from score/enter/[matchId].tsx's inline Scorecard (Dave,
// 2026-08-21) so Spectate mode can show the exact same hole-by-hole grid
// every player already sees while scoring, not a simplified version.
export default function RoundScorecard({
  startHole, allPlayerIds, playerNames, holeData, courseHoles, matchHomeIds, holeChars,
  homeColor, awayColor, isStrokePlay, roundFormat, secondaryFormat, onUndo, lastPlayedHole = 0, saving = false, screenWidth,
}: RoundScorecardProps) {
  const holes = Array.from({ length: 9 }, (_, i) => startHole + i);
  const title = startHole === 1 ? 'FRONT 9' : 'BACK 9';
  const totalPar = holes.reduce((a, h) => {
    const ch = courseHoles.find(c => c.hole_number === h);
    return a + (ch?.par ?? 0);
  }, 0);
  // Medal must always show gross strokes here, even with a Stableford side
  // game attached — the side game's points belong in its own "2ND GAME"
  // summary, never in the main Medal scorecard. secondaryFormat only flips
  // this on for Matchplay (the existing 4BBB Stroke Matchplay + side-game
  // inline-points feature).
  const showPts = roundFormat === 'stableford' || (roundFormat === 'matchplay' && !!secondaryFormat);

  return (
    <ScrollView style={{ width: screenWidth }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
      <View style={sc.container}>
        <Text style={sc.title}>{title}</Text>

        {/* Header row */}
        <View style={sc.headerRow}>
          <Text allowFontScaling={false} style={[sc.cell, sc.labelCell, { color: '#fff' }]}>HOLE</Text>
          {holes.map(h => (
            <Text allowFontScaling={false} key={h} style={[sc.cell, sc.holeCell, holeChars[h-1] !== '.' && { color: '#ffffff' }]}>{h}</Text>
          ))}
          <Text allowFontScaling={false} style={[sc.cell, sc.totalCell, { color: '#fff' }]}>TOT</Text>
        </View>

        {/* Par row */}
        {courseHoles.length > 0 && (
          <View style={[sc.row, { backgroundColor: '#0a0a0a' }]}>
            <Text allowFontScaling={false} style={[sc.cell, sc.labelCell, { color: GOLD }]}>PAR</Text>
            {holes.map(h => {
              const ch = courseHoles.find(c => c.hole_number === h);
              return <Text allowFontScaling={false} key={h} style={[sc.cell, sc.holeCell, { color: GOLD }]}>{ch?.par ?? '—'}</Text>;
            })}
            <Text allowFontScaling={false} style={[sc.cell, sc.totalCell, { color: GOLD }]}>{totalPar || '—'}</Text>
          </View>
        )}

        {/* SI row */}
        {courseHoles.length > 0 && (
          <View style={sc.row}>
            <Text allowFontScaling={false} style={[sc.cell, sc.labelCell, { color: '#fff' }]}>SI</Text>
            {holes.map(h => {
              const ch = courseHoles.find(c => c.hole_number === h);
              return <Text allowFontScaling={false} key={h} style={[sc.cell, sc.holeCell, { color: '#fff', fontSize: 9 }]}>{ch?.stroke_index ?? '—'}</Text>;
            })}
            <Text allowFontScaling={false} style={[sc.cell, sc.totalCell, { color: '#fff' }]}>—</Text>
          </View>
        )}

        {/* Player rows */}
        {allPlayerIds.map((id, pi) => {
          const isHome = matchHomeIds.includes(id);
          const teamColor = isHome ? homeColor : awayColor;
          const firstName = (playerNames[id] ?? '?').split(' ')[0];
          let totalGross = 0;
          let totalPts = 0;
          return (
            <View key={id} style={[sc.row, pi % 2 === 0 && { backgroundColor: '#0d0d0d' }]}>
              <View style={[sc.cell, sc.labelCell, { flexDirection: 'row', alignItems: 'center', gap: 5 }]}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: teamColor }} />
                <Text style={{ fontFamily: FFB, fontSize: 11, color: '#ffffff' }} numberOfLines={1}>{firstName}</Text>
              </View>
              {holes.map(h => {
                const score = holeData[id]?.[h];
                const gross = score?.gross;
                const pts = score?.pts;
                const played = holeChars[h - 1] !== '.';
                if (gross) totalGross += gross;
                if (pts) totalPts += pts;
                const ch = courseHoles.find(c => c.hole_number === h);
                const cellColor = gross != null && ch
                  ? SCORE_COLORS[scoreVsPar(gross, ch.par)]
                  : gross ? PLAIN : '#333';
                return (
                  <View key={h} style={[sc.cell, sc.holeCell, { gap: 2 }]}>
                    {gross ? (
                      <>
                        <View style={[sc.scorePill, { borderColor: `${cellColor}50`, backgroundColor: `${cellColor}12` }]}>
                          <Text allowFontScaling={false} style={[sc.scorePillText, { color: cellColor }]}>
                            {showPts && pts != null ? pts : gross}
                          </Text>
                        </View>
                        {showPts && pts != null && (
                          <Text allowFontScaling={false} style={[sc.ptsText, { color: '#ffffff' }]}>{gross}</Text>
                        )}
                      </>
                    ) : (
                      <Text style={{ fontFamily: FFB, fontSize: 10, color: played ? '#444' : '#222', textAlign: 'center' }}>
                        {played ? '—' : ''}
                      </Text>
                    )}
                  </View>
                );
              })}
              <Text allowFontScaling={false} style={[sc.cell, sc.totalCell, { color: totalGross > 0 ? '#ffffff' : '#333' }]}>
                {showPts && totalPts > 0 ? `${totalPts}` : totalGross > 0 ? `${totalGross}` : '—'}
              </Text>
            </View>
          );
        })}

        {/* Matchplay result row */}
        {!isStrokePlay && (
          <View style={[sc.row, { backgroundColor: '#0a0a0a', borderTopWidth: 1, borderTopColor: '#1a1a1a' }]}>
            <Text allowFontScaling={false} style={[sc.cell, sc.labelCell, { color: '#fff' }]}>RESULT</Text>
            {holes.map(h => {
              const c = holeChars[h - 1];
              const color = c === 'h' ? homeColor : c === 'a' ? awayColor : c === 'f' ? '#4b5563' : 'transparent';
              return (
                <Text allowFontScaling={false} key={h} style={[sc.cell, sc.holeCell, { color, fontFamily: FFB }]}>
                  {c === 'h' ? 'H' : c === 'a' ? 'A' : c === 'f' ? '=' : ''}
                </Text>
              );
            })}
            <Text allowFontScaling={false} style={[sc.cell, sc.totalCell]} />
          </View>
        )}

        {onUndo && <Text style={sc.swipeHint}>← Swipe to switch ·</Text>}
      </View>

      {onUndo && lastPlayedHole > 0 && (
        <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 16, flexDirection: 'row', justifyContent: 'center', gap: 6 }} onPress={onUndo} disabled={saving} activeOpacity={0.7}>
          <Ionicons name="arrow-undo-outline" size={14} color="#ffffff" />
          <Text style={{ fontFamily: FFB, fontSize: 12, color: '#ffffff' }}>Edit Hole {lastPlayedHole}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const sc = StyleSheet.create({
  container:    { backgroundColor: '#111111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden', marginBottom: 12 },
  title:        { fontFamily: FFB, fontSize: 10, color: GOLD, letterSpacing: 2, padding: 12, paddingBottom: 4 },
  headerRow:    { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', backgroundColor: '#0a0a0a' },
  row:          { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#141414' },
  cell:         { alignItems: 'center', justifyContent: 'center' },
  labelCell:    { width: 60, paddingLeft: 10, alignItems: 'flex-start' },
  holeCell:     { flex: 1, fontFamily: FFB, fontSize: 11, color: '#fff', textAlign: 'center' },
  totalCell:    { width: 34, fontFamily: FFB, fontSize: 11, color: '#ffffff', textAlign: 'center' },
  scorePill:    { borderWidth: 1, borderRadius: 5, paddingHorizontal: 4, paddingVertical: 1, minWidth: 20, alignItems: 'center' },
  scorePillText: { fontFamily: FFB, fontSize: 11 },
  ptsText:      { fontFamily: FFB, fontSize: 9, textAlign: 'center' },
  swipeHint:    { fontFamily: FFB, fontSize: 10, color: '#1a1a1a', textAlign: 'center', padding: 10, letterSpacing: 1 },
});
