// Mashie-only "Partners" screen (Dave, 2026-09-16) — replaces the Shop quick
// link on Home for Mashie Golf specifically (see MASHIE_SOCIETY_ID gating in
// app/(app)/index.tsx). Lists Mashie's real brand partners with their actual
// logos and outbound links, pulled directly from mashiegolf.co.uk/partners/
// brand-partners/ — a hardcoded snapshot, so it needs a manual update here
// whenever Mashie's own partner roster changes. Ambassadors and partner
// courses are deliberately excluded: neither has a clickable link on Mashie's
// own site to send someone to, so there's nothing real to link out to.
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking, Image, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { useDynamicColors } from '../../src/lib/SocietyThemeContext';
import { goBack } from '../../src/lib/navigation';

const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';

interface Partner { name: string; url: string; logo: string; }

const PARTNERS: Partner[] = [
  { name: 'PXG',                  url: 'https://www.pxg.com/',                                             logo: 'https://mashiegolf.co.uk/wp-content/uploads/2025/06/untitled-design-67.webp' },
  { name: 'Golfbreaks',           url: 'https://www.golfbreaks.com/en-gb/',                                 logo: 'https://mashiegolf.co.uk/wp-content/uploads/2025/06/golfbreaks-web-app-logo.png' },
  { name: 'Trade Nation',         url: 'https://mashiegolf.co.uk/trade-nation',                             logo: 'https://mashiegolf.co.uk/wp-content/uploads/2025/06/trade-nation-website-logo-image.png' },
  { name: 'Stewart Golf',         url: 'https://www.stewartgolf.co.uk/',                                    logo: 'https://mashiegolf.co.uk/wp-content/uploads/2025/06/stewart-golf-logo.png' },
  { name: 'Gusbourne',            url: 'https://www.gusbourne.com',                                         logo: 'https://mashiegolf.co.uk/wp-content/uploads/2025/07/new-gusbourne-logo.png' },
  { name: 'Exclusive Collection', url: 'https://www.exclusive.co.uk/',                                      logo: 'https://mashiegolf.co.uk/wp-content/uploads/2025/07/untitled-design-64.png' },
  { name: 'Minimal Golf',         url: 'https://minimalgolf.uk',                                            logo: 'https://mashiegolf.co.uk/wp-content/uploads/2026/05/minimal_logo.jpg' },
  { name: 'Clubby',               url: 'https://clubbyai.co.uk/',                                           logo: 'https://mashiegolf.co.uk/wp-content/uploads/2025/07/clubby-second.png' },
  { name: 'Prosper2',             url: 'https://prosper2.co.uk/',                                           logo: 'https://mashiegolf.co.uk/wp-content/uploads/2025/07/p2.png' },
  { name: 'PITCH Golf',           url: 'http://pitchgolf.london/',                                          logo: 'https://mashiegolf.co.uk/wp-content/uploads/2025/07/pitch-london-logo.png' },
  { name: 'PAYNTR',               url: 'https://mashiegolf.co.uk/partners/brand-partners/payntr',           logo: 'https://mashiegolf.co.uk/wp-content/uploads/2025/10/payntr-app.png' },
  { name: 'Blue Tees',            url: 'https://mashiegolf.co.uk/partners/brand-partners/blue-tees',        logo: 'https://mashiegolf.co.uk/wp-content/uploads/2026/06/blue-tees-logo.png' },
  { name: 'TRUE Linkswear',       url: 'https://mashiegolf.co.uk/partners/brand-partners/true-linkswear/',  logo: 'https://mashiegolf.co.uk/wp-content/uploads/2025/09/true-2.png' },
  { name: 'Sandals',              url: 'https://mashiegolf.co.uk/partners/brand-partners/sandals/',         logo: 'https://mashiegolf.co.uk/wp-content/uploads/2025/06/sandals-web-app-logo.png' },
  { name: 'Wine & Earth',         url: 'https://mashiegolf.co.uk/partners/brand-partners/wine-and-earth/',  logo: 'https://mashiegolf.co.uk/wp-content/uploads/2025/07/app-website-logo-wine-earth.png' },
  { name: 'Golf News',            url: 'https://golfnews.co.uk/',                                           logo: 'https://mashiegolf.co.uk/wp-content/uploads/2025/07/gf.png' },
  { name: 'Amateur Golf Events',  url: 'https://amateurgolf.events',                                        logo: 'https://mashiegolf.co.uk/wp-content/uploads/2025/07/amamteur-golf.png' },
  { name: 'OATOPIA',              url: 'https://www.oatopia.co.uk/',                                        logo: 'https://mashiegolf.co.uk/wp-content/uploads/2026/03/oat-2.png' },
  { name: 'Prime Time Beers',     url: 'https://primetimebeers.com',                                        logo: 'https://mashiegolf.co.uk/wp-content/uploads/2025/11/primttimebeer.png' },
  { name: 'Octagon',              url: 'https://www.octagon.com',                                           logo: 'https://mashiegolf.co.uk/wp-content/uploads/2025/07/untitled-design-57.png' },
];

export default function PartnersScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { width: winW } = useWindowDimensions();
  const tileW = Math.floor((winW - 32 - 12) / 2);

  const [fontsLoaded] = useFonts({
    [FF]:  require('../../assets/fonts/JUSTSans-Regular.otf'),
    [FFB]: require('../../assets/fonts/JUSTSans-ExBold.otf'),
  });
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: dc.bg }}><StatusBar style="light" /></View>;

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/')} style={s.headerBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color={dc.cardText} />
        </TouchableOpacity>
        <Text style={[s.title, { color: dc.cardText }]}>PARTNERS</Text>
        <View style={s.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.intro}>MASHIE's brand partners — tap a logo to visit their site.</Text>

        <View style={s.grid}>
          {PARTNERS.map(partner => (
            <TouchableOpacity
              key={partner.name}
              style={[s.card, { width: tileW, backgroundColor: dc.card, borderColor: dc.border }]}
              onPress={() => Linking.openURL(partner.url)}
              activeOpacity={0.8}
            >
              <View style={s.logoBox}>
                <Image source={{ uri: partner.logo }} style={s.logo} resizeMode="contain" />
              </View>
              <Text style={[s.cardTitle, { color: dc.cardText }]} numberOfLines={1}>{partner.name}</Text>
              <Ionicons name="open-outline" size={14} color={dc.textSecondary} style={s.openIcon} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingTop: 56 },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 16 },
  headerBtn: { width: 36, alignItems: 'center' },
  title:     { fontFamily: FFB, fontSize: 13, letterSpacing: 2 },

  scroll: { paddingHorizontal: 16, paddingBottom: 120 },
  intro:  { fontFamily: FF, fontSize: 13, color: '#888', lineHeight: 20, marginBottom: 16 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, alignItems: 'center' },

  logoBox: {
    width: '100%', height: 64, borderRadius: 12, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', padding: 10, marginBottom: 10,
  },
  logo: { width: '100%', height: '100%' },
  cardTitle: { fontFamily: FFB, fontSize: 12, textAlign: 'center' },
  openIcon:  { marginTop: 6 },
});
