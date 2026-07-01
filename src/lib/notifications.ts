import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const PROJECT_ID = '595df628-ba81-4fe5-82f7-d33ef97f274d';

export async function registerForPushNotifications(playerId: string) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
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

export async function sendMatchNotification(competitionId: string, title: string, body: string, playerIds?: string[]) {
  try {
    await supabase.functions.invoke('send-push', { body: { competitionId, title, body, playerIds } });
  } catch {}
}
