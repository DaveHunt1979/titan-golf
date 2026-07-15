import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Modal, TextInput, Image, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { uploadImage } from '../../../src/lib/uploadImage';

const GOLD = '#D4AF37';
const GREEN = '#4ade80';
const RED = '#f87171';
const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

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

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

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

  if (loading || !fontsLoaded) return (
    <View style={{ flex:1, backgroundColor:'#000', alignItems:'center', justifyContent:'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

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

  const displayUri = edit.localUri ?? edit.logoUrl;

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={hit} style={s.headerLeft}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} />
          <Text style={s.headerTitle}>TEAMS</Text>
          <Text style={s.headerSub}>admin</Text>
        </View>
        <TouchableOpacity onPress={openNew} hitSlop={hit} style={s.headerRight}>
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
                {/* Accent dot */}
                <View style={[s.accentDot, { backgroundColor: team.accent_color }]} />
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
              <TextInput
                style={s.input}
                value={edit.name}
                onChangeText={v => setEdit(e => ({ ...e, name: v }))}
                placeholder="e.g. The Elite"
                placeholderTextColor="#444"
                autoFocus={!edit.id}
              />
            </View>

            {/* Colour */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>TEAM COLOUR</Text>
              <View style={s.swatchGrid}>
                {SWATCHES.map(hex => (
                  <TouchableOpacity
                    key={hex}
                    style={[
                      s.swatch,
                      { backgroundColor: hex },
                      edit.color === hex && s.swatchOn,
                    ]}
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
  container: { flex: 1, backgroundColor: '#000' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  headerLeft:   { width: 70, alignItems: 'flex-start' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerRight:  { width: 70, alignItems: 'flex-end' },
  headerLogo:   { width: 28, height: 28, marginBottom: 2 },
  headerTitle:  { fontFamily: FFB, fontSize: 15, color: '#fff', letterSpacing: 0.5 },
  headerSub:    { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 1, textTransform: 'uppercase' },
  back:         { fontFamily: FFB, fontSize: 14, color: GOLD },
  addBtn:       { fontFamily: FFB, fontSize: 14, color: GOLD },

  scroll: { padding: 20, paddingBottom: 60 },

  // Team row cards
  teamRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingVertical: 14, paddingHorizontal: 14,
    marginBottom: 10,
  },
  accentDot:              { width: 10, height: 10, borderRadius: 5 },
  teamLogo:               { width: 48, height: 48, borderRadius: 8 },
  teamLogoFallback:       { width: 48, height: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  teamLogoFallbackText:   { fontSize: 22 },
  teamName:               { flex: 1, fontFamily: FFB, fontSize: 16, color: '#fff' },
  teamArrow:              { fontSize: 22, color: '#fff' },

  addRowBtn: {
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: GOLD, borderStyle: 'dashed',
    paddingVertical: 14, alignItems: 'center', marginTop: 8,
  },
  addRowBtnText: { fontFamily: FFB, fontSize: 14, color: GOLD },

  empty:      { alignItems: 'center', paddingTop: 80 },
  emptyIcon:  { fontSize: 52, marginBottom: 12 },
  emptyTitle: { fontFamily: FFB, fontSize: 20, color: '#fff', marginBottom: 6 },
  emptyHint: {
    fontFamily: FFB, fontSize: 14, color: '#fff',
    textAlign: 'center', marginBottom: 28,
    paddingHorizontal: 24, lineHeight: 20,
  },
  emptyBtn: {
    backgroundColor: GOLD, borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 28,
  },
  emptyBtnText: { fontFamily: FFB, fontSize: 16, color: '#000' },

  // Modal
  modal: { flex: 1, backgroundColor: '#000' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  modalCancel: { fontFamily: FFB, fontSize: 14, color: '#fff' },
  modalTitle:  { fontFamily: FFB, fontSize: 16, color: '#fff' },
  modalSave:   { fontFamily: FFB, fontSize: 14, color: GOLD },
  modalScroll: { padding: 20, paddingBottom: 60 },

  logoArea:         { alignItems: 'center', marginBottom: 28 },
  logoCircle: {
    width: 110, height: 110, borderRadius: 55,
    borderWidth: 3, overflow: 'hidden', marginBottom: 10,
  },
  logoImg:          { width: '100%', height: '100%' },
  logoFallback:     { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoFallbackIcon: { fontSize: 44 },
  logoTapHint:      { fontFamily: FFB, fontSize: 14, marginBottom: 4 },
  logoSubHint:      { fontFamily: FFB, fontSize: 11, color: '#fff' },

  section:      { marginBottom: 24 },
  sectionLabel: {
    fontFamily: FFB, fontSize: 10, color: '#fff',
    letterSpacing: 2, marginBottom: 10, textTransform: 'uppercase',
  },

  input: {
    backgroundColor: '#111', borderRadius: 12,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingHorizontal: 16, paddingVertical: 14,
    fontFamily: FFB, fontSize: 16, color: '#fff',
  },

  swatchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: {
    width: 48, height: 48, borderRadius: 24,
    borderWidth: 2, borderColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  swatchOn:   { borderColor: '#fff', transform: [{ scale: 1.12 }] },
  swatchTick: { color: '#fff', fontSize: 18, fontFamily: FFB },

  deleteBtn: {
    marginTop: 12,
    backgroundColor: 'rgba(248,113,113,0.08)',
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)',
    paddingVertical: 14, alignItems: 'center',
  },
  deleteBtnText: { fontFamily: FFB, fontSize: 14, color: RED },
});
