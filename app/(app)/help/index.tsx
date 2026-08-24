import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { goBack } from '../../../src/lib/navigation';

const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';

interface Topic {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string[];
}

const TOPICS: Topic[] = [
  {
    id: 'getting-started',
    icon: 'home-outline',
    title: 'Getting Started',
    body: [
      'The Home screen is your hub — the four big tiles at the top take you into Casual Golf, Swindle, Tournaments and your Profile. Below that, the quick-link row covers Chat, Records, History and the Shop, then a second row for Up & Coming trips, your Inbox, Titan News and this Help page.',
      'A red badge on Chat, Inbox or Titan News means there\'s something new waiting for you.',
      'If a friend is out on a round right now, you\'ll see them under "Playing Now" — tap through to watch live via Spectator Mode.',
    ],
  },
  {
    id: 'casual-golf',
    icon: 'golf-outline',
    title: 'Casual Golf',
    body: [
      'Start a round from the Casual Golf tile — pick your format (matchplay, Stableford, Medal and more), add players, choose a course and tee off.',
      'Side games: when you switch on Stableford or Medal as a secondary game, Titan keeps every player scoring all 18 holes even after a matchplay match is decided early (e.g. "3&2") — that extra scoring feeds your side-game result and, in tournaments with an individual standings board enabled, the cumulative Individual (called Kronos in Titan Way) standings.',
      'Track Stats lets you log fairways, putts and more as you play. Chip & Birdie is Titan\'s voice commentary — toggle it on for eagle/birdie call-outs and light banter during your round.',
      'Use the in-round camera to snap a branded photo with your name, course and hole burned into the shot, ready to share.',
      'When the round finishes, everyone in it gets an AI-written match report in their Inbox.',
    ],
  },
  {
    id: 'swindle',
    icon: 'cash-outline',
    title: 'Swindle',
    body: [
      'Swindle is your society\'s standalone weekly competition — invite-only membership, with live prize money and season-long stats.',
      'Join a Swindle session, get grouped in on the first tee, and score the same way you would a Casual round — group scoring, side games and Chip & Birdie voice all work the same way here too.',
      'After a Swindle session ends, settlement is worked out automatically and sent to everyone involved as a message in their Inbox — tap it to view and mark it settled.',
    ],
  },
  {
    id: 'tournaments',
    icon: 'trophy-outline',
    title: 'Tournaments (Titan Tour)',
    body: [
      'Enter a live tournament with the PIN your admin shares with you. Once you\'re in, the Tournament home screen gives you four areas: Leaderboard, Info Pack, Live & Social, and Prize Positions.',
      'Leaderboard has its own tabs — Group (day-by-day fixtures and results), Team (combined team standings), Individual (cumulative individual Stableford across every round — called Kronos in Titan Way) and Honours.',
      'If you\'re in a live match, a gold "YOUR MATCH" banner appears at the top of the Tournament screen — tap it to jump straight into scoring or resume where you left off.',
      'Prize Positions shows the individual leaderboard with prize money next to each position, plus a separate Individual overall-winner prize (Kronos in Titan Way) and each handicap division\'s payouts underneath.',
      'Titan News publishes AI-written previews, round reports and a final tournament report as the event unfolds — read them from the Tournament screen or via a link sent to your Inbox.',
    ],
  },
  {
    id: 't-card',
    icon: 'people-outline',
    title: 'T-Card & Player Library',
    body: [
      'Tap any other member — from Friends, the Player Library, or a leaderboard — to bring up their T-Card: a trading-card style popup with their photo, live status, handicap and last few rounds.',
      'From a T-Card you can send that player a message straight into their Inbox.',
    ],
  },
  {
    id: 'inbox',
    icon: 'mail-outline',
    title: 'Inbox',
    body: [
      'Your Inbox holds direct messages, tournament invites, match reports, Titan Newsreel links and Swindle settlements, grouped into one thread per person.',
      'Tap a conversation to open it and reply. To delete a message you\'ve sent, long-press it and confirm — this can\'t be undone.',
      'Tournament invites and settlement messages have their own buttons built in (Accept/Decline, View & Mark Settled) — just tap them directly in the thread.',
    ],
  },
  {
    id: 'records',
    icon: 'ribbon-outline',
    title: 'Records & History',
    body: [
      'Records shows your society\'s Wall of Records — the best rounds and standout stats ever posted.',
      'History lists every round you\'ve played, casual and competitive, so you can look back on past scores.',
    ],
  },
  {
    id: 'up-and-coming',
    icon: 'card-outline',
    title: 'Up & Coming',
    body: [
      'Up & Coming lists your society\'s planned trips and events. Tap in to see the details and who else is going.',
    ],
  },
  {
    id: 'spectate',
    icon: 'eye-outline',
    title: 'Spectator & Broadcast Mode',
    body: [
      'Tap a live match anywhere in the app — a friend "Playing Now" on Home, or a fixture on a Tournament leaderboard — to watch it live in Spectator Mode, with scores updating hole by hole.',
      'On an iPad, turn on Broadcast Mode from the scoring screen for a wide-screen split view built for laying the device flat on a cart or table so the group can see the leaderboard as they play.',
    ],
  },
  {
    id: 'troubleshooting',
    icon: 'help-buoy-outline',
    title: 'Troubleshooting',
    body: [
      'Score not saving? Titan queues your holes locally and syncs automatically the moment you\'re back online — nothing is lost, it just catches up.',
      'Can\'t see a tournament? You need to enter its PIN once from the Tournament tab before it shows up for you.',
      'Wrong society showing? Check the society switcher in Locker Room / Profile — some members belong to more than one society.',
      'Still stuck? Message your society admin from Inbox — tap the pencil icon on the Inbox screen to start a new conversation.',
    ],
  },
];

export default function HelpScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const [openId, setOpenId] = useState<string | null>(null);

  const [fontsLoaded] = useFonts({
    [FF]:  require('../../../assets/fonts/JUSTSans-Regular.otf'),
    [FFB]: require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: dc.bg }}><StatusBar style="light" /></View>;

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/')} style={s.headerBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color={dc.cardText} />
        </TouchableOpacity>
        <Text style={[s.title, { color: dc.cardText }]}>HELP & GUIDE</Text>
        <View style={s.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.intro}>
          A quick guide to what's in Titan Golf and how to use it. Tap a topic to expand it.
        </Text>

        {TOPICS.map(topic => {
          const open = openId === topic.id;
          return (
            <View key={topic.id} style={[s.card, { backgroundColor: dc.card, borderColor: dc.border }]}>
              <TouchableOpacity
                style={s.cardHeader}
                onPress={() => setOpenId(open ? null : topic.id)}
                activeOpacity={0.75}
              >
                <View style={[s.iconBox, { backgroundColor: dc.iconBoxBg, borderColor: dc.iconBoxBorder }]}>
                  <Ionicons name={topic.icon} size={18} color={dc.iconBoxIcon} />
                </View>
                <Text style={[s.cardTitle, { color: dc.cardText }]}>{topic.title}</Text>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={dc.cardText} />
              </TouchableOpacity>

              {open && (
                <View style={s.cardBody}>
                  {topic.body.map((p, i) => (
                    <Text key={i} style={s.paragraph}>{p}</Text>
                  ))}
                </View>
              )}
            </View>
          );
        })}

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

  scroll: { paddingHorizontal: 16, paddingBottom: 40 },
  intro:  { fontFamily: FF, fontSize: 13, color: '#888', lineHeight: 20, marginBottom: 16 },

  card:       { borderRadius: 14, borderWidth: 1, marginBottom: 10, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  iconBox:    { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  cardTitle:  { flex: 1, fontFamily: FFB, fontSize: 14 },

  cardBody:  { paddingHorizontal: 14, paddingBottom: 16, gap: 10 },
  paragraph: { fontFamily: FF, fontSize: 13, color: '#999', lineHeight: 20 },
});
