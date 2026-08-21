import { useEffect, useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Modal, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { resolveAvatar } from '../../../src/lib/assets';
import { goBack } from '../../../src/lib/navigation';
import PlayerEditSheet, { type EditablePlayer } from '../../../src/components/PlayerEditSheet';

const GOLD = '#D4AF37';
const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

type Member = EditablePlayer;

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

  // Role assignment sheet
  const [selected, setSelected] = useState<Member | null>(null);

  async function load() {
    if (!societyId) return;
    const { data: { user } } = await supabase.auth.getUser();

    const [membersRes, myRoleRes] = await Promise.all([
      supabase
        .from('society_members')
        .select('role, committee_role, membership_types, player:player_id(id, display_name, email, handicap_index, avatar_url)')
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
      setMembers((membersRes.data as any[]).map(row => ({ ...row, membership_types: row.membership_types ?? [] })) as Member[]);
    }
    if (myRoleRes.data) setMyRole((myRoleRes.data as any).role ?? 'member');
    setLoading(false);
  }

  useEffect(() => { load(); }, [societyId]);
  useFocusEffect(useCallback(() => { load(); }, [societyId]));

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
        <TouchableOpacity onPress={() => goBack(router, '/(app)/admin/hub-platform')} hitSlop={hit}>
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
            onPress={() => setSelected(m)}
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

      <PlayerEditSheet
        visible={!!selected}
        member={selected}
        societyId={societyId!}
        myRole={myRole}
        onClose={() => setSelected(null)}
        onSaved={load}
      />
    </KeyboardAvoidingView>
  );
}

function MemberRow({ member, isLast }: { member: Member; isLast: boolean }) {
  const { player, role, committee_role } = member;
  const initial = player.display_name[0]?.toUpperCase() ?? '?';
  const isOwner = role === 'owner';
  const isAdmin = role === 'admin';
  const avatarSrc = resolveAvatar(player.id, player.avatar_url);

  return (
    <View style={[s.memberRow, !isLast && s.memberRowBorder]}>
      {avatarSrc ? (
        <Image source={avatarSrc} style={s.avatar} />
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
      <Ionicons name="chevron-forward" size={16} color="#444" style={{ marginLeft: 8 }} />
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
  count:  { fontFamily: FFB, fontSize: 10, color: '#fff', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 },

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
  memberEmail:   { fontFamily: FFB, fontSize: 12, color: '#fff', marginTop: 2 },
  committeeRole: { fontFamily: FFB, fontSize: 12, color: GOLD, fontStyle: 'italic', marginTop: 2 },
  hcp:           { fontFamily: FFB, fontSize: 12, color: '#fff' },
  roleBadge:     { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, borderWidth: 1 },
  roleText:      { fontFamily: FFB, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },

  empty:      { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { fontFamily: FFB, fontSize: 18, color: '#fff', marginBottom: 8 },
  emptySub:   { fontFamily: FFB, fontSize: 14, color: '#fff', textAlign: 'center', lineHeight: 20 },

  modalContainer: { flex: 1, backgroundColor: '#000' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  modalTitle: { fontFamily: FFB, fontSize: 16, color: '#fff' },

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
  hint:    { fontFamily: FFB, fontSize: 12, color: '#fff', lineHeight: 18, marginTop: 16 },
  saveBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 28 },
  saveBtnText: { fontFamily: FFB, fontSize: 16, color: '#000' },
});
