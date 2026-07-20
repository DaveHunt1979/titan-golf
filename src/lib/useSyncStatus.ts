import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  drainQueue, getLastSyncedAt, getPendingCount, getConflicts,
  type SyncState, type SyncConflict,
} from './offlineQueue';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const POLL_INTERVAL_OFFLINE = 30_000;

async function pingNetwork(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${SUPABASE_URL}/health`, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { apikey: SUPABASE_KEY },
    });
    clearTimeout(tid);
    return res.status < 500;
  } catch {
    return false;
  }
}

export interface SyncStatus {
  state: SyncState;
  pendingCount: number;
  lastSyncedAt: number | null;
  isOnline: boolean;
  conflicts: SyncConflict[];
  syncNow: () => Promise<void>;
  resolveAndRefresh: (conflictId: string, useServer: boolean) => Promise<void>;
}

export function useSyncStatus(): SyncStatus {
  const [state, setState]               = useState<SyncState>('idle');
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [isOnline, setIsOnline]         = useState(true);
  const [conflicts, setConflicts]       = useState<SyncConflict[]>([]);
  const syncing    = useRef(false);
  const pollTimer  = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshConflicts = useCallback(async () => {
    setConflicts(await getConflicts());
  }, []);

  const trySync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    setState('syncing');

    const online = await pingNetwork();
    setIsOnline(online);

    if (!online) {
      const count = await getPendingCount();
      setPendingCount(count);
      setState(count > 0 ? 'offline' : 'idle');
      syncing.current = false;
      return;
    }

    try {
      const result = await drainQueue();
      const count = result.remaining;
      setPendingCount(count);
      if (result.syncedAt) setLastSyncedAt(result.syncedAt);
      await refreshConflicts();
      const hasConflicts = (await getConflicts()).length > 0;
      setState(hasConflicts ? 'error' : count > 0 ? 'error' : result.drained > 0 || result.syncedAt ? 'synced' : 'idle');
    } catch {
      const count = await getPendingCount();
      setPendingCount(count);
      setState('error');
    } finally {
      syncing.current = false;
    }
  }, [refreshConflicts]);

  const syncNow = useCallback(async () => { await trySync(); }, [trySync]);

  const resolveAndRefresh = useCallback(async (conflictId: string, useServer: boolean) => {
    const { resolveConflict } = await import('./offlineQueue');
    await resolveConflict(conflictId, useServer);
    await refreshConflicts();
    const count = await getPendingCount();
    setPendingCount(count);
    if (count === 0 && (await getConflicts()).length === 0) setState('synced');
  }, [refreshConflicts]);

  useEffect(() => {
    (async () => {
      const [count, last, c] = await Promise.all([getPendingCount(), getLastSyncedAt(), getConflicts()]);
      setPendingCount(count);
      setLastSyncedAt(last);
      setConflicts(c);
      const online = await pingNetwork();
      setIsOnline(online);
      if (online) await trySync();
      else setState(count > 0 ? 'offline' : 'idle');
    })();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next) => {
      if (next === 'active') await trySync();
    });
    return () => sub.remove();
  }, [trySync]);

  useEffect(() => {
    if (!isOnline) {
      pollTimer.current = setInterval(() => trySync(), POLL_INTERVAL_OFFLINE);
    } else {
      if (pollTimer.current) clearInterval(pollTimer.current);
    }
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
  }, [isOnline, trySync]);

  return { state, pendingCount, lastSyncedAt, isOnline, conflicts, syncNow, resolveAndRefresh };
}
