import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, RefreshControl, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { fonts, spacing, radius } from '../../../src/lib/theme';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import type { Notification } from '../../../src/types';

// ── Info section types ────────────────────────────────────────
export type SectionType = 'text' | 'schedule' | 'travel' | 'location' | 'contacts' | 'rules';

export interface ScheduleItem { time: string; label: string; note?: string; }
export interface TravelItem   { label: string; detail: string; }
export interface ContactItem  { name: string; role?: string; phone?: string; }

export interface TextSection     { id: string; type: 'text';     title: string; content: string; }
export interface ScheduleSection { id: string; type: 'schedule'; title: string; items: ScheduleItem[]; }
export interface TravelSection   { id: string; type: 'travel';   title: string; items: TravelItem[]; }
export interface LocationSection { id: string; type: 'location'; title: string; name: string; address?: string; phone?: string; notes?: string; }
export interface ContactsSection { id: string; type: 'contacts'; title: string; items: ContactItem[]; }
export interface RulesSection    { id: string; type: 'rules';    title: string; items: string[]; }
export type InfoSection = TextSection | ScheduleSection | TravelSection | LocationSection | ContactsSection | RulesSection;

const SOCIETY_ID = '00000000-0000-0000-0000-000000000001';

type Tab = 'info' | 'live' | 'instagram';

// ── Feed notification labels ──────────────────────────────────
const LABELS: Record<string, string> = {
  birdie: 'Birdie', eagle: 'Eagle', hole_in_one: 'Hole in One!',
  match_result: 'Match Result', draw: 'Draw Published',
  tournament_winner: 'Tournament Winner', kronos_champ: 'Kronos Champion',
  admin: 'Announcement',
};

export default function FeedScreen() {
  const colors = useDynamicColors();
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
    header: {
      paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: 0,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    title: { fontSize: fonts.xxl, fontWeight: '800', color: colors.white, letterSpacing: 1, marginBottom: spacing.xs },
    editBtn: {
      position: 'absolute', top: 64, right: spacing.lg,
      paddingHorizontal: spacing.md, paddingVertical: 4,
      backgroundColor: colors.cardAlt, borderRadius: radius.sm,
      borderWidth: 1, borderColor: colors.border,
    },
    editBtnText: { fontSize: fonts.xs, fontWeight: '700', color: colors.gold, letterSpacing: 0.5 },
    tabs: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
    tab: {
      paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
      borderBottomWidth: 2, borderBottomColor: 'transparent',
    },
    tabOn: { borderBottomColor: colors.gold },
    tabText: { fontSize: fonts.xs, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.3 },
    tabTextOn: { color: colors.gold },
    scroll: { padding: spacing.md, paddingBottom: 48 },
    heroBanner: {
      backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md,
      marginBottom: spacing.md, borderWidth: 1, borderColor: colors.goldBorder,
    },
    heroLabel: { fontSize: fonts.xs, fontWeight: '700', color: colors.gold, letterSpacing: 2, marginBottom: 4 },
    heroName: { fontSize: fonts.lg, fontWeight: '800', color: colors.white },
    empty: { alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
    emptyTitle: { fontSize: fonts.lg, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.xs },
    emptySub: { fontSize: fonts.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: spacing.lg },
    emptyBtn: { backgroundColor: colors.goldDim, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.goldBorder },
    emptyBtnText: { fontSize: fonts.sm, fontWeight: '700', color: colors.gold },
  }), [colors]);

  const router = useRouter();
  const [tab, setTab] = useState<Tab>('info');
  const [compName, setCompName] = useState('');
  const [compId, setCompId] = useState<string | null>(null);
  const [sections, setSections] = useState<InfoSection[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [instagramUrl, setInstagramUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    const [{ data: comp }, { data: notifs }, { data: soc }] = await Promise.all([
      supabase
        .from('competitions')
        .select('id, name, info_sections')
        .eq('status', 'active')
        .neq('format', 'casual')
        .order('created_at', { ascending: false })
        .limit(1)
        .single(),
      supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('societies')
        .select('instagram_url')
        .eq('id', SOCIETY_ID)
        .single(),
    ]);

    if (comp) {
      setCompName(comp.name);
      setCompId(comp.id);
      setSections((comp.info_sections ?? []) as InfoSection[]);
    }
    if (notifs) setNotifications(notifs);
    if (soc) setInstagramUrl((soc as any).instagram_url ?? null);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    load();
    const sub = supabase
      .channel('feed-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, load)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Text style={styles.title}>Info & Feed</Text>
        {tab === 'info' && compId && (
          <TouchableOpacity
            onPress={() => router.push('/(app)/admin/info' as any)}
            style={styles.editBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>
        )}
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, tab === 'info' && styles.tabOn]}
            onPress={() => setTab('info')}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, tab === 'info' && styles.tabTextOn]}>Info Pack</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'live' && styles.tabOn]}
            onPress={() => setTab('live')}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, tab === 'live' && styles.tabTextOn]}>Live</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'instagram' && styles.tabOn]}
            onPress={() => setTab('instagram')}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, tab === 'instagram' && styles.tabTextOn]}>Instagram</Text>
          </TouchableOpacity>
        </View>
      </View>

      {tab === 'instagram' ? (
        <InstagramView url={instagramUrl} onGoAdmin={() => router.push('/(app)/admin' as any)} styles={styles} />
      ) : loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.gold} size="large" /></View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={colors.gold}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {/* ── Info Pack ── */}
          {tab === 'info' && (
            <>
              {compName ? (
                <View style={styles.heroBanner}>
                  <Text style={styles.heroLabel}>COMPETITION INFO PACK</Text>
                  <Text style={styles.heroName}>{compName}</Text>
                </View>
              ) : null}

              {sections.length === 0 && (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>No info pack yet</Text>
                  <Text style={styles.emptySub}>
                    Society leaders can add the tour schedule, flights, accommodation and more.
                  </Text>
                  <TouchableOpacity
                    style={styles.emptyBtn}
                    onPress={() => router.push('/(app)/admin/info' as any)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.emptyBtnText}>Add Info Pack →</Text>
                  </TouchableOpacity>
                </View>
              )}

              {sections.map(section => (
                <SectionView key={section.id} section={section} />
              ))}
            </>
          )}

          {/* ── Live Feed ── */}
          {tab === 'live' && (
            <>
              {notifications.length === 0 && (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>Nothing yet</Text>
                  <Text style={styles.emptySub}>
                    Birdies, match results and announcements will appear here.
                  </Text>
                </View>
              )}
              {notifications.map(n => <FeedCard key={n.id} n={n} />)}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ── Instagram launcher ────────────────────────────────────────
function extractHandle(url: string): string {
  const match = url.match(/instagram\.com\/([^/?#]+)/);
  if (match) return match[1];
  return url.replace(/^@/, '');
}

function InstagramView({ url, onGoAdmin, styles }: { url: string | null; onGoAdmin: () => void; styles: any }) {
  if (!url) {
    return (
      <View style={styles.centered}>
        <Text style={ig.emptyTitle}>No Instagram connected</Text>
        <Text style={ig.emptySub}>
          Society admins can link the Instagram page in Society Admin settings.
        </Text>
        <TouchableOpacity style={styles.emptyBtn} onPress={onGoAdmin} activeOpacity={0.8}>
          <Text style={styles.emptyBtnText}>Go to Society Admin →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handle = extractHandle(url);

  async function openInApp() {
    const appUrl = `instagram://user?username=${handle}`;
    const canOpen = await Linking.canOpenURL(appUrl);
    if (canOpen) {
      Linking.openURL(appUrl);
    } else {
      Linking.openURL(`https://www.instagram.com/${handle}/`);
    }
  }

  return (
    <View style={[styles.centered, { gap: spacing.lg }]}>
      <View style={ig.iconWrap}>
        <View style={ig.iconInner}>
          <Text style={ig.iconText}>📷</Text>
        </View>
      </View>
      <View style={{ alignItems: 'center' }}>
        <Text style={ig.handle}>@{handle}</Text>
        <Text style={ig.sub}>Tap below to view on Instagram</Text>
      </View>
      <TouchableOpacity style={ig.openBtn} onPress={openInApp} activeOpacity={0.85}>
        <Text style={ig.openBtnText}>Open Instagram Profile</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => Linking.openURL(`https://www.instagram.com/${handle}/`)} activeOpacity={0.7}>
        <Text style={ig.webLink}>Open in browser instead</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Section renderer ──────────────────────────────────────────
function SectionView({ section }: { section: InfoSection }) {
  switch (section.type) {
    case 'text':     return <TextCard s={section} />;
    case 'schedule': return <ScheduleCard s={section} />;
    case 'travel':   return <TravelCard s={section} />;
    case 'location': return <LocationCard s={section} />;
    case 'contacts': return <ContactsCard s={section} />;
    case 'rules':    return <RulesCard s={section} />;
    default:         return null;
  }
}

function CardShell({ title, accent, children }: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <View style={[card.shell, accent ? { borderLeftColor: accent, borderLeftWidth: 3 } : {}]}>
      <Text style={card.title}>{title}</Text>
      {children}
    </View>
  );
}

function TextCard({ s }: { s: TextSection }) {
  return (
    <CardShell title={s.title}>
      <Text style={card.body}>{s.content}</Text>
    </CardShell>
  );
}

function ScheduleCard({ s }: { s: ScheduleSection }) {
  return (
    <CardShell title={s.title} accent={sched.time.color}>
      {s.items.map((item, i) => (
        <View key={i} style={sched.row}>
          <View style={sched.timeCol}>
            <Text style={sched.time}>{item.time}</Text>
            {i < s.items.length - 1 && <View style={sched.line} />}
          </View>
          <View style={sched.content}>
            <Text style={sched.label}>{item.label}</Text>
            {item.note ? <Text style={sched.note}>{item.note}</Text> : null}
          </View>
        </View>
      ))}
    </CardShell>
  );
}

function TravelCard({ s }: { s: TravelSection }) {
  return (
    <CardShell title={s.title}>
      {s.items.map((item, i) => (
        <View key={i} style={travel.row}>
          <View style={travel.dot} />
          <View style={{ flex: 1 }}>
            <Text style={travel.label}>{item.label}</Text>
            <Text style={travel.detail}>{item.detail}</Text>
          </View>
        </View>
      ))}
    </CardShell>
  );
}

function LocationCard({ s }: { s: LocationSection }) {
  return (
    <CardShell title={s.title}>
      <Text style={loc.name}>{s.name}</Text>
      {s.address ? <Text style={loc.detail}>{s.address}</Text> : null}
      {s.phone ? (
        <Text style={loc.detail}>
          <Text style={{ color: '#6b7280' }}>T  </Text>{s.phone}
        </Text>
      ) : null}
      {s.notes ? <Text style={[loc.detail, { marginTop: spacing.xs, fontStyle: 'italic' }]}>{s.notes}</Text> : null}
    </CardShell>
  );
}

function ContactsCard({ s }: { s: ContactsSection }) {
  return (
    <CardShell title={s.title}>
      {s.items.map((item, i) => (
        <View key={i} style={[contact.row, i < s.items.length - 1 && contact.rowBorder]}>
          <View style={contact.avatar}>
            <Text style={contact.initial}>{item.name[0] ?? '?'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={contact.name}>{item.name}</Text>
            {item.role ? <Text style={contact.role}>{item.role}</Text> : null}
          </View>
          {item.phone ? <Text style={contact.phone}>{item.phone}</Text> : null}
        </View>
      ))}
    </CardShell>
  );
}

function RulesCard({ s }: { s: RulesSection }) {
  return (
    <CardShell title={s.title}>
      {s.items.map((rule, i) => (
        <View key={i} style={rules.row}>
          <View style={rules.numBadge}>
            <Text style={rules.num}>{i + 1}</Text>
          </View>
          <Text style={rules.text}>{rule}</Text>
        </View>
      ))}
    </CardShell>
  );
}

// ── Live feed card ────────────────────────────────────────────
function FeedCard({ n }: { n: Notification }) {
  const label = LABELS[n.type] ?? n.type;
  const payload = (n.payload as any) ?? {};
  const time = new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <View style={feedCard.container}>
      <View style={feedCard.dot} />
      <View style={{ flex: 1 }}>
        <View style={feedCard.top}>
          <Text style={feedCard.label}>{label}</Text>
          <Text style={feedCard.time}>{time}</Text>
        </View>
        {payload.message
          ? <Text style={feedCard.body}>{payload.message}</Text>
          : payload.player_name
          ? <Text style={feedCard.body}>{payload.player_name}{payload.hole ? ` · Hole ${payload.hole}` : ''}</Text>
          : null}
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────
const ig = StyleSheet.create({
  emptyTitle: { fontSize: fonts.lg, fontWeight: '700', color: '#9ca3af', marginBottom: spacing.xs, textAlign: 'center' },
  emptySub: { fontSize: fonts.sm, color: '#6b7280', textAlign: 'center', lineHeight: 20, marginBottom: spacing.lg, paddingHorizontal: spacing.lg },
  iconWrap: {
    width: 96, height: 96, borderRadius: 28,
    backgroundColor: '#833AB4', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#833AB4', shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
  },
  iconInner: { alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 44 },
  handle: { fontSize: fonts.xl, fontWeight: '800', color: '#ffffff', marginBottom: 4 },
  sub: { fontSize: fonts.sm, color: '#6b7280' },
  openBtn: {
    backgroundColor: '#833AB4', borderRadius: radius.md,
    paddingVertical: spacing.md, paddingHorizontal: spacing.xxl,
  },
  openBtnText: { fontSize: fonts.md, fontWeight: '800', color: '#ffffff', letterSpacing: 0.5 },
  webLink: { fontSize: fonts.sm, color: '#6b7280', textDecorationLine: 'underline' },
});

const card = StyleSheet.create({
  shell: {
    backgroundColor: '#1c1c1e', borderRadius: radius.md, borderWidth: 1,
    borderColor: '#2c2c2e', padding: spacing.md, marginBottom: spacing.md,
  },
  title: {
    fontSize: fonts.xs, fontWeight: '800', color: '#6b7280',
    letterSpacing: 2, marginBottom: spacing.md, textTransform: 'uppercase',
  },
  body: { fontSize: fonts.sm, color: '#9ca3af', lineHeight: 22 },
});

const sched = StyleSheet.create({
  row: { flexDirection: 'row', marginBottom: 0 },
  timeCol: { width: 52, alignItems: 'flex-end', marginRight: spacing.md },
  time: { fontSize: fonts.sm, fontWeight: '700', color: '#d4af37', lineHeight: 22 },
  line: { width: 1, flex: 1, backgroundColor: 'rgba(212,175,55,0.2)', alignSelf: 'center', marginTop: 2, marginBottom: 2, minHeight: 20 },
  content: { flex: 1, paddingBottom: spacing.md },
  label: { fontSize: fonts.sm, fontWeight: '600', color: '#ffffff', lineHeight: 22 },
  note: { fontSize: fonts.xs, color: '#6b7280', marginTop: 1 },
});

const travel = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.md },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#d4af37', marginTop: 6 },
  label: { fontSize: fonts.sm, fontWeight: '700', color: '#ffffff', marginBottom: 2 },
  detail: { fontSize: fonts.sm, color: '#9ca3af' },
});

const loc = StyleSheet.create({
  name: { fontSize: fonts.md, fontWeight: '700', color: '#ffffff', marginBottom: spacing.xs },
  detail: { fontSize: fonts.sm, color: '#9ca3af', lineHeight: 20 },
});

const contact = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#2c2c2e' },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#2c2c2e', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#2c2c2e',
  },
  initial: { fontSize: fonts.md, fontWeight: '800', color: '#d4af37' },
  name: { fontSize: fonts.sm, fontWeight: '700', color: '#ffffff' },
  role: { fontSize: fonts.xs, color: '#6b7280' },
  phone: { fontSize: fonts.xs, color: '#9ca3af', fontWeight: '600' },
});

const rules = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.sm },
  numBadge: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(212,175,55,0.1)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.2)',
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  num: { fontSize: 10, fontWeight: '800', color: '#d4af37' },
  text: { flex: 1, fontSize: fonts.sm, color: '#9ca3af', lineHeight: 22 },
});

const feedCard = StyleSheet.create({
  container: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    backgroundColor: '#1c1c1e', borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: '#2c2c2e',
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#d4af37', marginTop: 5 },
  top: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { fontSize: fonts.sm, fontWeight: '700', color: '#ffffff' },
  time: { fontSize: fonts.xs, color: '#6b7280' },
  body: { fontSize: fonts.sm, color: '#9ca3af' },
});
