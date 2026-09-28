import { useEffect, useState } from 'react';
import { View, Text, Modal, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { fetchPlayerHandicapCutHistory, type PlayerHandicapCutRound } from '../lib/tournamentHandicap';
import { useDynamicColors } from '../lib/SocietyThemeContext';

const GOLD = '#D4AF37';
const FFB  = 'JUSTSans-ExBold';

// Rick's brief, section 16 (round-by-round breakdown) + section 17
// (Handicap History table) — the Tournament Handicap Cut System's
// player-facing transparency screen. Modeled on TeePickerSheet: a plain
// pageSheet Modal, no new interaction pattern.
export default function HandicapCutHistorySheet({
  visible, onClose, playerName, competitionId, playerId,
  officialHandicap, currentTournamentHandicap, totalTournamentCut,
}: {
  visible: boolean;
  onClose: () => void;
  playerName: string;
  competitionId: string;
  playerId: string;
  officialHandicap: number | null;
  currentTournamentHandicap: number | null;
  totalTournamentCut: number;
}) {
  const dc = useDynamicColors();
  const [rounds, setRounds] = useState<PlayerHandicapCutRound[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    fetchPlayerHandicapCutHistory(competitionId, playerId).then(rows => {
      if (!cancelled) { setRounds(rows); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [visible, competitionId, playerId]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.container, { backgroundColor: dc.bg }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text allowFontScaling={false} numberOfLines={1} style={s.cancel}>Close</Text>
          </TouchableOpacity>
          <Text allowFontScaling={false} numberOfLines={1} style={s.title}>HANDICAP CUTS</Text>
          <View style={{ width: 50 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <Text style={s.playerName}>{playerName}</Text>

          <View style={[s.summaryCard, { backgroundColor: dc.card, borderColor: dc.border }]}>
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>WHS Handicap</Text>
              <Text style={s.summaryValue}>{officialHandicap != null ? officialHandicap.toFixed(1) : '—'}</Text>
            </View>
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Total Titan Cuts</Text>
              <Text style={[s.summaryValue, totalTournamentCut > 0 && { color: GOLD }]}>
                {totalTournamentCut > 0 ? `-${totalTournamentCut.toFixed(1)}` : '0'}
              </Text>
            </View>
            <View style={[s.summaryRow, { borderBottomWidth: 0 }]}>
              <Text style={[s.summaryLabel, { fontSize: 13 }]}>Current Tournament Handicap</Text>
              <Text style={[s.summaryValue, { fontSize: 18, color: GOLD }]}>
                {currentTournamentHandicap != null ? currentTournamentHandicap.toFixed(1) : '—'}
              </Text>
            </View>
          </View>

          <Text style={s.sectionHeader}>ROUND-BY-ROUND</Text>

          {loading ? (
            <ActivityIndicator color={GOLD} style={{ marginTop: 24 }} />
          ) : rounds.length === 0 ? (
            <Text style={s.empty}>No completed rounds yet — a round only shows here once all 18 holes are in and the cut has been calculated.</Text>
          ) : (
            <View style={[s.table, { backgroundColor: dc.card, borderColor: dc.border }]}>
              <View style={s.tableHeaderRow}>
                <Text style={[s.th, s.colRound]}>RND</Text>
                <Text style={[s.th, s.colHcp]}>START</Text>
                <Text style={[s.th, s.colPts]}>PTS</Text>
                <Text style={[s.th, s.colOver]}>OVER</Text>
                <Text style={[s.th, s.colRate]}>RATE</Text>
                <Text style={[s.th, s.colCut]}>CUT</Text>
                <Text style={[s.th, s.colNext]}>NEXT</Text>
              </View>
              {rounds.map(r => (
                <View key={r.dayNumber} style={s.tableRow}>
                  <Text style={[s.td, s.colRound]}>{r.dayNumber}</Text>
                  <Text style={[s.td, s.colHcp]}>{r.startingHandicap.toFixed(1)}</Text>
                  <Text style={[s.td, s.colPts, r.stablefordPts > r.triggerScore && { color: GOLD }]}>{r.stablefordPts}</Text>
                  <Text style={[s.td, s.colOver]}>{r.pointsOverTrigger > 0 ? `+${r.pointsOverTrigger}` : '—'}</Text>
                  <Text style={[s.td, s.colRate]}>{r.pointsOverTrigger > 0 ? `${r.cutPerPoint}` : '—'}</Text>
                  <Text style={[s.td, s.colCut, r.cutApplied > 0 && { color: '#f87171' }]}>
                    {r.cutApplied > 0 ? `-${r.cutApplied.toFixed(1)}` : '0'}
                  </Text>
                  <Text style={[s.td, s.colNext, { color: GOLD }]}>{r.handicapAfterCut.toFixed(1)}</Text>
                </View>
              ))}
            </View>
          )}

          <Text style={s.footnote}>
            A handicap cut only ever takes effect from the NEXT round — it never changes a round already played, its Stableford points, match results, or the leaderboard.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 20, paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  cancel: { fontSize: 14, fontFamily: FFB, color: '#fff', width: 50 },
  title:  { fontSize: 13, fontFamily: FFB, color: '#fff', letterSpacing: 1 },
  playerName: { fontSize: 20, fontFamily: FFB, color: '#fff', marginBottom: 12 },
  summaryCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 20 },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  summaryLabel: { fontSize: 12, fontFamily: FFB, color: '#9ca3af' },
  summaryValue: { fontSize: 14, fontFamily: FFB, color: '#fff' },
  sectionHeader: { fontSize: 10, fontFamily: FFB, color: GOLD, letterSpacing: 1.5, marginBottom: 8 },
  empty: { fontSize: 12, fontFamily: FFB, color: '#555', lineHeight: 18, marginTop: 8 },
  table: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  tableHeaderRow: {
    flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 8,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  tableRow: {
    flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 8,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  th: { fontSize: 9, fontFamily: FFB, color: '#9ca3af', letterSpacing: 0.5 },
  td: { fontSize: 12, fontFamily: FFB, color: '#fff' },
  colRound: { width: 32 },
  colHcp:   { width: 46 },
  colPts:   { width: 32 },
  colOver:  { width: 40 },
  colRate:  { width: 36 },
  colCut:   { width: 44 },
  colNext:  { flex: 1, textAlign: 'right' },
  footnote: { fontSize: 10, fontFamily: FFB, color: '#555', lineHeight: 15, marginTop: 16 },
});
