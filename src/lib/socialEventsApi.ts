import { supabase, fetchAllRows } from './supabase';
import { individualScoreValue } from './scoring';
import { sendPushNotification } from './notifications';
import { inviteContent, chatAnnouncement, MoneyMethod, SocialPlayerRow } from './socialEvents';

export interface SocialEvent {
  id: string; society_id: string; host_player_id: string; name: string;
  event_date: string; tee_time: string | null; course_name: string | null;
  entry_fee: number; currency: string; money_method: MoneyMethod; format: 'singles' | 'team';
  collector_player_id: string | null; prize_split: number[];
  status: 'open' | 'started' | 'complete' | 'cancelled'; day_id: string | null;
}
export interface SocialPlayer extends SocialPlayerRow {
  id: string; source: 'invite' | 'chat'; display_name: string; avatar_url: string | null;
}
export interface NewSocialFields {
  name: string; eventDate: string; teeTime: string | null; courseName: string | null;
  entryFee: number; currency: string; moneyMethod: MoneyMethod; format: 'singles' | 'team';
  collectorId: string | null; prizeSplit: number[];
}
export interface NewSocialEvent extends NewSocialFields {
  societyId: string; hostId: string; hostName: string;
  inviteeIds: string[]; postToChat: boolean;
}

const EVENT_COLS = 'id,society_id,host_player_id,name,event_date,tee_time,course_name,entry_fee,currency,money_method,format,collector_player_id,prize_split,status,day_id';

export function formatEventDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export async function getMyPlayer(): Promise<{ id: string; display_name: string } | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('players').select('id, display_name').eq('auth_uid', user.id).maybeSingle();
  return (data as any) ?? null;
}

export async function createSocialEvent(n: NewSocialEvent): Promise<string> {
  const { data: ev, error } = await supabase.from('social_events').insert({
    society_id: n.societyId, host_player_id: n.hostId, name: n.name.trim(),
    event_date: n.eventDate, tee_time: n.teeTime, course_name: n.courseName,
    entry_fee: n.entryFee, currency: n.currency, money_method: n.moneyMethod, format: n.format,
    collector_player_id: n.moneyMethod === 'collector' ? (n.collectorId ?? n.hostId) : null,
    prize_split: n.prizeSplit,
  }).select(EVENT_COLS).single();
  if (error || !ev) throw error ?? new Error('Could not create event');
  const event = ev as unknown as SocialEvent;

  const rows = [
    { event_id: event.id, player_id: n.hostId, status: 'accepted', source: 'invite' },
    ...n.inviteeIds.filter(id => id !== n.hostId).map(id => ({ event_id: event.id, player_id: id, status: 'invited', source: 'invite' })),
  ];
  const { error: pErr } = await supabase.from('social_event_players').insert(rows);
  if (pErr) throw pErr;

  await sendInvites(event, n.hostId, n.inviteeIds, n.hostName);
  if (n.postToChat) await postAnnouncement(event, n.hostId, n.hostName);
  return event.id;
}

export async function updateSocialEvent(id: string, p: Partial<NewSocialFields>): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (p.name !== undefined) patch.name = p.name.trim();
  if (p.eventDate !== undefined) patch.event_date = p.eventDate;
  if (p.teeTime !== undefined) patch.tee_time = p.teeTime;
  if (p.courseName !== undefined) patch.course_name = p.courseName;
  if (p.entryFee !== undefined) patch.entry_fee = p.entryFee;
  if (p.currency !== undefined) patch.currency = p.currency;
  if (p.moneyMethod !== undefined) patch.money_method = p.moneyMethod;
  if (p.format !== undefined) patch.format = p.format;
  if (p.collectorId !== undefined) patch.collector_player_id = p.collectorId;
  if (p.prizeSplit !== undefined) patch.prize_split = p.prizeSplit;
  const { data, error } = await supabase.from('social_events').update(patch).eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Event not updated');
}

async function sendInvites(event: SocialEvent, hostId: string, playerIds: string[], hostName?: string) {
  const targets = playerIds.filter(id => id !== hostId);
  if (!targets.length) return;
  const content = inviteContent({
    eventName: event.name, dateLabel: formatEventDate(event.event_date),
    teeTime: event.tee_time, course: event.course_name,
    formatLabel: event.format === 'team' ? 'Team event' : 'Singles',
  });
  const { error } = await supabase.from('direct_messages').insert(
    targets.map(id => ({ sender_id: hostId, recipient_id: id, content, message_type: 'social_invite', social_event_id: event.id })),
  );
  if (error) { console.error('[social18] invite DMs failed', error); return; }
  // Say WHAT it is — the event's own name can be anything ("Mike & Ben Test").
  const who = hostName ? `${hostName.split(' ')[0]} invited you to` : "You've been invited to";
  sendPushNotification(
    "You're invited to a Social 18",
    `${who} "${event.name}" on ${formatEventDate(event.event_date)}${event.tee_time ? ` at ${event.tee_time}` : ''}. Open your inbox to accept or decline.`,
    targets, { type: 'social_invite' },
  );
}

export async function inviteMore(event: SocialEvent, hostName: string, playerIds: string[]): Promise<void> {
  if (!playerIds.length) return;
  const { data: current } = await supabase.from('social_event_players')
    .select('player_id, status').eq('event_id', event.id).in('player_id', playerIds);
  const accepted = new Set(((current ?? []) as any[]).filter(r => r.status === 'accepted').map(r => r.player_id as string));
  const targets = playerIds.filter(id => !accepted.has(id));
  if (!targets.length) return;
  const { error } = await supabase.from('social_event_players').upsert(
    targets.map(id => ({ event_id: event.id, player_id: id, status: 'invited', source: 'invite' })),
    { onConflict: 'event_id,player_id' },
  );
  if (error) throw error;
  await sendInvites(event, event.host_player_id, targets, hostName);
}

export async function postSocialToChat(event: SocialEvent, hostId: string, hostName: string): Promise<void> {
  await postAnnouncement(event, hostId, hostName);
}

// Posting to society chat invites everyone: each real (non-guest) member gets a
// 'invited' row so I'm in / Can't make it from the chat card updates a row the
// host sees. Existing rows (accepted / declined / removed) are never touched.
async function inviteWholeSociety(event: SocialEvent, memberIds: string[]) {
  if (!memberIds.length) return;
  const [{ data: players }, { data: existing }] = await Promise.all([
    supabase.from('players').select('id, is_guest').in('id', memberIds),
    supabase.from('social_event_players').select('player_id').eq('event_id', event.id),
  ]);
  const have = new Set(((existing ?? []) as any[]).map(r => r.player_id as string));
  const rows = ((players ?? []) as any[])
    .filter(p => !p.is_guest && !have.has(p.id))
    .map(p => ({ event_id: event.id, player_id: p.id, status: 'invited', source: 'invite' }));
  if (!rows.length) return;
  const { error } = await supabase.from('social_event_players').insert(rows);
  if (error) console.error('[social18] society invite rows failed', error);
}

async function postAnnouncement(event: SocialEvent, hostId: string, hostName: string) {
  const content = chatAnnouncement({
    hostFirstName: hostName.split(' ')[0], eventName: event.name,
    dateLabel: formatEventDate(event.event_date), course: event.course_name,
  });
  const { error } = await supabase.from('messages').insert({
    player_id: hostId, content, society_id: event.society_id, channel: 'general', social_event_id: event.id,
  });
  if (error) { console.error('[social18] chat announcement failed', error); return; }
  const { data: members } = await supabase.from('society_members').select('player_id').eq('society_id', event.society_id).neq('player_id', hostId);
  const memberIds = (members ?? []).map((m: any) => m.player_id as string);
  await inviteWholeSociety(event, memberIds);
  sendPushNotification(hostName, content, memberIds, { type: 'message', channel: 'general', societyId: event.society_id });
}

export async function fetchSocialEvent(id: string): Promise<SocialEvent | null> {
  const { data } = await supabase.from('social_events').select(EVENT_COLS).eq('id', id).maybeSingle();
  return (data as unknown as SocialEvent) ?? null;
}

export async function fetchSocialPlayers(eventId: string): Promise<SocialPlayer[]> {
  const { data, error } = await supabase
    .from('social_event_players')
    .select('id, player_id, status, source, paid, players(display_name, avatar_url)')
    .eq('event_id', eventId);
  if (error) { console.error('[social18] fetch players failed', error); return []; }
  return ((data ?? []) as any[]).map(r => ({
    id: r.id, player_id: r.player_id, status: r.status, source: r.source, paid: r.paid,
    display_name: r.players?.display_name ?? '—', avatar_url: r.players?.avatar_url ?? null,
  }));
}

export async function listSocialEvents(societyId: string): Promise<SocialEvent[]> {
  const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('social_events').select(EVENT_COLS)
    .eq('society_id', societyId).not('status', 'in', '(cancelled,complete)').gte('event_date', since)
    .order('event_date', { ascending: true });
  if (error) { console.error('[social18] list failed', error); return []; }
  return (data ?? []) as unknown as SocialEvent[];
}

// Finished Social 18s, newest first — they leave the main list the moment
// they're marked complete and live here for good.
export async function listSocialHistory(societyId: string): Promise<SocialEvent[]> {
  const { data, error } = await supabase
    .from('social_events').select(EVENT_COLS)
    .eq('society_id', societyId).eq('status', 'complete')
    .order('event_date', { ascending: false }).limit(100);
  if (error) { console.error('[social18] history failed', error); return []; }
  return (data ?? []) as unknown as SocialEvent[];
}

// Host-only (RLS). Permanently removes the event, its waiting room and its chat
// posts. A round already scored from it stays in the players' own history.
// RLS reports a refused delete as "0 rows", not an error, so check for that.
export async function deleteSocialEvent(eventId: string): Promise<void> {
  const { data, error } = await supabase.from('social_events').delete().eq('id', eventId).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Only the host can delete this event');
}

// Accept / decline (inbox card, chat "I'm in", event page "Can't make it").
// Inserts the row if the player wasn't invited (chat join), else updates it.
export async function respondToSocialEvent(
  event: Pick<SocialEvent, 'id' | 'name' | 'host_player_id' | 'status'>,
  playerId: string, playerName: string, response: 'accepted' | 'declined',
): Promise<void> {
  const { data: evRow } = await supabase.from('social_events').select('status').eq('id', event.id).maybeSingle();
  if (!evRow || (evRow as any).status !== 'open') throw new Error('Event is not open');
  const { data: existing } = await supabase.from('social_event_players')
    .select('id, status').eq('event_id', event.id).eq('player_id', playerId).maybeSingle();
  if (existing && (existing as any).status === 'removed') throw new Error('Removed');
  if (existing && (existing as any).status === response) return;
  // Chat posts invite the whole society, so a Decline normally has a row. A member who joined
  // later has none and RLS only lets a self-insert be 'accepted' — nothing to record then.
  if (!existing && response === 'declined') return;
  const { error } = existing
    ? await supabase.from('social_event_players').update({ status: response }).eq('id', (existing as any).id)
    : await supabase.from('social_event_players').insert({ event_id: event.id, player_id: playerId, status: response, source: 'chat' });
  if (error) throw error;

  if (playerId === event.host_player_id) return;
  const who = playerName.split(' ')[0];
  const content = response === 'accepted'
    ? `✅ ${who} is in for ${event.name}.`
    : `❌ ${who} can't make ${event.name}.`;
  // Best effort — must never undo the player's own reply.
  try {
    await supabase.from('direct_messages').insert({ sender_id: playerId, recipient_id: event.host_player_id, content, message_type: 'text' });
    sendPushNotification(response === 'accepted' ? `${who} is in!` : `${who} can't make it`, content, [event.host_player_id], { type: 'message', senderId: playerId });
  } catch (e) { console.error('[social18] host notify failed', e); }
}

export async function removeSocialPlayer(eventId: string, playerId: string): Promise<void> {
  const { error } = await supabase.from('social_event_players').update({ status: 'removed' }).eq('event_id', eventId).eq('player_id', playerId);
  if (error) throw error;
}

export async function setSocialPaid(eventId: string, playerId: string, paid: boolean): Promise<void> {
  const { error } = await supabase.from('social_event_players')
    .update({ paid, paid_at: paid ? new Date().toISOString() : null })
    .eq('event_id', eventId).eq('player_id', playerId);
  if (error) throw error;
}

export async function setSocialStatus(eventId: string, status: SocialEvent['status']): Promise<void> {
  const { error } = await supabase.from('social_events').update({ status }).eq('id', eventId);
  if (error) throw error;
}

// Mirrors the Game Day screen's STABLEFORD SIDE GAME: per-player summed
// stableford_pts (and gross-vs-par), ordered by individualScoreValue for the
// day's format, then more holes played. Only the event's accepted players are
// ranked; remaining ties break on player id so the order is deterministic.
export async function fetchDayRanking(dayId: string, playerIds: string[]): Promise<string[]> {
  if (!playerIds.length) return [];
  const { data: matches } = await supabase.from('matches').select('id, round_format')
    .eq('day_id', dayId).neq('status', 'cancelled').order('match_number', { ascending: true }).order('id', { ascending: true });
  const ids = (matches ?? []).map((m: any) => m.id as string);
  if (!ids.length) return [];
  const dayFormat = (matches as any[])[0]?.round_format ?? 'stableford';
  const { data: day } = await supabase.from('competition_days').select('course_name').eq('id', dayId).maybeSingle();
  const parMap: Record<number, number> = {};
  if ((day as any)?.course_name) {
    const { data: ch } = await supabase.from('course_holes').select('hole_number,par').eq('course_name', (day as any).course_name);
    for (const h of (ch ?? []) as any[]) parMap[h.hole_number] = h.par;
  }
  const rows = await fetchAllRows<any>(
    (from, to) => supabase.from('match_holes').select('player_id, stableford_pts, gross_score, hole_number')
      .in('match_id', ids).order('id').range(from, to),
  );
  const t: Record<string, { pts: number; vsPar: number; holes: number }> = {};
  for (const r of rows ?? []) {
    const e = (t[r.player_id] ??= { pts: 0, vsPar: 0, holes: 0 });
    e.pts += r.stableford_pts ?? 0;
    e.holes += 1;
    if (r.gross_score != null && parMap[r.hole_number] != null) e.vsPar += r.gross_score - parMap[r.hole_number];
  }
  const z = { pts: 0, vsPar: 0, holes: 0 };
  return [...playerIds].sort((x, y) => {
    const a = t[x] ?? z, b = t[y] ?? z;
    return individualScoreValue(dayFormat, b.pts, b.vsPar) - individualScoreValue(dayFormat, a.pts, a.vsPar)
      || b.holes - a.holes
      || (x < y ? -1 : x > y ? 1 : 0);
  });
}

export interface EventResponseInfo { mine: SocialPlayerRow['status'] | null; inCount: number; outCount: number; open: boolean }

// Live tally + the viewer's own response for the chat announcement cards.
export async function fetchEventResponses(eventIds: string[], myId: string): Promise<Record<string, EventResponseInfo>> {
  const out: Record<string, EventResponseInfo> = {};
  if (!eventIds.length) return out;
  const [{ data: evs }, { data: rows }] = await Promise.all([
    supabase.from('social_events').select('id,status').in('id', eventIds),
    supabase.from('social_event_players').select('event_id,player_id,status').in('event_id', eventIds),
  ]);
  for (const e of (evs ?? []) as any[]) out[e.id] = { mine: null, inCount: 0, outCount: 0, open: e.status === 'open' };
  for (const r of (rows ?? []) as any[]) {
    const o = out[r.event_id]; if (!o) continue;
    if (r.status === 'accepted') o.inCount++;
    else if (r.status === 'declined') o.outCount++;
    if (r.player_id === myId) o.mine = r.status;
  }
  return out;
}
