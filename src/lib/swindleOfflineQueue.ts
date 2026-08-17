import { ensureDb } from './localDb';
import { supabase } from './supabase';
import { isNetworkError, backoffMs } from './offlineQueue';

export type SwindleSyncState = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

export interface QueuedSwindleHole {
  gameId: string;
  playerId: string;
  holeNumber: number;
  grossScore: number | null;
  stablefordPts: number | null;
}

export async function enqueueSwindleHole(item: QueuedSwindleHole): Promise<void> {
  try {
    const db = await ensureDb();
    if (!db) return;
    await db.runAsync(
      `INSERT OR REPLACE INTO swindle_offline_queue
         (id, game_id, player_id, hole_number, gross_score, stableford_pts, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        `${item.gameId}-${item.playerId}-${item.holeNumber}`,
        item.gameId, item.playerId, item.holeNumber,
        item.grossScore, item.stablefordPts, Date.now(),
      ]
    );
  } catch (e) { console.error('swindleOfflineQueue.enqueue failed:', e); }
}

export async function getSwindlePendingCount(): Promise<number> {
  try {
    const db = await ensureDb();
    if (!db) return 0;
    const row = await db.getFirstAsync('SELECT COUNT(*) as n FROM swindle_offline_queue') as { n: number } | null;
    return row?.n ?? 0;
  } catch { return 0; }
}

async function getMeta(key: string): Promise<string | null> {
  try {
    const db = await ensureDb();
    if (!db) return null;
    const row = await db.getFirstAsync('SELECT value FROM sync_meta WHERE key = ?', [key]) as { value: string } | null;
    return row?.value ?? null;
  } catch { return null; }
}
async function setMeta(key: string, value: string): Promise<void> {
  try {
    const db = await ensureDb();
    if (!db) return;
    await db.runAsync('INSERT OR REPLACE INTO sync_meta(key, value) VALUES (?, ?)', [key, value]);
  } catch { /* ignore */ }
}

const FAIL_COUNT_KEY = 'swindle_fail_count';
const LAST_SYNCED_KEY = 'swindle_last_synced_at';

export async function getSwindleLastSyncedAt(): Promise<number | null> {
  const v = await getMeta(LAST_SYNCED_KEY);
  return v ? parseInt(v, 10) : null;
}

export async function drainSwindleQueue(): Promise<{ drained: number; remaining: number; syncedAt?: number }> {
  try {
    const db = await ensureDb();
    if (!db) return { drained: 0, remaining: 0 };

    const queue = (await db.getAllAsync('SELECT * FROM swindle_offline_queue ORDER BY timestamp ASC')) as {
      id: string; game_id: string; player_id: string; hole_number: number;
      gross_score: number | null; stableford_pts: number | null; timestamp: number;
    }[];
    if (queue.length === 0) return { drained: 0, remaining: 0 };

    const failCountStr = await getMeta(FAIL_COUNT_KEY);
    const failCount = failCountStr ? parseInt(failCountStr, 10) : 0;
    const delay = backoffMs(failCount);
    const lastSync = await getSwindleLastSyncedAt();
    if (delay > 0 && lastSync && Date.now() - lastSync < delay) {
      return { drained: 0, remaining: queue.length };
    }

    let drained = 0;
    let networkFailed = false;

    for (const row of queue) {
      try {
        const { error } = await supabase.from('swindle_scores').upsert({
          game_id: row.game_id, player_id: row.player_id, hole_number: row.hole_number,
          gross_score: row.gross_score, stableford_pts: row.stableford_pts,
        }, { onConflict: 'game_id,player_id,hole_number' });
        if (error) throw error;
        await db.runAsync('DELETE FROM swindle_offline_queue WHERE id = ?', [row.id]);
        drained++;
      } catch (err: any) {
        if (isNetworkError(err)) { networkFailed = true; break; }
        // A real (non-network) error here — e.g. an RLS policy that hadn't
        // been applied yet — must never mean the score just vanishes. Leave
        // it queued so it counts as pending and gets retried on the normal
        // backoff cadence; only a successful upsert ever removes a row.
        console.error('Swindle queue item failed, keeping queued for retry:', err);
      }
    }

    const remaining = await getSwindlePendingCount();
    if (networkFailed || remaining > 0) {
      await setMeta(FAIL_COUNT_KEY, String(failCount + 1));
      return { drained, remaining };
    }
    const syncedAt = Date.now();
    await setMeta(LAST_SYNCED_KEY, String(syncedAt));
    await setMeta(FAIL_COUNT_KEY, '0');
    return { drained, remaining: 0, syncedAt };
  } catch (e) {
    console.error('drainSwindleQueue error:', e);
    return { drained: 0, remaining: 0 };
  }
}
