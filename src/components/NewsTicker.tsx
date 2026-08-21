import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { supabase } from '../lib/supabase';

const GOLD = '#D4AF37';
const FFB  = 'JUSTSans-ExBold';

type TickerItem = { text: string; createdAt: string };

function formatEvent(row: any): string | null {
  const p = row.payload ?? {};
  switch (row.type) {
    case 'hole_in_one': return `⛳ HOLE IN ONE! ${p.player} — hole ${p.hole}`;
    case 'eagle': return `🦅 EAGLE — ${p.player} on hole ${p.hole}`;
    case 'birdie': return `🐦 Birdie — ${p.player} on hole ${p.hole}`;
    case 'match_result': return p.message ? `🏆 ${p.message}` : null;
    case 'leader_change': return `📈 New leader: ${p.player} (${p.pts} pts)`;
    default: return null;
  }
}

// Sky-Sports-style scrolling ticker bar for Spectate mode — merges published
// Titan News headlines with live match events (birdies/eagles/hole-in-ones/
// match results/leader changes) written to the `notifications` table as a
// round is scored (Dave, 2026-08-20: "we get the opening messages, we want
// more" — was previously News-only and never updated live).
export default function NewsTicker({ competitionId, matchId }: { competitionId: string | null; matchId?: string | null }) {
  const [newsItems, setNewsItems] = useState<TickerItem[]>([]);
  const [eventItems, setEventItems] = useState<TickerItem[]>([]);
  const translateX = useRef(new Animated.Value(0)).current;
  const [copyWidth, setCopyWidth] = useState(0);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!competitionId) { setNewsItems([]); return; }
    let active = true;
    async function load() {
      const { data } = await supabase
        .from('titan_news').select('headline, created_at')
        .eq('competition_id', competitionId).eq('status', 'published')
        .order('created_at', { ascending: false }).limit(10);
      if (active) setNewsItems(((data ?? []) as any[]).filter(d => d.headline).map(d => ({ text: d.headline, createdAt: d.created_at })));
    }
    load();
    const sub = supabase.channel(`titan-news-ticker-${competitionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'titan_news', filter: `competition_id=eq.${competitionId}` }, load)
      .subscribe();
    return () => { active = false; supabase.removeChannel(sub); };
  }, [competitionId]);

  useEffect(() => {
    if (!matchId) { setEventItems([]); return; }
    let active = true;
    async function load() {
      const { data } = await supabase
        .from('notifications').select('type, payload, created_at')
        .eq('match_id', matchId)
        .order('created_at', { ascending: false }).limit(15);
      if (!active) return;
      const items = ((data ?? []) as any[])
        .map(row => ({ text: formatEvent(row), createdAt: row.created_at }))
        .filter((i): i is TickerItem => !!i.text);
      setEventItems(items);
    }
    load();
    const sub = supabase.channel(`spectator-ticker-${matchId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `match_id=eq.${matchId}` }, load)
      .subscribe();
    return () => { active = false; supabase.removeChannel(sub); };
  }, [matchId]);

  // Two back-to-back copies of the same text, animated left by exactly one
  // copy's width then looped — the loop resets to 0 exactly where copy two
  // already is, so it reads as continuous scroll rather than a hard cut.
  useEffect(() => {
    animRef.current?.stop();
    if (!copyWidth) return;
    translateX.setValue(0);
    const duration = copyWidth * 22; // steady, readable pace regardless of headline length
    animRef.current = Animated.loop(
      Animated.timing(translateX, { toValue: -copyWidth, duration, easing: Easing.linear, useNativeDriver: true })
    );
    animRef.current.start();
    return () => animRef.current?.stop();
  }, [copyWidth]);

  const combined = [...eventItems, ...newsItems]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(i => i.text);

  if (!combined.length) return null;
  const text = `  ${combined.join('     •     ')}     •     `;

  return (
    <View style={s.bar}>
      <View style={s.badge}><Text style={s.badgeText}>TITAN NEWS</Text></View>
      <View style={s.track}>
        <Animated.View style={[s.row, { transform: [{ translateX }] }]}>
          <Text style={s.text} numberOfLines={1} onLayout={e => setCopyWidth(e.nativeEvent.layout.width)}>{text}</Text>
          <Text style={s.text} numberOfLines={1}>{text}</Text>
        </Animated.View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', height: 34,
    backgroundColor: '#0a0a0a', borderTopWidth: 1, borderTopColor: '#1c1c1c',
  },
  badge: { backgroundColor: GOLD, paddingHorizontal: 10, height: '100%', alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: FFB, fontSize: 10, color: '#000', letterSpacing: 0.5 },
  track: { flex: 1, height: '100%', overflow: 'hidden', justifyContent: 'center', alignItems: 'flex-start' },
  row:  { flexDirection: 'row' },
  text: { fontFamily: FFB, fontSize: 12, color: '#fff' },
});
