import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import type { SyncStatus } from '../lib/useSyncStatus';

const FFB = 'JUSTSans-ExBold';
const FF  = 'JUSTSans';

function fmtTime(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

const CONFIG: Record<string, { dot: string; label: string; bg: string }> = {
  idle:    { dot: '#6b7280', label: 'Ready',      bg: 'transparent' },
  syncing: { dot: '#3b82f6', label: 'Syncing…',   bg: 'rgba(59,130,246,0.08)' },
  synced:  { dot: '#4ade80', label: 'Synced',      bg: 'rgba(74,222,128,0.06)' },
  offline: { dot: '#f97316', label: 'Offline',     bg: 'rgba(249,115,22,0.08)' },
  error:   { dot: '#f87171', label: 'Sync failed', bg: 'rgba(248,113,113,0.08)' },
};

interface Props {
  status: SyncStatus;
  onConflictsPress?: () => void;
}

export default function SyncBar({ status, onConflictsPress }: Props) {
  const { state, pendingCount, lastSyncedAt, conflicts, syncNow } = status;
  const cfg = CONFIG[state] ?? CONFIG.idle;
  const conflictCount = conflicts.length;
  const showSyncBtn = (state === 'offline' || state === 'error') && pendingCount > 0 && conflictCount === 0;

  return (
    <View style={[s.bar, { backgroundColor: cfg.bg }]}>
      <View style={s.left}>
        {state === 'syncing' ? (
          <ActivityIndicator size={10} color={cfg.dot} style={{ marginRight: 6 }} />
        ) : (
          <View style={[s.dot, { backgroundColor: cfg.dot }]} />
        )}
        <Text style={s.label}>{cfg.label}</Text>
        {pendingCount > 0 && conflictCount === 0 && (
          <View style={s.badge}>
            <Text style={s.badgeText}>{pendingCount}</Text>
          </View>
        )}
        {lastSyncedAt && state !== 'offline' && conflictCount === 0 && (
          <Text style={s.time}>· {fmtTime(lastSyncedAt)}</Text>
        )}
      </View>

      <View style={s.right}>
        {conflictCount > 0 && (
          <TouchableOpacity onPress={onConflictsPress} style={s.conflictBtn} activeOpacity={0.7}>
            <Text style={s.conflictText}>⚠ {conflictCount} conflict{conflictCount !== 1 ? 's' : ''} — tap to resolve</Text>
          </TouchableOpacity>
        )}
        {showSyncBtn && (
          <TouchableOpacity onPress={syncNow} style={s.btn}>
            <Text style={s.btnText}>Sync Now</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 5, minHeight: 28,
  },
  left:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot:   { width: 7, height: 7, borderRadius: 4 },
  label: { fontFamily: FF,  fontSize: 11, color: '#9ca3af', letterSpacing: 0.2 },
  time:  { fontFamily: FF,  fontSize: 10, color: '#6b7280' },
  badge: { backgroundColor: '#f97316', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  badgeText:    { fontFamily: FFB, fontSize: 10, color: '#fff' },
  btn:          { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#f97316' },
  btnText:      { fontFamily: FFB, fontSize: 10, color: '#f97316' },
  conflictBtn:  { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(248,113,113,0.15)', borderWidth: 1, borderColor: '#f87171' },
  conflictText: { fontFamily: FFB, fontSize: 10, color: '#f87171' },
});
