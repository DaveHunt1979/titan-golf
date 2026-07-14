import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Share, Clipboard, Image,
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

export default function SocietyAdminScreen() {
  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const router = useRouter();
  const { societyId, loading: societyLoading } = useAdminSociety();
  const [societyName, setSocietyName] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [joinPin, setJoinPin]           = useState('');
  const [activeTournamentName, setActiveTournamentName] = useState('');
  const [activeTournamentPin, setActiveTournamentPin]   = useState('');
  const [casualCode, setCasualCode]   = useState('');
  const [tourCode, setTourCode]       = useState('');
  const [swindleCode, setSwindleCode] = useState('');
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [deleting, setDeleting]       = useState(false);

  useEffect(() => {
    if (societyLoading) return;
    if (!societyId) { setLoading(false); return; }
    (async () => {
      try {
        const [{ data }, { data: activeComp }] = await Promise.all([
          supabase.from('societies').select('name, instagram_url, join_pin, casual_join_code, tour_join_code, swindle_join_code').eq('id', societyId).single(),
          supabase.from('competitions').select('name, pin').eq('status', 'active').limit(1).single(),
        ]);
        if (data) {
          setSocietyName((data as any).name ?? '');
          setInstagramUrl((data as any).instagram_url ?? '');
          setJoinPin(String((data as any).join_pin ?? '').replace(/[^0-9]/g, ''));
          setCasualCode((data as any).casual_join_code ?? '');
          setTourCode((data as any).tour_join_code ?? '');
          setSwindleCode((data as any).swindle_join_code ?? '');
        }
        if (activeComp) {
          setActiveTournamentName((activeComp as any).name ?? '');
          setActiveTournamentPin(String((activeComp as any).pin ?? '').replace(/[^0-9]/g, ''));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [societyId, societyLoading]);

  async function deleteSociety() {
    Alert.alert(
      `Delete ${societyName}?`,
      'This will permanently remove all competitions, scores, and player memberships. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Society',
          style: 'destructive',
          onPress: () => Alert.alert(
            'Are you absolutely sure?',
            `Type of data that will be lost: all matches, all scores, all season data, all memberships. "${societyName}" will be gone forever.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Yes, delete everything',
                style: 'destructive',
                onPress: async () => {
                  setDeleting(true);
                  const { error } = await supabase.rpc('delete_society', { p_society_id: societyId });
                  setDeleting(false);
                  if (error) { Alert.alert('Error', error.message); return; }
                  await supabase.auth.signOut();
                  router.replace('/(auth)' as any);
                },
              },
            ],
          ),
        },
      ],
    );
  }

  async function generatePin() {
    const newPin = String(Math.floor(100000 + Math.random() * 900000));
    const { error } = await supabase
      .from('societies')
      .update({ join_pin: newPin } as any)
      .eq('id', societyId);
    if (error) { Alert.alert('Error', error.message); return; }
    setJoinPin(newPin);
  }

  async function sharePin() {
    const formatted = `${joinPin.slice(0, 3)} ${joinPin.slice(3)}`;
    try {
      await Share.share({ message: `Join ${societyName} on Titan Golf — your PIN is: ${formatted}` });
    } catch {
      Clipboard.setString(joinPin);
      Alert.alert('Copied', 'PIN copied to clipboard.');
    }
  }

  async function shareTournamentPin() {
    const formatted = activeTournamentPin.split('').join(' ');
    try {
      await Share.share({ message: `Join ${activeTournamentName} on Titan Golf — your tournament PIN is: ${formatted}` });
    } catch {
      Clipboard.setString(activeTournamentPin);
      Alert.alert('Copied', 'Tournament PIN copied to clipboard.');
    }
  }

  async function shareAreaCode(code: string, area: string) {
    const msg = `Join ${societyName} on Titan Golf — ${area} code: ${code}`;
    try {
      await Share.share({ message: msg });
    } catch {
      Clipboard.setString(code);
      Alert.alert('Copied', `${area} code copied to clipboard.`);
    }
  }

  async function save() {
    setSaving(true);
    const raw = instagramUrl.trim();
    let normalized = raw;
    if (raw && !raw.startsWith('http')) {
      const handle = raw.replace(/^@/, '');
      normalized = `https://www.instagram.com/${handle}/`;
    }

    const { error } = await supabase
      .from('societies')
      .update({ instagram_url: normalized || null } as any)
      .eq('id', societyId);

    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setInstagramUrl(normalized);
      Alert.alert('Saved', 'Society settings updated.');
    }
  }

  if (loading || societyLoading || !fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
      </View>
    );
  }

  if (!societyId) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar style="light" />
        <Text style={{ color: '#555', fontFamily: FF, fontSize: 14, textAlign: 'center', paddingHorizontal: 32 }}>
          No society found.{'\n'}Create one from the landing screen or contact your admin.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerSub}>ADMIN</Text>
        </View>
        <TouchableOpacity onPress={save} disabled={saving}>
          <Text style={[s.saveBtn, saving && { opacity: 0.4 }]}>
            {saving ? 'Saving…' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* SOCIETY */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>SOCIETY</Text>
          <View style={s.card}>
            <Text style={s.cardLabel}>Name</Text>
            <Text style={s.cardValue}>{societyName}</Text>
          </View>
          <View style={[s.card, { marginTop: 8 }]}>
            <Text style={s.cardLabel}>Player Join PIN</Text>
            {joinPin ? (
              <>
                <Text style={s.pinValue}>{joinPin.slice(0, 3)} {joinPin.slice(3)}</Text>
                <Text style={s.hint}>Share this PIN so new players can join your society</Text>
                <TouchableOpacity style={s.pinShareBtn} onPress={sharePin} activeOpacity={0.8}>
                  <Text style={s.pinShareBtnText}>Share PIN</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={[s.hint, { marginTop: 4 }]}>No join PIN generated yet</Text>
                <TouchableOpacity style={s.pinShareBtn} onPress={generatePin} activeOpacity={0.8}>
                  <Text style={s.pinShareBtnText}>Generate PIN</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* SOCIAL MEDIA */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>SOCIAL MEDIA</Text>
          <View style={s.card}>
            <Text style={s.cardLabel}>Instagram URL or Handle</Text>
            <TextInput
              style={s.input}
              value={instagramUrl}
              onChangeText={setInstagramUrl}
              placeholder="@yoursociety or full URL"
              placeholderTextColor="#444"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={s.hint}>
              Enter @handle or https://www.instagram.com/yoursociety
            </Text>
          </View>
        </View>

        {/* BRANDING */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>BRANDING</Text>
          <TouchableOpacity
            style={s.linkCard}
            onPress={() => router.push('/(app)/admin/branding' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.linkTitle}>Society Branding</Text>
              <Text style={s.linkSub}>Logo, name, tagline and colours</Text>
            </View>
            <Text style={s.arrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.linkCard, { marginTop: 8 }]}
            onPress={() => router.push('/(app)/admin/teams' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.linkTitle}>Manage Teams</Text>
              <Text style={s.linkSub}>Add teams, set crests and colours</Text>
            </View>
            <Text style={s.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* PLAYERS */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>PLAYERS</Text>
          <TouchableOpacity
            style={s.linkCard}
            onPress={() => router.push('/(app)/admin/players' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.linkTitle}>Manage Players</Text>
              <Text style={s.linkSub}>View roster, add players manually</Text>
            </View>
            <Text style={s.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* MEMBERSHIP AREAS */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>MEMBERSHIP AREAS</Text>
          {[
            { key: 'casual',  label: 'Casual Golf', icon: '🏌️', code: casualCode,  color: GREEN },
            { key: 'tour',    label: 'The Tour',    icon: '🏆', code: tourCode,    color: GOLD },
            { key: 'swindle', label: 'The Swindle', icon: '💰', code: swindleCode, color: '#a78bfa' },
          ].map((area, idx) => (
            <View key={area.key} style={[s.card, idx > 0 && { marginTop: 8 }]}>
              <Text style={[s.cardLabel, { color: area.color }]}>{area.icon}  {area.label.toUpperCase()}</Text>
              {area.code ? (
                <>
                  <Text style={[s.pinValue, { color: area.color, letterSpacing: 8 }]}>{area.code}</Text>
                  <Text style={s.hint}>Share this code for players joining {area.label}</Text>
                  <TouchableOpacity
                    style={[s.pinShareBtn, { borderColor: area.color + '55', backgroundColor: area.color + '15' }]}
                    onPress={() => shareAreaCode(area.code, area.label)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.pinShareBtnText, { color: area.color }]}>Share {area.label} Code</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <Text style={s.hint}>Code not generated — run membership_areas migration</Text>
              )}
            </View>
          ))}
          <TouchableOpacity
            style={[s.linkCard, { marginTop: 8 }]}
            onPress={() => router.push('/(app)/admin/membership' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.linkTitle}>Manage Player Access</Text>
              <Text style={s.linkSub}>Toggle Casual / Tour / Swindle per player</Text>
            </View>
            <Text style={s.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* ACTIVE TOURNAMENT */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>ACTIVE TOURNAMENT</Text>
          <View style={s.card}>
            {activeTournamentName ? (
              <>
                <Text style={s.cardLabel}>{activeTournamentName}</Text>
                <Text style={[s.cardLabel, { marginTop: 8 }]}>Tournament PIN</Text>
                {activeTournamentPin ? (
                  <>
                    <Text style={s.pinValue}>{activeTournamentPin.split('').join('  ')}</Text>
                    <Text style={s.hint}>Share this PIN so players can unlock the Tour tab</Text>
                    <TouchableOpacity style={s.pinShareBtn} onPress={shareTournamentPin} activeOpacity={0.8}>
                      <Text style={s.pinShareBtnText}>Share Tournament PIN</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <Text style={[s.hint, { marginTop: 4 }]}>No PIN — run add_competition_pin.sql migration</Text>
                )}
              </>
            ) : (
              <Text style={s.hint}>No active tournament running</Text>
            )}
          </View>
        </View>

        {/* COMPETITION TOOLS */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>COMPETITION TOOLS</Text>
          <TouchableOpacity
            style={s.linkCard}
            onPress={() => router.push('/(app)/admin/build' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.linkTitle}>Build a Tournament</Text>
              <Text style={s.linkSub}>Create a new season competition</Text>
            </View>
            <Text style={s.arrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.linkCard, { marginTop: 8 }]}
            onPress={() => router.push('/(app)/admin/tournaments' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.linkTitle}>Tournament History</Text>
              <Text style={s.linkSub}>All competitions, champions &amp; PINs</Text>
            </View>
            <Text style={s.arrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.linkCard, { marginTop: 8 }]}
            onPress={() => router.push('/(app)/admin/courses' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.linkTitle}>Manage Courses</Text>
              <Text style={s.linkSub}>Add courses and set hole par / stroke index</Text>
            </View>
            <Text style={s.arrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.linkCard, { marginTop: 8 }]}
            onPress={() => router.push('/(app)/admin/pins' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.linkTitle}>⛳ Green Pins</Text>
              <Text style={s.linkSub}>Set green locations for satellite rangefinder</Text>
            </View>
            <Text style={s.arrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.linkCard, { marginTop: 8 }]}
            onPress={() => router.push('/(app)/admin/info' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.linkTitle}>Edit Info Pack</Text>
              <Text style={s.linkSub}>Update the tour info board</Text>
            </View>
            <Text style={s.arrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.linkCard, { marginTop: 8, borderColor: GOLD + '55' }]}
            onPress={() => router.push('/(app)/records' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.linkTitle, { color: GOLD }]}>🏆 Wall of Records</Text>
              <Text style={s.linkSub}>All-time society bests</Text>
            </View>
            <Text style={s.arrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.linkCard, { marginTop: 8, borderColor: GOLD + '55' }]}
            onPress={() => router.push('/(app)/admin/transfers' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.linkTitle, { color: GOLD }]}>Transfer Window</Text>
              <Text style={s.linkSub}>Move players between teams or release them</Text>
            </View>
            <Text style={s.arrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.linkCard, { marginTop: 8, borderColor: '#a78bfa55' }]}
            onPress={() => router.push('/(app)/admin/swindle' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.linkTitle, { color: '#a78bfa' }]}>💰 Swindle Manager</Text>
              <Text style={s.linkSub}>Games, results & season money list</Text>
            </View>
            <Text style={s.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* PLATFORM */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>PLATFORM</Text>
          <TouchableOpacity
            style={s.linkCard}
            onPress={() => router.push('/(app)/admin/create-society' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.linkTitle}>Create New Society</Text>
              <Text style={s.linkSub}>Onboard a new golf club to Titan</Text>
            </View>
            <Text style={s.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* DESIGN */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>DESIGN</Text>
          {[
            { route: '/(app)/admin/concept',             label: '✦ Concept Preview',         sub: 'New premium home screen redesign — safe sandbox' },
            { route: '/(app)/admin/concept-locker',      label: '✦ Locker Room Preview',     sub: 'Premium Locker Room / profile concept — safe sandbox' },
            { route: '/(app)/admin/concept-casual',      label: '✦ Casual Round Preview',    sub: 'Single-screen game setup concept — safe sandbox' },
            { route: '/(app)/admin/concept-score',       label: '✦ Score Entry Preview',     sub: 'Premium live scoring with scrollable hole strip — safe sandbox' },
            { route: '/(app)/admin/concept-practice',    label: '✦ Driving Range Preview',   sub: 'Premium practice screen with bag distances — safe sandbox' },
            { route: '/(app)/admin/concept-rangefinder', label: '✦ Rangefinder Preview',     sub: 'Premium FCB overlay — Apple Maps sits behind in live app' },
            { route: '/(app)/admin/concept-swindle',     label: '✦ Swindle Lobby Preview',   sub: 'Premium game list with pot hero, I\'m In CTA — safe sandbox' },
            { route: '/(app)/admin/concept-swindle-game',label: '✦ Swindle Game Preview',    sub: 'Podium prizes, leaderboard, side pots — safe sandbox' },
          ].map((item, idx) => (
            <TouchableOpacity
              key={item.route}
              style={[s.linkCard, { borderColor: GOLD + '55', backgroundColor: GOLD + '0F' }, idx > 0 && { marginTop: 8 }]}
              onPress={() => router.push(item.route as any)}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={[s.linkTitle, { color: GOLD }]}>{item.label}</Text>
                <Text style={s.linkSub}>{item.sub}</Text>
              </View>
              <Text style={[s.arrow, { color: GOLD }]}>›</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Save Button */}
        <TouchableOpacity
          style={[s.saveButton, saving && { opacity: 0.5 }]}
          onPress={save}
          disabled={saving}
          activeOpacity={0.8}
        >
          <Text style={s.saveButtonText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
        </TouchableOpacity>

        {/* CHAT */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>CHAT</Text>
          <TouchableOpacity
            style={s.linkCard}
            onPress={() => Alert.alert(
              'Clear All Chat?',
              'This will delete all messages for everyone. Cannot be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Clear Chat', style: 'destructive',
                  onPress: async () => {
                    const { error } = await supabase.from('messages').delete().gte('created_at', '2000-01-01');
                    if (error) Alert.alert('Error', error.message);
                    else Alert.alert('Done', 'Chat cleared.');
                  },
                },
              ],
            )}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.linkTitle}>Clear All Messages</Text>
              <Text style={s.linkSub}>Delete the entire chat history</Text>
            </View>
            <Text style={[s.arrow, { color: RED }]}>›</Text>
          </TouchableOpacity>
        </View>

        {/* DANGER ZONE */}
        <View style={[s.section, { marginTop: 24 }]}>
          <Text style={[s.sectionLabel, { color: RED }]}>DANGER ZONE</Text>
          <TouchableOpacity
            style={s.deleteCard}
            onPress={deleteSociety}
            disabled={deleting}
            activeOpacity={0.8}
          >
            {deleting
              ? <ActivityIndicator color={RED} />
              : <>
                  <Text style={s.deleteTitle}>Delete Society</Text>
                  <Text style={s.deleteSub}>Permanently removes all data — cannot be undone</Text>
                </>
            }
          </TouchableOpacity>
        </View>
      </ScrollView>
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
  saveBtn:      { fontFamily: FFB, fontSize: 14, color: GOLD },

  scroll:  { padding: 20, paddingBottom: 60 },
  section: { marginBottom: 28 },

  sectionLabel: {
    fontFamily: FFB, fontSize: 10, color: '#555',
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10,
  },

  card: {
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c', padding: 16,
  },
  cardLabel: {
    fontFamily: FFB, fontSize: 10, color: '#555', letterSpacing: 1, marginBottom: 4,
    textTransform: 'uppercase',
  },
  cardValue: { fontFamily: FFB, fontSize: 16, color: '#fff' },

  input: {
    backgroundColor: '#111', borderRadius: 12,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingHorizontal: 16, paddingVertical: 12,
    fontFamily: FF, fontSize: 15, color: '#fff', marginTop: 10,
  },
  hint: { fontFamily: FF, fontSize: 12, color: '#555', marginTop: 6 },

  linkCard: {
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c', padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  linkTitle: { fontFamily: FFB, fontSize: 15, color: '#fff', marginBottom: 2 },
  linkSub:   { fontFamily: FF, fontSize: 12, color: '#555' },
  arrow:     { fontSize: 22, color: '#555' },

  saveButton: {
    backgroundColor: GOLD, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginBottom: 28,
  },
  saveButtonText: { fontFamily: FFB, fontSize: 16, color: '#000', letterSpacing: 0.5 },

  pinValue: { fontFamily: FFB, fontSize: 28, color: GOLD, letterSpacing: 6, marginTop: 4 },
  pinShareBtn: {
    marginTop: 10, backgroundColor: GOLD + '22',
    borderRadius: 10, paddingVertical: 10,
    alignItems: 'center', borderWidth: 1, borderColor: GOLD + '55',
  },
  pinShareBtnText: { fontFamily: FFB, fontSize: 14, color: GOLD },

  deleteCard: {
    backgroundColor: 'rgba(248,113,113,0.08)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)',
    padding: 16, alignItems: 'center',
  },
  deleteTitle: { fontFamily: FFB, fontSize: 16, color: RED },
  deleteSub:   { fontFamily: FF, fontSize: 12, color: RED, opacity: 0.7, marginTop: 4 },
});
