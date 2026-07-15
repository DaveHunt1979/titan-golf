import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const QUEUE_KEY = 'titan:offline_queue';

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

export async function enqueueHole(item: Omit<QueuedHole, 'id' | 'timestamp'>): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const queue: QueuedHole[] = raw ? JSON.parse(raw) : [];
    const filtered = queue.filter(q => !(q.matchId === item.matchId && q.holeNumber === item.holeNumber));
    filtered.push({ ...item, id: `${item.matchId}-${item.holeNumber}`, timestamp: Date.now() });
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error('offlineQueue.enqueue failed:', e);
  }
}

export async function getPendingCount(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const queue: QueuedHole[] = raw ? JSON.parse(raw) : [];
    return queue.length;
  } catch {
    return 0;
  }
}

export async function drainQueue(): Promise<{ drained: number; remaining: number }> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const queue: QueuedHole[] = raw ? JSON.parse(raw) : [];
    if (queue.length === 0) return { drained: 0, remaining: 0 };

    const sorted = [...queue].sort((a, b) => a.timestamp - b.timestamp);
    let drained = 0;
    const stillPending: QueuedHole[] = [];

    for (const item of sorted) {
      try {
        await supabase.from('match_holes').delete()
          .eq('match_id', item.matchId)
          .eq('hole_number', item.holeNumber);

        if (item.insertRows.length > 0) {
          const { error } = await supabase.from('match_holes').insert(item.insertRows);
          if (error) throw error;
        }

        if (item.statRows.length > 0) {
          await supabase.from('hole_stats').upsert(item.statRows, { onConflict: 'match_id,player_id,hole_number' });
        }

        const { error } = await supabase.from('matches')
          .update(item.matchUpdate)
          .eq('id', item.matchId);
        if (error) throw error;

        drained++;
      } catch (err: any) {
        if (isNetworkError(err)) {
          stillPending.push(item);
        } else {
          console.error('Queue item discarded (non-network error):', err);
          drained++;
        }
      }
    }

    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(stillPending));
    return { drained, remaining: stillPending.length };
  } catch (e) {
    console.error('drainQueue error:', e);
    return { drained: 0, remaining: 0 };
  }
}
