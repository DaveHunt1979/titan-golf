import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, Image, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useFonts } from 'expo-font';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';

const GOLD  = '#D4AF37';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';

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
  const [societyId, setSocietyId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const flatRef = useRef<FlatList>(null);
  const subRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

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
      if (!player) { setLoading(false); return; }
      setMe(player as Me);

      const { data: membership } = await supabase
        .from('society_members')
        .select('society_id')
        .eq('player_id', player.id)
        .maybeSingle();
      const sid = membership?.society_id ?? null;
      setSocietyId(sid);

      if (!sid) { setLoading(false); return; }

      const { data } = await supabase
        .from('messages')
        .select('*, player:player_id(display_name, avatar_url)')
        .eq('society_id', sid)
        .order('created_at', { ascending: false })
        .limit(60);
      if (data) setMessages(data as unknown as Message[]);
      setLoading(false);

      // Subscribe to this society's chat only — set up here so sid is known
      subRef.current = supabase
        .channel(`chat-live-${sid}`)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `society_id=eq.${sid}` },
          async (payload) => {
            const { data: msg } = await supabase
              .from('messages')
              .select('*, player:player_id(display_name, avatar_url)')
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
  }, []);

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  async function sendMessage() {
    if (!text.trim() || !me || !societyId || sending) return;
    const content = text.trim();
    setText('');
    setSending(true);
    await supabase.from('messages').insert({ player_id: me.id, content, society_id: societyId });
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
        <View style={[ss.bubble, isMe ? ss.bubbleMe : ss.bubbleThem]}>
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

      {/* Header: three-column */}
      <View style={ss.header}>
        <View style={ss.headerLeft} />
        <View style={ss.headerCenter}>
          <Text style={ss.headerTitle}>Chat</Text>
          <Text style={ss.headerSub}>Society Group · {messages.length === 0 ? 'No messages yet' : 'Live'}</Text>
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

  // Header
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
