import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Modal, TextInput, Image, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { uploadImage } from '../../../src/lib/uploadImage';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';

const SWATCHES = [
  '#D4AF37', '#1B3A5C', '#2D6A4F', '#9B2335',
  '#6B3FA0', '#4A5568', '#2B8A8A', '#C2611F',
  '#0284C7', '#BE185D', '#059669', '#312e81',
];

interface Team {
  id: string;
  name: string;
  accent_color: string;
  logo_url: string | null;
  sort_order: number;
}

interface EditState {
  id: string | null;
  name: string;
  color: string;
  logoUrl: string | null;
  localUri: string | null;
}

const BLANK: EditState = { id: null, name: '', color: SWATCHES[0], logoUrl: null, localUri: null };

export default function TeamsScreen() {
  const router = useRouter();
  const { societyId, loading: societyLoading } = useAdminSociety();
  const [teams, setTeams]     = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]     = useState(false);
  const [edit, setEdit]       = useState<EditState>(BLANK);
  const [saving, setSaving]   = useState(false);

  const loadTeams = useCallback(async () => {
    if (!societyId) return;
    const { data } = await supabase
      .from('teams')
      .select('id, name, accent_color, logo_url, sort_order')
      .eq('society_id', societyId)
      .order('sort_order');
    setTeams((data as Team[]) ?? []);
    setLoading(false);
  }, [societyId]);

  useEffect(() => {
    if (!societyLoading) loadTeams();
  }, [societyLoading, loadTeams]);

  function openNew() {
    setEdit(BLANK);
    setModal(true);
  }

  function openEdit(team: Team) {
    setEdit({ id: team.id, name: team.name, color: team.accent_color, logoUrl: team.logo_url, localUri: null });
    setModal(true);
  }

  async function pickLogo() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (!result.canceled) {
      setEdit(e => ({ ...e, localUri: result.assets[0].uri }));
    }
  }

  async function uploadTeamLogo(teamId: string, localUri: string): Promise<string> {
    return uploadImage(localUri, 'society-assets', `${societyId}/teams/${teamId}.jpg`);
  }

  async function saveTeam() {
    if (!edit.name.trim()) { Alert.alert('Required', 'Team name is required.'); return; }
    if (!societyId) return;
    setSaving(true);
    try {
      let teamId = edit.id;

      if (!teamId) {
        const { data, error } = await supabase
          .from('teams')
          .insert({
            society_id: societyId,
            name: edit.name.trim(),
            accent_color: edit.color,
            sort_order: teams.length,
          })
          .select('id')
          .single();
        if (error) throw error;
        teamId = (data as any).id;
      } else {
        const { error } = await supabase
          .from('teams')
          .update({ name: edit.name.trim(), accent_color: edit.color } as any)
          .eq('id', teamId);
        if (error) throw error;
      }

      if (edit.localUri && teamId) {
        const url = await uploadTeamLogo(teamId, edit.localUri);
        await supabase.from('teams').update({ logo_url: url } as any).eq('id', teamId);
      }

      setModal(false);
      await loadTeams();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save team.');
    } finally {
      setSaving(false);
    }
  }

  function confirmDeleteTeam() {
    if (!edit.id) return;
    Alert.alert(
      `Delete "${edit.name}"?`,
      'This will remove the team and unassign all players from it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setSaving(true);
            const { error } = await supabase.from('teams').delete().eq('id', edit.id!);
            setSaving(false);
            if (error) { Alert.alert('Error', error.message); return; }
            setModal(false);
            await loadTeams();
          },
        },
      ],
    );
  }

  if (loading || societyLoading) {
    return (
      <View style={[s.container, s.centered]}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  const displayUri = edit.localUri ?? edit.logoUrl;

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={hit}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Teams</Text>
        <TouchableOpacity onPress={openNew} hitSlop={hit}>
          <Text style={s.addBtn}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {teams.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>🏌️</Text>
            <Text style={s.emptyTitle}>No teams yet</Text>
            <Text style={s.emptyHint}>
              Add your first team — each gets their own colour and logo
            </Text>
            <TouchableOpacity style={s.emptyBtn} onPress={openNew} activeOpacity={0.8}>
              <Text style={s.emptyBtnText}>Add First Team</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {teams.map(team => (
              <TouchableOpacity
                key={team.id}
                style={s.teamRow}
                onPress={() => openEdit(team)}
                activeOpacity={0.7}
              >
                <View style={[s.teamBar, { backgroundColor: team.accent_color }]} />
                {team.logo_url
                  ? <Image source={{ uri: team.logo_url }} style={s.teamLogo} />
                  : (
                    <View style={[s.teamLogoFallback, { backgroundColor: team.accent_color + '33' }]}>
                      <Text style={s.teamLogoFallbackText}>⛳</Text>
                    </View>
                  )
                }
                <Text style={s.teamName}>{team.name}</Text>
                <Text style={s.teamArrow}>›</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity style={s.addRowBtn} onPress={openNew} activeOpacity={0.8}>
              <Text style={s.addRowBtnText}>+ Add Another Team</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* Add / Edit modal */}
      <Modal
        visible={modal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModal(false)}
      >
        <KeyboardAvoidingView
          style={s.modal}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setModal(false)} hitSlop={hit}>
              <Text style={s.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.modalTitle}>{edit.id ? 'Edit Team' : 'New Team'}</Text>
            <TouchableOpacity onPress={saveTeam} disabled={saving} hitSlop={hit}>
              <Text style={[s.modalSave, saving && { opacity: 0.4 }]}>
                {saving ? 'Saving…' : 'Save'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.modalScroll} keyboardShouldPersistTaps="handled">

            {/* Logo */}
            <TouchableOpacity style={s.logoArea} onPress={pickLogo} activeOpacity={0.8}>
              <View style={[s.logoCircle, { borderColor: edit.color }]}>
                {displayUri
                  ? <Image source={{ uri: displayUri }} style={s.logoImg} />
                  : (
                    <View style={[s.logoFallback, { backgroundColor: edit.color + '22' }]}>
                      <Text style={s.logoFallbackIcon}>⛳</Text>
                    </View>
                  )
                }
              </View>
              <Text style={[s.logoTapHint, { color: edit.color }]}>
                {displayUri ? 'Change Crest' : 'Add Team Crest'}
              </Text>
              <Text style={s.logoSubHint}>Square · PNG or JPEG</Text>
            </TouchableOpacity>

            {/* Name */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>TEAM NAME</Text>
              <View style={s.card}>
                <TextInput
                  style={s.input}
                  value={edit.name}
                  onChangeText={v => setEdit(e => ({ ...e, name: v }))}
                  placeholder="e.g. The Elite"
                  placeholderTextColor={colors.textMuted}
                  autoFocus={!edit.id}
                />
              </View>
            </View>

            {/* Colour */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>TEAM COLOUR</Text>
              <View style={s.swatchGrid}>
                {SWATCHES.map(hex => (
                  <TouchableOpacity
                    key={hex}
                    style={[s.swatch, { backgroundColor: hex }, edit.color === hex && s.swatchOn]}
                    onPress={() => setEdit(e => ({ ...e, color: hex }))}
                    activeOpacity={0.8}
                  >
                    {edit.color === hex && <Text style={s.swatchTick}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Delete */}
            {edit.id && (
              <TouchableOpacity
                style={s.deleteBtn}
                onPress={confirmDeleteTeam}
                disabled={saving}
                activeOpacity={0.8}
              >
                <Text style={s.deleteBtnText}>Delete Team</Text>
              </TouchableOpacity>
            )}

          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const hit = { top: 12, bottom: 12, left: 12, right: 12 };

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered:  { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back:        { fontSize: fonts.sm, color: colors.gold, fontWeight: '600' },
  headerTitle: { fontSize: fonts.md, fontWeight: '800', color: colors.white, letterSpacing: 0.5 },
  addBtn:      { fontSize: fonts.sm, fontWeight: '700', color: colors.gold },

  scroll: { padding: spacing.lg, paddingBottom: 60 },

  teamRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  teamBar:            { width: 4, height: 44, borderRadius: 2 },
  teamLogo:           { width: 48, height: 48, borderRadius: radius.sm },
  teamLogoFallback:   { width: 48, height: 48, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  teamLogoFallbackText: { fontSize: 22 },
  teamName:           { flex: 1, fontSize: fonts.md, fontWeight: '700', color: colors.white },
  teamArrow:          { fontSize: 22, color: colors.textMuted },

  addRowBtn: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.goldBorder, borderStyle: 'dashed',
    paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm,
  },
  addRowBtnText: { fontSize: fonts.sm, fontWeight: '700', color: colors.gold },

  empty:      { alignItems: 'center', paddingTop: 80 },
  emptyIcon:  { fontSize: 52, marginBottom: spacing.md },
  emptyTitle: { fontSize: fonts.xl, fontWeight: '800', color: colors.white, marginBottom: spacing.xs },
  emptyHint: {
    fontSize: fonts.sm, color: colors.textMuted,
    textAlign: 'center', marginBottom: spacing.xl,
    paddingHorizontal: spacing.xl, lineHeight: 20,
  },
  emptyBtn: {
    backgroundColor: colors.gold, borderRadius: radius.md,
    paddingVertical: spacing.md, paddingHorizontal: spacing.xl,
  },
  emptyBtnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg },

  // Modal
  modal: { flex: 1, backgroundColor: colors.bg },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modalCancel: { fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600' },
  modalTitle:  { fontSize: fonts.md, fontWeight: '800', color: colors.white },
  modalSave:   { fontSize: fonts.sm, color: colors.gold, fontWeight: '700' },
  modalScroll: { padding: spacing.lg, paddingBottom: 60 },

  logoArea:        { alignItems: 'center', marginBottom: spacing.xl },
  logoCircle: {
    width: 110, height: 110, borderRadius: 55,
    borderWidth: 3, overflow: 'hidden', marginBottom: spacing.sm,
  },
  logoImg:         { width: '100%', height: '100%' },
  logoFallback:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoFallbackIcon: { fontSize: 44 },
  logoTapHint:     { fontSize: fonts.sm, fontWeight: '700', marginBottom: spacing.xs },
  logoSubHint:     { fontSize: fonts.xs, color: colors.textMuted },

  section: { marginBottom: spacing.lg },
  sectionLabel: {
    fontSize: fonts.xs, fontWeight: '800', color: colors.textMuted,
    letterSpacing: 2, marginBottom: spacing.sm, textTransform: 'uppercase',
  },
  card: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  input: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    fontSize: fonts.md, color: colors.white,
  },
  swatchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch: {
    width: 48, height: 48, borderRadius: 24,
    borderWidth: 2, borderColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  swatchOn:    { borderColor: colors.white, transform: [{ scale: 1.12 }] },
  swatchTick:  { color: colors.white, fontSize: 18, fontWeight: '800' },

  deleteBtn: {
    marginTop: spacing.md,
    backgroundColor: 'rgba(248,113,113,0.08)',
    borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)',
    paddingVertical: spacing.md, alignItems: 'center',
  },
  deleteBtnText: { fontSize: fonts.sm, fontWeight: '800', color: colors.red },
});
