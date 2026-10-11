import { useLocalSearchParams } from 'expo-router';
import ChatChannel from '../../../../src/components/ChatChannel';

export default function Social18Chat() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  return (
    <ChatChannel
      channel="social"
      socialEventId={eventId}
      title="Social 18 Chat"
      subtitleLabel="Event"
      placeholder="Message the group..."
      backFallback={`/(app)/social18/${eventId}`}
      alwaysReplaceOnBack
    />
  );
}
