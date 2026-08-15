import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Modal, Platform, Image, FlatList,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { getStandings, calcSweepBonus } from '../../../src/lib/scoring';

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

const DAY_FORMAT_LABELS: Record<string, string> = {
  four_bbb: '4BBB', four_bbb_stroke: '4BBB Stroke', foursomes: 'Foursomes', greensomes: 'Greensomes',
  singles: 'Singles', stableford: 'Stableford', medal: 'Medal', scramble: 'Scramble',
  '4bbb': '4BBB Stableford',
};

function dayFormatToRoundFormat(df: string): string {
  if (df === 'stableford') return 'stableford';
  if (df === 'medal') return 'medal';
  if (df === 'scramble') return 'scramble';
  // 4bbb / four_bbb / four_bbb_stroke / foursomes / greensomes / singles are
  // all matchplay (win/halve/lose by hole) as far as the live scoring screen
  // is concerned — it only ever checks for 'matchplay' | 'stableford' | 'medal',
  // so anything else here silently loses the format label and status banner.
  return 'matchplay';
}

function dayFormatToHandicapMethod(df: string): string {
  if (df === 'four_bbb_stroke') return 'relative_low';
  // 4BBB Stableford also plays the lowest Playing Handicap in the fourball
  // off scratch, same method as 4BBB Stroke — but keeps its own distinct
  // value so it doesn't collide with Foursomes/Greensomes, which also map
  // to round_format 'matchplay' + is_singles false and must stay untouched.
  if (df === 'four_bbb') return 'relative_low_stableford';
  return 'individual';
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type Tab = 'players' | 'draw' | 'activate';

interface CompInfo {
  id: string; name: string; status: string;
  tournament_type: string; pts_win: number; pts_half: number;
  opening_rounds: number; bonus_points: number; max_handicap: number | null;
  settings: { num_teams?: number | null } | null;
}
interface DayRow {
  id: string; day_number: number; course_name: string | null;
  day_format: string | null; hcp_pct: number;
}
interface CompPlayer {
  id: string; player_id: string; team_id: string | null; handicap_index: number | null;
  display_name: string; avatar_url: string | null; is_captain: boolean;
}
interface TeamRow { id: string; name: string; accent_color: string; }
interface MatchRow {
  id: string; day_id: string; match_number: number | null;
  home_player_ids: string[]; away_player_ids: string[];
  home_team_id: string | null; away_team_id: string | null; status: string;
  winner: string | null; result_str: string | null; holes_string: string; is_singles: boolean;
}
interface SocMember { player_id: string; display_name: string; handicap_index: number | null; team_id: string | null; }

export default function TournamentDrawScreen() {
  const { id: competitionId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { societyId } = useAdminSociety();

  const [fontsLoaded] = useFonts({
    [FF]:  require('../../../assets/fonts/JUSTSans-Regular.otf'),
    [FFB]: require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [tab, setTab]                   = useState<Tab>('players');
  const [loading, setLoading]           = useState(true);
  const [comp, setComp]                 = useState<CompInfo | null>(null);
  const [days, setDays]                 = useState<DayRow[]>([]);
  const [compPlayers, setCompPlayers]   = useState<CompPlayer[]>([]);
  const [teams, setTeams]               = useState<TeamRow[]>([]);
  const [matches, setMatches]           = useState<MatchRow[]>([]);
  const [societyMembers, setSocietyMembers] = useState<SocMember[]>([]);
  const [stablefordTotals, setStablefordTotals] = useState<Record<string, number>>({});

  const [addModal, setAddModal]         = useState(false);
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());
  const [addTeam, setAddTeam]           = useState<string | null>(null);
  const [adding, setAdding]             = useState(false);
  const [generating, setGenerating]     = useState<string | null>(null);
  const [activating, setActivating]     = useState(false);

  const load = useCallback(async () => {
    if (!competitionId) return;
    const [
      { data: compData },
      { data: daysData },
      { data: cpData },
      { data: teamsData },
      { data: matchData },
    ] = await Promise.all([
      supabase.from('competitions').select('id,name,status,tournament_type,pts_win,pts_half,opening_rounds,bonus_points,max_handicap,settings').eq('id', competitionId).single(),
      supabase.from('competition_days').select('id,day_number,course_name,day_format,hcp_pct').eq('competition_id', competitionId).order('day_number'),
      supabase.from('competition_players')
        .select('id,player_id,team_id,handicap_index,is_captain,players(display_name,avatar_url)')
        .eq('competition_id', competitionId),
      supabase.from('teams').select('id,name,accent_color').eq('society_id', societyId ?? '').order('sort_order'),
      supabase.from('matches').select('id,day_id,match_number,home_player_ids,away_player_ids,home_team_id,away_team_id,status,winner,result_str,holes_string,is_singles')
        .eq('competition_id', competitionId).order('match_number'),
    ]);

    if (compData) setComp(compData as unknown as CompInfo);
    if (daysData) setDays(daysData as DayRow[]);
    if (cpData)   setCompPlayers((cpData as any[]).map(cp => ({
      id: cp.id, player_id: cp.player_id, team_id: cp.team_id,
      handicap_index: cp.handicap_index,
      display_name: cp.players?.display_name ?? '—',
      avatar_url: cp.players?.avatar_url ?? null,
      is_captain: cp.is_captain ?? false,
    })));
    if (teamsData) setTeams(teamsData as TeamRow[]);
    if (matchData) setMatches(matchData as unknown as MatchRow[]);

    // Cumulative Stableford so far this tournament, used to rank players for
    // singles-draw pairing (best-vs-best across the two sides).
    if (matchData && (matchData as any[]).length > 0) {
      const matchIds = (matchData as any[]).map(m => m.id);
      const { data: holesData } = await supabase
        .from('match_holes').select('player_id,stableford_pts').in('match_id', matchIds);
      const totals: Record<string, number> = {};
      (holesData as any[] ?? []).forEach(h => {
        if (h.stableford_pts != null) totals[h.player_id] = (totals[h.player_id] ?? 0) + h.stableford_pts;
      });
      setStablefordTotals(totals);
    } else {
      setStablefordTotals({});
    }
    setLoading(false);
  }, [competitionId, societyId]);

  useEffect(() => { load(); }, [load]);

  async function loadSocietyMembers() {
    if (!societyId) return;
    const { data } = await supabase
      .from('society_members')
      .select('player_id, team_id, players(display_name, handicap_index)')
      .eq('society_id', societyId);
    if (data) {
      const enrolled = new Set(compPlayers.map(cp => cp.player_id));
      setSocietyMembers(
        (data as any[])
          .filter(m => !enrolled.has(m.player_id))
          .map(m => ({
            player_id: m.player_id,
            display_name: m.players?.display_name ?? '—',
            handicap_index: m.players?.handicap_index ?? null,
            team_id: m.team_id ?? null,
          }))
      );
    }
  }

  async function openAddModal() {
    setSelectedToAdd(new Set());
    setAddTeam(teams[0]?.id ?? null);
    await loadSocietyMembers();
    setAddModal(true);
  }

  async function confirmAddPlayers() {
    if (selectedToAdd.size === 0) { setAddModal(false); return; }
    setAdding(true);
    try {
      const member = societyMembers.filter(m => selectedToAdd.has(m.player_id));
      const maxHcp = comp?.max_handicap ?? null;
      const rows = member.map(m => ({
        competition_id: competitionId,
        player_id: m.player_id,
        // Prebuilt team rosters carry straight into the tournament — a
        // player's permanent team wins over the bulk "add to team" picker,
        // which now only matters as a fallback for players with no
        // permanent team yet. Move players afterward via the Transfer Window.
        team_id: isTeamTournament ? (m.team_id ?? addTeam) : null,
        // Players above the tournament's max handicap play from the max instead.
        handicap_index: (maxHcp != null && m.handicap_index != null)
          ? Math.min(m.handicap_index, maxHcp)
          : m.handicap_index,
      }));
      const { error } = await supabase.from('competition_players').insert(rows);
      if (error) { Alert.alert('Error', error.message); return; }
      setAddModal(false);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not add players.');
    } finally {
      setAdding(false);
    }
  }

  // Generated matches store player IDs directly on the match row (not a live
  // reference to competition_players), so removing/reassigning a player here
  // wouldn't update matches already drawn — they'd keep scoring for a team
  // they've left, or a departed player would stay playable. Block instead of
  // silently leaving the draw inconsistent; the admin should clear and
  // regenerate the affected day(s) first.
  function playerInGeneratedMatch(playerId: string): boolean {
    return matches.some(m => m.home_player_ids.includes(playerId) || m.away_player_ids.includes(playerId));
  }

  async function removePlayer(cp: CompPlayer) {
    if (playerInGeneratedMatch(cp.player_id)) {
      Alert.alert('Already in a generated match', `${cp.display_name} is in a match that's already been drawn. Clear that day's draw first, then remove them.`);
      return;
    }
    Alert.alert('Remove player?', cp.display_name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        await supabase.from('competition_players').delete().eq('id', cp.id);
        await load();
      }},
    ]);
  }

  async function changeTeam(cp: CompPlayer, teamId: string | null) {
    if (playerInGeneratedMatch(cp.player_id)) {
      Alert.alert('Already in a generated match', `${cp.display_name} is in a match that's already been drawn. Clear that day's draw first, then change their team.`);
      return;
    }
    await supabase.from('competition_players').update({ team_id: teamId }).eq('id', cp.id);
    await load();
  }

  async function toggleCaptain(cp: CompPlayer) {
    if (!cp.team_id) return;
    if (cp.is_captain) {
      await supabase.from('competition_players').update({ is_captain: false }).eq('id', cp.id);
    } else {
      // Only one captain per team — clear any existing captain on this team first.
      await supabase.from('competition_players').update({ is_captain: false }).eq('competition_id', competitionId).eq('team_id', cp.team_id);
      await supabase.from('competition_players').update({ is_captain: true }).eq('id', cp.id);
    }
    await load();
  }

  // Teammates a captain has already partnered with in a pairs match on an
  // earlier opening-round day — used so the draw spreads the captain around
  // the team instead of leaving pairing pure luck-of-the-shuffle.
  function priorPartners(teamId: string, playerId: string, beforeDayNumber: number): Set<string> {
    const openingRounds = comp?.opening_rounds ?? 0;
    const partners = new Set<string>();
    for (const m of matches) {
      const day = days.find(d => d.id === m.day_id);
      if (!day || day.day_number >= beforeDayNumber || day.day_number > openingRounds) continue;
      if (m.home_team_id === teamId && m.home_player_ids.includes(playerId)) {
        m.home_player_ids.forEach(pid => { if (pid !== playerId) partners.add(pid); });
      }
      if (m.away_team_id === teamId && m.away_player_ids.includes(playerId)) {
        m.away_player_ids.forEach(pid => { if (pid !== playerId) partners.add(pid); });
      }
    }
    return partners;
  }

  async function generateDraw(day: DayRow) {
    // Guard re-entrancy directly rather than relying only on the button's
    // disabled state, which can race on a fast double-tap before re-render.
    if (generating) return;

    const df = day.day_format ?? 'singles';
    const roundFmt  = dayFormatToRoundFormat(df);
    const handicapMethod = dayFormatToHandicapMethod(df);
    const hcp       = day.hcp_pct ?? 100;

    // Individual Stableford / Stroke Play days have no opponent to pair
    // against — Rick: "singles tournament that runs exactly like the
    // stableford team version but singles only." Every player just posts
    // their own card in a group of up to 4, the exact same shape a normal
    // multi-player Casual Round group already uses (everyone in
    // home_player_ids, away side empty — see isSolo checks elsewhere).
    // No team assignment needed at all, so this skips the team-grouping
    // logic below entirely rather than forcing an artificial 1v1 pairing.
    const isIndividual = df === 'stableford' || df === 'medal';
    if (isIndividual) {
      const allPlayerIds = compPlayers.map(cp => cp.player_id);
      if (allPlayerIds.length === 0) {
        Alert.alert('No players', 'Enrol players before generating the draw.');
        return;
      }
      const GROUP_SIZE = 4;
      const shuffled = shuffle(allPlayerIds);
      const groups: string[][] = [];
      for (let i = 0; i < shuffled.length; i += GROUP_SIZE) {
        groups.push(shuffled.slice(i, i + GROUP_SIZE));
      }
      const matchRows = groups.map((group, idx) => ({
        competition_id:  competitionId,
        day_id:          day.id,
        match_number:    idx + 1,
        home_team_id:    null,
        away_team_id:    null,
        home_player_ids: group,
        away_player_ids: [],
        round_format:    roundFmt,
        is_singles:      false,
        hcp_allowance:   hcp,
        handicap_method: handicapMethod,
        status:          'upcoming',
      }));
      setGenerating(day.id);
      try {
        const { error } = await supabase.from('matches').insert(matchRows);
        if (error) { Alert.alert('Error', error.message); return; }
        await load();
      } catch (e: any) {
        Alert.alert('Error', e?.message ?? 'Could not generate the draw.');
      } finally {
        setGenerating(null);
      }
      return;
    }

    const grouped: Record<string, string[]> = {};
    for (const cp of compPlayers) {
      if (!cp.team_id) continue;
      if (!grouped[cp.team_id]) grouped[cp.team_id] = [];
      grouped[cp.team_id].push(cp.player_id);
    }
    const teamIds = Object.keys(grouped);
    if (teamIds.length < 2) {
      Alert.alert('Not enough teams', 'Assign players to at least 2 teams before generating the draw.');
      return;
    }

    const isSingles = df === 'singles';
    const isPairs   = ['4bbb', 'four_bbb', 'four_bbb_stroke', 'foursomes', 'greensomes'].includes(df);
    const ppm       = isPairs ? 2 : 1;
    const isOpeningRound = day.day_number <= (comp?.opening_rounds ?? 0);
    const maxDayNumber   = days.length > 0 ? Math.max(...days.map(d => d.day_number)) : day.day_number;
    const isFinalDay      = day.day_number === maxDayNumber;

    // Order each team's roster for how this day should pair them:
    // - Singles: best-to-worst by Stableford so far, so pairing by index
    //   matches best-vs-best across the two sides (spec: auto-pair by rank).
    // - Pairs, opening rounds: captain first, partnered with a teammate they
    //   haven't played with yet this opening window; rest shuffled.
    // - Everything else: pure shuffle, as before.
    for (const tid of teamIds) {
      const roster = grouped[tid];
      if (isSingles) {
        grouped[tid] = [...roster].sort((a, b) => (stablefordTotals[b] ?? 0) - (stablefordTotals[a] ?? 0));
      } else if (isPairs && isOpeningRound) {
        const captain = compPlayers.find(cp => cp.team_id === tid && cp.is_captain)?.player_id;
        if (captain && roster.includes(captain)) {
          const already = priorPartners(tid, captain, day.day_number);
          const candidates = roster.filter(pid => pid !== captain && !already.has(pid));
          const pool = candidates.length > 0 ? candidates : roster.filter(pid => pid !== captain);
          const partner = shuffle(pool)[0];
          const rest = shuffle(roster.filter(pid => pid !== captain && pid !== partner));
          grouped[tid] = partner ? [captain, partner, ...rest] : shuffle(roster);
        } else {
          grouped[tid] = shuffle(roster);
        }
      } else {
        grouped[tid] = shuffle(roster);
      }
    }

    const matchRows: any[] = [];
    let matchNum = 1;

    if (teamIds.length === 2) {
      const [tA, tB] = teamIds;
      const pA = grouped[tA]; const pB = grouped[tB];
      const n = Math.floor(Math.min(pA.length, pB.length) / ppm);
      for (let i = 0; i < n; i++) {
        matchRows.push({
          competition_id: competitionId,
          day_id:         day.id,
          match_number:   matchNum++,
          home_team_id:   tA,
          away_team_id:   tB,
          home_player_ids: isPairs ? [pA[i*2], pA[i*2+1]].filter(Boolean) : [pA[i]],
          away_player_ids: isPairs ? [pB[i*2], pB[i*2+1]].filter(Boolean) : [pB[i]],
          round_format:   roundFmt,
          is_singles:     isSingles,
          hcp_allowance:  hcp,
          handicap_method: handicapMethod,
          status:         'upcoming',
        });
      }
    } else if (isFinalDay) {
      // Final-day knockout: pair by current league position — 1st vs 2nd,
      // 3rd vs 4th, etc. — rather than the round-robin rotation used earlier.
      // Must feed getStandings the exact same tie-break inputs the Tour tab
      // leaderboard uses, or the two screens can show contradictory
      // positions on the day it matters most.
      const singlesDayIds = new Set(days.filter(d => d.day_format === 'singles').map(d => d.id));
      const bonusPts = calcSweepBonus(matches as any, singlesDayIds, comp?.bonus_points ?? 2);
      const teamStableford: Record<string, number> = {};
      compPlayers.forEach(cp => {
        if (!cp.team_id) return;
        teamStableford[cp.team_id] = (teamStableford[cp.team_id] ?? 0) + (stablefordTotals[cp.player_id] ?? 0);
      });
      const standings = getStandings(
        matches.filter(m => m.home_team_id && m.away_team_id) as any,
        comp?.pts_win ?? 1, comp?.pts_half ?? 0.5,
        teamStableford, bonusPts,
      );
      const bracket = standings.map(s => s.teamId).filter(id => teamIds.includes(id));
      for (const tid of teamIds) if (!bracket.includes(tid)) bracket.push(tid);

      for (let i = 0; i < bracket.length - 1; i += 2) {
        const tH = bracket[i]; const tA = bracket[i + 1];
        const pH = grouped[tH] ?? []; const pA = grouped[tA] ?? [];
        const n = Math.floor(Math.min(pH.length, pA.length) / ppm);
        for (let j = 0; j < n; j++) {
          matchRows.push({
            competition_id: competitionId,
            day_id:         day.id,
            match_number:   matchNum++,
            home_team_id:   tH,
            away_team_id:   tA,
            home_player_ids: isPairs ? [pH[j*2], pH[j*2+1]].filter(Boolean) : [pH[j]],
            away_player_ids: isPairs ? [pA[j*2], pA[j*2+1]].filter(Boolean) : [pA[j]],
            round_format:   roundFmt,
            is_singles:     isSingles,
            hcp_allowance:  hcp,
          handicap_method: handicapMethod,
            status:         'upcoming',
          });
        }
      }
    } else {
      // Round-robin: rotate fixture list by day_number so matchups vary each
      // day (the "circle method"). Odd team counts get a "bye" placeholder
      // added to the circle so every real team still gets a fair rotation —
      // without it, whichever team lands in the middle each day is silently
      // dropped, which for 3 teams means two of them never play each other
      // all tournament while the third plays every single day.
      const hasBye = teamIds.length % 2 !== 0;
      const scheduleIds: (string | null)[] = hasBye ? [...teamIds, null] : [...teamIds];
      const rot = (day.day_number - 1) % Math.max(1, scheduleIds.length - 1);
      const inner = [...scheduleIds.slice(1)];
      for (let r = 0; r < rot; r++) inner.push(inner.shift()!);
      const rotated = [scheduleIds[0], ...inner];

      for (let i = 0; i < Math.floor(rotated.length / 2); i++) {
        const tH = rotated[i];
        const tA = rotated[rotated.length - 1 - i];
        if (!tH || !tA) continue; // one side is the bye this day
        const pH = grouped[tH] ?? []; const pA = grouped[tA] ?? [];
        const n = Math.floor(Math.min(pH.length, pA.length) / ppm);
        for (let j = 0; j < n; j++) {
          matchRows.push({
            competition_id: competitionId,
            day_id:         day.id,
            match_number:   matchNum++,
            home_team_id:   tH,
            away_team_id:   tA,
            home_player_ids: isPairs ? [pH[j*2], pH[j*2+1]].filter(Boolean) : [pH[j]],
            away_player_ids: isPairs ? [pA[j*2], pA[j*2+1]].filter(Boolean) : [pA[j]],
            round_format:   roundFmt,
            is_singles:     isSingles,
            hcp_allowance:  hcp,
          handicap_method: handicapMethod,
            status:         'upcoming',
          });
        }
      }
    }

    if (matchRows.length === 0) {
      Alert.alert('No matches', 'Not enough players in teams to generate pairings for this format.');
      return;
    }

    setGenerating(day.id);
    try {
      const { error } = await supabase.from('matches').insert(matchRows);
      if (error) { Alert.alert('Error', error.message); return; }
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not generate the draw.');
    } finally {
      setGenerating(null);
    }
  }

  async function clearDay(day: DayRow) {
    Alert.alert('Clear Day ' + day.day_number + '?', 'This deletes all matches for this day.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => {
        await supabase.from('matches').delete().eq('day_id', day.id);
        await load();
      }},
    ]);
  }

  async function activateTournament() {
    const totalMatches = matches.length;
    if (totalMatches === 0) {
      Alert.alert('No matches', 'Generate the draw before activating the tournament.');
      return;
    }
    Alert.alert('Activate Tournament?', `${comp?.name} will go live. Players will be able to see it using the PIN.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Activate', onPress: async () => {
        setActivating(true);
        try {
          const { error } = await supabase.from('competitions').update({ status: 'active' }).eq('id', competitionId);
          if (error) { Alert.alert('Error', error.message); return; }
          await load();
          Alert.alert('Tournament Live!', `${comp?.name} is now active. Share the PIN with players.`);
        } catch (e: any) {
          Alert.alert('Error', e?.message ?? 'Could not activate the tournament.');
        } finally {
          setActivating(false);
        }
      }},
    ]);
  }

  if (!fontsLoaded || loading) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" />
      <ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  const unassigned = compPlayers.filter(cp => !cp.team_id);
  const teamsWithPlayers = new Set(compPlayers.map(cp => cp.team_id).filter(Boolean)).size;
  const configuredTeams = comp?.settings?.num_teams ?? null;
  const teamCountMismatch = configuredTeams != null && teamsWithPlayers > 0 && teamsWithPlayers !== configuredTeams;
  // Ryder Cup / Titan Tour are the only team-based tournament types — a
  // Standard Tournament (Individual Stableford, Stroke Play, etc.) is just
  // a player pool and shouldn't ask for team assignment at all.
  const isTeamTournament = comp?.tournament_type === 'ryder_cup' || comp?.tournament_type === 'titan_tour';
  const daysWithMatches = new Set(matches.map(m => m.day_id));
  const allDaysHaveMatches = days.length > 0 && days.every(d => daysWithMatches.has(d.id));

  const playerNames: Record<string, string> = {};
  compPlayers.forEach(cp => { playerNames[cp.player_id] = cp.display_name; });

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Image source={titanLogo} style={s.logo} resizeMode="contain" />
          <Text style={s.headerTitle}>{comp?.name ?? 'TOURNAMENT'}</Text>
          <View style={[s.statusBadge, { borderColor: comp?.status === 'active' ? GREEN : GOLD, backgroundColor: comp?.status === 'active' ? GREEN + '18' : GOLD + '18' }]}>
            <Text style={[s.statusText, { color: comp?.status === 'active' ? GREEN : GOLD }]}>
              {comp?.status?.toUpperCase() ?? 'DRAFT'}
            </Text>
          </View>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {/* Tab bar */}
      <View style={s.tabs}>
        {(['players', 'draw', 'activate'] as Tab[]).map(t => (
          <TouchableOpacity key={t} style={[s.tabBtn, tab === t && s.tabBtnOn]} onPress={() => setTab(t)} activeOpacity={0.7}>
            <Text style={[s.tabLabel, tab === t && s.tabLabelOn]}>{t.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── PLAYERS TAB ─────────────────────────────────────────── */}
        {tab === 'players' && (
          <View>
            <View style={s.sectionRow}>
              <Text style={s.sectionLabel}>{compPlayers.length} PLAYERS ENROLLED</Text>
              <TouchableOpacity style={s.addBtn} onPress={openAddModal} activeOpacity={0.8}>
                <Text style={s.addBtnText}>+ ADD</Text>
              </TouchableOpacity>
            </View>

            {isTeamTournament && unassigned.length > 0 && (
              <View style={[s.warnBanner]}>
                <Ionicons name="warning-outline" size={14} color={GOLD} />
                <Text style={s.warnText}>{unassigned.length} player{unassigned.length !== 1 ? 's' : ''} not assigned to a team</Text>
              </View>
            )}
            {isTeamTournament && teamCountMismatch && (
              <View style={[s.warnBanner]}>
                <Ionicons name="warning-outline" size={14} color={GOLD} />
                <Text style={s.warnText}>Set up for {configuredTeams} teams, but only {teamsWithPlayers} have players assigned</Text>
              </View>
            )}

            {compPlayers.length === 0 ? (
              <View style={s.empty}>
                <Text style={s.emptyText}>No players yet. Tap + ADD to enrol players.</Text>
              </View>
            ) : (
              compPlayers.map(cp => (
                <View key={cp.id} style={s.playerRow}>
                  {isTeamTournament && (
                    <TouchableOpacity
                      onPress={() => toggleCaptain(cp)}
                      disabled={!cp.team_id}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons
                        name={cp.is_captain ? 'star' : 'star-outline'}
                        size={18}
                        color={cp.is_captain ? GOLD : (cp.team_id ? '#555' : '#222')}
                      />
                    </TouchableOpacity>
                  )}
                  <View style={s.playerInfo}>
                    <Text style={s.playerName}>{cp.display_name}{cp.is_captain ? '  (C)' : ''}</Text>
                    {cp.handicap_index != null && (
                      <Text style={s.playerHcp}>HCP {cp.handicap_index}</Text>
                    )}
                  </View>
                  {/* Team chips — only for team-based tournaments; a
                      Standard/Individual tournament is just a player pool */}
                  {isTeamTournament && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                      <TouchableOpacity
                        style={[s.teamChip, !cp.team_id && s.teamChipOn, { borderColor: !cp.team_id ? RED : '#333' }]}
                        onPress={() => changeTeam(cp, null)}
                      >
                        <Text style={[s.teamChipText, { color: !cp.team_id ? RED : '#555' }]}>None</Text>
                      </TouchableOpacity>
                      {teams.map(t => (
                        <TouchableOpacity
                          key={t.id}
                          style={[s.teamChip, cp.team_id === t.id && s.teamChipOn, { borderColor: cp.team_id === t.id ? t.accent_color : '#333' }]}
                          onPress={() => changeTeam(cp, t.id)}
                        >
                          <View style={[s.teamDot, { backgroundColor: t.accent_color }]} />
                          <Text style={[s.teamChipText, { color: cp.team_id === t.id ? t.accent_color : '#888' }]}>{t.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                  <TouchableOpacity onPress={() => removePlayer(cp)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle-outline" size={20} color="#555" />
                  </TouchableOpacity>
                </View>
              ))
            )}

            {/* Team summary */}
            {isTeamTournament && teams.length > 0 && compPlayers.length > 0 && (
              <View style={s.teamSummary}>
                <Text style={[s.sectionLabel, { marginBottom: 10 }]}>TEAM BREAKDOWN</Text>
                {teams.map(t => {
                  const count = compPlayers.filter(cp => cp.team_id === t.id).length;
                  return (
                    <View key={t.id} style={s.teamSummaryRow}>
                      <View style={[s.teamDot, { backgroundColor: t.accent_color, width: 10, height: 10, borderRadius: 5 }]} />
                      <Text style={s.teamSummaryName}>{t.name}</Text>
                      <Text style={s.teamSummaryCount}>{count} player{count !== 1 ? 's' : ''}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ── DRAW TAB ─────────────────────────────────────────────── */}
        {tab === 'draw' && (
          <View>
            <Text style={s.sectionLabel}>{days.length} DAYS</Text>
            {days.length === 0 && (
              <View style={s.empty}>
                <Text style={s.emptyText}>No days configured. Add days in the tournament builder.</Text>
              </View>
            )}
            {days.map(day => {
              const dayMatches = matches.filter(m => m.day_id === day.id);
              const isGen = generating === day.id;
              return (
                <View key={day.id} style={s.dayCard}>
                  <View style={s.dayCardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.dayNum}>DAY {day.day_number}</Text>
                      <Text style={s.dayName}>{day.course_name || 'Course TBC'}</Text>
                      <View style={s.dayBadges}>
                        {day.day_format && (
                          <View style={s.fmtBadge}>
                            <Text style={s.fmtBadgeText}>{DAY_FORMAT_LABELS[day.day_format] ?? day.day_format}</Text>
                          </View>
                        )}
                        <View style={[s.fmtBadge, { borderColor: '#555' }]}>
                          <Text style={[s.fmtBadgeText, { color: '#888' }]}>{day.hcp_pct ?? 100}% HCP</Text>
                        </View>
                      </View>
                    </View>
                    <View style={{ gap: 6 }}>
                      <TouchableOpacity
                        style={[s.genBtn, dayMatches.length > 0 && s.genBtnSecondary]}
                        onPress={() => dayMatches.length > 0 ? clearDay(day) : generateDraw(day)}
                        disabled={isGen}
                        activeOpacity={0.8}
                      >
                        {isGen
                          ? <ActivityIndicator size="small" color="#000" />
                          : <Text style={[s.genBtnText, dayMatches.length > 0 && s.genBtnTextSecondary]}>
                              {dayMatches.length > 0 ? 'CLEAR' : 'GENERATE'}
                            </Text>
                        }
                      </TouchableOpacity>
                    </View>
                  </View>

                  {dayMatches.length > 0 && (
                    <View style={s.matchList}>
                      {dayMatches.map((m, idx) => {
                        // Individual Stableford/Medal groups have no away
                        // side at all (see generateDraw's isIndividual
                        // branch) — show it as one plain group, not a "vs".
                        if (m.away_player_ids.length === 0 && !m.away_team_id) {
                          const groupNames = m.home_player_ids.map(id => playerNames[id]?.split(' ')[0] ?? '?').join(', ');
                          return (
                            <View key={m.id} style={[s.matchItem, idx > 0 && { borderTopWidth: 1, borderTopColor: '#1c1c1c' }]}>
                              <Text style={[s.matchTeam, { color: '#fff', flex: 1 }]}>{groupNames}</Text>
                            </View>
                          );
                        }
                        const homeName = teams.find(t => t.id === m.home_team_id)?.name
                          ?? m.home_player_ids.map(id => playerNames[id]?.split(' ')[0] ?? '?').join(' & ');
                        const awayName = teams.find(t => t.id === m.away_team_id)?.name
                          ?? m.away_player_ids.map(id => playerNames[id]?.split(' ')[0] ?? '?').join(' & ');
                        const homeColor = teams.find(t => t.id === m.home_team_id)?.accent_color ?? '#555';
                        const awayColor = teams.find(t => t.id === m.away_team_id)?.accent_color ?? '#555';
                        return (
                          <View key={m.id} style={[s.matchItem, idx > 0 && { borderTopWidth: 1, borderTopColor: '#1c1c1c' }]}>
                            <Text style={[s.matchTeam, { color: homeColor }]}>{homeName}</Text>
                            <Text style={s.vsText}>vs</Text>
                            <Text style={[s.matchTeam, { color: awayColor }]}>{awayName}</Text>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* ── ACTIVATE TAB ─────────────────────────────────────────── */}
        {tab === 'activate' && (
          <View>
            <Text style={s.sectionLabel}>TOURNAMENT SUMMARY</Text>
            <View style={s.summaryCard}>
              <SummaryRow label="Name"    value={comp?.name ?? '—'} />
              <SummaryRow label="Type"    value={comp?.tournament_type === 'ryder_cup' ? 'Ryder Cup' : comp?.tournament_type === 'titan_tour' ? 'Titan Tour' : 'Casual'} />
              <SummaryRow label="Points"  value={`Win ${comp?.pts_win ?? 1} / Half ${comp?.pts_half ?? 0.5}`} />
              <SummaryRow label="Players" value={`${compPlayers.length}`} />
              <SummaryRow label="Teams"   value={`${teams.filter(t => compPlayers.some(cp => cp.team_id === t.id)).length} of ${teams.length}`} />
              <SummaryRow label="Days"    value={`${days.length}`} />
              <SummaryRow label="Matches" value={`${matches.length}`} last />
            </View>

            {unassigned.length > 0 && (
              <View style={[s.warnBanner, { marginBottom: 12 }]}>
                <Ionicons name="warning-outline" size={14} color={GOLD} />
                <Text style={s.warnText}>{unassigned.length} player{unassigned.length !== 1 ? 's' : ''} not assigned to a team</Text>
              </View>
            )}
            {!allDaysHaveMatches && days.length > 0 && (
              <View style={[s.warnBanner, { marginBottom: 12 }]}>
                <Ionicons name="warning-outline" size={14} color={GOLD} />
                <Text style={s.warnText}>Some days have no matches — generate the draw first</Text>
              </View>
            )}

            <TouchableOpacity
              style={s.prizesBtn}
              onPress={() => router.push(`/(app)/admin/prizes?id=${competitionId}` as any)}
              activeOpacity={0.8}
            >
              <Text style={s.prizesBtnText}>🏅  CONFIGURE PRIZES →</Text>
            </TouchableOpacity>

            {comp?.status === 'active' ? (
              <View style={[s.activatedBanner]}>
                <Ionicons name="checkmark-circle" size={18} color={GREEN} />
                <Text style={[s.warnText, { color: GREEN }]}>Tournament is LIVE</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[s.activateBtn, activating && { opacity: 0.6 }]}
                onPress={activateTournament}
                disabled={activating}
                activeOpacity={0.85}
              >
                {activating
                  ? <ActivityIndicator color="#000" />
                  : <Text style={s.activateBtnText}>ACTIVATE TOURNAMENT</Text>
                }
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      {/* Add Players Modal */}
      <Modal visible={addModal} animationType="slide" presentationStyle="pageSheet">
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setAddModal(false)}>
              <Text style={s.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.modalTitle}>ADD PLAYERS</Text>
            <TouchableOpacity onPress={confirmAddPlayers} disabled={adding}>
              {adding ? <ActivityIndicator color={GOLD} size="small" /> : <Text style={s.modalDone}>Done</Text>}
            </TouchableOpacity>
          </View>

          {/* Team selector */}
          <View style={s.modalTeamRow}>
            <Text style={s.modalTeamLabel}>ASSIGN TO TEAM</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
              {teams.map(t => (
                <TouchableOpacity
                  key={t.id}
                  style={[s.teamChip, addTeam === t.id && s.teamChipOn, { borderColor: addTeam === t.id ? t.accent_color : '#333' }]}
                  onPress={() => setAddTeam(t.id)}
                >
                  <View style={[s.teamDot, { backgroundColor: t.accent_color }]} />
                  <Text style={[s.teamChipText, { color: addTeam === t.id ? t.accent_color : '#888' }]}>{t.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <FlatList
            data={societyMembers}
            keyExtractor={m => m.player_id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
            ListEmptyComponent={<Text style={[s.emptyText, { textAlign: 'center', marginTop: 40 }]}>All society members already enrolled</Text>}
            renderItem={({ item }) => {
              const selected = selectedToAdd.has(item.player_id);
              return (
                <TouchableOpacity
                  style={[s.memberRow, selected && s.memberRowOn]}
                  onPress={() => {
                    setSelectedToAdd(prev => {
                      const next = new Set(prev);
                      if (next.has(item.player_id)) next.delete(item.player_id);
                      else next.add(item.player_id);
                      return next;
                    });
                  }}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[s.memberName, selected && { color: GOLD }]}>{item.display_name}</Text>
                    {item.handicap_index != null && <Text style={s.memberHcp}>HCP {item.handicap_index}</Text>}
                  </View>
                  {selected && <Ionicons name="checkmark-circle" size={20} color={GOLD} />}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

function SummaryRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[sr.row, last && sr.last]}>
      <Text style={sr.key}>{label}</Text>
      <Text style={sr.val}>{value}</Text>
    </View>
  );
}
const sr = StyleSheet.create({
  row:  { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  last: { borderBottomWidth: 0 },
  key:  { width: 72, fontFamily: 'JUSTSans-ExBold', fontSize: 13, color: '#888' },
  val:  { flex: 1, fontFamily: 'JUSTSans-ExBold', fontSize: 13, color: '#fff' },
});

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 32, paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  back:        { fontFamily: 'JUSTSans-ExBold', fontSize: 13, color: GOLD },
  logo:        { width: 24, height: 24, marginBottom: 2 },
  headerTitle: { fontFamily: 'JUSTSans-ExBold', fontSize: 12, color: '#fff', letterSpacing: 1 },
  statusBadge: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  statusText:  { fontFamily: 'JUSTSans-ExBold', fontSize: 9, letterSpacing: 1 },

  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  tabBtn:    { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabBtnOn:  { borderBottomWidth: 2, borderBottomColor: GOLD },
  tabLabel:  { fontFamily: 'JUSTSans-ExBold', fontSize: 11, color: '#555', letterSpacing: 1 },
  tabLabelOn:{ color: GOLD },

  scroll: { padding: 16, paddingBottom: 60 },

  sectionRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionLabel:{ fontFamily: 'JUSTSans-ExBold', fontSize: 10, color: '#888', letterSpacing: 1.5 },
  addBtn:      { backgroundColor: GOLD + '1A', borderWidth: 1, borderColor: GOLD + '55', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  addBtnText:  { fontFamily: 'JUSTSans-ExBold', fontSize: 11, color: GOLD },

  warnBanner:  { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: GOLD + '12', borderRadius: 10, padding: 10, marginBottom: 16 },
  warnText:    { fontFamily: 'JUSTSans-ExBold', fontSize: 12, color: GOLD, flex: 1 },
  activatedBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: GREEN + '12', borderRadius: 10, padding: 14, marginTop: 8 },

  empty:     { alignItems: 'center', paddingVertical: 32 },
  emptyText: { fontFamily: 'JUSTSans-ExBold', fontSize: 13, color: '#555', textAlign: 'center' },

  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#111' },
  playerInfo:{ flex: 1 },
  playerName:{ fontFamily: 'JUSTSans-ExBold', fontSize: 14, color: '#fff' },
  playerHcp: { fontFamily: 'JUSTSans', fontSize: 11, color: '#555', marginTop: 1 },

  teamChip:     { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  teamChipOn:   { backgroundColor: 'rgba(255,255,255,0.05)' },
  teamChipText: { fontFamily: 'JUSTSans-ExBold', fontSize: 11 },
  teamDot:      { width: 8, height: 8, borderRadius: 4 },

  teamSummary:    { marginTop: 20, backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#1c1c1c', padding: 14 },
  teamSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  teamSummaryName:{ flex: 1, fontFamily: 'JUSTSans-ExBold', fontSize: 13, color: '#fff' },
  teamSummaryCount:{ fontFamily: 'JUSTSans', fontSize: 12, color: '#888' },

  dayCard:       { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 14, marginBottom: 12 },
  dayCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dayNum:        { fontFamily: 'JUSTSans-ExBold', fontSize: 10, color: GOLD, letterSpacing: 2, marginBottom: 2 },
  dayName:       { fontFamily: 'JUSTSans-ExBold', fontSize: 15, color: '#fff', marginBottom: 6 },
  dayBadges:     { flexDirection: 'row', gap: 6 },
  fmtBadge:      { borderRadius: 6, borderWidth: 1, borderColor: GOLD + '55', paddingHorizontal: 8, paddingVertical: 2 },
  fmtBadgeText:  { fontFamily: 'JUSTSans-ExBold', fontSize: 10, color: GOLD, letterSpacing: 0.5 },

  genBtn:          { backgroundColor: GOLD, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, minWidth: 84, alignItems: 'center' },
  genBtnSecondary: { backgroundColor: '#1c1c1c' },
  genBtnText:      { fontFamily: 'JUSTSans-ExBold', fontSize: 11, color: '#000', letterSpacing: 1 },
  genBtnTextSecondary: { color: RED },

  matchList: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#1c1c1c' },
  matchItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 6 },
  matchTeam: { flex: 1, fontFamily: 'JUSTSans-ExBold', fontSize: 13 },
  vsText:    { fontFamily: 'JUSTSans', fontSize: 11, color: '#555', width: 20, textAlign: 'center' },

  summaryCard: { backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden', marginBottom: 16 },
  prizesBtn:     { borderWidth: 1, borderColor: GOLD + '55', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 12, backgroundColor: GOLD + '0D' },
  prizesBtnText: { fontFamily: 'JUSTSans-ExBold', fontSize: 13, color: GOLD, letterSpacing: 0.5 },

  activateBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  activateBtnText: { fontFamily: 'JUSTSans-ExBold', fontSize: 15, color: '#000', letterSpacing: 0.5 },

  modal: { flex: 1, backgroundColor: '#000' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  modalCancel: { fontFamily: 'JUSTSans-ExBold', fontSize: 14, color: '#888' },
  modalTitle:  { fontFamily: 'JUSTSans-ExBold', fontSize: 13, color: '#fff', letterSpacing: 1 },
  modalDone:   { fontFamily: 'JUSTSans-ExBold', fontSize: 14, color: GOLD },
  modalTeamRow:{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#111' },
  modalTeamLabel: { fontFamily: 'JUSTSans-ExBold', fontSize: 10, color: '#888', letterSpacing: 1.5, paddingHorizontal: 16, marginBottom: 8 },

  memberRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#111' },
  memberRowOn: { backgroundColor: GOLD + '0A' },
  memberName:  { fontFamily: 'JUSTSans-ExBold', fontSize: 14, color: '#fff' },
  memberHcp:   { fontFamily: 'JUSTSans', fontSize: 11, color: '#555', marginTop: 2 },
});
