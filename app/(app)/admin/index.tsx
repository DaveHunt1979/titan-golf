import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Share, Clipboard,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { fonts, spacing, radius } from '../../../src/lib/theme';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';

export default function SocietyAdminScreen() {
  const colors = useDynamicColors();
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    centered: { alignItems: 'center', justifyContent: 'center' },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    back: { fontSize: fonts.sm, color: colors.gold, fontWeight: '600' },
    headerTitle: { fontSize: fonts.md, fontWeight: '800', color: colors.white, letterSpacing: 0.5 },
    saveBtn: { fontSize: fonts.sm, fontWeight: '700', color: colors.gold },
    scroll: { padding: spacing.lg, paddingBottom: 60 },
    section: { marginBottom: spacing.xl },
    sectionLabel: {
      fontSize: fonts.xs, fontWeight: '800', color: colors.textMuted,
      letterSpacing: 2, marginBottom: spacing.sm, textTransform: 'uppercase',
    },
    card: {
      backgroundColor: colors.card, borderRadius: radius.md,
      borderWidth: 1, borderColor: colors.border, padding: spacing.md,
    },
    cardLabel: {
      fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted,
      letterSpacing: 1, marginBottom: spacing.xs,
    },
    cardValue: { fontSize: fonts.md, fontWeight: '700', color: colors.white },
    input: {
      backgroundColor: colors.cardAlt, borderRadius: radius.sm,
      borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      fontSize: fonts.sm, color: colors.white, marginTop: spacing.sm,
    },
    hint: { fontSize: fonts.xs, color: colors.textMuted, marginTop: spacing.xs },
    linkCard: {
      backgroundColor: colors.card, borderRadius: radius.md,
      borderWidth: 1, borderColor: colors.border, padding: spacing.md,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    linkTitle: { fontSize: fonts.sm, fontWeight: '700', color: colors.white, marginBottom: 2 },
    linkSub: { fontSize: fonts.xs, color: colors.textMuted },
    arrow: { fontSize: 22, color: colors.textMuted },
    saveButton: {
      backgroundColor: colors.gold, borderRadius: radius.md,
      paddingVertical: spacing.md, alignItems: 'center', marginBottom: spacing.xl,
    },
    saveButtonText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg, letterSpacing: 0.5 },
    pinValue: { fontSize: 28, fontWeight: '800', color: colors.gold, letterSpacing: 6, marginTop: 4 },
    pinShareBtn: {
      marginTop: spacing.sm, backgroundColor: colors.goldDim,
      borderRadius: radius.sm, paddingVertical: spacing.sm,
      alignItems: 'center', borderWidth: 1, borderColor: colors.goldBorder,
    },
    pinShareBtnText: { fontSize: fonts.sm, fontWeight: '700', color: colors.gold },
    deleteCard: {
      backgroundColor: 'rgba(248,113,113,0.08)', borderRadius: radius.md,
      borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)',
      padding: spacing.md, alignItems: 'center',
    },
    deleteTitle: { fontSize: fonts.md, fontWeight: '800', color: colors.red },
    deleteSub:   { fontSize: fonts.xs, color: colors.red, opacity: 0.7, marginTop: 4 },
  }), [colors]);

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
          // Strip any decimal formatting (DB numeric type can return "105.326" instead of "105326")
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

  if (loading || societyLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  if (!societyId) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar style="light" />
        <Text style={{ color: colors.textMuted, fontSize: fonts.sm, textAlign: 'center', paddingHorizontal: spacing.xl }}>
          No society found.{'\n'}Create one from the landing screen or contact your admin.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Society Admin</Text>
        <TouchableOpacity onPress={save} disabled={saving}>
          <Text style={[styles.saveBtn, saving && { opacity: 0.4 }]}>
            {saving ? 'Saving…' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SOCIETY</Text>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Name</Text>
            <Text style={styles.cardValue}>{societyName}</Text>
          </View>
          <View style={[styles.card, { marginTop: spacing.sm }]}>
            <Text style={styles.cardLabel}>Player Join PIN</Text>
            {joinPin ? (
              <>
                <Text style={styles.pinValue}>{joinPin.slice(0, 3)} {joinPin.slice(3)}</Text>
                <Text style={styles.hint}>Share this PIN so new players can join your society</Text>
                <TouchableOpacity style={styles.pinShareBtn} onPress={sharePin} activeOpacity={0.8}>
                  <Text style={styles.pinShareBtnText}>Share PIN</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={[styles.hint, { marginTop: spacing.xs }]}>No join PIN generated yet</Text>
                <TouchableOpacity style={styles.pinShareBtn} onPress={generatePin} activeOpacity={0.8}>
                  <Text style={styles.pinShareBtnText}>Generate PIN</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SOCIAL MEDIA</Text>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Instagram URL or Handle</Text>
            <TextInput
              style={styles.input}
              value={instagramUrl}
              onChangeText={setInstagramUrl}
              placeholder="@yoursociety or full URL"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={styles.hint}>
              Enter @handle or https://www.instagram.com/yoursociety
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>BRANDING</Text>
          <TouchableOpacity
            style={styles.linkCard}
            onPress={() => router.push('/(app)/admin/branding' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Society Branding</Text>
              <Text style={styles.linkSub}>Logo, name, tagline and colours</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.linkCard, { marginTop: spacing.sm }]}
            onPress={() => router.push('/(app)/admin/teams' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Manage Teams</Text>
              <Text style={styles.linkSub}>Add teams, set crests and colours</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PLAYERS</Text>
          <TouchableOpacity
            style={styles.linkCard}
            onPress={() => router.push('/(app)/admin/players' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Manage Players</Text>
              <Text style={styles.linkSub}>View roster, add players manually</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>MEMBERSHIP AREAS</Text>
          {[
            { key: 'casual',  label: 'Casual Golf', icon: '🏌️', code: casualCode,  color: '#4ade80' },
            { key: 'tour',    label: 'The Tour',    icon: '🏆', code: tourCode,    color: '#D4AF37' },
            { key: 'swindle', label: 'The Swindle', icon: '💰', code: swindleCode, color: '#a78bfa' },
          ].map((area, idx) => (
            <View key={area.key} style={[styles.card, idx > 0 && { marginTop: spacing.sm }]}>
              <Text style={[styles.cardLabel, { color: area.color }]}>{area.icon}  {area.label.toUpperCase()}</Text>
              {area.code ? (
                <>
                  <Text style={[styles.pinValue, { color: area.color, letterSpacing: 8 }]}>{area.code}</Text>
                  <Text style={styles.hint}>Share this code for players joining {area.label}</Text>
                  <TouchableOpacity style={[styles.pinShareBtn, { borderColor: area.color + '55', backgroundColor: area.color + '15' }]} onPress={() => shareAreaCode(area.code, area.label)} activeOpacity={0.8}>
                    <Text style={[styles.pinShareBtnText, { color: area.color }]}>Share {area.label} Code</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <Text style={styles.hint}>Code not generated — run membership_areas migration</Text>
              )}
            </View>
          ))}
          <TouchableOpacity
            style={[styles.linkCard, { marginTop: spacing.sm }]}
            onPress={() => router.push('/(app)/admin/membership' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Manage Player Access</Text>
              <Text style={styles.linkSub}>Toggle Casual / Tour / Swindle per player</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ACTIVE TOURNAMENT</Text>
          <View style={styles.card}>
            {activeTournamentName ? (
              <>
                <Text style={styles.cardLabel}>{activeTournamentName}</Text>
                <Text style={[styles.cardLabel, { marginTop: spacing.sm }]}>Tournament PIN</Text>
                {activeTournamentPin ? (
                  <>
                    <Text style={styles.pinValue}>{activeTournamentPin.split('').join('  ')}</Text>
                    <Text style={styles.hint}>Share this PIN so players can unlock the Tour tab</Text>
                    <TouchableOpacity style={styles.pinShareBtn} onPress={shareTournamentPin} activeOpacity={0.8}>
                      <Text style={styles.pinShareBtnText}>Share Tournament PIN</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <Text style={[styles.hint, { marginTop: spacing.xs }]}>No PIN — run add_competition_pin.sql migration</Text>
                )}
              </>
            ) : (
              <Text style={styles.hint}>No active tournament running</Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>COMPETITION TOOLS</Text>
          <TouchableOpacity
            style={styles.linkCard}
            onPress={() => router.push('/(app)/admin/build' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Build a Tournament</Text>
              <Text style={styles.linkSub}>Create a new season competition</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.linkCard, { marginTop: spacing.sm }]}
            onPress={() => router.push('/(app)/admin/tournaments' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Tournament History</Text>
              <Text style={styles.linkSub}>All competitions, champions &amp; PINs</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.linkCard, { marginTop: spacing.sm }]}
            onPress={() => router.push('/(app)/admin/courses' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Manage Courses</Text>
              <Text style={styles.linkSub}>Add courses and set hole par / stroke index</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.linkCard, { marginTop: spacing.sm }]}
            onPress={() => router.push('/(app)/admin/pins' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>⛳ Green Pins</Text>
              <Text style={styles.linkSub}>Set green locations for satellite rangefinder</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.linkCard, { marginTop: spacing.sm }]}
            onPress={() => router.push('/(app)/admin/info' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Edit Info Pack</Text>
              <Text style={styles.linkSub}>Update the tour info board</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.linkCard, { marginTop: spacing.sm, borderColor: colors.goldBorder }]}
            onPress={() => router.push('/(app)/records' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.linkTitle, { color: colors.gold }]}>🏆 Wall of Records</Text>
              <Text style={styles.linkSub}>All-time society bests</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.linkCard, { marginTop: spacing.sm, borderColor: colors.goldBorder }]}
            onPress={() => router.push('/(app)/admin/transfers' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.linkTitle, { color: colors.gold }]}>Transfer Window</Text>
              <Text style={styles.linkSub}>Move players between teams or release them</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.linkCard, { marginTop: spacing.sm, borderColor: '#a78bfa55' }]}
            onPress={() => router.push('/(app)/admin/swindle' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.linkTitle, { color: '#a78bfa' }]}>💰 Swindle Manager</Text>
              <Text style={styles.linkSub}>Games, results & season money list</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PLATFORM</Text>
          <TouchableOpacity
            style={styles.linkCard}
            onPress={() => router.push('/(app)/admin/create-society' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Create New Society</Text>
              <Text style={styles.linkSub}>Onboard a new golf club to Titan</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>DESIGN</Text>
          <TouchableOpacity
            style={[styles.linkCard, { borderColor: 'rgba(212,175,55,0.5)', backgroundColor: 'rgba(212,175,55,0.06)' }]}
            onPress={() => router.push('/(app)/admin/concept' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.linkTitle, { color: colors.gold }]}>✦ Concept Preview</Text>
              <Text style={styles.linkSub}>New premium home screen redesign — safe sandbox</Text>
            </View>
            <Text style={[styles.arrow, { color: colors.gold }]}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.linkCard, { borderColor: 'rgba(212,175,55,0.5)', backgroundColor: 'rgba(212,175,55,0.06)', marginTop: 8 }]}
            onPress={() => router.push('/(app)/admin/concept-locker' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.linkTitle, { color: colors.gold }]}>✦ Locker Room Preview</Text>
              <Text style={styles.linkSub}>Premium Locker Room / profile concept — safe sandbox</Text>
            </View>
            <Text style={[styles.arrow, { color: colors.gold }]}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.linkCard, { borderColor: 'rgba(212,175,55,0.5)', backgroundColor: 'rgba(212,175,55,0.06)', marginTop: 8 }]}
            onPress={() => router.push('/(app)/admin/concept-casual' as any)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.linkTitle, { color: colors.gold }]}>✦ Casual Round Preview</Text>
              <Text style={styles.linkSub}>Single-screen game setup concept — safe sandbox</Text>
            </View>
            <Text style={[styles.arrow, { color: colors.gold }]}>›</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.saveButton, saving && { opacity: 0.5 }]}
          onPress={save}
          disabled={saving}
          activeOpacity={0.8}
        >
          <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
        </TouchableOpacity>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>CHAT</Text>
          <TouchableOpacity
            style={styles.linkCard}
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
              <Text style={styles.linkTitle}>Clear All Messages</Text>
              <Text style={styles.linkSub}>Delete the entire chat history</Text>
            </View>
            <Text style={[styles.arrow, { color: colors.red }]}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.section, { marginTop: spacing.xl }]}>
          <Text style={[styles.sectionLabel, { color: colors.red }]}>DANGER ZONE</Text>
          <TouchableOpacity
            style={styles.deleteCard}
            onPress={deleteSociety}
            disabled={deleting}
            activeOpacity={0.8}
          >
            {deleting
              ? <ActivityIndicator color={colors.red} />
              : <>
                  <Text style={styles.deleteTitle}>Delete Society</Text>
                  <Text style={styles.deleteSub}>Permanently removes all data — cannot be undone</Text>
                </>
            }
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
