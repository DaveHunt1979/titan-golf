import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, FlatList, StyleSheet, ActivityIndicator, Image, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { resolveAvatar } from '../../../src/lib/assets';
import { goBack } from '../../../src/lib/navigation';

const GOLD = '#D4AF37';
const FF   = 'JUSTSans';
const FFB  = 'JUSTSans-ExBold';

type Friend = { member_player_id: string; display_name: string; avatar_url: string | null; is_guest: boolean; t_tag: string | null };
type TagResult = { id: string; display_name: string; avatar_url: string | null; handicap_index: number | null; t_tag: string | null };
type SocietyMember = { id: string; display_name: string; avatar_url: string | null };

export default function InboxNew() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { societyId } = useSocietyTheme();
  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [tab, setTab] = useState<'friends' | 'society' | 'ttag'>('friends');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagInput, setTagInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [tagResult, setTagResult] = useState<TagResult | null>(null);
  const [tagSearched, setTagSearched] = useState(false);
  const [societyMembers, setSocietyMembers] = useState<SocietyMember[]>([]);
  const [societyLoading, setSocietyLoading] = useState(true);
  const [societySearch, setSocietySearch] = useState('');
  const [myId, setMyId] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc('get_my_player_library').then(({ data }) => {
      setFriends(((data ?? []) as any[]).filter(f => !f.is_guest && f.member_player_id));
      setLoading(false);
    });
  }, []);

  // Same lookup pattern as friends.tsx (Members screen) — players' own RLS
  // is self-read-only, but the bulk .in() query against society_members'
  // ids already works there in production, so mirrored as-is here.
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      let pid: string | null = null;
      if (user) {
        const { data: p } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
        if (p) { pid = (p as any).id; setMyId(pid); }
      }
      if (!societyId) { setSocietyLoading(false); return; }

      const { data: memberRows } = await supabase
        .from('society_members').select('player_id').eq('society_id', societyId);
      const ids = [...new Set((memberRows ?? []).map((m: any) => m.player_id))].filter(id => id !== pid);
      if (!ids.length) { setSocietyLoading(false); return; }

      const { data: playersData } = await supabase
        .from('players').select('id,display_name,avatar_url').in('id', ids);
      const members = ((playersData ?? []) as any[])
        .map(p => ({ id: p.id, display_name: p.display_name ?? 'Unknown', avatar_url: p.avatar_url ?? null }))
        .sort((a, b) => a.display_name.localeCompare(b.display_name));
      setSocietyMembers(members);
      setSocietyLoading(false);
    })();
  }, [societyId]);

  const filteredSociety = societySearch.trim()
    ? societyMembers.filter(m => m.display_name.toLowerCase().includes(societySearch.trim().toLowerCase()))
    : societyMembers;

  async function searchTag() {
    const tag = tagInput.trim();
    if (!tag) return;
    setSearching(true);
    setTagSearched(false);
    const { data, error } = await supabase.rpc('find_player_by_ttag', { p_tag: tag });
    if (error) { Alert.alert('Error', error.message); setSearching(false); return; }
    const row = Array.isArray(data) ? data[0] : data;
    setTagResult(row ?? null);
    setTagSearched(true);
    setSearching(false);
  }

  function openThread(id: string, name: string, avatar: string | null) {
    router.replace(`/(app)/inbox/${id}?name=${encodeURIComponent(name)}&avatar=${encodeURIComponent(avatar ?? '')}` as any);
  }

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: dc.bg, alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar style="light" /><ActivityIndicator color={dc.gold} size="large" />
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/inbox')} style={s.headerBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={24} color={dc.cardText} />
        </TouchableOpacity>
        <Text style={[s.title, { color: dc.cardText }]}>NEW MESSAGE</Text>
        <View style={s.headerBtn} />
      </View>

      <View style={s.tabRow}>
        <TouchableOpacity style={[s.tabBtn, tab === 'friends' && s.tabBtnActive]} onPress={() => setTab('friends')} activeOpacity={0.8}>
          <Text style={[s.tabText, tab === 'friends' && s.tabTextActive]}>Friends</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tabBtn, tab === 'society' && s.tabBtnActive]} onPress={() => setTab('society')} activeOpacity={0.8}>
          <Text style={[s.tabText, tab === 'society' && s.tabTextActive]}>Society</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tabBtn, tab === 'ttag' && s.tabBtnActive]} onPress={() => setTab('ttag')} activeOpacity={0.8}>
          <Text style={[s.tabText, tab === 'ttag' && s.tabTextActive]}>T-Tag</Text>
        </TouchableOpacity>
      </View>

      {tab === 'friends' ? (
        loading ? (
          <ActivityIndicator color={dc.gold} size="large" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={friends}
            keyExtractor={f => f.member_player_id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 8 }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const avatar = resolveAvatar(item.member_player_id, item.avatar_url);
              return (
                <TouchableOpacity
                  style={[s.row, { backgroundColor: dc.card, borderColor: dc.border }]}
                  onPress={() => openThread(item.member_player_id, item.display_name, item.avatar_url)}
                  activeOpacity={0.8}
                >
                  {avatar
                    ? <Image source={avatar} style={s.avatar} />
                    : <View style={[s.avatar, s.avatarFallback]}><Text style={s.avatarInitial}>{item.display_name[0]?.toUpperCase()}</Text></View>
                  }
                  <Text style={[s.rowName, { color: dc.cardText }]}>{item.display_name}</Text>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={s.empty}>
                <Text style={[s.emptyTitle, { color: dc.cardText }]}>No friends in your Player Library yet</Text>
                <Text style={s.emptySub}>Add players from a round, or try the T-Tag tab</Text>
              </View>
            }
          />
        )
      ) : tab === 'society' ? (
        societyLoading ? (
          <ActivityIndicator color={dc.gold} size="large" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={filteredSociety}
            keyExtractor={m => m.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 8 }}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <TextInput
                style={[s.tagInput, { backgroundColor: dc.card, borderColor: dc.border, color: dc.cardText, marginBottom: 12 }]}
                placeholder="Search society members…"
                placeholderTextColor="#444"
                value={societySearch}
                onChangeText={setSocietySearch}
              />
            }
            renderItem={({ item }) => {
              const avatar = resolveAvatar(item.id, item.avatar_url);
              return (
                <TouchableOpacity
                  style={[s.row, { backgroundColor: dc.card, borderColor: dc.border }]}
                  onPress={() => openThread(item.id, item.display_name, item.avatar_url)}
                  activeOpacity={0.8}
                >
                  {avatar
                    ? <Image source={avatar} style={s.avatar} />
                    : <View style={[s.avatar, s.avatarFallback]}><Text style={s.avatarInitial}>{item.display_name[0]?.toUpperCase()}</Text></View>
                  }
                  <Text style={[s.rowName, { color: dc.cardText }]}>{item.display_name}</Text>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={s.empty}>
                <Text style={[s.emptyTitle, { color: dc.cardText }]}>
                  {societySearch ? 'No members match that search' : 'No other society members found'}
                </Text>
              </View>
            }
          />
        )
      ) : (
        <View style={{ paddingHorizontal: 16 }}>
          <View style={s.tagSearchRow}>
            <TextInput
              style={[s.tagInput, { backgroundColor: dc.card, borderColor: dc.border, color: dc.cardText }]}
              placeholder="Enter T-Tag…"
              placeholderTextColor="#444"
              value={tagInput}
              onChangeText={t => setTagInput(t.toUpperCase())}
              autoCapitalize="characters"
              maxLength={10}
              onSubmitEditing={searchTag}
            />
            <TouchableOpacity style={s.tagSearchBtn} onPress={searchTag} disabled={searching} activeOpacity={0.85}>
              {searching ? <ActivityIndicator color="#000" size="small" /> : <Text style={s.tagSearchBtnText}>Search</Text>}
            </TouchableOpacity>
          </View>

          {tagSearched && !tagResult && (
            <Text style={[s.emptySub, { textAlign: 'center', marginTop: 24 }]}>No player found with that T-Tag</Text>
          )}

          {tagResult && (
            <TouchableOpacity
              style={[s.row, { backgroundColor: dc.card, borderColor: dc.border, marginTop: 16 }]}
              onPress={() => openThread(tagResult.id, tagResult.display_name, tagResult.avatar_url)}
              activeOpacity={0.8}
            >
              {resolveAvatar(tagResult.id, tagResult.avatar_url)
                ? <Image source={resolveAvatar(tagResult.id, tagResult.avatar_url)!} style={s.avatar} />
                : <View style={[s.avatar, s.avatarFallback]}><Text style={s.avatarInitial}>{tagResult.display_name[0]?.toUpperCase()}</Text></View>
              }
              <View>
                <Text style={[s.rowName, { color: dc.cardText }]}>{tagResult.display_name}</Text>
                <Text style={s.rowPreview}>@{tagResult.t_tag}{tagResult.handicap_index != null ? `  ·  HCP ${tagResult.handicap_index}` : ''}</Text>
              </View>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingTop: 56 },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 16 },
  headerBtn: { width: 36, alignItems: 'center' },
  title:     { fontFamily: FFB, fontSize: 13, letterSpacing: 2 },

  tabRow:     { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 16 },
  tabBtn:     { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center', backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c' },
  tabBtnActive: { backgroundColor: 'rgba(212,175,55,0.12)', borderColor: GOLD },
  tabText:    { fontFamily: FFB, fontSize: 13, color: '#888' },
  tabTextActive: { color: GOLD },

  row:        { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, padding: 12 },
  avatar:     { width: 44, height: 44, borderRadius: 22, overflow: 'hidden' },
  avatarFallback: { backgroundColor: 'rgba(212,175,55,0.1)', alignItems: 'center', justifyContent: 'center' },
  avatarInitial:  { fontFamily: FFB, fontSize: 16, color: GOLD },
  rowName:    { fontFamily: FFB, fontSize: 14 },
  rowPreview: { fontFamily: FF, fontSize: 12, color: '#777', marginTop: 2 },

  tagSearchRow: { flexDirection: 'row', gap: 8 },
  tagInput:     { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontFamily: FFB, fontSize: 16, letterSpacing: 2 },
  tagSearchBtn: { backgroundColor: GOLD, borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center', alignItems: 'center' },
  tagSearchBtnText: { fontFamily: FFB, color: '#000', fontSize: 13 },

  empty:      { alignItems: 'center', paddingTop: 60, gap: 8, paddingHorizontal: 32 },
  emptyTitle: { fontFamily: FFB, fontSize: 15, textAlign: 'center' },
  emptySub:   { fontFamily: FF, fontSize: 13, color: '#555', textAlign: 'center' },
});
