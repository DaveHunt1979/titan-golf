import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Modal, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
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

const COMMITTEE_ROLES = [
  'Captain', 'Vice Captain', 'Secretary', 'Treasurer',
  'Food & Beverage', 'Social Secretary', 'Handicap Secretary',
];

interface Member {
  role: string;
  committee_role: string | null;
  player: {
    id: string;
    display_name: string;
    email: string | null;
    handicap_index: number | null;
    avatar_url: string | null;
  };
}

const hit = { top: 12, bottom: 12, left: 12, right: 12 };

export default function PlayersScreen() {
  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const router = useRouter();
  const { societyId } = useAdminSociety();
  const [members, setMembers]   = useState<Member[]>([]);
  const [myRole, setMyRole]     = useState('member');
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);

  // Add player form
  const [newName, setNewName]   = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newHcp, setNewHcp]     = useState('');
  const [saving, setSaving]     = useState(false);

  // Role assignment modal
  const [selected, setSelected]           = useState<Member | null>(null);
  const [editCommittee, setEditCommittee] = useState('');
  const [editPermRole, setEditPermRole]   = useState('');
  const [editEmail, setEditEmail]         = useState('');
  const [editHcp, setEditHcp]             = useState('');
  const [roleSaving, setRoleSaving]       = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);

  async function load() {
    if (!societyId) return;
    const { data: { user } } = await supabase.auth.getUser();

    const [membersRes, myRoleRes] = await Promise.all([
      supabase
        .from('society_members')
        .select('role, committee_role, player:player_id(id, display_name, email, handicap_index, avatar_url)')
        .eq('society_id', societyId)
        .order('role'),
      user ? supabase
        .from('society_members').select('role')
        .eq('society_id', societyId!)
        .eq('player_id',
          (await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle()).data?.id ?? ''
        ).maybeSingle() : Promise.resolve({ data: null }),
    ]);

    if (!membersRes.error && membersRes.data) {
      setMembers(membersRes.data as unknown as Member[]);
    }
    if (myRoleRes.data) setMyRole((myRoleRes.data as any).role ?? 'member');
    setLoading(false);
  }

  useEffect(() => { load(); }, [societyId]);

  async function addPlayer() {
    if (!newName.trim()) { Alert.alert('Name required'); return; }
    setSaving(true);
    const email = newEmail.trim().toLowerCase() || null;
    const { error } = await supabase.rpc('admin_add_player', {
      p_society_id:   societyId!,
      p_display_name: newName.trim(),
      p_email:        email,
      p_handicap:     newHcp ? parseFloat(newHcp) : null,
    });
    if (!error && email) {
      await supabase.rpc('admin_create_login', { p_email: email });
    }
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setNewName(''); setNewEmail(''); setNewHcp('');
    setShowAdd(false);
    load();
  }

  async function pickPhoto() {
    if (!selected) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow access to your photo library to change the player photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images', allowsEditing: true, aspect: [1, 1], quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;
    setPhotoUploading(true);
    try {
      const uri = result.assets[0].uri;
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(`${selected.player.id}.jpg`, bytes, { contentType: 'image/jpeg', upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(`${selected.player.id}.jpg`);
      const avatarUrl = `${publicUrl}?t=${Date.now()}`;
      const { error: dbError } = await supabase.from('players').update({ avatar_url: avatarUrl }).eq('id', selected.player.id);
      if (dbError) throw dbError;
      setSelected(prev => prev ? { ...prev, player: { ...prev.player, avatar_url: avatarUrl } } : prev);
      load();
    } catch (e: any) {
      Alert.alert('Upload failed', e.message ?? 'Could not upload image.');
    } finally {
      setPhotoUploading(false);
    }
  }

  function confirmDeletePlayer() {
    if (!selected) return;
    Alert.alert(
      'Remove Player',
      `Remove ${selected.player.display_name} from this society? Their match history will be kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('society_members')
              .delete()
              .eq('player_id', selected.player.id)
              .eq('society_id', societyId!);
            if (error) { Alert.alert('Error', error.message); return; }
            setSelected(null);
            load();
          },
        },
      ]
    );
  }

  function openRoleModal(m: Member) {
    setSelected(m);
    setEditCommittee(m.committee_role ?? '');
    setEditPermRole(m.role);
    setEditEmail(m.player.email ?? '');
    setEditHcp(m.player.handicap_index != null ? String(m.player.handicap_index) : '');
  }

  async function saveRoles() {
    if (!selected) return;
    setRoleSaving(true);
    try {
      await supabase.rpc('set_committee_role', {
        p_society_id: societyId!,
        p_player_id:  selected.player.id,
        p_role:       editCommittee,
      });

      const emailChanged = editEmail.trim() !== (selected.player.email ?? '');
      const hcpChanged   = editHcp !== (selected.player.handicap_index != null ? String(selected.player.handicap_index) : '');
      if (emailChanged || hcpChanged) {
        const { error } = await supabase.rpc('admin_update_player', {
          p_society_id: societyId!,
          p_player_id:  selected.player.id,
          p_email:      editEmail.trim().toLowerCase() || null,
          p_handicap:   editHcp ? parseFloat(editHcp) : null,
        });
        if (error) throw error;
      }

      if (myRole === 'owner' && selected.role !== 'owner' && editPermRole !== selected.role) {
        const { error } = await supabase.rpc('set_member_role', {
          p_society_id: societyId!,
          p_player_id:  selected.player.id,
          p_role:       editPermRole,
        });
        if (error) throw error;
      }

      setSelected(null);
      load();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save.');
    } finally {
      setRoleSaving(false);
    }
  }

  const roleOrder = { owner: 0, admin: 1, member: 2 } as Record<string, number>;
  const sorted = [...members].sort((a, b) => (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9));

  if (loading || !fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={hit}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerSub}>PLAYERS</Text>
        </View>
        <TouchableOpacity onPress={() => setShowAdd(true)} hitSlop={hit}>
          <Text style={s.addBtn}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.count}>{members.length} member{members.length !== 1 ? 's' : ''}</Text>

        {sorted.map((m, i) => (
          <TouchableOpacity
            key={m.player.id}
            onPress={() => openRoleModal(m)}
            activeOpacity={0.7}
          >
            <MemberRow member={m} isLast={i === sorted.length - 1} />
          </TouchableOpacity>
        ))}

        {members.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>No players yet</Text>
            <Text style={s.emptySub}>Add players manually or share your society PIN.</Text>
          </View>
        )}
      </ScrollView>

      {/* Add Player Modal */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAdd(false)}>
        <View style={s.modalContainer}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setShowAdd(false)} hitSlop={hit}>
              <Text style={s.back}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.modalTitle}>Add Player</Text>
            <TouchableOpacity onPress={addPlayer} disabled={saving} hitSlop={hit}>
              <Text style={[s.addBtn, saving && { opacity: 0.4 }]}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
            <Text style={s.fieldLabel}>Display Name *</Text>
            <TextInput style={s.input} value={newName} onChangeText={setNewName}
              placeholder="e.g. John Smith" placeholderTextColor="#444" autoFocus />
            <Text style={s.fieldLabel}>Email (optional)</Text>
            <TextInput style={s.input} value={newEmail} onChangeText={setNewEmail}
              placeholder="john@example.com" placeholderTextColor="#444"
              keyboardType="email-address" autoCapitalize="none" />
            <Text style={s.fieldLabel}>Handicap Index (optional)</Text>
            <TextInput style={s.input} value={newHcp} onChangeText={setNewHcp}
              placeholder="e.g. 14.2" placeholderTextColor="#444" keyboardType="decimal-pad" />
            <Text style={s.hint}>
              This player won't have an app login until they sign up and use the society PIN.
            </Text>
            <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.5 }]} onPress={addPlayer} disabled={saving} activeOpacity={0.8}>
              {saving ? <ActivityIndicator color="#000" /> : <Text style={s.saveBtnText}>Add Player</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* Role Assignment Modal */}
      <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelected(null)}>
        <View style={s.modalContainer}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setSelected(null)} hitSlop={hit}>
              <Text style={s.back}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.modalTitle}>{selected?.player.display_name}</Text>
            <TouchableOpacity onPress={saveRoles} disabled={roleSaving} hitSlop={hit}>
              <Text style={[s.addBtn, roleSaving && { opacity: 0.4 }]}>{roleSaving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

            {/* Avatar + Change Photo */}
            <View style={s.avatarSection}>
              <TouchableOpacity onPress={pickPhoto} disabled={photoUploading} activeOpacity={0.8}>
                {selected?.player.avatar_url ? (
                  <Image source={{ uri: selected.player.avatar_url }} style={s.avatarLarge} />
                ) : (
                  <View style={s.avatarLarge}>
                    <Text style={s.avatarLargeText}>{selected?.player.display_name[0]?.toUpperCase() ?? '?'}</Text>
                  </View>
                )}
                <View style={s.photoOverlay}>
                  {photoUploading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={s.photoOverlayText}>📷</Text>}
                </View>
              </TouchableOpacity>
            </View>

            {/* Player Details */}
            <Text style={s.sectionLabel}>PLAYER DETAILS</Text>
            <Text style={s.sectionHint}>
              Set their email so they can claim this account when they join via PIN
            </Text>
            <Text style={s.fieldLabel}>EMAIL</Text>
            <TextInput
              style={s.input}
              value={editEmail}
              onChangeText={setEditEmail}
              placeholder="player@example.com"
              placeholderTextColor="#444"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={s.fieldLabel}>HANDICAP INDEX</Text>
            <TextInput
              style={s.input}
              value={editHcp}
              onChangeText={setEditHcp}
              placeholder="e.g. 14.2"
              placeholderTextColor="#444"
              keyboardType="decimal-pad"
            />

            {/* Committee Role */}
            <Text style={[s.sectionLabel, { marginTop: 28 }]}>COMMITTEE ROLE</Text>
            <Text style={s.sectionHint}>Displayed on their profile — e.g. Treasurer, Food & Beverage</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
                {COMMITTEE_ROLES.map(r => (
                  <TouchableOpacity
                    key={r}
                    style={[s.chip, editCommittee === r && s.chipOn]}
                    onPress={() => setEditCommittee(editCommittee === r ? '' : r)}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.chipText, editCommittee === r && s.chipTextOn]}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <TextInput
              style={s.input}
              value={editCommittee}
              onChangeText={setEditCommittee}
              placeholder="Or type a custom role…"
              placeholderTextColor="#444"
            />

            {/* App Permission Role — owner only, can't change another owner */}
            {myRole === 'owner' && selected?.role !== 'owner' && (
              <>
                <Text style={[s.sectionLabel, { marginTop: 28 }]}>APP PERMISSION</Text>
                <Text style={s.sectionHint}>Admins can manage players and settings</Text>
                <View style={s.permRow}>
                  {['member', 'admin'].map(r => (
                    <TouchableOpacity
                      key={r}
                      style={[s.permChip, editPermRole === r && s.permChipOn]}
                      onPress={() => setEditPermRole(r)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.permChipText, editPermRole === r && s.permChipTextOn]}>
                        {r.charAt(0).toUpperCase() + r.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <TouchableOpacity style={[s.saveBtn, { marginTop: 28 }, roleSaving && { opacity: 0.5 }]}
              onPress={saveRoles} disabled={roleSaving} activeOpacity={0.8}>
              {roleSaving ? <ActivityIndicator color="#000" /> : <Text style={s.saveBtnText}>Save Changes</Text>}
            </TouchableOpacity>

            {selected?.role !== 'owner' && (
              <TouchableOpacity style={s.deleteBtn} onPress={confirmDeletePlayer} activeOpacity={0.8}>
                <Text style={s.deleteBtnText}>Remove from Society</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function MemberRow({ member, isLast }: { member: Member; isLast: boolean }) {
  const { player, role, committee_role } = member;
  const initial = player.display_name[0]?.toUpperCase() ?? '?';
  const isOwner = role === 'owner';
  const isAdmin = role === 'admin';

  return (
    <View style={[s.memberRow, !isLast && s.memberRowBorder]}>
      {player.avatar_url ? (
        <Image source={{ uri: player.avatar_url }} style={s.avatar} />
      ) : (
        <View style={s.avatar}>
          <Text style={s.avatarText}>{initial}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={s.memberName}>{player.display_name}</Text>
        {committee_role
          ? <Text style={s.committeeRole}>{committee_role}</Text>
          : player.email
          ? <Text style={s.memberEmail}>{player.email}</Text>
          : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        {player.handicap_index != null && (
          <Text style={s.hcp}>HCP {player.handicap_index}</Text>
        )}
        <View style={[
          s.roleBadge,
          isOwner || isAdmin
            ? { backgroundColor: GOLD + '22', borderColor: GOLD }
            : { backgroundColor: '#1c1c1c', borderColor: '#333' },
        ]}>
          <Text style={[
            s.roleText,
            { color: isOwner || isAdmin ? GOLD : '#555' },
          ]}>{role}</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  headerCenter: { alignItems: 'center' },
  headerLogo:   { width: 36, height: 36 },
  headerSub:    { fontFamily: FFB, fontSize: 10, color: GOLD, letterSpacing: 2, marginTop: 2 },
  back:         { fontFamily: FFB, fontSize: 14, color: GOLD },
  addBtn:       { fontFamily: FFB, fontSize: 14, color: GOLD },

  scroll: { padding: 20, paddingBottom: 60 },
  count:  { fontFamily: FFB, fontSize: 10, color: '#555', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 },

  memberRow:       { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14,
                     backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#1c1c1c',
                     paddingHorizontal: 14, marginBottom: 8 },
  memberRowBorder: {},
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: GOLD + '22', borderWidth: 1, borderColor: GOLD,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText:    { fontFamily: FFB, fontSize: 16, color: GOLD },
  memberName:    { fontFamily: FFB, fontSize: 15, color: '#fff' },
  memberEmail:   { fontFamily: FF, fontSize: 12, color: '#555', marginTop: 2 },
  committeeRole: { fontFamily: FF, fontSize: 12, color: GOLD, fontStyle: 'italic', marginTop: 2 },
  hcp:           { fontFamily: FF, fontSize: 12, color: '#555' },
  roleBadge:     { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, borderWidth: 1 },
  roleText:      { fontFamily: FFB, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },

  empty:      { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { fontFamily: FFB, fontSize: 18, color: '#555', marginBottom: 8 },
  emptySub:   { fontFamily: FF, fontSize: 14, color: '#555', textAlign: 'center', lineHeight: 20 },

  modalContainer: { flex: 1, backgroundColor: '#000' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  modalTitle: { fontFamily: FFB, fontSize: 16, color: '#fff' },

  sectionLabel: {
    fontFamily: FFB, fontSize: 10, color: '#555',
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4,
  },
  sectionHint: { fontFamily: FF, fontSize: 12, color: '#555', marginBottom: 14 },

  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, backgroundColor: '#111',
    borderWidth: 1, borderColor: '#1c1c1c',
  },
  chipOn:      { backgroundColor: GOLD + '22', borderColor: GOLD + '55' },
  chipText:    { fontFamily: FF, fontSize: 12, color: '#555' },
  chipTextOn:  { color: GOLD },

  permRow:     { flexDirection: 'row', gap: 10 },
  permChip: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c',
    alignItems: 'center',
  },
  permChipOn:     { backgroundColor: GOLD + '22', borderColor: GOLD + '55' },
  permChipText:   { fontFamily: FFB, fontSize: 14, color: '#555' },
  permChipTextOn: { color: GOLD },

  fieldLabel: {
    fontFamily: FFB, fontSize: 10, color: '#555',
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6, marginTop: 14,
  },
  input: {
    backgroundColor: '#111', borderRadius: 12,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingHorizontal: 16, paddingVertical: 14,
    fontFamily: FF, fontSize: 15, color: '#fff',
  },
  hint:    { fontFamily: FF, fontSize: 12, color: '#555', lineHeight: 18, marginTop: 16 },
  saveBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 28 },
  saveBtnText: { fontFamily: FFB, fontSize: 16, color: '#000' },

  avatarSection: { alignItems: 'center', marginBottom: 28 },
  avatarLarge: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: GOLD + '22', borderWidth: 2, borderColor: GOLD,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLargeText: { fontFamily: FFB, fontSize: 28, color: GOLD },
  photoOverlay: {
    position: 'absolute', bottom: 0, right: 0,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#000', borderWidth: 1, borderColor: '#1c1c1c',
    alignItems: 'center', justifyContent: 'center',
  },
  photoOverlayText: { fontSize: 14 },

  deleteBtn: {
    marginTop: 16, paddingVertical: 14, borderRadius: 12,
    borderWidth: 1, borderColor: RED, alignItems: 'center',
  },
  deleteBtnText: { fontFamily: FFB, fontSize: 14, color: RED },
});
