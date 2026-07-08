'use client';

import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { radius, spacing } from '../../../src/lib/theme';

// ─── palette ────────────────────────────────────────────────────────────────

const C = {
  bg:         '#07090d',
  card:       '#0e1219',
  cardAlt:    '#131922',
  border:     '#1a2333',
  gold:       '#D4AF37',
  goldDim:    'rgba(212,175,55,0.12)',
  goldBorder: 'rgba(212,175,55,0.25)',
  green:      '#4ade80',
  purple:     '#a78bfa',
  white:      '#ffffff',
  muted:      '#4a5568',
  sub:        '#718096',
};

// ─── types ───────────────────────────────────────────────────────────────────

interface Competition { id: string; name: string; status: string; format: string; year: number | null; }
interface KronosEntry { name: string; pts: number; }

// ─── helpers ─────────────────────────────────────────────────────────────────

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning,';
  if (h < 18) return 'Good afternoon,';
  return 'Good evening,';
}

function fmtFormat(f: string) {
  const map: Record<string, string> = {
    team_matchplay_4bbb: '4BBB Team Matchplay',
    stableford:          'Stableford',
    medal:               'Medal',
    casual:              'Casual',
  };
  return map[f] ?? f;
}

// ─── CONCEPT SCREEN ──────────────────────────────────────────────────────────

export default function ConceptScreen() {
  const router = useRouter();

  const [loading,    setLoading]    = useState(true);
  const [firstName,  setFirstName]  = useState('');
  const [handicap,   setHandicap]   = useState<number | null>(null);
  const [comps,      setComps]      = useState<Competition[]>([]);
  const [leaderboard, setLeaderboard] = useState<KronosEntry[]>([]);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: player } = await supabase
      .from('players')
      .select('id, display_name, handicap_index')
      .eq('auth_uid', user.id)
      .maybeSingle();

    if (player) {
      setFirstName((player as any).display_name?.split(' ')[0] ?? 'Golfer');
      setHandicap((player as any).handicap_index ?? null);
    }

    const { data: member } = player ? await supabase
      .from('society_members')
      .select('society_id')
      .eq('player_id', (player as any).id)
      .limit(1)
      .maybeSingle() : { data: null };

    const socId = (member as any)?.society_id;

    if (socId) {
      const [compsRes, holesRes, playersRes, matchesRes, kronosRes] = await Promise.all([
        supabase.from('competitions')
          .select('id, name, status, format, year')
          .eq('society_id', socId)
          .in('status', ['active', 'upcoming'])
          .order('created_at', { ascending: false })
          .limit(4),
        supabase.from('match_holes').select('player_id, stableford_pts, match_id'),
        supabase.from('players').select('id, display_name'),
        supabase.from('matches').select('id, competition_id'),
        supabase.from('competitions').select('id').eq('society_id', socId).eq('include_in_kronos', true),
      ]);

      setComps((compsRes.data ?? []) as Competition[]);

      // build mini kronos leaderboard
      const kronosIds = new Set(((kronosRes.data ?? []) as any[]).map((c: any) => c.id));
      const kronosMatchIds = new Set(
        ((matchesRes.data ?? []) as any[]).filter((m: any) => kronosIds.has(m.competition_id)).map((m: any) => m.id)
      );
      const totals: Record<string, number> = {};
      for (const h of ((holesRes.data ?? []) as any[])) {
        if (h.stableford_pts != null && kronosMatchIds.has(h.match_id)) {
          totals[h.player_id] = (totals[h.player_id] ?? 0) + h.stableford_pts;
        }
      }
      const playerMap: Record<string, string> = {};
      for (const p of ((playersRes.data ?? []) as any[])) playerMap[p.id] = p.display_name ?? '—';

      const lb: KronosEntry[] = Object.entries(totals)
        .map(([id, pts]) => ({ name: playerMap[id] ?? '—', pts }))
        .sort((a, b) => b.pts - a.pts)
        .slice(0, 3);
      setLeaderboard(lb);
    }

    setLoading(false);
  }

  if (loading) {
    return (
      <View style={[ss.page, ss.center]}>
        <StatusBar style="light" />
        <ActivityIndicator color={C.gold} size="large" />
      </View>
    );
  }

  const activeComps  = comps.filter(c => c.status === 'active');
  const upcomingComps = comps.filter(c => c.status === 'upcoming');

  return (
    <View style={ss.page}>
      <StatusBar style="light" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* ── HERO ── */}
        <View style={ss.hero}>
          {/* gradient layers */}
          <View style={ss.heroBg} />
          <View style={ss.heroGreenGlow} />
          <View style={ss.heroGrid} />

          {/* top bar */}
          <View style={ss.topBar}>
            <TouchableOpacity onPress={() => router.back()} style={ss.backBtn} activeOpacity={0.7}>
              <Text style={ss.backBtnText}>← Back</Text>
            </TouchableOpacity>
            <View style={ss.titanBadge}>
              <Image source={require('../../../assets/TitanAppLogo.png')} style={ss.titanLogo} />
              <View>
                <Text style={ss.titanWord}>TITAN</Text>
                <Text style={ss.titanSub}>TOUR</Text>
              </View>
            </View>
          </View>

          {/* greeting */}
          <View style={ss.greetWrap}>
            <Text style={ss.greetLine}>{greeting()}</Text>
            <Text style={ss.greetName}>{firstName || 'Rick'}</Text>
            {handicap !== null && (
              <View style={ss.hcpBadge}>
                <Text style={ss.hcpLabel}>HCP</Text>
                <Text style={ss.hcpValue}>{handicap.toFixed(1)}</Text>
              </View>
            )}
          </View>

          {/* tagline */}
          <Text style={ss.tagline}>PREMIUM · EXCLUSIVE · TIMELESS</Text>
        </View>

        {/* ── QUICK NAV ── */}
        <View style={ss.quickNav}>
          {[
            { icon: '⛳', label: 'Events',     onPress: () => router.push('/(app)/tour' as any) },
            { icon: '💰', label: 'Clubhouse',  onPress: () => router.push('/(app)/swindle' as any) },
            { icon: '🎯', label: 'Practice',   onPress: () => router.push('/(app)/range' as any) },
            { icon: '👤', label: 'Locker Rm',  onPress: () => router.push('/(app)/profile' as any) },
          ].map(({ icon, label, onPress }) => (
            <TouchableOpacity key={label} style={ss.quickCard} onPress={onPress} activeOpacity={0.75}>
              <Text style={ss.quickIcon}>{icon}</Text>
              <Text style={ss.quickLabel}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── EVENTS ── */}
        {(activeComps.length > 0 || upcomingComps.length > 0) && (
          <View style={ss.section}>
            <View style={ss.sectionHead}>
              <Text style={ss.sectionTitle}>EVENTS</Text>
              <TouchableOpacity onPress={() => router.push('/(app)/tour' as any)} activeOpacity={0.7}>
                <Text style={ss.sectionMore}>View all ›</Text>
              </TouchableOpacity>
            </View>

            {activeComps.map(c => (
              <TouchableOpacity
                key={c.id}
                style={ss.eventCard}
                onPress={() => router.push('/(app)/tour' as any)}
                activeOpacity={0.8}
              >
                <View style={ss.eventCardInner}>
                  <View style={ss.liveChip}>
                    <View style={ss.liveDot} />
                    <Text style={ss.liveText}>LIVE</Text>
                  </View>
                  <Text style={ss.eventName}>{c.name.toUpperCase()}</Text>
                  <Text style={ss.eventFormat}>{fmtFormat(c.format)}</Text>
                  {c.year && <Text style={ss.eventYear}>{c.year} Season</Text>}
                </View>
                <View style={ss.eventArrow}>
                  <Text style={ss.eventArrowText}>›</Text>
                </View>
              </TouchableOpacity>
            ))}

            {upcomingComps.map(c => (
              <TouchableOpacity
                key={c.id}
                style={[ss.eventCard, ss.eventCardUpcoming]}
                onPress={() => router.push('/(app)/tour' as any)}
                activeOpacity={0.8}
              >
                <View style={ss.eventCardInner}>
                  <View style={[ss.liveChip, ss.upcomingChip]}>
                    <Text style={[ss.liveText, { color: C.gold }]}>UPCOMING</Text>
                  </View>
                  <Text style={ss.eventName}>{c.name.toUpperCase()}</Text>
                  <Text style={ss.eventFormat}>{fmtFormat(c.format)}</Text>
                </View>
                <View style={ss.eventArrow}>
                  <Text style={ss.eventArrowText}>›</Text>
                </View>
              </TouchableOpacity>
            ))}

            {comps.length === 0 && (
              <View style={ss.emptyCard}>
                <Text style={ss.emptyText}>No active events · Create one in Admin</Text>
              </View>
            )}
          </View>
        )}

        {/* ── LEADERBOARD TEASER ── */}
        {leaderboard.length > 0 && (
          <View style={ss.section}>
            <View style={ss.sectionHead}>
              <Text style={ss.sectionTitle}>KRONOS TROPHY</Text>
              <TouchableOpacity onPress={() => router.push('/(app)/leaderboard' as any)} activeOpacity={0.7}>
                <Text style={ss.sectionMore}>Full board ›</Text>
              </TouchableOpacity>
            </View>
            <View style={ss.lbCard}>
              {leaderboard.map((row, i) => (
                <View key={row.name} style={[ss.lbRow, i < leaderboard.length - 1 && ss.lbRowBorder]}>
                  <Text style={[ss.lbPos, i === 0 && { color: C.gold }]}>{i + 1}</Text>
                  <Text style={[ss.lbName, i === 0 && { color: C.gold }]}>{row.name}</Text>
                  <Text style={[ss.lbPts, i === 0 && { color: C.gold }]}>{row.pts} pts</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── CLUBHOUSE TEASER ── */}
        <View style={ss.section}>
          <View style={ss.sectionHead}>
            <Text style={ss.sectionTitle}>CLUBHOUSE</Text>
            <TouchableOpacity onPress={() => router.push('/(app)/swindle' as any)} activeOpacity={0.7}>
              <Text style={[ss.sectionMore, { color: C.purple }]}>Open ›</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[ss.eventCard, { borderColor: C.purple + '40', backgroundColor: C.purple + '08' }]}
            onPress={() => router.push('/(app)/swindle' as any)}
            activeOpacity={0.8}
          >
            <View style={ss.eventCardInner}>
              <Text style={[ss.eventName, { color: C.purple }]}>THE SWINDLE</Text>
              <Text style={ss.eventFormat}>Weekly stableford competition</Text>
            </View>
            <View style={ss.eventArrow}>
              <Text style={[ss.eventArrowText, { color: C.purple }]}>›</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* ── CONCEPT NOTE ── */}
        <View style={ss.noteCard}>
          <Text style={ss.noteTitle}>🎨 Concept Preview</Text>
          <Text style={ss.noteBody}>
            This is how the new Titan Tour home screen could look.{'\n'}
            Tab renaming: Tour → Events · Swindle → Clubhouse · Profile → Locker Room.{'\n'}
            All buttons above link to live screens. If you love it, we swap it in.
          </Text>
        </View>

      </ScrollView>
    </View>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────────

const ss = StyleSheet.create({
  page:   { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  // hero
  hero:         { paddingBottom: spacing.xl, position: 'relative', overflow: 'hidden', minHeight: 260 },
  heroBg:       { ...StyleSheet.absoluteFillObject, backgroundColor: '#050a0f' },
  heroGreenGlow:{ position: 'absolute', top: -60, left: -80, width: 320, height: 320, borderRadius: 160, backgroundColor: 'rgba(30,60,20,0.35)' },
  heroGrid:     { position: 'absolute', bottom: 0, right: 0, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(212,175,55,0.04)' },

  topBar:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingHorizontal: spacing.lg, marginBottom: spacing.xl },
  backBtn:      { paddingVertical: 6, paddingRight: spacing.md },
  backBtnText:  { fontSize: 13, fontWeight: '600', color: C.sub },
  titanBadge:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titanLogo:    { width: 32, height: 32, borderRadius: 16 },
  titanWord:    { fontSize: 13, fontWeight: '900', color: C.gold, letterSpacing: 2 },
  titanSub:     { fontSize: 9,  fontWeight: '700', color: C.sub,  letterSpacing: 3, marginTop: -2 },

  greetWrap:    { paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  greetLine:    { fontSize: 15, fontWeight: '500', color: C.sub, letterSpacing: 0.3 },
  greetName:    { fontSize: 44, fontWeight: '900', color: C.white, letterSpacing: -1, lineHeight: 48 },
  hcpBadge:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs },
  hcpLabel:     { fontSize: 10, fontWeight: '800', color: C.muted, letterSpacing: 2 },
  hcpValue:     { fontSize: 15, fontWeight: '900', color: C.gold },

  tagline:      { paddingHorizontal: spacing.lg, fontSize: 10, fontWeight: '700', color: C.muted, letterSpacing: 3, marginTop: spacing.md },

  // quick nav
  quickNav:     { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  quickCard:    { flex: 1, backgroundColor: C.card, borderRadius: radius.md, borderWidth: 1, borderColor: C.border, paddingVertical: spacing.md, alignItems: 'center', gap: 4 },
  quickIcon:    { fontSize: 20 },
  quickLabel:   { fontSize: 10, fontWeight: '700', color: C.sub, letterSpacing: 0.5 },

  // sections
  section:      { paddingHorizontal: spacing.md, marginTop: spacing.md },
  sectionHead:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  sectionTitle: { fontSize: 11, fontWeight: '800', color: C.muted, letterSpacing: 2.5 },
  sectionMore:  { fontSize: 12, fontWeight: '700', color: C.gold },

  // event cards
  eventCard:    { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: radius.md, borderWidth: 1, borderColor: C.border, padding: spacing.md, marginBottom: spacing.xs },
  eventCardUpcoming: { borderColor: C.goldBorder, backgroundColor: C.goldDim },
  eventCardInner: { flex: 1 },
  liveChip:     { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  liveDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green },
  liveText:     { fontSize: 9, fontWeight: '800', color: C.green, letterSpacing: 1.5 },
  upcomingChip: { backgroundColor: 'transparent' },
  eventName:    { fontSize: 16, fontWeight: '900', color: C.white, letterSpacing: 0.3, marginBottom: 3 },
  eventFormat:  { fontSize: 12, color: C.sub },
  eventYear:    { fontSize: 11, color: C.muted, marginTop: 2 },
  eventArrow:   { paddingLeft: spacing.sm },
  eventArrowText: { fontSize: 22, color: C.gold, fontWeight: '300' },

  emptyCard:    { backgroundColor: C.card, borderRadius: radius.md, borderWidth: 1, borderColor: C.border, padding: spacing.lg, alignItems: 'center' },
  emptyText:    { fontSize: 13, color: C.muted },

  // leaderboard
  lbCard:       { backgroundColor: C.card, borderRadius: radius.md, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  lbRow:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 14, gap: spacing.md },
  lbRowBorder:  { borderBottomWidth: 1, borderBottomColor: C.border },
  lbPos:        { fontSize: 12, fontWeight: '800', color: C.muted, width: 18, textAlign: 'center' },
  lbName:       { flex: 1, fontSize: 15, fontWeight: '700', color: C.white },
  lbPts:        { fontSize: 16, fontWeight: '900', color: C.white },

  // note
  noteCard:     { margin: spacing.md, marginTop: spacing.xl, backgroundColor: C.goldDim, borderRadius: radius.md, borderWidth: 1, borderColor: C.goldBorder, padding: spacing.md },
  noteTitle:    { fontSize: 13, fontWeight: '800', color: C.gold, marginBottom: spacing.xs },
  noteBody:     { fontSize: 12, color: C.sub, lineHeight: 20 },
});
