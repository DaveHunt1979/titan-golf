import { useFonts } from 'expo-font';
import { useRouter } from 'expo-router';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { titanLogo } from '../../../src/lib/assets';

const PURPLE = '#a78bfa';
const GREEN  = '#4ade80';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';

// Clubhouse hub — chooses between the two competition types that live here.
// Swindle (existing) keeps its own untouched section at /(app)/swindle;
// Season (new, Dave's "Titan Season Mode" spec, 2026-09-02) gets its own
// section at /(app)/season, starting from a landing screen since the full
// season engine (divisions, promotion/relegation, Majors, verification) is
// a multi-session build, not a single-pass one.
export default function ClubhouseIndex() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { localLogo, logoUrl } = useSocietyTheme();

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });
  if (!fontsLoaded) return <View style={[s.container, { backgroundColor: dc.bg }]} />;

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />

      <View style={s.header}>
        <View style={s.headerCenter}>
          <Image source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)} style={s.logo} />
          <Text style={[s.headerSub, { color: dc.cardText }]}>CLUBHOUSE</Text>
        </View>
      </View>

      <View style={s.body}>
        <TouchableOpacity
          style={[s.card, { borderColor: `${PURPLE}40`, backgroundColor: `${PURPLE}12` }]}
          onPress={() => router.push('/(app)/swindle' as any)}
          activeOpacity={0.85}
        >
          <View style={[s.cardIconWrap, { backgroundColor: `${PURPLE}20`, borderColor: `${PURPLE}40` }]}>
            <Ionicons name="cash-outline" size={26} color={PURPLE} />
          </View>
          <Text style={[s.cardTitle, { color: PURPLE }]}>Swindle</Text>
          <Text style={s.cardSub}>Weekly roll-ups, live prize money, invite-only groups</Text>
          <Ionicons name="chevron-forward" size={18} color={PURPLE} style={s.cardChevron} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.card, { borderColor: `${GREEN}40`, backgroundColor: `${GREEN}12` }]}
          onPress={() => router.push('/(app)/season' as any)}
          activeOpacity={0.85}
        >
          <View style={[s.cardIconWrap, { backgroundColor: `${GREEN}20`, borderColor: `${GREEN}40` }]}>
            <Ionicons name="trophy-outline" size={26} color={GREEN} />
          </View>
          <View style={s.titleRow}>
            <Text style={[s.cardTitle, { color: GREEN }]}>Season</Text>
            <View style={s.newBadge}><Text style={s.newBadgeText}>NEW</Text></View>
          </View>
          <Text style={s.cardSub}>Year-long league · divisions · promotion & relegation</Text>
          <Ionicons name="chevron-forward" size={18} color={GREEN} style={s.cardChevron} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingTop: 56 },

  header:       { alignItems: 'center', paddingHorizontal: 16, marginBottom: 28 },
  headerCenter: { alignItems: 'center', gap: 4 },
  logo:         { width: 28, height: 28 },
  headerSub:    { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 2 },

  body: { paddingHorizontal: 16, gap: 16 },

  card: {
    borderRadius: 18, borderWidth: 1, padding: 20,
    position: 'relative', overflow: 'hidden',
  },
  cardIconWrap: {
    width: 48, height: 48, borderRadius: 14, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  titleRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  cardTitle:   { fontFamily: FFB, fontSize: 20 },
  cardSub:     { fontFamily: FF, fontSize: 13, color: '#9ca3af', lineHeight: 18, paddingRight: 24 },
  cardChevron: { position: 'absolute', top: 20, right: 18 },

  newBadge: {
    backgroundColor: GREEN, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  newBadgeText: { fontFamily: FFB, fontSize: 9, color: '#000', letterSpacing: 0.5 },
});
