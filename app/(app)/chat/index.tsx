import ChatChannel from '../../../src/components/ChatChannel';

export default function ChatScreen() {
  return (
    <ChatChannel
      channel="general"
      title="Chat"
      subtitleLabel="Society Group"
      placeholder="Message the boys..."
    />
  );
}
