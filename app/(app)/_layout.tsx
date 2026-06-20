import { type ReactNode, useEffect, useState } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { Platform, View, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { supabase } from '../../src/lib/supabase';
import { colors, fonts, spacing } from '../../src/lib/theme';

function TabIcon({ focused, children }: { focused: boolean; children: ReactNode }) {
  return (
    <View style={{
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: Platform.OS === 'ios' ? spacing.xs : 0,
    }}>
      {children}
      {focused && (
        <View style={{
          width: 4,
          height: 4,
          borderRadius: 2,
          backgroundColor: colors.gold,
          marginTop: 3,
        }} />
      )}
    </View>
  );
}

export default function AppLayout() {
  const router = useRouter();
  const [isAdmin,   setIsAdmin]   = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: player } = await supabase
      .from('players').select('id, display_name, avatar_url').eq('auth_uid', user.id).maybeSingle();
    if (!player) return;
    setAvatarUrl(player.avatar_url ?? null);
    const { data: member } = await supabase
      .from('society_members').select('role')
      .eq('player_id', player.id)
      .in('role', ['admin', 'owner'])
      .maybeSingle();
    setIsAdmin(!!member);
  }

  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingBottom: Platform.OS === 'ios' ? 28 : 8,
        },
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: {
          fontSize: fonts.xs,
          fontWeight: '600',
          letterSpacing: 0.5,
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused}>
              <HomeIcon color={focused ? colors.gold : colors.textMuted} />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="score/index"
        options={{
          title: 'Score',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused}>
              <ScoreIcon color={focused ? colors.gold : colors.textMuted} />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="tour/index"
        options={{
          title: 'Tour',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused}>
              <TourIcon color={focused ? colors.gold : colors.textMuted} />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="leaderboard/index"
        options={{
          title: 'Standings',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused}>
              <LeaderboardIcon color={focused ? colors.gold : colors.textMuted} />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="watch/index"
        options={{
          title: 'Live',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused}>
              <WatchIcon color={focused ? colors.gold : colors.textMuted} />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="feed/index"
        options={{
          title: 'Feed',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused}>
              <FeedIcon color={focused ? colors.gold : colors.textMuted} />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="profile/index"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused}>
              <ProfileIcon color={focused ? colors.gold : colors.textMuted} />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="admin/index"
        options={{
          href: isAdmin ? undefined : null,
          title: 'Admin',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused}>
              <AdminIcon color={focused ? colors.gold : colors.textMuted} />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen name="admin/build" options={{ href: null }} />
      <Tabs.Screen name="games/new" options={{ href: null }} />
      <Tabs.Screen name="score/[matchId]" options={{ href: null }} />
      <Tabs.Screen name="score/enter/[matchId]" options={{ href: null }} />
      <Tabs.Screen name="score/solo/[matchId]" options={{ href: null }} />
      <Tabs.Screen name="tour/day/[dayId]" options={{ href: null }} />
      <Tabs.Screen name="admin/info" options={{ href: null }} />
      <Tabs.Screen name="admin/create-society" options={{ href: null }} />
      <Tabs.Screen name="admin/players" options={{ href: null }} />
      <Tabs.Screen name="admin/branding" options={{ href: null }} />
      <Tabs.Screen name="admin/teams" options={{ href: null }} />
      <Tabs.Screen name="admin/courses" options={{ href: null }} />
      <Tabs.Screen name="camera/index" options={{ href: null }} />
      <Tabs.Screen name="spectate/[matchId]" options={{ href: null }} />
      <Tabs.Screen name="profile/handicap" options={{ href: null }} />
      <Tabs.Screen name="join" options={{ href: null, tabBarStyle: { display: 'none' } }} />
    </Tabs>

    {/* Floating camera button — player avatar in corner */}
    <TouchableOpacity
        style={fab.btn}
        onPress={() => router.push('/(app)/camera' as any)}
        activeOpacity={0.85}
      >
        {avatarUrl
          ? <Image source={{ uri: avatarUrl }} style={fab.avatar} />
          : <View style={fab.avatarFallback}>
              <View style={fab.camIcon}>
                <View style={fab.camBody} />
                <View style={fab.camLens} />
              </View>
            </View>
        }
        <View style={fab.camBadge}>
          <View style={fab.camBadgeInner} />
        </View>
      </TouchableOpacity>
    </View>
  );
}

const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 88 : 64;

const fab = StyleSheet.create({
  btn: {
    position: 'absolute',
    bottom: TAB_BAR_HEIGHT + spacing.md,
    right: spacing.md,
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.gold,
    zIndex: 100,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  camIcon:  { alignItems: 'center', justifyContent: 'center' },
  camBody:  { width: 20, height: 14, borderRadius: 3, borderWidth: 2, borderColor: colors.gold },
  camLens:  { position: 'absolute', width: 7, height: 7, borderRadius: 4, borderWidth: 2, borderColor: colors.gold },
  camBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  camBadgeInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.gold,
  },
});

// Inline SVG-free icons using Unicode / text glyphs
function HomeIcon({ color }: { color: string }) {
  return <View style={{ alignItems: 'center', width: 22, height: 22, justifyContent: 'flex-end' }}>
    <View style={{ width: 16, height: 12, backgroundColor: color, borderRadius: 2 }} />
    <View style={{ position: 'absolute', top: 0, width: 0, height: 0, borderLeftWidth: 11, borderRightWidth: 11, borderBottomWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color }} />
  </View>;
}
function ScoreIcon({ color }: { color: string }) {
  return <View style={{ width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ width: 10, height: 2, backgroundColor: color, marginBottom: 2 }} />
    <View style={{ width: 10, height: 2, backgroundColor: color }} />
  </View>;
}
function TourIcon({ color }: { color: string }) {
  return <View style={{ alignItems: 'center', justifyContent: 'center', width: 22, height: 22 }}>
    <View style={{ width: 2, height: 18, backgroundColor: color, borderRadius: 1, position: 'absolute', left: 4 }} />
    <View style={{ width: 13, height: 9, backgroundColor: color, borderRadius: 2, position: 'absolute', left: 6, top: 1 }} />
  </View>;
}
function LeaderboardIcon({ color }: { color: string }) {
  return <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3 }}>
    <View style={{ width: 5, height: 10, backgroundColor: color, borderRadius: 1 }} />
    <View style={{ width: 5, height: 16, backgroundColor: color, borderRadius: 1 }} />
    <View style={{ width: 5, height: 12, backgroundColor: color, borderRadius: 1 }} />
  </View>;
}
function CameraIcon({ color }: { color: string }) {
  return <View style={{ alignItems: 'center', justifyContent: 'center', width: 22, height: 22 }}>
    <View style={{ width: 20, height: 14, borderRadius: 3, borderWidth: 2, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: color }} />
    </View>
    <View style={{ position: 'absolute', top: 0, right: 4, width: 6, height: 4, borderRadius: 1, backgroundColor: color, opacity: 0.7 }} />
  </View>;
}
function WatchIcon({ color }: { color: string }) {
  return <View style={{ alignItems: 'center', gap: 2 }}>
    <View style={{ width: 20, height: 14, borderRadius: 2, borderWidth: 2, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 6, height: 6, borderRadius: 1, borderWidth: 1.5, borderColor: color, opacity: 0.7 }} />
    </View>
    <View style={{ width: 8, height: 2, backgroundColor: color, borderRadius: 1 }} />
  </View>;
}
function FeedIcon({ color }: { color: string }) {
  return <View style={{ gap: 4 }}>
    <View style={{ width: 20, height: 2, backgroundColor: color, borderRadius: 1 }} />
    <View style={{ width: 14, height: 2, backgroundColor: color, borderRadius: 1 }} />
    <View style={{ width: 20, height: 2, backgroundColor: color, borderRadius: 1 }} />
  </View>;
}
function ProfileIcon({ color }: { color: string }) {
  return <View style={{ alignItems: 'center', gap: 2 }}>
    <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: color }} />
    <View style={{ width: 18, height: 8, borderRadius: 9, borderWidth: 2, borderColor: color, borderBottomWidth: 0 }} />
  </View>;
}
function AdminIcon({ color }: { color: string }) {
  return <View style={{ alignItems: 'center', justifyContent: 'center', width: 22, height: 22, gap: 3 }}>
    <View style={{ width: 16, height: 2, backgroundColor: color, borderRadius: 1 }} />
    <View style={{ width: 12, height: 2, backgroundColor: color, borderRadius: 1 }} />
    <View style={{ width: 16, height: 2, backgroundColor: color, borderRadius: 1 }} />
  </View>;
}
