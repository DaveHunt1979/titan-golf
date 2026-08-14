import ChatChannel from '../../../src/components/ChatChannel';

export default function TourChatScreen() {
  return (
    <ChatChannel
      channel="tour"
      title="Tournament Chat"
      subtitleLabel="The Tour"
      placeholder="Message the tour..."
    />
  );
}
