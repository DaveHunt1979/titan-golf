import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { drainQueue, getLastSyncedAt, getPendingCount, type SyncState } from './offlineQueue';

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
  syncNow: () => Promise<void>;
}

export function useSyncStatus(): SyncStatus {
  const [state, setState] = useState<SyncState>('idle');
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const syncing = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const [count, last] = await Promise.all([getPendingCount(), getLastSyncedAt()]);
    setPendingCount(count);
    setLastSyncedAt(last);
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
      setState(count > 0 ? 'error' : result.drained > 0 || result.syncedAt ? 'synced' : 'idle');
    } catch {
      const count = await getPendingCount();
      setPendingCount(count);
      setState('error');
    } finally {
      syncing.current = false;
    }
  }, []);

  const syncNow = useCallback(async () => {
    await trySync();
  }, [trySync]);

  // Mount: load initial state
  useEffect(() => {
    (async () => {
      await refresh();
      const online = await pingNetwork();
      setIsOnline(online);
      if (online) {
        await trySync();
      } else {
        const count = await getPendingCount();
        setState(count > 0 ? 'offline' : 'idle');
      }
    })();
  }, []);

  // AppState: drain on foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next) => {
      if (next === 'active') {
        await trySync();
      }
    });
    return () => sub.remove();
  }, [trySync]);

  // Poll when offline — re-attempt every 30s
  useEffect(() => {
    if (!isOnline) {
      pollTimer.current = setInterval(() => trySync(), POLL_INTERVAL_OFFLINE);
    } else {
      if (pollTimer.current) clearInterval(pollTimer.current);
    }
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
  }, [isOnline, trySync]);

  return { state, pendingCount, lastSyncedAt, isOnline, syncNow };
}
