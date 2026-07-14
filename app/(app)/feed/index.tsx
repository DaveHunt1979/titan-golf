import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, RefreshControl, Linking, Share,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import type { Notification } from '../../../src/types';

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
type FeedTab = 'info' | 'live' | 'instagram';

const LABELS: Record<string, string> = {
  birdie: 'Birdie', eagle: 'Eagle', hole_in_one: 'Hole in One!',
  match_result: 'Match Result', draw: 'Draw Published',
  tournament_winner: 'Tournament Winner', kronos_champ: 'Kronos Champion',
  admin: 'Announcement',
};

interface AreaStats {
  casualGames:   number;
  tourName:      string | null;
  tourLive:      number;
  swindleName:   string | null;
  swindleCount:  number;
}

export default function FeedScreen() {
  const colors = useDynamicColors();
  const { societyId } = useSocietyTheme();
  const router = useRouter();
  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const styles = useMemo(() => StyleSheet.create({
    container:   { flex: 1, backgroundColor: colors.bg },
    centered:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    header:      { paddingTop: 60, paddingHorizontal: 24, paddingBottom: 0, borderBottomWidth: 1, borderBottomColor: colors.border },
    title:       { fontSize: 28, fontFamily: 'JUSTSans-ExBold', color: colors.white, letterSpacing: 1, marginBottom: 4 },
    editBtn:     { position: 'absolute', top: 64, right: 24, paddingHorizontal: 16, paddingVertical: 4, backgroundColor: colors.cardAlt, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
    editBtnText: { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: colors.gold, letterSpacing: 0.5 },
    tabs:        { flexDirection: 'row', gap: 4, marginTop: 4 },
    tab:         { paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabOn:       { borderBottomColor: colors.gold },
    tabText:     { fontSize: 10, fontFamily: 'JUSTSans', color: colors.textMuted, letterSpacing: 0.3 },
    tabTextOn:   { color: colors.gold },
    scroll:      { padding: 16, paddingBottom: 48 },
    heroBanner:  { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.goldBorder },
    heroLabel:   { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: colors.gold, letterSpacing: 2, marginBottom: 4 },
    heroName:    { fontSize: 18, fontFamily: 'JUSTSans-ExBold', color: colors.white },
    empty:       { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
    emptyTitle:  { fontSize: 18, fontFamily: 'JUSTSans', color: colors.textSecondary, marginBottom: 4 },
    emptySub:    { fontSize: 12, fontFamily: 'JUSTSans', color: colors.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
    emptyBtn:    { backgroundColor: colors.goldDim, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 8, borderWidth: 1, borderColor: colors.goldBorder },
    emptyBtnText:{ fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: colors.gold },
  }), [colors]);

  const [feedTab, setFeedTab]         = useState<FeedTab>('info');
  const [memberTypes, setMemberTypes] = useState<string[]>([]);
  const [areaStats, setAreaStats]     = useState<AreaStats>({ casualGames: 0, tourName: null, tourLive: 0, swindleName: null, swindleCount: 0 });
  const [compName, setCompName]       = useState('');
  const [compId, setCompId]           = useState<string | null>(null);
  const [sections, setSections]       = useState<InfoSection[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [instagramUrl, setInstagramUrl]   = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);

  async function load() {
    const [
      { data: { user } },
    ] = await Promise.all([supabase.auth.getUser()]);

    const [
      { data: memberData },
      { data: comp },
      { data: notifs },
      { data: soc },
      { data: casualData },
      { data: tourMatches },
      { data: swindleData },
    ] = await Promise.all([
      user
        ? supabase.from('society_members').select('membership_types').eq('society_id', societyId).eq('player_id',
            supabase.from('players').select('id').eq('auth_uid', user.id).single() as any
          ).single()
        : Promise.resolve({ data: null }),
      supabase.from('competitions').select('id,name,info_sections').eq('status','active').neq('format','casual').order('created_at',{ascending:false}).limit(1).single(),
      supabase.from('notifications').select('*').order('created_at',{ascending:false}).limit(50),
      supabase.from('societies').select('instagram_url').eq('id',societyId).single(),
      supabase.from('matches').select('id',{count:'exact'}).eq('status','in_progress').is('competition_id', null),
      supabase.from('matches').select('id',{count:'exact'}).eq('status','in_progress').not('competition_id','is',null),
      supabase.from('swindle_games').select('title,entries_count:swindle_entries(count)').eq('status','open').order('created_at',{ascending:false}).limit(1).single(),
    ]);

    // Membership types — do a direct player lookup
    if (user) {
      const { data: playerRow } = await supabase.from('players').select('id').eq('auth_uid', user.id).single();
      if (playerRow) {
        const { data: sm } = await supabase.from('society_members').select('membership_types, role').eq('society_id', societyId).eq('player_id', (playerRow as any).id).single();
        const role = (sm as any)?.role ?? '';
        const isPrivileged = role === 'admin' || role === 'owner';
        setMemberTypes(isPrivileged ? ['casual', 'tour', 'swindle'] : ((sm as any)?.membership_types ?? []));
      }
    }

    setAreaStats({
      casualGames:  casualData?.length ?? 0,
      tourName:     comp?.name ?? null,
      tourLive:     tourMatches?.length ?? 0,
      swindleName:  (swindleData as any)?.title ?? null,
      swindleCount: (swindleData as any)?.entries_count?.[0]?.count ?? 0,
    });

    if (comp)   { setCompName(comp.name); setCompId(comp.id); setSections((comp.info_sections ?? []) as InfoSection[]); }
    if (notifs) setNotifications(notifs);
    if (soc)    setInstagramUrl((soc as any).instagram_url ?? null);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    if (societyId) load();
    const sub = supabase.channel('feed-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, load)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [societyId]);

  // Casual is always open. Tour and Swindle require a join code (membership_type).
  const hasArea = (a: string) => a === 'casual' || memberTypes.length === 0 || memberTypes.includes(a);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Text style={styles.title}>Titan Golf</Text>
        {feedTab === 'info' && compId && (
          <TouchableOpacity onPress={() => router.push('/(app)/admin/info' as any)} style={styles.editBtn} hitSlop={{ top:10,bottom:10,left:10,right:10 }}>
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>
        )}
        <View style={styles.tabs}>
          {(['info','live','instagram'] as FeedTab[]).map(t => (
            <TouchableOpacity key={t} style={[styles.tab, feedTab === t && styles.tabOn]} onPress={() => setFeedTab(t)} activeOpacity={0.7}>
              <Text style={[styles.tabText, feedTab === t && styles.tabTextOn]}>
                {t === 'info' ? 'Info Pack' : t === 'live' ? 'Live' : 'Instagram'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {feedTab === 'instagram' ? (
        <InstagramView url={instagramUrl} onGoAdmin={() => router.push('/(app)/admin' as any)} styles={styles} />
      ) : loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.gold} size="large" /></View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Three area tiles ── */}
          <AreaTile
            icon="🏌️" label="Casual Golf" sub={areaStats.casualGames > 0 ? `${areaStats.casualGames} game${areaStats.casualGames !== 1 ? 's' : ''} in progress` : 'Pick-up games with the boys'}
            color="#4ade80" locked={!hasArea('casual')}
            onPress={() => hasArea('casual') ? router.push('/(app)/score' as any) : router.push('/(app)/join' as any)}
          />
          <AreaTile
            icon="🏆" label="The Tour" sub={areaStats.tourName ?? (areaStats.tourLive > 0 ? `${areaStats.tourLive} matches live` : 'Competitive team tournament')}
            color="#D4AF37" locked={!hasArea('tour')}
            onPress={() => hasArea('tour') ? router.push('/(app)/tour' as any) : router.push('/(app)/join' as any)}
          />
          <AreaTile
            icon="💰" label="The Swindle" sub={areaStats.swindleName ?? (areaStats.swindleCount > 0 ? `${areaStats.swindleCount} entered` : 'Weekly money competition')}
            color="#a78bfa" locked={!hasArea('swindle')}
            onPress={() => hasArea('swindle') ? router.push('/(app)/swindle' as any) : router.push('/(app)/join' as any)}
          />

          <View style={portal.divider}>
            <View style={portal.dividerLine} />
            <Text style={portal.dividerText}>COMPETITION INFO</Text>
            <View style={portal.dividerLine} />
          </View>

          {/* ── Info Pack ── */}
          {feedTab === 'info' && (
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
                  <Text style={styles.emptySub}>Society leaders can add the tour schedule, flights, accommodation and more.</Text>
                  <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/(app)/admin/info' as any)} activeOpacity={0.8}>
                    <Text style={styles.emptyBtnText}>Add Info Pack →</Text>
                  </TouchableOpacity>
                </View>
              )}
              {sections.map(section => <SectionView key={section.id} section={section} />)}
            </>
          )}

          {/* ── Live Feed ── */}
          {feedTab === 'live' && (
            <>
              {notifications.length === 0 && (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>Nothing yet</Text>
                  <Text style={styles.emptySub}>Birdies, match results and announcements will appear here.</Text>
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

// ── Area tile ─────────────────────────────────────────────────
function AreaTile({ icon, label, sub, color, locked, onPress }: {
  icon: string; label: string; sub: string; color: string; locked: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[portal.tile, locked && portal.tileLocked, { borderLeftColor: locked ? '#374151' : color }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={[portal.tileIcon, locked && { opacity: 0.4 }]}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[portal.tileLabel, locked && portal.tileLabelLocked]}>{label}</Text>
        <Text style={portal.tileSub} numberOfLines={1}>{locked ? 'Ask Rick for access' : sub}</Text>
      </View>
      {locked
        ? <Text style={portal.lock}>🔒</Text>
        : <Text style={[portal.arrow, { color }]}>›</Text>
      }
    </TouchableOpacity>
  );
}

const portal = StyleSheet.create({
  tile: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: '#1c1c1e', borderRadius: 18,
    borderWidth: 1, borderColor: '#2c2c2e', borderLeftWidth: 4,
    padding: 16, marginBottom: 8,
  },
  tileLocked: { opacity: 0.6 },
  tileIcon:   { fontSize: 28, width: 36, textAlign: 'center' },
  tileLabel:  { fontSize: 15, fontFamily: 'JUSTSans-ExBold', color: '#ffffff', marginBottom: 2 },
  tileLabelLocked: { color: '#6b7280' },
  tileSub:    { fontSize: 10, fontFamily: 'JUSTSans', color: '#6b7280' },
  arrow:      { fontSize: 24, fontFamily: 'JUSTSans' },
  lock:       { fontSize: 16 },
  divider:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 16 },
  dividerLine:{ flex: 1, height: 1, backgroundColor: '#2c2c2e' },
  dividerText:{ fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: '#4b5563', letterSpacing: 1.5 },
});

// ── Instagram launcher ────────────────────────────────────────
function extractHandle(url: string): string {
  const match = url.match(/instagram\.com\/([^/?#]+)/);
  return match ? match[1] : url.replace(/^@/, '');
}

function InstagramView({ url, onGoAdmin, styles }: { url: string | null; onGoAdmin: () => void; styles: any }) {
  if (!url) {
    return (
      <View style={styles.centered}>
        <Text style={ig.emptyTitle}>No Instagram connected</Text>
        <Text style={ig.emptySub}>Society admins can link the Instagram page in Society Admin settings.</Text>
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
    Linking.openURL(canOpen ? appUrl : `https://www.instagram.com/${handle}/`);
  }
  return (
    <View style={[styles.centered, { gap: 24 }]}>
      <View style={ig.iconWrap}><Text style={ig.iconText}>📷</Text></View>
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
  return <CardShell title={s.title}><Text style={card.body}>{s.content}</Text></CardShell>;
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
      {s.phone ? <Text style={loc.detail}><Text style={{ color: '#6b7280' }}>T  </Text>{s.phone}</Text> : null}
      {s.notes ? <Text style={[loc.detail, { marginTop: 4, fontStyle: 'italic' }]}>{s.notes}</Text> : null}
    </CardShell>
  );
}
function ContactsCard({ s }: { s: ContactsSection }) {
  return (
    <CardShell title={s.title}>
      {s.items.map((item, i) => (
        <View key={i} style={[contact.row, i < s.items.length - 1 && contact.rowBorder]}>
          <View style={contact.avatar}><Text style={contact.initial}>{item.name[0] ?? '?'}</Text></View>
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
          <View style={rules.numBadge}><Text style={rules.num}>{i + 1}</Text></View>
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

// ── Static styles ─────────────────────────────────────────────
const ig = StyleSheet.create({
  emptyTitle: { fontSize: 18, fontFamily: 'JUSTSans', color: '#9ca3af', marginBottom: 4, textAlign: 'center' },
  emptySub:   { fontSize: 12, fontFamily: 'JUSTSans', color: '#6b7280', textAlign: 'center', lineHeight: 20, marginBottom: 24, paddingHorizontal: 24 },
  iconWrap:   { width: 96, height: 96, borderRadius: 28, backgroundColor: '#833AB4', alignItems: 'center', justifyContent: 'center' },
  iconText:   { fontSize: 44 },
  handle:     { fontSize: 22, fontFamily: 'JUSTSans-ExBold', color: '#ffffff', marginBottom: 4 },
  sub:        { fontSize: 12, fontFamily: 'JUSTSans', color: '#6b7280' },
  openBtn:    { backgroundColor: '#833AB4', borderRadius: 12, paddingVertical: 16, paddingHorizontal: 48 },
  openBtnText:{ fontSize: 15, fontFamily: 'JUSTSans-ExBold', color: '#ffffff', letterSpacing: 0.5 },
  webLink:    { fontSize: 12, fontFamily: 'JUSTSans', color: '#6b7280', textDecorationLine: 'underline' },
});
const card = StyleSheet.create({
  shell:  { backgroundColor: '#1c1c1e', borderRadius: 12, borderWidth: 1, borderColor: '#2c2c2e', padding: 16, marginBottom: 16 },
  title:  { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: '#6b7280', letterSpacing: 2, marginBottom: 16, textTransform: 'uppercase' },
  body:   { fontSize: 12, fontFamily: 'JUSTSans', color: '#9ca3af', lineHeight: 22 },
});
const sched = StyleSheet.create({
  row:     { flexDirection: 'row', marginBottom: 0 },
  timeCol: { width: 52, alignItems: 'flex-end', marginRight: 16 },
  time:    { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: '#d4af37', lineHeight: 22 },
  line:    { width: 1, flex: 1, backgroundColor: 'rgba(212,175,55,0.2)', alignSelf: 'center', marginTop: 2, marginBottom: 2, minHeight: 20 },
  content: { flex: 1, paddingBottom: 16 },
  label:   { fontSize: 12, fontFamily: 'JUSTSans', color: '#ffffff', lineHeight: 22 },
  note:    { fontSize: 10, fontFamily: 'JUSTSans', color: '#6b7280', marginTop: 1 },
});
const travel = StyleSheet.create({
  row:    { flexDirection: 'row', alignItems: 'flex-start', gap: 16, marginBottom: 16 },
  dot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: '#d4af37', marginTop: 6 },
  label:  { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: '#ffffff', marginBottom: 2 },
  detail: { fontSize: 12, fontFamily: 'JUSTSans', color: '#9ca3af' },
});
const loc = StyleSheet.create({
  name:   { fontSize: 15, fontFamily: 'JUSTSans-ExBold', color: '#ffffff', marginBottom: 4 },
  detail: { fontSize: 12, fontFamily: 'JUSTSans', color: '#9ca3af', lineHeight: 20 },
});
const contact = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#2c2c2e' },
  avatar:    { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2c2c2e', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2c2c2e' },
  initial:   { fontSize: 15, fontFamily: 'JUSTSans-ExBold', color: '#d4af37' },
  name:      { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: '#ffffff' },
  role:      { fontSize: 10, fontFamily: 'JUSTSans', color: '#6b7280' },
  phone:     { fontSize: 10, fontFamily: 'JUSTSans', color: '#9ca3af' },
});
const rules = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  numBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(212,175,55,0.1)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.2)', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  num:      { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: '#d4af37' },
  text:     { flex: 1, fontSize: 12, fontFamily: 'JUSTSans', color: '#9ca3af', lineHeight: 22 },
});
const feedCard = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, backgroundColor: '#1c1c1e', borderRadius: 12, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: '#2c2c2e' },
  dot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: '#d4af37', marginTop: 5 },
  top:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label:     { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: '#ffffff' },
  time:      { fontSize: 10, fontFamily: 'JUSTSans', color: '#6b7280' },
  body:      { fontSize: 12, fontFamily: 'JUSTSans', color: '#9ca3af' },
});
