// Social 18 — pure logic (no Supabase, no React), so it's unit-testable.
export type SocialStatus = 'invited' | 'accepted' | 'declined' | 'removed';
export type MoneyMethod = 'collector' | 'winners' | 'none';

export interface SocialPlayerRow { player_id: string; status: SocialStatus; paid: boolean }
export interface Due { toPlayerId: string; amount: number }

export const PRIZE_SPLITS: { label: string; value: number[] }[] = [
  { label: 'Winner takes all', value: [100] },
  { label: '60 / 40', value: [60, 40] },
  { label: '50 / 30 / 20', value: [50, 30, 20] },
  { label: '40 / 30 / 20 / 10', value: [40, 30, 20, 10] },
];

export function countByStatus(rows: SocialPlayerRow[]) {
  const out = { accepted: 0, invited: 0, declined: 0 };
  for (const r of rows) if (r.status !== 'removed') out[r.status]++;
  return out;
}

// Declined/removed players never appear in the waiting room.
export function waitingRoomRows<T extends SocialPlayerRow>(rows: T[]): T[] {
  return rows.filter(r => r.status !== 'declined' && r.status !== 'removed');
}

export function acceptedIds(rows: SocialPlayerRow[]): string[] {
  return rows.filter(r => r.status === 'accepted').map(r => r.player_id);
}

export function canStartDay(acceptedCount: number): boolean {
  return acceptedCount >= 2;
}

export function potOf(fee: number, acceptedCount: number): number {
  return fee * acceptedCount;
}

export function placeAmounts(fee: number, acceptedCount: number, split: number[]): number[] {
  const pot = potOf(fee, acceptedCount);
  return split.slice(0, acceptedCount).map(pct => (pot * pct) / 100);
}

// Who this player currently owes, and how much. Same direct-settlement rule
// as Swindle: each non-winner pays fee x pct to the winner of that place; a
// winner never pays themselves. Nothing is owed in "winners" mode until the
// event is complete (before that, "winners" are meaningless).
export function paymentsDue(a: {
  method: MoneyMethod; fee: number; split: number[]; ranking: string[];
  playerId: string; collectorId: string | null; complete: boolean;
  participating: boolean; paid: boolean; acceptedCount: number;
}): Due[] {
  if (!a.participating) return [];
  if (a.method === 'none' || a.fee <= 0) return [];
  if (a.method === 'collector') {
    if (!a.complete) {
      return !a.paid && a.collectorId && a.collectorId !== a.playerId
        ? [{ toPlayerId: a.collectorId, amount: a.fee }]
        : [];
    }
    if (a.collectorId && a.collectorId === a.playerId) {
      const amounts = placeAmounts(a.fee, a.acceptedCount, a.split);
      return amounts
        .map((amount, i) => ({ toPlayerId: a.ranking[i], amount }))
        .filter(d => d.toPlayerId);
    }
    return [];
  }
  if (!a.complete) return [];
  return a.split
    .map((pct, i) => ({ toPlayerId: a.ranking[i], amount: (a.fee * pct) / 100 }))
    .filter(d => d.toPlayerId && d.toPlayerId !== a.playerId);
}

export function formatMoney(amount: number, currency: string): string {
  return `${currency}${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

export function inviteContent(a: { eventName: string; dateLabel: string; teeTime: string | null; course: string | null; formatLabel?: string }): string {
  const when = `📅 ${a.dateLabel}${a.teeTime ? ` at ${a.teeTime}` : ''}`;
  const lines = [`You've been invited to ${a.eventName}.`, when];
  if (a.course) lines.push(`⛳ ${a.course}`);
  if (a.formatLabel) lines.push(`🏌️ ${a.formatLabel}`);
  return lines.join('\n');
}

export function chatAnnouncement(a: { hostFirstName: string; eventName: string; dateLabel: string; course: string | null }): string {
  return `${a.hostFirstName} is playing ${a.eventName} on ${a.dateLabel}${a.course ? ` at ${a.course}` : ''}. Who wants in?`;
}
