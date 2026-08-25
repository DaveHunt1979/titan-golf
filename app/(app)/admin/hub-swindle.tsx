import { useFonts } from 'expo-font';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { titanLogo } from '../../../src/lib/assets';
import { IS_PAD } from '../../../src/lib/useDeviceLayout';
import { goBack } from '../../../src/lib/navigation';

const PURPLE = '#a78bfa';
const FF   = 'JUSTSans';
const FFB  = 'JUSTSans-ExBold';

const TILES = [
  { key: 'build',   label: 'Build a Swindle', sub: 'Set up a new weekly game',        icon: 'add-circle-outline' as const, route: '/(app)/swindle/create' },
  { key: 'live',    label: 'Live',            sub: 'Games in progress right now',     icon: 'radio-outline'      as const, route: '/(app)/admin/swindle?tab=games&status=active' },
  { key: 'results', label: 'Results',         sub: 'Completed games & payouts',       icon: 'trophy-outline'     as const, route: '/(app)/admin/swindle?tab=games&status=complete' },
  { key: 'money',   label: 'Money List',      sub: 'Season earnings & wins',          icon: 'cash-outline'       as const, route: '/(app)/admin/swindle?tab=money' },
  { key: 'members', label: 'Members',         sub: 'Who has swindle access',          icon: 'people-outline'     as const, route: '/(app)/admin/swindle?tab=members' },
  { key: 'stats',   label: 'Season Stats',    sub: 'Order of Merit, records & push to members', icon: 'stats-chart-outline' as const, route: '/(app)/admin/swindle-stats' },
] as const;

export default function SwindleHubScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { localLogo, logoUrl } = useSocietyTheme();
  const { width: winW } = useWindowDimensions();
  const contentW = IS_PAD ? winW - 220 : winW;
  const tileW = Math.floor((contentW - 40 - 10) / 2);
  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  if (!fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: dc.bg, alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={dc.gold} size="large" />
    </View>
  );

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />
      <View style={[s.header, { borderBottomColor: dc.border }]}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/admin')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={[s.back, { color: dc.gold }]}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)} style={s.headerLogo} resizeMode="contain" />
          <Text style={[s.headerSub, { color: PURPLE }]}>SWINDLE</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.grid}>
          {TILES.map(t => (
            <TouchableOpacity
              key={t.key}
              style={[s.tile, { width: tileW, backgroundColor: dc.card, borderColor: dc.border }]}
              onPress={() => router.push(t.route as any)}
              activeOpacity={0.75}
            >
              <View style={[s.tileIcon, { backgroundColor: `${PURPLE}18`, borderColor: `${PURPLE}55` }]}>
                <Ionicons name={t.icon} size={24} color={PURPLE} />
              </View>
              <Text style={[s.tileLabel, { color: dc.cardText }]} numberOfLines={1}>{t.label}</Text>
              <Text style={[s.tileSub, { color: dc.textSecondary }]} numberOfLines={2}>{t.sub}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerCenter: { alignItems: 'center' },
  headerLogo:   { width: 36, height: 36 },
  headerSub:    { fontFamily: FFB, fontSize: 10, letterSpacing: 2, marginTop: 2 },
  back:         { fontFamily: FFB, fontSize: 14 },

  scroll: { padding: 20, paddingBottom: 60 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { borderRadius: 14, padding: 16, gap: 6, borderWidth: 1 },
  tileIcon: {
    width: 44, height: 44, borderRadius: 12, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  tileLabel: { fontFamily: FFB, fontSize: 15, letterSpacing: -0.2 },
  tileSub:   { fontFamily: FFB, fontSize: 11, lineHeight: 15 },
});
