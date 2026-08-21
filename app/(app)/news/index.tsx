import { useCallback, useState } from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../../src/lib/supabase';
import { useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { goBack } from '../../../src/lib/navigation';
import { titanLogo } from '../../../src/lib/assets';
import { speakerName, speakerPortrait, sceneImage, type BanterSpeaker } from '../../../src/lib/titanBanter';

// Must match the key the Home screen's Titan News badge reads in app/(app)/index.tsx.
const NEWS_READ_KEY = 'titan_news_last_read';
const FFB = 'JUSTSans-ExBold';
const FF  = 'JUSTSans';
const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

// Titan News is always Titan-branded black/gold, not the active society's
// own theme (Dave, 2026-08-21 — "the report [needs] to be Titan branded,
// with the logo, the black and gold") — every other screen uses
// useDynamicColors() for per-society branding; this one deliberately
// doesn't.
const GOLD = '#D4AF37';
const BG = '#000';
const CARD = '#111';
const BORDER = '#1c1c1c';
const TEXT = '#fff';
const MUTED = '#9ca3af';

const STORY_LABEL: Record<string, string> = { preview: 'Preview', round_report: 'Round Report', final_report: 'Final Report', casual_final: 'Match Report' };

type Article = {
  id: string; story_type: string; headline: string | null; summary: string | null; body: string | null;
  created_at: string; competitions?: { name: string } | null;
  banter_speaker: BanterSpeaker | null; banter_text: string | null; banter_scene: string | null;
};

export default function TitanNewsScreen() {
  const router = useRouter();
  const { societyId } = useSocietyTheme();
  const { competitionId, matchId, back } = useLocalSearchParams<{ competitionId?: string; matchId?: string; back?: string }>();

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
    const cols = 'id, story_type, headline, summary, body, created_at, banter_speaker, banter_text, banter_scene';
    let query = matchId
      ? supabase.from('titan_news')
          .select(cols)
          .eq('match_id', matchId)
      : competitionId
      ? supabase.from('titan_news')
          .select(`${cols}, competitions(name)`)
          .eq('competition_id', competitionId)
      : supabase.from('titan_news')
          .select(`${cols}, competitions!inner(name, society_id)`)
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
    <View style={{ flex: 1, backgroundColor: BG }}><StatusBar style="light" /></View>
  );

  return (
    <View style={[s.container, { backgroundColor: BG }]}>
      <StatusBar style="light" />

      <View style={s.header}>
        {/* "news" is its own top-level (hidden) tab — see app/(app)/_layout.tsx
            — so pushing into it from score/solo or score/enter jumps to a
            different tab's own navigator. canGoBack() still reports true
            there (cross-tab state, not this tab's own history) and
            goBack()'s router.back() branch resolves it back to Home instead
            of the round-complete screen the player actually came from —
            passing `back` as goBack()'s fallback never even runs, since
            that branch is only reached when canGoBack() is false. When the
            caller knows exactly where "back" should go, use that directly
            instead of gambling on cross-tab back semantics (Dave, 2026-08-21
            — "back button ... still went back to the main menu"). */}
        <TouchableOpacity onPress={() => (back ? router.replace(back as any) : goBack(router, '/(app)/'))} hitSlop={HIT} style={s.headerSide}>
          <Text style={[s.back, { color: GOLD }]}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={[s.title, { color: TEXT }]}>TITAN NEWS</Text>
        </View>
        <View style={s.headerSide} />
      </View>
      <Text style={[s.subtitle, { color: MUTED }]}>
        {competitionId ? 'AI-written reports for this tournament' : 'AI-written tournament reports across your society'}
      </Text>

      {loading ? (
        <ActivityIndicator color={GOLD} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={GOLD} />}
        >
          {articles.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyEmoji}>📰</Text>
              <Text style={[s.emptyTitle, { color: TEXT }]}>No stories published yet</Text>
            </View>
          ) : articles.map(a => {
            const isOpen = expanded === a.id;
            const scene = sceneImage(a.banter_scene);
            return (
              <TouchableOpacity
                key={a.id}
                style={[s.card, { backgroundColor: CARD, borderColor: BORDER }]}
                onPress={() => setExpanded(isOpen ? null : a.id)}
                activeOpacity={0.85}
              >
                <Text style={[s.cardType, { color: GOLD }]}>
                  {STORY_LABEL[a.story_type] ?? a.story_type}{!competitionId && a.competitions ? ` · ${a.competitions.name}` : ''}
                </Text>
                <Text style={[s.headline, { color: TEXT }]}>{a.headline}</Text>
                <Text style={[s.summary, { color: MUTED }]} numberOfLines={isOpen ? undefined : 2}>{a.summary}</Text>
                {isOpen && !!a.body && <Text style={[s.body, { color: MUTED }]}>{a.body}</Text>}

                {a.banter_speaker && a.banter_text && (
                  <View style={s.banterRow}>
                    <Image source={speakerPortrait(a.banter_speaker)} style={s.banterPortrait} />
                    <View style={s.banterBubble}>
                      <Text style={s.banterName}>{speakerName(a.banter_speaker).toUpperCase()}</Text>
                      <Text style={s.banterText}>{a.banter_text}</Text>
                    </View>
                    {scene && <Image source={scene} style={s.banterScene} />}
                  </View>
                )}
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
  headerSide:   { width: 60 },
  headerCenter: { alignItems: 'center' },
  headerLogo:   { width: 26, height: 26, marginBottom: 2 },
  back:  { fontSize: 14, fontFamily: FFB },
  title: { fontSize: 13, fontFamily: FFB, letterSpacing: 1.5 },
  subtitle: { fontSize: 12, fontFamily: FF, paddingHorizontal: 20, marginBottom: 16 },

  scroll: { paddingHorizontal: 20, gap: 12 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16 },
  cardType: { fontSize: 10, fontFamily: FFB, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  headline: { fontSize: 16, fontFamily: FFB, marginBottom: 6 },
  summary:  { fontSize: 13, fontFamily: FF, lineHeight: 19 },
  body:     { fontSize: 13, fontFamily: FF, lineHeight: 20, marginTop: 12 },

  banterRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 14,
    paddingTop: 12, borderTopWidth: 1, borderTopColor: BORDER,
  },
  banterPortrait: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: `${GOLD}55` },
  banterBubble: {
    flex: 1, backgroundColor: `${GOLD}0d`, borderWidth: 1, borderColor: `${GOLD}30`,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
  },
  banterName: { fontSize: 9, fontFamily: FFB, color: GOLD, letterSpacing: 1, marginBottom: 2 },
  banterText: { fontSize: 12, fontFamily: FF, color: TEXT, lineHeight: 17, fontStyle: 'italic' },
  banterScene: { width: 64, height: 64, borderRadius: 10 },

  empty:      { alignItems: 'center', marginTop: 60, gap: 8, paddingHorizontal: 40 },
  emptyEmoji: { fontSize: 40 },
  emptyTitle: { fontSize: 15, fontFamily: FFB },
});
