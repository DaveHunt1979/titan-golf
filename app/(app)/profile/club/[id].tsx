import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
  ScrollView, Modal, FlatList,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../src/lib/supabase';
import { scanNfcTagId, isNfcSupported, formatTagId } from '../../../../src/lib/nfc';

const GOLD  = '#D4AF37';
const GREEN = '#22c55e';
const RED   = '#ef4444';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const HIT   = { top: 12, bottom: 12, left: 12, right: 12 };

// ── Brand / model data ─────────────────────────────────────────
const CLUB_BRANDS = [
  'Benross', 'Callaway', 'Cleveland', 'Cobra', 'Honma',
  'Lynx', 'Miura', 'Mizuno', 'Ping', 'PXG',
  'Srixon', 'TaylorMade', 'Titleist', 'Tour Edge', 'Wilson',
  'Yonex', 'Other',
];

const BRAND_MODELS: Record<string, string[]> = {
  Benross:    ['HTX Compressor', 'HTX Carbon', 'HTX Turbo', 'Power Play', 'Evolution', 'VX3 Forged'],
  Callaway:   ['Paradym Ai Smoke', 'Paradym Ai Smoke Max', 'Paradym', 'Paradym X', 'Rogue ST Max', 'Big Bertha', 'Apex', 'Apex Pro', 'Apex CB', 'Jaws Raw', 'Opus Wedge', 'Ai Smoke Wedge'],
  Cleveland:  ['Launcher XL2', 'Launcher HB Turbo 2', 'ZipCore XL', 'CBX4', 'RTX 6 ZipCore', 'RTX ZipCore', 'Smart Sole Full Face 4', 'Frontline Cero'],
  Cobra:      ['Darkspeed', 'Darkspeed Max', 'Darkspeed LS', 'Aerojet', 'Aerojet Max', 'King Tour MIM', 'King Forged Tec', 'King CB', 'Snakebite'],
  Honma:      ['BERES BE-08', 'BERES 09', 'TR20 V', 'TR20 P', 'T//World GS', 'T//World XP-1'],
  Lynx:       ['Predator Driver', 'Predator 3 Wood', 'Predator Irons', 'Black Cat', 'Ai Driver', 'Ai Irons'],
  Miura:      ['CB-301 Irons', 'CB-302 Irons', 'TC-201 Irons', 'IC-601 Irons', 'Baby Blades', '0-Grind Wedge', 'K-Grind 2.0'],
  Mizuno:     ['ST-Max 230', 'ST-Z 230', 'JPX923 Hot Metal', 'JPX923 Forged', 'JPX923 Tour', 'JPX925 Hot Metal', 'JPX925 Forged', 'MP-20 MB', 'Pro 241', 'T24 Wedge', 'M-Craft OMOI'],
  Ping:       ['G430 Max', 'G430 LST', 'G430 SFT', 'G430 Max 10K', 'G425 Max', 'Blueprint T', 'Blueprint S', 'i530', 'i525', 'i59', 'Glide 4.0', 'Scottsdale TR', 'Anser'],
  PXG:        ['0811 XF Gen6', '0811 X Gen6', '0311 XP Gen6', '0311 P Gen6', '0311 T Gen6', '0211 Irons', '0702 Forged', 'Darkness Wedge', 'Battle Ready II Putter'],
  Srixon:     ['ZX5 Mk II', 'ZX7 Mk II', 'ZXi-5', 'ZXi-7', 'ZXi-LS', 'ZX4 Mk II Iron', 'ZX7 Mk II Iron', 'U85 Utility Iron', 'W503 Wedge', 'Tri-Hot 5K Putter'],
  TaylorMade: ['Qi10', 'Qi10 LS', 'Qi10 Max', 'Qi10 Tour', 'Stealth 2', 'Stealth 2 HD', 'Stealth 2 Plus', 'P790', 'P770', 'P7MC', 'P7MB', 'Milled Grind 4', 'Hi-Toe 3', 'Spider GT Max', 'Spider Tour', 'TP Hydro Blast'],
  Titleist:   ['GT2', 'GT3', 'GT4', 'TSR2', 'TSR3', 'TSR4', 'T100', 'T100·S', 'T150', 'T200', 'T350', 'Vokey SM10', 'Vokey SM9', 'Scotty Cameron Phantom', 'Scotty Cameron Special Select', 'Scotty Cameron Newport'],
  'Tour Edge':['Exotics C723', 'Exotics E723', 'Exotics 723 Forged', 'Hot Launch E523', 'Hot Launch C523'],
  Wilson:     ['Dynapower Carbon', 'Dynapower Titanium', 'D9 Forged', 'D9', 'Staff Model Blade', 'Staff Model CB', 'Staff Model R', 'Harmonized Wedge', 'Infinite Putter'],
  Yonex:      ['Ezone GS Driver', 'Ezone GS Wood', 'Ezone GS Iron', 'Royal Ezone Driver', 'Ezone Elite 4.0'],
  Other:      ['Custom / No Model'],
};

// ── Types ──────────────────────────────────────────────────────
type Club = {
  id: string;
  name: string;
  short_name: string;
  category: string;
  brand: string | null;
  model: string | null;
  nfc_tag_id: string | null;
  in_bag: boolean;
  sort_order: number;
};

type PickerMode = 'brand' | 'model' | null;

// ── Screen ─────────────────────────────────────────────────────
export default function ClubDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [club,      setClub]      = useState<Club | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [scanning,  setScanning]  = useState(false);
  const [nfcAvail,  setNfcAvail]  = useState(false);
  const [picker,    setPicker]    = useState<PickerMode>(null);
  const [pickerBrand, setPickerBrand] = useState('');

  useEffect(() => {
    (async () => {
      const supported = await isNfcSupported();
      setNfcAvail(supported);

      const { data, error } = await supabase
        .from('clubs').select('*').eq('id', id).maybeSingle();
      if (error) Alert.alert('Error', error.message);
      setClub(data as Club ?? null);
      setLoading(false);
    })();
  }, [id]);

  async function toggleInBag() {
    if (!club) return;
    const next = !club.in_bag;
    setClub(c => c ? { ...c, in_bag: next } : c);
    await supabase.from('clubs').update({ in_bag: next }).eq('id', club.id);
  }

  function openBrandPicker() {
    setPickerBrand('');
    setPicker('brand');
  }

  async function pickBrand(brand: string) {
    setPickerBrand(brand);
    const models = BRAND_MODELS[brand] ?? [];
    if (models.length === 0) {
      await saveBrand(brand, null);
      setPicker(null);
    } else {
      setPicker('model');
    }
  }

  async function pickModel(model: string) {
    await saveBrand(pickerBrand, model);
    setPicker(null);
  }

  async function saveBrand(brand: string, model: string | null) {
    if (!club) return;
    setClub(c => c ? { ...c, brand, model } : c);
    await supabase.from('clubs').update({ brand, model }).eq('id', club.id);
  }

  async function clearBrand() {
    if (!club) return;
    Alert.alert('Clear brand?', `Remove ${club.brand} from ${club.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive', onPress: async () => {
          setClub(c => c ? { ...c, brand: null, model: null } : c);
          await supabase.from('clubs').update({ brand: null, model: null }).eq('id', club.id);
        },
      },
    ]);
  }

  async function assignNfc() {
    if (!club) return;
    if (!nfcAvail) {
      Alert.alert('NFC Not Available', 'NFC requires a physical iPhone. Not available in the simulator.');
      return;
    }
    setScanning(true);
    const tagId = await scanNfcTagId();
    setScanning(false);
    if (!tagId) {
      Alert.alert('No Tag Detected', 'Hold your phone directly over the sticker and try again.');
      return;
    }
    const { error } = await supabase.from('clubs').update({ nfc_tag_id: tagId }).eq('id', club.id);
    if (error) { Alert.alert('Error', error.message); return; }
    setClub(c => c ? { ...c, nfc_tag_id: tagId } : c);
    Alert.alert('Sticker Linked ✓', `${club.name} → ${formatTagId(tagId)}`);
  }

  async function removeNfc() {
    if (!club) return;
    Alert.alert('Remove sticker?', `Unlink the NFC sticker from ${club.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          await supabase.from('clubs').update({ nfc_tag_id: null }).eq('id', club.id);
          setClub(c => c ? { ...c, nfc_tag_id: null } : c);
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={s.root}>
        <StatusBar style="light" />
        <View style={s.centered}><ActivityIndicator color={GOLD} size="large" /></View>
      </View>
    );
  }

  if (!club) {
    return (
      <View style={s.root}>
        <StatusBar style="light" />
        <View style={s.centered}>
          <Text style={s.errorText}>Club not found</Text>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Text style={s.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const modelList = BRAND_MODELS[pickerBrand || club.brand || ''] ?? [];

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={HIT} style={s.headerSide}>
          <Ionicons name="chevron-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerShort}>{club.short_name}</Text>
        </View>
        <View style={s.headerSide} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

        {/* ── Title ── */}
        <Text style={s.pageTitle}>{club.name}</Text>

        {/* ── In Bag toggle ── */}
        <Text style={s.sectionLabel}>BAG STATUS</Text>
        <TouchableOpacity style={s.card} onPress={toggleInBag} activeOpacity={0.7}>
          <View style={s.row}>
            <View style={s.rowLeft}>
              <View style={[s.rowIcon, club.in_bag && s.rowIconActive]}>
                <Ionicons name="golf-outline" size={18} color={club.in_bag ? '#000' : GOLD} />
              </View>
              <View>
                <Text style={s.rowTitle}>{club.in_bag ? 'In your bag' : 'Not in bag'}</Text>
                <Text style={s.rowSub}>{club.in_bag ? 'Tap to remove from active bag' : 'Tap to add to active bag'}</Text>
              </View>
            </View>
            <View style={[s.toggle, club.in_bag && s.toggleOn]}>
              <View style={[s.toggleThumb, club.in_bag && s.toggleThumbOn]} />
            </View>
          </View>
        </TouchableOpacity>

        {/* ── Brand & Model ── */}
        <Text style={s.sectionLabel}>EQUIPMENT</Text>
        <View style={s.cardGroup}>
          <TouchableOpacity style={s.rowInCard} onPress={openBrandPicker} activeOpacity={0.7}>
            <View style={s.rowLeft}>
              <View style={s.rowIcon}>
                <Ionicons name="bookmark-outline" size={18} color={GOLD} />
              </View>
              <View>
                <Text style={s.rowTitle}>Brand</Text>
                <Text style={s.rowSub}>{club.brand ?? 'Not set — tap to choose'}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#444" />
          </TouchableOpacity>

          <View style={s.cardDivider} />

          <TouchableOpacity
            style={[s.rowInCard, !club.brand && { opacity: 0.35 }]}
            onPress={club.brand ? () => { setPickerBrand(club.brand!); setPicker('model'); } : undefined}
            activeOpacity={0.7}
          >
            <View style={s.rowLeft}>
              <View style={s.rowIcon}>
                <Ionicons name="pricetag-outline" size={18} color={GOLD} />
              </View>
              <View>
                <Text style={s.rowTitle}>Model</Text>
                <Text style={s.rowSub}>{club.model ?? (club.brand ? 'Tap to choose model' : 'Set brand first')}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#444" />
          </TouchableOpacity>
        </View>

        {(club.brand || club.model) && (
          <TouchableOpacity style={s.clearBtn} onPress={clearBrand} activeOpacity={0.7}>
            <Text style={s.clearBtnText}>Clear brand & model</Text>
          </TouchableOpacity>
        )}

        {/* ── NFC Tag ── */}
        <Text style={s.sectionLabel}>NFC STICKER</Text>
        <View style={s.cardGroup}>
          <View style={s.rowInCard}>
            <View style={s.rowLeft}>
              <View style={[s.rowIcon, club.nfc_tag_id ? { backgroundColor: `${GREEN}18`, borderColor: `${GREEN}30` } : {}]}>
                <Ionicons name="wifi-outline" size={18} color={club.nfc_tag_id ? GREEN : GOLD} />
              </View>
              <View>
                <Text style={s.rowTitle}>{club.nfc_tag_id ? 'Sticker linked' : 'No sticker assigned'}</Text>
                <Text style={[s.rowSub, club.nfc_tag_id && { color: GREEN }]}>
                  {club.nfc_tag_id ? formatTagId(club.nfc_tag_id) : 'Hold your phone to the sticker to link it'}
                </Text>
              </View>
            </View>
          </View>

          {club.nfc_tag_id ? (
            <>
              <View style={s.cardDivider} />
              <TouchableOpacity style={s.rowInCard} onPress={assignNfc} activeOpacity={0.7}>
                <View style={s.rowLeft}>
                  <View style={s.rowIcon}>
                    <Ionicons name="refresh-outline" size={18} color={GOLD} />
                  </View>
                  <View>
                    <Text style={s.rowTitle}>Replace sticker</Text>
                    <Text style={s.rowSub}>Scan a new NFC sticker to reassign</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#444" />
              </TouchableOpacity>
              <View style={s.cardDivider} />
              <TouchableOpacity style={s.rowInCard} onPress={removeNfc} activeOpacity={0.7}>
                <View style={s.rowLeft}>
                  <View style={[s.rowIcon, { backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)' }]}>
                    <Ionicons name="trash-outline" size={18} color={RED} />
                  </View>
                  <Text style={[s.rowTitle, { color: RED }]}>Remove sticker</Text>
                </View>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={s.cardDivider} />
              <TouchableOpacity
                style={[s.rowInCard, (!nfcAvail || scanning) && { opacity: 0.5 }]}
                onPress={assignNfc}
                disabled={scanning}
                activeOpacity={0.7}
              >
                <View style={s.rowLeft}>
                  <View style={s.rowIcon}>
                    <Ionicons name="add-circle-outline" size={18} color={GOLD} />
                  </View>
                  <View>
                    <Text style={s.rowTitle}>{scanning ? 'Scanning…' : 'Assign sticker'}</Text>
                    <Text style={s.rowSub}>
                      {nfcAvail ? 'Hold your phone to the sticker on this club' : 'Requires physical iPhone'}
                    </Text>
                  </View>
                </View>
                {scanning
                  ? <ActivityIndicator color={GOLD} size="small" />
                  : <Ionicons name="chevron-forward" size={16} color="#444" />
                }
              </TouchableOpacity>
            </>
          )}
        </View>

      </ScrollView>

      {/* ── Brand picker modal ── */}
      <Modal
        visible={picker !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPicker(null)}
      >
        <View style={s.modal}>
          <View style={s.modalHeader}>
            {picker === 'model' ? (
              <TouchableOpacity onPress={() => setPicker('brand')} hitSlop={HIT} style={s.modalSide}>
                <Text style={s.modalBack}>‹ Brands</Text>
              </TouchableOpacity>
            ) : (
              <View style={s.modalSide} />
            )}
            <Text style={s.modalTitle}>
              {picker === 'brand' ? 'Select Brand' : pickerBrand}
            </Text>
            <TouchableOpacity onPress={() => setPicker(null)} hitSlop={HIT} style={[s.modalSide, { alignItems: 'flex-end' }]}>
              <Text style={s.modalCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>

          {picker === 'brand' ? (
            <FlatList
              data={CLUB_BRANDS}
              keyExtractor={b => b}
              renderItem={({ item }) => (
                <TouchableOpacity style={s.pickerRow} onPress={() => pickBrand(item)} activeOpacity={0.7}>
                  <Text style={s.pickerRowText}>{item}</Text>
                  <Ionicons name="chevron-forward" size={16} color="#444" />
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={s.pickerDivider} />}
              contentContainerStyle={{ paddingBottom: 48 }}
            />
          ) : (
            <FlatList
              data={modelList}
              keyExtractor={m => m}
              renderItem={({ item }) => (
                <TouchableOpacity style={s.pickerRow} onPress={() => pickModel(item)} activeOpacity={0.7}>
                  <Text style={s.pickerRowText}>{item}</Text>
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={s.pickerDivider} />}
              contentContainerStyle={{ paddingBottom: 48 }}
            />
          )}
        </View>
      </Modal>
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
  },
  headerSide:   { width: 44 },
  headerCenter: { alignItems: 'center' },
  headerShort: {
    fontFamily: FFB, fontSize: 15, color: GOLD, letterSpacing: 1,
  },

  pageTitle: {
    fontFamily: FFB, fontSize: 36, color: '#ffffff',
    paddingHorizontal: 20, paddingBottom: 24, letterSpacing: -0.5,
  },

  sectionLabel: {
    fontFamily: FF, fontSize: 10, color: '#6b7280', letterSpacing: 2,
    paddingHorizontal: 16, marginBottom: 8, marginTop: 4,
  },

  // Single-row card
  card: {
    marginHorizontal: 16, backgroundColor: '#111111',
    borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c',
    marginBottom: 20, overflow: 'hidden',
  },

  // Multi-row card
  cardGroup: {
    marginHorizontal: 16, backgroundColor: '#111111',
    borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c',
    marginBottom: 8, overflow: 'hidden',
  },
  cardDivider: { height: 1, backgroundColor: '#1c1c1c', marginHorizontal: 14 },

  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 16,
  },
  rowInCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 16,
  },
  rowLeft:  { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  rowIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: `${GOLD}0d`, borderWidth: 1, borderColor: `${GOLD}25`,
    alignItems: 'center', justifyContent: 'center',
  },
  rowIconActive: { backgroundColor: GOLD, borderColor: GOLD },
  rowTitle: { fontFamily: FF, fontSize: 15, color: '#ffffff', marginBottom: 2 },
  rowSub:   { fontFamily: FF, fontSize: 12, color: '#6b7280' },

  // Toggle switch
  toggle: {
    width: 44, height: 26, borderRadius: 13,
    backgroundColor: '#2c2c2c', padding: 3,
    justifyContent: 'center',
  },
  toggleOn:    { backgroundColor: GOLD },
  toggleThumb: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: '#6b7280',
  },
  toggleThumbOn: { backgroundColor: '#000', alignSelf: 'flex-end' },

  clearBtn: {
    marginHorizontal: 16, alignItems: 'center', paddingVertical: 10, marginBottom: 20,
  },
  clearBtnText: { fontFamily: FF, fontSize: 13, color: '#555' },

  errorText: { fontFamily: FF, fontSize: 16, color: '#6b7280', marginBottom: 16 },
  backBtn:   { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, backgroundColor: `${GOLD}18`, borderWidth: 1, borderColor: `${GOLD}30` },
  backBtnText: { fontFamily: FF, fontSize: 14, color: GOLD },

  // Modal
  modal: { flex: 1, backgroundColor: '#000000' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 20, paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  modalSide:   { width: 70 },
  modalTitle:  { fontFamily: FFB, fontSize: 17, color: '#ffffff' },
  modalBack:   { fontFamily: FF, fontSize: 15, color: GOLD },
  modalCancel: { fontFamily: FF, fontSize: 15, color: GOLD, textAlign: 'right' },

  pickerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 16, paddingHorizontal: 20,
  },
  pickerRowText: { fontFamily: FF, fontSize: 16, color: '#ffffff' },
  pickerDivider: { height: 1, backgroundColor: '#1c1c1c', marginHorizontal: 20 },
});
