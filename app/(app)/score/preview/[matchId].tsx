import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Image, ActivityIndicator, ScrollView, Share, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../../src/lib/supabase';
import { getPlayerAvatar } from '../../../../src/lib/assets';
import { speakIntro } from '../../../../src/lib/caddie';
import { calcCourseHandicap } from '../../../../src/lib/scoring';

const GOLD  = '#D4AF37';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../../assets/TitanAppLogo.png');

interface MatchPreview {
  id: string;
  competition_id: string | null;
  round_format: string | null;
  is_singles: boolean;
  team_size: number | null;
  hcp_allowance: number | null;
  handicap_method: string | null;
  side_games: string[] | null;
  home_player_ids: string[];
  away_player_ids: string[];
  player_overrides: Record<string, { hcp?: number; tee?: string }> | null;
  day: { course_name: string; course_par: number; course_rating: number | null; slope_rating: number | null } | null;
}

interface Player {
  id: string;
  display_name: string;
  handicap_index: number;
  avatar_url: string | null;
}

function Avatar({ name, size = 72, src }: { name: string; size?: number; src?: any }) {
  if (src) {
    const imgSrc = typeof src === 'string' ? { uri: src } : src;
    return <Image source={imgSrc} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${GOLD}20`, borderWidth: 2, borderColor: `${GOLD}50`, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: FFB, fontSize: size * 0.38, color: GOLD }}>{(name || '?')[0].toUpperCase()}</Text>
    </View>
  );
}

export default function MatchPreviewScreen() {
  const { matchId, dayId, dayCode, startHole } = useLocalSearchParams<{ matchId: string; dayId?: string; dayCode?: string; startHole?: string }>();
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [match, setMatch] = useState<MatchPreview | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [teeing, setTeeing] = useState(false);

  useEffect(() => {
    async function load() {
      console.log('[preview.load] start', { matchId });
      try {
        const { data: matchData, error: matchErr } = await supabase
          .from('matches')
          .select('*,day:day_id(course_name,course_par,course_rating,slope_rating)')
          .eq('id', matchId)
          .single();

        if (matchErr) throw matchErr;
        if (!matchData) { console.warn('[preview.load] no match found', { matchId }); setLoadError(true); return; }
        console.log('[preview.load] match fetched', { matchId, status: matchData.status, round_format: matchData.round_format });
        setMatch(matchData as any);

        const allIds = [...(matchData.home_player_ids ?? []), ...(matchData.away_player_ids ?? [])];
        if (allIds.length) {
          console.log('[preview.load] fetching players + competition_players...', { playerCount: allIds.length });
          const [{ data: playersData }, { data: compData }] = await Promise.all([
            supabase.from('players').select('id,display_name,handicap_index,avatar_url').in('id', allIds),
            matchData.competition_id
              ? supabase.from('competition_players').select('player_id,handicap_index').eq('competition_id', matchData.competition_id).in('player_id', allIds)
              : Promise.resolve({ data: [] as { player_id: string; handicap_index: number }[] }),
          ]);
          if (playersData) {
            // Same precedence the live scoring screen uses: competition_players
            // (which already has max_handicap capping applied at enrollment)
            // wins over the raw player record, then a per-match override on
            // top of that — otherwise this preview can show a different
            // handicap than what actually applies once scoring starts.
            const compByPlayer: Record<string, number> = {};
            (compData ?? []).forEach(cp => { compByPlayer[cp.player_id] = cp.handicap_index; });
            const overrides = matchData.player_overrides ?? {};
            const effective = (playersData as Player[]).map(p => {
              const ov = overrides[p.id]?.hcp;
              const compHcp = compByPlayer[p.id];
              return { ...p, handicap_index: ov ?? compHcp ?? p.handicap_index };
            });
            setPlayers(effective);
            console.log('[preview.load] players resolved', { count: effective.length });
          }
        }
        console.log('[preview.load] done', { matchId });
      } catch (e) {
        // Without this, any transient failure here — a network blip is the
        // likely case moments after finishing a previous round — left
        // `loading` stuck true forever: the exact "hangs on Tee Off" bug
        // Rick kept hitting starting a second round back to back.
        console.error('[preview.load] failed', { matchId }, e);
        setLoadError(true);
      } finally {
        console.log('[preview.load] finally — clearing loading', { matchId });
        setLoading(false);
      }
    }
    console.log('[preview] matchId changed, (re)loading', { matchId, retryTick });
    setLoading(true);
    setLoadError(false);
    // This screen is a Tabs.Screen with no `getId`, so React Navigation keeps
    // the same mounted instance across different matches instead of
    // remounting — `teeing` only ever gets reset on startRound()'s error
    // path, never on success (a successful tap just navigates away), so a
    // PREVIOUS round's successful Tee Off left it stuck true forever. The
    // very next round's preview screen inherited that and showed the
    // Tee Off button permanently spinning without ever being tapped — the
    // "starting a second game" bug, same class as solo.tsx's `saving` reset.
    setTeeing(false);
    load();
  }, [matchId, retryTick]);

  function shareCode() {
    if (!dayCode) return;
    const courseName = match?.day?.course_name ?? 'our round';
    Share.share({
      message: `Follow our game at ${courseName}!\nEnter code ${dayCode} in Titan Golf → Score tab → Join Game Day to spectate (view-only — you won't be able to enter scores).`,
    });
  }

  async function startRound() {
    if (teeing || !match) return;
    console.log('[startRound] tapped', { matchId });
    setTeeing(true);
    try {
      const firstNames = [...(match.home_player_ids ?? []), ...(match.away_player_ids ?? [])]
        .map(id => players.find(p => p.id === id)?.display_name.split(' ')[0])
        .filter(Boolean) as string[];
      const voiceOn = match.side_games?.includes('voice:on');
      if (voiceOn) {
        console.log('[startRound] voice intro starting (max 6s)...');
        try {
          await Promise.race([speakIntro(firstNames), new Promise(resolve => setTimeout(resolve, 6000))]);
        } catch (e) {
          console.error('speakIntro failed:', e);
        }
        console.log('[startRound] voice intro settled');
      }
      // enter/solo/teamstableford render the live scoring screen directly — the
      // old hub route (score/[matchId]) is orphaned and no longer maintained,
      // same fix as the other navigation call sites already routed around it.
      const base = match.round_format === 'team_stableford'
        ? `/(app)/score/teamstableford/${matchId}`
        : match.away_player_ids.length === 0 && match.home_player_ids.length === 1
          ? `/(app)/score/solo/${matchId}`
          : `/(app)/score/enter/${matchId}`;
      const dest = startHole && startHole !== '1' ? `${base}?startHole=${startHole}` : base;
      console.log('[startRound] navigating', { dest });
      router.replace(dest as any);
    } catch (e) {
      // Without this, any exception here left `teeing` stuck true forever —
      // the Tee Off button would spin permanently and, since startRound()
      // early-returns while teeing is true, could never be retried.
      console.error('[startRound] failed', { matchId }, e);
      Alert.alert('Could not start round', 'Please try again.');
      setTeeing(false);
    }
  }

  if (loadError) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000', gap: 16, padding: 24 }}>
      <Text style={{ fontFamily: FFB, color: '#fff', fontSize: 16 }}>Couldn't load this round.</Text>
      <TouchableOpacity style={s.teeBtn} onPress={() => setRetryTick(t => t + 1)} activeOpacity={0.85}>
        <Text style={s.teeBtnText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading || !fontsLoaded) return (
    <View style={s.loading}>
      <ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  if (!match) return null;

  const allIds = [...match.home_player_ids, ...match.away_player_ids];
  const homePlayers = match.home_player_ids.map(id => players.find(p => p.id === id)).filter(Boolean) as Player[];
  const awayPlayers = match.away_player_ids.map(id => players.find(p => p.id === id)).filter(Boolean) as Player[];
  const isSolo = match.away_player_ids.length === 0;

  // 4BBB Stroke Matchplay: the lowest cut handicap in the whole match plays
  // off scratch, everyone else's shots are relative to that (Rick's spec).
  const isRelativeHcp = match.handicap_method === 'relative_low';
  const groupLowestCutHcp = isRelativeHcp
    ? Math.min(...[...homePlayers, ...awayPlayers].map(p => {
        const allowance = match.hcp_allowance ?? 100;
        const raw = (!match.day?.slope_rating || !match.day?.course_rating || !match.day?.course_par)
          ? Math.round(p.handicap_index)
          : calcCourseHandicap(p.handicap_index, match.day.slope_rating, match.day.course_rating, match.day.course_par);
        return Math.round(raw * (allowance / 100));
      }))
    : 0;

  const modeName = (() => {
    // Mashie (Best 2 From 4) also stores as round_format 'team_stableford' —
    // same field the plain Team Stableford format uses — so it needs its own
    // check here, same signal score/teamstableford/[matchId].tsx uses to tell
    // the two apart (Mashie: no away side, up to a 4-player single group).
    if (match.round_format === 'team_stableford' && match.away_player_ids.length === 0 && (match.team_size ?? 2) >= 4) {
      return 'Mashie Golf';
    }
    const map: Record<string, string> = {
      stableford: 'Stableford', medal: 'Medal', matchplay: 'Matchplay',
      skins: 'Skins', nassau: 'Nassau', wolf: 'Wolf', scramble: 'Scramble',
      bbb: 'Best Ball Betterball', modified_stableford: 'Modified Stableford',
      par_bogey: 'Par / Bogey', chacha: 'Cha Cha Cha',
      greensome: 'Greensomes', foursomes: 'Foursomes',
      team_stableford: 'Team Stableford',
    };
    return map[match.round_format ?? ''] ?? (match.round_format ?? 'Matchplay');
  })();

  const hcpLabel = (() => {
    const h = match.hcp_allowance;
    if (!h || h === 100) return 'Full Handicap';
    if (h === 87) return '7/8 Handicap';
    if (h === 75) return '3/4 Handicap';
    if (h === 0) return 'Off Scratch';
    return `${h}% Handicap`;
  })();

  const voiceOn = match.side_games?.includes('voice:on') ?? false;
  const sideGames = (match.side_games ?? []).filter(g => !g.startsWith('voice'));

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerSide} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerSub}>READY TO TEE OFF</Text>
        </View>
        <View style={s.headerSide} />
      </View>

      {/* Course block */}
      <View style={s.courseBlock}>
        <Text style={s.courseName} numberOfLines={1}>{match.day?.course_name ?? 'Course'}</Text>
        <Text style={s.coursePar}>Par {match.day?.course_par ?? 72}</Text>
        {voiceOn && (
          <View style={s.voiceBadge}>
            <Ionicons name="mic-outline" size={10} color={GOLD} />
            <Text style={s.voiceBadgeText}>CHIP & BIRDIE ACTIVE</Text>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Players */}
        <View style={isSolo ? s.soloRow : s.matchupRow}>
          {isSolo ? (
            homePlayers.map(p => <PlayerCard key={p.id} player={p} size={homePlayers.length > 2 ? 60 : 80} hcpAllowance={match.hcp_allowance} day={match.day} isRelativeHcp={isRelativeHcp} groupLowestCutHcp={groupLowestCutHcp} />)
          ) : (
            <>
              <View style={s.side}>
                {homePlayers.map(p => <PlayerCard key={p.id} player={p} size={60} hcpAllowance={match.hcp_allowance} day={match.day} isRelativeHcp={isRelativeHcp} groupLowestCutHcp={groupLowestCutHcp} />)}
              </View>
              <View style={s.vsWrap}>
                <Text style={s.vsText}>VS</Text>
              </View>
              <View style={s.side}>
                {awayPlayers.map(p => <PlayerCard key={p.id} player={p} size={60} hcpAllowance={match.hcp_allowance} day={match.day} isRelativeHcp={isRelativeHcp} groupLowestCutHcp={groupLowestCutHcp} />)}
              </View>
            </>
          )}
        </View>

        {/* Match details */}
        <View style={s.detailCard}>
          <DetailRow icon="flag-outline" label="Format" value={modeName} />
          <View style={s.divider} />
          <DetailRow icon="person-outline" label="Handicap" value={hcpLabel} />
          {sideGames.length > 0 && (
            <>
              <View style={s.divider} />
              <DetailRow icon="locate-outline" label="Side Games" value={sideGames.join(' · ')} />
            </>
          )}
        </View>

        {/* Game day */}
        {dayCode && dayId && (
          <View style={s.dayCard}>
            <Text style={s.dayCardTitle}>GAME DAY</Text>
            <Text style={s.dayCardSub}>Share this code so others can spectate — view-only, they can't enter scores</Text>
            <Text style={s.dayCode}>{dayCode}</Text>
            <TouchableOpacity
              style={[s.dayBtn, { backgroundColor: `${GOLD}15`, borderWidth: 1, borderColor: `${GOLD}40` }]}
              onPress={shareCode}
              activeOpacity={0.8}
            >
              <Ionicons name="share-outline" size={14} color={GOLD} />
              <Text style={s.dayBtnText}>Share Code</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.dayBtn}
              onPress={() => router.push(`/(app)/score/day/${dayId}` as any)}
              activeOpacity={0.8}
            >
              <Ionicons name="trophy-outline" size={14} color={GOLD} />
              <Text style={s.dayBtnText}>View Day Leaderboard</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>

      {/* Tee Off CTA */}
      <View style={s.footer}>
        <TouchableOpacity style={s.teeBtn} onPress={startRound} disabled={teeing} activeOpacity={0.85}>
          {teeing
            ? <ActivityIndicator color="#000000" />
            : <>
                <Ionicons name="golf-outline" size={20} color="#000000" />
                <Text style={s.teeBtnText}>Tee Off</Text>
              </>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

function PlayerCard({ player, size, hcpAllowance, day, isRelativeHcp, groupLowestCutHcp }: {
  player: Player; size: number; hcpAllowance: number | null; day: MatchPreview['day'];
  isRelativeHcp?: boolean; groupLowestCutHcp?: number;
}) {
  const avatar = player.avatar_url ?? getPlayerAvatar(player.id, 'normal');
  const firstName = player.display_name.split(' ')[0];

  // Same formula the live scoring screen uses, so this preview matches what
  // actually happens hole-by-hole rather than showing the raw, un-cut index.
  const allowance = hcpAllowance ?? 100;
  const rawCourseHcp = (!day?.slope_rating || !day?.course_rating || !day?.course_par)
    ? Math.round(player.handicap_index)
    : calcCourseHandicap(player.handicap_index, day.slope_rating, day.course_rating, day.course_par);
  const cutHcp = Math.round(rawCourseHcp * (allowance / 100));
  const isCut = allowance !== 100;

  // 4BBB Stroke Matchplay: shots actually received once the group's lowest
  // cut handicap is subtracted (that player plays off scratch).
  const shotsReceived = isRelativeHcp ? Math.max(0, cutHcp - (groupLowestCutHcp ?? 0)) : null;

  return (
    <View style={s.playerCard}>
      <View style={[s.avatarRing, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }]}>
        <Avatar name={firstName} size={size} src={avatar} />
      </View>
      <Text style={s.playerName}>{firstName}</Text>
      <Text style={s.playerHcp}>
        {shotsReceived !== null
          ? `Playing Hcp ${cutHcp} · ${shotsReceived} shot${shotsReceived === 1 ? '' : 's'}`
          : isCut ? `Playing Hcp ${cutHcp} (Idx ${player.handicap_index})` : `Hcp ${player.handicap_index}`}
      </Text>
    </View>
  );
}

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={s.detailRow}>
      <Ionicons name={icon as any} size={16} color="#6b7280" />
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#000000' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 56, paddingHorizontal: 16, paddingBottom: 8,
  },
  headerSide:   { width: 40 },
  headerCenter: { flex: 1, alignItems: 'center', gap: 2 },
  headerLogo:   { width: 28, height: 28 },
  headerSub:    { fontFamily: FFB, fontSize: 9, color: GOLD, letterSpacing: 2.5 },

  courseBlock: { alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16, gap: 4 },
  courseName:  { fontFamily: FFB, fontSize: 28, color: '#ffffff', textAlign: 'center' },
  coursePar:   { fontFamily: FFB, fontSize: 14, color: '#fff' },
  voiceBadge:  { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, backgroundColor: `${GOLD}0d`, borderWidth: 1, borderColor: `${GOLD}30` },
  voiceBadgeText: { fontFamily: FFB, fontSize: 9, color: GOLD, letterSpacing: 1.5 },

  scroll: { paddingHorizontal: 16, paddingBottom: 120, gap: 16 },

  matchupRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  soloRow:    { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 20, paddingVertical: 8 },
  side:       { flex: 1, alignItems: 'center', gap: 12 },
  vsWrap:     { width: 44, alignItems: 'center' },
  vsText:     { fontFamily: FFB, fontSize: 18, color: '#333', letterSpacing: 2 },

  playerCard: { alignItems: 'center', gap: 6 },
  avatarRing: { borderWidth: 2, borderColor: `${GOLD}40`, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  playerName: { fontFamily: FFB, fontSize: 14, color: '#ffffff' },
  playerHcp:  { fontFamily: FFB, fontSize: 12, color: '#fff' },

  detailCard: {
    backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden',
  },
  detailRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  detailLabel: { fontFamily: FFB, fontSize: 12, color: '#fff', width: 80 },
  detailValue: { flex: 1, fontFamily: FFB, fontSize: 13, color: '#ffffff', textAlign: 'right' },
  divider:     { height: 1, backgroundColor: '#1a1a1a' },

  dayCard: {
    backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 1, borderColor: `${GOLD}30`,
    padding: 16, alignItems: 'center', gap: 8,
  },
  dayCardTitle: { fontFamily: FFB, fontSize: 9, color: GOLD, letterSpacing: 2 },
  dayCardSub:   { fontFamily: FFB, fontSize: 11, color: '#fff', textAlign: 'center' },
  dayCode:      { fontFamily: FFB, fontSize: 38, color: '#ffffff', letterSpacing: 10, marginVertical: 4 },
  dayBtn:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: `${GOLD}0d`, borderWidth: 1, borderColor: `${GOLD}30` },
  dayBtnText:   { fontFamily: FFB, fontSize: 13, color: GOLD },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 16, paddingBottom: 40,
    backgroundColor: '#000000',
    borderTopWidth: 1, borderTopColor: '#111111',
  },
  teeBtn: {
    backgroundColor: GOLD, borderRadius: 14,
    paddingVertical: 17,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  teeBtnText: { fontFamily: FFB, fontSize: 18, color: '#000000' },
});
