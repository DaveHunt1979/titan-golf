import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { supabase } from '../lib/supabase';

const GOLD = '#D4AF37';
const FFB  = 'JUSTSans-ExBold';

// Sky-Sports-style scrolling headline bar for Spectate mode — published
// Titan News headlines only (no live match notifications, by design: those
// already have their own live pill/updates elsewhere on this screen).
export default function NewsTicker({ competitionId }: { competitionId: string | null }) {
  const [headlines, setHeadlines] = useState<string[]>([]);
  const translateX = useRef(new Animated.Value(0)).current;
  const [copyWidth, setCopyWidth] = useState(0);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!competitionId) return;
    let active = true;
    async function load() {
      const { data } = await supabase
        .from('titan_news').select('headline')
        .eq('competition_id', competitionId).eq('status', 'published')
        .order('created_at', { ascending: false }).limit(10);
      if (active) setHeadlines(((data ?? []) as any[]).map(d => d.headline).filter(Boolean));
    }
    load();
    const sub = supabase.channel(`titan-news-ticker-${competitionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'titan_news', filter: `competition_id=eq.${competitionId}` }, load)
      .subscribe();
    return () => { active = false; supabase.removeChannel(sub); };
  }, [competitionId]);

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

  if (!headlines.length) return null;
  const text = `  ${headlines.join('     •     ')}     •     `;

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
