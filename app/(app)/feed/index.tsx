import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, RefreshControl, Linking, Share,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase, freshChannel } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { isoToUk } from '../../../src/lib/dateHelpers';
import type { Notification } from '../../../src/types';

// Fixed, structured Info Pack shape (Rick's brief, section 5, 2026-08-24) —
// superseded the old freeform "pick a section type, type everything by
// hand" model entirely. admin/info.tsx (the editor) imports these same
// types. Dates and golf courses are deliberately NOT part of this shape —
// those are derived live from competitions.start_date/end_date and
// competition_days.course_name so the organiser never re-enters them.
export interface FlightLeg {
  airline: string; flightNumber: string;
  departureAirport: string; arrivalAirport: string;
  departureDate: string; // DD-MM-YYYY, matches the rest of the app's date-field convention
  departureTime: string; arrivalTime: string; // HH:mm
}
export interface CommitteeEntry { id: string; playerId: string; role: string; }
export interface DinnerEntry { id: string; day: string; restaurant: string; time: string; dressCode: string; notes: string; }
export interface RoomEntry { id: string; playerIds: string[]; }
export type TransportLeg = 'airport-hotel' | 'hotel-golf' | 'golf-hotel' | 'hotel-airport' | 'custom';
export interface TransportEntry {
  id: string; leg: TransportLeg; label?: string;
  pickupTime: string; pickupLocation?: string; provider?: string; notes: string;
}
export interface InfoPack {
  hotels: string[];
  flights: { outbound: FlightLeg; return: FlightLeg };
  teeTimes: Record<string, string[]>; // competition_days.id -> times
  committee: CommitteeEntry[];
  dinners: DinnerEntry[];
  rooms: RoomEntry[];
  transport: TransportEntry[];
  generalInfo: string;
}
export const emptyFlightLeg = (): FlightLeg => ({
  airline: '', flightNumber: '', departureAirport: '', arrivalAirport: '',
  departureDate: '', departureTime: '', arrivalTime: '',
});
export const emptyInfoPack = (): InfoPack => ({
  hotels: [], flights: { outbound: emptyFlightLeg(), return: emptyFlightLeg() },
  teeTimes: {}, committee: [], dinners: [], rooms: [], transport: [], generalInfo: '',
});
export interface RoundInfo { id: string; dayNumber: number; courseName: string | null; }
export interface RosterPlayer { id: string; name: string; avatarUrl: string | null; }

type FeedTab = 'info' | 'live' | 'instagram';

const LABELS: Record<string, string> = {
  birdie: 'Birdie', eagle: 'Eagle', hole_in_one: 'Hole in One!',
  match_result: 'Match Result', draw: 'Draw Published',
  // This screen has no per-notification tournament context (notifications
  // carry no competition_id here), so it can't know whether to say "Kronos"
  // or "Individual" for a given tournament — default to the generic term.
  // (No code path currently creates a 'kronos_champ' notification at all.)
  tournament_winner: 'Tournament Winner', kronos_champ: 'Individual Champion',
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
    tabText:     { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: colors.textMuted, letterSpacing: 0.3 },
    tabTextOn:   { color: colors.gold },
    scroll:      { padding: 16, paddingBottom: 48 },
    heroBanner:  { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.goldBorder },
    heroLabel:   { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: colors.gold, letterSpacing: 2, marginBottom: 4 },
    heroName:    { fontSize: 18, fontFamily: 'JUSTSans-ExBold', color: colors.white },
    empty:       { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
    emptyTitle:  { fontSize: 18, fontFamily: 'JUSTSans-ExBold', color: colors.textSecondary, marginBottom: 4 },
    emptySub:    { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: colors.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
    emptyBtn:    { backgroundColor: colors.goldDim, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 8, borderWidth: 1, borderColor: colors.goldBorder },
    emptyBtnText:{ fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: colors.gold },
  }), [colors]);

  const [feedTab, setFeedTab]         = useState<FeedTab>('info');
  const [memberTypes, setMemberTypes] = useState<string[]>([]);
  const [areaStats, setAreaStats]     = useState<AreaStats>({ casualGames: 0, tourName: null, tourLive: 0, swindleName: null, swindleCount: 0 });
  const [compName, setCompName]       = useState('');
  const [compId, setCompId]           = useState<string | null>(null);
  const [infoPack, setInfoPack]       = useState<InfoPack>(emptyInfoPack());
  const [compStartDate, setCompStartDate] = useState<string | null>(null);
  const [compEndDate, setCompEndDate]     = useState<string | null>(null);
  const [rounds, setRounds]           = useState<RoundInfo[]>([]);
  const [roster, setRoster]           = useState<RosterPlayer[]>([]);
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
      supabase.from('competitions').select('id,name,info_pack,start_date,end_date').eq('status','active').neq('format','casual').order('created_at',{ascending:false}).limit(1).single(),
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

    if (comp) {
      setCompName(comp.name);
      setCompId(comp.id);
      setInfoPack({ ...emptyInfoPack(), ...((comp as any).info_pack ?? {}) });
      setCompStartDate((comp as any).start_date ?? null);
      setCompEndDate((comp as any).end_date ?? null);
      const [{ data: dayRows }, { data: playerRows }] = await Promise.all([
        supabase.from('competition_days').select('id, day_number, course_name').eq('competition_id', comp.id).order('day_number'),
        supabase.from('competition_players').select('player_id, players(display_name, avatar_url)').eq('competition_id', comp.id),
      ]);
      setRounds((dayRows ?? []).map((d: any) => ({ id: d.id, dayNumber: d.day_number, courseName: d.course_name })));
      setRoster((playerRows ?? []).map((p: any) => ({ id: p.player_id, name: p.players?.display_name ?? '?', avatarUrl: p.players?.avatar_url ?? null })));
    }
    if (notifs) setNotifications(notifs);
    if (soc)    setInstagramUrl((soc as any).instagram_url ?? null);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    if (societyId) load();
    const sub = freshChannel('feed-live')
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
              {!hasInfoPackContent(infoPack, rounds) && (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>No info pack yet</Text>
                  <Text style={styles.emptySub}>Society leaders can add the tour schedule, flights, accommodation and more.</Text>
                  <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/(app)/admin/info' as any)} activeOpacity={0.8}>
                    <Text style={styles.emptyBtnText}>Add Info Pack →</Text>
                  </TouchableOpacity>
                </View>
              )}
              <InfoPackView pack={infoPack} startDate={compStartDate} endDate={compEndDate} rounds={rounds} roster={roster} />
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
  tileLabelLocked: { color: '#fff' },
  tileSub:    { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: '#fff' },
  arrow:      { fontSize: 24, fontFamily: 'JUSTSans-ExBold',},
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
function CardShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={card.shell}>
      <Text style={card.title}>{title}</Text>
      {children}
    </View>
  );
}

const TRANSPORT_LABELS: Record<string, string> = {
  'airport-hotel': 'Airport → Hotel',
  'hotel-golf':    'Hotel → Golf Course',
  'golf-hotel':    'Golf Course → Hotel',
  'hotel-airport': 'Hotel → Airport',
};

export function hasInfoPackContent(pack: InfoPack, rounds: RoundInfo[]): boolean {
  return (
    pack.hotels.length > 0 ||
    !!pack.flights.outbound.airline || !!pack.flights.outbound.flightNumber ||
    !!pack.flights.return.airline   || !!pack.flights.return.flightNumber ||
    Object.values(pack.teeTimes).some(list => list.length > 0) ||
    pack.committee.length > 0 ||
    pack.dinners.length > 0 ||
    pack.rooms.some(r => r.playerIds.length > 0) ||
    pack.transport.some(t => !!t.pickupTime || !!t.notes || !!t.provider || !!t.pickupLocation) ||
    !!pack.generalInfo.trim() ||
    rounds.some(r => !!r.courseName)
  );
}

// Read-only render of the fixed Info Pack shape (Rick's brief, section 5) —
// mirrors admin/info.tsx's 7 editor cards, each shown only when it has
// content so an in-progress Info Pack doesn't show a wall of empty cards.
export function InfoPackView({ pack, startDate, endDate, rounds, roster }: {
  pack: InfoPack; startDate: string | null; endDate: string | null; rounds: RoundInfo[]; roster: RosterPlayer[];
}) {
  const playerName = (id: string) => roster.find(p => p.id === id)?.name ?? 'Unknown player';
  const hasFlight = (f: FlightLeg) => !!(f.airline || f.flightNumber || f.departureAirport || f.arrivalAirport);
  const courseNames = Array.from(new Set(rounds.map(r => r.courseName).filter(Boolean))) as string[];
  const activeTransport = pack.transport.filter(t => t.pickupTime || t.pickupLocation || t.provider || t.notes);
  const roundsWithTeeTimes = rounds.filter(r => (pack.teeTimes[r.id] ?? []).length > 0);
  const roomsWithPlayers = pack.rooms.filter(r => r.playerIds.length > 0);

  return (
    <>
      {(hasFlight(pack.flights.outbound) || hasFlight(pack.flights.return)) && (
        <CardShell title="Travel">
          {([['outbound', 'Outbound Flight'], ['return', 'Return Flight']] as const).map(([key, label]) => {
            const f = pack.flights[key];
            if (!hasFlight(f)) return null;
            return (
              <View key={key} style={{ marginBottom: 12 }}>
                <Text style={ip.legLabel}>{label.toUpperCase()}</Text>
                {(f.departureAirport || f.arrivalAirport) && (
                  <View style={ip.route}>
                    <Text style={ip.routeAirport}>{f.departureAirport || '—'}</Text>
                    <Text style={ip.routeArrow}>↓</Text>
                    <Text style={ip.routeAirport}>{f.arrivalAirport || '—'}</Text>
                  </View>
                )}
                {(f.airline || f.flightNumber) && <Text style={ip.flightMeta}>{[f.airline, f.flightNumber].filter(Boolean).join(' · ')}</Text>}
                {(f.departureDate || f.departureTime || f.arrivalTime) && (
                  <Text style={ip.flightMeta}>
                    {[f.departureDate, f.departureTime ? `Dep ${f.departureTime}` : '', f.arrivalTime ? `Arr ${f.arrivalTime}` : ''].filter(Boolean).join('  ·  ')}
                  </Text>
                )}
              </View>
            );
          })}
        </CardShell>
      )}

      {(pack.hotels.length > 0 || courseNames.length > 0 || startDate || endDate) && (
        <CardShell title="Accommodation">
          {(startDate || endDate) && <Text style={ip.rowText}>{startDate ? isoToUk(startDate) : '—'} → {endDate ? isoToUk(endDate) : '—'}</Text>}
          {pack.hotels.map((h, i) => <Text key={i} style={[ip.rowText, { marginTop: 6 }]}>{h}</Text>)}
          {courseNames.length > 0 && (
            <>
              <Text style={ip.legLabel}>GOLF COURSES</Text>
              {courseNames.map(n => <Text key={n} style={ip.rowText}>{n}</Text>)}
            </>
          )}
        </CardShell>
      )}

      {roundsWithTeeTimes.length > 0 && (
        <CardShell title="Golf">
          {roundsWithTeeTimes.map(r => (
            <View key={r.id} style={{ marginBottom: 10 }}>
              <Text style={ip.legLabel}>ROUND {r.dayNumber}{r.courseName ? ` · ${r.courseName}` : ''}</Text>
              <View style={ip.timeChipsRow}>
                {(pack.teeTimes[r.id] ?? []).map((t, i) => (
                  <View key={i} style={ip.timeChip}><Text style={ip.timeChipText}>{t}</Text></View>
                ))}
              </View>
            </View>
          ))}
        </CardShell>
      )}

      {pack.committee.length > 0 && (
        <CardShell title="Committee">
          {pack.committee.map((c, i) => (
            <View key={c.id} style={[contact.row, i < pack.committee.length - 1 && contact.rowBorder]}>
              <View style={contact.avatar}><Text style={contact.initial}>{playerName(c.playerId)[0] ?? '?'}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={contact.name}>{playerName(c.playerId)}</Text>
                {c.role ? <Text style={contact.role}>{c.role}</Text> : null}
              </View>
            </View>
          ))}
        </CardShell>
      )}

      {pack.dinners.length > 0 && (
        <CardShell title="Dinner">
          {pack.dinners.map((d, i) => (
            <View key={d.id} style={i < pack.dinners.length - 1 ? ip.row : undefined}>
              <Text style={ip.legLabel}>{(d.day || 'DINNER').toUpperCase()}</Text>
              {d.restaurant ? <Text style={ip.rowText}>{d.restaurant}</Text> : null}
              {(d.time || d.dressCode) ? <Text style={ip.flightMeta}>{[d.time, d.dressCode].filter(Boolean).join(' · ')}</Text> : null}
              {d.notes ? <Text style={[ip.flightMeta, { fontStyle: 'italic' }]}>{d.notes}</Text> : null}
            </View>
          ))}
        </CardShell>
      )}

      {roomsWithPlayers.length > 0 && (
        <CardShell title="Room Sharing">
          {roomsWithPlayers.map((r, i) => (
            <View key={r.id} style={{ marginBottom: 8 }}>
              <Text style={ip.legLabel}>ROOM {i + 1}</Text>
              {r.playerIds.map(pid => <Text key={pid} style={ip.rowText}>{playerName(pid)}</Text>)}
            </View>
          ))}
        </CardShell>
      )}

      {activeTransport.length > 0 && (
        <CardShell title="Transport">
          {activeTransport.map((t, i) => (
            <View key={t.id} style={i < activeTransport.length - 1 ? ip.row : undefined}>
              <Text style={ip.legLabel}>{(TRANSPORT_LABELS[t.leg] ?? t.label ?? 'Transport').toUpperCase()}</Text>
              {t.pickupTime ? <Text style={ip.rowText}>Pickup {t.pickupTime}</Text> : null}
              {t.pickupLocation ? <Text style={ip.flightMeta}>{t.pickupLocation}</Text> : null}
              {t.provider ? <Text style={ip.flightMeta}>{t.provider}</Text> : null}
              {t.notes ? <Text style={[ip.flightMeta, { fontStyle: 'italic' }]}>{t.notes}</Text> : null}
            </View>
          ))}
        </CardShell>
      )}

      {pack.generalInfo.trim() ? (
        <CardShell title="General Information">
          <Text style={card.body}>{pack.generalInfo}</Text>
        </CardShell>
      ) : null}
    </>
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
  emptyTitle: { fontSize: 18, fontFamily: 'JUSTSans-ExBold', color: '#fff', marginBottom: 4, textAlign: 'center' },
  emptySub:   { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: '#fff', textAlign: 'center', lineHeight: 20, marginBottom: 24, paddingHorizontal: 24 },
  iconWrap:   { width: 96, height: 96, borderRadius: 28, backgroundColor: '#833AB4', alignItems: 'center', justifyContent: 'center' },
  iconText:   { fontSize: 44 },
  handle:     { fontSize: 22, fontFamily: 'JUSTSans-ExBold', color: '#ffffff', marginBottom: 4 },
  sub:        { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: '#fff' },
  openBtn:    { backgroundColor: '#833AB4', borderRadius: 12, paddingVertical: 16, paddingHorizontal: 48 },
  openBtnText:{ fontSize: 15, fontFamily: 'JUSTSans-ExBold', color: '#ffffff', letterSpacing: 0.5 },
  webLink:    { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: '#fff', textDecorationLine: 'underline' },
});
const card = StyleSheet.create({
  shell:  { backgroundColor: '#1c1c1e', borderRadius: 12, borderWidth: 1, borderColor: '#2c2c2e', padding: 16, marginBottom: 16 },
  title:  { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: '#fff', letterSpacing: 2, marginBottom: 16, textTransform: 'uppercase' },
  body:   { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: '#fff', lineHeight: 22 },
});
const ip = StyleSheet.create({
  route:        { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  routeAirport: { fontSize: 13, fontFamily: 'JUSTSans-ExBold', color: '#d4af37', flex: 1 },
  routeArrow:   { fontSize: 14, color: '#fff' },
  flightMeta:   { fontSize: 11, fontFamily: 'JUSTSans-ExBold', color: '#fff', marginBottom: 2 },
  legLabel:     { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: '#d4af37', letterSpacing: 1, marginBottom: 6 },
  row:          { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#2c2c2e', marginBottom: 8 },
  rowText:      { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: '#fff' },
  timeChipsRow: { flexDirection: 'row', flexWrap: 'wrap' },
  timeChip:     { backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginRight: 8, marginBottom: 8 },
  timeChipText: { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: '#d4af37' },
});
const contact = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#2c2c2e' },
  avatar:    { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2c2c2e', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2c2c2e' },
  initial:   { fontSize: 15, fontFamily: 'JUSTSans-ExBold', color: '#d4af37' },
  name:      { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: '#ffffff' },
  role:      { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: '#fff' },
  phone:     { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: '#fff' },
});
const feedCard = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, backgroundColor: '#1c1c1e', borderRadius: 12, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: '#2c2c2e' },
  dot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: '#d4af37', marginTop: 5 },
  top:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label:     { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: '#ffffff' },
  time:      { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: '#fff' },
  body:      { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: '#fff' },
});
