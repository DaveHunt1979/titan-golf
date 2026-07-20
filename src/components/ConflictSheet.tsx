import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import type { SyncConflict } from '../lib/offlineQueue';

const GOLD  = '#D4AF37';
const RED   = '#f87171';
const GREEN = '#4ade80';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';

interface Props {
  visible: boolean;
  conflicts: SyncConflict[];
  playerNames: Record<string, string>;
  onResolve: (conflictId: string, useServer: boolean) => Promise<void>;
  onClose: () => void;
}

function firstName(name: string): string {
  return name?.split(' ')[0] ?? '?';
}

export default function ConflictSheet({ visible, conflicts, playerNames, onResolve, onClose }: Props) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.root}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.headerLeft} />
          <View style={s.headerCenter}>
            <Text style={s.headerTitle}>SCORE CONFLICTS</Text>
            <Text style={s.headerSub}>Two devices scored the same hole differently</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={s.headerRight} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={s.closeBtn}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {conflicts.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>✓</Text>
              <Text style={s.emptyText}>All conflicts resolved</Text>
            </View>
          ) : (
            conflicts.map(conflict => {
              const serverMap: Record<string, number | null> = {};
              conflict.serverRows.forEach(r => { serverMap[r.player_id] = r.gross_score; });

              const localMap: Record<string, number | null> = {};
              conflict.localRows.forEach(r => { localMap[r.player_id] = r.gross_score ?? null; });

              const playerIds = Array.from(new Set([
                ...conflict.serverRows.map(r => r.player_id),
                ...conflict.localRows.map(r => r.player_id),
              ]));

              return (
                <View key={conflict.id} style={s.card}>
                  <View style={s.cardHeader}>
                    <Text style={s.holeLabel}>Hole {conflict.holeNumber}</Text>
                    <View style={s.conflictBadge}>
                      <Text style={s.conflictBadgeText}>CONFLICT</Text>
                    </View>
                  </View>

                  {/* Score comparison table */}
                  <View style={s.table}>
                    <View style={s.tableHeader}>
                      <Text style={[s.tableCol, s.tableColPlayer]} />
                      <Text style={[s.tableCol, s.tableColScore, s.colLabelServer]}>SERVER</Text>
                      <Text style={[s.tableCol, s.tableColScore, s.colLabelLocal]}>MINE</Text>
                    </View>
                    {playerIds.map(pid => {
                      const server = serverMap[pid] ?? '—';
                      const local  = localMap[pid]  ?? '—';
                      const differs = server !== local && server !== '—' && local !== '—';
                      return (
                        <View key={pid} style={s.tableRow}>
                          <Text style={[s.tableCol, s.tableColPlayer, s.playerName]}>
                            {firstName(playerNames[pid] ?? pid)}
                          </Text>
                          <Text style={[s.tableCol, s.tableColScore, s.scoreText, differs && s.scoreDiffers]}>
                            {server}
                          </Text>
                          <Text style={[s.tableCol, s.tableColScore, s.scoreText, differs && s.scoreDiffers]}>
                            {local}
                          </Text>
                        </View>
                      );
                    })}
                  </View>

                  {/* Resolution buttons */}
                  <View style={s.btnRow}>
                    <TouchableOpacity
                      style={[s.resolveBtn, s.keepServerBtn]}
                      activeOpacity={0.8}
                      onPress={() => onResolve(conflict.id, true)}
                    >
                      <Text style={s.keepServerText}>Keep Server</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.resolveBtn, s.useMyBtn]}
                      activeOpacity={0.8}
                      onPress={() => onResolve(conflict.id, false)}
                    >
                      <Text style={s.useMyText}>Use Mine</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#000' },

  header: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  headerLeft:   { width: 50 },
  headerRight:  { width: 50, alignItems: 'flex-end', paddingTop: 4 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle:  { fontFamily: FFB, fontSize: 13, color: RED, letterSpacing: 2 },
  headerSub:    { fontFamily: FF, fontSize: 12, color: '#6b7280', marginTop: 4, textAlign: 'center' },
  closeBtn:     { fontFamily: FFB, fontSize: 14, color: GOLD },

  scroll: { padding: 20, paddingBottom: 60 },

  empty:     { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontFamily: FFB, fontSize: 18, color: GREEN },

  card: {
    backgroundColor: '#0f0f0f', borderRadius: 16,
    borderWidth: 1, borderColor: '#2a1a1a',
    padding: 16, marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 14,
  },
  holeLabel: { fontFamily: FFB, fontSize: 18, color: '#fff' },
  conflictBadge: {
    backgroundColor: 'rgba(248,113,113,0.15)',
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: RED,
  },
  conflictBadgeText: { fontFamily: FFB, fontSize: 10, color: RED, letterSpacing: 1 },

  table:       { marginBottom: 16 },
  tableHeader: { flexDirection: 'row', marginBottom: 8 },
  tableRow:    { flexDirection: 'row', paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#1c1c1c' },
  tableCol:    { flex: 1 },
  tableColPlayer: { flex: 2 },
  tableColScore:  { flex: 1, textAlign: 'center' },
  colLabelServer: { fontFamily: FFB, fontSize: 10, color: '#6b7280', letterSpacing: 1 },
  colLabelLocal:  { fontFamily: FFB, fontSize: 10, color: GOLD, letterSpacing: 1 },
  playerName:  { fontFamily: FFB, fontSize: 14, color: '#fff' },
  scoreText:   { fontFamily: FFB, fontSize: 16, color: '#9ca3af', textAlign: 'center' },
  scoreDiffers:{ color: RED },

  btnRow:       { flexDirection: 'row', gap: 10 },
  resolveBtn:   { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1 },
  keepServerBtn:{ backgroundColor: 'rgba(107,114,128,0.15)', borderColor: '#374151' },
  useMyBtn:     { backgroundColor: GOLD, borderColor: GOLD },
  keepServerText:{ fontFamily: FFB, fontSize: 14, color: '#9ca3af' },
  useMyText:    { fontFamily: FFB, fontSize: 14, color: '#000' },
});
