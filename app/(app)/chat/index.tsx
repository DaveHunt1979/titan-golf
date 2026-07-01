import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, Image, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';

interface Message {
  id: string;
  player_id: string;
  content: string;
  created_at: string;
  player: { display_name: string; avatar_url: string | null } | null;
}

interface Me { id: string; display_name: string; avatar_url: string | null; }

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const flatRef = useRef<FlatList>(null);

  // Mark all messages as read whenever this screen is visible
  useFocusEffect(
    useCallback(() => {
      AsyncStorage.setItem('chat_last_read', new Date().toISOString());
    }, [])
  );

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data: player } = await supabase
        .from('players')
        .select('id, display_name, avatar_url')
        .eq('auth_uid', user.id)
        .maybeSingle();
      if (player) setMe(player as Me);

      const { data } = await supabase
        .from('messages')
        .select('*, player:player_id(display_name, avatar_url)')
        .order('created_at', { ascending: false })
        .limit(60);
      if (data) setMessages(data as unknown as Message[]);
      setLoading(false);
    }
    init();

    const sub = supabase
      .channel('chat-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        const { data } = await supabase
          .from('messages')
          .select('*, player:player_id(display_name, avatar_url)')
          .eq('id', payload.new.id)
          .single();
        if (data) setMessages(prev => [data as unknown as Message, ...prev]);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) => {
        setMessages(prev => prev.filter(m => m.id !== payload.old.id));
      })
      .subscribe();

    return () => { supabase.removeChannel(sub); };
  }, []);

  async function sendMessage() {
    if (!text.trim() || !me || sending) return;
    const content = text.trim();
    setText('');
    setSending(true);
    await supabase.from('messages').insert({ player_id: me.id, content });
    setSending(false);
  }

  function formatTime(ts: string) {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    const isMe = item.player_id === me?.id;
    const name = item.player?.display_name?.split(' ')[0] ?? '?';
    const avatar = item.player?.avatar_url;
    const prev = messages[index + 1];
    const showAvatar = !prev || prev.player_id !== item.player_id;

    return (
      <View style={[ss.row, isMe && ss.rowMe]}>
        {!isMe && (
          showAvatar
            ? (avatar
                ? <Image source={{ uri: avatar }} style={ss.avatar} />
                : <View style={[ss.avatar, ss.avatarFallback]}><Text style={ss.avatarInitial}>{name[0]}</Text></View>)
            : <View style={ss.avatarSpacer} />
        )}
        <View style={[ss.bubble, isMe && ss.bubbleMe]}>
          {!isMe && showAvatar && <Text style={ss.senderName}>{name}</Text>}
          <Text style={[ss.msgText, isMe && ss.msgTextMe]}>{item.content}</Text>
          <Text style={[ss.time, isMe && ss.timeMe]}>{formatTime(item.created_at)}</Text>
        </View>
        {isMe && (
          showAvatar
            ? (avatar
                ? <Image source={{ uri: avatar }} style={ss.avatar} />
                : <View style={[ss.avatar, ss.avatarFallback]}><Text style={ss.avatarInitial}>{(me?.display_name ?? '?')[0]}</Text></View>)
            : <View style={ss.avatarSpacer} />
        )}
      </View>
    );
  };

  return (
    <View style={ss.container}>
      <StatusBar style="light" />
      <View style={ss.header}>
        <Text style={ss.title}>Chat</Text>
        <Text style={ss.sub}>Society Group · {loading ? '…' : messages.length === 0 ? 'No messages yet' : 'Live'}</Text>
      </View>

      {loading ? (
        <View style={ss.centered}><ActivityIndicator color={colors.gold} size="large" /></View>
      ) : (
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
            ListEmptyComponent={
              <View style={ss.empty}>
                <Text style={ss.emptyIcon}>💬</Text>
                <Text style={ss.emptyTitle}>No messages yet</Text>
                <Text style={ss.emptySub}>Start the chat — say something!</Text>
              </View>
            }
          />

          <View style={ss.inputRow}>
            {me?.avatar_url
              ? <Image source={{ uri: me.avatar_url }} style={ss.inputAvatar} />
              : <View style={[ss.inputAvatar, ss.avatarFallback]}>
                  <Text style={ss.avatarInitial}>{(me?.display_name ?? '?')[0]}</Text>
                </View>
            }
            <TextInput
              style={ss.input}
              value={text}
              onChangeText={setText}
              placeholder="Message the boys..."
              placeholderTextColor={colors.textMuted}
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
      )}
    </View>
  );
}

const ss = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: fonts.xxl, fontWeight: '800', color: colors.white, letterSpacing: 0.5 },
  sub:   { fontSize: fonts.xs, color: colors.textMuted, marginTop: 2 },

  list: { padding: spacing.md, paddingBottom: spacing.sm },

  row:   { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 6, gap: spacing.sm },
  rowMe: { flexDirection: 'row-reverse' },

  avatar:        { width: 30, height: 30, borderRadius: 15, overflow: 'hidden' },
  avatarSpacer:  { width: 30 },
  avatarFallback:{ backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: fonts.xs, fontWeight: '800', color: colors.gold },

  bubble: {
    maxWidth: '74%',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderBottomLeftRadius: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleMe: {
    backgroundColor: colors.gold,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: 4,
    borderColor: 'transparent',
  },

  senderName: { fontSize: 10, fontWeight: '800', color: colors.gold, marginBottom: 2, letterSpacing: 0.3 },
  msgText:    { fontSize: fonts.sm, color: colors.white, lineHeight: 18 },
  msgTextMe:  { color: colors.bg },
  time:       { fontSize: 9, color: colors.textMuted, marginTop: 3, alignSelf: 'flex-end' },
  timeMe:     { color: 'rgba(0,0,0,0.35)' },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? 32 : spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
    gap: spacing.sm,
  },
  inputAvatar: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden', marginBottom: 2 },
  input: {
    flex: 1,
    backgroundColor: colors.cardAlt,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.white,
    fontSize: fonts.sm,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.gold,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 2,
  },
  sendBtnDisabled: { opacity: 0.35 },
  sendIcon: { fontSize: 13, color: colors.bg, fontWeight: '900', marginLeft: 2 },

  empty:     { flex: 1, alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyTitle:{ fontSize: fonts.lg, fontWeight: '700', color: colors.textSecondary },
  emptySub:  { fontSize: fonts.sm, color: colors.textMuted, marginTop: spacing.xs },
});
