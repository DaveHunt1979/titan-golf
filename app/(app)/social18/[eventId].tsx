import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl, Image } from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { goBack } from '../../../src/lib/navigation';
import { resolveAvatar } from '../../../src/lib/assets';
import ConfirmDialog from '../../../src/components/ConfirmDialog';
import PlayerSelectorSheet, { SelectablePlayer } from '../../../src/components/PlayerSelectorSheet';
import { st, GOLD, RED, GREEN, FFB } from '../../../src/components/social18/styles';
import { waitingRoomRows, countByStatus, acceptedIds, canStartDay, placeAmounts, paymentsDue, formatMoney } from '../../../src/lib/socialEvents';
import {
  fetchSocialEvent, fetchSocialPlayers, getMyPlayer, formatEventDate, respondToSocialEvent,
  removeSocialPlayer, setSocialPaid, setSocialStatus, deleteSocialEvent, inviteMore, fetchDayRanking, SocialEvent, SocialPlayer, postSocialToChat } from '../../../src/lib/socialEventsApi';

type Confirm = null | 'cancel' | 'delete' | 'complete' | { remove: SocialPlayer };

export default function Social18Event() {
  const router = useRouter();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { societyId } = useSocietyTheme() as any;
  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [event, setEvent] = useState<SocialEvent | null>(null);
  const [players, setPlayers] = useState<SocialPlayer[]>([]);
  const [me, setMe] = useState<{ id: string; display_name: string } | null>(null);
  const [ranking, setRanking] = useState<string[]>([]);
  const [roster, setRoster] = useState<SelectablePlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [ev, ps, who] = await Promise.all([fetchSocialEvent(eventId), fetchSocialPlayers(eventId), getMyPlayer()]);
      setEvent(ev); setPlayers(ps); setMe(who);
      if (ev?.day_id && ev.status === 'complete') setRanking(await fetchDayRanking(ev.day_id, acceptedIds(ps)));
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [eventId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const [postedToChat, setPostedToChat] = useState(false);
  const [showPending, setShowPending] = useState(false);
  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); await load(); }
    catch (e) { console.error('[social18.event] action failed', e); setError('Something went wrong — please try again.'); }
    finally { setBusy(false); }
  }

  async function openInvite() {
    if (!societyId || !event) return;
    const { data: members } = await supabase.from('society_members').select('player_id').eq('society_id', societyId);
    const ids = (members ?? []).map((x: any) => x.player_id as string);
    const { data } = ids.length ? await supabase.from('players').select('id, display_name, avatar_url, is_guest').in('id', ids).order('display_name') : { data: [] };
    const have = new Set(players.filter(p => p.status === 'accepted' || p.status === 'invited').map(p => p.player_id));
    setRoster(((data ?? []) as any[]).filter(p => !p.is_guest && !have.has(p.id)).map(p => ({ id: p.id, name: p.display_name, avatarUrl: p.avatar_url })));
    setShowInvite(true);
  }

  if (!fontsLoaded || loading) return <View style={st.container}><StatusBar style="light" /><ActivityIndicator color={GOLD} style={{ marginTop: 80 }} /></View>;
  if (!event) return <View style={st.container}><StatusBar style="light" /><Text style={st.empty}>This event is no longer available.</Text></View>;

  const isHost = me?.id === event.host_player_id;
  const mine = players.find(p => p.player_id === me?.id);
  const roomAll = waitingRoomRows(players);
  // A whole-society chat post leaves a long list of pending names: past 5, fold them into one line (yours always shows).
  const pendingRows = roomAll.filter(p => p.status === 'invited');
  const foldPending = pendingRows.length > 5 && !showPending;
  const room = foldPending ? roomAll.filter(p => p.status !== 'invited' || p.player_id === me?.id) : roomAll;
  const foldedCount = foldPending ? pendingRows.filter(p => p.player_id !== me?.id).length : 0;
  const counts = countByStatus(players);
  const accepted = acceptedIds(players);
  const moneyOn = event.money_method !== 'none' && event.entry_fee > 0;
  const complete = event.status === 'complete';
  const collector = players.find(p => p.player_id === event.collector_player_id);
  const nameOf = (id: string) => (players.find(p => p.player_id === id)?.display_name ?? '—').split(' ')[0];
  const due = me ? paymentsDue({
    method: event.money_method, fee: event.entry_fee, split: event.prize_split, ranking,
    playerId: me.id, collectorId: event.collector_player_id, complete,
    participating: mine?.status === 'accepted', paid: !!mine?.paid, acceptedCount: accepted.length,
  }) : [];
  const isCollector = !!me && event.collector_player_id === me.id;
  const dueLabel = event.money_method === 'winners' ? 'PAY THE WINNERS'
    : complete && isCollector ? 'PAY OUT' : 'YOU OWE';
  const places = placeAmounts(event.entry_fee, accepted.length, event.prize_split);

  const confirmCopy = confirm === 'delete'
    ? { title: 'Delete this event?', message: "It's removed for everyone, along with its waiting room and chat posts. Scores from a round already played stay in each player's own history. This can't be undone.", label: 'Delete event', destructive: true }
    : confirm === 'cancel'
    ? { title: 'Cancel this event?', message: 'Everyone in the waiting room will no longer see it.', label: 'Cancel event', destructive: true }
    : confirm === 'complete'
    ? { title: 'Mark complete?', message: moneyOn ? 'This shows everyone what they owe.' : 'This closes the day.', label: 'Mark complete', destructive: false }
    : confirm && typeof confirm === 'object'
    ? { title: `Remove ${confirm.remove.display_name.split(' ')[0]}?`, message: 'They will be taken out of the waiting room.', label: 'Remove', destructive: true }
    : null;

  async function onConfirm() {
    const c = confirm; setConfirm(null);
    if (!event) return;
    if (c === 'cancel') await run(async () => { await setSocialStatus(event.id, 'cancelled'); router.replace('/(app)/social18' as any); });
    else if (c === 'delete') await run(async () => { await deleteSocialEvent(event.id); router.replace('/(app)/social18' as any); });
    else if (c === 'complete') await run(() => setSocialStatus(event.id, 'complete'));
    else if (c && typeof c === 'object') await run(() => removeSocialPlayer(event.id, c.remove.player_id));
  }

  return (
    <View style={st.container}>
      <StatusBar style="light" />
      <View style={st.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/social18')} style={st.backBtn} activeOpacity={0.7}>
          <Text style={st.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={st.headerTitle} numberOfLines={1}>{event.name}</Text>
        <View style={st.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={st.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={GOLD} />}>

        <View style={st.card}>
          <Text style={[st.rowName, { fontSize: 20 }]}>{event.name}</Text>
          <Text style={st.sub}>{formatEventDate(event.event_date)}{event.tee_time ? ` · ${event.tee_time}` : ''}</Text>
          {event.course_name ? <Text style={[st.sub, { color: GOLD }]}>{event.course_name}</Text> : null}
          <Text style={st.sub}>{event.format === 'team' ? 'Team event' : 'Singles'}</Text>
          <Text style={st.sub}>{event.status === 'started' ? 'Day under way' : complete ? 'Complete' : 'Open — waiting for players'}</Text>
        </View>

        {error ? <Text style={[st.sub, { color: RED }]}>{error}</Text> : null}

        {moneyOn && (
          <View style={st.card}>
            <Text style={st.label}>MONEY</Text>
            {event.money_method === 'collector' ? (
              <Text style={st.rowName}>Entry fee {formatMoney(event.entry_fee, event.currency)} · pay {collector ? collector.display_name.split(' ')[0] : 'the collector'}</Text>
            ) : (
              <Text style={st.rowName}>Entry fee {formatMoney(event.entry_fee, event.currency)} · paid to the winners at the end</Text>
            )}
            <Text style={st.sub}>Pot {formatMoney(event.entry_fee * accepted.length, event.currency)} · {places.map((a, i) => `${['1st', '2nd', '3rd', '4th'][i]} ${formatMoney(a, event.currency)}`).join(' · ')}</Text>
            {due.length > 0 && (
              <View style={{ marginTop: 6 }}>
                <Text style={st.label}>{dueLabel}</Text>
                {due.map((d, i) => (
                  <Text key={i} style={st.rowName}>{nameOf(d.toPlayerId)} · {formatMoney(d.amount, event.currency)}</Text>
                ))}
              </View>
            )}
          </View>
        )}

        <View style={st.card}>
          <Text style={st.label}>WAITING ROOM · {counts.accepted} in{counts.invited ? ` · ${counts.invited} pending` : ''}</Text>
          {room.length === 0 ? <Text style={st.sub}>No one yet.</Text> : room.map(p => {
            const canMarkPaid = isHost;
            return (
              <View key={p.id} style={st.row}>
                <Image source={resolveAvatar(p.player_id, p.avatar_url)} style={{ width: 32, height: 32, borderRadius: 16 }} />
                <Text style={st.rowName}>{p.display_name}{p.player_id === me?.id ? ' (you)' : ''}{p.player_id === event.host_player_id ? ' · host' : ''}</Text>
                <View style={[st.chip, { borderColor: p.status === 'accepted' ? GREEN : '#2a2a2a' }]}>
                  <Text style={[st.chipText, { color: p.status === 'accepted' ? GREEN : '#9ca3af' }]}>{p.status === 'accepted' ? 'IN' : 'PENDING'}</Text>
                </View>
                {moneyOn && p.status === 'accepted' && (
                  <TouchableOpacity disabled={!canMarkPaid || busy} onPress={() => run(() => setSocialPaid(event.id, p.player_id, !p.paid))}
                    style={[st.chip, { borderColor: p.paid ? GREEN : '#2a2a2a' }]} activeOpacity={canMarkPaid ? 0.7 : 1}>
                    <Text style={[st.chipText, { color: p.paid ? GREEN : '#9ca3af' }]}>{p.paid ? 'PAID' : canMarkPaid ? 'MARK PAID' : 'UNPAID'}</Text>
                  </TouchableOpacity>
                )}
                {isHost && p.player_id !== event.host_player_id && (
                  <TouchableOpacity onPress={() => setConfirm({ remove: p })} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={{ color: '#9ca3af' }}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
          {pendingRows.length > 5 && (
            <TouchableOpacity onPress={() => setShowPending(v => !v)} activeOpacity={0.7} style={{ paddingVertical: 8 }}>
              <Text style={{ color: GOLD, fontFamily: FFB, fontSize: 13 }}>
                {foldPending ? `+ ${foldedCount} haven't replied · tap to show` : 'Hide pending'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Invitee / joiner controls */}
        {!isHost && event.status === 'open' && (!mine || mine.status === 'invited' || mine.status === 'declined') && me && (
          <TouchableOpacity style={[st.redBtn, busy && st.disabled]} disabled={busy} activeOpacity={0.85}
            onPress={() => run(() => respondToSocialEvent(event, me.id, me.display_name, 'accepted'))}>
            <Text style={st.redText}>I'm in</Text>
          </TouchableOpacity>
        )}
        {!isHost && event.status === 'open' && (mine?.status === 'accepted' || mine?.status === 'invited') && me && (
          <TouchableOpacity style={[st.ghostBtn, busy && st.disabled]} disabled={busy} activeOpacity={0.85}
            onPress={() => run(() => respondToSocialEvent(event, me.id, me.display_name, 'declined'))}>
            <Text style={st.ghostText}>Can't make it</Text>
          </TouchableOpacity>
        )}

        {(mine?.status === 'accepted' || isHost) && event.status !== 'cancelled' && (
          <TouchableOpacity style={st.ghostBtn} onPress={() => router.push(`/(app)/social18/chat/${event.id}` as any)} activeOpacity={0.85}>
            <Text style={st.ghostText}>Event chat</Text>
          </TouchableOpacity>
        )}
        {event.day_id && (
          <TouchableOpacity style={st.primaryBtn} onPress={() => router.push(`/(app)/score/day/${event.day_id}` as any)} activeOpacity={0.85}>
            <Text style={st.primaryText}>Open the Game Day</Text>
          </TouchableOpacity>
        )}

        {/* Host-only controls — invitees never see these */}
        {isHost && event.status !== 'cancelled' && (
          <>
            {event.status === 'open' && (
              <TouchableOpacity
                style={[st.redBtn, !canStartDay(accepted.length) && st.disabled]}
                disabled={!canStartDay(accepted.length)} activeOpacity={0.85}
                onPress={() => router.push(
                  `/(app)/games/new?socialEventId=${event.id}&onlyPlayerIds=${accepted.join(',')}&resumeMode=${event.format === 'team' ? 'team_stableford' : 'stableford'}${event.course_name ? `&course=${encodeURIComponent(event.course_name)}` : ''}` as any,
                )}>
                <Text style={st.redText}>{canStartDay(accepted.length) ? `Start the day (${accepted.length} in)` : 'Need at least 2 players in'}</Text>
              </TouchableOpacity>
            )}
            {event.status === 'open' && (
              <>
                <TouchableOpacity style={st.ghostBtn} onPress={openInvite} activeOpacity={0.85}><Text style={st.ghostText}>Invite more</Text></TouchableOpacity>
                <TouchableOpacity style={[st.ghostBtn, busy && st.disabled]} disabled={busy} activeOpacity={0.85}
                  onPress={() => run(async () => { await postSocialToChat(event, event.host_player_id, me?.display_name ?? ''); setPostedToChat(true); })}>
                  <Text style={st.ghostText}>{postedToChat ? 'Posted to chat ✓ (tap to post again)' : 'Post to chat'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={st.ghostBtn} onPress={() => router.push(`/(app)/social18/create?id=${event.id}` as any)} activeOpacity={0.85}><Text style={st.ghostText}>Edit event</Text></TouchableOpacity>
              </>
            )}
            {event.status === 'started' && (
              <TouchableOpacity style={st.primaryBtn} onPress={() => setConfirm('complete')} activeOpacity={0.85}>
                <Text style={st.primaryText}>Mark complete</Text>
              </TouchableOpacity>
            )}
            {!complete && (
              <TouchableOpacity style={st.ghostBtn} onPress={() => setConfirm('cancel')} activeOpacity={0.85}>
                <Text style={[st.ghostText, { color: RED }]}>Cancel event</Text>
              </TouchableOpacity>
            )}
            {isHost && (
              <TouchableOpacity style={st.ghostBtn} onPress={() => setConfirm('delete')} activeOpacity={0.85}>
                <Text style={[st.ghostText, { color: RED }]}>Delete event</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>

      <PlayerSelectorSheet visible={showInvite} title="Tap to invite" players={roster}
        onSelect={p => { setRoster(prev => prev.filter(x => x.id !== p.id)); run(() => inviteMore(event, me?.display_name ?? '', [p.id])); }}
        onClose={() => setShowInvite(false)} />

      <ConfirmDialog visible={!!confirmCopy} title={confirmCopy?.title ?? ''} message={confirmCopy?.message ?? ''}
        confirmLabel={confirmCopy?.label ?? ''} destructive={confirmCopy?.destructive}
        onConfirm={onConfirm} onCancel={() => setConfirm(null)} />
    </View>
  );
}
