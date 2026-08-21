import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, Modal, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../lib/supabase';
import { resolveAvatar } from '../lib/assets';

const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const PURPLE = '#a78bfa';
const RED    = '#f87171';
const FFB    = 'JUSTSans-ExBold';

const COMMITTEE_ROLES = [
  'Captain', 'Vice Captain', 'Secretary', 'Treasurer',
  'Food & Beverage', 'Social Secretary', 'Handicap Secretary',
];

// Same three areas admin/membership.tsx ("Player Access") used to manage on
// its own separate screen — folded in here so role/handicap/committee AND
// area access are all one edit, one button (Dave, 2026-08-21 — "having 2
// player area[s] in admin is a little bit silly as we can control it in
// players").
const AREAS = [
  { key: 'casual',  label: 'Casual',  color: GREEN  },
  { key: 'tour',    label: 'Tour',    color: GOLD   },
  { key: 'swindle', label: 'Swindle', color: PURPLE },
] as const;

export interface EditablePlayer {
  role: string;
  committee_role: string | null;
  membership_types: string[];
  player: {
    id: string;
    display_name: string;
    email: string | null;
    handicap_index: number | null;
    avatar_url: string | null;
  };
}

const hit = { top: 12, bottom: 12, left: 12, right: 12 };

// Extracted from admin/players.tsx's inline "Role Assignment Modal" (Dave,
// 2026-08-21) so the exact same edit UI can also open from T-Card's admin
// Edit button, not just the admin Players screen — one place to maintain
// instead of two copies drifting apart.
export default function PlayerEditSheet({
  visible, member, societyId, myRole, onClose, onSaved,
}: {
  visible: boolean;
  member: EditablePlayer | null;
  societyId: string;
  myRole: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [editCommittee, setEditCommittee] = useState('');
  const [editPermRole, setEditPermRole]   = useState('');
  const [editEmail, setEditEmail]         = useState('');
  const [editHcp, setEditHcp]             = useState('');
  const [areas, setAreas]                 = useState<string[]>([]);
  const [areaSaving, setAreaSaving]       = useState<string | null>(null);
  const [roleSaving, setRoleSaving]       = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [avatarUrl, setAvatarUrl]         = useState<string | null>(null);

  useEffect(() => {
    if (!member) return;
    setEditCommittee(member.committee_role ?? '');
    setEditPermRole(member.role);
    setEditEmail(member.player.email ?? '');
    setEditHcp(member.player.handicap_index != null ? String(member.player.handicap_index) : '');
    setAvatarUrl(member.player.avatar_url ?? null);
    setAreas(member.membership_types ?? []);
  }, [member]);

  // Saves immediately on tap, same as admin/membership.tsx did — areas
  // aren't part of the "Save Changes" batch below since there's no
  // unsaved-state risk in a single RPC call per toggle.
  async function toggleArea(area: string) {
    if (!member) return;
    const has = areas.includes(area);
    const newTypes = has ? areas.filter(t => t !== area) : [...areas, area].sort();
    setAreaSaving(area);
    const { error } = await supabase.rpc('admin_set_membership_types', {
      p_society_id: societyId,
      p_player_id:  member.player.id,
      p_types:      newTypes,
    });
    setAreaSaving(null);
    if (error) { Alert.alert('Error', error.message); return; }
    setAreas(newTypes);
    onSaved();
  }

  async function pickPhoto() {
    if (!member) return;
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
        .upload(`${member.player.id}.jpg`, bytes, { contentType: 'image/jpeg', upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(`${member.player.id}.jpg`);
      const newUrl = `${publicUrl}?t=${Date.now()}`;
      // Must go through the admin RPC, not a raw table update — RLS only lets
      // a player update their own row, so an admin editing someone else's
      // photo would otherwise silently match 0 rows (no error, nothing saved).
      const { error: dbError } = await supabase.rpc('admin_update_player', {
        p_society_id: societyId,
        p_player_id: member.player.id,
        p_avatar_url: newUrl,
      });
      if (dbError) throw dbError;
      setAvatarUrl(newUrl);
      onSaved();
    } catch (e: any) {
      Alert.alert('Upload failed', e.message ?? 'Could not upload image.');
    } finally {
      setPhotoUploading(false);
    }
  }

  function confirmDeletePlayer() {
    if (!member) return;
    Alert.alert(
      'Remove Player',
      `Remove ${member.player.display_name} from this society? Their match history will be kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('society_members')
              .delete()
              .eq('player_id', member.player.id)
              .eq('society_id', societyId);
            if (error) { Alert.alert('Error', error.message); return; }
            onSaved();
            onClose();
          },
        },
      ]
    );
  }

  async function saveRoles() {
    if (!member) return;
    setRoleSaving(true);
    try {
      await supabase.rpc('set_committee_role', {
        p_society_id: societyId,
        p_player_id:  member.player.id,
        p_role:       editCommittee,
      });

      const emailChanged = editEmail.trim() !== (member.player.email ?? '');
      const hcpChanged   = editHcp !== (member.player.handicap_index != null ? String(member.player.handicap_index) : '');
      if (emailChanged || hcpChanged) {
        const { error } = await supabase.rpc('admin_update_player', {
          p_society_id: societyId,
          p_player_id:  member.player.id,
          p_email:      editEmail.trim().toLowerCase() || null,
          p_handicap:   editHcp ? parseFloat(editHcp) : null,
        });
        if (error) throw error;
      }

      if (myRole === 'owner' && member.role !== 'owner' && editPermRole !== member.role) {
        const { error } = await supabase.rpc('set_member_role', {
          p_society_id: societyId,
          p_player_id:  member.player.id,
          p_role:       editPermRole,
        });
        if (error) throw error;
      }

      onSaved();
      onClose();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save.');
    } finally {
      setRoleSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.modalContainer}>
        <View style={s.modalHeader}>
          <TouchableOpacity onPress={onClose} hitSlop={hit}>
            <Text style={s.back}>Cancel</Text>
          </TouchableOpacity>
          <Text style={s.modalTitle}>{member?.player.display_name}</Text>
          <TouchableOpacity onPress={saveRoles} disabled={roleSaving} hitSlop={hit}>
            <Text style={[s.addBtn, roleSaving && { opacity: 0.4 }]}>{roleSaving ? 'Saving…' : 'Save'}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

          {/* Avatar + Change Photo */}
          <View style={s.avatarSection}>
            <TouchableOpacity onPress={pickPhoto} disabled={photoUploading} activeOpacity={0.8}>
              {member && resolveAvatar(member.player.id, avatarUrl) ? (
                <Image source={resolveAvatar(member.player.id, avatarUrl)} style={s.avatarLarge} />
              ) : (
                <View style={s.avatarLarge}>
                  <Text style={s.avatarLargeText}>{member?.player.display_name[0]?.toUpperCase() ?? '?'}</Text>
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

          {/* Area Access — Casual / Tour / Swindle */}
          <Text style={[s.sectionLabel, { marginTop: 28 }]}>AREA ACCESS</Text>
          <Text style={s.sectionHint}>Which parts of the app this player can use</Text>
          <View style={s.areaRow}>
            {AREAS.map(area => {
              const on   = areas.includes(area.key);
              const busy = areaSaving === area.key;
              return (
                <TouchableOpacity
                  key={area.key}
                  style={[
                    s.areaChip,
                    on
                      ? { backgroundColor: area.color + '22', borderColor: area.color }
                      : { backgroundColor: '#111', borderColor: '#1c1c1c' },
                  ]}
                  onPress={() => toggleArea(area.key)}
                  disabled={!!areaSaving}
                  activeOpacity={0.7}
                >
                  {busy
                    ? <ActivityIndicator size="small" color={on ? area.color : '#666'} />
                    : <Text style={[s.areaChipText, { color: on ? area.color : '#888' }]}>
                        {on ? '✓ ' : ''}{area.label}
                      </Text>
                  }
                </TouchableOpacity>
              );
            })}
          </View>

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
          {myRole === 'owner' && member?.role !== 'owner' && (
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

          {member?.role !== 'owner' && (
            <TouchableOpacity style={s.deleteBtn} onPress={confirmDeletePlayer} activeOpacity={0.8}>
              <Text style={s.deleteBtnText}>Remove from Society</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  modalContainer: { flex: 1, backgroundColor: '#000' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  modalTitle: { fontFamily: FFB, fontSize: 16, color: '#fff' },
  back:       { fontFamily: FFB, fontSize: 14, color: GOLD },
  addBtn:     { fontFamily: FFB, fontSize: 14, color: GOLD },

  scroll: { padding: 20, paddingBottom: 60 },

  sectionLabel: {
    fontFamily: FFB, fontSize: 10, color: '#fff',
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4,
  },
  sectionHint: { fontFamily: FFB, fontSize: 12, color: '#fff', marginBottom: 14 },

  areaRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 10 },
  areaChip: {
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 999, borderWidth: 1.5, minWidth: 74, alignItems: 'center',
  },
  areaChipText: { fontFamily: FFB, fontSize: 12, letterSpacing: 0.5 },

  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, backgroundColor: '#111',
    borderWidth: 1, borderColor: '#1c1c1c',
  },
  chipOn:      { backgroundColor: GOLD + '22', borderColor: GOLD + '55' },
  chipText:    { fontFamily: FFB, fontSize: 12, color: '#fff' },
  chipTextOn:  { color: GOLD },

  permRow:     { flexDirection: 'row', gap: 10 },
  permChip: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c',
    alignItems: 'center',
  },
  permChipOn:     { backgroundColor: GOLD + '22', borderColor: GOLD + '55' },
  permChipText:   { fontFamily: FFB, fontSize: 14, color: '#fff' },
  permChipTextOn: { color: GOLD },

  fieldLabel: {
    fontFamily: FFB, fontSize: 10, color: '#fff',
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6, marginTop: 14,
  },
  input: {
    backgroundColor: '#111', borderRadius: 12,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingHorizontal: 16, paddingVertical: 14,
    fontFamily: FFB, fontSize: 15, color: '#fff',
  },
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
