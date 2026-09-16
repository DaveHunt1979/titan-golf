import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Modal, Platform, Image, FlatList,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase, fetchAllRows } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { getStandings, calcSweepBonus, buildKronosTieBreakMaps, rankPlayersByKronos, calcStrokesReceived, calcStablefordPoints, calcHoles, playerCourseHcp, calcScramblePairHandicap, scramblePairEffectiveHcp, type KronosTieBreakMaps } from '../../../src/lib/scoring';
import { resolveAvatar, teamLogos } from '../../../src/lib/assets';
import { goBack } from '../../../src/lib/navigation';
import { getFormatRules, checkTitanWayStructure } from '../../../src/lib/tournamentFormat';
import { generateTitanWaySchedule, computeRoundRobinMatchups, generateOddTitanGroups } from '../../../src/lib/titanWayDraw';
import { sendPushNotification } from '../../../src/lib/notifications';

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

// Shared between generateDraw's player-assignment logic and the manual
// assign/edit modal, which both need to know slot-count-per-side (2 for
// pairs, 1 for singles) without duplicating the format list.
// 'scramble' (Skullers Scramble Day 1) is a pairs day like the rest — 2 slots
// a side — it just scores one shared ball per pair rather than two balls.
const PAIRS_DAY_FORMATS = ['4bbb', 'four_bbb', 'four_bbb_stroke', 'foursomes', 'greensomes', 'scramble'];

// Individual Stableford/Medal groups (no team, no away side) are capped at
// this many players per group by generateDraw's auto-split — the manual
// assign/edit modal uses the same cap so editing one never truncates it.
const INDIVIDUAL_GROUP_SIZE = 4;

function isIndividualMatch(m: { home_team_id: string | null; away_team_id: string | null }): boolean {
  return !m.home_team_id && !m.away_team_id;
}

// "Someone adds you into a round" push (Ricky, 2026-09-15), tournament side.
// One notification per player per draw generation, not per match — Titan
// Way's whole-schedule generation alone can place a player into a dozen
// matches at once, and nobody wants a dozen pushes for one button tap.
// Manual-mode shells insert with empty player_ids (filled in later via the
// Assign Players modal, which fires its own notification on save), so this
// naturally no-ops for them without any special-casing.
function notifyRoundPlayers(rows: { home_player_ids: string[]; away_player_ids: string[] }[], message: string) {
  const ids = [...new Set(rows.flatMap(r => [...r.home_player_ids, ...r.away_player_ids]))];
  if (ids.length > 0) sendPushNotification('Titan Golf', message, ids);
}

const DAY_FORMAT_LABELS: Record<string, string> = {
  four_bbb: '4BBB Match Play – Stableford', four_bbb_stroke: '4BBB Match Play – Stroke Play',
  foursomes: 'Foursomes', greensomes: 'Greensomes',
  singles: 'Singles Match Play – Stroke Play', singles_stableford: 'Singles Match Play – Stableford',
  stableford: 'Stableford', medal: 'Medal', scramble: '2v2 Match Play Scramble',
  '4bbb': '4BBB Match Play – Stableford',
};

function dayFormatToRoundFormat(df: string): string {
  if (df === 'stableford') return 'stableford';
  if (df === 'medal') return 'medal';
  // NOTE: 'scramble' deliberately does NOT map to a 'scramble' round_format.
  // Casual Golf's own Scramble (round_format 'scramble' → score/scramble/) is
  // a stroke-play card for one team with no opponent; a tournament Day 1
  // Scramble is win/halve/lose match play between two pairs, so it runs on
  // the shared match play engine like every other tournament match play day
  // and identifies itself by handicap_method 'scramble_pair' instead.
  // 4bbb / four_bbb / four_bbb_stroke / foursomes / greensomes / singles are
  // all matchplay (win/halve/lose by hole) as far as the live scoring screen
  // is concerned — it only ever checks for 'matchplay' | 'stableford' | 'medal',
  // so anything else here silently loses the format label and status banner.
  return 'matchplay';
}

// isTitanStylePlayoff: true only for Titan Way/Odd Titan's own auto-generated
// final Singles Playoff day — that day reuses the exact same 'singles'/
// 'singles_stableford' day_format ids as a standalone Singles Match Play day,
// but Rick's brief section 8.2 deliberately keeps it on each player's own
// full Playing Handicap (Kronos already seeds who plays who), so it must
// keep returning 'individual'/'individual_stableford' regardless of Ricky's
// 2026-09-14 request below. Every other Singles day — its own tournament
// format, or mixed into Multi-Team Tour/Ryder Cup — gets the new rule.
function dayFormatToHandicapMethod(df: string, isTitanStylePlayoff: boolean = false): string {
  // 2v2 Match Play Scramble: each pair blends down to one combined handicap
  // (35% of the lower + 15% of the higher — calcScramblePairHandicap), then
  // plays relative to the other pair's. Its own method value because the
  // blend is a different INPUT to the same stroke allocation, and because
  // it's what the live scorer reads to show one shared score per pair.
  if (df === 'scramble') return 'scramble_pair';
  if (df === 'four_bbb_stroke') return 'relative_low';
  // 4BBB Stableford also plays the lowest Playing Handicap in the fourball
  // off scratch, same method as 4BBB Stroke — but keeps its own distinct
  // value so it doesn't collide with Foursomes/Greensomes, which also map
  // to round_format 'matchplay' + is_singles false and must stay untouched.
  if (df === 'four_bbb') return 'relative_low_stableford';
  // Singles Match Play (Ricky, 2026-09-14 weekend findings — "in match play
  // the lowest player needs to play off of 0"): same relative-low method as
  // 4BBB — lowest Playing Handicap in the match plays off scratch, the other
  // player receives the full difference (hcp_allowance stays admin-adjustable
  // via day.hcp_pct, same field 4BBB already uses). Keeps its own distinct
  // stableford value for the same reason 4BBB Stableford does — so the
  // scoring engine can tell "hole winner decided by Stableford points" apart
  // from plain Singles Match Play.
  if (df === 'singles_stableford') return isTitanStylePlayoff ? 'individual_stableford' : 'relative_low_stableford';
  if (df === 'singles') return isTitanStylePlayoff ? 'individual' : 'relative_low';
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
  // Skullers Scramble only — this player's position in their captain's
  // submitted Day 2 singles order (1 = plays the other side's #1). Null for
  // every other format, and for anyone whose captain hasn't submitted yet.
  singles_order: number | null;
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
  const { id: competitionId, mode } = useLocalSearchParams<{ id: string; mode?: string }>();
  const router = useRouter();
  const { societyId } = useAdminSociety();

  const [fontsLoaded] = useFonts({
    [FF]:  require('../../../assets/fonts/JUSTSans-Regular.otf'),
    [FFB]: require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  // Draw and Make Amends are now separate buttons on the Live Tournaments
  // menu (Dave, 2026-09-16) rather than "Draw" only being reachable by
  // going through Amend — they still share this one screen/its three tabs
  // (nothing here duplicated), just landing on a different starting tab.
  const [tab, setTab]                   = useState<Tab>(mode === 'draw' ? 'draw' : 'players');
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
  const [simulating, setSimulating]     = useState<string | null>(null);
  // One shared modal handles both Manual generation (a whole day's worth of
  // freshly-created empty-slot matches) and Edit Match (a single existing
  // match) — Rick's brief, section 4.14. Non-null = open, scoped to
  // whichever match rows are in the array.
  const [assignModalMatches, setAssignModalMatches] = useState<MatchRow[] | null>(null);
  // Edit a day's game mode after the tournament has gone live (Dave/Rick,
  // 2026-09-16 — "what happens if we selected the wrong game mode"). Only
  // ever offered when the day has zero scores yet (see openEditFormat) —
  // day_format drives round_format/handicap_method for every match it
  // generates, so changing it once real scoring exists would silently
  // desync already-played holes from the new format's rules.
  const [editFormatDay, setEditFormatDay] = useState<DayRow | null>(null);
  const [savingFormat, setSavingFormat] = useState(false);
  // Manual Move/Swap between individual groups (Odd Titan spec, 2026-09-16)
  // — tap a player, then tap a player in another group to swap, or tap "+"
  // on a group with room to move them there. Team-vs-team matches (4BBB
  // etc.) keep using the existing Edit Match pencil — this is scoped to
  // groups with no away side (Odd Titan's own shape, and the generic
  // Individual Stableford/Medal groups), which is what the spec's own
  // "Group 1: Ricky, George, Darren, Tony" examples describe.
  const [moveMode, setMoveMode] = useState(false);
  const [selectedForMove, setSelectedForMove] = useState<{ matchId: string; playerId: string } | null>(null);
  // Skullers Scramble Day 2 — each side's captain-picked singles running
  // order, built up locally by tapping players in order and only written to
  // competition_players.singles_order when that captain submits. Keyed by
  // team id; a side with no entry here falls back to whatever's already
  // stored (see singlesOrderFor below).
  const [orderDraft, setOrderDraft] = useState<Record<string, string[]>>({});
  const [savingOrder, setSavingOrder] = useState<string | null>(null);

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
        .select('id,player_id,team_id,handicap_index,is_captain,singles_order,players(display_name,avatar_url)')
        .eq('competition_id', competitionId),
      // This competition's own teams — either permanent club teams (competition_id
      // null) or, for a Ryder Cup, its 2 event-only sides (competition_id = this
      // competition). Excludes every OTHER competition's event-only teams.
      supabase.from('teams').select('id,name,accent_color,logo_url')
        .eq('society_id', societyId ?? '')
        .or(`competition_id.is.null,competition_id.eq.${competitionId}`)
        .order('sort_order'),
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
      singles_order: cp.singles_order ?? null,
    })));
    if (teamsData) setTeams(teamsData as TeamRow[]);
    if (matchData) setMatches(matchData as unknown as MatchRow[]);

    // Cumulative Stableford so far this tournament, used to rank players for
    // singles-draw pairing (best-vs-best across the two sides).
    if (matchData && (matchData as any[]).length > 0) {
      const matchIds = (matchData as any[]).map(m => m.id);
      // Paged: PostgREST caps an unbounded .select() at 1000 rows and a
      // tournament's match_holes runs to several thousand (players x rounds x
      // 18). Truncated, these Stableford totals — which seed the singles /
      // Titan Way final-day knockout draw — were built from only part of the
      // tournament, so the bracket could be seeded off the wrong order.
      // Same fix already applied to the Kronos read in tour/index.tsx.
      const holesData = await fetchAllRows<any>(
        (from, to) => supabase.from('match_holes').select('player_id,match_id,hole_number,stableford_pts').in('match_id', matchIds).order('id').range(from, to)
      );
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

  // ── Skullers Scramble: captain-picked Day 2 singles order ──────────────
  // The stored order for one side, best-effort: whatever that captain has
  // already submitted, in position order. Anyone without a position sorts to
  // the back, so a partially-stored side still renders in a sane order rather
  // than an arbitrary one.
  function storedSinglesOrder(teamId: string): string[] {
    return compPlayers
      .filter(cp => cp.team_id === teamId)
      .sort((a, b) => (a.singles_order ?? 9999) - (b.singles_order ?? 9999))
      .map(cp => cp.player_id);
  }

  // A side has submitted once every one of its enrolled players has a
  // position — derived rather than tracked as its own flag, so the two can
  // never drift apart.
  function singlesOrderSubmitted(teamId: string): boolean {
    const roster = compPlayers.filter(cp => cp.team_id === teamId);
    return roster.length > 0 && roster.every(cp => cp.singles_order != null);
  }

  function toggleOrderPick(teamId: string, playerId: string) {
    setOrderDraft(prev => {
      const current = prev[teamId] ?? [];
      return {
        ...prev,
        [teamId]: current.includes(playerId)
          ? current.filter(id => id !== playerId)
          : [...current, playerId],
      };
    });
  }

  // Commits a finished 1-N running order for one side. Shared by the
  // captain's own tap-through submission and by AUTO GENERATE so the two can
  // never land in different states.
  async function writeSinglesOrder(teamId: string, order: string[]) {
    const roster = compPlayers.filter(cp => cp.team_id === teamId);
    setSavingOrder(teamId);
    try {
      for (let i = 0; i < order.length; i++) {
        const cp = roster.find(p => p.player_id === order[i]);
        if (!cp) continue;
        const { error } = await supabase.from('competition_players').update({ singles_order: i + 1 }).eq('id', cp.id);
        if (error) { Alert.alert('Error', error.message); return; }
      }
      setOrderDraft(prev => ({ ...prev, [teamId]: [] }));
      await load();
    } finally {
      setSavingOrder(null);
    }
  }

  async function saveSinglesOrder(teamId: string) {
    const order = orderDraft[teamId] ?? [];
    const roster = compPlayers.filter(cp => cp.team_id === teamId);
    if (order.length !== roster.length) {
      Alert.alert('Order incomplete', `Tap all ${roster.length} players in playing order before submitting.`);
      return;
    }
    await writeSinglesOrder(teamId, order);
  }

  // AUTO GENERATE (Dave, 2026-09-14) — a captain who doesn't want to tap
  // through every position gets a random running order instead, submitted
  // straight away. Exactly the same end state as picking it by hand, and
  // per-side, so one captain can auto-generate while the other still picks
  // manually. Drives both days, same as any submitted order.
  async function autoGenerateSinglesOrder(teamId: string) {
    const roster = compPlayers.filter(cp => cp.team_id === teamId);
    if (roster.length === 0) {
      Alert.alert('No players', 'Draft players onto this side before generating a running order.');
      return;
    }
    await writeSinglesOrder(teamId, shuffle(roster.map(cp => cp.player_id)));
  }

  // Reopens a submitted side so its captain can re-do the order. Only clears
  // the order itself — never the enrolment rows it lives on.
  function reopenSinglesOrder(teamId: string) {
    Alert.alert('Reopen this order?', 'The submitted running order for this side will be cleared so it can be picked again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reopen', style: 'destructive', onPress: async () => {
        setSavingOrder(teamId);
        try {
          await supabase.from('competition_players').update({ singles_order: null })
            .eq('competition_id', competitionId).eq('team_id', teamId);
          setOrderDraft(prev => ({ ...prev, [teamId]: [] }));
          await load();
        } finally {
          setSavingOrder(null);
        }
      }},
    ]);
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
    // See dayFormatToHandicapMethod's comment — Titan Way/Odd Titan's own
    // final Singles Playoff day (identified by its format-unique
    // finalDayKnockout/finalRoundStablefordTeamPoints flag, not just
    // "is this the last day", since Multi-Team Tour's own auto-overridden
    // final Singles day is a normal standalone Singles day) must keep its
    // existing individual-handicap behaviour.
    const drawFormatRules = getFormatRules(comp?.format);
    const drawMaxDayNumber = days.length > 0 ? Math.max(...days.map(d => d.day_number)) : day.day_number;
    const isTitanStylePlayoffDay = (df === 'singles' || df === 'singles_stableford')
      && (drawFormatRules.finalDayKnockout || drawFormatRules.finalRoundStablefordTeamPoints)
      && day.day_number === drawMaxDayNumber;
    const handicapMethod = dayFormatToHandicapMethod(df, isTitanStylePlayoffDay);
    const hcp       = day.hcp_pct ?? 100;

    // Same McFadey & Driver / Track Stats toggles as Casual Golf's game
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
        notifyRoundPlayers(matchRows, `${DAY_FORMAT_LABELS[df] ?? 'Round'} draw is out for ${comp?.name ?? 'your tournament'}.`);
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
    // Skullers Scramble's days are ordered by each captain's submitted running
    // order instead (Red #1 v Blue #1, #2 v #2, …) — the same pair-by-index
    // pairing below, just seeded from the captains rather than from Kronos.
    // Both sides must have submitted first, or the draw would quietly pair
    // them in enrolment order. The Scramble day reads the SAME submitted
    // order at 2-player granularity: order 1+2 are a pair, 3+4 are a pair, and
    // pair N plays the other side's pair N (Dave, 2026-09-14 — one order
    // drives both days, there is no separate scramble pairing screen).
    const usesCaptainOrder = (isSingles || df === 'scramble') && formatRules.captainPickedSinglesOrder;
    if (usesCaptainOrder) {
      const missing = teamIds.filter(tid => !singlesOrderSubmitted(tid));
      if (missing.length > 0) {
        const names = missing.map(tid => teams.find(t => t.id === tid)?.name ?? 'A side').join(' and ');
        Alert.alert('Captain order not submitted', `${names} still needs to submit a singles running order before this draw can be generated.`);
        return;
      }
    }

    let kronosMaps: KronosTieBreakMaps | null = null;
    if (isSingles && !usesCaptainOrder) {
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
      if (usesCaptainOrder) {
        grouped[tid] = storedSinglesOrder(tid).filter(pid => roster.includes(pid));
      } else if (isSingles) {
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
      // Seeding must come from the locked qualifying-round standings only —
      // excluded explicitly (not just relying on this day's own matches not
      // existing yet) so a re-generate of an already-played final day can
      // never accidentally feed its own playoff results back into the
      // seeding that's supposed to have decided it (see tour/index.tsx's
      // matching exclusion for the same reasoning).
      const qualifyingMatches = matches.filter(m => !singlesDayIds.has(m.day_id));
      const bonusPts = calcSweepBonus(qualifyingMatches as any, singlesDayIds, comp?.bonus_points ?? 2);
      const teamStableford: Record<string, number> = {};
      compPlayers.forEach(cp => {
        if (!cp.team_id) return;
        teamStableford[cp.team_id] = (teamStableford[cp.team_id] ?? 0) + (stablefordTotals[cp.player_id] ?? 0);
      });
      const standings = getStandings(
        qualifyingMatches.filter(m => m.home_team_id && m.away_team_id) as any,
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
      notifyRoundPlayers(matchRows, `${DAY_FORMAT_LABELS[df] ?? 'Round'} draw is out for ${comp?.name ?? 'your tournament'}.`);
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

  // Simulate Day (Dave, 2026-09-09, live-testing Ryder Cup with Rick) — fills
  // in plausible random hole-by-hole scores for whatever's already drawn that
  // day, so an admin can preview how a round plays out without hand-scoring
  // every match. Reuses the exact random-score model
  // (simulateGross/rnd/makeRandom) and per-hole stableford-vs-par match logic
  // src/lib/simulateTournament.ts's whole-tournament simulator already uses
  // for this same format family — just pointed at matches that already exist
  // (drawn via the buttons above) instead of creating new ones from scratch.
  async function simulateDay(day: DayRow) {
    const dayMatches = matches.filter(m => m.day_id === day.id && m.status !== 'complete' && (m.home_player_ids.length > 0 || m.away_player_ids.length > 0));
    if (dayMatches.length === 0) {
      Alert.alert('Nothing to simulate', 'Generate the draw for this day first, or every match is already complete.');
      return;
    }
    setSimulating(day.id);
    try {
      const { data: holes, error: holesErr } = await supabase
        .from('course_holes').select('hole_number,par,stroke_index').eq('course_name', day.course_name ?? '').order('hole_number');
      if (holesErr || !holes || holes.length !== 18) {
        Alert.alert('Error', 'Could not load 18 holes of course data for this day\'s course.');
        return;
      }
      const hcpByPlayer: Record<string, number> = {};
      compPlayers.forEach(cp => { hcpByPlayer[cp.player_id] = cp.handicap_index ?? 0; });

      let seed = { v: Date.now() & 0xffffffff };
      const rnd = () => {
        seed.v |= 0; seed.v = (seed.v + 0x6D2B79F5) | 0;
        let t = Math.imul(seed.v ^ (seed.v >>> 15), 1 | seed.v);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const scoreTable = [-2, -1, -1, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3];
      const simulateGross = (par: number, courseHcp: number) => {
        const expected = courseHcp / 18;
        const shift = expected > 2 ? 1 : expected > 0.7 ? (Math.floor(rnd() * 10) < 4 ? 1 : 0) : 0;
        return Math.max(1, par + scoreTable[Math.floor(rnd() * scoreTable.length)] + shift);
      };

      let skipped = 0;
      // draw.tsx's DayRow never carries slope/course rating/par (not selected
      // by this screen's query), so playerCourseHcp always takes its
      // Math.round(hcpIndex) fallback here regardless — this object just
      // gives TS a type with properties in common with what playerCourseHcp
      // expects, since DayRow and that param type otherwise share none.
      const hcpDayContext: { slope_rating?: number | null; course_rating?: number | null; course_par?: number | null } = {};

      // 2v2 Match Play Scramble simulates one shared ball per pair (both of
      // its players carding the same gross, exactly as the live scorer
      // writes it), compared on net off the blended pair handicap — not
      // best-of-two-individual-balls like 4BBB.
      const isScrambleDay = day.day_format === 'scramble';
      const resolveHcps = (ids: string[]) => ids.map(pid => playerCourseHcp(hcpByPlayer[pid], hcpDayContext, day.hcp_pct));
      const scramblePairHcp = (ids: string[]) => {
        const hs = resolveHcps(ids);
        if (hs.length === 0) return 0;
        return hs.length === 1 ? hs[0] : calcScramblePairHandicap(hs[0], hs[1]);
      };

      for (const m of dayMatches) {
        const allIds = [...m.home_player_ids, ...m.away_player_ids];
        if (m.home_player_ids.length === 0 || m.away_player_ids.length === 0) { skipped++; continue; }
        await supabase.from('match_holes').delete().eq('match_id', m.id);
        // Raw blended pair handicap drives how well each pair SCORES; the
        // effective one (relative to the other pair) drives the shots it
        // receives, via the same helper the live scorer uses.
        const homePairHcp = isScrambleDay ? scramblePairHcp(m.home_player_ids) : 0;
        const awayPairHcp = isScrambleDay ? scramblePairHcp(m.away_player_ids) : 0;
        const homeEffHcp  = isScrambleDay ? scramblePairEffectiveHcp(resolveHcps(m.home_player_ids), resolveHcps(m.away_player_ids), true) : 0;
        const awayEffHcp  = isScrambleDay ? scramblePairEffectiveHcp(resolveHcps(m.home_player_ids), resolveHcps(m.away_player_ids), false) : 0;
        let holesStr = '';
        const holeRows: any[] = [];
        for (const h of holes as any[]) {
          if (isScrambleDay) {
            const homeShots = calcStrokesReceived(homeEffHcp, h.stroke_index);
            const awayShots = calcStrokesReceived(awayEffHcp, h.stroke_index);
            const homeGross = simulateGross(h.par, homePairHcp);
            const awayGross = simulateGross(h.par, awayPairHcp);
            const homeNet = homeGross - homeShots;
            const awayNet = awayGross - awayShots;
            const scrambleResult: 'h' | 'a' | 'f' = homeNet < awayNet ? 'h' : awayNet < homeNet ? 'a' : 'f';
            holesStr += scrambleResult;
            for (const pid of allIds) {
              const isHome = m.home_player_ids.includes(pid);
              const gross = isHome ? homeGross : awayGross;
              const shots = isHome ? homeShots : awayShots;
              // stableford_pts stays null — a shared team ball is not either
              // player's own round (same rule matchScoring.ts applies live).
              holeRows.push({ match_id: m.id, player_id: pid, hole_number: h.hole_number, score: scrambleResult, gross_score: gross, net_score: gross - shots, stableford_pts: null });
            }
            if (calcHoles(holesStr, 18, 1).concluded) break;
            continue;
          }
          const ptsByPlayer: Record<string, number> = {};
          const grossByPlayer: Record<string, number> = {};
          for (const pid of allIds) {
            const gross = simulateGross(h.par, playerCourseHcp(hcpByPlayer[pid], hcpDayContext, 100));
            const shots = calcStrokesReceived(playerCourseHcp(hcpByPlayer[pid], hcpDayContext, day.hcp_pct), h.stroke_index);
            grossByPlayer[pid] = gross;
            ptsByPlayer[pid] = calcStablefordPoints(gross, h.par, shots);
          }
          const homeBest = Math.max(...m.home_player_ids.map(id => ptsByPlayer[id]));
          const awayBest = Math.max(...m.away_player_ids.map(id => ptsByPlayer[id]));
          const result: 'h' | 'a' | 'f' = homeBest > awayBest ? 'h' : awayBest > homeBest ? 'a' : 'f';
          holesStr += result;
          for (const pid of allIds) {
            const shots = calcStrokesReceived(playerCourseHcp(hcpByPlayer[pid], hcpDayContext, day.hcp_pct), h.stroke_index);
            holeRows.push({ match_id: m.id, player_id: pid, hole_number: h.hole_number, score: result, gross_score: grossByPlayer[pid], net_score: grossByPlayer[pid] - shots, stableford_pts: ptsByPlayer[pid] });
          }
          if (calcHoles(holesStr, 18, 1).concluded) break;
        }
        const { homeUp, remaining, concluded } = calcHoles(holesStr, 18, 1);
        const winner = concluded ? (homeUp > 0 ? 'home' : 'away') : (homeUp === 0 ? 'half' : homeUp > 0 ? 'home' : 'away');
        const result_str = concluded ? `${Math.abs(homeUp)}&${remaining}` : (homeUp === 0 ? 'Halved' : `${Math.abs(homeUp)}UP`);
        await supabase.from('matches').update({
          status: 'complete', winner, result_str, holes_string: holesStr.padEnd(18, '.'),
          started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
        }).eq('id', m.id);
        await supabase.from('match_holes').insert(holeRows);
      }
      await load();
      if (skipped > 0) {
        Alert.alert('Some matches skipped', `${skipped} match${skipped === 1 ? '' : 'es'} couldn't be simulated because one side has no players yet.`);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not simulate this day.');
    } finally {
      setSimulating(null);
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

    // Odd Titan's qualifying rounds (Dave + Rick, 2026-09-14 live test with 5
    // teams): round-robin 4BBB pairing byes exactly one team every round
    // whenever the team count is odd — "one team doesn't play" — which is
    // not what Odd Titan is supposed to be. There's no opponent pairing at
    // all: every team's 4 players go out and play their own Stableford
    // round, and the team's score for that round is just those 4 players'
    // points added together (see tour/index.tsx's teamStableford — now the
    // WHOLE-tournament total, not just the final round, for this format).
    // Titan Way (even teams, no bye problem) keeps the existing 4BBB
    // round-robin + partnership optimizer below unchanged.
    const isOddTitan = comp.format === 'odd_titan';

    async function proceed() {
      setGenerating('titan_way');
      try {
        if (existingMatches.length > 0) {
          await supabase.from('matches').delete().in('id', existingMatches.map(m => m.id));
        }

        const matchRows: any[] = [];
        const sideGamesTags = [
          ...(comp?.settings?.voice_enabled ? ['voice:on'] : []),
          ...(comp?.settings?.track_stats_enabled ? [] : ['stats:off']),
        ];

        if (isOddTitan) {
          // Rebuilt 2026-09-16 (Dave/Rick) — this used to be one match row
          // per TEAM, home_player_ids = that team's entire 4-player roster,
          // meaning every team played as one intact group of its own
          // members every single round: the exact opposite of "never
          // automatically place an entire team together." Team scoring
          // (tour/index.tsx) sums each player's Stableford total by
          // competition_players.team_id and never reads which match/group
          // they played in, so the physical playing group below can be
          // freely mixed across teams with zero effect on team standings.
          const players = teamIds.flatMap(tid => grouped[tid].map(pid => ({ id: pid, teamId: tid })));
          const schedule = generateOddTitanGroups({
            players,
            qualifyingDayNumbers: qualifyingDays.map(d => d.day_number),
          });
          for (const day of qualifyingDays) {
            const hcp = day.hcp_pct ?? 100;
            const groups = schedule.groupsByDay[day.day_number] ?? [];
            let matchNum = 1;
            for (const group of groups) {
              matchRows.push({
                competition_id: competitionId, day_id: day.id, match_number: matchNum++,
                home_team_id: null, away_team_id: null,
                home_player_ids: group, away_player_ids: [],
                round_format: 'stableford', is_singles: false, hcp_allowance: hcp,
                handicap_method: 'individual', status: 'upcoming', side_games: sideGamesTags,
              });
            }
          }
        } else {
          const schedule = generateTitanWaySchedule({
            teamIds,
            rosterByTeam: grouped,
            qualifyingDayNumbers: qualifyingDays.map(d => d.day_number),
          });

          for (const day of qualifyingDays) {
            const df = day.day_format ?? 'four_bbb';
            const roundFmt = dayFormatToRoundFormat(df);
            const handicapMethod = dayFormatToHandicapMethod(df);
            const hcp = day.hcp_pct ?? 100;
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
        }

        if (matchRows.length === 0) {
          Alert.alert('No matches', 'Could not generate any matches — check team rosters.');
          return;
        }
        const { error } = await supabase.from('matches').insert(matchRows);
        if (error) { Alert.alert('Error', error.message); return; }
        await load();
        notifyRoundPlayers(matchRows, `The full ${comp?.name ?? 'tournament'} schedule is out — check your matches.`);
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

  // "What happens if we selected the wrong game mode" (Rick, via Dave,
  // 2026-09-16) — blocked outright (not just warned) once any hole has been
  // scored for the day, unlike CLEAR above: a format swap invalidates the
  // day's existing matches entirely (different team-pairing shape, not just
  // a roster tweak), so there is no safe "keep the scores" path here.
  async function openEditFormat(day: DayRow) {
    const dayMatchIds = matches.filter(m => m.day_id === day.id).map(m => m.id);
    const { count } = dayMatchIds.length
      ? await supabase.from('match_holes').select('id', { count: 'exact', head: true }).in('match_id', dayMatchIds)
      : { count: 0 };
    if ((count ?? 0) > 0) {
      Alert.alert('Can\'t change game mode', 'This day already has scores entered. Clear the day first if you need to change its game mode — that will delete its matches and scores.');
      return;
    }
    setEditFormatDay(day);
  }

  async function saveNewFormat(newFormat: string) {
    if (!editFormatDay) return;
    setSavingFormat(true);
    try {
      await supabase.from('competition_days').update({ day_format: newFormat }).eq('id', editFormatDay.id);
      // Any shells already generated under the old format (team pairings,
      // singles/pairs slot counts, handicap_method) no longer match — safe
      // to drop since openEditFormat only ever gets here with zero scores.
      await supabase.from('matches').delete().eq('day_id', editFormatDay.id);
      setEditFormatDay(null);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not change game mode');
    } finally {
      setSavingFormat(false);
    }
  }

  // ── Manual Move/Swap between individual groups ──────────────────────────
  async function groupHasScores(matchId: string): Promise<boolean> {
    const { count } = await supabase.from('match_holes').select('id', { count: 'exact', head: true }).eq('match_id', matchId);
    return (count ?? 0) > 0;
  }

  function sameTeamPairCount(playerIds: string[]): number {
    let count = 0;
    for (let i = 0; i < playerIds.length; i++) {
      for (let j = i + 1; j < playerIds.length; j++) {
        const a = compPlayers.find(cp => cp.player_id === playerIds[i])?.team_id;
        const b = compPlayers.find(cp => cp.player_id === playerIds[j])?.team_id;
        if (a && a === b) count++;
      }
    }
    return count;
  }

  // Mirrors MatchAssignModal.save()'s roster-change handling (Rick's brief,
  // section 4.12.4) — a group's own scores no longer mean anything once its
  // players change, so they're cleared and the group restarts from hole 1.
  async function resetGroupAfterRosterChange(matchId: string, removedPlayerIds: string[]) {
    if (removedPlayerIds.length > 0) {
      await supabase.from('match_holes').delete().eq('match_id', matchId).in('player_id', removedPlayerIds);
    }
    const m = matches.find(mm => mm.id === matchId);
    await supabase.from('matches').update({
      holes_string: '.'.repeat(m?.holes_string?.length || 18),
      status: 'upcoming', winner: null, result_str: null,
    } as any).eq('id', matchId);
  }

  async function performMove(fromMatchId: string, toMatchId: string, playerId: string) {
    const fromMatch = matches.find(m => m.id === fromMatchId)!;
    const toMatch = matches.find(m => m.id === toMatchId)!;
    await supabase.from('matches').update({ home_player_ids: fromMatch.home_player_ids.filter(id => id !== playerId) } as any).eq('id', fromMatchId);
    await supabase.from('matches').update({ home_player_ids: [...toMatch.home_player_ids, playerId] } as any).eq('id', toMatchId);
    await resetGroupAfterRosterChange(fromMatchId, [playerId]);
    await resetGroupAfterRosterChange(toMatchId, []);
    sendPushNotification('Titan Golf', `You've been moved to a different group in ${comp?.name ?? 'your tournament'}.`, [playerId]);
    await load();
  }

  async function performSwap(matchAId: string, playerA: string, matchBId: string, playerB: string) {
    const matchA = matches.find(m => m.id === matchAId)!;
    const matchB = matches.find(m => m.id === matchBId)!;
    await supabase.from('matches').update({ home_player_ids: matchA.home_player_ids.map(id => id === playerA ? playerB : id) } as any).eq('id', matchAId);
    await supabase.from('matches').update({ home_player_ids: matchB.home_player_ids.map(id => id === playerB ? playerA : id) } as any).eq('id', matchBId);
    await resetGroupAfterRosterChange(matchAId, [playerA]);
    await resetGroupAfterRosterChange(matchBId, [playerB]);
    sendPushNotification('Titan Golf', `Your group has changed in ${comp?.name ?? 'your tournament'}.`, [playerA, playerB]);
    await load();
  }

  async function handleMovePlayerTap(matchId: string, playerId: string) {
    if (!selectedForMove) { setSelectedForMove({ matchId, playerId }); return; }
    if (selectedForMove.playerId === playerId) { setSelectedForMove(null); return; }
    if (selectedForMove.matchId === matchId) { setSelectedForMove({ matchId, playerId }); return; } // reselect within the same group

    const fromMatchId = selectedForMove.matchId;
    const fromPlayerId = selectedForMove.playerId;
    const fromMatch = matches.find(m => m.id === fromMatchId)!;
    const toMatch = matches.find(m => m.id === matchId)!;
    const resultingFrom = fromMatch.home_player_ids.map(id => id === fromPlayerId ? playerId : id);
    const resultingTo = toMatch.home_player_ids.map(id => id === playerId ? fromPlayerId : id);
    const teamPairsBefore = sameTeamPairCount(fromMatch.home_player_ids) + sameTeamPairCount(toMatch.home_player_ids);
    const teamPairsAfter = sameTeamPairCount(resultingFrom) + sameTeamPairCount(resultingTo);

    const doSwap = async () => { await performSwap(fromMatchId, fromPlayerId, matchId, playerId); setSelectedForMove(null); };
    const [hasScoresA, hasScoresB] = await Promise.all([groupHasScores(fromMatchId), groupHasScores(matchId)]);

    if (hasScoresA || hasScoresB) {
      Alert.alert('This will delete scores', 'One of these groups already has scores entered. Swapping will delete them and restart both groups from hole 1. Continue?', [
        { text: 'Cancel', style: 'cancel', onPress: () => setSelectedForMove(null) },
        { text: 'Continue', style: 'destructive', onPress: doSwap },
      ]);
    } else if (teamPairsAfter > teamPairsBefore) {
      Alert.alert('Same team warning', 'This swap will put two players from the same team in one group. Continue?', [
        { text: 'Cancel', style: 'cancel', onPress: () => setSelectedForMove(null) },
        { text: 'Continue', onPress: doSwap },
      ]);
    } else {
      await doSwap();
    }
  }

  async function handleMoveIntoGroup(matchId: string) {
    if (!selectedForMove) return;
    const targetMatch = matches.find(m => m.id === matchId)!;
    if (targetMatch.home_player_ids.length >= 4) {
      Alert.alert('Group full', 'This group already has 4 players — tap a player in it to swap instead.');
      return;
    }
    const { matchId: fromMatchId, playerId } = selectedForMove;
    const teamPairsAfter = sameTeamPairCount([...targetMatch.home_player_ids, playerId]);
    const doMove = async () => { await performMove(fromMatchId, matchId, playerId); setSelectedForMove(null); };
    const hasScoresFrom = await groupHasScores(fromMatchId);

    if (hasScoresFrom) {
      Alert.alert('This will delete scores', 'This group already has scores entered. Moving this player will delete them and restart the group from hole 1. Continue?', [
        { text: 'Cancel', style: 'cancel', onPress: () => setSelectedForMove(null) },
        { text: 'Continue', style: 'destructive', onPress: doMove },
      ]);
    } else if (teamPairsAfter > 0) {
      Alert.alert('Same team warning', 'This move will put two players from the same team in one group. Continue?', [
        { text: 'Cancel', style: 'cancel', onPress: () => setSelectedForMove(null) },
        { text: 'Continue', onPress: doMove },
      ]);
    } else {
      await doMove();
    }
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
          const drawFormatRules = getFormatRules(comp?.format);
          const usesWholeTournamentDraw = drawFormatRules.wholeTournamentDraw;
          return (
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={s.sectionLabel}>{days.length} DAYS</Text>
              {days.length > 0 && (
                <TouchableOpacity
                  style={[s.genBtn, s.genBtnSecondary, moveMode && { backgroundColor: `${GOLD}22`, borderColor: GOLD }]}
                  onPress={() => { setMoveMode(v => !v); setSelectedForMove(null); }}
                  activeOpacity={0.8}
                >
                  <Text style={[s.genBtnText, s.genBtnTextSecondary, moveMode && { color: GOLD }]}>
                    {moveMode ? 'DONE MOVING' : 'MOVE / SWAP'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            {moveMode && (
              <Text style={[s.titanWayBannerSub, { marginBottom: 10 }]}>
                {selectedForMove
                  ? `${playerNames[selectedForMove.playerId]?.split(' ')[0] ?? 'Player'} selected — tap another player anywhere to swap, or + on a group with room to move them there.`
                  : 'Tap a player in any group to start a move or swap.'}
              </Text>
            )}
            {days.length === 0 && (
              <View style={s.empty}>
                <Text style={s.emptyText}>No days configured. Add days in the tournament builder.</Text>
              </View>
            )}
            {usesWholeTournamentDraw && days.length > 0 && (
              <View style={s.titanWayBanner}>
                <TouchableOpacity
                  style={s.genBtn}
                  onPress={() => generateTitanWayDraw(maxDayNumber)}
                  disabled={!!generating}
                  activeOpacity={0.8}
                >
                  {generating === 'titan_way' ? <ActivityIndicator size="small" color="#000" /> : <Text style={s.genBtnText}>GENERATE {drawFormatRules.label.toUpperCase()} DRAW</Text>}
                </TouchableOpacity>
                <Text style={s.titanWayBannerSub}>
                  Generates every qualifying round (Days 1–{Math.max(1, maxDayNumber - 1)}) together, minimising repeat partners and opponents.
                </Text>
              </View>
            )}
            {/* Skullers Scramble — each side's captain submits one running
                order, which drives BOTH days: adjacent positions pair up for
                Day 1's Scramble, and the same order runs 1-to-1 for Day 2's
                Singles. Same banner + roster-panel + tap-to-pick shapes the
                Ryder Cup draft and the team roster panel above already use. */}
            {drawFormatRules.captainPickedSinglesOrder && days.length > 0 && (() => {
              const sides = teams.filter(t => compPlayers.some(cp => cp.team_id === t.id));
              return (
                <>
                  <View style={s.titanWayBanner}>
                    <Text style={s.rosterPanelTitle}>CAPTAIN-PICKED RUNNING ORDER</Text>
                    <Text style={s.titanWayBannerSub}>
                      Each captain picks their side's running order once, and it sets both days. Day 1 Scramble pairs them up in twos — #1 and #2 are a pair, #3 and #4 are a pair — against the other side's pair in the same position. Day 2 Singles runs 1-to-1: Red #1 plays Blue #1, #2 plays #2, and so on down the order.
                    </Text>
                  </View>
                  {sides.length === 0 && (
                    <View style={s.empty}><Text style={s.emptyText}>Draft both sides before picking a singles order.</Text></View>
                  )}
                  {sides.map(team => {
                    const roster = compPlayers.filter(cp => cp.team_id === team.id);
                    const submitted = singlesOrderSubmitted(team.id);
                    const picked = orderDraft[team.id] ?? [];
                    const busy = savingOrder === team.id;
                    return (
                      <View key={team.id} style={s.rosterPanel}>
                        <Text style={[s.rosterPanelTitle, { color: team.accent_color }]}>
                          {team.name} — {submitted ? 'order submitted' : `tap players in order · ${picked.length} of ${roster.length}`}
                        </Text>
                        {(submitted ? storedSinglesOrder(team.id) : roster.map(cp => cp.player_id)).map(pid => {
                          const cp = roster.find(p => p.player_id === pid);
                          if (!cp) return null;
                          const pos = submitted ? cp.singles_order : (picked.indexOf(pid) >= 0 ? picked.indexOf(pid) + 1 : null);
                          return (
                            <TouchableOpacity
                              key={pid}
                              style={[s.rosterPickRow, s.rosterPickTop, pos != null && s.rosterPickRowOn]}
                              onPress={() => !submitted && !busy && toggleOrderPick(team.id, pid)}
                              disabled={submitted || busy}
                              activeOpacity={0.7}
                            >
                              <View style={[s.fmtBadge, pos == null && { borderColor: '#333' }]}>
                                <Text style={[s.fmtBadgeText, pos == null && { color: '#444' }]}>{pos ?? '–'}</Text>
                              </View>
                              <PlayerAvatar cp={cp} size={32} />
                              <View style={{ flex: 1 }}>
                                <Text style={[s.playerName, pos != null && { color: GOLD }]}>{cp.display_name}{cp.is_captain ? '  (C)' : ''}</Text>
                                {cp.handicap_index != null && <Text style={s.playerHcp}>HCP {cp.handicap_index}</Text>}
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                        {/* Wraps rather than overflowing once AUTO GENERATE
                            makes this a three-button row on a narrow phone
                            (see the 2026-09-04 font-scaling button-wrap fix). */}
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                          {submitted ? (
                            <TouchableOpacity style={[s.genBtn, s.genBtnSecondary]} onPress={() => reopenSinglesOrder(team.id)} disabled={busy} activeOpacity={0.8}>
                              {busy ? <ActivityIndicator size="small" color={RED} /> : <Text style={[s.genBtnText, s.genBtnTextSecondary]}>REOPEN</Text>}
                            </TouchableOpacity>
                          ) : (
                            <>
                              <TouchableOpacity style={s.genBtn} onPress={() => saveSinglesOrder(team.id)} disabled={busy} activeOpacity={0.8}>
                                {busy ? <ActivityIndicator size="small" color="#000" /> : <Text style={s.genBtnText}>SUBMIT ORDER</Text>}
                              </TouchableOpacity>
                              {/* Gold text, not the secondary RED — this one
                                  isn't destructive like CLEAR/REOPEN. */}
                              <TouchableOpacity style={[s.genBtn, s.genBtnSecondary]} onPress={() => autoGenerateSinglesOrder(team.id)} disabled={busy} activeOpacity={0.8}>
                                <Text style={[s.genBtnText, { color: GOLD }]}>AUTO GENERATE</Text>
                              </TouchableOpacity>
                              {picked.length > 0 && (
                                <TouchableOpacity
                                  style={[s.genBtn, s.genBtnSecondary]}
                                  onPress={() => setOrderDraft(prev => ({ ...prev, [team.id]: [] }))}
                                  disabled={busy}
                                  activeOpacity={0.8}
                                >
                                  <Text style={[s.genBtnText, s.genBtnTextSecondary]}>CLEAR</Text>
                                </TouchableOpacity>
                              )}
                            </>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </>
              );
            })()}
            {days.map(day => {
              const dayMatches = matches.filter(m => m.day_id === day.id);
              const isGen = generating === day.id;
              const isTitanWayQualifyingDay = usesWholeTournamentDraw && day.day_number !== maxDayNumber;
              return (
                <View key={day.id} style={s.dayCard}>
                  <View style={s.dayCardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.dayNum}>DAY {day.day_number}</Text>
                      <Text style={s.dayName}>{day.course_name || 'Course TBC'}</Text>
                      <View style={s.dayBadges}>
                        {day.day_format && (
                          <TouchableOpacity
                            style={[s.fmtBadge, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}
                            onPress={() => openEditFormat(day)}
                            activeOpacity={0.7}
                          >
                            <Text style={s.fmtBadgeText}>{DAY_FORMAT_LABELS[day.day_format] ?? day.day_format}</Text>
                            <Ionicons name="pencil" size={10} color={GOLD} />
                          </TouchableOpacity>
                        )}
                        <View style={[s.fmtBadge, { borderColor: '#555' }]}>
                          <Text style={[s.fmtBadgeText, { color: '#888' }]}>{day.hcp_pct ?? 100}% HCP</Text>
                        </View>
                      </View>
                    </View>
                    <View style={{ gap: 6 }}>
                      {dayMatches.length > 0 ? (
                        <>
                          <TouchableOpacity
                            style={s.genBtn}
                            onPress={() => simulateDay(day)}
                            disabled={isGen || simulating === day.id}
                            activeOpacity={0.8}
                          >
                            {simulating === day.id ? <ActivityIndicator size="small" color="#000" /> : <Text style={s.genBtnText}>SIMULATE</Text>}
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[s.genBtn, s.genBtnSecondary]}
                            onPress={() => clearDay(day)}
                            disabled={isGen || simulating === day.id}
                            activeOpacity={0.8}
                          >
                            <Text style={[s.genBtnText, s.genBtnTextSecondary]}>CLEAR</Text>
                          </TouchableOpacity>
                        </>
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
                          if (moveMode) {
                            const hasRoom = m.home_player_ids.length < 4;
                            return (
                              <View key={m.id} style={[s.matchItem, idx > 0 && { borderTopWidth: 1, borderTopColor: '#1c1c1c' }, { flexWrap: 'wrap', gap: 6 }]}>
                                {m.home_player_ids.map(pid => {
                                  const isSelected = selectedForMove?.playerId === pid;
                                  return (
                                    <TouchableOpacity
                                      key={pid}
                                      style={[s.moveChip, isSelected && s.moveChipSelected]}
                                      onPress={() => handleMovePlayerTap(m.id, pid)}
                                      activeOpacity={0.7}
                                    >
                                      <Text style={[s.moveChipText, isSelected && { color: '#000' }]}>{playerNames[pid]?.split(' ')[0] ?? '?'}</Text>
                                    </TouchableOpacity>
                                  );
                                })}
                                {selectedForMove && selectedForMove.matchId !== m.id && hasRoom && (
                                  <TouchableOpacity style={[s.moveChip, s.moveChipAdd]} onPress={() => handleMoveIntoGroup(m.id)} activeOpacity={0.7}>
                                    <Ionicons name="add" size={14} color={GOLD} />
                                  </TouchableOpacity>
                                )}
                              </View>
                            );
                          }
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
        compName={comp?.name ?? 'your tournament'}
        onClose={() => setAssignModalMatches(null)}
        onSaved={load}
      />

      <Modal visible={editFormatDay !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditFormatDay(null)}>
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setEditFormatDay(null)}>
              <Text style={s.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.modalTitle}>DAY {editFormatDay?.day_number} GAME MODE</Text>
            <View style={{ width: 50 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {(['four_bbb', 'four_bbb_stroke', 'foursomes', 'greensomes', 'singles', 'singles_stableford', 'stableford', 'medal', 'scramble'] as const).map(fmt => {
              const isCurrent = fmt === editFormatDay?.day_format;
              return (
                <TouchableOpacity
                  key={fmt}
                  style={[s.memberRow, isCurrent && s.memberRowOn]}
                  onPress={() => saveNewFormat(fmt)}
                  disabled={savingFormat}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[s.memberName, isCurrent && { color: GOLD }]}>{DAY_FORMAT_LABELS[fmt]}</Text>
                  </View>
                  {isCurrent && <Ionicons name="checkmark-circle" size={20} color={GOLD} />}
                </TouchableOpacity>
              );
            })}
            {savingFormat && <ActivityIndicator color={GOLD} style={{ marginTop: 12 }} />}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

// Shared by Manual generation (a whole day's worth of freshly-created
// empty-slot matches) and Edit Match (a single existing match) — Rick's
// brief, section 4.14. Duplicate-player prevention spans BOTH the match(es)
// open in this modal AND every other already-saved match on the same day,
// so a player can't end up in two matches at once within the same round.
function MatchAssignModal({
  visible, matches, allMatches, teams, compPlayers, days, compName, onClose, onSaved,
}: {
  visible: boolean;
  matches: MatchRow[];
  allMatches: MatchRow[];
  teams: TeamRow[];
  compPlayers: CompPlayer[];
  days: DayRow[];
  compName: string;
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
      const newlyAddedIds = new Set<string>();
      for (const m of matches) {
        const w = working[m.id];
        if (!w) continue;
        const newHome = w.home.filter((id): id is string => !!id);
        const newAway = w.away.filter((id): id is string => !!id);
        [...newHome, ...newAway]
          .filter(id => !m.home_player_ids.includes(id) && !m.away_player_ids.includes(id))
          .forEach(id => newlyAddedIds.add(id));
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
      if (newlyAddedIds.size > 0) {
        sendPushNotification('Titan Golf', `You've been added to a match in ${compName}.`, [...newlyAddedIds]);
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

          {/* Player picker — rendered as an overlay INSIDE this same Modal,
              not as a second <Modal>. Two native Modals stacked from one
              screen silently fails on iOS ("Attempt to present ... which is
              already presenting ...") — the second present() is a no-op, so
              tapping a player slot looked like the whole screen had frozen.
              An in-place overlay reproduces the identical look (dim
              background + bottom sheet) without a second presentation. */}
          {pickerFor !== null && (
            <View style={StyleSheet.absoluteFillObject}>
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
            </View>
          )}
        </View>
    </Modal>
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
  moveChip:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7 },
  moveChipSelected: { backgroundColor: GOLD, borderColor: GOLD },
  moveChipAdd:      { paddingHorizontal: 10, borderStyle: 'dashed', borderColor: GOLD },
  moveChipText:     { fontFamily: 'JUSTSans-ExBold', fontSize: 12, color: '#fff' },
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
