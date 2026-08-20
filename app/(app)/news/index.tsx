import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { goBack } from '../../../src/lib/navigation';

// Must match the key the Home screen's Titan News badge reads in app/(app)/index.tsx.
const NEWS_READ_KEY = 'titan_news_last_read';
const FFB = 'JUSTSans-ExBold';
const FF  = 'JUSTSans';
const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

const STORY_LABEL: Record<string, string> = { preview: 'Preview', round_report: 'Round Report', final_report: 'Final Report', casual_final: 'Match Report' };

type Article = {
  id: string; story_type: string; headline: string | null; summary: string | null; body: string | null;
  created_at: string; competitions?: { name: string } | null;
};

export default function TitanNewsScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { societyId } = useSocietyTheme();
  const { competitionId, matchId } = useLocalSearchParams<{ competitionId?: string; matchId?: string }>();

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [articles, setArticles]   = useState<Article[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded]   = useState<string | null>(null);

  const load = useCallback(async () => {
    // Filtering on an embedded relation's column requires `!inner` (a plain
    // left-join embed can't be used to narrow the top-level rows) — only
    // needed for the global view, which scopes to the currently active
    // society rather than every society this player belongs to.
    let query = matchId
      ? supabase.from('titan_news')
          .select('id, story_type, headline, summary, body, created_at')
          .eq('match_id', matchId)
      : competitionId
      ? supabase.from('titan_news')
          .select('id, story_type, headline, summary, body, created_at, competitions(name)')
          .eq('competition_id', competitionId)
      : supabase.from('titan_news')
          .select('id, story_type, headline, summary, body, created_at, competitions!inner(name, society_id)')
          .eq('competitions.society_id', societyId);

    const { data } = await query.eq('status', 'published').order('created_at', { ascending: false });
    setArticles((data ?? []) as any as Article[]);
    setLoading(false);
    setRefreshing(false);
  }, [competitionId, matchId, societyId]);

  useFocusEffect(useCallback(() => {
    load();
    AsyncStorage.setItem(NEWS_READ_KEY, new Date().toISOString());
  }, [load]));

  if (!fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: dc.bg }}><StatusBar style="light" /></View>
  );

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/')} hitSlop={HIT}>
          <Text style={[s.back, { color: dc.gold }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: dc.cardText }]}>Titan News</Text>
        <View style={{ width: 50 }} />
      </View>
      <Text style={[s.subtitle, { color: dc.textSecondary }]}>
        {competitionId ? 'AI-written reports for this tournament' : 'AI-written tournament reports across your society'}
      </Text>

      {loading ? (
        <ActivityIndicator color={dc.gold} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={dc.gold} />}
        >
          {articles.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyEmoji}>📰</Text>
              <Text style={[s.emptyTitle, { color: dc.cardText }]}>No stories published yet</Text>
            </View>
          ) : articles.map(a => {
            const isOpen = expanded === a.id;
            return (
              <TouchableOpacity
                key={a.id}
                style={[s.card, { backgroundColor: dc.card, borderColor: dc.border }]}
                onPress={() => setExpanded(isOpen ? null : a.id)}
                activeOpacity={0.85}
              >
                <Text style={[s.cardType, { color: dc.gold }]}>
                  {STORY_LABEL[a.story_type] ?? a.story_type}{!competitionId && a.competitions ? ` · ${a.competitions.name}` : ''}
                </Text>
                <Text style={[s.headline, { color: dc.cardText }]}>{a.headline}</Text>
                <Text style={[s.summary, { color: dc.textSecondary }]} numberOfLines={isOpen ? undefined : 2}>{a.summary}</Text>
                {isOpen && !!a.body && <Text style={[s.body, { color: dc.textSecondary }]}>{a.body}</Text>}
              </TouchableOpacity>
            );
          })}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 8,
  },
  back:  { fontSize: 14, fontFamily: FFB },
  title: { fontSize: 16, fontFamily: FFB },
  subtitle: { fontSize: 12, fontFamily: FF, paddingHorizontal: 20, marginBottom: 16 },

  scroll: { paddingHorizontal: 20, gap: 12 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16 },
  cardType: { fontSize: 10, fontFamily: FFB, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  headline: { fontSize: 16, fontFamily: FFB, marginBottom: 6 },
  summary:  { fontSize: 13, fontFamily: FF, lineHeight: 19 },
  body:     { fontSize: 13, fontFamily: FF, lineHeight: 20, marginTop: 12 },

  empty:      { alignItems: 'center', marginTop: 60, gap: 8, paddingHorizontal: 40 },
  emptyEmoji: { fontSize: 40 },
  emptyTitle: { fontSize: 15, fontFamily: FFB },
});
