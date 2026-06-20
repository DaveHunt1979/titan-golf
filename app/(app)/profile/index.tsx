import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
  ScrollView, TextInput, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';
import type { Player } from '../../../src/types';

// ── Club definitions ──────────────────────────────────────────
const CLUBS = [
  { id: 'D',  label: 'D',   name: 'Driver' },
  { id: 'W',  label: 'W',   name: 'Wood' },
  { id: 'H',  label: 'H',   name: 'Hybrid' },
  { id: '5',  label: '5',   name: '5 Iron' },
  { id: '6',  label: '6',   name: '6 Iron' },
  { id: '7',  label: '7',   name: '7 Iron' },
  { id: '8',  label: '8',   name: '8 Iron' },
  { id: '9',  label: '9',   name: '9 Iron' },
  { id: 'PW', label: 'PW',  name: 'Pitching Wedge' },
  { id: 'SW', label: 'SW',  name: 'Sand Wedge' },
  { id: '54', label: '54',  name: '54° Wedge' },
  { id: '56', label: '56',  name: '56° Wedge' },
  { id: '60', label: '60',  name: '60° Wedge' },
  { id: 'P',  label: 'P',   name: 'Putter' },
];

const BRANDS = [
  'TaylorMade', 'Callaway', 'Titleist', 'Ping',
  'Cobra', 'Cleveland', 'Srixon', 'Mizuno',
  'Odyssey', 'Scotty Cameron', 'Wilson', 'Other',
];

type Bag = Record<string, { brand?: string; model?: string }>;

export default function ProfileScreen() {
  const router = useRouter();
  const [player, setPlayer]             = useState<Player | null>(null);
  const [loading, setLoading]           = useState(true);
  const [editing, setEditing]           = useState(false);
  const [saving, setSaving]             = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Edit fields
  const [name, setName]         = useState('');
  const [nickname, setNickname] = useState('');
  const [hcp, setHcp]           = useState('');
  const [cdhNum, setCdhNum]     = useState('');
  const [bag, setBag]           = useState<Bag>({});
  const [expandedClub, setExpandedClub] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data, error } = await supabase
      .from('players').select('*').eq('auth_uid', user.id).maybeSingle();
    if (error) Alert.alert('Error loading profile', error.message);
    if (data) {
      setPlayer(data);
      setName(data.display_name ?? '');
      setNickname(data.nickname ?? '');
      setHcp(data.handicap_index != null ? String(data.handicap_index) : '');
      setCdhNum(data.cdh_number ?? '');
      setBag((data.bag as Bag) ?? {});
    }
    setLoading(false);
  }

  function startEdit() {
    setName(player?.display_name ?? '');
    setNickname(player?.nickname ?? '');
    setHcp(player?.handicap_index != null ? String(player.handicap_index) : '');
    setCdhNum(player?.cdh_number ?? '');
    setBag((player?.bag as Bag) ?? {});
    setExpandedClub(null);
    setEditing(true);
  }

  function cancelEdit() {
    setName(player?.display_name ?? '');
    setNickname(player?.nickname ?? '');
    setHcp(player?.handicap_index != null ? String(player.handicap_index) : '');
    setCdhNum(player?.cdh_number ?? '');
    setBag((player?.bag as Bag) ?? {});
    setExpandedClub(null);
    setEditing(false);
  }

  function toggleClub(id: string) {
    setBag(prev => {
      const next = { ...prev };
      if (next[id]) {
        delete next[id];
        if (expandedClub === id) setExpandedClub(null);
      } else {
        next[id] = {};
        setExpandedClub(id);
      }
      return next;
    });
  }

  function updateClub(id: string, field: 'brand' | 'model', value: string) {
    setBag(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow access to your photo library to change your avatar.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images', allowsEditing: true, aspect: [1, 1], quality: 0.7,
    });
    if (result.canceled || !result.assets[0] || !player) return;
    setUploadingImage(true);
    try {
      const response = await fetch(result.assets[0].uri);
      const blob = await response.blob();
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(`${player.id}.jpg`, blob, { contentType: 'image/jpeg', upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(`${player.id}.jpg`);
      const avatarUrl = `${publicUrl}?t=${Date.now()}`;
      const { error: dbError } = await supabase.from('players').update({ avatar_url: avatarUrl }).eq('id', player.id);
      if (dbError) throw dbError;
      setPlayer(p => p ? { ...p, avatar_url: avatarUrl } : p);
    } catch (e: any) {
      Alert.alert('Upload failed', e.message ?? 'Could not upload image.');
    } finally {
      setUploadingImage(false);
    }
  }

  async function save() {
    if (!name.trim()) { Alert.alert('Name required'); return; }
    setSaving(true);
    const cleanBag: Bag = Object.fromEntries(
      Object.entries(bag).map(([k, v]) => [k, {
        ...(v.brand ? { brand: v.brand } : {}),
        ...(v.model?.trim() ? { model: v.model.trim() } : {}),
      }])
    );
    const updates = {
      display_name:   name.trim(),
      nickname:       nickname.trim() || null,
      handicap_index: hcp ? parseFloat(hcp) : null,
      cdh_number:     cdhNum.trim() || null,
      bag:            cleanBag,
    };

    if (!player) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setSaving(false); return; }
      const { data, error } = await supabase
        .from('players').insert({ auth_uid: user.id, ...updates }).select().single();
      setSaving(false);
      if (error) { Alert.alert('Error', error.message); return; }
      setPlayer(data); setEditing(false); return;
    }

    const { error } = await supabase.from('players').update(updates as any).eq('id', player.id);
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setPlayer(p => p ? { ...p, ...updates } : p);
    setBag(cleanBag);
    setEditing(false);
  }

  async function signOut() {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  }

  const initial = player?.display_name?.charAt(0)?.toUpperCase() ?? '?';
  const selectedClubs = CLUBS.filter(c => bag[c.id]);

  if (loading) {
    return <View style={[s.container, s.centered]}><StatusBar style="light" /><ActivityIndicator color={colors.gold} size="large" /></View>;
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>Profile</Text>
        {!editing
          ? <TouchableOpacity onPress={startEdit} hitSlop={hit}><Text style={s.editLink}>Edit</Text></TouchableOpacity>
          : <TouchableOpacity onPress={cancelEdit} hitSlop={hit}><Text style={s.cancelLink}>Cancel</Text></TouchableOpacity>
        }
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* Avatar */}
        <View style={s.avatarArea}>
          <TouchableOpacity onPress={editing ? pickImage : undefined} activeOpacity={editing ? 0.7 : 1} style={s.avatarWrap}>
            {player?.avatar_url
              ? <Image source={{ uri: player.avatar_url }} style={s.avatarImage} />
              : <View style={s.avatar}><Text style={s.avatarLetter}>{initial}</Text></View>
            }
            {editing && (
              <View style={s.avatarOverlay}>
                {uploadingImage ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={{ fontSize: 26 }}>📷</Text>}
              </View>
            )}
          </TouchableOpacity>

          {!editing && (
            <>
              <Text style={s.displayName}>{player?.display_name ?? 'No name set'}</Text>
              {player?.nickname ? <Text style={s.nickname}>"{player.nickname}"</Text> : null}
              <Text style={s.email}>{player?.email ?? ''}</Text>
              {!player && (
                <TouchableOpacity style={s.setupBtn} onPress={startEdit} activeOpacity={0.8}>
                  <Text style={s.setupBtnText}>Set Up Profile</Text>
                </TouchableOpacity>
              )}
            </>
          )}
          {editing && (
            <TouchableOpacity onPress={pickImage} style={s.changePhotoBtn} disabled={uploadingImage}>
              <Text style={s.changePhotoText}>{uploadingImage ? 'Uploading…' : 'Change Photo'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {editing ? (
          <>
            {/* Edit: Details */}
            <Text style={s.sectionLabel}>DETAILS</Text>
            <View style={s.card}>
              <Field label="Display Name" value={name} onChange={setName} placeholder="Your name" autoFocus />
              <FieldDivider />
              <Field label='Nickname' value={nickname} onChange={setNickname} placeholder='e.g. "The Machine"' />
              <FieldDivider />
              <Field label="Handicap Index" value={hcp} onChange={setHcp} placeholder="e.g. 14.2" keyboardType="decimal-pad" />
              <FieldDivider />
              <Field label="CDH Number" value={cdhNum} onChange={setCdhNum} placeholder="England Golf CDH number" keyboardType="number-pad" />
            </View>

            {/* Edit: My Bag */}
            <Text style={s.sectionLabel}>MY BAG</Text>
            <View style={s.bagCard}>
              <Text style={s.bagHint}>Tap to add clubs to your bag</Text>
              <View style={s.clubGrid}>
                {CLUBS.map(c => {
                  const selected = !!bag[c.id];
                  return (
                    <TouchableOpacity
                      key={c.id}
                      style={[s.clubCircle, selected && s.clubCircleOn]}
                      onPress={() => {
                        toggleClub(c.id);
                        if (!bag[c.id]) setExpandedClub(c.id);
                        else if (expandedClub === c.id) setExpandedClub(null);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.clubLabel, selected && s.clubLabelOn]}>{c.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Selected club editors */}
              {CLUBS.filter(c => bag[c.id]).map(c => (
                <ClubEditor
                  key={c.id}
                  club={c}
                  entry={bag[c.id]}
                  expanded={expandedClub === c.id}
                  onToggle={() => setExpandedClub(prev => prev === c.id ? null : c.id)}
                  onUpdate={(field, val) => updateClub(c.id, field, val)}
                />
              ))}
            </View>

            <TouchableOpacity
              style={[s.saveBtn, saving && { opacity: 0.5 }]}
              onPress={save} disabled={saving} activeOpacity={0.8}
            >
              {saving ? <ActivityIndicator color={colors.bg} /> : <Text style={s.saveBtnText}>Save Profile</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <>
            {/* Read: Stats */}
            <View style={s.card}>
              <View style={s.rowView}>
                <Text style={s.rowLabel}>Handicap Index</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <Text style={s.rowValue}>
                    {player?.handicap_index != null ? String(player.handicap_index) : '—'}
                  </Text>
                  <TouchableOpacity
                    onPress={() => router.push('/(app)/profile/handicap' as any)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={s.calcLink}>
                      {player?.handicap_index != null ? 'Recalculate' : 'Calculate →'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
              {player?.cdh_number ? <><FieldDivider /><Row label="CDH Number" value={player.cdh_number} /></> : null}
            </View>

            {/* Read: My Bag */}
            {selectedClubs.length > 0 && (
              <>
                <Text style={s.sectionLabel}>MY BAG</Text>
                <View style={s.bagCard}>
                  <View style={s.clubGrid}>
                    {CLUBS.map(c => {
                      const selected = !!bag[c.id];
                      return (
                        <View key={c.id} style={[s.clubCircle, selected && s.clubCircleOn]}>
                          <Text style={[s.clubLabel, selected && s.clubLabelOn]}>{c.label}</Text>
                        </View>
                      );
                    })}
                  </View>
                  <Text style={s.bagCount}>{selectedClubs.length} club{selectedClubs.length !== 1 ? 's' : ''} in the bag</Text>
                  {selectedClubs.filter(c => bag[c.id]?.brand).map(c => (
                    <Text key={c.id} style={s.bagSummaryRow}>
                      <Text style={{ color: colors.gold }}>{c.label}  </Text>
                      <Text style={{ color: colors.textSecondary }}>{bag[c.id].brand}{bag[c.id].model ? ` · ${bag[c.id].model}` : ''}</Text>
                    </Text>
                  ))}
                </View>
              </>
            )}

            {/* Sign out */}
            <View style={[s.card, { marginTop: spacing.md }]}>
              <TouchableOpacity style={s.action} onPress={signOut} activeOpacity={0.7}>
                <Text style={s.actionDanger}>Sign Out</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        <Text style={s.version}>Titan Golf · v1.0</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Club editor ───────────────────────────────────────────────
function ClubEditor({
  club, entry, expanded, onToggle, onUpdate,
}: {
  club: { id: string; name: string };
  entry: { brand?: string; model?: string };
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (field: 'brand' | 'model', val: string) => void;
}) {
  return (
    <View style={ce.container}>
      <TouchableOpacity style={ce.header} onPress={onToggle} activeOpacity={0.7}>
        <View style={ce.dot} />
        <Text style={ce.name}>{club.name}</Text>
        <Text style={ce.brand}>{entry.brand ?? 'Tap to set brand'}</Text>
        <Text style={ce.chevron}>{expanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={ce.body}>
          <Text style={ce.fieldLabel}>Brand</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
            <View style={{ flexDirection: 'row', gap: spacing.xs, paddingVertical: 4 }}>
              {BRANDS.map(b => (
                <TouchableOpacity
                  key={b}
                  style={[ce.brandChip, entry.brand === b && ce.brandChipOn]}
                  onPress={() => onUpdate('brand', entry.brand === b ? '' : b)}
                  activeOpacity={0.7}
                >
                  <Text style={[ce.brandChipText, entry.brand === b && ce.brandChipTextOn]}>{b}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
          <Text style={ce.fieldLabel}>Model</Text>
          <TextInput
            style={ce.input}
            value={entry.model ?? ''}
            onChangeText={v => onUpdate('model', v)}
            placeholder="e.g. Stealth 2, Apex, G430…"
            placeholderTextColor={colors.textMuted}
          />
        </View>
      )}
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────
function Field({ label, value, onChange, placeholder, keyboardType, autoFocus }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; keyboardType?: any; autoFocus?: boolean;
}) {
  return (
    <View style={s.fieldRow}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={s.fieldInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        autoFocus={autoFocus}
      />
    </View>
  );
}

function FieldDivider() {
  return <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: spacing.md }} />;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.rowView}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

const hit = { top: 10, bottom: 10, left: 10, right: 10 };

// ── Styles ────────────────────────────────────────────────────
const s = StyleSheet.create({
  container:  { flex: 1, backgroundColor: colors.bg },
  centered:   { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title:      { fontSize: fonts.xxl, fontWeight: '800', color: colors.white, letterSpacing: 1 },
  editLink:   { fontSize: fonts.sm, fontWeight: '700', color: colors.gold },
  cancelLink: { fontSize: fonts.sm, fontWeight: '700', color: colors.textMuted },
  cameraLink: { fontSize: 22 },
  scroll:     { padding: spacing.lg, paddingBottom: 80 },

  avatarArea:  { alignItems: 'center', paddingVertical: spacing.xl },
  avatarWrap:  { position: 'relative', marginBottom: spacing.md },
  avatarImage: { width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: colors.goldBorder },
  avatar: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: colors.goldDim, borderWidth: 2, borderColor: colors.goldBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter:  { fontSize: fonts.hero * 0.7, fontWeight: '800', color: colors.gold },
  avatarOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 44,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  displayName:    { fontSize: fonts.xl, fontWeight: '700', color: colors.white },
  nickname:       { fontSize: fonts.sm, color: colors.gold, fontStyle: 'italic', marginTop: 2 },
  email:          { fontSize: fonts.sm, color: colors.textMuted, marginTop: 4 },
  changePhotoBtn: { marginTop: spacing.xs },
  changePhotoText:{ fontSize: fonts.sm, fontWeight: '600', color: colors.gold, textDecorationLine: 'underline' },
  setupBtn: {
    backgroundColor: colors.gold, borderRadius: radius.md,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.xl, marginTop: spacing.md,
  },
  setupBtnText: { fontSize: fonts.sm, fontWeight: '800', color: colors.bg },

  sectionLabel: {
    fontSize: fonts.xs, fontWeight: '800', color: colors.textMuted,
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: spacing.xs, marginTop: spacing.md,
  },
  card: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, overflow: 'hidden',
  },
  rowView: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  rowLabel: { fontSize: fonts.sm, color: colors.textSecondary },
  rowValue:  { fontSize: fonts.sm, fontWeight: '700', color: colors.white },
  calcLink:  { fontSize: fonts.xs, fontWeight: '700', color: colors.gold, textDecorationLine: 'underline' },

  fieldRow:   { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  fieldLabel: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: 4 },
  fieldInput: { fontSize: fonts.md, color: colors.white },

  bagCard: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md,
  },
  bagHint:  { fontSize: fonts.xs, color: colors.textMuted, marginBottom: spacing.md },
  bagCount: { fontSize: fonts.xs, color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center' },
  bagSummaryRow: { fontSize: fonts.sm, marginTop: 6, lineHeight: 20 },

  clubGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center', marginBottom: spacing.sm },
  clubCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.cardAlt, borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  clubCircleOn:  { backgroundColor: colors.goldDim, borderColor: colors.gold },
  clubLabel:     { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  clubLabelOn:   { color: colors.gold },

  saveBtn: {
    backgroundColor: colors.gold, borderRadius: radius.md,
    paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.lg,
  },
  saveBtnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg },

  action:      { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  actionDanger:{ fontSize: fonts.md, color: colors.red, fontWeight: '600' },
  version:     { textAlign: 'center', fontSize: fonts.xs, color: colors.textMuted, marginTop: spacing.xl },
});

const ce = StyleSheet.create({
  container: {
    borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.sm,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  dot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gold },
  name:    { flex: 1, fontSize: fonts.sm, fontWeight: '700', color: colors.white },
  brand:   { fontSize: fonts.xs, color: colors.textMuted },
  chevron: { fontSize: 10, color: colors.textMuted },
  body:    { paddingBottom: spacing.md },
  fieldLabel: {
    fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted,
    letterSpacing: 1, marginBottom: 6,
  },
  brandChip: {
    paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: 16,
    backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border,
  },
  brandChipOn:     { backgroundColor: colors.goldDim, borderColor: colors.gold },
  brandChipText:   { fontSize: fonts.xs, fontWeight: '600', color: colors.textMuted },
  brandChipTextOn: { color: colors.gold },
  input: {
    backgroundColor: colors.cardAlt, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: fonts.sm, color: colors.white,
  },
});
