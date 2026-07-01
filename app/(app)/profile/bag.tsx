import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { fonts, spacing, radius } from '../../../src/lib/theme';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { scanNfcTagId, isNfcSupported, formatTagId } from '../../../src/lib/nfc';

const DEFAULT_CLUBS = [
  { name: 'Driver',         short_name: 'D',   category: 'wood',   sort_order: 1  },
  { name: '3 Wood',         short_name: '3w',  category: 'wood',   sort_order: 2  },
  { name: '5 Wood',         short_name: '5w',  category: 'wood',   sort_order: 3  },
  { name: '3 Hybrid',       short_name: '3h',  category: 'hybrid', sort_order: 4  },
  { name: '4 Iron',         short_name: '4i',  category: 'iron',   sort_order: 5  },
  { name: '5 Iron',         short_name: '5i',  category: 'iron',   sort_order: 6  },
  { name: '6 Iron',         short_name: '6i',  category: 'iron',   sort_order: 7  },
  { name: '7 Iron',         short_name: '7i',  category: 'iron',   sort_order: 8  },
  { name: '8 Iron',         short_name: '8i',  category: 'iron',   sort_order: 9  },
  { name: '9 Iron',         short_name: '9i',  category: 'iron',   sort_order: 10 },
  { name: 'Pitching Wedge', short_name: 'PW',  category: 'wedge',  sort_order: 11 },
  { name: 'Gap Wedge',      short_name: 'GW',  category: 'wedge',  sort_order: 12 },
  { name: 'Sand Wedge',     short_name: 'SW',  category: 'wedge',  sort_order: 13 },
  { name: 'Lob Wedge',      short_name: 'LW',  category: 'wedge',  sort_order: 14 },
  { name: 'Putter',         short_name: 'P',   category: 'putter', sort_order: 15 },
];

const CATEGORY_ICONS: Record<string, string> = {
  wood: '🪵', hybrid: '🔀', iron: '⛳', wedge: '🏖️', putter: '🎯',
};

type Club = {
  id: string;
  name: string;
  short_name: string;
  category: string;
  nfc_tag_id: string | null;
  in_bag: boolean;
  sort_order: number;
};

export default function BagScreen() {
  const router  = useRouter();
  const colors  = useDynamicColors();
  const styles  = useMemo(() => makeStyles(colors), [colors]);

  const [clubs,      setClubs]      = useState<Club[]>([]);
  const [playerId,   setPlayerId]   = useState<string | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [scanning,   setScanning]   = useState<string | null>(null); // club id being scanned
  const [nfcAvail,   setNfcAvail]   = useState(false);

  useEffect(() => {
    (async () => {
      const supported = await isNfcSupported();
      setNfcAvail(supported);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data: player } = await supabase
        .from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (!player) { setLoading(false); return; }

      setPlayerId((player as any).id);

      let { data: existing } = await supabase
        .from('clubs').select('*')
        .eq('player_id', (player as any).id)
        .order('sort_order');

      if (!existing || existing.length === 0) {
        // Seed the default bag
        const rows = DEFAULT_CLUBS.map(c => ({ ...c, player_id: (player as any).id, in_bag: true }));
        const { data: seeded } = await supabase.from('clubs').insert(rows).select();
        existing = seeded;
      }

      setClubs((existing ?? []) as Club[]);
      setLoading(false);
    })();
  }, []);

  async function toggleInBag(club: Club) {
    const updated = !club.in_bag;
    setClubs(prev => prev.map(c => c.id === club.id ? { ...c, in_bag: updated } : c));
    await supabase.from('clubs').update({ in_bag: updated }).eq('id', club.id);
  }

  async function assignNfc(club: Club) {
    if (!nfcAvail) {
      Alert.alert('NFC Not Available', 'NFC requires a physical device and a development build. It cannot be tested in the simulator.');
      return;
    }
    setScanning(club.id);
    const tagId = await scanNfcTagId();
    setScanning(null);

    if (!tagId) {
      Alert.alert('No Tag Detected', 'Make sure the sticker is directly behind your phone and try again.');
      return;
    }

    // Check if this tag is already assigned to another club
    const conflict = clubs.find(c => c.nfc_tag_id === tagId && c.id !== club.id);
    if (conflict) {
      Alert.alert('Tag Already Used', `This sticker is assigned to ${conflict.name}. Remove it there first.`);
      return;
    }

    const { error } = await supabase
      .from('clubs').update({ nfc_tag_id: tagId }).eq('id', club.id);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setClubs(prev => prev.map(c => c.id === club.id ? { ...c, nfc_tag_id: tagId } : c));
    Alert.alert('Sticker Linked ✓', `${club.name} → ${formatTagId(tagId)}`);
  }

  async function removeNfc(club: Club) {
    Alert.alert('Remove Sticker?', `Unlink the NFC sticker from ${club.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          await supabase.from('clubs').update({ nfc_tag_id: null }).eq('id', club.id);
          setClubs(prev => prev.map(c => c.id === club.id ? { ...c, nfc_tag_id: null } : c));
        },
      },
    ]);
  }

  const tagged   = clubs.filter(c => c.nfc_tag_id);
  const inBag    = clubs.filter(c => c.in_bag);
  const byCategory = clubs.reduce<Record<string, Club[]>>((acc, c) => {
    (acc[c.category] ??= []).push(c);
    return acc;
  }, {});

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={hit}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>My Bag & NFC Tags</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Summary pills */}
        <View style={styles.pills}>
          <View style={[styles.pill, { borderColor: colors.gold }]}>
            <Text style={[styles.pillNum, { color: colors.gold }]}>{inBag.length}</Text>
            <Text style={styles.pillLabel}>In Bag</Text>
          </View>
          <View style={[styles.pill, { borderColor: tagged.length > 0 ? colors.green : colors.border }]}>
            <Text style={[styles.pillNum, { color: tagged.length > 0 ? colors.green : colors.textMuted }]}>{tagged.length}</Text>
            <Text style={styles.pillLabel}>NFC Tagged</Text>
          </View>
        </View>

        {!nfcAvail && (
          <View style={styles.nfcWarning}>
            <Text style={styles.nfcWarningText}>
              📡 NFC tag assignment requires a physical iPhone — not available in the simulator.
              You can still configure your bag and assign tags on-device.
            </Text>
          </View>
        )}

        {(['wood', 'hybrid', 'iron', 'wedge', 'putter'] as const).map(cat => {
          const group = byCategory[cat];
          if (!group?.length) return null;
          return (
            <View key={cat} style={styles.section}>
              <Text style={styles.sectionLabel}>
                {CATEGORY_ICONS[cat]}  {cat.toUpperCase()}S
              </Text>
              {group.map(club => (
                <View key={club.id} style={[styles.clubRow, !club.in_bag && styles.clubRowDim]}>
                  <TouchableOpacity
                    style={[styles.bagToggle, club.in_bag && { backgroundColor: colors.gold }]}
                    onPress={() => toggleInBag(club)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.bagToggleText, club.in_bag && { color: colors.bg }]}>
                      {club.short_name}
                    </Text>
                  </TouchableOpacity>

                  <View style={styles.clubInfo}>
                    <Text style={[styles.clubName, !club.in_bag && { color: colors.textMuted }]}>
                      {club.name}
                    </Text>
                    {club.nfc_tag_id ? (
                      <Text style={styles.tagId}>📡 {formatTagId(club.nfc_tag_id)}</Text>
                    ) : (
                      <Text style={styles.noTag}>No sticker assigned</Text>
                    )}
                  </View>

                  {scanning === club.id ? (
                    <View style={styles.scanningPill}>
                      <ActivityIndicator size="small" color={colors.green} />
                      <Text style={styles.scanningText}>Scanning…</Text>
                    </View>
                  ) : club.nfc_tag_id ? (
                    <TouchableOpacity
                      style={styles.removeBtn}
                      onPress={() => removeNfc(club)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.removeBtnText}>✕</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.assignBtn, !nfcAvail && styles.assignBtnDim]}
                      onPress={() => assignNfc(club)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.assignBtnText}>Assign</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          );
        })}

        <Text style={styles.footer}>
          Tap a club label to add/remove it from your active bag.{'\n'}
          Tap Assign then hold your phone to the sticker on that club.
        </Text>
      </ScrollView>
    </View>
  );
}

const hit = { top: 12, bottom: 12, left: 12, right: 12 };

function makeStyles(c: ReturnType<typeof useDynamicColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    centered:  { alignItems: 'center', justifyContent: 'center' },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    back:  { fontSize: fonts.sm, color: c.gold, fontWeight: '600', width: 48 },
    title: { fontSize: fonts.md, fontWeight: '800', color: c.white, letterSpacing: 0.5 },
    scroll: { padding: spacing.md, paddingBottom: 60 },

    pills: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
    pill: {
      flex: 1, borderWidth: 1, borderRadius: radius.md, padding: spacing.md,
      alignItems: 'center',
    },
    pillNum:   { fontSize: fonts.xxl, fontWeight: '800' },
    pillLabel: { fontSize: fonts.xs, color: c.textMuted, marginTop: 2 },

    nfcWarning: {
      backgroundColor: c.card, borderRadius: radius.md, padding: spacing.md,
      borderWidth: 1, borderColor: c.border, marginBottom: spacing.lg,
    },
    nfcWarningText: { fontSize: fonts.xs, color: c.textSecondary, lineHeight: 17 },

    section:      { marginBottom: spacing.lg },
    sectionLabel: {
      fontSize: fonts.xs, fontWeight: '800', color: c.textMuted,
      letterSpacing: 2, marginBottom: spacing.sm,
    },

    clubRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: c.card, borderRadius: radius.md, padding: spacing.sm,
      borderWidth: 1, borderColor: c.border, marginBottom: spacing.xs,
    },
    clubRowDim: { opacity: 0.5 },

    bagToggle: {
      width: 40, height: 40, borderRadius: 20,
      borderWidth: 1.5, borderColor: c.gold,
      alignItems: 'center', justifyContent: 'center',
    },
    bagToggleText: { fontSize: fonts.xs, fontWeight: '800', color: c.gold },

    clubInfo:  { flex: 1 },
    clubName:  { fontSize: fonts.sm, fontWeight: '700', color: c.white, marginBottom: 2 },
    tagId:     { fontSize: 10, color: c.green, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
    noTag:     { fontSize: 10, color: c.textMuted },

    scanningPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm },
    scanningText: { fontSize: fonts.xs, color: c.green },

    assignBtn:    { backgroundColor: c.goldDim, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: c.goldBorder },
    assignBtnDim: { opacity: 0.4 },
    assignBtnText:{ fontSize: fonts.xs, fontWeight: '700', color: c.gold },

    removeBtn:    { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(248,113,113,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)' },
    removeBtnText:{ fontSize: fonts.xs, fontWeight: '800', color: c.red },

    footer: { fontSize: fonts.xs, color: c.textMuted, textAlign: 'center', lineHeight: 18, marginTop: spacing.md },
  });
}
