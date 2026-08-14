import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { chatReadKey, type ChatChannelKey } from '../components/ChatChannel';

// Per-channel unread count for a chat entry-point badge (Chat/Swindle/Tour
// quick-links) — each channel has its own read key, so this never counts
// messages from the other two channels.
export function useChatUnread(channel: ChatChannelKey, societyId: string | null, playerId: string | null) {
  const [unread, setUnread] = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    async function check() {
      if (!societyId) { if (active) setUnread(0); return; }
      const lastRead = await AsyncStorage.getItem(chatReadKey(channel));
      const since = lastRead ?? new Date(0).toISOString();
      let q = supabase.from('messages').select('id', { count: 'exact', head: true })
        .eq('society_id', societyId).eq('channel', channel).gt('created_at', since);
      if (playerId) q = q.neq('player_id', playerId);
      const { count } = await q;
      if (active) setUnread(count ?? 0);
    }
    check();
    return () => { active = false; };
  }, [channel, societyId, playerId]));

  return unread;
}
