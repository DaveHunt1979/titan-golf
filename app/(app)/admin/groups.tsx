import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Modal, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';

const GOLD = '#D4AF37';
const GREEN = '#4ade80';
const RED = '#f87171';
const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

const hit = { top: 12, bottom: 12, left: 12, right: 12 };

interface PlayerGroup {
  id: string;
  society_id: string;
  name: string;
  player_ids: string[];
  created_at: string;
}

interface Player {
  id: string;
  display_name: string;
  handicap_index: number | null;
}

export default function GroupsScreen() {
  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const router = useRouter();
  const { societyId, loading: societyLoading } = useAdminSociety();

  const [groups, setGroups]   = useState<PlayerGroup[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [editingGroup, setEditingGroup] = useState<PlayerGroup | null>(null);
  const [groupName, setGroupName]       = useState('');
  const [selectedIds, setSelectedIds]   = useState<string[]>([]);
  const [saving, setSaving]             = useState(false);

  async function load() {
    if (!societyId) return;
    const [groupsRes, playersRes] = await Promise.all([
      supabase.from('player_groups').select('*').eq('society_id', societyId).order('name'),
      supabase.from('players').select('id,display_name,handicap_index').eq('society_id', societyId).order('display_name'),
    ]);
    if (groupsRes.data)  setGroups(groupsRes.data as PlayerGroup[]);
    if (playersRes.data) setPlayers(playersRes.data as Player[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [societyId]);

  function openCreate() {
    setEditingGroup(null);
    setGroupName('');
    setSelectedIds([]);
    setModalVisible(true);
  }

  function openEdit(group: PlayerGroup) {
    setEditingGroup(group);
    setGroupName(group.name);
    setSelectedIds(group.player_ids ?? []);
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setEditingGroup(null);
    setGroupName('');
    setSelectedIds([]);
  }

  function togglePlayer(id: string) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  }

  async function saveGroup() {
    if (!groupName.trim()) { Alert.alert('Name required', 'Please enter a group name.'); return; }
    if (!societyId) return;
    setSaving(true);
    try {
      if (editingGroup) {
        const { error } = await supabase
          .from('player_groups')
          .update({ name: groupName.trim(), player_ids: selectedIds })
          .eq('id', editingGroup.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('player_groups')
          .insert({ society_id: societyId, name: groupName.trim(), player_ids: selectedIds });
        if (error) throw error;
      }
      closeModal();
      load();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save group.');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(group: PlayerGroup) {
    Alert.alert(
      'Delete Group',
      `Delete "${group.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('player_groups')
              .delete()
              .eq('id', group.id);
            if (error) { Alert.alert('Error', error.message); return; }
            load();
          },
        },
      ]
    );
  }

  function playerNamesForGroup(group: PlayerGroup): string {
    if (!group.player_ids || group.player_ids.length === 0) return 'No players';
    return group.player_ids
      .map(id => {
        const p = players.find(pl => pl.id === id);
        return p ? p.display_name.split(' ')[0] : null;
      })
      .filter(Boolean)
      .join(', ');
  }

  if (loading || societyLoading || !fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar style="light" />
        <ActivityIndicator color={GOLD} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={hit}>
          <Text style={s.back}>‹ Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerSub}>GROUPS</Text>
        </View>
        <TouchableOpacity onPress={openCreate} hitSlop={hit}>
          <Text style={s.addBtn}>+</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {groups.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>No groups yet</Text>
          </View>
        ) : (
          groups.map(group => (
            <View key={group.id} style={s.card}>
              <View style={s.cardBody}>
                <Text style={s.groupName}>{group.name}</Text>
                <Text style={s.playerCount}>
                  {(group.player_ids ?? []).length} player{(group.player_ids ?? []).length !== 1 ? 's' : ''}
                </Text>
                <Text style={s.playerNames} numberOfLines={2}>
                  {playerNamesForGroup(group)}
                </Text>
              </View>
              <View style={s.cardActions}>
                <TouchableOpacity onPress={() => openEdit(group)} hitSlop={hit} style={s.actionBtn}>
                  <Text style={s.editIcon}>✎</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => confirmDelete(group)} hitSlop={hit} style={s.actionBtn}>
                  <Text style={s.deleteIcon}>🗑</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Create / Edit Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeModal}
      >
        <View style={s.modalContainer}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={closeModal} hitSlop={hit}>
              <Text style={s.back}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.modalTitle}>{editingGroup ? 'Edit Group' : 'New Group'}</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView
            contentContainerStyle={s.modalScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={s.fieldLabel}>GROUP NAME</Text>
            <TextInput
              style={s.input}
              value={groupName}
              onChangeText={setGroupName}
              placeholder="e.g. Saturday Squad"
              placeholderTextColor="#444"
              autoFocus={!editingGroup}
            />

            <Text style={[s.fieldLabel, { marginTop: 24 }]}>PLAYERS</Text>

            {players.map(player => {
              const selected = selectedIds.includes(player.id);
              return (
                <TouchableOpacity
                  key={player.id}
                  style={s.playerRow}
                  onPress={() => togglePlayer(player.id)}
                  activeOpacity={0.7}
                >
                  <View style={s.playerAvatar}>
                    <Text style={s.playerAvatarText}>
                      {player.display_name[0]?.toUpperCase() ?? '?'}
                    </Text>
                  </View>
                  <Text style={s.playerRowName}>{player.display_name}</Text>
                  {selected && <Text style={s.checkmark}>✓</Text>}
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              style={[s.saveBtn, saving && { opacity: 0.5 }]}
              onPress={saveGroup}
              disabled={saving}
              activeOpacity={0.8}
            >
              {saving
                ? <ActivityIndicator color="#000" />
                : <Text style={s.saveBtnText}>Save Group</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity onPress={closeModal} style={s.cancelLink} activeOpacity={0.7}>
              <Text style={s.cancelLinkText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  headerCenter: { alignItems: 'center' },
  headerLogo:   { width: 36, height: 36 },
  headerSub:    { fontFamily: FFB, fontSize: 10, color: GOLD, letterSpacing: 2, marginTop: 2 },
  back:         { fontFamily: FFB, fontSize: 14, color: GOLD },
  addBtn:       { fontFamily: FFB, fontSize: 22, color: GOLD, lineHeight: 26 },

  scroll: { padding: 20, paddingBottom: 60 },

  card: {
    backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c',
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, marginBottom: 10,
  },
  cardBody:    { flex: 1 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 8 },
  actionBtn:   { padding: 4 },

  groupName:   { fontFamily: FFB, fontSize: 16, color: '#fff', marginBottom: 4 },
  playerCount: { fontFamily: FF,  fontSize: 12, color: '#fff', marginBottom: 2 },
  playerNames: { fontFamily: FF,  fontSize: 12, color: '#fff' },

  editIcon:   { fontFamily: FFB, fontSize: 18, color: GOLD },
  deleteIcon: { fontSize: 18 },

  empty:      { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { fontFamily: FFB, fontSize: 18, color: '#fff' },

  modalContainer: { flex: 1, backgroundColor: '#000' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  modalTitle: { fontFamily: FFB, fontSize: 16, color: '#fff' },
  modalScroll: { padding: 20, paddingBottom: 60 },

  fieldLabel: {
    fontFamily: FFB, fontSize: 10, color: '#fff',
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6,
  },
  input: {
    backgroundColor: '#111', borderRadius: 12,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingHorizontal: 16, paddingVertical: 14,
    fontFamily: FFB, fontSize: 15, color: '#fff',
  },

  playerRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, gap: 12,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  playerAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: GOLD + '22', borderWidth: 1, borderColor: GOLD,
    alignItems: 'center', justifyContent: 'center',
  },
  playerAvatarText: { fontFamily: FFB, fontSize: 14, color: GOLD },
  playerRowName:    { flex: 1, fontFamily: FFB, fontSize: 15, color: '#fff' },
  checkmark:        { fontFamily: FFB, fontSize: 18, color: GOLD },

  saveBtn: {
    backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginTop: 28,
  },
  saveBtnText: { fontFamily: FFB, fontSize: 16, color: '#000' },

  cancelLink:     { alignItems: 'center', paddingVertical: 16 },
  cancelLinkText: { fontFamily: FFB, fontSize: 14, color: GOLD },
});
