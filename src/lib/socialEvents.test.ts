import {
  countByStatus, waitingRoomRows, acceptedIds, potOf, placeAmounts, paymentsDue,
  canStartDay, inviteContent, chatAnnouncement, formatMoney, SocialPlayerRow,
} from './socialEvents';

const rows: SocialPlayerRow[] = [
  { player_id: 'a', status: 'accepted', paid: false },
  { player_id: 'b', status: 'accepted', paid: true },
  { player_id: 'c', status: 'invited', paid: false },
  { player_id: 'd', status: 'declined', paid: false },
  { player_id: 'e', status: 'removed', paid: false },
];

describe('waiting room', () => {
  test('counts by status', () => {
    expect(countByStatus(rows)).toEqual({ accepted: 2, invited: 1, declined: 1 });
  });
  test('removed players are ignored in counts', () => {
    expect(countByStatus(rows)).toEqual({ accepted: 2, invited: 1, declined: 1 });
  });
  test('declined players are never listed', () => {
    expect(waitingRoomRows(rows).map(r => r.player_id)).toEqual(['a', 'b', 'c']);
  });
  test('acceptedIds returns only accepted', () => {
    expect(acceptedIds(rows)).toEqual(['a', 'b']);
  });
  test('cannot start the day with fewer than 2 accepted', () => {
    expect(canStartDay(1)).toBe(false);
    expect(canStartDay(2)).toBe(true);
  });
});

const P = { participating: true, paid: false, acceptedCount: 3 };
describe('money', () => {
  test('pot = fee x accepted', () => {
    expect(potOf(20, 10)).toBe(200);
  });
  test('place amounts split the pot, capped at the number of players', () => {
    expect(placeAmounts(20, 10, [50, 30, 20])).toEqual([100, 60, 40]);
    expect(placeAmounts(20, 2, [50, 30, 20])).toEqual([20, 12]);
  });
  test('collector: before completion everyone except the collector owes the entry fee to the collector', () => {
    const base = { method: 'collector' as const, fee: 20, split: [100], ranking: ['a'], collectorId: 'c', complete: false };
    expect(paymentsDue({ ...base, ...P, playerId: 'a' })).toEqual([{ toPlayerId: 'c', amount: 20 }]);
    expect(paymentsDue({ ...base, ...P, playerId: 'c' })).toEqual([]);
  });
  test('collector: nothing owed by players once complete (collector pays winners offline)', () => {
    expect(paymentsDue({ ...P, method: 'collector', fee: 20, split: [100], ranking: ['a'], playerId: 'b', collectorId: 'c', complete: true })).toEqual([]);
  });
  test('winners: nobody owes anything before the event is complete', () => {
    expect(paymentsDue({ ...P, method: 'winners', fee: 20, split: [50, 30, 20], ranking: ['a', 'b', 'c'], playerId: 'd', collectorId: null, complete: false })).toEqual([]);
  });
  test('winners: after completion a non-winner pays each winner fee x pct, a winner does not pay themselves', () => {
    const args = { method: 'winners' as const, fee: 20, split: [50, 30, 20], ranking: ['a', 'b', 'c'], collectorId: null, complete: true };
    expect(paymentsDue({ ...args, ...P, playerId: 'd' })).toEqual([
      { toPlayerId: 'a', amount: 10 }, { toPlayerId: 'b', amount: 6 }, { toPlayerId: 'c', amount: 4 },
    ]);
    expect(paymentsDue({ ...args, ...P, playerId: 'a' })).toEqual([
      { toPlayerId: 'b', amount: 6 }, { toPlayerId: 'c', amount: 4 },
    ]);
  });
  test('non-participant owes nothing', () => {
    expect(paymentsDue({ method: 'collector', fee: 20, split: [100], ranking: ['a'], playerId: 'a', collectorId: 'c', complete: false, participating: false, paid: false, acceptedCount: 3 })).toEqual([]);
  });
  test('collector mode: already-paid player owes nothing', () => {
    expect(paymentsDue({ method: 'collector', fee: 20, split: [100], ranking: ['a'], playerId: 'a', collectorId: 'c', complete: false, participating: true, paid: true, acceptedCount: 3 })).toEqual([]);
  });
  test('collector pays out winners after complete, skipping empty slots', () => {
    const a = { method: 'collector' as const, fee: 20, split: [50, 30, 20], collectorId: 'c', playerId: 'c', complete: true, participating: true, paid: false, acceptedCount: 10 };
    expect(paymentsDue({ ...a, ranking: ['a', 'b', 'd'] })).toEqual([
      { toPlayerId: 'a', amount: 100 }, { toPlayerId: 'b', amount: 60 }, { toPlayerId: 'd', amount: 40 },
    ]);
    expect(paymentsDue({ ...a, ranking: ['a', '', 'd'] })).toEqual([
      { toPlayerId: 'a', amount: 100 }, { toPlayerId: 'd', amount: 40 },
    ]);
  });
  test('no money or zero fee owes nothing', () => {
    expect(paymentsDue({ ...P, method: 'none', fee: 20, split: [100], ranking: ['a'], playerId: 'b', collectorId: null, complete: true })).toEqual([]);
    expect(paymentsDue({ ...P, method: 'winners', fee: 0, split: [100], ranking: ['a'], playerId: 'b', collectorId: null, complete: true })).toEqual([]);
  });
});

describe('copy', () => {
  test('invite content includes event, date, tee time and course', () => {
    expect(inviteContent({ eventName: 'Social 18', dateLabel: 'Sat 10 Oct', teeTime: '09:30', course: 'Woking' }))
      .toBe("You've been invited to Social 18.\n📅 Sat 10 Oct at 09:30\n⛳ Woking");
  });
  test('invite content omits missing parts', () => {
    expect(inviteContent({ eventName: 'Social 18', dateLabel: 'Sat 10 Oct', teeTime: null, course: null }))
      .toBe("You've been invited to Social 18.\n📅 Sat 10 Oct");
  });
  test('invite content includes the format when given', () => {
    expect(inviteContent({ eventName: 'Social 18', dateLabel: 'Sat 10 Oct', teeTime: null, course: null, formatLabel: 'Team event' }))
      .toBe("You've been invited to Social 18.\n📅 Sat 10 Oct\n🏌️ Team event");
  });
  test('chat announcement', () => {
    expect(chatAnnouncement({ hostFirstName: 'Dave', eventName: 'Social 18', dateLabel: 'Sat 10 Oct', course: 'Woking' }))
      .toBe("Dave is playing Social 18 on Sat 10 Oct at Woking. Who wants in?");
  });
});

describe('formatMoney', () => {
  test('whole numbers have no decimals', () => { expect(formatMoney(20, '£')).toBe('£20'); });
  test('fractions get 2dp', () => { expect(formatMoney(7.5, '£')).toBe('£7.50'); });
});
