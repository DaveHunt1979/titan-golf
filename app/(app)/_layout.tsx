import { type ReactNode, useEffect, useState, useRef } from 'react';
import { Tabs, useRouter, usePathname } from 'expo-router';
import { AppState, Platform, View, TouchableOpacity, StyleSheet, Animated, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { CommonActions } from '@react-navigation/native';
import { supabase } from '../../src/lib/supabase';
import { registerForPushNotifications, currentRoute } from '../../src/lib/notifications';
import { titanLogo } from '../../src/lib/assets';
import { SocietyThemeProvider, useSocietyTheme } from '../../src/lib/SocietyThemeContext';
import { IS_PAD, SIDEBAR_W } from '../../src/lib/useDeviceLayout';
import IpadSidebar from '../../src/components/ipad/IpadSidebar';
import MessageAlert from '../../src/components/MessageAlert';

// Every section below with its own nested Stack (admin/, score/, swindle/,
// tour/, range/, games/, inbox/, profile/, trips/, chat/) keeps its full
// push history alive across tab switches — that's what makes Back work
// correctly while you're IN a section, but it also means returning to a
// tab you've drilled into resumes exactly where you left off instead of
// showing that section's hub (Dave, 2026-08-20 — "I click on admin and it
// wants me to build a tournament", after drilling into Build earlier).
// This resets a tab's nested stack back to its first screen every time
// that tab is pressed, whether switching in from elsewhere or re-tapping
// while already there — the standard React Navigation recipe for exactly
// this combination (nested stack inside a tab navigator).
function resetOnTabPress() {
  return ({ navigation, route }: any) => ({
    tabPress: () => {
      const state = navigation.getState();
      const tabRoute = state.routes.find((r: any) => r.name === route.name);
      if (tabRoute?.state && tabRoute.state.index > 0) {
        navigation.dispatch({
          ...CommonActions.reset({
            index: 0,
            routes: [{ name: tabRoute.state.routes[0].name }],
          }),
          target: tabRoute.state.key,
        });
      }
    },
  });
}

function TabIcon({ focused, children }: { focused: boolean; children: ReactNode }) {
  const { palette } = useSocietyTheme();
  return (
    <View style={{
      alignItems: 'center', justifyContent: 'center',
      paddingTop: Platform.OS === 'ios' ? 4 : 0,
    }}>
      {children}
      {focused && (
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: palette.accent, marginTop: 3 }} />
      )}
    </View>
  );
}

function SplashOverlay({ onDone }: { onDone: () => void }) {
  const { palette, localLogo, logoUrl, loaded } = useSocietyTheme();
  const scale   = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  // Pulsate + hard fallback
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.14, duration: 700, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.0,  duration: 700, useNativeDriver: true }),
      ])
    );
    pulse.start();
    const fallback = setTimeout(() => onDone(), 2500);
    return () => { pulse.stop(); clearTimeout(fallback); };
  }, []);

  // Fade out once society theme loaded
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 450, useNativeDriver: true })
        .start(() => onDone());
    }, 600);
    return () => clearTimeout(timer);
  }, [loaded]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[splash.overlay, { backgroundColor: palette.bg, opacity }]}
    >
      <Animated.Image
        source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)}
        style={[splash.logo, { transform: [{ scale }] }]}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

export default function AppLayout() {
  return (
    <SocietyThemeProvider>
      <AppLayoutInner />
    </SocietyThemeProvider>
  );
}

function AppLayoutInner() {
  const { palette } = useSocietyTheme();
  const router = useRouter();
  const pathname = usePathname();
  const [isAdmin,    setIsAdmin]    = useState(false);
  const [avatarUrl,  setAvatarUrl]  = useState<string | null>(null);
  const [playerId,   setPlayerId]   = useState<string | null>(null);
  const [showSplash, setShowSplash] = useState(true);
  const [messageAlert, setMessageAlert] = useState<{ senderName: string; preview: string; senderId?: string; channel?: string } | null>(null);

  useEffect(() => { loadProfile(); }, []);

  // Kept in a plain module ref (not React state) so notifications.ts's
  // handleNotification — a bare function, no hooks — can read the current
  // screen without needing to be a component itself.
  useEffect(() => { currentRoute.path = pathname; }, [pathname]);

  // Foreground-only: a message notification arriving while mid-round shows
  // the MessageAlert splash instead of the (now-suppressed, see
  // notifications.ts) system banner. Everywhere else the system banner
  // still handles it, so this only ever adds behavior, never removes it.
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(notification => {
      const data = notification.request.content.data as { type?: string; senderId?: string; channel?: string } | undefined;
      if (data?.type !== 'message' || !currentRoute.path.startsWith('/score/')) return;
      setMessageAlert({
        senderName: notification.request.content.title ?? 'New message',
        preview: notification.request.content.body ?? '',
        senderId: data.senderId,
        channel: data.channel,
      });
    });
    return () => sub.remove();
  }, []);

  // T-Card's live green dot (Dave, 2026-08-21) — a plain heartbeat, not
  // Realtime Presence: while the app is foregrounded, ping every 60s so
  // is_player_online() (last_active_at within 5 minutes) reads true.
  // Skipped entirely while backgrounded rather than relying on the OS to
  // pause the JS timer, which isn't guaranteed.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const touch = () => { supabase.rpc('touch_my_presence'); };
    const startIfActive = (state: string) => {
      if (state === 'active' && !interval) {
        touch();
        interval = setInterval(touch, 60000);
      } else if (state !== 'active' && interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    startIfActive(AppState.currentState);
    const sub = AppState.addEventListener('change', startIfActive);
    return () => { sub.remove(); if (interval) clearInterval(interval); };
  }, []);

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: player } = await supabase
      .from('players').select('id, display_name, avatar_url').eq('auth_uid', user.id).maybeSingle();
    if (!player) return;
    setAvatarUrl(player.avatar_url ?? null);
    setPlayerId(player.id);
    registerForPushNotifications(player.id);
    const { data: members } = await supabase
      .from('society_members').select('role')
      .eq('player_id', player.id);
    setIsAdmin((members ?? []).some(m => ['admin', 'owner'].includes((m.role ?? '').toLowerCase())));
  }

  const ic = (focused: boolean) =>
    focused ? palette.accent : palette.textSecondary;

  const tabsEl = (
    <Tabs
      screenOptions={{
        headerShown: false,
        ...(IS_PAD ? { sceneStyle: { marginLeft: SIDEBAR_W } } : {}),
        tabBarStyle: IS_PAD
          ? { display: 'none' }
          : {
              backgroundColor: '#0a0a0a',
              borderTopColor: '#1c1c1c',
              borderTopWidth: 1,
              height: Platform.OS === 'ios' ? 88 : 64,
              paddingBottom: Platform.OS === 'ios' ? 28 : 8,
            },
        ...(IS_PAD ? {} : {
          tabBarActiveTintColor:   palette.accent,
          tabBarInactiveTintColor: '#4b5563',
          tabBarLabelStyle: {
            fontSize: 10, fontWeight: '600', letterSpacing: 0.5, marginTop: 2,
          },
        }),
      }}
    >
        <Tabs.Screen name="index"          options={{ title: 'Home',     tabBarIcon: ({ focused }) => <TabIcon focused={focused}><HomeIcon        color={ic(focused)} /></TabIcon> }} />
        <Tabs.Screen name="score"          options={{ href: null }} listeners={resetOnTabPress()} />
        <Tabs.Screen name="tour"           options={{ href: null }} listeners={resetOnTabPress()} />
        <Tabs.Screen name="swindle"        options={{ href: null }} listeners={resetOnTabPress()} />
        <Tabs.Screen name="watch/index"    options={{ href: null }} />
        <Tabs.Screen name="chat"           options={{ href: null }} listeners={resetOnTabPress()} />
        <Tabs.Screen name="inbox"            options={{ href: null }} listeners={resetOnTabPress()} />
        <Tabs.Screen name="feed/index"     options={{ href: null }} />
        <Tabs.Screen name="camera/index"   options={{ title: 'Camera',   tabBarIcon: ({ focused }) => <TabIcon focused={focused}><CameraIcon      color={ic(focused)} /></TabIcon> }} />
        <Tabs.Screen name="profile"  options={{ title: 'Profile',  tabBarIcon: ({ focused }) => <TabIcon focused={focused}><ProfileIcon     color={ic(focused)} /></TabIcon> }} listeners={resetOnTabPress()} />
        <Tabs.Screen name="admin"    options={{ href: isAdmin ? undefined : null, title: 'Admin', tabBarIcon: ({ focused }) => <TabIcon focused={focused}><AdminIcon color={ic(focused)} /></TabIcon> }} listeners={resetOnTabPress()} />
        <Tabs.Screen name="games"                     options={{ href: null }} listeners={resetOnTabPress()} />
        <Tabs.Screen name="news/index"                options={{ href: null }} />
        <Tabs.Screen name="help/index"                options={{ href: null }} />
        <Tabs.Screen name="spectate/[matchId]"       options={{ href: null }} />
        <Tabs.Screen name="range"                     options={{ href: null }} listeners={resetOnTabPress()} />
        <Tabs.Screen name="rangefinder/index" options={{ href: null, sceneStyle: IS_PAD ? { marginLeft: 0 } : undefined }} />
        <Tabs.Screen name="records/index"             options={{ href: null }} />
        <Tabs.Screen name="trips"                     options={{ href: null }} listeners={resetOnTabPress()} />
        <Tabs.Screen name="friends"                  options={{ href: null }} />
        <Tabs.Screen name="add/[tag]"                options={{ href: null }} />
        <Tabs.Screen name="join" options={{ href: null, tabBarStyle: { display: 'none' } }} />
        <Tabs.Screen name="societies" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      </Tabs>
  );

  return (
    <View style={{ flex: 1 }}>
      {tabsEl}
      {IS_PAD && <IpadSidebar isAdmin={isAdmin} avatarUrl={avatarUrl} playerId={playerId} />}

      {showSplash && <SplashOverlay onDone={() => setShowSplash(false)} />}

      <MessageAlert
        visible={!!messageAlert}
        senderName={messageAlert?.senderName ?? ''}
        preview={messageAlert?.preview ?? ''}
        onDismiss={() => setMessageAlert(null)}
        onView={() => {
          const alert = messageAlert;
          setMessageAlert(null);
          if (!alert) return;
          if (alert.senderId) router.push(`/(app)/inbox/${alert.senderId}` as any);
          else if (alert.channel) router.push((alert.channel === 'general' ? '/(app)/chat' : `/(app)/chat/${alert.channel}`) as any);
        }}
      />
    </View>
  );
}

const splash = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  logo: { width: 160, height: 160 },
});

function GridIcon({ color }: { color: string }) {
  return (
    <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ flexDirection: 'row', gap: 3, marginBottom: 3 }}>
        <View style={{ width: 8, height: 8, backgroundColor: color, borderRadius: 2 }} />
        <View style={{ width: 8, height: 8, backgroundColor: color, borderRadius: 2 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        <View style={{ width: 8, height: 8, backgroundColor: color, borderRadius: 2 }} />
        <View style={{ width: 8, height: 8, backgroundColor: color, borderRadius: 2 }} />
      </View>
    </View>
  );
}
function CasualIcon({ color }: { color: string }) {
  return (
    <View style={{ width: 22, height: 22 }}>
      <View style={{ position: 'absolute', left: 4, top: 1, bottom: 3, width: 2, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ position: 'absolute', left: 6, top: 1, width: 12, height: 8, backgroundColor: color, borderRadius: 2 }} />
      <View style={{ position: 'absolute', bottom: 0, left: 1, right: 1, height: 2, backgroundColor: color, borderRadius: 1, opacity: 0.45 }} />
    </View>
  );
}
function SwindleIcon({ color }: { color: string }) {
  return (
    <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center', gap: 3 }}>
      <View style={{ width: 18, height: 2.5, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ width: 14, height: 2.5, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ width: 18, height: 2.5, backgroundColor: color, borderRadius: 1 }} />
    </View>
  );
}
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
function CameraIcon({ color }: { color: string }) {
  return (
    <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', top: 2, left: 7, width: 6, height: 2.5, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ width: 20, height: 14, borderRadius: 3, borderWidth: 2, borderColor: color, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: color }} />
      </View>
    </View>
  );
}
function AdminIcon({ color }: { color: string }) {
  return <View style={{ alignItems: 'center', justifyContent: 'center', width: 22, height: 22, gap: 3 }}>
    <View style={{ width: 16, height: 2, backgroundColor: color, borderRadius: 1 }} />
    <View style={{ width: 12, height: 2, backgroundColor: color, borderRadius: 1 }} />
    <View style={{ width: 16, height: 2, backgroundColor: color, borderRadius: 1 }} />
  </View>;
}
