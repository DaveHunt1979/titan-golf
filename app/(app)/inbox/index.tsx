import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { resolveAvatar } from '../../../src/lib/assets';
import { goBack } from '../../../src/lib/navigation';

const GOLD = '#D4AF37';
const FF   = 'JUSTSans';
const FFB  = 'JUSTSans-ExBold';

type Thread = {
  other_id: string; display_name: string; avatar_url: string | null;
  last_content: string; last_at: string; last_from_me: boolean; unread_count: number;
};

export default function InboxIndex() {
  const router = useRouter();
  const dc = useDynamicColors();
  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    const { data, error } = await supabase.rpc('get_my_dm_threads');
    if (!error && data) setThreads(data as Thread[]);
    setLoading(false);
  }

  function formatTime(ts: string) {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }

  if (loading || !fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: dc.bg, alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar style="light" />
        <ActivityIndicator color={dc.gold} size="large" />
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/')} style={s.headerBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color={dc.cardText} />
        </TouchableOpacity>
        <Text style={[s.title, { color: dc.cardText }]}>INBOX</Text>
        <TouchableOpacity
          onPress={() => router.push('/(app)/inbox/new' as any)}
          style={s.headerBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="create-outline" size={22} color={dc.gold} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={threads}
        keyExtractor={t => t.other_id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 8 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          const avatar = resolveAvatar(item.other_id, item.avatar_url);
          return (
            <TouchableOpacity
              style={[s.row, { backgroundColor: dc.card, borderColor: dc.border }]}
              onPress={() => router.push(`/(app)/inbox/${item.other_id}?name=${encodeURIComponent(item.display_name)}&avatar=${encodeURIComponent(item.avatar_url ?? '')}` as any)}
              activeOpacity={0.8}
            >
              {avatar
                ? <Image source={avatar} style={s.avatar} />
                : <View style={[s.avatar, s.avatarFallback]}><Text style={s.avatarInitial}>{item.display_name[0]?.toUpperCase()}</Text></View>
              }
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[s.rowName, { color: dc.cardText }]} numberOfLines={1}>{item.display_name}</Text>
                <Text style={[s.rowPreview, item.unread_count > 0 && s.rowPreviewUnread]} numberOfLines={1}>
                  {item.last_from_me ? 'You: ' : ''}{item.last_content}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={s.rowTime}>{formatTime(item.last_at)}</Text>
                {item.unread_count > 0 && (
                  <View style={s.unreadBadge}>
                    <Text style={s.unreadBadgeText}>{item.unread_count > 9 ? '9+' : item.unread_count}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyIcon}>✉️</Text>
            <Text style={[s.emptyTitle, { color: dc.cardText }]}>No messages yet</Text>
            <Text style={s.emptySub}>Tap the pencil to message a friend</Text>
          </View>
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingTop: 56 },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 16 },
  headerBtn: { width: 36, alignItems: 'center' },
  title:     { fontFamily: FFB, fontSize: 13, letterSpacing: 2 },

  row:        { flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, padding: 12 },
  avatar:     { width: 44, height: 44, borderRadius: 22, overflow: 'hidden' },
  avatarFallback: { backgroundColor: 'rgba(212,175,55,0.1)', alignItems: 'center', justifyContent: 'center' },
  avatarInitial:  { fontFamily: FFB, fontSize: 16, color: GOLD },

  rowName:    { fontFamily: FFB, fontSize: 14 },
  rowPreview: { fontFamily: FF, fontSize: 12, color: '#777', marginTop: 2 },
  rowPreviewUnread: { color: '#fff', fontFamily: FFB },
  rowTime:    { fontFamily: FF, fontSize: 10, color: '#666' },

  unreadBadge:     { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  unreadBadgeText: { fontFamily: FFB, fontSize: 10, color: '#000' },

  empty:      { alignItems: 'center', paddingTop: 100, gap: 8 },
  emptyIcon:  { fontSize: 44, marginBottom: 8 },
  emptyTitle: { fontFamily: FFB, fontSize: 16 },
  emptySub:   { fontFamily: FF, fontSize: 13, color: '#555' },
});
