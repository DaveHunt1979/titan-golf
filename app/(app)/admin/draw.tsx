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
import { getStandings, calcSweepBonus, buildKronosTieBreakMaps, rankPlayersByKronos, type KronosTieBreakMaps } from '../../../src/lib/scoring';
import { resolveAvatar, teamLogos } from '../../../src/lib/assets';
import { goBack } from '../../../src/lib/navigation';
import { getFormatRules, checkTitanWayStructure } from '../../../src/lib/tournamentFormat';
import { generateTitanWaySchedule, computeRoundRobinMatchups } from '../../../src/lib/titanWayDraw';

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

// Shared between generateDraw's player-assignment logic and the manual
// assign/edit modal, which both need to know slot-count-per-side (2 for
// pairs, 1 for singles) without duplicating the format list.
const PAIRS_DAY_FORMATS = ['4bbb', 'four_bbb', 'four_bbb_stroke', 'foursomes', 'greensomes'];

// Individual Stableford/Medal groups (no team, no away side) are capped at
// this many players per group by generateDraw's auto-split — the manual
// assign/edit modal uses the same cap so editing one never truncates it.
const INDIVIDUAL_GROUP_SIZE = 4;

function isIndividualMatch(m: { home_team_id: string | null; away_team_id: string | null }): boolean {
  return !m.home_team_id && !m.away_team_id;
}

const DAY_FORMAT_LABELS: Record<string, string> = {
  four_bbb: '4BBB Match Play – Stableford', four_bbb_stroke: '4BBB Match Play – Stroke Play',
  foursomes: 'Foursomes', greensomes: 'Greensomes',
  singles: 'Singles Match Play – Stroke Play', singles_stableford: 'Singles Match Play – Stableford',
  stableford: 'Stableford', medal: 'Medal', scramble: 'Scramble',
  '4bbb': '4BBB Match Play – Stableford',
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
  // Singles Match Play – Stableford (Rick's brief, section 8) keeps its own
  // distinct value too, for the same reason 4BBB Stableford does — so the
  // scoring engine can tell "hole winner decided by Stableford points" apart
  // from plain Singles Match Play (round_format 'matchplay' + is_singles
  // true either way) without touching matchplayHcp's relative-low logic,
  // which is 4BBB-only and must not apply here (each player uses their own
  // Playing Handicap, per Rick's section 8.2).
  if (df === 'singles_stableford') return 'individual_stableford';
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

type Tab = 'players' | 'draw' | 'summary';

interface CompInfo {
  id: string; name: string; status: string; format: string;
  tournament_type: string; pts_win: number; pts_half: number;
  opening_rounds: number; bonus_points: number; max_handicap: number | null;
  handicap_cuts_enabled: boolean;
  settings: { num_teams?: number | null; voice_enabled?: boolean; track_stats_enabled?: boolean } | null;
}
interface DayRow {
  id: string; day_number: number; course_name: string | null;
  day_format: string | null; hcp_pct: number;
}
interface CompPlayer {
  id: string; player_id: string; team_id: string | null; handicap_index: number | null;
  display_name: string; avatar_url: string | null; is_captain: boolean;
}
interface TeamRow { id: string; name: string; accent_color: string; logo_url: string | null; }

function getTeamLogo(team: TeamRow) {
  if (team.logo_url) return { uri: team.logo_url };
  const key = Object.keys(teamLogos).find(k => team.name.includes(k) || k.includes(team.name));
  return key ? teamLogos[key] : null;
}
interface MatchRow {
  id: string; day_id: string; match_number: number | null;
  home_player_ids: string[]; away_player_ids: string[];
  home_team_id: string | null; away_team_id: string | null; status: string;
  winner: string | null; result_str: string | null; holes_string: string; start_hole: number | null; is_singles: boolean;
}
interface SocMember { player_id: string; display_name: string; handicap_index: number | null; team_id: string | null; avatar_url?: string | null; }

export default function TournamentDrawScreen() {
  const { id: competitionId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { societyId } = useAdminSociety();

  const [fontsLoaded] = useFonts({
    [FF]:  require('../../../assets/fonts/JUSTSans-Regular.otf'),
    [FFB]: require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [tab, setTab]                   = useState<Tab>('players');
  // Which team's roster is expanded below the crest row — mirrors the
  // build wizard's Draft step (admin/build.tsx) badge+roster pattern, so
  // amending an already-live tournament's players looks the same as
  // drafting them the first time. 'unassigned' is a sentinel, not a real
  // team id.
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  // The team's actual squad roster (society_members for that team_id), not
  // just whoever's currently enrolled in this tournament — swapping someone
  // in means being able to pick anyone on that team's roster, including
  // players who were never enrolled at all (Dave, 2026-08-19: "maybe Levi
  // can't play but Mike can").
  const [teamRosterCache, setTeamRosterCache] = useState<Record<string, SocMember[]>>({});
  const [rosterLoadingTeamId, setRosterLoadingTeamId] = useState<string | null>(null);
  const [rosterPlayerBusy, setRosterPlayerBusy] = useState<string | null>(null);
  const [loading, setLoading]           = useState(true);
  const [comp, setComp]                 = useState<CompInfo | null>(null);
  const [days, setDays]                 = useState<DayRow[]>([]);
  const [compPlayers, setCompPlayers]   = useState<CompPlayer[]>([]);
  const [teams, setTeams]               = useState<TeamRow[]>([]);
  const [matches, setMatches]           = useState<MatchRow[]>([]);
  const [societyMembers, setSocietyMembers] = useState<SocMember[]>([]);
  const [stablefordTotals, setStablefordTotals] = useState<Record<string, number>>({});
  // Raw hole rows behind stablefordTotals, kept for the Kronos tie-break
  // ladder (src/lib/scoring.ts buildKronosTieBreakMaps) — Titan Way's final-
  // day singles seeding needs more than the raw total to break a tie
  // deterministically (Rick's brief, 2026-08-25).
  const [kronosHoleRows, setKronosHoleRows] = useState<{ player_id: string; match_id: string; hole_number: number; stableford_pts: number | null }[]>([]);

  const [addModal, setAddModal]         = useState(false);
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());
  const [addTeam, setAddTeam]           = useState<string | null>(null);
  const [adding, setAdding]             = useState(false);
  const [generating, setGenerating]     = useState<string | null>(null);
  // One shared modal handles both Manual generation (a whole day's worth of
  // freshly-created empty-slot matches) and Edit Match (a single existing
  // match) — Rick's brief, section 4.14. Non-null = open, scoped to
  // whichever match rows are in the array.
  const [assignModalMatches, setAssignModalMatches] = useState<MatchRow[] | null>(null);

  const load = useCallback(async () => {
    if (!competitionId) return;
    const [
      { data: compData },
      { data: daysData },
      { data: cpData },
      { data: teamsData },
      { data: matchData },
    ] = await Promise.all([
      supabase.from('competitions').select('id,name,status,format,tournament_type,pts_win,pts_half,opening_rounds,bonus_points,max_handicap,handicap_cuts_enabled,settings').eq('id', competitionId).single(),
      supabase.from('competition_days').select('id,day_number,course_name,day_format,hcp_pct').eq('competition_id', competitionId).order('day_number'),
      supabase.from('competition_players')
        .select('id,player_id,team_id,handicap_index,is_captain,players(display_name,avatar_url)')
        .eq('competition_id', competitionId),
      supabase.from('teams').select('id,name,accent_color,logo_url').eq('society_id', societyId ?? '').order('sort_order'),
      supabase.from('matches').select('id,day_id,match_number,home_player_ids,away_player_ids,home_team_id,away_team_id,status,winner,result_str,holes_string,start_hole,is_singles')
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
        .from('match_holes').select('player_id,match_id,hole_number,stableford_pts').in('match_id', matchIds);
      const totals: Record<string, number> = {};
      (holesData as any[] ?? []).forEach(h => {
        if (h.stableford_pts != null) totals[h.player_id] = (totals[h.player_id] ?? 0) + h.stableford_pts;
      });
      setStablefordTotals(totals);
      setKronosHoleRows((holesData as any[] ?? []));
    } else {
      setStablefordTotals({});
      setKronosHoleRows([]);
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

  async function toggleExpandTeam(teamId: string) {
    if (expandedTeamId === teamId) { setExpandedTeamId(null); return; }
    if (teamId !== 'unassigned' && !teamRosterCache[teamId] && societyId) {
      setRosterLoadingTeamId(teamId);
      const { data } = await supabase
        .from('society_members')
        .select('player_id, team_id, players(display_name, handicap_index, avatar_url)')
        .eq('society_id', societyId).eq('team_id', teamId);
      const roster: SocMember[] = ((data ?? []) as any[]).map(m => ({
        player_id: m.player_id,
        display_name: m.players?.display_name ?? '—',
        handicap_index: m.players?.handicap_index ?? null,
        avatar_url: m.players?.avatar_url ?? null,
        team_id: teamId,
      }));
      // A society-level transfer (admin/transfers.tsx) moves society_members
      // .team_id only — it deliberately leaves this tournament's own
      // competition_players.team_id alone. Querying society_members alone
      // then makes a transferred-but-still-enrolled player vanish from this
      // team's panel entirely, with no row left to unassign them from
      // (Rick's brief, section 13) — union in anyone still enrolled here.
      const rosterIds = new Set(roster.map(r => r.player_id));
      compPlayers
        .filter(cp => cp.team_id === teamId && !rosterIds.has(cp.player_id))
        .forEach(cp => roster.push({
          player_id: cp.player_id, display_name: cp.display_name,
          handicap_index: cp.handicap_index, avatar_url: cp.avatar_url, team_id: teamId,
        }));
      roster.sort((a, b) => a.display_name.localeCompare(b.display_name));
      setTeamRosterCache(prev => ({ ...prev, [teamId]: roster }));
      setRosterLoadingTeamId(null);
    }
    setExpandedTeamId(teamId);
  }

  // Tapping a squad member toggles them onto/off the currently expanded
  // team — same three-way branch as build.tsx's togglePlayerInTeam, except
  // "off" here means unassigning (changeTeam→null), not deleting: these
  // are live tournament enrollments, possibly already with scores against
  // them, not a from-scratch draft.
  async function toggleRosterPlayer(teamId: string, member: SocMember) {
    const existing = compPlayers.find(cp => cp.player_id === member.player_id);
    setRosterPlayerBusy(member.player_id);
    try {
      if (existing && existing.team_id === teamId) {
        await changeTeam(existing, null);
      } else if (existing) {
        await changeTeam(existing, teamId);
      } else {
        const maxHcp = comp?.max_handicap ?? null;
        const hcp = (maxHcp != null && member.handicap_index != null) ? Math.min(member.handicap_index, maxHcp) : member.handicap_index;
        await supabase.from('competition_players').insert({
          competition_id: competitionId, player_id: member.player_id, team_id: teamId,
          handicap_index: hcp, status: 'enrolled',
          // A mid-tournament joiner never goes through build.tsx's
          // finishDraft() Go-Live snapshot, so without this they'd silently
          // fall back to the raw handicap forever (Rick's brief, 2026-08-25).
          // Starting from THEIR OWN enrollment handicap here, not any
          // already-cut value, is deliberate — they're joining fresh.
          ...(comp?.handicap_cuts_enabled ? { starting_tournament_handicap: hcp, current_tournament_handicap: hcp } : {}),
        });
        await load();
      }
    } finally {
      setRosterPlayerBusy(null);
    }
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

  // mode 'manual' reuses the exact same team-pairing decisions (who plays
  // who, how many matches) but inserts every match with empty player slots
  // instead of auto-assigning — Rick's brief, section 4.14: manual mode is
  // about the organiser hand-picking WHO plays, not re-deciding the
  // pairings themselves (matches Rick's own mockup, which already shows
  // "TEAM ELITE vs TEAM MOB" fixed, just empty [Select Player] slots).
  // Individual (stableford/medal) days stay auto-only for now — Rick's
  // Manual mockups only cover team-vs-team matches.
  async function generateDraw(day: DayRow, mode: 'auto' | 'manual' = 'auto') {
    // Guard re-entrancy directly rather than relying only on the button's
    // disabled state, which can race on a fast double-tap before re-render.
    if (generating) return;

    const df = day.day_format ?? 'singles';
    const roundFmt  = dayFormatToRoundFormat(df);
    const handicapMethod = dayFormatToHandicapMethod(df);
    const hcp       = day.hcp_pct ?? 100;

    // Same Chip & Birdie / Track Stats toggles as Casual Golf's game
    // builder, set once on the tournament in admin/build.tsx and carried
    // through here onto every match this draw creates — score/enter reads
    // this same side_games tag convention already, so no further wiring
    // needed for it to "just work" live.
    const sideGamesTags = [
      ...(comp?.settings?.voice_enabled ? ['voice:on'] : []),
      ...(comp?.settings?.track_stats_enabled ? [] : ['stats:off']),
    ];

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
      const shuffled = shuffle(allPlayerIds);
      const groups: string[][] = [];
      for (let i = 0; i < shuffled.length; i += INDIVIDUAL_GROUP_SIZE) {
        groups.push(shuffled.slice(i, i + INDIVIDUAL_GROUP_SIZE));
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
        side_games:      sideGamesTags,
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

    const isSingles = df === 'singles' || df === 'singles_stableford';
    const isPairs   = PAIRS_DAY_FORMATS.includes(df);
    const ppm       = isPairs ? 2 : 1;
    // Captain Rotation (the opening-rounds captain-pairing rule) is Titan
    // Way-exclusive (Rick's brief, 2026-08-22 section 4.2; 2026-08-24
    // section 9) — gating on format here, not just opening_rounds, matters
    // because the DB column defaults to 3 for every competition regardless
    // of format.
    const formatRules    = getFormatRules(comp?.format);
    const isOpeningRound = formatRules.captainRotation && day.day_number <= (comp?.opening_rounds ?? 0);
    const maxDayNumber   = days.length > 0 ? Math.max(...days.map(d => d.day_number)) : day.day_number;
    const isFinalDay      = day.day_number === maxDayNumber;

    // Order each team's roster for how this day should pair them:
    // - Singles: best-to-worst by Kronos ranking so far (cumulative
    //   Stableford, tie-broken by the same deterministic ladder the live
    //   Kronos leaderboard uses — Rick's brief, 2026-08-25 section 18-19:
    //   "highest plays highest", never an arbitrary tie), so pairing by
    //   index matches best-vs-best across the two sides.
    // - Pairs, opening rounds: captain first, partnered with a teammate they
    //   haven't played with yet this opening window; rest shuffled.
    // - Everything else: pure shuffle, as before.
    let kronosMaps: KronosTieBreakMaps | null = null;
    if (isSingles) {
      // "Best final round" for tie-break purposes = the last qualifying
      // round already played, not the singles day itself (its matches don't
      // exist yet — Kronos Rankings must be locked BEFORE the playoff they
      // seed, never computed from it).
      const otherDayNumbers = days.filter(d => d.id !== day.id).map(d => d.day_number);
      const lastQualifyingDayNumber = otherDayNumbers.length > 0 ? Math.max(...otherDayNumbers) : null;
      const lastQualifyingDay = days.find(d => d.day_number === lastQualifyingDayNumber);
      const finalDayMatchIds = new Set(
        lastQualifyingDay ? matches.filter(m => m.day_id === lastQualifyingDay.id).map(m => m.id) : []
      );
      kronosMaps = buildKronosTieBreakMaps(kronosHoleRows, finalDayMatchIds);
    }
    for (const tid of teamIds) {
      const roster = grouped[tid];
      if (isSingles) {
        grouped[tid] = rankPlayersByKronos(roster, stablefordTotals, kronosMaps!);
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
          home_player_ids: mode === 'manual' ? [] : (isPairs ? [pA[i*2], pA[i*2+1]].filter(Boolean) : [pA[i]]),
          away_player_ids: mode === 'manual' ? [] : (isPairs ? [pB[i*2], pB[i*2+1]].filter(Boolean) : [pB[i]]),
          round_format:   roundFmt,
          is_singles:     isSingles,
          hcp_allowance:  hcp,
          handicap_method: handicapMethod,
          status:         'upcoming',
          side_games:     sideGamesTags,
        });
      }
    } else if (isFinalDay && formatRules.finalDayKnockout) {
      // Final-day knockout is Titan Way-exclusive (Rick's brief, section 9)
      // — pair by current league position — 1st vs 2nd, 3rd vs 4th, etc. —
      // rather than the round-robin rotation used earlier. Every other
      // multi-team format falls through to the round-robin branch below
      // even on its final day. Must feed getStandings the exact same
      // tie-break inputs the Tour tab
      // leaderboard uses, or the two screens can show contradictory
      // positions on the day it matters most.
      const singlesDayIds = new Set(days.filter(d => d.day_format === 'singles' || d.day_format === 'singles_stableford').map(d => d.id));
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
            home_player_ids: mode === 'manual' ? [] : (isPairs ? [pH[j*2], pH[j*2+1]].filter(Boolean) : [pH[j]]),
            away_player_ids: mode === 'manual' ? [] : (isPairs ? [pA[j*2], pA[j*2+1]].filter(Boolean) : [pA[j]]),
            round_format:   roundFmt,
            is_singles:     isSingles,
            hcp_allowance:  hcp,
          handicap_method: handicapMethod,
            status:         'upcoming',
            side_games:     sideGamesTags,
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
            home_player_ids: mode === 'manual' ? [] : (isPairs ? [pH[j*2], pH[j*2+1]].filter(Boolean) : [pH[j]]),
            away_player_ids: mode === 'manual' ? [] : (isPairs ? [pA[j*2], pA[j*2+1]].filter(Boolean) : [pA[j]]),
            round_format:   roundFmt,
            is_singles:     isSingles,
            hcp_allowance:  hcp,
          handicap_method: handicapMethod,
            status:         'upcoming',
            side_games:     sideGamesTags,
          });
        }
      }
    }

    if (matchRows.length === 0) {
      Alert.alert('No matches', 'Not enough players in teams to generate pairings for this format.');
      return;
    }

    // Uneven team sizes (e.g. 5 v 4 in a 4BBB day) floor-divide down to
    // whole pairings, leaving surplus players silently unpaired for the day
    // — previously the only feedback was the all-zero case above, so an
    // organiser could go live a day short one player with no warning
    // (Rick's brief, section 13).
    const pairedTeamIds = new Set<string>(matchRows.flatMap(m => [m.home_team_id, m.away_team_id]));
    const usedPlayerIds = new Set<string>();
    matchRows.forEach(m => { m.home_player_ids.forEach((id: string) => usedPlayerIds.add(id)); m.away_player_ids.forEach((id: string) => usedPlayerIds.add(id)); });
    const benchedIds = mode === 'manual' ? [] : Array.from(pairedTeamIds)
      .flatMap(tid => (grouped[tid] ?? []).filter(pid => !usedPlayerIds.has(pid)));

    setGenerating(day.id);
    try {
      const { data: inserted, error } = await supabase.from('matches').insert(matchRows).select();
      if (error) { Alert.alert('Error', error.message); return; }
      await load();
      // Manual mode's shells have no players yet — take the organiser
      // straight into assigning them instead of leaving empty matches sitting
      // in the list looking broken.
      if (mode === 'manual' && inserted) setAssignModalMatches(inserted as unknown as MatchRow[]);
      if (benchedIds.length > 0) {
        const names = benchedIds.map(pid => compPlayers.find(cp => cp.player_id === pid)?.display_name ?? '—').join(', ');
        Alert.alert(
          'Some players not paired',
          `${benchedIds.length} player${benchedIds.length === 1 ? '' : 's'} couldn't be paired today because of uneven team numbers: ${names}. Use the pencil on a match to add them manually.`
        );
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not generate the draw.');
    } finally {
      setGenerating(null);
    }
  }

  // Titan Way generates every qualifying round TOGETHER as one draw, never
  // day by day (Rick's brief, 2026-08-25, section 6) — this is the whole-
  // tournament counterpart to generateDraw() above, used only for
  // format === 'titan_way' via the banner button in the DRAW tab.
  async function generateTitanWayDraw(maxDayNumber: number) {
    if (generating || !comp) return;

    const formatRules = getFormatRules(comp.format);
    const grouped: Record<string, string[]> = {};
    for (const cp of compPlayers) {
      if (!cp.team_id) continue;
      (grouped[cp.team_id] ??= []).push(cp.player_id);
    }
    const teamIds = Object.keys(grouped);
    const teamsForCheck = teamIds.map(id => ({ id, playerCount: grouped[id].length }));
    // The pre-draw feasibility check (Rick's brief, section 8) — same
    // checkTitanWayStructure() Go Live already ran, so the two screens can
    // never disagree about what's structurally valid. Only runs when the
    // organiser presses this button, never on screen mount.
    const structuralIssues = checkTitanWayStructure(formatRules, teamsForCheck);
    if (structuralIssues.length > 0) {
      Alert.alert('Titan Way Draw Not Possible', structuralIssues.map(i => `• ${i.label}`).join('\n'));
      return;
    }

    const qualifyingDays = days.filter(d => d.day_number !== maxDayNumber);
    if (qualifyingDays.length === 0) {
      Alert.alert('No qualifying rounds', 'Add at least one round before the final day to generate a Titan Way draw.');
      return;
    }
    const qualifyingDayIds = new Set(qualifyingDays.map(d => d.id));
    const existingMatches = matches.filter(m => qualifyingDayIds.has(m.day_id));

    async function proceed() {
      setGenerating('titan_way');
      try {
        if (existingMatches.length > 0) {
          await supabase.from('matches').delete().in('id', existingMatches.map(m => m.id));
        }
        const schedule = generateTitanWaySchedule({
          teamIds,
          rosterByTeam: grouped,
          qualifyingDayNumbers: qualifyingDays.map(d => d.day_number),
        });

        const matchRows: any[] = [];
        for (const day of qualifyingDays) {
          const df = day.day_format ?? 'four_bbb';
          const roundFmt = dayFormatToRoundFormat(df);
          const handicapMethod = dayFormatToHandicapMethod(df);
          const hcp = day.hcp_pct ?? 100;
          const sideGamesTags = [
            ...(comp?.settings?.voice_enabled ? ['voice:on'] : []),
            ...(comp?.settings?.track_stats_enabled ? [] : ['stats:off']),
          ];
          const dayMatchups = computeRoundRobinMatchups(teamIds, day.day_number);
          const dayPairings = schedule.pairingsByDay[day.day_number] ?? {};
          let matchNum = 1;
          for (const [tH, tA] of dayMatchups) {
            const pairingH = dayPairings[tH];
            const pairingA = dayPairings[tA];
            if (!pairingH || !pairingA) continue;
            matchRows.push({
              competition_id: competitionId, day_id: day.id, match_number: matchNum++,
              home_team_id: tH, away_team_id: tA,
              home_player_ids: pairingH.pair1, away_player_ids: pairingA.pair1,
              round_format: roundFmt, is_singles: false, hcp_allowance: hcp,
              handicap_method: handicapMethod, status: 'upcoming', side_games: sideGamesTags,
            });
            matchRows.push({
              competition_id: competitionId, day_id: day.id, match_number: matchNum++,
              home_team_id: tH, away_team_id: tA,
              home_player_ids: pairingH.pair2, away_player_ids: pairingA.pair2,
              round_format: roundFmt, is_singles: false, hcp_allowance: hcp,
              handicap_method: handicapMethod, status: 'upcoming', side_games: sideGamesTags,
            });
          }
        }

        if (matchRows.length === 0) {
          Alert.alert('No matches', 'Could not generate any matches — check team rosters.');
          return;
        }
        const { error } = await supabase.from('matches').insert(matchRows);
        if (error) { Alert.alert('Error', error.message); return; }
        await load();
      } catch (e: any) {
        Alert.alert('Error', e?.message ?? 'Could not generate the Titan Way draw.');
      } finally {
        setGenerating(null);
      }
    }

    // Warn-then-allow on regeneration, matching the exact pattern already
    // used by clearDay()/openEditMatch() below — never a silent overwrite,
    // never a hard block either (Dave, 2026-08-25).
    if (existingMatches.length > 0) {
      const { count } = await supabase.from('match_holes')
        .select('id', { count: 'exact', head: true }).in('match_id', existingMatches.map(m => m.id));
      if ((count ?? 0) > 0) {
        Alert.alert(
          'Qualifying rounds have scores',
          'Regenerating the Titan Way draw will delete every qualifying-round match AND all scores entered against them — this cannot be undone. Continue?',
          [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', style: 'destructive', onPress: proceed }]
        );
        return;
      }
      Alert.alert(
        'Qualifying rounds already drawn',
        'This clears the existing qualifying-round matches and generates a new draw. Continue?',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', onPress: proceed }]
      );
      return;
    }
    await proceed();
  }

  // Previously deleted a day's matches with no idea whether any scores had
  // already been entered against them (Rick's brief, section 4.12.4 — score
  // data must never be silently wiped without a clear warning first).
  async function clearDay(day: DayRow) {
    const dayMatchIds = matches.filter(m => m.day_id === day.id).map(m => m.id);
    const { count } = dayMatchIds.length
      ? await supabase.from('match_holes').select('id', { count: 'exact', head: true }).in('match_id', dayMatchIds)
      : { count: 0 };
    const hasScores = (count ?? 0) > 0;
    Alert.alert(
      'Clear Day ' + day.day_number + '?',
      hasScores
        ? 'This day already has scores entered. Clearing it deletes every match AND all of that scoring data — this cannot be undone.'
        : 'This deletes all matches for this day.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: async () => {
          await supabase.from('matches').delete().eq('day_id', day.id);
          await load();
        }},
      ]
    );
  }

  // Opening Edit Match on one that already has scores warns first rather
  // than silently letting the organiser change who's playing underneath
  // real results (Rick's brief, section 4.12.4) — it doesn't block outright,
  // since correcting a genuine mis-draw is still a legitimate action, but
  // the organiser must explicitly acknowledge it first.
  async function openEditMatch(m: MatchRow) {
    const { count } = await supabase.from('match_holes').select('id', { count: 'exact', head: true }).eq('match_id', m.id);
    if ((count ?? 0) > 0) {
      Alert.alert(
        'This match has scores',
        'Changing the players in this match will delete its scores so far and restart it from hole 1 with the new players. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue', style: 'destructive', onPress: () => setAssignModalMatches([m]) },
        ]
      );
      return;
    }
    setAssignModalMatches([m]);
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
  // A Standard Tournament (Individual Stableford, Stroke Play, etc.) is just
  // a player pool and shouldn't ask for team assignment at all — read off
  // the format registry, not the legacy tournament_type column (which
  // collapses Titan Way and Multi-Team Tour into the same value and can't
  // be used to tell them apart — Rick's brief, section 9).
  const isTeamTournament = getFormatRules(comp?.format).isTeamFormat;
  const daysWithMatches = new Set(matches.map(m => m.day_id));
  const allDaysHaveMatches = days.length > 0 && days.every(d => daysWithMatches.has(d.id));

  const playerNames: Record<string, string> = {};
  compPlayers.forEach(cp => { playerNames[cp.player_id] = cp.display_name; });

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/admin/live-tournaments')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
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
        {(['players', 'draw', 'summary'] as Tab[]).map(t => (
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
            ) : !isTeamTournament ? (
              // Standard/Individual tournament — just a player pool, no
              // teams to badge up, so the plain list is the right shape.
              compPlayers.map(cp => (
                <View key={cp.id} style={s.playerRow}>
                  <PlayerAvatar cp={cp} size={32} />
                  <View style={s.playerInfo}>
                    <Text style={s.playerName}>{cp.display_name}</Text>
                    {cp.handicap_index != null && <Text style={s.playerHcp}>HCP {cp.handicap_index}</Text>}
                  </View>
                  <TouchableOpacity onPress={() => removePlayer(cp)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle-outline" size={20} color="#555" />
                  </TouchableOpacity>
                </View>
              ))
            ) : (
              <>
                <Text style={[s.sectionLabel, { marginTop: 4, marginBottom: 10 }]}>TAP A CREST TO VIEW / TWEAK THAT TEAM</Text>
                <View style={s.badgeRow}>
                  {teams.map(t => {
                    const count = compPlayers.filter(cp => cp.team_id === t.id).length;
                    const isOpen = expandedTeamId === t.id;
                    const logo = getTeamLogo(t);
                    return (
                      <TouchableOpacity
                        key={t.id}
                        style={s.badgeItem}
                        onPress={() => toggleExpandTeam(t.id)}
                        activeOpacity={0.8}
                      >
                        <View style={[s.badgeCircle, { borderColor: (count > 0 || isOpen) ? t.accent_color : '#333' }, !(count > 0 || isOpen) && s.badgeCircleDark]}>
                          {logo
                            ? <Image source={logo} style={s.badgeLogo} resizeMode="contain" />
                            : <Text style={[s.badgeInitial, { color: t.accent_color }]}>{t.name[0]}</Text>
                          }
                        </View>
                        <Text style={[s.badgeName, (count > 0 || isOpen) && { color: t.accent_color }]} numberOfLines={1}>{t.name}</Text>
                        <Text style={s.badgeCount}>{count}</Text>
                      </TouchableOpacity>
                    );
                  })}
                  {unassigned.length > 0 && (
                    <TouchableOpacity
                      style={s.badgeItem}
                      onPress={() => toggleExpandTeam('unassigned')}
                      activeOpacity={0.8}
                    >
                      <View style={[s.badgeCircle, { borderColor: RED }, expandedTeamId !== 'unassigned' && s.badgeCircleDark]}>
                        <Ionicons name="help" size={22} color={RED} />
                      </View>
                      <Text style={[s.badgeName, { color: RED }]}>Unassigned</Text>
                      <Text style={s.badgeCount}>{unassigned.length}</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {expandedTeamId === 'unassigned' && (
                  <View style={s.rosterPanel}>
                    <Text style={[s.rosterPanelTitle, { color: RED }]}>Unassigned — {unassigned.length} player{unassigned.length !== 1 ? 's' : ''}</Text>
                    {unassigned.length === 0 ? (
                      <Text style={s.emptyHint}>Nobody unassigned right now.</Text>
                    ) : unassigned.map(cp => (
                      <View key={cp.id} style={[s.rosterPickRow, s.rosterPickTop]}>
                        <PlayerAvatar cp={cp} size={32} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.playerName}>{cp.display_name}</Text>
                          {cp.handicap_index != null && <Text style={s.playerHcp}>HCP {cp.handicap_index}</Text>}
                        </View>
                        <TouchableOpacity onPress={() => removePlayer(cp)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Ionicons name="close-circle-outline" size={20} color="#555" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                {expandedTeamId && expandedTeamId !== 'unassigned' && (() => {
                  const team = teams.find(t => t.id === expandedTeamId) ?? null;
                  if (!team) return null;
                  const roster = teamRosterCache[team.id] ?? [];
                  const count = compPlayers.filter(cp => cp.team_id === team.id).length;
                  return (
                    <View style={s.rosterPanel}>
                      <Text style={[s.rosterPanelTitle, { color: team.accent_color }]}>
                        {team.name} roster — {count} of {roster.length} picked · tap a player to swap in/out
                      </Text>
                      {rosterLoadingTeamId === team.id ? (
                        <ActivityIndicator color={GOLD} style={{ marginVertical: 16 }} />
                      ) : roster.length === 0 ? (
                        <Text style={s.emptyHint}>No players in this squad yet — add them in Teams/Players first.</Text>
                      ) : roster.map(member => {
                        const cp = compPlayers.find(p => p.player_id === member.player_id);
                        const selected = cp?.team_id === team.id;
                        return (
                          <TouchableOpacity
                            key={member.player_id}
                            style={[s.rosterPickRow, s.rosterPickTop, selected && s.rosterPickRowOn]}
                            onPress={() => toggleRosterPlayer(team.id, member)}
                            disabled={rosterPlayerBusy === member.player_id}
                            activeOpacity={0.7}
                          >
                            <TouchableOpacity onPress={() => cp && toggleCaptain(cp)} disabled={!selected} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                              <Ionicons name={cp?.is_captain ? 'star' : 'star-outline'} size={16} color={cp?.is_captain ? GOLD : (selected ? '#555' : '#222')} />
                            </TouchableOpacity>
                            {cp
                              ? <PlayerAvatar cp={cp} size={32} />
                              : <PlayerAvatar cp={{ player_id: member.player_id, avatar_url: member.avatar_url ?? null, display_name: member.display_name } as CompPlayer} size={32} />
                            }
                            <View style={{ flex: 1 }}>
                              <Text style={[s.playerName, selected && { color: GOLD }]}>{member.display_name}{cp?.is_captain ? '  (C)' : ''}</Text>
                              {member.handicap_index != null && <Text style={s.playerHcp}>HCP {member.handicap_index}</Text>}
                              {!selected && cp && <Text style={s.playerHcp}>Currently on {teams.find(t => t.id === cp.team_id)?.name ?? 'no team'}</Text>}
                            </View>
                            {rosterPlayerBusy === member.player_id
                              ? <ActivityIndicator size="small" color={GOLD} />
                              : selected && <Ionicons name="checkmark-circle" size={20} color={GOLD} />
                            }
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                })()}
              </>
            )}
          </View>
        )}

        {/* ── DRAW TAB ─────────────────────────────────────────────── */}
        {tab === 'draw' && (() => {
          const maxDayNumber = days.length > 0 ? Math.max(...days.map(d => d.day_number)) : 0;
          const isTitanWay = comp?.format === 'titan_way';
          return (
          <View>
            <Text style={s.sectionLabel}>{days.length} DAYS</Text>
            {days.length === 0 && (
              <View style={s.empty}>
                <Text style={s.emptyText}>No days configured. Add days in the tournament builder.</Text>
              </View>
            )}
            {isTitanWay && days.length > 0 && (
              <View style={s.titanWayBanner}>
                <TouchableOpacity
                  style={s.genBtn}
                  onPress={() => generateTitanWayDraw(maxDayNumber)}
                  disabled={!!generating}
                  activeOpacity={0.8}
                >
                  {generating === 'titan_way' ? <ActivityIndicator size="small" color="#000" /> : <Text style={s.genBtnText}>GENERATE TITAN WAY DRAW</Text>}
                </TouchableOpacity>
                <Text style={s.titanWayBannerSub}>
                  Generates every qualifying round (Days 1–{Math.max(1, maxDayNumber - 1)}) together, minimising repeat partners and opponents.
                </Text>
              </View>
            )}
            {days.map(day => {
              const dayMatches = matches.filter(m => m.day_id === day.id);
              const isGen = generating === day.id;
              const isTitanWayQualifyingDay = isTitanWay && day.day_number !== maxDayNumber;
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
                      {dayMatches.length > 0 ? (
                        <TouchableOpacity
                          style={[s.genBtn, s.genBtnSecondary]}
                          onPress={() => clearDay(day)}
                          disabled={isGen}
                          activeOpacity={0.8}
                        >
                          <Text style={[s.genBtnText, s.genBtnTextSecondary]}>CLEAR</Text>
                        </TouchableOpacity>
                      ) : isGen ? (
                        <View style={s.genBtn}><ActivityIndicator size="small" color="#000" /></View>
                      ) : isTitanWayQualifyingDay ? (
                        // Titan Way's qualifying rounds are generated all
                        // together (see the banner above), never per-day —
                        // Rick's brief, 2026-08-25, section 6.
                        <Text style={[s.fmtBadgeText, { color: '#666', maxWidth: 100, textAlign: 'right' }]}>Use Generate Titan Way Draw above</Text>
                      ) : (
                        <>
                          <TouchableOpacity style={s.genBtn} onPress={() => generateDraw(day, 'auto')} activeOpacity={0.8}>
                            <Text style={s.genBtnText}>AUTOMATIC</Text>
                          </TouchableOpacity>
                          {/* Manual is team-vs-team only (Rick's own mockups only
                              cover that case) — individual Stableford/Medal
                              groups stay auto-generated. */}
                          {day.day_format !== 'stableford' && day.day_format !== 'medal' && (
                            <TouchableOpacity style={[s.genBtn, s.genBtnSecondary]} onPress={() => generateDraw(day, 'manual')} activeOpacity={0.8}>
                              <Text style={[s.genBtnText, s.genBtnTextSecondary]}>MANUAL</Text>
                            </TouchableOpacity>
                          )}
                        </>
                      )}
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
                              <TouchableOpacity onPress={() => openEditMatch(m)} style={s.editMatchBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                                <Ionicons name="pencil-outline" size={16} color={GOLD} />
                              </TouchableOpacity>
                            </View>
                          );
                        }
                        const homeTeam = teams.find(t => t.id === m.home_team_id);
                        const awayTeam = teams.find(t => t.id === m.away_team_id);
                        const homePlayers = m.home_player_ids.map(id => playerNames[id]?.split(' ')[0] ?? '?').join(' & ');
                        const awayPlayers = m.away_player_ids.map(id => playerNames[id]?.split(' ')[0] ?? '?').join(' & ');
                        const homeName = homeTeam?.name ?? homePlayers;
                        const awayName = awayTeam?.name ?? awayPlayers;
                        const homeColor = homeTeam?.accent_color ?? '#555';
                        const awayColor = awayTeam?.accent_color ?? '#555';
                        return (
                          <View key={m.id} style={[s.matchItem, idx > 0 && { borderTopWidth: 1, borderTopColor: '#1c1c1c' }]}>
                            <View style={{ flex: 1 }}>
                              <Text style={[s.matchTeam, { color: homeColor }]}>{homeName}</Text>
                              {/* Who's actually playing in THIS match — two
                                  fourballs between the same two teams both
                                  read "ELITE vs RENEGADES" without this
                                  (Dave, 2026-08-19). */}
                              {homeTeam && <Text style={s.matchPlayers}>{homePlayers}</Text>}
                            </View>
                            <Text style={s.vsText}>vs</Text>
                            <View style={{ flex: 1 }}>
                              <Text style={[s.matchTeam, { color: awayColor, textAlign: 'right' }]}>{awayName}</Text>
                              {awayTeam && <Text style={[s.matchPlayers, { textAlign: 'right' }]}>{awayPlayers}</Text>}
                            </View>
                            <TouchableOpacity onPress={() => openEditMatch(m)} style={s.editMatchBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                              <Ionicons name="pencil-outline" size={16} color={GOLD} />
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
          );
        })()}

        {/* ── SUMMARY TAB ──────────────────────────────────────────────
            Was "ACTIVATE" — that button was already permanently dead code
            (this screen is only ever reached for a tournament that's
            already status='active', via live-tournaments.tsx's own
            status='active' filter, so activateTournament() could never
            actually fire). Going Live and Prize Categories are both
            builder/pre-Go-Live concerns now (Rick's brief, sections
            4.7/4.10) — this tab keeps just the still-useful running-status
            summary. */}
        {tab === 'summary' && (
          <View>
            <Text style={s.sectionLabel}>TOURNAMENT SUMMARY</Text>
            <View style={s.summaryCard}>
              <SummaryRow label="Name"    value={comp?.name ?? '—'} />
              <SummaryRow label="Type"    value={getFormatRules(comp?.format).label} />
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

            <View style={[s.activatedBanner]}>
              <Ionicons name="checkmark-circle" size={18} color={GREEN} />
              <Text style={[s.warnText, { color: GREEN }]}>Tournament is LIVE</Text>
            </View>
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

      <MatchAssignModal
        visible={assignModalMatches !== null}
        matches={assignModalMatches ?? []}
        allMatches={matches}
        teams={teams}
        compPlayers={compPlayers}
        days={days}
        onClose={() => setAssignModalMatches(null)}
        onSaved={load}
      />
    </View>
  );
}

// Shared by Manual generation (a whole day's worth of freshly-created
// empty-slot matches) and Edit Match (a single existing match) — Rick's
// brief, section 4.14. Duplicate-player prevention spans BOTH the match(es)
// open in this modal AND every other already-saved match on the same day,
// so a player can't end up in two matches at once within the same round.
function MatchAssignModal({
  visible, matches, allMatches, teams, compPlayers, days, onClose, onSaved,
}: {
  visible: boolean;
  matches: MatchRow[];
  allMatches: MatchRow[];
  teams: TeamRow[];
  compPlayers: CompPlayer[];
  days: DayRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [working, setWorking] = useState<Record<string, { home: (string | null)[]; away: (string | null)[] }>>({});
  const [pickerFor, setPickerFor] = useState<{ matchId: string; side: 'home' | 'away'; idx: number } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const init: typeof working = {};
    matches.forEach(m => {
      const day = days.find(d => d.id === m.day_id);
      // Individual Stableford/Medal groups have no team and no away side at
      // all (generateDraw's isIndividual branch) — editing one must use the
      // same group cap as generation, or the extra players get silently
      // dropped the moment this modal initialises (Rick's brief, section 13).
      if (isIndividualMatch(m)) {
        init[m.id] = {
          home: Array.from({ length: INDIVIDUAL_GROUP_SIZE }, (_, i) => m.home_player_ids[i] ?? null),
          away: [],
        };
        return;
      }
      const slots = day && PAIRS_DAY_FORMATS.includes(day.day_format ?? '') ? 2 : 1;
      init[m.id] = {
        home: Array.from({ length: slots }, (_, i) => m.home_player_ids[i] ?? null),
        away: Array.from({ length: slots }, (_, i) => m.away_player_ids[i] ?? null),
      };
    });
    setWorking(init);
  }, [visible, matches, days]);

  function usedElsewhere(matchId: string, side: 'home' | 'away', idx: number): Set<string> {
    const used = new Set<string>();
    const dayId = matches.find(m => m.id === matchId)?.day_id;
    const inScopeIds = new Set(matches.map(m => m.id));
    allMatches.forEach(am => {
      if (am.day_id !== dayId || inScopeIds.has(am.id)) return;
      am.home_player_ids.forEach(id => used.add(id));
      am.away_player_ids.forEach(id => used.add(id));
    });
    Object.entries(working).forEach(([mid, w]) => {
      w.home.forEach((id, i) => { if (id && !(mid === matchId && side === 'home' && i === idx)) used.add(id); });
      w.away.forEach((id, i) => { if (id && !(mid === matchId && side === 'away' && i === idx)) used.add(id); });
    });
    return used;
  }

  function eligiblePlayers(matchId: string, side: 'home' | 'away', idx: number): CompPlayer[] {
    const m = matches.find(mm => mm.id === matchId);
    if (!m) return [];
    const used = usedElsewhere(matchId, side, idx);
    // Individual Stableford/Medal groups have no team — any enrolled player
    // not already used elsewhere today is eligible, same pool generateDraw
    // picks the group from.
    if (isIndividualMatch(m)) return compPlayers.filter(cp => !used.has(cp.player_id));
    const teamId = side === 'home' ? m.home_team_id : m.away_team_id;
    return compPlayers.filter(cp => cp.team_id === teamId && !used.has(cp.player_id));
  }

  function selectPlayer(playerId: string) {
    if (!pickerFor) return;
    const { matchId, side, idx } = pickerFor;
    setWorking(prev => {
      const arr = [...prev[matchId][side]];
      arr[idx] = playerId;
      return { ...prev, [matchId]: { ...prev[matchId], [side]: arr } };
    });
    setPickerFor(null);
  }

  function clearSlot(matchId: string, side: 'home' | 'away', idx: number) {
    setWorking(prev => {
      const arr = [...prev[matchId][side]];
      arr[idx] = null;
      return { ...prev, [matchId]: { ...prev[matchId], [side]: arr } };
    });
  }

  async function save() {
    for (const m of matches) {
      const w = working[m.id];
      if (!w) continue;
      // Individual Stableford/Medal groups can legitimately run under a full
      // group of INDIVIDUAL_GROUP_SIZE (e.g. an odd player count) — only
      // team matches require every slot filled.
      if (isIndividualMatch(m)) {
        if (w.home.every(id => !id)) {
          Alert.alert('Incomplete match', 'Add at least one player before saving.');
          return;
        }
        continue;
      }
      if (w.home.some(id => !id) || w.away.some(id => !id)) {
        Alert.alert('Incomplete match', 'Every player slot must be filled before saving.');
        return;
      }
    }
    setSaving(true);
    try {
      const sameRoster = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id));
      for (const m of matches) {
        const w = working[m.id];
        if (!w) continue;
        const newHome = w.home.filter((id): id is string => !!id);
        const newAway = w.away.filter((id): id is string => !!id);
        const update: Record<string, unknown> = { home_player_ids: newHome, away_player_ids: newAway };

        // A player swap invalidates the per-hole record: match_holes is
        // keyed by player_id (a removed player's rows would otherwise keep
        // scoring for a match they're no longer in), and the match-level
        // holes_string/winner reflect a head-to-head that no longer exists
        // with the new roster. Reset both rather than let either go stale
        // (Rick's brief, section 4.12.4 — "correcting a genuine mis-draw" is
        // legitimate, but it must not leave orphaned or misattributed scores).
        const rosterChanged = !sameRoster(newHome, m.home_player_ids) || !sameRoster(newAway, m.away_player_ids);
        if (rosterChanged) {
          const removedPlayers = [...m.home_player_ids, ...m.away_player_ids]
            .filter(id => !newHome.includes(id) && !newAway.includes(id));
          if (removedPlayers.length > 0) {
            const { error: delErr } = await supabase.from('match_holes')
              .delete().eq('match_id', m.id).in('player_id', removedPlayers);
            if (delErr) throw delErr;
          }
          update.holes_string = '.'.repeat(m.holes_string?.length || 18);
          update.status = 'upcoming';
          update.winner = null;
          update.result_str = null;
        }

        const { error } = await supabase.from('matches').update(update).eq('id', m.id);
        if (error) throw error;
      }
      onSaved();
      onClose();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save player assignments.');
    } finally {
      setSaving(false);
    }
  }

  const playerName = (id: string) => compPlayers.find(cp => cp.player_id === id)?.display_name ?? '—';

  return (
    <>
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={onClose}>
              <Text style={s.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.modalTitle}>{matches.length > 1 ? 'ASSIGN PLAYERS' : 'EDIT MATCH'}</Text>
            <TouchableOpacity onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color={GOLD} size="small" /> : <Text style={s.modalDone}>Save</Text>}
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            {matches.map((m, mi) => {
              const homeTeam = teams.find(t => t.id === m.home_team_id);
              const awayTeam = teams.find(t => t.id === m.away_team_id);
              const w = working[m.id];
              if (!w) return null;
              const individual = isIndividualMatch(m);
              return (
                <View key={m.id} style={s.assignMatchCard}>
                  {matches.length > 1 && <Text style={s.assignMatchLabel}>MATCH {mi + 1}</Text>}

                  <Text style={[s.assignTeamName, { color: homeTeam?.accent_color ?? '#fff' }]}>
                    {individual ? 'GROUP' : (homeTeam?.name ?? 'Team A')}
                  </Text>
                  {w.home.map((pid, idx) => (
                    <TouchableOpacity key={`h${idx}`} style={s.assignSlot} onPress={() => setPickerFor({ matchId: m.id, side: 'home', idx })} activeOpacity={0.8}>
                      <Text style={pid ? s.assignSlotText : s.assignSlotPlaceholder}>{pid ? playerName(pid) : 'Select Player'}</Text>
                      {pid && (
                        <TouchableOpacity onPress={() => clearSlot(m.id, 'home', idx)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Ionicons name="close-circle" size={16} color="#555" />
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  ))}

                  {!individual && (
                    <>
                      <Text style={s.assignVs}>VS</Text>

                      <Text style={[s.assignTeamName, { color: awayTeam?.accent_color ?? '#fff' }]}>{awayTeam?.name ?? 'Team B'}</Text>
                      {w.away.map((pid, idx) => (
                        <TouchableOpacity key={`a${idx}`} style={s.assignSlot} onPress={() => setPickerFor({ matchId: m.id, side: 'away', idx })} activeOpacity={0.8}>
                          <Text style={pid ? s.assignSlotText : s.assignSlotPlaceholder}>{pid ? playerName(pid) : 'Select Player'}</Text>
                          {pid && (
                            <TouchableOpacity onPress={() => clearSlot(m.id, 'away', idx)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                              <Ionicons name="close-circle" size={16} color="#555" />
                            </TouchableOpacity>
                          )}
                        </TouchableOpacity>
                      ))}
                    </>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      {/* Player picker — a second, smaller sheet on top, matching the sheet
          pattern used elsewhere (e.g. NTP/LD winner pickers in admin/news.tsx). */}
      <Modal visible={pickerFor !== null} transparent animationType="slide" onRequestClose={() => setPickerFor(null)}>
        <TouchableOpacity style={s.pickerOverlay} activeOpacity={1} onPress={() => setPickerFor(null)} />
        <View style={s.pickerSheet}>
          <View style={s.pickerHeader}>
            <Text style={s.pickerTitle}>Select Player</Text>
            <TouchableOpacity onPress={() => setPickerFor(null)} activeOpacity={0.7}>
              <Text style={s.pickerClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={pickerFor ? eligiblePlayers(pickerFor.matchId, pickerFor.side, pickerFor.idx) : []}
            keyExtractor={cp => cp.player_id}
            ListEmptyComponent={<Text style={[s.emptyText, { textAlign: 'center', padding: 20 }]}>No eligible players left for this round.</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.pickerItem} onPress={() => selectPlayer(item.player_id)} activeOpacity={0.7}>
                <Text style={s.pickerItemText}>{item.display_name}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </>
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
function PlayerAvatar({ cp, size }: { cp: CompPlayer; size: number }) {
  const avatar = resolveAvatar(cp.player_id, cp.avatar_url);
  if (avatar) return <Image source={avatar} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.4, fontFamily: FFB, color: '#fff' }}>{cp.display_name[0]}</Text>
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

  // Team badge-crest row + expandable roster panel — same visual pattern
  // as the build wizard's Draft step (admin/build.tsx), so amending an
  // already-live tournament's players looks like the screen that drafted
  // them in the first place, instead of a squeezed one-line-per-player list.
  badgeRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 16 },
  badgeItem:       { alignItems: 'center', width: 68 },
  badgeCircle:     { width: 56, height: 56, borderRadius: 28, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111', marginBottom: 4 },
  badgeCircleDark: { opacity: 0.4 },
  badgeLogo:       { width: 36, height: 36 },
  badgeInitial:    { fontSize: 20, fontFamily: 'JUSTSans-ExBold' },
  badgeName:       { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: '#888', textAlign: 'center' },
  badgeCount:      { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: '#555', marginTop: 1 },

  rosterPanel:      { backgroundColor: '#0a0a0a', borderRadius: 12, borderWidth: 1, borderColor: GOLD + '44', padding: 12, marginBottom: 16 },
  rosterPanelTitle: { fontSize: 11, fontFamily: 'JUSTSans-ExBold', color: GOLD, letterSpacing: 0.5, marginBottom: 10 },
  rosterPickRow:    { borderRadius: 10, borderWidth: 1, borderColor: '#1c1c1c', backgroundColor: '#111', padding: 8, marginBottom: 6 },
  rosterPickRowOn:  { borderColor: GOLD, backgroundColor: `${GOLD}0F` },
  rosterPickTop:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emptyHint:        { fontFamily: 'JUSTSans-ExBold', fontSize: 12, color: '#555', textAlign: 'center', paddingVertical: 10 },


  dayCard:       { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 14, marginBottom: 12 },
  titanWayBanner: { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(212,175,55,0.35)', padding: 14, marginTop: 10, marginBottom: 12, gap: 8 },
  titanWayBannerSub: { fontFamily: 'JUSTSans-ExBold', fontSize: 11, color: '#888', lineHeight: 15 },
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
  editMatchBtn: { padding: 4 },
  matchTeam:    { fontFamily: 'JUSTSans-ExBold', fontSize: 13 },
  matchPlayers: { fontFamily: 'JUSTSans', fontSize: 11, color: '#fff', marginTop: 1 },
  vsText:       { fontFamily: 'JUSTSans', fontSize: 11, color: '#555', width: 20, textAlign: 'center' },

  summaryCard: { backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden', marginBottom: 16 },


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

  // Manual generation / Edit Match
  assignMatchCard:  { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 14, marginBottom: 12 },
  assignMatchLabel: { fontFamily: 'JUSTSans-ExBold', fontSize: 10, color: '#888', letterSpacing: 1.5, marginBottom: 10 },
  assignTeamName:   { fontFamily: 'JUSTSans-ExBold', fontSize: 14, marginBottom: 8 },
  assignVs:         { fontFamily: 'JUSTSans-ExBold', fontSize: 10, color: '#555', letterSpacing: 1, textAlign: 'center', marginVertical: 10 },
  assignSlot: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1, borderColor: '#2a2a2a',
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
  },
  assignSlotText:        { fontFamily: 'JUSTSans-ExBold', fontSize: 14, color: '#fff' },
  assignSlotPlaceholder: { fontFamily: 'JUSTSans-ExBold', fontSize: 14, color: '#555' },

  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  pickerSheet:   { backgroundColor: '#111', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40, maxHeight: '60%', borderTopWidth: 1, borderColor: '#1c1c1c' },
  pickerHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  pickerTitle:   { fontSize: 17, fontFamily: 'JUSTSans-ExBold', color: '#fff' },
  pickerClose:   { fontSize: 17, fontFamily: 'JUSTSans-ExBold', color: '#fff', paddingHorizontal: 8 },
  pickerItem:    { paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  pickerItemText:{ fontSize: 16, fontFamily: 'JUSTSans-ExBold', color: '#fff' },
});
