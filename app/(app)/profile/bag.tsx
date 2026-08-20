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
import { goBack } from '../../../src/lib/navigation';

// ── Brand / Category / Model Data ────────────────────────────────────────────

const CLUB_BRANDS = [
  'Benross', 'Callaway', 'Cleveland', 'Cobra', 'Honma',
  'Lynx', 'Miura', 'Mizuno', 'Ping', 'PXG',
  'Srixon', 'TaylorMade', 'Titleist', 'Tour Edge', 'Wilson',
  'Yonex', 'Other',
];

const BRAND_CATEGORY_MODELS: Record<string, Record<string, string[]>> = {
  Benross: {
    'Driver': ['HTX Compressor', 'HTX Carbon', 'HTX Turbo', 'Power Play', 'Evolution'],
    'Iron':   ['VX3 Forged', 'Tech 37'],
  },
  Callaway: {
    'Driver':  ['Paradym Ai Smoke', 'Paradym Ai Smoke Max', 'Paradym Ai Smoke Triple Diamond', 'Paradym', 'Paradym X', 'Paradym Triple Diamond', 'Rogue ST Max', 'Rogue ST Max D', 'Rogue ST Max LS', 'Big Bertha', 'Big Bertha B21'],
    'Fairway': ['Paradym Ai Smoke', 'Paradym', 'Rogue ST Max', 'Big Bertha'],
    'Hybrid':  ['Paradym Ai Smoke', 'Paradym', 'Rogue ST Max'],
    'Iron':    ['Apex', 'Apex Pro', 'Apex CB', 'Apex MB', 'Apex DCB'],
    'Wedge':   ['Jaws Raw', 'Jaws MD5', 'Opus Wedge', 'Ai Smoke Wedge'],
    'Putter':  ['Ai Smoke Putter'],
  },
  Cleveland: {
    'Driver': ['Launcher XL2', 'Launcher HB Turbo 2', 'Launcher XL Halo'],
    'Iron':   ['ZipCore XL', 'CBX4', 'CBX ZipCore'],
    'Wedge':  ['RTX 6 ZipCore', 'RTX ZipCore', 'Smart Sole Full Face 4'],
    'Putter': ['Frontline Cero', 'HB Soft Milled'],
  },
  Cobra: {
    'Driver': ['Darkspeed', 'Darkspeed Max', 'Darkspeed LS', 'Darkspeed X', 'Darkspeed Max D', 'Aerojet', 'Aerojet Max', 'Aerojet LS'],
    'Iron':   ['King Tour MIM', 'King Forged Tec', 'King Forged Tec X', 'King CB', 'King Oversized'],
    'Wedge':  ['Snakebite'],
  },
  Honma: {
    'Driver': ['BERES BE-08', 'BERES 09', 'BERES S08'],
    'Iron':   ['TR20 V', 'TR20 P', 'TR20 B', 'TR20 X', 'T//World GS', 'T//World XP-1', 'T//World B'],
  },
  Lynx: {
    'Driver':  ['Predator Driver', 'Black Cat', 'Ai Driver', 'Tigress'],
    'Fairway': ['Predator 3 Wood'],
    'Iron':    ['Predator Irons', 'Ai Irons'],
    'Putter':  ['Prowler'],
  },
  Miura: {
    'Iron':   ['CB-301 Irons', 'CB-302 Irons', 'TC-201 Irons', 'IC-601 Irons', 'Baby Blades'],
    'Wedge':  ['0-Grind Wedge', 'K-Grind Wedge', 'K-Grind 2.0'],
    'Putter': ['PP-9002 Putter'],
  },
  Mizuno: {
    'Driver': ['ST-Max 230', 'ST-Z 230', 'ST-Max 235', 'ST-G 220'],
    'Iron':   ['JPX923 Hot Metal', 'JPX923 Hot Metal Pro', 'JPX923 Forged', 'JPX923 Tour', 'JPX925 Hot Metal', 'JPX925 Forged', 'JPX925 Tour', 'MP-20 MB', 'Pro 241'],
    'Wedge':  ['T24 Wedge', 'T22 Wedge', 'S23 Wedge'],
    'Putter': ['M-Craft OMOI', 'M-Craft II'],
  },
  Ping: {
    'Driver':       ['G430 Max', 'G430 LST', 'G430 SFT', 'G430 Max 10K', 'G425 Max', 'G425 LST', 'G425 SFT'],
    'Fairway':      ['G430 Max', 'G425 Max'],
    'Hybrid':       ['G430 Max', 'G425 Max'],
    'Driving Iron': ['G430 Crossover', 'ChipR'],
    'Iron':         ['Blueprint T', 'Blueprint S', 'i530', 'i525', 'i59', 'G430 HL'],
    'Wedge':        ['Glide 4.0', 'Glide 4.0 SS', 'Glide 4.0 ES'],
    'Putter':       ['Scottsdale TR', 'Anser', 'DS72', 'Kushin 4'],
  },
  PXG: {
    'Driver':       ['Lightning', 'Black Ops', 'Black Ops Tour-1', 'Black Ops Ultra Lite', 'Secret Weapon Mini Driver'],
    'Fairway':      ['Lightning', 'Black Ops', 'Black Ops Tour-1'],
    'Hybrid':       ['Lightning', 'Black Ops'],
    'Driving Iron': ['GEN8 Driving Iron', '0317 X GEN8', '0317 CB GEN8', '0317 ST GEN8'],
    'Iron':         ['0311 XP GEN8', '0311 P GEN8', '0311 T GEN8', '0311 XP GEN7', '0311 P GEN7', '0311 T GEN7', '0317 X', '0317 CB', '0317 ST', 'Black Ops Irons'],
    'Wedge':        ['Sugar Daddy III', '0311 3X Forged', "Stick'em"],
    'Putter':       ['Bat Attack ZT', 'Mustang ZT', 'Battle Ready II Brandon', 'Battle Ready II Closer', 'Battle Ready II Hercules', 'Battle Ready II One & Done', 'Battle Ready II Allan', 'Battle Ready II Blackjack', 'Battle Ready II Bat Attack', 'Battle Ready II Gunboat', 'Battle Ready II Mustang', 'Battle Ready II Torpedo'],
  },
  Srixon: {
    'Driver':       ['ZX5 Mk II', 'ZX7 Mk II', 'ZX5 LS Mk II', 'ZXi-5', 'ZXi-7', 'ZXi-LS'],
    'Driving Iron': ['U85 Utility Iron', 'U65 Utility Iron'],
    'Iron':         ['ZX4 Mk II Iron', 'ZX5 Mk II Iron', 'ZX7 Mk II Iron', 'ZXi-7 Iron', 'ZXi-5 Iron'],
    'Wedge':        ['W503 Wedge', 'Z785 Wedge'],
    'Putter':       ['Tri-Hot 5K Putter'],
  },
  TaylorMade: {
    'Driver':  ['Qi10', 'Qi10 LS', 'Qi10 Max', 'Qi10 Tour', 'BRNR Mini', 'Stealth 2', 'Stealth 2 HD', 'Stealth 2 Plus'],
    'Fairway': ['Qi10', 'Stealth 2', 'Stealth 2 HD'],
    'Hybrid':  ['Qi10', 'Stealth 2'],
    'Iron':    ['P790', 'P770', 'P7MC', 'P7MB', 'P7TW'],
    'Wedge':   ['Milled Grind 4', 'Hi-Toe 3'],
    'Putter':  ['Spider GT Max', 'Spider Tour', 'TP Hydro Blast'],
  },
  Titleist: {
    'Driver':  ['GT2', 'GT3', 'GT4', 'TSR2', 'TSR3', 'TSR4'],
    'Fairway': ['GT2', 'GT3', 'TSR2', 'TSR3'],
    'Hybrid':  ['GT2', 'TSR2'],
    'Iron':    ['T100', 'T100·S', 'T150', 'T200', 'T350'],
    'Wedge':   ['Vokey SM10', 'Vokey SM9'],
    'Putter':  ['Scotty Cameron Phantom', 'Scotty Cameron Special Select', 'Scotty Cameron Newport'],
  },
  'Tour Edge': {
    'Driver': ['Exotics C723', 'Exotics E723', 'Hot Launch E523', 'Hot Launch C523'],
    'Iron':   ['Exotics 723 Forged'],
  },
  Wilson: {
    'Driver': ['Dynapower Carbon', 'Dynapower Titanium'],
    'Iron':   ['D9 Forged', 'D9', 'Staff Model Blade', 'Staff Model CB', 'Staff Model R', 'Staff Model Utility'],
    'Wedge':  ['Harmonized Wedge'],
    'Putter': ['Infinite Putter'],
  },
  Yonex: {
    'Driver':  ['Ezone GS Driver', 'Royal Ezone Driver', 'Ezone Elite 4.0'],
    'Fairway': ['Ezone GS Wood'],
    'Iron':    ['Ezone GS Iron'],
  },
  Other: {
    'Driver': ['Custom / No Model'], 'Fairway': ['Custom / No Model'],
    'Hybrid': ['Custom / No Model'], 'Driving Iron': ['Custom / No Model'],
    'Iron':   ['Custom / No Model'], 'Wedge':  ['Custom / No Model'],
    'Putter': ['Custom / No Model'],
  },
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
  brand_category: string | null;
  model: string | null;
};

type BrandPickerState = { club: Club; step: 'brand' | 'category' | 'model'; brand?: string; brand_category?: string };

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

  function pickBrand(brand: string) {
    if (!brandPicker) return;
    setBrandPicker({ ...brandPicker, step: 'category', brand, brand_category: undefined });
  }

  function pickCategory(brand_category: string) {
    if (!brandPicker) return;
    setBrandPicker({ ...brandPicker, step: 'model', brand_category });
  }

  async function pickModel(model: string) {
    if (!brandPicker?.brand || !brandPicker?.brand_category) return;
    await saveEquipment(brandPicker.club, brandPicker.brand, brandPicker.brand_category, model);
  }

  async function saveEquipment(club: Club, brand: string, brand_category: string, model: string) {
    setBrandPicker(null);
    setClubs(prev => prev.map(c => c.id === club.id ? { ...c, brand, brand_category, model } : c));
    await supabase.from('clubs').update({ brand, brand_category, model }).eq('id', club.id);
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
        <TouchableOpacity onPress={() => goBack(router, '/(app)/profile')} hitSlop={hit}>
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
                        {club.brand}{club.brand_category ? ` · ${club.brand_category}` : ''}{club.model ? ` · ${club.model}` : ''}
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

      {/* Equipment picker modal (Brand → Category → Model) */}
      <Modal
        visible={brandPicker !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setBrandPicker(null)}
      >
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            {brandPicker?.step === 'category' ? (
              <TouchableOpacity onPress={() => setBrandPicker(bp => bp ? { ...bp, step: 'brand' } : null)}>
                <Text style={styles.modalBack}>‹ Brands</Text>
              </TouchableOpacity>
            ) : brandPicker?.step === 'model' ? (
              <TouchableOpacity onPress={() => setBrandPicker(bp => bp ? { ...bp, step: 'category' } : null)}>
                <Text style={styles.modalBack}>‹ Categories</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 64 }} />
            )}
            <Text style={styles.modalTitle}>
              {brandPicker?.step === 'brand' ? 'Select Brand'
                : brandPicker?.step === 'category' ? (brandPicker.brand ?? '')
                : `${brandPicker?.brand} · ${brandPicker?.brand_category}`}
            </Text>
            <TouchableOpacity onPress={() => setBrandPicker(null)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>

          {brandPicker?.step === 'brand' && (
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
          )}

          {brandPicker?.step === 'category' && (
            <FlatList
              data={Object.keys(BRAND_CATEGORY_MODELS[brandPicker.brand ?? ''] ?? {})}
              keyExtractor={c => c}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.pickerRow} onPress={() => pickCategory(item)} activeOpacity={0.7}>
                  <Text style={styles.pickerRowText}>{item}</Text>
                  <Text style={styles.pickerChevron}>›</Text>
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              contentContainerStyle={{ paddingBottom: 40 }}
            />
          )}

          {brandPicker?.step === 'model' && (
            <FlatList
              data={(BRAND_CATEGORY_MODELS[brandPicker.brand ?? ''] ?? {})[brandPicker.brand_category ?? ''] ?? []}
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
