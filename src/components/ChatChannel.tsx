import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, Image, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useFonts } from 'expo-font';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import SwipeableRow from './SwipeableRow';
import { resolveAvatar } from '../lib/assets';
import { useSocietyTheme } from '../lib/SocietyThemeContext';
import { sendPushNotification } from '../lib/notifications';

const GOLD  = '#D4AF37';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';

// One select for every read path (initial load + the realtime refetch) so a
// reply's quoted original always comes back with it. The quote is embedded off
// the reply_to_message_id FK rather than looked up in the loaded window —
// replies to messages older than the 60-row window still render their quote.
const MSG_SELECT =
  '*, player:player_id(display_name, avatar_url), reply_to:reply_to_message_id(id, player_id, content, player:player_id(display_name))';

export type ChatChannelKey = 'general' | 'swindle' | 'tour';

export function chatReadKey(channel: ChatChannelKey) {
  // 'general' keeps the original unscoped key so nobody's existing chat
  // read-state/badge resets to "unread" just because channels were added.
  return channel === 'general' ? 'chat_last_read' : `chat_last_read_${channel}`;
}

interface QuotedMessage {
  id: string;
  player_id: string;
  content: string;
  player: { display_name: string } | null;
}

interface Message {
  id: string;
  player_id: string;
  content: string;
  created_at: string;
  channel: ChatChannelKey;
  player: { display_name: string; avatar_url: string | null } | null;
  reply_to_message_id: string | null;
  // null while reply_to_message_id is set means the original was deleted
  // (the FK is ON DELETE SET NULL, so this is only the pre-refetch window).
  reply_to: QuotedMessage | null;
}

interface Me { id: string; display_name: string; avatar_url: string | null; }

export default function ChatChannel({ channel, title, subtitleLabel, placeholder }: {
  channel: ChatChannelKey;
  title: string;
  subtitleLabel: string;
  placeholder: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  // Same active-society source as everywhere else (Locker Room switcher) —
  // this used to run its own "alphabetically-first membership" query, which
  // could silently disagree with whatever society a message was actually
  // posted under (e.g. swindle/[gameId].tsx's postResultsToChat uses this
  // same context), so results posted under one society never showed up
  // here because this screen was reading a different one.
  const { societyId, loaded: societyLoaded } = useSocietyTheme();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const flatRef = useRef<FlatList>(null);
  const subRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  // Mark this channel's messages as read whenever this screen is visible —
  // each channel has its own read key, so reading Swindle chat never
  // touches the General or Tournament unread badges.
  useFocusEffect(
    useCallback(() => {
      AsyncStorage.setItem(chatReadKey(channel), new Date().toISOString());
    }, [channel])
  );

  useEffect(() => {
    async function init() {
      if (!societyLoaded) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data: player } = await supabase
        .from('players')
        .select('id, display_name, avatar_url')
        .eq('auth_uid', user.id)
        .maybeSingle();
      if (!player) { setLoading(false); return; }
      setMe(player as Me);

      const sid = societyId;
      if (!sid) { setLoading(false); return; }

      const { data } = await supabase
        .from('messages')
        .select(MSG_SELECT)
        .eq('society_id', sid)
        .eq('channel', channel)
        .order('created_at', { ascending: false })
        .limit(60);
      if (data) setMessages(data as unknown as Message[]);
      setLoading(false);

      // Subscribe to this society's messages (Realtime filters only support
      // one column server-side), then drop anything not from this channel
      // client-side — keeps General/Swindle/Tour fully isolated from each
      // other without leaking rows from other societies either.
      subRef.current = supabase
        .channel(`chat-live-${sid}-${channel}`)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `society_id=eq.${sid}` },
          async (payload) => {
            if (payload.new.channel !== channel) return;
            const { data: msg } = await supabase
              .from('messages')
              .select(MSG_SELECT)
              .eq('id', payload.new.id)
              .single();
            if (msg) setMessages(prev => [msg as unknown as Message, ...prev]);
          })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) => {
          setMessages(prev => prev.filter(m => m.id !== payload.old.id));
        })
        .subscribe();
    }
    init();

    return () => { if (subRef.current) supabase.removeChannel(subRef.current); };
  }, [channel, societyId, societyLoaded]);

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  async function sendMessage() {
    if (!text.trim() || !me || !societyId || sending) return;
    const content = text.trim();
    const replyingTo = replyTo;
    setText('');
    setReplyTo(null);
    setSending(true);
    const { error } = await supabase.from('messages').insert({
      player_id: me.id, content, society_id: societyId, channel,
      reply_to_message_id: replyingTo?.id ?? null,
    });
    if (error) {
      console.error('send message failed:', error);
      setText(content);
      setReplyTo(replyingTo);
    } else {
      supabase.from('society_members').select('player_id').eq('society_id', societyId).neq('player_id', me.id)
        .then(({ data: rows }) => {
          const recipientIds = (rows ?? []).map(r => r.player_id);
          sendPushNotification(me.display_name, content, recipientIds, { type: 'message', channel, societyId });
        });
    }
    setSending(false);
  }

  function formatTime(ts: string) {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Tapping a quote jumps to the original when it's still in the loaded
  // window and flashes it; older-than-the-window originals just do nothing
  // rather than fetching a whole extra page.
  function scrollToOriginal(originalId: string) {
    const idx = messages.findIndex(m => m.id === originalId);
    if (idx < 0) return;
    flatRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
    setHighlightId(originalId);
    setTimeout(() => setHighlightId(prev => (prev === originalId ? null : prev)), 1400);
  }

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    const isMe = item.player_id === me?.id;
    const name = item.player?.display_name?.split(' ')[0] ?? '?';
    const avatar = resolveAvatar(item.player_id, item.player?.avatar_url ?? null);
    const prev = messages[index + 1];
    const showAvatar = !prev || prev.player_id !== item.player_id;
    const quoted = item.reply_to;
    const quotedName = quoted
      ? (quoted.player_id === me?.id ? 'You' : (quoted.player?.display_name?.split(' ')[0] ?? 'Player'))
      : null;

    return (
      <SwipeableRow
        onDelete={() => setReplyTo(item)}
        actionLabel="Reply"
        actionIcon="arrow-undo-outline"
        actionColor={GOLD}
        actionTextColor="#000"
        radius={16}
      >
        <View style={[ss.row, isMe && ss.rowMe]}>
          {!isMe && (
            showAvatar
              ? (avatar
                  ? <Image source={avatar} style={ss.avatar} />
                  : <View style={[ss.avatar, ss.avatarFallback]}><Text style={ss.avatarInitial}>{name[0]}</Text></View>)
              : <View style={ss.avatarSpacer} />
          )}
          <View style={[ss.bubble, isMe ? ss.bubbleMe : ss.bubbleThem, highlightId === item.id && ss.bubbleFlash]}>
            {!isMe && showAvatar && <Text style={ss.senderName}>{name}</Text>}
            {item.reply_to_message_id && (
              quoted ? (
                <TouchableOpacity style={ss.quote} onPress={() => scrollToOriginal(quoted.id)} activeOpacity={0.7}>
                  <Text style={ss.quoteName} numberOfLines={1}>{quotedName}</Text>
                  <Text style={ss.quoteText} numberOfLines={2}>{quoted.content}</Text>
                </TouchableOpacity>
              ) : (
                <View style={ss.quote}>
                  <Text style={ss.quoteGone}>Original message deleted</Text>
                </View>
              )
            )}
            <Text style={[ss.msgText, isMe && ss.msgTextMe]}>{item.content}</Text>
            <Text style={[ss.time, isMe && ss.timeMe]}>{formatTime(item.created_at)}</Text>
          </View>
          {isMe && (
            showAvatar
              ? (avatar
                  ? <Image source={avatar} style={ss.avatar} />
                  : <View style={[ss.avatar, ss.avatarFallback]}><Text style={ss.avatarInitial}>{(me?.display_name ?? '?')[0]}</Text></View>)
              : <View style={ss.avatarSpacer} />
          )}
        </View>
      </SwipeableRow>
    );
  };

  return (
    <View style={ss.container}>
      <StatusBar style="light" />

      {/* Header: three-column */}
      <View style={ss.header}>
        <View style={ss.headerLeft} />
        <View style={ss.headerCenter}>
          <Text style={ss.headerTitle}>{title}</Text>
          <Text style={ss.headerSub}>{subtitleLabel} · {messages.length === 0 ? 'No messages yet' : 'Live'}</Text>
        </View>
        <View style={ss.headerRight} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={m => m.id}
          renderItem={renderMessage}
          inverted
          contentContainerStyle={ss.list}
          showsVerticalScrollIndicator={false}
          onScrollToIndexFailed={() => {}}
          ListEmptyComponent={
            <View style={ss.empty}>
              <Text style={ss.emptyIcon}>💬</Text>
              <Text style={ss.emptyTitle}>No messages yet</Text>
              <Text style={ss.emptySub}>Start the chat — say something!</Text>
            </View>
          }
        />

        {replyTo && (
          <View style={ss.replyBar}>
            <View style={ss.replyBarBody}>
              <Text style={ss.quoteName} numberOfLines={1}>
                Replying to {replyTo.player_id === me?.id ? 'yourself' : (replyTo.player?.display_name?.split(' ')[0] ?? 'Player')}
              </Text>
              <Text style={ss.quoteText} numberOfLines={1}>{replyTo.content}</Text>
            </View>
            <TouchableOpacity
              onPress={() => setReplyTo(null)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={18} color="#888" />
            </TouchableOpacity>
          </View>
        )}

        <View style={ss.inputRow}>
          {me && resolveAvatar(me.id, me.avatar_url)
            ? <Image source={resolveAvatar(me.id, me.avatar_url)} style={ss.inputAvatar} />
            : <View style={[ss.inputAvatar, ss.avatarFallback]}>
                <Text style={ss.avatarInitial}>{(me?.display_name ?? '?')[0]}</Text>
              </View>
          }
          <TextInput
            style={ss.input}
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            placeholderTextColor="#555"
            multiline
            maxLength={500}
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
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1c',
  },
  headerLeft:   { flex: 1 },
  headerCenter: { flex: 2, alignItems: 'center' },
  headerRight:  { flex: 1 },
  headerTitle: {
    fontSize: 20,
    fontFamily: FFB,
    color: '#fff',
    letterSpacing: 0.5,
  },
  headerSub: {
    fontSize: 11,
    fontFamily: FFB,
    color: '#fff',
    marginTop: 2,
  },

  list: { padding: 12, paddingBottom: 8 },

  row:   { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 6, gap: 8 },
  rowMe: { flexDirection: 'row-reverse' },

  avatar:         { width: 30, height: 30, borderRadius: 15, overflow: 'hidden' },
  avatarSpacer:   { width: 30 },
  avatarFallback: { backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  avatarInitial:  { fontSize: 12, fontFamily: FFB, color: GOLD },

  bubble: {
    maxWidth: '74%',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  bubbleThem: {
    backgroundColor: '#111',
    borderColor: '#1c1c1c',
    borderBottomLeftRadius: 4,
  },
  bubbleMe: {
    backgroundColor: 'rgba(212,175,55,0.15)',
    borderColor: GOLD,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 4,
  },

  bubbleFlash: { backgroundColor: 'rgba(212,175,55,0.32)', borderColor: GOLD },

  // Quoted original inside a reply's own bubble, and the same treatment on
  // the compose bar — thin gold left border + muted inset, existing tokens only.
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: GOLD,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 5,
  },
  quoteName: { fontSize: 10, fontFamily: FFB, color: GOLD, letterSpacing: 0.3 },
  quoteText: { fontSize: 12, fontFamily: FFB, color: '#aaa', lineHeight: 16, marginTop: 1 },
  quoteGone: { fontSize: 12, fontFamily: FFB, color: '#666', fontStyle: 'italic' },

  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#111',
    borderTopWidth: 1,
    borderTopColor: '#1c1c1c',
  },
  replyBarBody: {
    flex: 1,
    borderLeftWidth: 2,
    borderLeftColor: GOLD,
    paddingLeft: 8,
  },

  senderName: { fontSize: 11, fontFamily: FFB, color: '#fff', marginBottom: 2, letterSpacing: 0.3 },
  msgText:    { fontSize: 14, fontFamily: FFB,  color: '#fff', lineHeight: 18 },
  msgTextMe:  { fontFamily: FFB, color: '#fff' },
  time:       { fontSize: 10, fontFamily: FFB, color: '#fff', marginTop: 3, alignSelf: 'flex-end' },
  timeMe:     { color: '#fff' },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    paddingBottom: Platform.OS === 'ios' ? 32 : 12,
    borderTopWidth: 1,
    borderTopColor: '#1c1c1c',
    backgroundColor: '#111',
    gap: 8,
  },
  inputAvatar: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden', marginBottom: 2 },
  input: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontFamily: FFB,
    fontSize: 14,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: '#1c1c1c',
  },
  sendBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: GOLD,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 2,
  },
  sendBtnDisabled: { opacity: 0.35 },
  sendIcon: { fontSize: 13, fontFamily: FFB, color: '#000', marginLeft: 2 },

  empty:      { flex: 1, alignItems: 'center', paddingTop: 80 },
  emptyIcon:  { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontFamily: FFB, color: '#fff' },
  emptySub:   { fontSize: 14, fontFamily: FFB,  color: '#444', marginTop: 4 },
});
