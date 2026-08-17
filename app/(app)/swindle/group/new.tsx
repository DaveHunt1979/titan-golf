import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, ActivityIndicator, FlatList, Modal, Platform, Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../src/lib/supabase';
import { useSocietyTheme } from '../../../../src/lib/SocietyThemeContext';

const GOLD   = '#D4AF37';
const PURPLE = '#a78bfa';
const RED    = '#f87171';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';
const titanLogo = require('../../../../assets/TitanAppLogo.png');

interface SwindleMember {
  player_id: string;
  display_name: string;
  handicap_index: number | null;
  already_in_group: boolean;
  existing_tee_time: string | null;
}

export default function SwindleGroupNew() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const router = useRouter();
  const { societyId } = useSocietyTheme() as any;

  const [fontsLoaded] = useFonts({
    [FF]:  require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    [FFB]: require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [teeTime,      setTeeTime]      = useState('');
  const [courseTee,    setCourseTee]    = useState('');
  const [members,      setMembers]      = useState<SwindleMember[]>([]);
  const [selected,     setSelected]     = useState<Set<string>>(new Set());
  const [myId,         setMyId]         = useState<string | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [addGuestModal, setAddGuestModal] = useState(false);
  const [guestName,    setGuestName]    = useState('');
  const [guestHcp,     setGuestHcp]     = useState('');
  const [guestClub,    setGuestClub]    = useState('');
  const [guests,       setGuests]       = useState<{ name: string; handicap: number | null; club: string }[]>([]);

  useEffect(() => { init(); }, [gameId, societyId]);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    let playerId: string | null = null;
    if (user) {
      const { data: p } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (p) { playerId = p.id; setMyId(p.id); }
    }
    await loadMembers(playerId);
  }

  async function loadMembers(myPlayerId: string | null) {
    if (!societyId || !gameId) { setLoading(false); return; }

    const [{ data: membersData }, { data: existingGroupPlayers }] = await Promise.all([
      supabase
        .from('swindle_entries')
        .select('player_id, players(display_name, handicap_index)')
        .eq('game_id', gameId)
        .order('players(display_name)'),
      supabase
        .from('swindle_group_players')
        .select('player_id, swindle_groups!inner(tee_time, game_id)')
        .eq('swindle_groups.game_id', gameId),
    ]);

    const alreadyIn: Record<string, string> = {};
    (existingGroupPlayers ?? []).forEach((gp: any) => {
      if (gp.player_id) alreadyIn[gp.player_id] = gp.swindle_groups?.tee_time ?? '?';
    });

    const list: SwindleMember[] = ((membersData ?? []) as any[]).map(m => ({
      player_id:        m.player_id,
      display_name:     m.players?.display_name ?? '—',
      handicap_index:   m.players?.handicap_index ?? null,
      already_in_group: !!alreadyIn[m.player_id],
      existing_tee_time: alreadyIn[m.player_id] ?? null,
    }));

    setMembers(list);

    // Auto-select self if not already in a group
    if (myPlayerId && !alreadyIn[myPlayerId]) {
      setSelected(new Set([myPlayerId]));
    }

    setLoading(false);
  }

  function togglePlayer(id: string, alreadyInGroup: boolean, teeTime: string | null) {
    if (alreadyInGroup) {
      Alert.alert(
        'Player already entered',
        `This player has already been entered in the ${teeTime} group. Only the organiser can override this.`,
      );
      return;
    }
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function addGuest() {
    if (!guestName.trim()) { Alert.alert('Name required'); return; }
    setGuests(prev => [...prev, {
      name: guestName.trim(),
      handicap: guestHcp.trim() ? parseFloat(guestHcp) : null,
      club: guestClub.trim(),
    }]);
    setGuestName(''); setGuestHcp(''); setGuestClub('');
    setAddGuestModal(false);
  }

  function removeGuest(idx: number) {
    setGuests(prev => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    if (!teeTime.trim()) { Alert.alert('Tee time required', 'Enter the tee time (e.g. 08:12)'); return; }
    if (selected.size + guests.length < 1) { Alert.alert('Add players', 'Select at least one player'); return; }
    if (selected.size + guests.length > 4) { Alert.alert('Too many players', 'A group can have 2–4 players'); return; }

    setSaving(true);

    // Create group
    const { data: group, error: groupErr } = await supabase
      .from('swindle_groups')
      .insert({ game_id: gameId, tee_time: teeTime.trim(), course_tee: courseTee.trim() || null, created_by: myId })
      .select('id')
      .single();

    if (groupErr || !group) {
      Alert.alert('Error', groupErr?.message ?? 'Failed to create group');
      setSaving(false);
      return;
    }

    // Insert group players
    const playerRows = Array.from(selected).map(pid => ({
      group_id: group.id, player_id: pid, is_guest: false, added_by: myId,
    }));
    const guestRows = guests.map(g => ({
      group_id: group.id, player_id: null, is_guest: true,
      guest_name: g.name, guest_handicap: g.handicap, guest_home_club: g.club || null, added_by: myId,
    }));

    const allRows = [...playerRows, ...guestRows];
    if (allRows.length > 0) {
      const { error: playersErr } = await supabase.from('swindle_group_players').insert(allRows);
      if (playersErr) {
        Alert.alert('Error', playersErr.message);
        setSaving(false);
        return;
      }
    }

    // Upsert swindle_entries so scoring still works
    const entryRows = Array.from(selected).map(pid => {
      const member = members.find(m => m.player_id === pid);
      return { game_id: gameId, player_id: pid, handicap: member?.handicap_index ?? null };
    });
    if (entryRows.length > 0) {
      await supabase.from('swindle_entries').upsert(entryRows, { onConflict: 'game_id,player_id', ignoreDuplicates: true });
    }

    setSaving(false);
    // router.back() was landing on the home tab instead of the swindle game
    // screen — this route can be reached from more than one place in the
    // stack, so back() isn't reliable. Target the game screen explicitly.
    router.replace(`/(app)/swindle/${gameId}` as any);
  }

  if (!fontsLoaded || loading) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" />
      <ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  const totalPlayers = selected.size + guests.length;

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace(`/(app)/swindle/${gameId}` as any)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Image source={titanLogo} style={s.logo} resizeMode="contain" />
          <Text style={s.headerTitle}>CREATE GROUP</Text>
        </View>
        <TouchableOpacity onPress={save} disabled={saving} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          {saving
            ? <ActivityIndicator color={GOLD} size="small" />
            : <Text style={s.saveBtn}>Confirm</Text>
          }
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* Tee time */}
        <Text style={s.fieldLabel}>TEE TIME</Text>
        <TextInput
          style={s.input}
          value={teeTime}
          onChangeText={setTeeTime}
          placeholder="08:12"
          placeholderTextColor="#444"
          keyboardType="numbers-and-punctuation"
          maxLength={5}
        />

        {/* Course / starting tee */}
        <Text style={s.fieldLabel}>COURSE / STARTING TEE (OPTIONAL)</Text>
        <TextInput
          style={s.input}
          value={courseTee}
          onChangeText={setCourseTee}
          placeholder="e.g. Blue tees, 1st, 10th"
          placeholderTextColor="#444"
        />

        {/* Player picker */}
        <View style={s.sectionRow}>
          <Text style={s.fieldLabel}>PLAYERS FROM SWINDLE LIST ({totalPlayers}/4)</Text>
        </View>

        {totalPlayers === 0 && (
          <View style={[s.warnBanner]}>
            <Ionicons name="information-circle-outline" size={14} color={GOLD} />
            <Text style={s.warnText}>You are included automatically — tap your name or add others</Text>
          </View>
        )}

        {members.map(m => {
          const isSelected = selected.has(m.player_id);
          const isMe = m.player_id === myId;
          return (
            <TouchableOpacity
              key={m.player_id}
              style={[
                s.memberRow,
                isSelected && s.memberRowSelected,
                m.already_in_group && s.memberRowBlocked,
              ]}
              onPress={() => togglePlayer(m.player_id, m.already_in_group, m.existing_tee_time)}
              activeOpacity={0.75}
            >
              <View style={{ flex: 1 }}>
                <Text style={[s.memberName, isSelected && { color: GOLD }, m.already_in_group && { color: '#555' }]}>
                  {m.display_name}{isMe ? ' (you)' : ''}
                </Text>
                {m.already_in_group ? (
                  <Text style={s.memberBlocked}>Already entered — {m.existing_tee_time}</Text>
                ) : m.handicap_index != null ? (
                  <Text style={s.memberHcp}>HCP {m.handicap_index}</Text>
                ) : null}
              </View>
              {m.already_in_group
                ? <Ionicons name="alert-circle-outline" size={18} color="#555" />
                : isSelected
                ? <Ionicons name="checkmark-circle" size={20} color={GOLD} />
                : <View style={s.unchecked} />
              }
            </TouchableOpacity>
          );
        })}

        {/* Guest players */}
        {guests.length > 0 && (
          <>
            <Text style={[s.fieldLabel, { marginTop: 16 }]}>GUESTS</Text>
            {guests.map((g, idx) => (
              <View key={idx} style={[s.memberRow, s.memberRowSelected]}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.memberName, { color: GOLD }]}>{g.name} (guest)</Text>
                  {g.handicap != null && <Text style={s.memberHcp}>HCP {g.handicap}</Text>}
                  {g.club ? <Text style={s.memberHcp}>{g.club}</Text> : null}
                </View>
                <TouchableOpacity onPress={() => removeGuest(idx)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle-outline" size={20} color="#555" />
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {totalPlayers < 4 && (
          <TouchableOpacity style={s.addGuestBtn} onPress={() => setAddGuestModal(true)} activeOpacity={0.8}>
            <Ionicons name="person-add-outline" size={15} color={PURPLE} />
            <Text style={s.addGuestText}>Add Guest Player</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[s.confirmBtn, (saving || totalPlayers === 0) && { opacity: 0.5 }]}
          onPress={save}
          disabled={saving || totalPlayers === 0}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator color="#000" />
            : <Text style={s.confirmBtnText}>⛳  Confirm Group — {teeTime || '?'}</Text>
          }
        </TouchableOpacity>
      </ScrollView>

      {/* Add guest modal */}
      <Modal visible={addGuestModal} animationType="slide" presentationStyle="pageSheet">
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setAddGuestModal(false)}>
              <Text style={s.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.modalTitle}>ADD GUEST</Text>
            <TouchableOpacity onPress={addGuest}>
              <Text style={s.modalDone}>Add</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={s.modalScroll} keyboardShouldPersistTaps="handled">
            <Text style={s.fieldLabel}>FULL NAME</Text>
            <TextInput style={s.input} value={guestName} onChangeText={setGuestName} placeholder="First Surname" placeholderTextColor="#444" />
            <Text style={s.fieldLabel}>PLAYING HANDICAP</Text>
            <TextInput style={s.input} value={guestHcp} onChangeText={setGuestHcp} keyboardType="decimal-pad" placeholder="e.g. 12" placeholderTextColor="#444" />
            <Text style={s.fieldLabel}>HOME CLUB (OPTIONAL)</Text>
            <TextInput style={s.input} value={guestClub} onChangeText={setGuestClub} placeholder="e.g. Royal Birkdale" placeholderTextColor="#444" />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 32, paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  back:        { fontFamily: 'JUSTSans-ExBold', fontSize: 13, color: GOLD },
  logo:        { width: 22, height: 22, marginBottom: 2 },
  headerTitle: { fontFamily: 'JUSTSans-ExBold', fontSize: 12, color: '#fff', letterSpacing: 1 },
  saveBtn:     { fontFamily: 'JUSTSans-ExBold', fontSize: 14, color: GOLD },

  scroll: { padding: 16, paddingBottom: 60 },

  fieldLabel: { fontFamily: 'JUSTSans-ExBold', fontSize: 10, color: '#888', letterSpacing: 1.5, marginBottom: 8, marginTop: 16 },
  input:      { backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontFamily: 'JUSTSans-ExBold', fontSize: 15, color: '#fff' },

  sectionRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  warnBanner:  { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: GOLD + '12', borderRadius: 10, padding: 10, marginBottom: 8 },
  warnText:    { fontFamily: 'JUSTSans-ExBold', fontSize: 11, color: GOLD, flex: 1, lineHeight: 17 },

  memberRow:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#111' },
  memberRowSelected: { backgroundColor: GOLD + '08' },
  memberRowBlocked:  { opacity: 0.5 },
  memberName:        { fontFamily: 'JUSTSans-ExBold', fontSize: 15, color: '#fff' },
  memberHcp:         { fontFamily: 'JUSTSans-ExBold', fontSize: 11, color: '#555', marginTop: 2 },
  memberBlocked:     { fontFamily: 'JUSTSans-ExBold', fontSize: 11, color: '#f87171', marginTop: 2 },
  unchecked:         { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#333' },

  addGuestBtn:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#111' },
  addGuestText: { fontFamily: 'JUSTSans-ExBold', fontSize: 14, color: PURPLE },

  confirmBtn:     { marginTop: 24, backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  confirmBtnText: { fontFamily: 'JUSTSans-ExBold', fontSize: 16, color: '#000' },

  modal:       { flex: 1, backgroundColor: '#0a0a0a' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 60 : 24, paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  modalCancel: { fontFamily: 'JUSTSans-ExBold', fontSize: 14, color: '#888' },
  modalTitle:  { fontFamily: 'JUSTSans-ExBold', fontSize: 13, color: '#fff', letterSpacing: 1 },
  modalDone:   { fontFamily: 'JUSTSans-ExBold', fontSize: 14, color: GOLD },
  modalScroll: { padding: 20, paddingBottom: 60 },
});
