import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const PROJECT_ID = '595df628-ba81-4fe5-82f7-d33ef97f274d';

// Updated by the root layout's usePathname() on every navigation — read
// here (a plain module, no hooks) to decide whether a message notification
// arriving in the foreground should show the system banner or be suppressed
// in favor of the in-game MessageAlert splash (Dave, 2026-09-02: "if it is
// in a game, can we have a little pop up like the birdie or eagle splash
// screen" instead of the default banner interrupting live scoring).
export const currentRoute = { path: '' };
export function isOnLiveScoreScreen() {
  return currentRoute.path.startsWith('/score/');
}

export async function registerForPushNotifications(playerId: string) {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const isMessage = notification.request.content.data?.type === 'message';
      const suppress = isMessage && isOnLiveScoreScreen();
      return {
        shouldShowAlert: !suppress,
        shouldShowBanner: !suppress,
        shouldShowList: !suppress,
        shouldPlaySound: true,
        // The icon badge itself comes from the push payload's own `badge`
        // value (send-push sets it server-side so it's right even for a
        // killed app) — this only governs whether the OS applies that
        // number while the notification is actually being delivered here.
        shouldSetBadge: true,
      };
    },
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('titan-golf', {
      name: 'Titan Golf',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return;

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID });
    if (token) {
      await supabase.from('players').update({ push_token: token } as any).eq('id', playerId);
    }
  } catch {}
}

// Opening the app is treated as "seen your notifications" — clears both the
// OS-level icon badge immediately and the server-side counter so the next
// push starts counting up from 0 again instead of stacking on the old total.
export async function clearBadgeCount() {
  try {
    await Notifications.setBadgeCountAsync(0);
    await supabase.rpc('reset_my_badge_count');
  } catch {}
}

export async function sendMatchNotification(competitionId: string, title: string, body: string, playerIds?: string[]) {
  try {
    await supabase.functions.invoke('send-push', { body: { competitionId, title, body, playerIds } });
  } catch {}
}

// Generic sibling to sendMatchNotification for anything not scoped to a
// competition (DMs, chat channels) — send-push already accepts a direct
// playerIds array with no competitionId, so no edge-function change needed.
export async function sendPushNotification(title: string, body: string, playerIds: string[], data?: Record<string, unknown>) {
  if (!playerIds.length) return;
  try {
    await supabase.functions.invoke('send-push', { body: { title, body, playerIds, data } });
  } catch {}
}

// Feeds Spectator Mode's live ticker (NewsTicker.tsx) — separate from the
// push-notification system above, which only fires for tournament matches
// (needs competition_players to resolve who to push to). This has no such
// restriction: works for Casual Golf too, since Spectator Mode is used
// there just as much (Dave, 2026-08-20 — "we get the opening messages, we
// want more"). Fire-and-forget by design — a missed ticker event should
// never interrupt scoring.
export async function postSpectatorEvent(matchId: string, type: string, payload: Record<string, any>) {
  try {
    await supabase.from('notifications').insert({ match_id: matchId, type, payload, target: 'spectator' });
  } catch {}
}
