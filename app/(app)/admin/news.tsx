import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, Alert, Image, ActivityIndicator, Modal, FlatList,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { buildPreviewSnapshot, buildRoundReportSnapshot, buildFinalReportSnapshot } from '../../../src/lib/titanNews';
import { sendMatchNotification } from '../../../src/lib/notifications';
import ConfirmDialog from '../../../src/components/ConfirmDialog';

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

// Placeholder until the web/ Next.js app is actually deployed (Phase 6 —
// tracked separately, needs a real Vercel project). Update this the moment
// there's a real URL, otherwise every "Publish & Send" before that sends a
// dead link.
const NEWSREEL_BASE_URL = 'https://titan-golf-web.vercel.app';

type Day = {
  id: string; day_number: number; course_name: string | null; complete: boolean; hasMatches: boolean;
  ntp_hole: number | null; ld_hole: number | null; ntp_winner_id: string | null; ld_winner_id: string | null;
};
type Article = {
  id: string; story_type: string; day_id: string | null;
  headline: string | null; summary: string | null; body: string | null;
  status: 'draft' | 'published' | 'rejected'; created_at: string;
};
type Entrant = { player_id: string; display_name: string };

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
  const [entrants, setEntrants]   = useState<Entrant[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Article | null>(null);
  const [deleting, setDeleting]   = useState(false);
  const [showWinner, setShowWinner] = useState<{ dayId: string; type: 'ntp' | 'ld' } | null>(null);
  const [sending, setSending]     = useState(false);

  const load = useCallback(async () => {
    if (!competitionId) return;
    const [{ data: comp }, { data: daysData }, { data: matchesData }, { data: articlesData }, { data: playersData }] = await Promise.all([
      supabase.from('competitions').select('name').eq('id', competitionId).single(),
      supabase.from('competition_days').select('id, day_number, course_name, ntp_hole, ld_hole, ntp_winner_id, ld_winner_id').eq('competition_id', competitionId).order('day_number'),
      supabase.from('matches').select('day_id, status').eq('competition_id', competitionId),
      supabase.from('titan_news').select('id, story_type, day_id, headline, summary, body, status, created_at')
        .eq('competition_id', competitionId).order('created_at', { ascending: false }),
      supabase.from('competition_players').select('player_id, status, players(display_name)').eq('competition_id', competitionId).neq('status', 'declined'),
    ]);

    if (comp) setCompName((comp as any).name ?? '');
    const builtDays: Day[] = ((daysData ?? []) as any[]).map(d => {
      const dayMatches = ((matchesData ?? []) as any[]).filter(m => m.day_id === d.id);
      return {
        id: d.id, day_number: d.day_number, course_name: d.course_name,
        hasMatches: dayMatches.length > 0, complete: dayMatches.length > 0 && dayMatches.every(m => m.status === 'complete'),
        ntp_hole: d.ntp_hole, ld_hole: d.ld_hole, ntp_winner_id: d.ntp_winner_id, ld_winner_id: d.ld_winner_id,
      };
    });
    setDays(builtDays);
    setArticles((articlesData ?? []) as Article[]);
    setEntrants(((playersData ?? []) as any[]).map(p => ({ player_id: p.player_id, display_name: p.players?.display_name ?? '—' })));
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

  async function setWinner(dayId: string, type: 'ntp' | 'ld', playerId: string) {
    const col = type === 'ntp' ? 'ntp_winner_id' : 'ld_winner_id';
    await supabase.from('competition_days').update({ [col]: playerId }).eq('id', dayId);
    setShowWinner(null);
    load();
  }

  // Loops the same single-story generate() call used by the per-round
  // buttons above — one round_report per completed day missing one, then
  // the final_report — so the admin doesn't have to press every button
  // individually once the tournament's actually finished.
  async function generateAll() {
    for (const d of completedDays) {
      const key = `round_report:${d.id}`;
      if (!articles.some(a => a.story_type === 'round_report' && a.day_id === d.id)) {
        await generate('round_report', d.id);
      }
    }
    if (allComplete && !articles.some(a => a.story_type === 'final_report')) {
      await generate('final_report', null);
    }
  }

  // Bulk-publishes every draft, then delivers the newsreel link the same
  // way tournament enrollment already notifies players (finishDraft() in
  // admin/build.tsx) — a DM per entrant plus an actual push, since a
  // finished recap is worth surfacing more than the silent-DM enrollment
  // flow does today.
  async function publishAndSend() {
    if (!competitionId || sending) return;
    setSending(true);
    try {
      const drafts = articles.filter(a => a.status === 'draft');
      if (drafts.length) {
        const { error: pubErr } = await supabase.from('titan_news')
          .update({ status: 'published', published_at: new Date().toISOString() })
          .in('id', drafts.map(a => a.id));
        if (pubErr) { Alert.alert('Error', pubErr.message); return; }
      }

      const link = `${NEWSREEL_BASE_URL}/newsreel/${competitionId}`;
      const { data: { user } } = await supabase.auth.getUser();
      const { data: me } = await supabase.from('players').select('id').eq('auth_uid', user?.id ?? '').maybeSingle();
      const rows = entrants
        .filter(e => e.player_id !== (me as any)?.id)
        .map(e => ({
          sender_id: (me as any)?.id, recipient_id: e.player_id,
          content: `📰 The ${compName} Newsreel is out — read the full story`,
          message_type: 'newsreel' as const, competition_id: competitionId, link_url: link,
        }));
      if (rows.length) {
        const { error: dmErr } = await supabase.from('direct_messages').insert(rows);
        if (dmErr) { Alert.alert('Newsreel published, but sending failed', dmErr.message); return; }
      }

      await sendMatchNotification(competitionId, '📰 Your Tournament Report', `The ${compName} Newsreel is ready to read`, entrants.map(e => e.player_id));
      Alert.alert('Sent', `The Newsreel is published and sent to ${rows.length} player${rows.length === 1 ? '' : 's'}.`);
      load();
    } finally {
      setSending(false);
    }
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

        {completedDays.some(d => d.ntp_hole || d.ld_hole) && (
          <>
            <Text style={s.sectionLabel}>NEAREST THE PIN / LONGEST DRIVE</Text>
            <View style={s.genCard}>
              {completedDays.filter(d => d.ntp_hole || d.ld_hole).map(d => (
                <View key={d.id}>
                  {d.ntp_hole && (
                    <WinnerRow
                      label={`Round ${d.day_number} NTP — Hole ${d.ntp_hole}`}
                      winnerName={entrants.find(e => e.player_id === d.ntp_winner_id)?.display_name ?? null}
                      onPress={() => setShowWinner({ dayId: d.id, type: 'ntp' })}
                    />
                  )}
                  {d.ld_hole && (
                    <WinnerRow
                      label={`Round ${d.day_number} LD — Hole ${d.ld_hole}`}
                      winnerName={entrants.find(e => e.player_id === d.ld_winner_id)?.display_name ?? null}
                      onPress={() => setShowWinner({ dayId: d.id, type: 'ld' })}
                    />
                  )}
                </View>
              ))}
            </View>
          </>
        )}

        {allComplete && (
          <>
            <Text style={s.sectionLabel}>TITAN NEWSREEL</Text>
            <View style={s.genCard}>
              <TouchableOpacity style={s.genBtn} onPress={generateAll} disabled={!!generating} activeOpacity={0.8}>
                <Text style={s.genBtnText}>Generate All Reports</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.genBtn, s.actionBtnPrimary, (sending || articles.length === 0) && s.genBtnDisabled]}
                onPress={() => Alert.alert(
                  'Publish & Send Newsreel',
                  `Publish every draft story and send a link to all ${entrants.length} player${entrants.length === 1 ? '' : 's'}?`,
                  [{ text: 'Cancel', style: 'cancel' }, { text: 'Send', onPress: publishAndSend }],
                )}
                disabled={sending || articles.length === 0}
                activeOpacity={0.8}
              >
                {sending ? <ActivityIndicator color={GOLD} size="small" /> : <Text style={[s.genBtnText, s.actionBtnTextPrimary]}>Publish & Send Newsreel</Text>}
              </TouchableOpacity>
            </View>
          </>
        )}

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

      <Modal visible={showWinner !== null} animationType="slide" transparent>
        <View style={s.pickerOverlay}>
          <View style={s.pickerSheet}>
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>{showWinner?.type === 'ntp' ? 'NTP Winner' : 'LD Winner'}</Text>
              <TouchableOpacity onPress={() => setShowWinner(null)} activeOpacity={0.7}>
                <Text style={s.pickerClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={entrants}
              keyExtractor={e => e.player_id}
              renderItem={({ item }) => {
                const day = days.find(d => d.id === showWinner?.dayId);
                const isActive = item.player_id === (showWinner?.type === 'ntp' ? day?.ntp_winner_id : day?.ld_winner_id);
                return (
                  <TouchableOpacity
                    style={[s.pickerItem, isActive && s.pickerItemActive]}
                    onPress={() => showWinner && setWinner(showWinner.dayId, showWinner.type, item.player_id)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.pickerItemText, isActive && { color: GOLD }]}>{item.display_name}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
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

function WinnerRow({ label, winnerName, onPress }: { label: string; winnerName: string | null; onPress: () => void }) {
  return (
    <View style={s.cardRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.winnerLabel}>{label}</Text>
        {winnerName && <Text style={s.cardRowName}>{winnerName}</Text>}
      </View>
      {!winnerName && (
        <TouchableOpacity style={s.setWinnerBtn} onPress={onPress} activeOpacity={0.8}>
          <Text style={s.setWinnerText}>Set Winner</Text>
        </TouchableOpacity>
      )}
    </View>
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

  cardRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  cardRowName:   { fontFamily: FFB, fontSize: 14, color: '#fff', marginTop: 2 },
  winnerLabel:   { fontFamily: FFB, fontSize: 11, color: '#888', letterSpacing: 0.5 },
  setWinnerBtn:  { backgroundColor: GOLD + '1F', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: GOLD + '4D' },
  setWinnerText: { fontSize: 12, fontFamily: FFB, color: GOLD },

  pickerOverlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  pickerSheet:      { backgroundColor: '#111', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40, maxHeight: '60%', borderTopWidth: 1, borderColor: '#1c1c1c' },
  pickerHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  pickerTitle:      { fontSize: 17, fontFamily: FFB, color: '#fff' },
  pickerClose:      { fontSize: 17, fontFamily: FFB, color: '#fff', paddingHorizontal: 8 },
  pickerItem:       { paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  pickerItemActive: { backgroundColor: 'rgba(212,175,55,0.08)' },
  pickerItemText:   { fontSize: 16, fontFamily: FFB, color: '#fff' },
});
