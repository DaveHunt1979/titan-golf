import { useFonts } from 'expo-font';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { titanLogo } from '../../../src/lib/assets';
import { IS_PAD } from '../../../src/lib/useDeviceLayout';
import { goBack } from '../../../src/lib/navigation';

const BLUE = '#60a5fa';
const RED  = '#f87171';
const FF   = 'JUSTSans';
const FFB  = 'JUSTSans-ExBold';

const TILES = [
  { key: 'players',  label: 'Players',  sub: 'View roster, add players manually',            icon: 'person-outline'          as const, route: '/(app)/admin/players' },
  { key: 'courses',  label: 'Courses',  sub: 'Par, stroke index & yardages',                 icon: 'golf-outline'            as const, route: '/(app)/admin/courses' },
  { key: 'pins',     label: 'Pins',     sub: 'Green locations for the rangefinder',          icon: 'location-outline'        as const, route: '/(app)/admin/pins' },
  { key: 'groups',   label: 'Groups',   sub: 'Named groups for quick game setup',            icon: 'people-circle-outline'   as const, route: '/(app)/admin/groups' },
  { key: 'codes',    label: 'Codes',    sub: 'Join PIN, tournament PINs, area codes',        icon: 'key-outline'             as const, route: '/(app)/admin/codes' },
  { key: 'access',   label: 'Access',   sub: 'Casual / Tour / Swindle per player',           icon: 'lock-open-outline'       as const, route: '/(app)/admin/membership' },
  { key: 'records',  label: 'Records',  sub: 'All-time society bests',                       icon: 'ribbon-outline'          as const, route: '/(app)/records' },
  { key: 'society',  label: 'New Society', sub: 'Onboard a new golf club to Titan',           icon: 'add-circle-outline'      as const, route: '/(app)/admin/create-society' },
] as const;

export default function PlatformHubScreen() {
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

  function clearChat() {
    Alert.alert(
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
    );
  }

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
          <Text style={[s.headerSub, { color: dc.gold }]}>PLATFORM</Text>
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
              <View style={[s.tileIcon, { backgroundColor: `${BLUE}18`, borderColor: `${BLUE}55` }]}>
                <Ionicons name={t.icon} size={24} color={BLUE} />
              </View>
              <Text style={[s.tileLabel, { color: dc.cardText }]} numberOfLines={1}>{t.label}</Text>
              <Text style={[s.tileSub, { color: dc.textSecondary }]} numberOfLines={2}>{t.sub}</Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={[s.tile, { width: tileW, backgroundColor: dc.card, borderColor: dc.border }]}
            onPress={clearChat}
            activeOpacity={0.75}
          >
            <View style={[s.tileIcon, { backgroundColor: `${RED}18`, borderColor: `${RED}55` }]}>
              <Ionicons name="trash-outline" size={24} color={RED} />
            </View>
            <Text style={[s.tileLabel, { color: RED }]} numberOfLines={1}>Clear Chat</Text>
            <Text style={[s.tileSub, { color: dc.textSecondary }]} numberOfLines={2}>Delete the entire chat history</Text>
          </TouchableOpacity>
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
