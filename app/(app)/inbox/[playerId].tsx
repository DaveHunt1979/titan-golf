import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, Image, ActivityIndicator, Alert, Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { resolveAvatar } from '../../../src/lib/assets';
import { goBack } from '../../../src/lib/navigation';
import { sendPushNotification } from '../../../src/lib/notifications';

const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const RED    = '#f87171';
const FFB    = 'JUSTSans-ExBold';

interface DM {
  id: string; sender_id: string; recipient_id: string; content: string; created_at: string;
  message_type: 'text' | 'tournament_invite' | 'newsreel' | 'swindle_settlement' | 'match_report' | 'swindle_records';
  competition_id: string | null;
  invite_response: 'accepted' | 'declined' | null;
  link_url: string | null;
  competitions: { name: string; pin: string | null } | null;
}

const DM_SELECT = 'id, sender_id, recipient_id, content, created_at, message_type, competition_id, invite_response, link_url, competitions(name, pin)';

export default function DmThread() {
  const { playerId, name, avatar } = useLocalSearchParams<{ playerId: string; name?: string; avatar?: string }>();
  const router = useRouter();
  const otherName   = name ? decodeURIComponent(name) : 'Player';
  const otherAvatar = avatar ? decodeURIComponent(avatar) : null;

  const [myId, setMyId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DM[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const flatRef = useRef<FlatList>(null);
  const subRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  useEffect(() => {
    let active = true;
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: p } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (!p || !active) { setLoading(false); return; }
      const me = p.id as string;
      setMyId(me);

      const { data } = await supabase
        .from('direct_messages')
        .select(DM_SELECT)
        .or(`and(sender_id.eq.${me},recipient_id.eq.${playerId}),and(sender_id.eq.${playerId},recipient_id.eq.${me})`)
        .order('created_at', { ascending: false })
        .limit(100);
      if (data && active) setMessages(data as unknown as DM[]);
      if (active) setLoading(false);

      // Realtime only filters one column server-side — subscribe on
      // recipient_id=me (incoming) and filter to this thread's sender
      // client-side. My own sends are appended optimistically on send.
      // Re-fetch the full row (with the competitions join) rather than
      // trust payload.new directly, same pattern ChatChannel uses.
      subRef.current = supabase
        .channel(`dm-live-${me}`)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${me}` },
          async (payload) => {
            if (payload.new.sender_id !== playerId) return;
            const { data: row } = await supabase.from('direct_messages').select(DM_SELECT).eq('id', payload.new.id).single();
            if (row) setMessages(prev => prev.some(m => m.id === row.id) ? prev : [row as unknown as DM, ...prev]);
          })
        .subscribe();

      await supabase.from('direct_messages')
        .update({ read_at: new Date().toISOString() })
        .eq('recipient_id', me).eq('sender_id', playerId).is('read_at', null);
    }
    init();
    return () => { active = false; if (subRef.current) supabase.removeChannel(subRef.current); };
  }, [playerId]);

  // Re-mark read each time the thread is revisited without a full remount.
  useFocusEffect(useCallback(() => {
    if (!myId) return;
    supabase.from('direct_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', myId).eq('sender_id', playerId).is('read_at', null);
  }, [myId, playerId]));

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  async function sendMessage() {
    if (!text.trim() || !myId || sending) return;
    const content = text.trim();
    setText('');
    setSending(true);
    const { data, error } = await supabase.from('direct_messages')
      .insert({ sender_id: myId, recipient_id: playerId, content })
      .select(DM_SELECT)
      .single();
    if (error) {
      console.error('send DM failed:', error);
      setText(content);
    } else if (data) {
      setMessages(prev => [data as unknown as DM, ...prev]);
      supabase.from('players').select('display_name').eq('id', myId).single().then(({ data: me }) => {
        sendPushNotification(me?.display_name ?? 'New message', content, [playerId as string], { type: 'message', senderId: myId });
      });
    }
    setSending(false);
  }

  // Only the recipient of a still-unanswered invite can respond — writes
  // both the invite message's own state and the actual enrolment row.
  async function respondToInvite(msg: DM, response: 'accepted' | 'declined') {
    if (!myId || msg.recipient_id !== myId || msg.invite_response || !msg.competition_id) return;
    const { error: cpErr } = await supabase.from('competition_players')
      .update({ status: response === 'accepted' ? 'enrolled' : 'declined' })
      .eq('competition_id', msg.competition_id).eq('player_id', myId);
    if (cpErr) { Alert.alert('Error', cpErr.message); return; }
    await supabase.from('direct_messages').update({ invite_response: response }).eq('id', msg.id);
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, invite_response: response } : m));
  }

  function confirmDeleteMessage(msg: DM) {
    Alert.alert('Delete Message', 'Delete this message? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('direct_messages').delete().eq('id', msg.id);
        if (error) { Alert.alert('Error', error.message); return; }
        setMessages(prev => prev.filter(m => m.id !== msg.id));
      }},
    ]);
  }

  function formatTime(ts: string) {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const avatarSrc = resolveAvatar(playerId, otherAvatar);

  const renderMessage = ({ item, index }: { item: DM; index: number }) => {
    const isMe = item.sender_id === myId;

    if (item.message_type === 'match_report') {
      return (
        <View style={ss.inviteWrap}>
          <View style={ss.inviteCard}>
            <Text style={ss.inviteEmoji}>⛳</Text>
            <Text style={ss.inviteHeading}>Match Report</Text>
            <Text style={ss.inviteBody}>{item.content}</Text>
            {item.link_url && (
              <TouchableOpacity style={ss.inviteYesBtn} onPress={() => Linking.openURL(item.link_url!)} activeOpacity={0.85}>
                <Text style={ss.inviteYesText}>Read the Report</Text>
              </TouchableOpacity>
            )}
            <Text style={[ss.time, { alignSelf: 'center', marginTop: 8 }]}>{formatTime(item.created_at)}</Text>
          </View>
        </View>
      );
    }

    if (item.message_type === 'newsreel') {
      return (
        <View style={ss.inviteWrap}>
          <View style={ss.inviteCard}>
            <Text style={ss.inviteEmoji}>📰</Text>
            <Text style={ss.inviteHeading}>Titan Newsreel</Text>
            <Text style={ss.inviteBody}>{item.content}</Text>
            {item.link_url && (
              <TouchableOpacity style={ss.inviteYesBtn} onPress={() => Linking.openURL(item.link_url!)} activeOpacity={0.85}>
                <Text style={ss.inviteYesText}>Read the Newsreel</Text>
              </TouchableOpacity>
            )}
            <Text style={[ss.time, { alignSelf: 'center', marginTop: 8 }]}>{formatTime(item.created_at)}</Text>
          </View>
        </View>
      );
    }

    if (item.message_type === 'swindle_settlement') {
      return (
        <View style={ss.inviteWrap}>
          <View style={ss.inviteCard}>
            <Text style={ss.inviteEmoji}>💰</Text>
            <Text style={ss.inviteHeading}>Swindle Settlement</Text>
            <Text style={ss.inviteBody}>{item.content}</Text>
            {item.link_url && (
              <TouchableOpacity style={ss.inviteYesBtn} onPress={() => Linking.openURL(item.link_url!)} activeOpacity={0.85}>
                <Text style={ss.inviteYesText}>View & Mark Settled</Text>
              </TouchableOpacity>
            )}
            <Text style={[ss.time, { alignSelf: 'center', marginTop: 8 }]}>{formatTime(item.created_at)}</Text>
          </View>
        </View>
      );
    }

    if (item.message_type === 'swindle_records') {
      return (
        <View style={ss.inviteWrap}>
          <View style={ss.inviteCard}>
            <Text style={ss.inviteEmoji}>🏆</Text>
            <Text style={ss.inviteHeading}>Swindle Season Stats</Text>
            <Text style={ss.inviteBody}>{item.content}</Text>
            {item.link_url && (
              <TouchableOpacity style={ss.inviteYesBtn} onPress={() => Linking.openURL(item.link_url!)} activeOpacity={0.85}>
                <Text style={ss.inviteYesText}>View the Leaderboard</Text>
              </TouchableOpacity>
            )}
            <Text style={[ss.time, { alignSelf: 'center', marginTop: 8 }]}>{formatTime(item.created_at)}</Text>
          </View>
        </View>
      );
    }

    if (item.message_type === 'tournament_invite') {
      return (
        <View style={ss.inviteWrap}>
          <View style={ss.inviteCard}>
            <Text style={ss.inviteEmoji}>🏆</Text>
            <Text style={ss.inviteHeading}>Tournament Invite</Text>
            <Text style={ss.inviteBody}>{item.content}</Text>
            {item.invite_response ? (
              <View style={[ss.inviteBadge, item.invite_response === 'accepted' ? ss.inviteBadgeYes : ss.inviteBadgeNo]}>
                <Text style={[ss.inviteBadgeText, { color: item.invite_response === 'accepted' ? GREEN : RED }]}>
                  {item.invite_response === 'accepted' ? '✓ Accepted' : '✕ Declined'}
                </Text>
              </View>
            ) : isMe ? (
              <Text style={ss.invitePending}>Waiting for their response…</Text>
            ) : (
              <View style={ss.inviteActions}>
                <TouchableOpacity style={ss.inviteYesBtn} onPress={() => respondToInvite(item, 'accepted')} activeOpacity={0.85}>
                  <Text style={ss.inviteYesText}>Yes, I'm in</Text>
                </TouchableOpacity>
                <TouchableOpacity style={ss.inviteNoBtn} onPress={() => respondToInvite(item, 'declined')} activeOpacity={0.85}>
                  <Text style={ss.inviteNoText}>Decline</Text>
                </TouchableOpacity>
              </View>
            )}
            <Text style={[ss.time, { alignSelf: 'center', marginTop: 8 }]}>{formatTime(item.created_at)}</Text>
          </View>
        </View>
      );
    }

    const prev = messages[index + 1];
    const showAvatar = !prev || prev.sender_id !== item.sender_id;

    return (
      <View style={[ss.row, isMe && ss.rowMe]}>
        {!isMe && (
          showAvatar
            ? (avatarSrc
                ? <Image source={avatarSrc} style={ss.avatar} />
                : <View style={[ss.avatar, ss.avatarFallback]}><Text style={ss.avatarInitial}>{otherName[0]}</Text></View>)
            : <View style={ss.avatarSpacer} />
        )}
        <TouchableOpacity
          style={[ss.bubble, isMe ? ss.bubbleMe : ss.bubbleThem]}
          onLongPress={() => confirmDeleteMessage(item)}
          activeOpacity={0.8}
        >
          <Text style={ss.msgText}>{item.content}</Text>
          <Text style={ss.time}>{formatTime(item.created_at)}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={ss.container}>
      <StatusBar style="light" />

      <View style={ss.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/inbox')} style={ss.headerSide} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={ss.headerCenter}>
          {avatarSrc
            ? <Image source={avatarSrc} style={ss.headerAvatar} />
            : <View style={[ss.headerAvatar, ss.avatarFallback]}><Text style={ss.avatarInitial}>{otherName[0]}</Text></View>
          }
          <Text style={ss.headerTitle} numberOfLines={1}>{otherName}</Text>
        </View>
        <View style={ss.headerSide} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={m => m.id}
          renderItem={renderMessage}
          inverted
          contentContainerStyle={ss.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={ss.empty}>
              <Text style={ss.emptyIcon}>✉️</Text>
              <Text style={ss.emptyTitle}>No messages yet</Text>
              <Text style={ss.emptySub}>Say hello to {otherName.split(' ')[0]}</Text>
            </View>
          }
        />

        <View style={ss.inputRow}>
          <TextInput
            style={ss.input}
            value={text}
            onChangeText={setText}
            placeholder="Message…"
            placeholderTextColor="#555"
            multiline
            maxLength={1000}
          />
          <TouchableOpacity
            style={[ss.sendBtn, (!text.trim() || sending) && ss.sendBtnDisabled]}
            onPress={sendMessage}
            disabled={!text.trim() || sending}
            activeOpacity={0.8}
          >
            <Text style={ss.sendIcon}>▶</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const ss = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  headerSide:   { width: 40 },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  headerAvatar: { width: 28, height: 28, borderRadius: 14, overflow: 'hidden' },
  headerTitle:  { fontSize: 16, fontFamily: FFB, color: '#fff' },

  list: { padding: 12, paddingBottom: 8 },

  row:   { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 6, gap: 8 },
  rowMe: { flexDirection: 'row-reverse' },

  avatar:         { width: 30, height: 30, borderRadius: 15, overflow: 'hidden' },
  avatarSpacer:   { width: 30 },
  avatarFallback: { backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  avatarInitial:  { fontSize: 12, fontFamily: FFB, color: GOLD },

  bubble: { maxWidth: '74%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1 },
  bubbleThem: { backgroundColor: '#111', borderColor: '#1c1c1c', borderBottomLeftRadius: 4 },
  bubbleMe:   { backgroundColor: 'rgba(212,175,55,0.15)', borderColor: GOLD, borderBottomLeftRadius: 16, borderBottomRightRadius: 4 },

  msgText: { fontSize: 14, fontFamily: FFB, color: '#fff', lineHeight: 18 },
  time:    { fontSize: 10, fontFamily: FFB, color: '#fff', marginTop: 3, alignSelf: 'flex-end' },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', padding: 12,
    paddingBottom: Platform.OS === 'ios' ? 32 : 12,
    borderTopWidth: 1, borderTopColor: '#1c1c1c', backgroundColor: '#111', gap: 8,
  },
  input: {
    flex: 1, backgroundColor: '#1a1a1a', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 10,
    color: '#fff', fontFamily: FFB, fontSize: 14, maxHeight: 100, borderWidth: 1, borderColor: '#1c1c1c',
  },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  sendBtnDisabled: { opacity: 0.35 },
  sendIcon: { fontSize: 13, fontFamily: FFB, color: '#000', marginLeft: 2 },

  inviteWrap: { alignItems: 'center', marginBottom: 10 },
  inviteCard: {
    width: '84%', backgroundColor: '#111', borderRadius: 16, borderWidth: 1, borderColor: GOLD,
    padding: 16, alignItems: 'center',
  },
  inviteEmoji:   { fontSize: 28, marginBottom: 6 },
  inviteHeading: { fontSize: 13, fontFamily: FFB, color: GOLD, letterSpacing: 1, marginBottom: 6 },
  inviteBody:    { fontSize: 14, fontFamily: FFB, color: '#fff', textAlign: 'center', lineHeight: 19, marginBottom: 12 },
  inviteActions: { flexDirection: 'row', gap: 8, width: '100%' },
  inviteYesBtn:  { flex: 1, backgroundColor: GOLD, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  inviteYesText: { fontSize: 13, fontFamily: FFB, color: '#000' },
  inviteNoBtn:   { flex: 1, backgroundColor: 'rgba(248,113,113,0.1)', borderWidth: 1, borderColor: 'rgba(248,113,113,0.35)', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  inviteNoText:  { fontSize: 13, fontFamily: FFB, color: RED },
  invitePending: { fontSize: 12, fontFamily: FFB, color: '#666' },
  inviteBadge:   { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1 },
  inviteBadgeYes: { backgroundColor: 'rgba(74,222,128,0.1)', borderColor: 'rgba(74,222,128,0.35)' },
  inviteBadgeNo:  { backgroundColor: 'rgba(248,113,113,0.1)', borderColor: 'rgba(248,113,113,0.35)' },
  inviteBadgeText: { fontSize: 12, fontFamily: FFB },

  empty:      { flex: 1, alignItems: 'center', paddingTop: 80 },
  emptyIcon:  { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontFamily: FFB, color: '#fff' },
  emptySub:   { fontSize: 14, fontFamily: FFB, color: '#444', marginTop: 4 },
});
