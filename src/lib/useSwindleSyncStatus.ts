import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  drainSwindleQueue, getSwindleLastSyncedAt, getSwindlePendingCount,
  type SwindleSyncState,
} from './swindleOfflineQueue';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const POLL_INTERVAL_OFFLINE = 30_000;

async function pingNetwork(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${SUPABASE_URL}/health`, {
      method: 'HEAD', signal: controller.signal, headers: { apikey: SUPABASE_KEY },
    });
    clearTimeout(tid);
    return res.status < 500;
  } catch { return false; }
}

export interface SwindleSyncStatus {
  state: SwindleSyncState;
  pendingCount: number;
  syncNow: () => Promise<void>;
}

export function useSwindleSyncStatus(): SwindleSyncStatus {
  const [state, setState] = useState<SwindleSyncState>('idle');
  const [pendingCount, setPendingCount] = useState(0);
  const syncing = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  const trySync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    setState('syncing');

    const online = await pingNetwork();
    setIsOnline(online);
    if (!online) {
      const count = await getSwindlePendingCount();
      setPendingCount(count);
      setState(count > 0 ? 'offline' : 'idle');
      syncing.current = false;
      return;
    }

    try {
      const result = await drainSwindleQueue();
      setPendingCount(result.remaining);
      setState(result.remaining > 0 ? 'error' : (result.drained > 0 || result.syncedAt) ? 'synced' : 'idle');
    } catch {
      setPendingCount(await getSwindlePendingCount());
      setState('error');
    } finally {
      syncing.current = false;
    }
  }, []);

  const syncNow = useCallback(async () => { await trySync(); }, [trySync]);

  useEffect(() => {
    (async () => {
      const count = await getSwindlePendingCount();
      setPendingCount(count);
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
    } else if (pollTimer.current) {
      clearInterval(pollTimer.current);
    }
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
  }, [isOnline, trySync]);

  return { state, pendingCount, syncNow };
}
