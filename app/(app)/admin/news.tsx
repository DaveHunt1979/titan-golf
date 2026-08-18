import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, Alert, Image, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { buildPreviewSnapshot, buildRoundReportSnapshot, buildFinalReportSnapshot } from '../../../src/lib/titanNews';
import ConfirmDialog from '../../../src/components/ConfirmDialog';

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

type Day = { id: string; day_number: number; course_name: string | null; complete: boolean; hasMatches: boolean };
type Article = {
  id: string; story_type: string; day_id: string | null;
  headline: string | null; summary: string | null; body: string | null;
  status: 'draft' | 'published' | 'rejected'; created_at: string;
};

const STORY_LABEL: Record<string, string> = { preview: 'Preview', round_report: 'Round Report', final_report: 'Final Report' };

export default function AdminNewsScreen() {
  const router = useRouter();
  const { id: competitionId } = useLocalSearchParams<{ id: string }>();

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [compName, setCompName]   = useState('');
  const [days, setDays]           = useState<Day[]>([]);
  const [articles, setArticles]   = useState<Article[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Article | null>(null);
  const [deleting, setDeleting]   = useState(false);

  const load = useCallback(async () => {
    if (!competitionId) return;
    const [{ data: comp }, { data: daysData }, { data: matchesData }, { data: articlesData }] = await Promise.all([
      supabase.from('competitions').select('name').eq('id', competitionId).single(),
      supabase.from('competition_days').select('id, day_number, course_name').eq('competition_id', competitionId).order('day_number'),
      supabase.from('matches').select('day_id, status').eq('competition_id', competitionId),
      supabase.from('titan_news').select('id, story_type, day_id, headline, summary, body, status, created_at')
        .eq('competition_id', competitionId).order('created_at', { ascending: false }),
    ]);

    if (comp) setCompName((comp as any).name ?? '');
    const builtDays: Day[] = ((daysData ?? []) as any[]).map(d => {
      const dayMatches = ((matchesData ?? []) as any[]).filter(m => m.day_id === d.id);
      return { id: d.id, day_number: d.day_number, course_name: d.course_name, hasMatches: dayMatches.length > 0, complete: dayMatches.length > 0 && dayMatches.every(m => m.status === 'complete') };
    });
    setDays(builtDays);
    setArticles((articlesData ?? []) as Article[]);
    setLoading(false);
    setRefreshing(false);
  }, [competitionId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  const nextDay = days.find(d => !d.complete);
  const completedDays = days.filter(d => d.complete);
  const allComplete = days.length > 0 && completedDays.length === days.length;

  async function generate(storyType: 'preview' | 'round_report' | 'final_report', dayId: string | null) {
    const genKey = `${storyType}:${dayId ?? 'tournament'}`;
    setGenerating(genKey);
    try {
      const snapshot = storyType === 'preview' ? await buildPreviewSnapshot(competitionId, dayId!)
        : storyType === 'round_report' ? await buildRoundReportSnapshot(competitionId, dayId!)
        : await buildFinalReportSnapshot(competitionId);

      const dedupeKey = `${competitionId}:${dayId ?? 'tournament'}:${storyType}`;
      const { data, error } = await supabase.functions.invoke('titan-news', {
        body: { dedupeKey, competitionId, dayId, storyType, snapshot },
      });
      if (error || data?.error) {
        Alert.alert('Generation failed', data?.error ?? error?.message ?? 'Unknown error');
        return;
      }
      await load();
    } catch (e: any) {
      Alert.alert('Generation failed', e.message ?? 'Unknown error');
    } finally {
      setGenerating(null);
    }
  }

  async function publish(article: Article) {
    const { error } = await supabase.from('titan_news')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', article.id);
    if (error) { Alert.alert('Error', error.message); return; }
    load();
  }

  async function unpublish(article: Article) {
    const { error } = await supabase.from('titan_news').update({ status: 'draft' }).eq('id', article.id);
    if (error) { Alert.alert('Error', error.message); return; }
    load();
  }

  async function deleteArticle() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('titan_news').delete().eq('id', deleteTarget.id);
    setDeleting(false);
    setDeleteTarget(null);
    if (error) { Alert.alert('Error', error.message); return; }
    load();
  }

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={hit} style={s.headerLeft}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} />
          <Text style={s.headerTitle}>TITAN NEWS</Text>
          <Text style={s.headerSub} numberOfLines={1}>{compName}</Text>
        </View>
        <View style={s.headerRight} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={GOLD} />}
      >
        <Text style={s.sectionLabel}>GENERATE</Text>
        <View style={s.genCard}>
          {nextDay ? (
            <GenButton
              label={`Preview — Round ${nextDay.day_number}`}
              busy={generating === `preview:${nextDay.id}`}
              disabled={!!generating}
              onPress={() => generate('preview', nextDay.id)}
            />
          ) : (
            <Text style={s.genNote}>No upcoming round to preview.</Text>
          )}
          {completedDays.map(d => (
            <GenButton
              key={d.id}
              label={`Round ${d.day_number} Report`}
              busy={generating === `round_report:${d.id}`}
              disabled={!!generating}
              onPress={() => generate('round_report', d.id)}
            />
          ))}
          <GenButton
            label="Final Tournament Report"
            busy={generating === 'final_report:tournament'}
            disabled={!!generating || !allComplete}
            onPress={() => generate('final_report', null)}
          />
          {!allComplete && <Text style={s.genNote}>Final report unlocks once every round is complete.</Text>}
        </View>

        <Text style={s.sectionLabel}>ARTICLES</Text>
        {articles.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>📰</Text>
            <Text style={s.emptyTitle}>No stories yet</Text>
            <Text style={s.emptySub}>Generate a preview or report above to get started.</Text>
          </View>
        ) : articles.map(a => {
          const isOpen = expanded === a.id;
          const badgeColor = a.status === 'published' ? GREEN : a.status === 'rejected' ? RED : GOLD;
          const dayNumber = a.day_id ? days.find(d => d.id === a.day_id)?.day_number : null;
          return (
            <TouchableOpacity key={a.id} style={s.articleCard} onPress={() => setExpanded(isOpen ? null : a.id)} activeOpacity={0.85}>
              <View style={s.articleTop}>
                <Text style={s.articleType}>{STORY_LABEL[a.story_type] ?? a.story_type}{dayNumber ? ` · Round ${dayNumber}` : ''}</Text>
                <View style={[s.badge, { borderColor: badgeColor, backgroundColor: badgeColor + '1A' }]}>
                  <Text style={[s.badgeText, { color: badgeColor }]}>{a.status.toUpperCase()}</Text>
                </View>
              </View>
              <Text style={s.headline}>{a.headline ?? '(no headline)'}</Text>
              <Text style={s.summary} numberOfLines={isOpen ? undefined : 2}>{a.summary}</Text>
              {isOpen && !!a.body && <Text style={s.body}>{a.body}</Text>}

              {isOpen && (
                <View style={s.actionsRow}>
                  {a.status === 'published' ? (
                    <TouchableOpacity style={s.actionBtn} onPress={() => unpublish(a)} activeOpacity={0.8}>
                      <Text style={s.actionBtnText}>Unpublish</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={[s.actionBtn, s.actionBtnPrimary]} onPress={() => publish(a)} activeOpacity={0.8}>
                      <Text style={[s.actionBtnText, s.actionBtnTextPrimary]}>Publish</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={s.actionBtn}
                    disabled={!!generating}
                    onPress={() => generate(a.story_type as any, a.day_id)}
                    activeOpacity={0.8}
                  >
                    <Text style={s.actionBtnText}>{generating === `${a.story_type}:${a.day_id ?? 'tournament'}` ? 'Regenerating…' : 'Regenerate'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.deleteBtn} onPress={() => setDeleteTarget(a)} activeOpacity={0.8}>
                    <Text style={s.deleteBtnText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ConfirmDialog
        visible={deleteTarget !== null}
        title="Delete Article"
        message={`Delete "${deleteTarget?.headline ?? 'this article'}"? This cannot be undone.`}
        confirmLabel={deleting ? 'Deleting…' : 'Delete Article'}
        destructive
        onConfirm={deleteArticle}
        onCancel={() => setDeleteTarget(null)}
      />
    </View>
  );
}

function GenButton({ label, busy, disabled, onPress }: { label: string; busy: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[s.genBtn, disabled && s.genBtnDisabled]} onPress={onPress} disabled={disabled} activeOpacity={0.8}>
      {busy ? <ActivityIndicator color={GOLD} size="small" /> : <Text style={s.genBtnText}>Generate {label}</Text>}
    </TouchableOpacity>
  );
}

const hit = { top: 12, bottom: 12, left: 12, right: 12 };

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  headerLeft:   { width: 70, alignItems: 'flex-start' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerRight:  { width: 70 },
  headerLogo:   { width: 28, height: 28, marginBottom: 2 },
  headerTitle:  { fontFamily: FFB, fontSize: 14, color: '#fff', letterSpacing: 0.5 },
  headerSub:    { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 },
  back:         { fontFamily: FFB, fontSize: 14, color: GOLD },

  scroll: { padding: 20, paddingBottom: 48 },
  sectionLabel: { fontFamily: FFB, fontSize: 11, color: '#888', letterSpacing: 1.5, marginBottom: 8, marginTop: 4 },

  genCard: { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 14, gap: 8, marginBottom: 24 },
  genBtn: { backgroundColor: GOLD + '1A', borderWidth: 1, borderColor: GOLD + '55', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  genBtnDisabled: { opacity: 0.35 },
  genBtnText: { fontFamily: FFB, fontSize: 13, color: GOLD, letterSpacing: 0.5 },
  genNote: { fontFamily: FFB, fontSize: 11, color: '#888', textAlign: 'center' },

  articleCard: { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 16, marginBottom: 10 },
  articleTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  articleType: { fontFamily: FFB, fontSize: 10, color: '#888', letterSpacing: 1, textTransform: 'uppercase' },
  badge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontFamily: FFB, fontSize: 10, letterSpacing: 1 },
  headline: { fontFamily: FFB, fontSize: 16, color: '#fff', marginBottom: 6 },
  summary:  { fontFamily: FFB, fontSize: 13, color: '#ccc', lineHeight: 19 },
  body:     { fontFamily: FFB, fontSize: 13, color: '#ccc', lineHeight: 20, marginTop: 12 },

  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  actionBtn: { flex: 1, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  actionBtnText: { fontFamily: FFB, fontSize: 11, color: '#fff', letterSpacing: 0.5 },
  actionBtnPrimary: { backgroundColor: GOLD + '1A', borderColor: GOLD + '55' },
  actionBtnTextPrimary: { color: GOLD },
  deleteBtn: { backgroundColor: RED + '14', borderWidth: 1, borderColor: RED + '40', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center' },
  deleteBtnText: { fontFamily: FFB, fontSize: 11, color: RED, letterSpacing: 0.5 },

  empty:      { alignItems: 'center', paddingTop: 40, paddingBottom: 20, gap: 10 },
  emptyEmoji: { fontSize: 40 },
  emptyTitle: { fontFamily: FFB, fontSize: 16, color: '#fff' },
  emptySub:   { fontFamily: FFB, fontSize: 13, color: '#888', textAlign: 'center', paddingHorizontal: 28 },
});
