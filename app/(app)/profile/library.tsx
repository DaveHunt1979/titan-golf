import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Platform, Modal, TextInput, KeyboardAvoidingView, Image,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { resolveAvatar } from '../../../src/lib/assets';

type LibraryEntry = {
  library_id: string;
  member_player_id: string | null;
  is_guest: boolean;
  display_name: string;
  avatar_url: string | null;
  handicap_index: number | null;
  t_tag: string | null;
  home_club: string | null;
  created_at: string;
};

type FoundPlayer = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  handicap_index: number | null;
  t_tag: string | null;
};

export default function PlayerLibraryScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const s = useMemo(() => makeStyles(dc), [dc]);
  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [ownerId, setOwnerId]   = useState<string | null>(null);
  const [entries, setEntries]   = useState<LibraryEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);

  const [addModal, setAddModal] = useState(false);
  const [addTab,   setAddTab]   = useState<'tag' | 'guest'>('tag');

  const [tagInput,    setTagInput]    = useState('');
  const [searching,   setSearching]   = useState(false);
  const [found,       setFound]       = useState<FoundPlayer | null>(null);
  const [searchedTag, setSearchedTag] = useState<string | null>(null);

  const [guestName, setGuestName] = useState('');
  const [guestHcp,  setGuestHcp]  = useState('');
  const [guestClub, setGuestClub] = useState('');

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: player } = await supabase
      .from('players').select('id').eq('auth_uid', user.id).maybeSingle();
    if (!player) { setLoading(false); return; }
    setOwnerId((player as any).id);

    const { data, error } = await supabase.rpc('get_my_player_library');
    if (error) Alert.alert('Error loading library', error.message);
    setEntries((data ?? []) as LibraryEntry[]);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function openAddModal() {
    setAddTab('tag');
    setTagInput('');
    setFound(null);
    setSearchedTag(null);
    setGuestName('');
    setGuestHcp('');
    setGuestClub('');
    setAddModal(true);
  }

  async function searchTag() {
    const clean = tagInput.trim().replace(/^@/, '');
    if (!clean) return;
    setSearching(true);
    setFound(null);
    setSearchedTag(clean.toUpperCase());
    const { data, error } = await supabase.rpc('find_player_by_ttag', { p_tag: clean });
    setSearching(false);
    if (error) { Alert.alert('Error', error.message); return; }
    const row = Array.isArray(data) ? data[0] : data;
    setFound(row ?? null);
  }

  async function addFoundPlayer() {
    if (!found || !ownerId) return;
    if (found.id === ownerId) { Alert.alert("That's you!", "You can't add yourself to your own library."); return; }
    setSaving(true);
    const { error } = await supabase.from('player_library').insert({
      owner_player_id: ownerId,
      member_player_id: found.id,
      is_guest: false,
    } as any);
    setSaving(false);
    if (error) {
      if ((error as any).code === '23505') {
        Alert.alert('Already added', `${found.display_name} is already in your Player Library.`);
      } else {
        Alert.alert('Error', error.message);
      }
      return;
    }
    setAddModal(false);
    await load();
  }

  async function addGuest() {
    const name = guestName.trim();
    if (!name || !ownerId) { Alert.alert('Name required', "Enter the guest's name."); return; }
    setSaving(true);
    const { error } = await supabase.from('player_library').insert({
      owner_player_id: ownerId,
      is_guest: true,
      guest_name: name,
      guest_handicap: guestHcp.trim() ? parseFloat(guestHcp) : null,
      guest_home_club: guestClub.trim() || null,
    } as any);
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setAddModal(false);
    await load();
  }

  function removeEntry(entry: LibraryEntry) {
    Alert.alert(
      `Remove ${entry.display_name}?`,
      entry.is_guest
        ? 'This removes the guest player from your library.'
        : 'This only removes them from your private library — their Titan account is untouched.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            setEntries(prev => prev.filter(e => e.library_id !== entry.library_id));
            const { error } = await supabase.from('player_library').delete().eq('id', entry.library_id);
            if (error) { Alert.alert('Error', error.message); await load(); }
          },
        },
      ],
    );
  }

  if (loading || !fontsLoaded) {
    return (
      <View style={[s.container, s.centered]}>
        <StatusBar style="light" />
        <ActivityIndicator color={dc.gold} size="large" />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={hit}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Player Library</Text>
        <TouchableOpacity onPress={openAddModal} hitSlop={hit}>
          <Text style={s.addLink}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.hint}>
          Private to you — nobody can see who's in your library, and adding someone doesn't give you access to theirs.
        </Text>

        {entries.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="people-outline" size={32} color={dc.textMuted} style={{ marginBottom: 10 }} />
            <Text style={s.emptyTitle}>Your library is empty</Text>
            <Text style={s.emptySub}>Add players by their T-Tag, or create a guest for someone who hasn't joined Titan yet.</Text>
            <TouchableOpacity style={s.emptyBtn} onPress={openAddModal} activeOpacity={0.85}>
              <Text style={s.emptyBtnText}>+ Add Player</Text>
            </TouchableOpacity>
          </View>
        ) : (
          entries.map(entry => {
            const avatar = !entry.is_guest ? resolveAvatar(entry.member_player_id ?? '', entry.avatar_url) : null;
            return (
              <View key={entry.library_id} style={s.row}>
                <View style={s.rowContent}>
                  {avatar
                    ? <Image source={avatar} style={s.avatarImg} />
                    : (
                      <View style={[s.avatarPlaceholder, { backgroundColor: `${dc.gold}18` }]}>
                        <Text style={[s.avatarInitial, { color: dc.gold }]}>
                          {entry.display_name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )
                  }
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowName}>{entry.display_name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {entry.is_guest ? (
                        <Text style={s.guestTag}>GUEST</Text>
                      ) : entry.t_tag ? (
                        <Text style={s.rowTag}>@{entry.t_tag}</Text>
                      ) : null}
                      {entry.handicap_index != null && (
                        <Text style={s.rowMeta}>HCP {entry.handicap_index}</Text>
                      )}
                    </View>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => removeEntry(entry)}
                  hitSlop={hit}
                  style={s.rowRemoveBtn}
                  activeOpacity={0.7}
                >
                  <Ionicons name="trash-outline" size={18} color={dc.textMuted} />
                </TouchableOpacity>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* ── Add Player Modal ── */}
      <Modal
        visible={addModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setAddModal(false)}
      >
        <KeyboardAvoidingView style={s.modal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setAddModal(false)} hitSlop={hit}>
              <Text style={s.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.modalTitle}>Add Player</Text>
            <View style={{ width: 60 }} />
          </View>

          <View style={s.tabRow}>
            <TouchableOpacity
              style={[s.tabBtn, addTab === 'tag' && { borderColor: dc.gold }]}
              onPress={() => setAddTab('tag')}
              activeOpacity={0.8}
            >
              <Text style={[s.tabBtnText, addTab === 'tag' && { color: dc.gold }]}>Enter T-Tag</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.tabBtn, addTab === 'guest' && { borderColor: dc.gold }]}
              onPress={() => setAddTab('guest')}
              activeOpacity={0.8}
            >
              <Text style={[s.tabBtnText, addTab === 'guest' && { color: dc.gold }]}>Create Guest</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.modalScroll} keyboardShouldPersistTaps="handled">
            {addTab === 'tag' ? (
              <>
                <Text style={s.fieldLabel}>T-TAG</Text>
                <View style={s.searchRow}>
                  <TextInput
                    style={s.searchInput}
                    value={tagInput}
                    onChangeText={setTagInput}
                    placeholder="e.g. RICKYSNELL"
                    placeholderTextColor={dc.textMuted}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    returnKeyType="search"
                    onSubmitEditing={searchTag}
                  />
                  <TouchableOpacity
                    style={[s.searchBtn, { backgroundColor: dc.gold }, (!tagInput.trim() || searching) && { opacity: 0.5 }]}
                    onPress={searchTag}
                    disabled={!tagInput.trim() || searching}
                    activeOpacity={0.85}
                  >
                    {searching ? <ActivityIndicator color="#000" size="small" /> : <Text style={s.searchBtnText}>Find</Text>}
                  </TouchableOpacity>
                </View>

                {searchedTag && !searching && !found && (
                  <Text style={s.notFound}>No player found with tag @{searchedTag}.</Text>
                )}

                {found && (
                  <View style={s.foundCard}>
                    {resolveAvatar(found.id, found.avatar_url)
                      ? <Image source={resolveAvatar(found.id, found.avatar_url)!} style={s.avatarImgLg} />
                      : (
                        <View style={[s.avatarPlaceholderLg, { backgroundColor: `${dc.gold}18` }]}>
                          <Text style={[s.avatarInitialLg, { color: dc.gold }]}>{found.display_name.charAt(0).toUpperCase()}</Text>
                        </View>
                      )
                    }
                    <Text style={s.foundName}>{found.display_name}</Text>
                    <Text style={s.foundMeta}>
                      @{found.t_tag}{found.handicap_index != null ? `  ·  HCP ${found.handicap_index}` : ''}
                    </Text>
                    <TouchableOpacity
                      style={[s.saveBtn, { backgroundColor: dc.gold }, saving && { opacity: 0.5 }]}
                      onPress={addFoundPlayer}
                      disabled={saving}
                      activeOpacity={0.85}
                    >
                      {saving ? <ActivityIndicator color="#000" /> : <Text style={s.saveBtnText}>Add to My Player Library</Text>}
                    </TouchableOpacity>
                  </View>
                )}
              </>
            ) : (
              <>
                <Text style={s.fieldLabel}>NAME</Text>
                <TextInput
                  style={s.plainInput}
                  value={guestName}
                  onChangeText={setGuestName}
                  placeholder="Guest's name"
                  placeholderTextColor={dc.textMuted}
                  autoCapitalize="words"
                  autoFocus
                />
                <Text style={[s.fieldLabel, { marginTop: 16 }]}>HANDICAP (OPTIONAL)</Text>
                <TextInput
                  style={s.plainInput}
                  value={guestHcp}
                  onChangeText={setGuestHcp}
                  placeholder="e.g. 14.2"
                  placeholderTextColor={dc.textMuted}
                  keyboardType="decimal-pad"
                />
                <Text style={[s.fieldLabel, { marginTop: 16 }]}>HOME CLUB (OPTIONAL)</Text>
                <TextInput
                  style={s.plainInput}
                  value={guestClub}
                  onChangeText={setGuestClub}
                  placeholder="e.g. West Cliffs"
                  placeholderTextColor={dc.textMuted}
                  autoCapitalize="words"
                />
                <Text style={s.guestHint}>
                  This guest belongs only to your library. If they join Titan later, add them again by their T-Tag.
                </Text>
                <TouchableOpacity
                  style={[s.saveBtn, { backgroundColor: dc.gold }, (!guestName.trim() || saving) && { opacity: 0.5 }]}
                  onPress={addGuest}
                  disabled={!guestName.trim() || saving}
                  activeOpacity={0.85}
                >
                  {saving ? <ActivityIndicator color="#000" /> : <Text style={s.saveBtnText}>Add Guest Player</Text>}
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const hit = { top: 12, bottom: 12, left: 12, right: 12 };

function makeStyles(c: ReturnType<typeof useDynamicColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    centered:  { alignItems: 'center', justifyContent: 'center' },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingTop: 60, paddingHorizontal: 24, paddingBottom: 16,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    back:    { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: c.gold },
    title:   { fontSize: 15, fontFamily: 'JUSTSans-ExBold', color: c.white, letterSpacing: 0.5 },
    addLink: { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: c.gold },
    scroll:  { padding: 16, paddingBottom: 60 },

    hint: {
      fontSize: 11, fontFamily: 'JUSTSans-ExBold', color: c.textMuted,
      lineHeight: 16, marginBottom: 16,
    },

    row: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: c.card, borderRadius: 14,
      borderWidth: 1, borderColor: c.border,
      paddingVertical: 12, paddingHorizontal: 14,
      marginBottom: 8,
    },
    rowContent: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
    avatarImg:  { width: 40, height: 40, borderRadius: 20 },
    avatarPlaceholder: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    avatarInitial: { fontSize: 15, fontFamily: 'JUSTSans-ExBold' },
    rowName: { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: c.white },
    rowTag:  { fontSize: 11, fontFamily: 'JUSTSans-ExBold', color: c.gold, marginTop: 2 },
    rowMeta: { fontSize: 11, fontFamily: 'JUSTSans-ExBold', color: c.textMuted, marginTop: 2 },
    guestTag: {
      fontSize: 9, fontFamily: 'JUSTSans-ExBold', color: c.textMuted, letterSpacing: 1,
      borderWidth: 1, borderColor: c.border, borderRadius: 20,
      paddingHorizontal: 6, paddingVertical: 1, marginTop: 2,
    },
    rowRemoveBtn: { paddingLeft: 12, marginLeft: 2 },

    empty:      { alignItems: 'center', paddingTop: 60, paddingHorizontal: 20 },
    emptyTitle: { fontSize: 16, fontFamily: 'JUSTSans-ExBold', color: c.white, marginBottom: 6 },
    emptySub:   { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: c.textMuted, textAlign: 'center', lineHeight: 18, marginBottom: 20 },
    emptyBtn:   { backgroundColor: c.gold, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 22 },
    emptyBtnText: { fontSize: 13, fontFamily: 'JUSTSans-ExBold', color: '#000' },

    // Modal
    modal: { flex: 1, backgroundColor: c.bg },
    modalHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingTop: 20, paddingHorizontal: 24, paddingBottom: 16,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    modalTitle:  { fontSize: 15, fontFamily: 'JUSTSans-ExBold', color: c.white },
    modalCancel: { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: c.white, width: 60 },
    modalScroll: { padding: 20, paddingBottom: 60 },

    tabRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 16 },
    tabBtn: {
      flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 10,
      paddingVertical: 10, alignItems: 'center',
    },
    tabBtnText: { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: c.textMuted },

    fieldLabel: { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: c.textMuted, letterSpacing: 1.5, marginBottom: 6 },
    searchRow:  { flexDirection: 'row', gap: 10 },
    searchInput: {
      flex: 1, backgroundColor: c.card, borderRadius: 12,
      borderWidth: 1, borderColor: c.border,
      paddingHorizontal: 14, paddingVertical: 12,
      fontSize: 15, fontFamily: 'JUSTSans-ExBold', color: c.white,
    },
    searchBtn:  { borderRadius: 12, paddingHorizontal: 18, justifyContent: 'center', alignItems: 'center', minWidth: 68 },
    searchBtnText: { fontSize: 13, fontFamily: 'JUSTSans-ExBold', color: '#000' },
    notFound: { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: c.red, marginTop: 12 },

    plainInput: {
      backgroundColor: c.card, borderRadius: 12,
      borderWidth: 1, borderColor: c.border,
      paddingHorizontal: 14, paddingVertical: 12,
      fontSize: 15, fontFamily: 'JUSTSans-ExBold', color: c.white,
    },
    guestHint: { fontSize: 11, fontFamily: 'JUSTSans-ExBold', color: c.textMuted, lineHeight: 16, marginTop: 16 },

    foundCard: {
      alignItems: 'center', marginTop: 20,
      backgroundColor: c.card, borderRadius: 14,
      borderWidth: 1, borderColor: c.border, padding: 20,
    },
    avatarImgLg: { width: 64, height: 64, borderRadius: 32, marginBottom: 10 },
    avatarPlaceholderLg: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
    avatarInitialLg: { fontSize: 24, fontFamily: 'JUSTSans-ExBold' },
    foundName: { fontSize: 16, fontFamily: 'JUSTSans-ExBold', color: c.white },
    foundMeta: { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: c.textMuted, marginTop: 4, marginBottom: 16 },

    saveBtn: { alignSelf: 'stretch', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
    saveBtnText: { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#000' },
  });
}
