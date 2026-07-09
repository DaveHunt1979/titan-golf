import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Modal, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';

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

export default function PlayersScreen() {
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

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={hit}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Players</Text>
        <TouchableOpacity onPress={() => setShowAdd(true)} hitSlop={hit}>
          <Text style={s.addBtn}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.centered}><ActivityIndicator color={colors.gold} size="large" /></View>
      ) : (
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
      )}

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
              placeholder="e.g. John Smith" placeholderTextColor={colors.textMuted} autoFocus />
            <Text style={s.fieldLabel}>Email (optional)</Text>
            <TextInput style={s.input} value={newEmail} onChangeText={setNewEmail}
              placeholder="john@example.com" placeholderTextColor={colors.textMuted}
              keyboardType="email-address" autoCapitalize="none" />
            <Text style={s.fieldLabel}>Handicap Index (optional)</Text>
            <TextInput style={s.input} value={newHcp} onChangeText={setNewHcp}
              placeholder="e.g. 14.2" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" />
            <Text style={s.hint}>
              This player won't have an app login until they sign up and use the society PIN.
            </Text>
            <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.5 }]} onPress={addPlayer} disabled={saving} activeOpacity={0.8}>
              {saving ? <ActivityIndicator color={colors.bg} /> : <Text style={s.saveBtnText}>Add Player</Text>}
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
                    ? <ActivityIndicator color={colors.white} size="small" />
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
              placeholderTextColor={colors.textMuted}
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
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
            />

            {/* Committee Role */}
            <Text style={[s.sectionLabel, { marginTop: spacing.xl }]}>COMMITTEE ROLE</Text>
            <Text style={s.sectionHint}>Displayed on their profile — e.g. Treasurer, Food & Beverage</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm, paddingVertical: 4 }}>
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
              placeholderTextColor={colors.textMuted}
            />

            {/* App Permission Role — owner only, can't change another owner */}
            {myRole === 'owner' && selected?.role !== 'owner' && (
              <>
                <Text style={[s.sectionLabel, { marginTop: spacing.xl }]}>APP PERMISSION</Text>
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

            <TouchableOpacity style={[s.saveBtn, { marginTop: spacing.xl }, roleSaving && { opacity: 0.5 }]}
              onPress={saveRoles} disabled={roleSaving} activeOpacity={0.8}>
              {roleSaving ? <ActivityIndicator color={colors.bg} /> : <Text style={s.saveBtnText}>Save Changes</Text>}
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
  const initial    = player.display_name[0]?.toUpperCase() ?? '?';
  const roleColor  = role === 'owner' ? colors.gold : role === 'admin' ? '#6B3FA0' : colors.textMuted;

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
        <View style={[s.roleBadge, { backgroundColor: roleColor + '22', borderColor: roleColor }]}>
          <Text style={[s.roleText, { color: roleColor }]}>{role}</Text>
        </View>
      </View>
    </View>
  );
}

const hit = { top: 12, bottom: 12, left: 12, right: 12 };

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back:   { fontSize: fonts.sm, fontWeight: '600', color: colors.gold },
  title:  { fontSize: fonts.md, fontWeight: '800', color: colors.white, letterSpacing: 0.5 },
  addBtn: { fontSize: fonts.sm, fontWeight: '700', color: colors.gold },
  scroll: { padding: spacing.lg, paddingBottom: 60 },
  count:  { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.md },

  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  memberRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.goldDim, borderWidth: 1, borderColor: colors.goldBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText:    { fontSize: fonts.md, fontWeight: '800', color: colors.gold },
  memberName:    { fontSize: fonts.sm, fontWeight: '700', color: colors.white },
  memberEmail:   { fontSize: fonts.xs, color: colors.textMuted, marginTop: 2 },
  committeeRole: { fontSize: fonts.xs, color: colors.gold, fontStyle: 'italic', marginTop: 2 },
  hcp:           { fontSize: fonts.xs, fontWeight: '700', color: colors.textSecondary },
  roleBadge:     { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, borderWidth: 1 },
  roleText:      { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  empty:      { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: fonts.lg, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.xs },
  emptySub:   { fontSize: fonts.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },

  modalContainer: { flex: 1, backgroundColor: colors.bg },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: fonts.md, fontWeight: '800', color: colors.white },

  sectionLabel: {
    fontSize: fonts.xs, fontWeight: '800', color: colors.textMuted,
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4,
  },
  sectionHint: { fontSize: fonts.xs, color: colors.textMuted, marginBottom: spacing.md },

  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, backgroundColor: colors.cardAlt,
    borderWidth: 1, borderColor: colors.border,
  },
  chipOn:      { backgroundColor: colors.goldDim, borderColor: colors.goldBorder },
  chipText:    { fontSize: fonts.xs, fontWeight: '600', color: colors.textMuted },
  chipTextOn:  { color: colors.gold },

  permRow:     { flexDirection: 'row', gap: spacing.sm },
  permChip: {
    flex: 1, paddingVertical: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center',
  },
  permChipOn:     { backgroundColor: colors.goldDim, borderColor: colors.goldBorder },
  permChipText:   { fontSize: fonts.sm, fontWeight: '700', color: colors.textMuted },
  permChipTextOn: { color: colors.gold },

  fieldLabel: {
    fontSize: fonts.xs, fontWeight: '800', color: colors.textMuted,
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: spacing.xs, marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    fontSize: fonts.md, color: colors.white,
  },
  hint:    { fontSize: fonts.xs, color: colors.textMuted, lineHeight: 18, marginTop: spacing.lg },
  saveBtn: { backgroundColor: colors.gold, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xl },
  saveBtnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg },

  avatarSection: { alignItems: 'center', marginBottom: spacing.xl },
  avatarLarge: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.goldDim, borderWidth: 2, borderColor: colors.goldBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLargeText: { fontSize: 28, fontWeight: '800', color: colors.gold },
  photoOverlay: {
    position: 'absolute', bottom: 0, right: 0,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  photoOverlayText: { fontSize: 14 },

  deleteBtn: {
    marginTop: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: '#ef4444', alignItems: 'center',
  },
  deleteBtnText: { fontSize: fonts.sm, fontWeight: '700', color: '#ef4444' },
});
