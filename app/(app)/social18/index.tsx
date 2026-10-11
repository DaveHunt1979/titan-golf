import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import SwipeableRow from '../../../src/components/SwipeableRow';
import ConfirmDialog from '../../../src/components/ConfirmDialog';
import { useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { goBack } from '../../../src/lib/navigation';
import { listSocialEvents, listSocialHistory, deleteSocialEvent, getMyPlayer, formatEventDate, SocialEvent } from '../../../src/lib/socialEventsApi';
import { st, GOLD, RED, GREEN } from '../../../src/components/social18/styles';

type Role = 'HOST' | 'IN' | 'INVITED' | null;

export default function Social18Hub() {
  const router = useRouter();
  const { societyId } = useSocietyTheme() as any;
  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });
  const [events, setEvents] = useState<SocialEvent[]>([]);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming');

  const load = useCallback(async () => {
    if (!societyId) { setLoading(false); return; }
    try {
      const [list, me] = await Promise.all([(tab === 'history' ? listSocialHistory(societyId) : listSocialEvents(societyId)), getMyPlayer()]);
      const r: Record<string, Role> = {};
      let visible = list;
      if (me && list.length) {
        const { data } = await supabase.from('social_event_players').select('event_id, status')
          .eq('player_id', me.id).in('event_id', list.map(e => e.id));
        const mine = new Map((data ?? []).map((x: any) => [x.event_id as string, x.status as string]));
        visible = list.filter(e => {
          const st0 = mine.get(e.id);
          return e.host_player_id === me.id || (st0 !== 'declined' && st0 !== 'removed');
        });
        for (const e of visible) {
          r[e.id] = e.host_player_id === me.id ? 'HOST'
            : mine.get(e.id) === 'accepted' ? 'IN'
            : mine.get(e.id) === 'invited' ? 'INVITED' : null;
        }
      }
      setEvents(visible);
      setRoles(r);
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [societyId, tab]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function doDelete() {
    const id = deletingId;
    setDeletingId(null);
    if (!id) return;
    try {
      await deleteSocialEvent(id);
      setEvents(list => list.filter(e => e.id !== id));
      setDeleteError(null);
    } catch (e) {
      console.error('[social18.hub] delete failed', e);
      setDeleteError("Couldn't delete that event — only the host can.");
    }
  }

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#000' }}><StatusBar style="light" /></View>;

  return (
    <View style={st.container}>
      <StatusBar style="light" />
      <View style={st.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)')} style={st.backBtn} activeOpacity={0.7}>
          <Text style={st.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={st.headerTitle}>Social 18</Text>
        <View style={st.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={st.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={GOLD} />}
      >
        <TouchableOpacity style={st.redBtn} onPress={() => router.push('/(app)/social18/create' as any)} activeOpacity={0.85}>
          <Text style={st.redText}>Social 18 Create</Text>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          {(['upcoming', 'history'] as const).map(k => (
            <TouchableOpacity key={k} style={[st.ghostBtn, { flex: 1, paddingVertical: 11 }, tab === k && { borderColor: GOLD }]}
              onPress={() => { if (tab !== k) { setLoading(true); setTab(k); } }} activeOpacity={0.85}>
              <Text style={[st.ghostText, tab === k && { color: GOLD }]}>{k === 'upcoming' ? 'Upcoming' : 'History'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? <ActivityIndicator color={GOLD} style={{ marginTop: 24 }} />
          : events.length === 0 ? <Text style={st.empty}>{tab === 'history' ? 'No finished Social 18s yet.' : 'No Social 18s coming up. Create one!'}</Text>
          : events.map(e => {
              const role = roles[e.id];
              return (
                <SwipeableRow key={e.id} enabled={role === 'HOST'} onDelete={() => setDeletingId(e.id)}>
                <TouchableOpacity style={st.card} onPress={() => router.push(`/(app)/social18/${e.id}` as any)} activeOpacity={0.85}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={[st.rowName, { fontSize: 17 }]}>{e.name}</Text>
                    {role && (
                      <View style={[st.chip, { borderColor: role === 'INVITED' ? RED : role === 'HOST' ? GOLD : GREEN }]}>
                        <Text style={[st.chipText, { color: role === 'INVITED' ? RED : role === 'HOST' ? GOLD : GREEN }]}>{role}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={st.sub}>{formatEventDate(e.event_date)}{e.tee_time ? ` · ${e.tee_time}` : ''}</Text>
                  {e.course_name ? <Text style={st.sub}>{e.course_name}</Text> : null}
                </TouchableOpacity>
                </SwipeableRow>
              );
            })}
        {deleteError ? <Text style={[st.sub, { color: RED, textAlign: 'center' }]}>{deleteError}</Text> : null}
      </ScrollView>

      <ConfirmDialog visible={deletingId !== null} title="Delete this event?"
        message="It's removed for everyone, along with its waiting room and chat posts. Scores from a round already played stay in each player's own history. This can't be undone."
        confirmLabel="Delete event" destructive onConfirm={doDelete} onCancel={() => setDeletingId(null)} />
    </View>
  );
}
