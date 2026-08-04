import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { titanLogo } from '../../lib/assets';
import { useSocietyTheme } from '../../lib/SocietyThemeContext';

interface Props {
  isAdmin: boolean;
  avatarUrl: string | null;
}

export const SIDEBAR_W = 220;

const BASE_NAV = [
  { label: 'Home',         seg: undefined,       route: '/(app)/',             icon: 'home-outline'      },
  { label: 'Play',         seg: 'games',         route: '/(app)/games/new',    icon: 'golf-outline'      },
  { label: 'Tour',         seg: 'tour',          route: '/(app)/tour',         icon: 'trophy-outline'    },
  { label: 'Rangefinder',  seg: 'rangefinder',   route: '/(app)/rangefinder',  icon: 'navigate-outline'  },
] as const;

const ADMIN_NAV = [
  { label: 'Groups',  seg: 'groups', route: '/(app)/admin/groups', icon: 'people-outline'   },
  { label: 'Players', seg: 'players',route: '/(app)/admin/players',icon: 'person-add-outline'},
  { label: 'Admin',   seg: 'admin',  route: '/(app)/admin',        icon: 'settings-outline' },
] as const;

const BOTTOM_NAV = [
  { label: 'Profile', seg: 'profile', route: '/(app)/profile', icon: 'person-circle-outline' },
] as const;

export default function IpadSidebar({ isAdmin, avatarUrl }: Props) {
  const { palette, localLogo, logoUrl } = useSocietyTheme();
  const router   = useRouter();
  const segments = useSegments() as string[];

  const activeSeg = segments[1] as string | undefined;
  const isHome    = !activeSeg || activeSeg === 'index';

  function isActive(seg: string | undefined): boolean {
    if (seg === undefined) return isHome;
    if (seg === 'groups' || seg === 'players') {
      return activeSeg === 'admin' && (segments[2] === seg);
    }
    return activeSeg === seg;
  }

  const allNav = [
    ...BASE_NAV,
    ...(isAdmin ? ADMIN_NAV : []),
  ];

  function NavItem({ label, seg, route, icon }: { label: string; seg: string | undefined; route: string; icon: string }) {
    const active = isActive(seg);
    const color  = active ? palette.accent : '#6b7280';

    return (
      <TouchableOpacity
        key={label}
        style={[s.navItem, active && { backgroundColor: 'rgba(212,175,55,0.09)' }]}
        onPress={() => router.push(route as any)}
        activeOpacity={0.7}
      >
        {active && <View style={[s.activePill, { backgroundColor: palette.accent }]} />}
        <Ionicons name={icon as any} size={19} color={color} />
        <Text style={[s.navLabel, { color, fontWeight: active ? '700' : '400' }]}>{label}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[s.root, { borderRightColor: '#1c1c1c' }]}>
      {/* Logo */}
      <View style={s.logoWrap}>
        <Image
          source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)}
          style={s.logo}
          resizeMode="contain"
        />
      </View>

      <View style={s.divider} />

      {/* Main nav */}
      <View style={s.navSection}>
        {allNav.map(item => (
          <NavItem key={item.label} {...item} />
        ))}
      </View>

      <View style={{ flex: 1 }} />

      <View style={s.divider} />

      {/* Bottom nav */}
      <View style={[s.navSection, { marginBottom: 0 }]}>
        {BOTTOM_NAV.map(item => (
          <NavItem key={item.label} {...item} />
        ))}
        {/* Avatar chip */}
        {avatarUrl && (
          <TouchableOpacity
            style={s.avatarRow}
            onPress={() => router.push('/(app)/profile' as any)}
            activeOpacity={0.7}
          >
            <Image source={{ uri: avatarUrl }} style={s.avatarImg} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    position:         'absolute',
    left:             0,
    top:              0,
    bottom:           0,
    width:            SIDEBAR_W,
    backgroundColor:  '#0a0a0a',
    borderRightWidth: 1,
    paddingTop:       24,
    paddingBottom:    28,
    flexDirection:    'column',
    zIndex:           20,
  },
  logoWrap: {
    paddingHorizontal: 18,
    paddingBottom:     16,
  },
  logo:    { width: 150, height: 44 },
  divider: { height: 1, backgroundColor: '#1c1c1c', marginBottom: 10 },
  navSection: { marginBottom: 6 },
  navItem: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            12,
    paddingHorizontal: 20,
    paddingVertical:   11,
    position:       'relative',
  },
  activePill: {
    position:     'absolute',
    left:          0,
    top:           8,
    bottom:        8,
    width:         3,
    borderRadius:  2,
  },
  navLabel:   { fontSize: 13, letterSpacing: 0.2 },
  avatarRow:  { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 10 },
  avatarImg:  { width: 32, height: 32, borderRadius: 16 },
});
