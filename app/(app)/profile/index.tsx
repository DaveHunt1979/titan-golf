import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
  ScrollView, TextInput, KeyboardAvoidingView, Platform, Image, Modal,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import type { Player } from '../../../src/types';

const GOLD  = '#D4AF37'; // StyleSheet fallback — JSX uses dc.gold
const GREEN = '#22c55e';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const HIT   = { top: 10, bottom: 10, left: 10, right: 10 };

type Club = {
  id: string;
  name: string;
  short_name: string;
  brand: string | null;
  model: string | null;
  nfc_tag_id: string | null;
  in_bag: boolean;
  sort_order: number;
};

export default function ProfileScreen() {
  const router = useRouter();
  const dc = useDynamicColors();

  const [player,         setPlayer]         = useState<Player | null>(null);
  const [clubs,          setClubs]          = useState<Club[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [editing,        setEditing]        = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [syncingHcp,     setSyncingHcp]     = useState(false);
  const [notifCount,     setNotifCount]     = useState(0);

  // Password modal
  const [showPwModal, setShowPwModal] = useState(false);
  const [newPw,       setNewPw]       = useState('');
  const [confirmPw,   setConfirmPw]   = useState('');
  const [pwSaving,    setPwSaving]    = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  useFocusEffect(useCallback(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); }, []));

  // Edit fields
  const [name,     setName]     = useState('');
  const [nickname, setNickname] = useState('');
  const [hcp,      setHcp]      = useState('');
  const [cdhNum,   setCdhNum]   = useState('');

  useFocusEffect(useCallback(() => { load(); }, []));

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

      const { data: clubRows } = await supabase
        .from('clubs').select('*')
        .eq('player_id', data.id)
        .eq('in_bag', true)
        .order('sort_order');
      setClubs((clubRows ?? []) as Club[]);
    }

    const { data: notifs } = await supabase.from('notifications').select('id').limit(9);
    setNotifCount((notifs as any)?.length ?? 0);
    setLoading(false);
  }

  function startEdit() {
    setName(player?.display_name ?? '');
    setNickname(player?.nickname ?? '');
    setHcp(player?.handicap_index != null ? String(player.handicap_index) : '');
    setCdhNum(player?.cdh_number ?? '');
    setEditing(true);
  }

  function cancelEdit() { setEditing(false); }

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
      const uri = result.assets[0].uri;
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const { error: uploadError } = await supabase.storage
        .from('avatars').upload(`${player.id}.jpg`, bytes, { contentType: 'image/jpeg', upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(`${player.id}.jpg`);
      const avatarUrl = `${publicUrl}?t=${Date.now()}`;
      const { error: dbError } = await supabase.from('players').update({ avatar_url: avatarUrl }).eq('id', player.id);
      if (dbError) throw dbError;
      setPlayer(p => p ? { ...p, avatar_url: avatarUrl } : p);
      Alert.alert('Photo updated', 'Your profile photo has been saved.');
    } catch (e: any) {
      Alert.alert('Upload failed', e.message ?? 'Could not upload image.');
    } finally {
      setUploadingImage(false);
    }
  }

  async function syncFromEnglandGolf() {
    const cdh = (cdhNum.trim() || player?.cdh_number || '').trim();
    if (!cdh) { Alert.alert('CDH Number required', 'Enter your England Golf CDH number first.'); return; }
    setSyncingHcp(true);
    try {
      const res = await fetch(
        `https://api.golfgenius.com/api/v1.0/GolfEngland/HandicapIndex/${encodeURIComponent(cdh)}`,
        { headers: { Accept: 'application/json' } }
      );
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const json = await res.json();
      const hi = json.handicapIndex ?? json.HandicapIndex ?? json.whs_handicap_index ?? json.data?.handicapIndex;
      if (hi == null) throw new Error('Handicap not found');
      const rounded = Math.round(hi * 10) / 10;
      setHcp(String(rounded));
      if (player) {
        await supabase.from('players').update({ handicap_index: rounded }).eq('id', player.id);
        setPlayer(p => p ? { ...p, handicap_index: rounded } : p);
      }
      Alert.alert('Synced!', `Handicap index updated to ${rounded}.`);
    } catch {
      Alert.alert('Sync failed', 'Could not fetch from England Golf. Check your CDH number or update manually.');
    } finally {
      setSyncingHcp(false);
    }
  }

  async function save() {
    if (!name.trim()) { Alert.alert('Name required'); return; }
    setSaving(true);
    const updates = {
      display_name:   name.trim(),
      nickname:       nickname.trim() || null,
      handicap_index: hcp ? parseFloat(hcp) : null,
      cdh_number:     cdhNum.trim() || null,
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
    setEditing(false);
  }

  async function changePassword() {
    if (newPw.length < 6) { Alert.alert('Too short', 'Password must be at least 6 characters.'); return; }
    if (newPw !== confirmPw) { Alert.alert('No match', 'Passwords do not match.'); return; }
    setPwSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setPwSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setShowPwModal(false); setNewPw(''); setConfirmPw('');
    Alert.alert('Password updated', 'Your new password is active.');
  }

  async function signOut() {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  }

  const initial    = player?.display_name?.charAt(0)?.toUpperCase() ?? '?';
  const cdhLinked  = !!(player?.cdh_number);

  if (loading) {
    return (
      <View style={[s.root, { backgroundColor: dc.bg }]}>
        <StatusBar style="light" />
        <View style={s.centered}><ActivityIndicator color={dc.gold} size="large" /></View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={[s.root, { backgroundColor: dc.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={s.header}>
        <View style={s.headerSide}>
          <TouchableOpacity onPress={() => {}} hitSlop={HIT}>
            <View style={s.bellWrap}>
              <Ionicons name="notifications-outline" size={24} color="#ffffff" />
              {notifCount > 0 && <View style={s.notifDot} />}
            </View>
          </TouchableOpacity>
        </View>
        <View style={s.headerCenter}>
          <Image
            source={require('../../../assets/TitanAppLogo.png')}
            style={s.headerLogo}
            resizeMode="contain"
          />
        </View>
        <View style={[s.headerSide, { alignItems: 'flex-end' }]}>
          {!editing
            ? <TouchableOpacity onPress={startEdit} hitSlop={HIT}><Text style={s.editLink}>Edit</Text></TouchableOpacity>
            : <TouchableOpacity onPress={cancelEdit} hitSlop={HIT}><Text style={s.cancelLink}>Cancel</Text></TouchableOpacity>
          }
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Page title ── */}
        <Text style={s.pageTitle}>{editing ? 'Edit Profile' : 'Locker Room'}</Text>

        {/* ── Profile card ── */}
        <View style={s.profileCard}>
          <TouchableOpacity
            onPress={editing ? pickImage : undefined}
            activeOpacity={editing ? 0.7 : 1}
            style={s.avatarWrap}
          >
            {player?.avatar_url
              ? <Image source={{ uri: player.avatar_url }} style={s.avatarImg} />
              : (
                <View style={s.avatarPlaceholder}>
                  <Text style={s.avatarInitial}>{initial}</Text>
                </View>
              )
            }
            <View style={s.avatarRing} />
            {editing && (
              <View style={s.avatarOverlay}>
                {uploadingImage
                  ? <ActivityIndicator color="#ffffff" size="small" />
                  : <Ionicons name="camera-outline" size={20} color="#ffffff" />
                }
              </View>
            )}
          </TouchableOpacity>

          <View style={s.profileInfo}>
            <Text style={s.profileName}>{player?.display_name ?? 'Golfer'}</Text>
            <View style={s.badgeRow}>
              <View style={s.eliteDot} />
              <Text style={s.eliteText}>{player?.nickname ? `"${player.nickname}"` : 'TITAN Member'}</Text>
            </View>
            <View style={s.statsRow}>
              <View style={s.statBox}>
                <Text style={s.statLabel}>HANDICAP</Text>
                <Text style={s.statValue}>
                  {player?.handicap_index != null ? String(player.handicap_index) : '—'}
                </Text>
              </View>
              <View style={s.statDivider} />
              <View style={s.statBox}>
                <Text style={s.statLabel}>IN THE BAG</Text>
                <Text style={s.statValue}>{clubs.length} clubs</Text>
              </View>
            </View>
          </View>
        </View>

        {editing ? (
          <>
            {/* ── EDIT: Details only ── */}
            <Text style={s.sectionLabel}>DETAILS</Text>
            <View style={s.card}>
              <EditField label="Display Name"   value={name}     onChange={setName}     placeholder="Your name" autoFocus />
              <View style={s.divider} />
              <EditField label="Nickname"       value={nickname} onChange={setNickname} placeholder='e.g. "The Machine"' />
              <View style={s.divider} />
              <EditField label="Handicap Index" value={hcp}      onChange={setHcp}      placeholder="e.g. 14.2" keyboardType="decimal-pad" />
              <View style={s.divider} />
              <EditField label="CDH Number"     value={cdhNum}   onChange={setCdhNum}   placeholder="England Golf CDH number" keyboardType="number-pad" />
            </View>

            <TouchableOpacity
              style={[s.syncBtn, (!cdhNum.trim() || syncingHcp) && { opacity: 0.4 }]}
              onPress={syncFromEnglandGolf}
              disabled={!cdhNum.trim() || syncingHcp}
              activeOpacity={0.8}
            >
              {syncingHcp
                ? <ActivityIndicator color={GREEN} size="small" />
                : <Text style={s.syncBtnText}>⛳  Sync Handicap from England Golf</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.saveBtn, saving && { opacity: 0.5 }]}
              onPress={save} disabled={saving} activeOpacity={0.8}
            >
              {saving ? <ActivityIndicator color="#000" /> : <Text style={s.saveBtnText}>Save Profile</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <>
            {/* ── READ: My Bag ── */}
            <View style={s.bagHeader}>
              <View>
                <Text style={s.bagTitle}>My Bag</Text>
                <Text style={s.bagSubtitle}>Tap a club to edit or assign NFC</Text>
              </View>
              <TouchableOpacity
                style={s.addClubBtn}
                onPress={() => router.push('/(app)/profile/bag' as any)}
                activeOpacity={0.8}
              >
                <Ionicons name="options-outline" size={14} color={GOLD} />
                <Text style={s.addClubText}>Manage</Text>
              </TouchableOpacity>
            </View>

            <View style={s.clubList}>
              {clubs.length === 0 ? (
                <TouchableOpacity
                  style={s.emptyBag}
                  onPress={() => router.push('/(app)/profile/bag' as any)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="golf-outline" size={28} color="#333" style={{ marginBottom: 8 }} />
                  <Text style={s.emptyBagText}>No clubs in your bag yet</Text>
                  <Text style={s.emptyBagSub}>Tap Manage to set up your bag</Text>
                </TouchableOpacity>
              ) : (
                clubs.map((club, idx) => (
                  <TouchableOpacity
                    key={club.id}
                    style={[s.clubRow, idx === clubs.length - 1 && s.clubRowLast]}
                    onPress={() => router.push(`/(app)/profile/club/${club.id}` as any)}
                    activeOpacity={0.7}
                  >
                    <View style={s.clubIconWrap}>
                      <Ionicons name="golf-outline" size={15} color={GOLD} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.clubName}>{club.name}</Text>
                      {club.brand
                        ? <Text style={s.clubBrand}>{club.brand}{club.model ? ` · ${club.model}` : ''}</Text>
                        : <Text style={s.clubBrandEmpty}>Tap to set brand</Text>
                      }
                    </View>
                    {club.nfc_tag_id
                      ? (
                        <View style={s.nfcBadge}>
                          <Text style={s.nfcText}>NFC</Text>
                        </View>
                      ) : null
                    }
                    <Ionicons name="chevron-forward" size={14} color="#444" />
                  </TouchableOpacity>
                ))
              )}
            </View>

            {/* ── READ: Quick links ── */}
            <View style={s.quickLinks}>
              <QuickLink
                icon="bar-chart-outline"
                title="My Stats"
                sub="Scoring, drives, putting & distances"
                onPress={() => router.push('/(app)/profile/stats' as any)}
              />
              <View style={s.quickLinkDivider} />
              <QuickLink
                icon="golf-outline"
                title="Round History"
                sub="All your past rounds & scores"
                onPress={() => router.push('/(app)/profile/rounds' as any)}
              />
              <View style={s.quickLinkDivider} />
              <QuickLink
                icon="trending-down-outline"
                title="Handicap Calculator"
                sub="Recalculate your index"
                onPress={() => router.push('/(app)/profile/handicap' as any)}
              />
              <View style={s.quickLinkDivider} />
              <QuickLink
                icon="wifi-outline"
                title="My Bag & NFC Tags"
                sub="Add, remove and reorder clubs"
                onPress={() => router.push('/(app)/profile/bag' as any)}
              />
            </View>

            {/* ── READ: Stats bar ── */}
            <View style={s.statsBar}>
              <View style={s.statsCol}>
                <Ionicons name="golf-outline" size={18} color={GOLD} />
                <Text style={s.statsColLabel}>IN THE BAG</Text>
                <Text style={s.statsColValue}>{clubs.length} clubs</Text>
              </View>
              <View style={s.statsColDivider} />
              <View style={s.statsCol}>
                <Ionicons name="trending-down-outline" size={18} color={GOLD} />
                <Text style={s.statsColLabel}>HANDICAP</Text>
                <Text style={s.statsColValue}>
                  {player?.handicap_index != null ? String(player.handicap_index) : '—'}
                </Text>
              </View>
              <View style={s.statsColDivider} />
              <View style={s.statsCol}>
                <Ionicons name="checkmark-circle-outline" size={18} color={cdhLinked ? GREEN : '#555'} />
                <Text style={s.statsColLabel}>CDH</Text>
                <Text style={s.statsColValue}>{cdhLinked ? 'Linked' : 'Not set'}</Text>
              </View>
            </View>

            {/* ── READ: Account ── */}
            <Text style={s.sectionLabel}>ACCOUNT</Text>
            <View style={s.quickLinks}>
              <QuickLink
                icon="key-outline"
                title="Change Password"
                sub="Update your login password"
                onPress={() => { setNewPw(''); setConfirmPw(''); setShowPwModal(true); }}
              />
              <View style={s.quickLinkDivider} />
              <QuickLink
                icon="swap-horizontal-outline"
                title="Switch Society"
                sub="Change your active golf society"
                onPress={() => router.push('/(app)/join' as any)}
              />
              <View style={s.quickLinkDivider} />
              <TouchableOpacity style={s.quickLink} onPress={signOut} activeOpacity={0.7}>
                <View style={s.quickLinkLeft}>
                  <View style={[s.quickLinkIcon, { backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)' }]}>
                    <Ionicons name="log-out-outline" size={18} color="#ef4444" />
                  </View>
                  <Text style={[s.quickLinkTitle, { color: '#ef4444' }]}>Sign Out</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#444" />
              </TouchableOpacity>
            </View>

            <Text style={s.version}>Titan Golf · v1.0</Text>
          </>
        )}
      </ScrollView>

      {/* ── Change Password Modal ── */}
      <Modal
        visible={showPwModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowPwModal(false)}
      >
        <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.header}>
            <TouchableOpacity onPress={() => setShowPwModal(false)} hitSlop={HIT} style={s.headerSide}>
              <Text style={s.cancelLink}>Cancel</Text>
            </TouchableOpacity>
            <View style={s.headerCenter}>
              <Text style={s.modalTitle}>Password</Text>
            </View>
            <TouchableOpacity
              onPress={changePassword}
              disabled={pwSaving}
              hitSlop={HIT}
              style={[s.headerSide, { alignItems: 'flex-end' }]}
            >
              <Text style={[s.editLink, pwSaving && { opacity: 0.4 }]}>{pwSaving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
            <Text style={[s.pageTitle, { fontSize: 28 }]}>Change Password</Text>
            <View style={s.card}>
              <EditField label="New Password"     value={newPw}     onChange={setNewPw}     placeholder="Min 6 characters" secureTextEntry autoFocus />
              <View style={s.divider} />
              <EditField label="Confirm Password" value={confirmPw} onChange={setConfirmPw} placeholder="Repeat new password" secureTextEntry />
            </View>
            <TouchableOpacity
              style={[s.saveBtn, pwSaving && { opacity: 0.5 }]}
              onPress={changePassword} disabled={pwSaving} activeOpacity={0.8}
            >
              {pwSaving ? <ActivityIndicator color="#000" /> : <Text style={s.saveBtnText}>Update Password</Text>}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ── Sub-components ─────────────────────────────────────────────
function QuickLink({ icon, title, sub, onPress }: {
  icon: any; title: string; sub: string; onPress: () => void;
}) {
  return (
    <TouchableOpacity style={s.quickLink} onPress={onPress} activeOpacity={0.75}>
      <View style={s.quickLinkLeft}>
        <View style={s.quickLinkIcon}>
          <Ionicons name={icon} size={18} color={GOLD} />
        </View>
        <View>
          <Text style={s.quickLinkTitle}>{title}</Text>
          <Text style={s.quickLinkSub}>{sub}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#444" />
    </TouchableOpacity>
  );
}

function EditField({ label, value, onChange, placeholder, keyboardType, autoFocus, secureTextEntry }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; keyboardType?: any; autoFocus?: boolean; secureTextEntry?: boolean;
}) {
  return (
    <View style={s.fieldRow}>
      <Text style={s.fieldLabel}>{label.toUpperCase()}</Text>
      <TextInput
        style={s.fieldInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#444"
        keyboardType={keyboardType}
        autoFocus={autoFocus}
        secureTextEntry={secureTextEntry}
        autoCapitalize="none"
      />
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#000000' },
  centered:{ flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll:  { paddingBottom: 60 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12,
    backgroundColor: '#000000',
  },
  headerSide:   { width: 60 },
  headerCenter: { alignItems: 'center' },
  headerLogo:   { width: 36, height: 36 },
  bellWrap:     { position: 'relative' },
  notifDot: {
    position: 'absolute', top: -1, right: -1,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: GOLD, borderWidth: 1.5, borderColor: '#000',
  },
  editLink:   { fontFamily: FFB, fontSize: 15, color: GOLD },
  cancelLink: { fontFamily: FFB, fontSize: 15, color: '#fff' },
  modalTitle: { fontFamily: FFB, fontSize: 17, color: '#ffffff' },

  pageTitle: {
    fontFamily: FFB, fontSize: 36, color: '#ffffff',
    paddingHorizontal: 20, paddingBottom: 20, letterSpacing: -0.5,
  },

  profileCard: {
    marginHorizontal: 16, backgroundColor: '#111111',
    borderRadius: 16, borderWidth: 1, borderColor: '#1c1c1c',
    flexDirection: 'row', alignItems: 'center',
    padding: 16, gap: 16, marginBottom: 28,
  },
  avatarWrap:        { position: 'relative' },
  avatarImg:         { width: 72, height: 72, borderRadius: 36 },
  avatarPlaceholder: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: `${GOLD}18`, alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontFamily: FFB, fontSize: 28, color: GOLD },
  avatarRing: {
    position: 'absolute', top: -2, left: -2,
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 1.5, borderColor: `${GOLD}50`,
  },
  avatarOverlay: {
    position: 'absolute', top: 0, left: 0, width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  profileInfo:  { flex: 1, gap: 6 },
  profileName:  { fontFamily: FFB, fontSize: 20, color: '#ffffff', letterSpacing: -0.3 },
  badgeRow:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eliteDot:     { width: 7, height: 7, borderRadius: 4, backgroundColor: GREEN },
  eliteText:    { fontFamily: FFB, fontSize: 12, color: GREEN },
  statsRow:     { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  statBox:      { flex: 1, gap: 2 },
  statDivider:  { width: 1, height: 28, backgroundColor: '#2c2c2c', marginHorizontal: 12 },
  statLabel:    { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 1.5 },
  statValue:    { fontFamily: FFB, fontSize: 14, color: '#ffffff' },

  sectionLabel: {
    fontFamily: FFB, fontSize: 10, color: '#fff', letterSpacing: 2,
    textTransform: 'uppercase', paddingHorizontal: 16, marginBottom: 8, marginTop: 4,
  },

  card: {
    marginHorizontal: 16, backgroundColor: '#111111',
    borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c',
    overflow: 'hidden', marginBottom: 12,
  },
  divider: { height: 1, backgroundColor: '#1c1c1c', marginHorizontal: 16 },

  bagHeader: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: 16, marginBottom: 10,
  },
  bagTitle:    { fontFamily: FFB, fontSize: 18, color: '#ffffff', marginBottom: 2 },
  bagSubtitle: { fontFamily: FFB, fontSize: 11, color: '#fff' },
  addClubBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: GOLD, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  addClubText: { fontFamily: FFB, fontSize: 12, color: GOLD },

  clubList: {
    marginHorizontal: 16, backgroundColor: '#111111',
    borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c',
    overflow: 'hidden', marginBottom: 20,
  },
  clubRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c', gap: 12,
  },
  clubRowLast:  { borderBottomWidth: 0 },
  clubIconWrap: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: `${GOLD}0d`, borderWidth: 1, borderColor: `${GOLD}25`,
    alignItems: 'center', justifyContent: 'center',
  },
  clubName:       { fontFamily: FFB, fontSize: 15, color: '#ffffff' },
  clubBrand:      { fontFamily: FFB, fontSize: 11, color: '#fff', marginTop: 1 },
  clubBrandEmpty: { fontFamily: FFB, fontSize: 11, color: '#333', marginTop: 1 },
  nfcBadge: {
    borderWidth: 1, borderColor: `${GOLD}60`, borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: `${GOLD}0d`, marginRight: 4,
  },
  nfcText: { fontFamily: FFB, fontSize: 10, color: GOLD, letterSpacing: 0.5 },
  emptyBag:     { paddingVertical: 32, alignItems: 'center' },
  emptyBagText: { fontFamily: FFB, fontSize: 14, color: '#fff' },
  emptyBagSub:  { fontFamily: FFB, fontSize: 12, color: '#444', marginTop: 4 },

  quickLinks: {
    marginHorizontal: 16, marginBottom: 16, backgroundColor: '#111111',
    borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden',
  },
  quickLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 14,
  },
  quickLinkLeft:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  quickLinkIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: `${GOLD}0d`, borderWidth: 1, borderColor: `${GOLD}25`,
    alignItems: 'center', justifyContent: 'center',
  },
  quickLinkTitle:   { fontFamily: FFB, fontSize: 14, color: '#ffffff', marginBottom: 2 },
  quickLinkSub:     { fontFamily: FFB, fontSize: 11, color: '#fff' },
  quickLinkDivider: { height: 1, backgroundColor: '#1c1c1c', marginHorizontal: 14 },

  statsBar: {
    marginHorizontal: 16, backgroundColor: '#111111',
    borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c',
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 18, marginBottom: 24,
  },
  statsCol:        { flex: 1, alignItems: 'center', gap: 4 },
  statsColDivider: { width: 1, height: 36, backgroundColor: '#1c1c1c' },
  statsColLabel:   { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 1.5, marginTop: 4 },
  statsColValue:   { fontFamily: FFB, fontSize: 12, color: '#ffffff' },

  fieldRow:   { paddingHorizontal: 16, paddingVertical: 12 },
  fieldLabel: { fontFamily: FFB, fontSize: 10, color: '#fff', letterSpacing: 1, marginBottom: 4 },
  fieldInput: { fontFamily: FFB, fontSize: 16, color: '#ffffff' },
  syncBtn: {
    marginHorizontal: 16, borderRadius: 12,
    borderWidth: 1, borderColor: `${GREEN}44`, backgroundColor: `${GREEN}0d`,
    paddingVertical: 12, alignItems: 'center', marginBottom: 20,
  },
  syncBtnText: { fontFamily: FFB, fontSize: 14, color: GREEN },
  saveBtn: {
    marginHorizontal: 16, backgroundColor: GOLD, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  saveBtnText: { fontFamily: FFB, fontSize: 16, color: '#000000' },
  version: {
    textAlign: 'center', fontFamily: FFB, fontSize: 11, color: '#2a2a2a', marginTop: 8, paddingBottom: 8,
  },
});
