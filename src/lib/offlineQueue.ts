import { ensureDb } from './localDb';
import { supabase } from './supabase';

export type SyncState = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

export interface QueuedHole {
  id: string;
  matchId: string;
  holeNumber: number;
  insertRows: Record<string, any>[];
  statRows: Record<string, any>[];
  matchUpdate: Record<string, any>;
  timestamp: number;
}

export function isNetworkError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message ?? err.details ?? err.hint ?? '').toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('network request failed') ||
    msg.includes('networkerror') ||
    msg.includes('network error') ||
    msg.includes('unable to connect') ||
    msg.includes('connection refused')
  );
}

async function getMeta(key: string): Promise<string | null> {
  const db = await ensureDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM sync_meta WHERE key = ?', [key]
  );
  return row?.value ?? null;
}

async function setMeta(key: string, value: string): Promise<void> {
  const db = await ensureDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO sync_meta(key, value) VALUES (?, ?)', [key, value]
  );
}

export async function getLastSyncedAt(): Promise<number | null> {
  const v = await getMeta('last_synced_at');
  return v ? parseInt(v, 10) : null;
}

async function setLastSyncedAt(ts: number): Promise<void> {
  await setMeta('last_synced_at', String(ts));
}

async function getFailCount(): Promise<number> {
  const v = await getMeta('fail_count');
  return v ? parseInt(v, 10) : 0;
}

async function setFailCount(n: number): Promise<void> {
  await setMeta('fail_count', String(n));
}

export function backoffMs(failCount: number): number {
  const STEPS = [0, 30_000, 60_000, 120_000, 300_000];
  return STEPS[Math.min(failCount, STEPS.length - 1)];
}

export async function enqueueHole(item: Omit<QueuedHole, 'id' | 'timestamp'>): Promise<void> {
  try {
    const db = await ensureDb();
    const id = `${item.matchId}-${item.holeNumber}`;
    await db.runAsync(
      `INSERT OR REPLACE INTO offline_queue
         (id, match_id, hole_number, insert_rows, stat_rows, match_update, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        item.matchId,
        item.holeNumber,
        JSON.stringify(item.insertRows),
        JSON.stringify(item.statRows),
        JSON.stringify(item.matchUpdate),
        Date.now(),
      ]
    );
  } catch (e) {
    console.error('offlineQueue.enqueue failed:', e);
  }
}

export async function getPendingCount(): Promise<number> {
  try {
    const db = await ensureDb();
    const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM offline_queue');
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

export async function drainQueue(): Promise<{ drained: number; remaining: number; syncedAt?: number }> {
  try {
    const db = await ensureDb();
    const queue = await db.getAllAsync<{
      id: string; match_id: string; hole_number: number;
      insert_rows: string; stat_rows: string; match_update: string; timestamp: number;
    }>('SELECT * FROM offline_queue ORDER BY timestamp ASC');

    if (queue.length === 0) return { drained: 0, remaining: 0 };

    const failCount = await getFailCount();
    const delay = backoffMs(failCount);
    const lastSync = await getLastSyncedAt();
    if (delay > 0 && lastSync && Date.now() - lastSync < delay) {
      return { drained: 0, remaining: queue.length };
    }

    let drained = 0;
    let networkFailed = false;

    for (const row of queue) {
      const insertRows: Record<string, any>[] = JSON.parse(row.insert_rows);
      const statRows: Record<string, any>[]   = JSON.parse(row.stat_rows);
      const matchUpdate: Record<string, any>  = JSON.parse(row.match_update);

      try {
        await supabase.from('match_holes').delete()
          .eq('match_id', row.match_id)
          .eq('hole_number', row.hole_number);

        if (insertRows.length > 0) {
          const { error } = await supabase.from('match_holes').insert(insertRows);
          if (error) throw error;
        }

        if (statRows.length > 0) {
          await supabase.from('hole_stats').upsert(statRows, { onConflict: 'match_id,player_id,hole_number' });
        }

        const { error } = await supabase.from('matches').update(matchUpdate).eq('id', row.match_id);
        if (error) throw error;

        await db.runAsync('DELETE FROM offline_queue WHERE id = ?', [row.id]);
        drained++;
      } catch (err: any) {
        if (isNetworkError(err)) {
          networkFailed = true;
          break; // stop on first network failure — no point continuing
        } else {
          console.error('Queue item discarded (non-network error):', err);
          await db.runAsync('DELETE FROM offline_queue WHERE id = ?', [row.id]);
          drained++;
        }
      }
    }

    const remaining = await getPendingCount();

    if (networkFailed || remaining > 0) {
      await setFailCount(failCount + 1);
      return { drained, remaining };
    } else {
      const syncedAt = Date.now();
      await setLastSyncedAt(syncedAt);
      await setFailCount(0);
      return { drained, remaining: 0, syncedAt };
    }
  } catch (e) {
    console.error('drainQueue error:', e);
    return { drained: 0, remaining: 0 };
  }
}
