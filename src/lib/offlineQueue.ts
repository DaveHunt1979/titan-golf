import { ensureDb } from './localDb';
import { supabase } from './supabase';

export interface SyncConflict {
  id: string;
  matchId: string;
  holeNumber: number;
  serverRows: { player_id: string; gross_score: number | null }[];
  localRows: Record<string, any>[];
  localUpdate: Record<string, any>;
  detectedAt: number;
}

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
        // Conflict detection: check if server already has different scores for this hole
        const { data: serverRows } = await supabase
          .from('match_holes')
          .select('player_id,gross_score')
          .eq('match_id', row.match_id)
          .eq('hole_number', row.hole_number);

        if (serverRows && serverRows.length > 0) {
          const hasConflict = insertRows.some(local => {
            const server = serverRows.find(s => s.player_id === local.player_id);
            return server && server.gross_score !== null && server.gross_score !== local.gross_score;
          });

          if (hasConflict) {
            await db.runAsync(
              `INSERT OR REPLACE INTO sync_conflicts
                 (id, match_id, hole_number, server_rows, local_rows, local_update, detected_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [row.id, row.match_id, row.hole_number,
               JSON.stringify(serverRows), row.insert_rows, row.match_update, Date.now()]
            );
            // Leave the queue item in place until the conflict is resolved
            continue;
          }
        }

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
          break;
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

export async function getConflicts(): Promise<SyncConflict[]> {
  try {
    const db = await ensureDb();
    const rows = await db.getAllAsync<{
      id: string; match_id: string; hole_number: number;
      server_rows: string; local_rows: string; local_update: string; detected_at: number;
    }>('SELECT * FROM sync_conflicts ORDER BY detected_at ASC');
    return rows.map(r => ({
      id: r.id,
      matchId: r.match_id,
      holeNumber: r.hole_number,
      serverRows: JSON.parse(r.server_rows),
      localRows: JSON.parse(r.local_rows),
      localUpdate: JSON.parse(r.local_update),
      detectedAt: r.detected_at,
    }));
  } catch {
    return [];
  }
}

export async function resolveConflict(conflictId: string, useServer: boolean): Promise<void> {
  const db = await ensureDb();
  const conflict = await db.getFirstAsync<{
    match_id: string; hole_number: number; local_rows: string; local_update: string;
  }>('SELECT * FROM sync_conflicts WHERE id = ?', [conflictId]);
  if (!conflict) return;

  if (!useServer) {
    // Force-push local version to server
    const insertRows: Record<string, any>[] = JSON.parse(conflict.local_rows);
    const matchUpdate: Record<string, any>  = JSON.parse(conflict.local_update);
    await supabase.from('match_holes').delete()
      .eq('match_id', conflict.match_id).eq('hole_number', conflict.hole_number);
    if (insertRows.length > 0) {
      await supabase.from('match_holes').insert(insertRows);
    }
    await supabase.from('matches').update(matchUpdate).eq('id', conflict.match_id);
  }
  // useServer=true: server data already in Supabase — nothing to push

  // Either way, remove queue item and conflict record
  await db.runAsync('DELETE FROM offline_queue WHERE match_id = ? AND hole_number = ?',
    [conflict.match_id, conflict.hole_number]);
  await db.runAsync('DELETE FROM sync_conflicts WHERE id = ?', [conflictId]);
}
