import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Platform, Modal, FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { scanNfcTagId, isNfcSupported, formatTagId } from '../../../src/lib/nfc';

// ── Brand & Model Data ───────────────────────────────────────────────────────

const CLUB_BRANDS = [
  'Benross', 'Callaway', 'Cleveland', 'Cobra', 'Honma',
  'Lynx', 'Miura', 'Mizuno', 'Ping', 'PXG',
  'Srixon', 'TaylorMade', 'Titleist', 'Tour Edge', 'Wilson',
  'Yonex', 'Other',
];

const BRAND_MODELS: Record<string, string[]> = {
  Benross: [
    'HTX Compressor', 'HTX Carbon', 'HTX Turbo', 'Power Play',
    'Evolution', 'VX3 Forged', 'Tech 37',
  ],
  Callaway: [
    'Paradym Ai Smoke', 'Paradym Ai Smoke Max', 'Paradym Ai Smoke Triple Diamond',
    'Paradym', 'Paradym X', 'Paradym Triple Diamond',
    'Rogue ST Max', 'Rogue ST Max D', 'Rogue ST Max LS', 'Rogue ST Max OS',
    'Big Bertha', 'Big Bertha B21',
    'Apex', 'Apex Pro', 'Apex CB', 'Apex MB', 'Apex DCB',
    'Jaws Raw', 'Jaws MD5', 'Opus Wedge', 'Ai Smoke Wedge',
    'Ai Smoke Putter',
  ],
  Cleveland: [
    'Launcher XL2', 'Launcher HB Turbo 2', 'Launcher XL Halo',
    'ZipCore XL', 'CBX4', 'CBX ZipCore',
    'RTX 6 ZipCore', 'RTX ZipCore', 'Smart Sole Full Face 4',
    'Frontline Cero', 'HB Soft Milled',
  ],
  Cobra: [
    'Darkspeed', 'Darkspeed Max', 'Darkspeed LS', 'Darkspeed X',
    'Darkspeed Max D', 'Aerojet', 'Aerojet Max', 'Aerojet LS',
    'King Tour MIM', 'King Forged Tec', 'King Forged Tec X', 'King CB',
    'King Oversized', 'Snakebite',
    'King Cobra Vintage',
  ],
  Honma: [
    'BERES BE-08', 'BERES 09', 'BERES S08',
    'TR20 V', 'TR20 P', 'TR20 B', 'TR20 X',
    'T//World GS', 'T//World XP-1', 'T//World B',
    'T//World GS Utility',
  ],
  Lynx: [
    'Predator Driver', 'Predator 3 Wood', 'Predator Irons',
    'Black Cat', 'Ai Driver', 'Ai Irons',
    'Tigress', 'Prowler',
  ],
  Miura: [
    'CB-301 Irons', 'CB-302 Irons', 'TC-201 Irons',
    'IC-601 Irons', 'Baby Blades', 'PP-9002 Putter',
    '0-Grind Wedge', 'K-Grind Wedge', 'K-Grind 2.0',
  ],
  Mizuno: [
    'ST-Max 230', 'ST-Z 230', 'ST-Max 235', 'ST-G 220',
    'JPX923 Hot Metal', 'JPX923 Hot Metal Pro', 'JPX923 Forged', 'JPX923 Tour',
    'JPX925 Hot Metal', 'JPX925 Forged', 'JPX925 Tour',
    'MP-20 MB', 'MP-20 HMB', 'Pro 241',
    'T24 Wedge', 'T22 Wedge', 'S23 Wedge',
    'M-Craft OMOI', 'M-Craft II',
  ],
  Ping: [
    'G430 Max', 'G430 LST', 'G430 SFT', 'G430 Max 10K',
    'G425 Max', 'G425 LST', 'G425 SFT',
    'Blueprint T', 'Blueprint S', 'i530', 'i525', 'i59', 'G430 HL',
    'G430 Crossover', 'ChipR',
    'Glide 4.0', 'Glide 4.0 SS', 'Glide 4.0 ES',
    'Scottsdale TR', 'Anser', 'DS72', 'Kushin 4',
  ],
  PXG: [
    '0811 XF Gen6', '0811 X Gen6', '0811+ Gen4', '0811 XT Gen4',
    '0311 XP Gen6', '0311 P Gen6', '0311 T Gen6', '0311 ST Gen6',
    '0317 X Gen4', '0211 Irons', '0702 Forged',
    '0211 Crossover', '0317 Hybrid',
    'Darkness Wedge', '0311 Sugar Daddy II',
    'Battle Ready II Putter', '0211 Putter',
  ],
  Srixon: [
    'ZX5 Mk II', 'ZX7 Mk II', 'ZX5 LS Mk II', 'ZXi-5', 'ZXi-7', 'ZXi-LS',
    'ZX4 Mk II Iron', 'ZX5 Mk II Iron', 'ZX7 Mk II Iron',
    'ZXi-7 Iron', 'ZXi-5 Iron',
    'U85 Utility Iron', 'U65 Utility Iron',
    'W503 Wedge', 'Z785 Wedge',
    'Tri-Hot 5K Putter',
  ],
  TaylorMade: [
    'Qi10', 'Qi10 LS', 'Qi10 Max', 'Qi10 Tour', 'BRNR Mini',
    'Stealth 2', 'Stealth 2 HD', 'Stealth 2 Plus',
    'P790', 'P770', 'P7MC', 'P7MB', 'P7TW',
    'Sim2 Max', 'Sim2 Max OS', 'Sim2', 'Sim2 Ti',
    'P·DHY Driving Iron', 'GAPR MID',
    'Milled Grind 4', 'MG4 TW', 'Hi-Toe Raw', 'Hi-Toe 3',
    'Spider GT Max', 'Spider EX', 'Spider Tour', 'TP Hydro Blast',
    'Truss TM1',
  ],
  Titleist: [
    'GT2', 'GT3', 'GT4', 'GT2 Irons',
    'TSR2', 'TSR3', 'TSR4',
    'T100', 'T100·S', 'T150', 'T200', 'T350',
    'DCI Black', '690 MB', '710 CB',
    'Vokey SM10', 'Vokey SM9', 'Vokey SM8', 'Vokey WedgeWorks',
    'Scotty Cameron Phantom', 'Scotty Cameron Special Select',
    'Scotty Cameron Super Select', 'Scotty Cameron Newport',
    'Scotty Cameron Futura',
  ],
  'Tour Edge': [
    'Exotics C723', 'Exotics E723', 'Exotics 723 Forged',
    'Hot Launch E523', 'Hot Launch C523', 'Hot Launch E521',
    'Exotics EXS Pro', 'Exotics EXS 220', 'Exotics C722',
  ],
  Wilson: [
    'Dynapower Carbon', 'Dynapower Titanium', 'Dynapower Forged',
    'D9 Forged', 'D9', 'D9 HL',
    'Staff Model Blade', 'Staff Model CB', 'Staff Model R',
    'Staff Model Utility', 'Infinite Putter',
    'Harmonized Wedge', 'Staff Wedge',
  ],
  Yonex: [
    'Ezone GS Driver', 'Ezone GS Wood', 'Ezone GS Iron',
    'Royal Ezone Driver', 'Royal Ezone Iron',
    'Ezone Elite 4.0', 'Ezone LS',
  ],
  Other: ['Custom / No Model'],
};

// ── Default club list ────────────────────────────────────────────────────────

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

// ── Types ────────────────────────────────────────────────────────────────────

type Club = {
  id: string;
  name: string;
  short_name: string;
  category: string;
  nfc_tag_id: string | null;
  in_bag: boolean;
  sort_order: number;
  brand: string | null;
  model: string | null;
};

type BrandPickerState = { club: Club; step: 'brand' | 'model'; brand?: string };

// ── Screen ───────────────────────────────────────────────────────────────────

export default function BagScreen() {
  const router  = useRouter();
  const colors  = useDynamicColors();
  const styles  = useMemo(() => makeStyles(colors), [colors]);
  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [clubs,       setClubs]       = useState<Club[]>([]);
  const [playerId,    setPlayerId]    = useState<string | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [scanning,    setScanning]    = useState<string | null>(null);
  const [nfcAvail,    setNfcAvail]    = useState(false);
  const [brandPicker, setBrandPicker] = useState<BrandPickerState | null>(null);

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

    const conflict = clubs.find(c => c.nfc_tag_id === tagId && c.id !== club.id);
    if (conflict) {
      Alert.alert('Tag Already Used', `This sticker is assigned to ${conflict.name}. Remove it there first.`);
      return;
    }

    const { error } = await supabase
      .from('clubs').update({ nfc_tag_id: tagId }).eq('id', club.id);
    if (error) { Alert.alert('Error', error.message); return; }
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

  async function pickBrand(brand: string) {
    if (!brandPicker) return;
    const models = BRAND_MODELS[brand] ?? [];
    if (models.length === 0) {
      await saveBrandModel(brandPicker.club, brand, null);
    } else {
      setBrandPicker({ ...brandPicker, step: 'model', brand });
    }
  }

  async function pickModel(model: string) {
    if (!brandPicker?.brand) return;
    await saveBrandModel(brandPicker.club, brandPicker.brand, model);
  }

  async function saveBrandModel(club: Club, brand: string, model: string | null) {
    setBrandPicker(null);
    setClubs(prev => prev.map(c => c.id === club.id ? { ...c, brand, model } : c));
    await supabase.from('clubs').update({ brand, model }).eq('id', club.id);
  }

  const tagged     = clubs.filter(c => c.nfc_tag_id);
  const inBag      = clubs.filter(c => c.in_bag);
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

                  <TouchableOpacity
                    style={styles.clubInfo}
                    onPress={() => setBrandPicker({ club, step: 'brand' })}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.clubName, !club.in_bag && { color: colors.textMuted }]}>
                      {club.name}
                    </Text>
                    {club.brand ? (
                      <Text style={styles.brandLabel}>
                        {club.brand}{club.model ? ` · ${club.model}` : ''}
                      </Text>
                    ) : (
                      <Text style={styles.setBrandLabel}>Tap to set brand</Text>
                    )}
                    {club.nfc_tag_id ? (
                      <Text style={styles.tagId}>📡 {formatTagId(club.nfc_tag_id)}</Text>
                    ) : null}
                  </TouchableOpacity>

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
          Tap the club name to set brand &amp; model.{'\n'}
          Tap Assign then hold your phone to the sticker on that club.
        </Text>
      </ScrollView>

      {/* Brand / Model picker modal */}
      <Modal
        visible={brandPicker !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setBrandPicker(null)}
      >
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            {brandPicker?.step === 'model' ? (
              <TouchableOpacity onPress={() => setBrandPicker(bp => bp ? { ...bp, step: 'brand' } : null)}>
                <Text style={styles.modalBack}>‹ Brands</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 64 }} />
            )}
            <Text style={styles.modalTitle}>
              {brandPicker?.step === 'brand' ? 'Select Brand' : brandPicker?.brand ?? 'Select Model'}
            </Text>
            <TouchableOpacity onPress={() => setBrandPicker(null)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>

          {brandPicker?.step === 'brand' ? (
            <FlatList
              data={CLUB_BRANDS}
              keyExtractor={b => b}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.pickerRow} onPress={() => pickBrand(item)} activeOpacity={0.7}>
                  <Text style={styles.pickerRowText}>{item}</Text>
                  <Text style={styles.pickerChevron}>›</Text>
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              contentContainerStyle={{ paddingBottom: 40 }}
            />
          ) : (
            <FlatList
              data={BRAND_MODELS[brandPicker?.brand ?? ''] ?? []}
              keyExtractor={m => m}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.pickerRow} onPress={() => pickModel(item)} activeOpacity={0.7}>
                  <Text style={styles.pickerRowText}>{item}</Text>
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              contentContainerStyle={{ paddingBottom: 40 }}
            />
          )}
        </View>
      </Modal>
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
      paddingTop: 60, paddingHorizontal: 24, paddingBottom: 16,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    back:  { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: c.gold, width: 48 },
    title: { fontSize: 15, fontFamily: 'JUSTSans-ExBold', color: c.white, letterSpacing: 0.5 },
    scroll: { padding: 16, paddingBottom: 60 },

    pills: { flexDirection: 'row', gap: 16, marginBottom: 24 },
    pill: {
      flex: 1, borderWidth: 1, borderRadius: 12, padding: 16,
      alignItems: 'center',
    },
    pillNum:   { fontSize: 28, fontFamily: 'JUSTSans-ExBold' },
    pillLabel: { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: c.textMuted, marginTop: 2 },

    nfcWarning: {
      backgroundColor: c.card, borderRadius: 12, padding: 16,
      borderWidth: 1, borderColor: c.border, marginBottom: 24,
    },
    nfcWarningText: { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: c.textSecondary, lineHeight: 17 },

    section:      { marginBottom: 24 },
    sectionLabel: {
      fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: c.textMuted,
      letterSpacing: 2, marginBottom: 8,
    },

    clubRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.card, borderRadius: 12, padding: 8,
      borderWidth: 1, borderColor: c.border, marginBottom: 4,
    },
    clubRowDim: { opacity: 0.5 },

    bagToggle: {
      width: 40, height: 40, borderRadius: 20,
      borderWidth: 1.5, borderColor: c.gold,
      alignItems: 'center', justifyContent: 'center',
    },
    bagToggleText: { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: c.gold },

    clubInfo:       { flex: 1 },
    clubName:       { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: c.white, marginBottom: 1 },
    brandLabel:     { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: c.gold, marginBottom: 1 },
    setBrandLabel:  { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: c.textMuted, fontStyle: 'italic', marginBottom: 1 },
    tagId:          { fontSize: 10, color: c.green, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', marginTop: 1 },

    scanningPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 },
    scanningText: { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: c.green },

    assignBtn:    { backgroundColor: c.goldDim, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 8, borderWidth: 1, borderColor: c.goldBorder },
    assignBtnDim: { opacity: 0.4 },
    assignBtnText:{ fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: c.gold },

    removeBtn:    { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(248,113,113,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)' },
    removeBtnText:{ fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: c.red },

    footer: { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: c.textMuted, textAlign: 'center', lineHeight: 18, marginTop: 16 },

    // Modal
    modal: { flex: 1, backgroundColor: c.bg },
    modalHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingTop: 20, paddingHorizontal: 24, paddingBottom: 16,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    modalTitle:  { fontSize: 15, fontFamily: 'JUSTSans-ExBold', color: c.white },
    modalBack:   { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: c.gold, width: 64 },
    modalCancel: { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: c.gold, width: 64, textAlign: 'right' },

    pickerRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: 16, paddingHorizontal: 24,
    },
    pickerRowText: { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: c.white },
    pickerChevron: { fontSize: 15, fontFamily: 'JUSTSans-ExBold', color: c.textMuted },
    separator:     { height: 1, backgroundColor: c.border, marginHorizontal: 24 },
  });
}
