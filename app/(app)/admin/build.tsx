import { useState, useCallback, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View, Text, ScrollView, StyleSheet, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert, Switch, Image, Modal, FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { uploadImage } from '../../../src/lib/uploadImage';
import { teamLogos, resolveAvatar } from '../../../src/lib/assets';
import { goBack } from '../../../src/lib/navigation';

const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const RED    = '#f87171';
const PURPLE = '#a78bfa';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

type FormatId = 'team_matchplay' | 'titan_way' | 'ryder_cup' | 'stableford' | 'medal' | 'knockout';
// Only formats that actually have a working Casual Round engine behind them —
// Foursomes/Greensomes/Scramble were listed here but never got real scoring
// support in score/enter/[matchId].tsx, so they're deliberately not offered.
type DayFormatId = 'four_bbb' | 'four_bbb_stroke' | 'singles' | 'stableford' | 'medal';

interface CompFormat {
  id: FormatId;
  label: string;
  sub: string;
  available: boolean;
  defaultDays: number;
  defaultDayFormat: DayFormatId;
  defaultHcp: number;
}

const COMP_FORMATS: CompFormat[] = [
  {
    id: 'team_matchplay',
    label: 'Multi-Team Tour',
    sub: 'Multiple teams battle across days. Mix 4BBB, foursomes and singles. Titan Tour style.',
    available: true,
    defaultDays: 4,
    defaultDayFormat: 'four_bbb',
    defaultHcp: 75,
  },
  {
    id: 'titan_way',
    label: 'Titan Way',
    sub: '4BBB Stableford opening rounds build a team league, then a final-day knockout + singles draw — plus a full Kronos individual championship. Minimum 4 teams, 16 players.',
    available: true,
    defaultDays: 4,
    defaultDayFormat: 'four_bbb',
    defaultHcp: 75,
  },
  {
    id: 'ryder_cup',
    label: 'Ryder Cup',
    sub: '2 sides, captain picks, team points. Perfect for a weekend away.',
    available: true,
    defaultDays: 3,
    defaultDayFormat: 'four_bbb',
    defaultHcp: 75,
  },
  {
    id: 'stableford',
    label: 'Individual Stableford',
    sub: 'Everyone plays for themselves. Points per round build a season leaderboard.',
    available: true,
    defaultDays: 4,
    defaultDayFormat: 'stableford',
    defaultHcp: 100,
  },
  {
    id: 'medal',
    label: 'Stroke Play',
    sub: 'Lowest aggregate score wins. Multiple rounds, optional cut after round 2.',
    available: true,
    defaultDays: 2,
    defaultDayFormat: 'medal',
    defaultHcp: 100,
  },
  {
    id: 'knockout',
    label: 'Knockout Bracket',
    sub: 'Seeded draw, head-to-head elimination rounds. Coming soon.',
    available: false,
    defaultDays: 1,
    defaultDayFormat: 'singles',
    defaultHcp: 75,
  },
];

const DAY_FORMATS: Array<{ id: DayFormatId; label: string; sub: string }> = [
  { id: 'four_bbb',        label: '4BBB Stableford', sub: 'Best ball pairs' },
  { id: 'four_bbb_stroke', label: '4BBB Stroke', sub: 'Best ball, relative handicap' },
  { id: 'singles',    label: 'Singles',    sub: '1v1 matchplay' },
  { id: 'stableford', label: 'Stableford', sub: 'Points per hole' },
  { id: 'medal',      label: 'Medal',      sub: 'Stroke play' },
];

const HCP_OPTIONS = [
  { pct: 100, label: '100%' },
  { pct: 95,  label: '95%' },
  { pct: 90,  label: '90%' },
  { pct: 85,  label: '85%' },
  { pct: 75,  label: '75%' },
  { pct: 0,   label: 'Scratch' },
];

interface DayConfig {
  courseName: string;
  format: DayFormatId;
  hcpPct: number;
  ldEnabled: boolean;
  ldHole: number | null;
  ntpEnabled: boolean;
  ntpHole: number | null;
}

interface CourseItem { name: string; par: number; hasGps: boolean; }
interface CourseHole { hole_number: number; par: number; }
interface DraftPlayer {
  id: string; player_id: string; team_id: string | null;
  handicap_index: number | null; display_name: string; is_captain: boolean;
  status: 'enrolled' | 'invited' | 'declined';
}
interface DraftMember { player_id: string; display_name: string; handicap_index: number | null; team_id: string | null; avatar_url: string | null; }
interface SquadTeam { id: string; name: string; accent_color: string; logo_url: string | null; }

function getSquadTeamLogo(team: SquadTeam) {
  if (team.logo_url) return { uri: team.logo_url };
  const key = Object.keys(teamLogos).find(k => team.name.includes(k) || k.includes(team.name));
  return key ? teamLogos[key] : null;
}

const STEPS = ['Format', 'Details', 'Days', 'Draft'];

function ukDateToIso(ukDate: string): string {
  const [dd, mm, yyyy] = ukDate.trim().split('-');
  return `${yyyy}-${mm}-${dd}`;
}

function ukDateToDate(ukDate: string): Date {
  if (!/^\d{2}-\d{2}-\d{4}$/.test(ukDate.trim())) return new Date();
  const [dd, mm, yyyy] = ukDate.trim().split('-').map(Number);
  return new Date(yyyy, mm - 1, dd);
}

function dateToUk(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

export default function BuildTournamentScreen() {
  const router = useRouter();
  const { societyId } = useAdminSociety();

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [step, setStep] = useState(0);
  const [selectedFormat, setSelectedFormat] = useState<FormatId | null>(null);
  const [name, setName]                     = useState('');
  const [year, setYear]                     = useState(String(new Date().getFullYear() + 1));
  const [days, setDays]                     = useState<DayConfig[]>([]);
  const [ptsWin, setPtsWin]               = useState('1');
  const [ptsHalf, setPtsHalf]             = useState('0.5');
  const [openingRounds, setOpeningRounds] = useState('3');
  const [bonusPoints, setBonusPoints]     = useState('2');
  const [includeInKronos, setIncludeInKronos] = useState(false);
  const [voiceEnabled, setVoiceEnabled]        = useState(false);
  const [statsEnabled, setStatsEnabled]        = useState(false);
  const [description, setDescription]     = useState('');
  const [startDate, setStartDate]         = useState('');
  const [endDate, setEndDate]             = useState('');
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker]     = useState(false);
  const [numTeams, setNumTeams]           = useState('2');
  const [maxHandicap, setMaxHandicap]     = useState('');
  const [logoUri, setLogoUri]             = useState<string | null>(null);
  const [creating, setCreating]             = useState(false);
  const [courses, setCourses]             = useState<CourseItem[]>([]);
  const [courseHolesMap, setCourseHolesMap] = useState<Record<string, CourseHole[]>>({});
  const [courseSheetDay, setCourseSheetDay] = useState<number | null>(null);

  // Draft step (player selection) — only usable once the competition shell
  // actually exists, since competition_players needs a real competition_id.
  const [compId, setCompId]               = useState<string | null>(null);
  const [compPin, setCompPin]             = useState<string | null>(null);
  const [compPlayers, setCompPlayers]     = useState<DraftPlayer[]>([]);
  const [squadTeams, setSquadTeams]       = useState<SquadTeam[]>([]);
  const [draftLoading, setDraftLoading]   = useState(false);
  const [addModal, setAddModal]           = useState(false);
  const [societyMembers, setSocietyMembers] = useState<DraftMember[]>([]);
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());
  const [addTeam, setAddTeam]             = useState<string | null>(null);
  const [addStatus, setAddStatus]         = useState<'enrolled' | 'invited'>('enrolled');
  const [playersPerTeam, setPlayersPerTeam] = useState('4');
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [teamRosterCache, setTeamRosterCache] = useState<Record<string, DraftMember[]>>({});
  const [rosterLoadingTeamId, setRosterLoadingTeamId] = useState<string | null>(null);
  const [teamPlayerBusy, setTeamPlayerBusy] = useState<string | null>(null);
  const [adding, setAdding]               = useState(false);
  const [finishing, setFinishing]         = useState(false);

  useEffect(() => {
    // Same course list Casual Round's picker uses — course_holes.course_name
    // is the real link key (day_format scoring reads course_holes by this
    // exact string), so picking from here instead of free-typing is what
    // keeps a tournament day's holes/par/stroke-index actually linked up.
    // hole_number+par per row also builds the side-games par-3/par-5 picker.
    supabase.from('course_holes').select('course_name, hole_number, par, green_lat, green_lng').then(({ data }) => {
      if (!data) return;
      const parMap: Record<string, number> = {};
      const gpsMap: Record<string, boolean> = {};
      const holesMap: Record<string, CourseHole[]> = {};
      for (const row of data as any[]) {
        parMap[row.course_name] = (parMap[row.course_name] ?? 0) + row.par;
        if (row.green_lat != null && row.green_lng != null) gpsMap[row.course_name] = true;
        (holesMap[row.course_name] ??= []).push({ hole_number: row.hole_number, par: row.par });
      }
      setCourses(Object.entries(parMap)
        .map(([name, par]) => ({ name, par, hasGps: !!gpsMap[name] }))
        .sort((a, b) => a.name.localeCompare(b.name)));
      setCourseHolesMap(holesMap);
    });
  }, []);

  useFocusEffect(useCallback(() => {
    setStep(0);
    setSelectedFormat(null);
    setName('');
    setYear(String(new Date().getFullYear() + 1));
    setDays([]);
    setPtsWin('1');
    setPtsHalf('0.5');
    setOpeningRounds('3');
    setBonusPoints('2');
    setIncludeInKronos(false);
    setDescription('');
    setStartDate('');
    setEndDate('');
    setNumTeams('2');
    setMaxHandicap('');
    setLogoUri(null);
    setCreating(false);
    setCompId(null);
    setCompPin(null);
    setCompPlayers([]);
    setFinishing(false);
    setPlayersPerTeam('4');
    setExpandedTeamId(null);
    setTeamRosterCache({});
  }, []));

  const formatDef = COMP_FORMATS.find(f => f.id === selectedFormat);

  function pickFormat(f: CompFormat) {
    if (!f.available) return;
    setSelectedFormat(f.id);
    setIncludeInKronos(f.id === 'team_matchplay' || f.id === 'titan_way');
    const builtDays: DayConfig[] = Array.from({ length: f.defaultDays }, (_, i) => {
      const isLastDay = i === f.defaultDays - 1;
      const isTour = f.id === 'team_matchplay' || f.id === 'titan_way';
      return {
        courseName: '',
        format: isLastDay && isTour ? 'singles' : f.defaultDayFormat,
        hcpPct: isLastDay && isTour ? 85 : f.defaultHcp,
        ldEnabled: false, ldHole: null,
        ntpEnabled: false, ntpHole: null,
      };
    });
    setDays(builtDays);
    if (f.id === 'titan_way') {
      setNumTeams('4');
      setPtsWin('3');
      setPtsHalf('1');
      setMaxHandicap('18');
    }
    if (!name || name === COMP_FORMATS.find(x => x.id !== f.id)?.label) {
      setName(`${f.label} ${new Date().getFullYear() + 1}`);
    }
  }

  function updateDay(i: number, patch: Partial<DayConfig>) {
    setDays(prev => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d));
  }

  function addDay() {
    if (days.length >= 10) return;
    setDays(prev => [...prev, {
      courseName: '',
      format: formatDef?.defaultDayFormat ?? 'four_bbb',
      hcpPct: formatDef?.defaultHcp ?? 75,
      ldEnabled: false, ldHole: null,
      ntpEnabled: false, ntpHole: null,
    }]);
  }

  function removeLastDay() {
    if (days.length <= 1) return;
    setDays(prev => prev.slice(0, -1));
  }

  function tournamentType(f: FormatId): 'ryder_cup' | 'titan_tour' | 'casual' {
    if (f === 'ryder_cup') return 'ryder_cup';
    if (f === 'team_matchplay' || f === 'titan_way') return 'titan_tour';
    return 'casual';
  }

  const isMatchplay = selectedFormat === 'ryder_cup' || selectedFormat === 'team_matchplay' || selectedFormat === 'titan_way';

  async function pickLogo() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow access to your photo library to add a tournament logo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images', allowsEditing: true, aspect: [1, 1], quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;
    setLogoUri(result.assets[0].uri);
  }

  // Creates the competition + day rows the first time step 2 → 3 happens,
  // then just advances on any later visit — going back to tweak Days and
  // forward again must not insert a second competition.
  async function createShellAndAdvance() {
    if (compId) { setStep(3); return; }
    if (!selectedFormat || !name.trim()) return;
    if (!societyId) { Alert.alert('Error', 'Society not found.'); return; }

    const numTeamsN = parseInt(numTeams, 10) || 0;
    if (isMatchplay && numTeamsN % 2 !== 0) {
      Alert.alert('Number of teams must be even', 'Titan Tour and Ryder Cup formats need an even number of teams to pair up.');
      return;
    }

    // UK-style free-text entry (DD-MM-YYYY) — converted to the ISO shape
    // Postgres DATE columns need right before the insert below.
    const dateRe = /^\d{2}-\d{2}-\d{4}$/;
    if (startDate.trim() && !dateRe.test(startDate.trim())) {
      Alert.alert('Invalid start date', 'Enter the start date as DD-MM-YYYY, e.g. 06-08-2028.');
      return;
    }
    if (endDate.trim() && !dateRe.test(endDate.trim())) {
      Alert.alert('Invalid end date', 'Enter the end date as DD-MM-YYYY, e.g. 10-08-2028.');
      return;
    }

    setCreating(true);

    const winPts  = parseFloat(ptsWin)  || 1;
    const halfPts = parseFloat(ptsHalf) || 0.5;
    const openingRoundsN = parseInt(openingRounds, 10) || 0;
    const bonusPointsN   = parseFloat(bonusPoints) || 0;
    const maxHandicapN   = maxHandicap.trim() ? parseFloat(maxHandicap) : null;

    const settings = {
      format_type: selectedFormat,
      num_days: days.length,
      num_teams: isMatchplay ? numTeamsN : null,
      day_configs: days.map(d => ({ format: d.format, hcp_pct: d.hcpPct })),
      voice_enabled: voiceEnabled,
      track_stats_enabled: statsEnabled,
    };

    // A collision makes verifyPin's .single() lookup fail as "Wrong PIN" for
    // whichever tournament loses the race — worth a few retries rather than
    // trusting a single random draw not to repeat an existing active PIN.
    let pin = String(1000 + Math.floor(Math.random() * 9000));
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: existing } = await supabase.from('competitions').select('id').eq('pin', pin).limit(1).maybeSingle();
      if (!existing) break;
      pin = String(1000 + Math.floor(Math.random() * 9000));
    }

    const { data: comp, error: compErr } = await supabase
      .from('competitions')
      .insert({
        society_id:      societyId,
        name:            name.trim(),
        year:            parseInt(year, 10) || new Date().getFullYear() + 1,
        format:          selectedFormat,
        tournament_type: tournamentType(selectedFormat),
        pts_win:         isMatchplay ? winPts  : 1,
        pts_half:        isMatchplay ? halfPts : 0.5,
        opening_rounds:  isMatchplay ? openingRoundsN : 0,
        bonus_points:    isMatchplay ? bonusPointsN   : 0,
        description:     description.trim() || null,
        start_date:      startDate.trim() ? ukDateToIso(startDate.trim()) : null,
        end_date:        endDate.trim()   ? ukDateToIso(endDate.trim())   : null,
        max_handicap:    maxHandicapN,
        status:          'draft',
        settings,
        include_in_kronos: includeInKronos,
        pin,
      })
      .select()
      .single();

    if (compErr || !comp) {
      setCreating(false);
      Alert.alert('Error', compErr?.message ?? 'Could not create competition');
      return;
    }

    if (logoUri) {
      try {
        const logoUrl = await uploadImage(logoUri, 'society-assets', `${societyId}/tournaments/${comp.id}.jpg`);
        await supabase.from('competitions').update({ logo_url: logoUrl }).eq('id', comp.id);
      } catch (e: any) {
        Alert.alert('Logo upload failed', e?.message ?? 'The tournament was created, but the logo couldn\'t be uploaded. You can retry later.');
      }
    }

    const dayRows = days.map((d, i) => ({
      competition_id: comp.id,
      day_number:     i + 1,
      course_name:    d.courseName.trim() || null,
      day_format:     d.format,
      hcp_pct:        d.hcpPct,
      ld_hole:        d.ldEnabled  ? d.ldHole  : null,
      ntp_hole:       d.ntpEnabled ? d.ntpHole : null,
    }));

    const { error: daysErr } = await supabase.from('competition_days').insert(dayRows);
    setCreating(false);

    if (daysErr) {
      Alert.alert('Warning', 'Created but days failed: ' + daysErr.message);
      return;
    }

    setCompId(comp.id);
    setCompPin(pin);
    if (societyId) {
      supabase.from('teams').select('id,name,accent_color,logo_url').eq('society_id', societyId).order('sort_order')
        .then(({ data }) => setSquadTeams((data as any[]) ?? []));
    }
    setStep(3);
  }

  const loadDraft = useCallback(async () => {
    if (!compId) return;
    setDraftLoading(true);
    const { data } = await supabase
      .from('competition_players')
      .select('id,player_id,team_id,handicap_index,is_captain,status,players(display_name)')
      .eq('competition_id', compId);
    setCompPlayers(((data ?? []) as any[]).map(cp => ({
      id: cp.id, player_id: cp.player_id, team_id: cp.team_id,
      handicap_index: cp.handicap_index,
      display_name: cp.players?.display_name ?? '—',
      is_captain: cp.is_captain ?? false,
      status: cp.status ?? 'enrolled',
    })));
    setDraftLoading(false);
  }, [compId]);

  useEffect(() => { if (compId) loadDraft(); }, [compId, loadDraft]);

  async function openAddPlayersModal() {
    if (!societyId) return;
    setSelectedToAdd(new Set());
    setAddTeam(squadTeams[0]?.id ?? null);
    setAddStatus('enrolled');
    const { data } = await supabase
      .from('society_members')
      .select('player_id, team_id, players(display_name, handicap_index, avatar_url)')
      .eq('society_id', societyId);
    const enrolled = new Set(compPlayers.map(cp => cp.player_id));
    setSocietyMembers(((data ?? []) as any[])
      .filter(m => !enrolled.has(m.player_id))
      .map(m => ({
        player_id: m.player_id,
        display_name: m.players?.display_name ?? '—',
        handicap_index: m.players?.handicap_index ?? null,
        avatar_url: m.players?.avatar_url ?? null,
        team_id: m.team_id ?? null,
      })));
    setAddModal(true);
  }

  async function confirmAddPlayers() {
    if (selectedToAdd.size === 0 || !compId) { setAddModal(false); return; }
    setAdding(true);
    const members = societyMembers.filter(m => selectedToAdd.has(m.player_id));
    const maxHcp = maxHandicap.trim() ? parseFloat(maxHandicap) : null;
    const rows = members.map(m => ({
      competition_id: compId,
      player_id: m.player_id,
      // Prebuilt team rosters carry straight in — a player's permanent team
      // wins over the bulk "add to team" picker below.
      team_id: isMatchplay ? (m.team_id ?? addTeam) : null,
      handicap_index: (maxHcp != null && m.handicap_index != null)
        ? Math.min(m.handicap_index, maxHcp)
        : m.handicap_index,
      status: addStatus,
    }));
    const { error } = await supabase.from('competition_players').insert(rows);
    setAdding(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setAddModal(false);
    await loadDraft();
  }

  const numTeamsN = parseInt(numTeams, 10) || 0;
  const playersPerTeamN = parseInt(playersPerTeam, 10) || 1;
  const pickedTeamIds = new Set(compPlayers.map(cp => cp.team_id).filter(Boolean) as string[]);

  // Team drafting is a different shape to the flat player pool singles
  // uses — everything (badges, that team's roster, who's already in)
  // lives on this one screen, no separate picker screens.
  async function toggleExpandTeam(team: SquadTeam) {
    if (expandedTeamId === team.id) { setExpandedTeamId(null); return; }
    if (!teamRosterCache[team.id] && societyId) {
      setRosterLoadingTeamId(team.id);
      const { data } = await supabase
        .from('society_members')
        .select('player_id, players(display_name, handicap_index, avatar_url)')
        .eq('society_id', societyId).eq('team_id', team.id);
      const roster: DraftMember[] = ((data ?? []) as any[]).map(m => ({
        player_id: m.player_id,
        display_name: m.players?.display_name ?? '—',
        handicap_index: m.players?.handicap_index ?? null,
        avatar_url: m.players?.avatar_url ?? null,
        team_id: team.id,
      })).sort((a, b) => a.display_name.localeCompare(b.display_name));
      setTeamRosterCache(prev => ({ ...prev, [team.id]: roster }));
      setRosterLoadingTeamId(null);
    }
    setExpandedTeamId(team.id);
  }

  async function togglePlayerInTeam(teamId: string, member: DraftMember) {
    if (!compId) return;
    const existing = compPlayers.find(cp => cp.player_id === member.player_id && cp.team_id === teamId);
    setTeamPlayerBusy(member.player_id);
    if (existing) {
      await supabase.from('competition_players').delete().eq('id', existing.id);
    } else {
      const currentCount = compPlayers.filter(cp => cp.team_id === teamId).length;
      if (currentCount >= playersPerTeamN) { setTeamPlayerBusy(null); return; }
      const maxHcp = maxHandicap.trim() ? parseFloat(maxHandicap) : null;
      await supabase.from('competition_players').insert({
        competition_id: compId,
        player_id: member.player_id,
        team_id: teamId,
        handicap_index: (maxHcp != null && member.handicap_index != null) ? Math.min(member.handicap_index, maxHcp) : member.handicap_index,
        status: 'enrolled',
      });
    }
    await loadDraft();
    setTeamPlayerBusy(null);
  }

  function removeDraftPlayer(cp: DraftPlayer) {
    Alert.alert('Remove player?', cp.display_name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        await supabase.from('competition_players').delete().eq('id', cp.id);
        await loadDraft();
      }},
    ]);
  }

  async function toggleDraftStatus(cp: DraftPlayer) {
    const next = cp.status === 'invited' ? 'enrolled' : 'invited';
    await supabase.from('competition_players').update({ status: next }).eq('id', cp.id);
    await loadDraft();
  }

  async function toggleDraftCaptain(cp: DraftPlayer) {
    if (!cp.team_id || !compId) return;
    if (cp.is_captain) {
      await supabase.from('competition_players').update({ is_captain: false }).eq('id', cp.id);
    } else {
      await supabase.from('competition_players').update({ is_captain: false }).eq('competition_id', compId).eq('team_id', cp.team_id);
      await supabase.from('competition_players').update({ is_captain: true }).eq('id', cp.id);
    }
    await loadDraft();
  }

  // The draw itself (pairings/matches) and the actual go-live flip happen
  // in Live Tournaments, not here — squad changes right up to the last
  // minute (drop-outs) are safer handled closer to tee-off, not baked in
  // at build time.
  async function finishDraft() {
    if (!compId || !compPin) return;
    if (selectedFormat === 'titan_way') {
      const enrolledCount = compPlayers.filter(cp => cp.status !== 'declined').length;
      if (numTeamsN < 4) { Alert.alert('Not enough teams', 'Titan Way needs at least 4 teams.'); return; }
      if (enrolledCount < 16) { Alert.alert('Not enough players', `Titan Way needs at least 16 players — currently ${enrolledCount}.`); return; }
    }
    setFinishing(true);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: me } = user
      ? await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle()
      : { data: null };

    await supabase.from('competitions').update({ status: 'active' }).eq('id', compId);

    if (me) {
      const pinFormatted = `${compPin.slice(0, 3)} ${compPin.slice(3)}`;
      const rows = compPlayers
        // Skip anyone already declined, and skip the admin's own row if
        // they're also a player — direct_messages rejects sender==recipient
        // and would abort the whole batch insert otherwise.
        .filter(cp => cp.status !== 'declined' && cp.player_id !== me.id)
        .map(cp => cp.status === 'invited'
          ? {
              sender_id: me.id, recipient_id: cp.player_id,
              content: `You've been invited to join ${name.trim()}. Code: ${pinFormatted}`,
              message_type: 'tournament_invite', competition_id: compId,
            }
          : {
              sender_id: me.id, recipient_id: cp.player_id,
              content: `You've been enrolled in ${name.trim()}! Join with code ${pinFormatted} in the Tour tab.`,
            });
      if (rows.length) await supabase.from('direct_messages').insert(rows);
    }

    setFinishing(false);
    router.replace('/(app)/admin/hub-tournament' as any);
  }

  function next() { setStep(s => Math.min(s + 1, 3)); }
  function back() {
    if (step === 0) goBack(router, '/(app)/admin/hub-tournament');
    else setStep(s => s - 1);
  }

  const canNext = [
    selectedFormat !== null,
    name.trim().length >= 2,
    true,
  ][step] ?? true;

  if (!fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />

      {/* Header — three-column */}
      <View style={styles.header}>
        <TouchableOpacity onPress={back} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.backText}>{step === 0 ? '✕ Cancel' : '‹ Back'}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Image source={titanLogo} style={styles.logo} resizeMode="contain" />
          <Text style={styles.headerTitle}>BUILD TOURNAMENT</Text>
          <Text style={styles.headerSub}>step {step + 1} of {STEPS.length}</Text>
        </View>
        {/* Step dots */}
        <View style={styles.stepDots}>
          {STEPS.map((_, i) => (
            <View key={i} style={[styles.dot, step >= i && styles.dotOn]} />
          ))}
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Step 0: Format */}
        {step === 0 && (
          <View>
            <Text style={styles.stepTitle}>Choose Format</Text>
            <Text style={styles.stepSub}>Pick the competition type. You can mix formats on different days.</Text>
            {COMP_FORMATS.map(f => (
              <TouchableOpacity
                key={f.id}
                style={[
                  styles.formatCard,
                  selectedFormat === f.id && styles.formatCardOn,
                  !f.available && styles.formatCardOff,
                ]}
                onPress={() => pickFormat(f)}
                activeOpacity={f.available ? 0.75 : 1}
              >
                <View style={styles.formatRow}>
                  <Text style={[styles.formatLabel, !f.available && { color: '#fff' }]}>
                    {f.label}
                  </Text>
                  {!f.available && (
                    <Text style={styles.comingSoon}>COMING SOON</Text>
                  )}
                  {selectedFormat === f.id && (
                    <Text style={styles.tick}>✓</Text>
                  )}
                </View>
                <Text style={[styles.formatSub, !f.available && { color: '#444' }]}>
                  {f.sub}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Step 1: Details */}
        {step === 1 && (
          <View>
            <Text style={styles.stepTitle}>Competition Details</Text>
            <Text style={styles.stepSub}>Name it and set how many rounds you want to play.</Text>

            <Text style={styles.fieldLabel}>NAME</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Titan Tour 2028"
              placeholderTextColor="#444"
              autoCapitalize="words"
            />

            <Text style={styles.fieldLabel}>YEAR</Text>
            <TextInput
              style={styles.input}
              value={year}
              onChangeText={setYear}
              placeholder="2028"
              placeholderTextColor="#444"
              keyboardType="number-pad"
              maxLength={4}
            />

            <Text style={styles.fieldLabel}>LOGO (OPTIONAL)</Text>
            <TouchableOpacity style={styles.logoPicker} onPress={pickLogo} activeOpacity={0.8}>
              {logoUri
                ? <Image source={{ uri: logoUri }} style={styles.logoPreview} />
                : <Text style={styles.logoPickerText}>+ Add tournament logo</Text>
              }
            </TouchableOpacity>

            <Text style={styles.fieldLabel}>DESCRIPTION (OPTIONAL)</Text>
            <Text style={styles.stepSub}>Shown with the logo on the Titan Newsreel results page once the tournament's complete.</Text>
            <TextInput
              style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
              value={description}
              onChangeText={setDescription}
              placeholder="What's this tournament about?"
              placeholderTextColor="#444"
              multiline
            />

            <Text style={styles.fieldLabel}>START DATE (OPTIONAL)</Text>
            <TouchableOpacity style={styles.input} onPress={() => setShowStartPicker(true)} activeOpacity={0.8}>
              <Text style={{ fontFamily: FF, fontSize: 15, color: startDate ? '#fff' : '#444' }}>
                {startDate || 'DD-MM-YYYY'}
              </Text>
            </TouchableOpacity>
            {showStartPicker && (
              <DateTimePicker
                value={ukDateToDate(startDate)}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={(_event, selected) => {
                  setShowStartPicker(false);
                  if (selected) setStartDate(dateToUk(selected));
                }}
              />
            )}

            <Text style={styles.fieldLabel}>END DATE (OPTIONAL)</Text>
            <TouchableOpacity style={styles.input} onPress={() => setShowEndPicker(true)} activeOpacity={0.8}>
              <Text style={{ fontFamily: FF, fontSize: 15, color: endDate ? '#fff' : '#444' }}>
                {endDate || 'DD-MM-YYYY'}
              </Text>
            </TouchableOpacity>
            {showEndPicker && (
              <DateTimePicker
                value={ukDateToDate(endDate)}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={(_event, selected) => {
                  setShowEndPicker(false);
                  if (selected) setEndDate(dateToUk(selected));
                }}
              />
            )}

            <Text style={styles.fieldLabel}>NUMBER OF ROUNDS</Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={[styles.stepperBtn, days.length <= 1 && styles.stepperBtnOff]}
                onPress={removeLastDay}
                activeOpacity={0.7}
              >
                <Text style={styles.stepperBtnText}>–</Text>
              </TouchableOpacity>
              <Text style={styles.stepperValue}>{days.length} {days.length === 1 ? 'round' : 'rounds'}</Text>
              <TouchableOpacity
                style={[styles.stepperBtn, days.length >= 10 && styles.stepperBtnOff]}
                onPress={addDay}
                activeOpacity={0.7}
              >
                <Text style={styles.stepperBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            {isMatchplay && (
              <>
                <Text style={styles.fieldLabel}>NUMBER OF TEAMS</Text>
                <Text style={styles.stepSub}>Must be even so teams can pair up.</Text>
                <View style={styles.stepper}>
                  <TouchableOpacity
                    style={[styles.stepperBtn, (parseInt(numTeams, 10) || 2) <= 2 && styles.stepperBtnOff]}
                    onPress={() => setNumTeams(String(Math.max(2, (parseInt(numTeams, 10) || 2) - 2)))}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.stepperBtnText}>–</Text>
                  </TouchableOpacity>
                  <Text style={styles.stepperValue}>{numTeams} teams</Text>
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    onPress={() => setNumTeams(String((parseInt(numTeams, 10) || 2) + 2))}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.stepperBtnText}>+</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>MAX HANDICAP (OPTIONAL)</Text>
                <Text style={styles.stepSub}>Players above this play from the maximum instead of their full handicap.</Text>
                <TextInput
                  style={styles.input}
                  value={maxHandicap}
                  onChangeText={setMaxHandicap}
                  placeholder="e.g. 18"
                  placeholderTextColor="#444"
                  keyboardType="decimal-pad"
                />

                <Text style={styles.fieldLabel}>POINTS — MATCH WIN</Text>
                <TextInput
                  style={styles.input}
                  value={ptsWin}
                  onChangeText={setPtsWin}
                  placeholder="1"
                  placeholderTextColor="#444"
                  keyboardType="decimal-pad"
                />
                <Text style={styles.fieldLabel}>POINTS — HALF</Text>
                <TextInput
                  style={styles.input}
                  value={ptsHalf}
                  onChangeText={setPtsHalf}
                  placeholder="0.5"
                  placeholderTextColor="#444"
                  keyboardType="decimal-pad"
                />
                <Text style={styles.fieldLabel}>OPENING ROUNDS</Text>
                <Text style={styles.stepSub}>Each team's captain plays with a different teammate on each of these opening days, before pairings are drawn freely.</Text>
                <TextInput
                  style={styles.input}
                  value={openingRounds}
                  onChangeText={setOpeningRounds}
                  placeholder="3"
                  placeholderTextColor="#444"
                  keyboardType="number-pad"
                />
                <Text style={styles.fieldLabel}>SWEEP BONUS</Text>
                <Text style={styles.stepSub}>Extra points awarded to a team that wins every singles match on a day.</Text>
                <TextInput
                  style={styles.input}
                  value={bonusPoints}
                  onChangeText={setBonusPoints}
                  placeholder="2"
                  placeholderTextColor="#444"
                  keyboardType="decimal-pad"
                />
              </>
            )}

            <Text style={styles.fieldLabel}>KRONOS TROPHY</Text>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>Include in Kronos Trophy</Text>
                <Text style={styles.toggleSub}>Individual Stableford scores count toward this tournament's Kronos standings</Text>
              </View>
              <Switch
                value={includeInKronos}
                onValueChange={setIncludeInKronos}
                trackColor={{ false: '#1c1c1c', true: `${GOLD}66` }}
                thumbColor={includeInKronos ? GOLD : '#555'}
              />
            </View>

            <Text style={styles.fieldLabel}>CHIP & BIRDIE</Text>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>Voice commentary</Text>
                <Text style={styles.toggleSub}>Same Chip & Birdie voice calls already used in Casual Golf</Text>
              </View>
              <Switch
                value={voiceEnabled}
                onValueChange={setVoiceEnabled}
                trackColor={{ false: '#1c1c1c', true: `${GOLD}66` }}
                thumbColor={voiceEnabled ? GOLD : '#555'}
              />
            </View>

            <Text style={styles.fieldLabel}>TRACK STATS</Text>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>Fairways, putts & more</Text>
                <Text style={styles.toggleSub}>Players can log extra stats while scoring, same as Casual Golf</Text>
              </View>
              <Switch
                value={statsEnabled}
                onValueChange={setStatsEnabled}
                trackColor={{ false: '#1c1c1c', true: `${GOLD}66` }}
                thumbColor={statsEnabled ? GOLD : '#555'}
              />
            </View>
          </View>
        )}

        {/* Step 2: Day Setup */}
        {step === 2 && (
          <View>
            <Text style={styles.stepTitle}>Round Setup</Text>
            <Text style={styles.stepSub}>Set the course and format for each round. Rick can mix it up every year.</Text>
            {days.map((day, i) => (
              <View key={i} style={styles.dayCard}>
                <Text style={styles.dayLabel}>ROUND {i + 1}</Text>

                <Text style={styles.fieldLabel}>COURSE</Text>
                <TouchableOpacity
                  style={styles.courseInput}
                  onPress={() => setCourseSheetDay(i)}
                  activeOpacity={0.8}
                >
                  <Text style={day.courseName ? styles.courseInputText : styles.courseInputPlaceholder}>
                    {day.courseName || 'Select a course…'}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color="#666" />
                </TouchableOpacity>

                <Text style={styles.fieldLabel}>FORMAT</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', gap: 8, paddingRight: 16 }}>
                    {/* 4BBB is a pairs/team format — only offered when the
                        tournament itself is a team competition. */}
                    {DAY_FORMATS.filter(f => isMatchplay || (f.id !== 'four_bbb' && f.id !== 'four_bbb_stroke')).map(f => (
                      <TouchableOpacity
                        key={f.id}
                        style={[styles.chip, day.format === f.id && styles.chipOn]}
                        onPress={() => updateDay(i, { format: f.id })}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.chipText, day.format === f.id && styles.chipTextOn]}>
                          {f.label}
                        </Text>
                        <Text style={[styles.chipSub, day.format === f.id && { color: 'rgba(7,11,16,0.6)' }]}>
                          {f.sub}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>

                <Text style={styles.fieldLabel}>HANDICAP ALLOWANCE</Text>
                <View style={styles.hcpRow}>
                  {HCP_OPTIONS.map(h => (
                    <TouchableOpacity
                      key={h.pct}
                      style={[styles.hcpChip, day.hcpPct === h.pct && styles.hcpChipOn]}
                      onPress={() => updateDay(i, { hcpPct: h.pct })}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.hcpText, day.hcpPct === h.pct && styles.hcpTextOn]}>
                        {h.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Side games — same simple enable + pick-a-hole idea as
                    Casual Round, offered for every tournament format. */}
                <Text style={styles.fieldLabel}>SIDE GAMES (OPTIONAL)</Text>
                {(() => {
                  const holes = courseHolesMap[day.courseName] ?? [];
                  const par5s = holes.filter(h => h.par === 5);
                  const par3s = holes.filter(h => h.par === 3);
                  return (
                    <>
                      <View style={styles.toggleRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.toggleLabel}>Longest Drive</Text>
                          <Text style={styles.toggleSub}>Pick a par 5 for this day</Text>
                        </View>
                        <Switch
                          value={day.ldEnabled}
                          onValueChange={v => updateDay(i, { ldEnabled: v, ldHole: v ? (day.ldHole ?? par5s[0]?.hole_number ?? null) : day.ldHole })}
                          trackColor={{ false: '#1c1c1c', true: `${GOLD}66` }}
                          thumbColor={day.ldEnabled ? GOLD : '#555'}
                        />
                      </View>
                      {day.ldEnabled && (
                        <View style={[styles.hcpRow, { marginBottom: 8 }]}>
                          {par5s.length === 0
                            ? <Text style={styles.reviewNote}>Pick a course above to choose a par 5.</Text>
                            : par5s.map(h => (
                              <TouchableOpacity
                                key={h.hole_number}
                                style={[styles.hcpChip, day.ldHole === h.hole_number && styles.hcpChipOn]}
                                onPress={() => updateDay(i, { ldHole: h.hole_number })}
                                activeOpacity={0.7}
                              >
                                <Text style={[styles.hcpText, day.ldHole === h.hole_number && styles.hcpTextOn]}>Hole {h.hole_number}</Text>
                              </TouchableOpacity>
                            ))
                          }
                        </View>
                      )}

                      <View style={styles.toggleRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.toggleLabel}>Nearest the Pin</Text>
                          <Text style={styles.toggleSub}>Pick a par 3 for this day</Text>
                        </View>
                        <Switch
                          value={day.ntpEnabled}
                          onValueChange={v => updateDay(i, { ntpEnabled: v, ntpHole: v ? (day.ntpHole ?? par3s[0]?.hole_number ?? null) : day.ntpHole })}
                          trackColor={{ false: '#1c1c1c', true: `${GOLD}66` }}
                          thumbColor={day.ntpEnabled ? GOLD : '#555'}
                        />
                      </View>
                      {day.ntpEnabled && (
                        <View style={styles.hcpRow}>
                          {par3s.length === 0
                            ? <Text style={styles.reviewNote}>Pick a course above to choose a par 3.</Text>
                            : par3s.map(h => (
                              <TouchableOpacity
                                key={h.hole_number}
                                style={[styles.hcpChip, day.ntpHole === h.hole_number && styles.hcpChipOn]}
                                onPress={() => updateDay(i, { ntpHole: h.hole_number })}
                                activeOpacity={0.7}
                              >
                                <Text style={[styles.hcpText, day.ntpHole === h.hole_number && styles.hcpTextOn]}>Hole {h.hole_number}</Text>
                              </TouchableOpacity>
                            ))
                          }
                        </View>
                      )}
                    </>
                  );
                })()}
              </View>
            ))}
          </View>
        )}

        {/* Step 3: Draft — player selection lives in the same build now,
            no more hopping to a separate screen. The actual draw/go-live
            happens later in Live Tournaments. */}
        {step === 3 && (
          <View>
            <Text style={styles.stepTitle}>Draft Players</Text>
            <Text style={styles.stepSub}>
              {compPin ? `Tournament created — PIN ${compPin}. ` : ''}
              Add everyone playing{isMatchplay ? ' and assign teams' : ''}. You can still change this later from Live Tournaments.
            </Text>

            {isMatchplay ? (
              <>
                <Text style={styles.fieldLabel}>PLAYERS PER TEAM</Text>
                <View style={styles.stepper}>
                  <TouchableOpacity
                    style={[styles.stepperBtn, playersPerTeamN <= 1 && styles.stepperBtnOff]}
                    onPress={() => setPlayersPerTeam(String(Math.max(1, playersPerTeamN - 1)))}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.stepperBtnText}>–</Text>
                  </TouchableOpacity>
                  <Text style={styles.stepperValue}>{playersPerTeamN} players</Text>
                  <TouchableOpacity style={styles.stepperBtn} onPress={() => setPlayersPerTeam(String(playersPerTeamN + 1))} activeOpacity={0.7}>
                    <Text style={styles.stepperBtnText}>+</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>{pickedTeamIds.size} OF {numTeamsN} TEAMS ADDED — TAP A CREST</Text>
                <View style={styles.badgeRow}>
                  {squadTeams.map(t => {
                    const hasPlayers = pickedTeamIds.has(t.id);
                    const isOpen = expandedTeamId === t.id;
                    const logo = getSquadTeamLogo(t);
                    return (
                      <TouchableOpacity
                        key={t.id}
                        style={styles.badgeItem}
                        onPress={() => toggleExpandTeam(t)}
                        activeOpacity={0.8}
                      >
                        <View style={[
                          styles.badgeCircle,
                          { borderColor: (hasPlayers || isOpen) ? t.accent_color : '#333' },
                          !(hasPlayers || isOpen) && styles.badgeCircleDark,
                        ]}>
                          {logo
                            ? <Image source={logo} style={styles.badgeLogo} resizeMode="contain" />
                            : <Text style={[styles.badgeInitial, { color: t.accent_color }]}>{t.name[0]}</Text>
                          }
                        </View>
                        <Text style={[styles.badgeName, (hasPlayers || isOpen) && { color: t.accent_color }]} numberOfLines={1}>{t.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {expandedTeamId && (() => {
                  const team = squadTeams.find(t => t.id === expandedTeamId);
                  if (!team) return null;
                  const roster = teamRosterCache[team.id] ?? [];
                  const filledCount = compPlayers.filter(cp => cp.team_id === team.id).length;
                  return (
                    <View style={styles.rosterPanel}>
                      <Text style={styles.rosterPanelTitle}>{team.name} roster — {filledCount} / {playersPerTeamN} picked</Text>
                      {rosterLoadingTeamId === team.id ? (
                        <ActivityIndicator color={GOLD} style={{ marginVertical: 16 }} />
                      ) : roster.length === 0 ? (
                        <Text style={styles.emptyHint}>No players in this squad yet — add them in Teams/Players first.</Text>
                      ) : (
                        roster.map(m => {
                          const cp = compPlayers.find(p => p.player_id === m.player_id && p.team_id === team.id);
                          const selected = !!cp;
                          const full = filledCount >= playersPerTeamN && !selected;
                          const avatar = resolveAvatar(m.player_id, m.avatar_url);
                          return (
                            <View key={m.player_id} style={[styles.rosterPickRow, selected && styles.rosterPickRowOn, full && { opacity: 0.4 }]}>
                              {selected && (
                                <TouchableOpacity onPress={() => toggleDraftCaptain(cp!)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                                  <Ionicons name={cp!.is_captain ? 'star' : 'star-outline'} size={16} color={cp!.is_captain ? GOLD : '#555'} />
                                </TouchableOpacity>
                              )}
                              <TouchableOpacity
                                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                                onPress={() => togglePlayerInTeam(team.id, m)}
                                disabled={full || teamPlayerBusy === m.player_id}
                                activeOpacity={0.7}
                              >
                                {avatar
                                  ? <Image source={avatar} style={styles.rosterPickAvatar} />
                                  : <View style={[styles.rosterPickAvatar, styles.rosterPickAvatarFallback]}><Text style={styles.rosterPickInitial}>{m.display_name[0]}</Text></View>
                                }
                                <View style={{ flex: 1 }}>
                                  <Text style={[styles.rosterPickName, selected && { color: GOLD }]}>{m.display_name}{cp?.is_captain ? '  (C)' : ''}</Text>
                                  {m.handicap_index != null && <Text style={styles.draftPlayerHcp}>HCP {m.handicap_index}</Text>}
                                </View>
                                {teamPlayerBusy === m.player_id
                                  ? <ActivityIndicator size="small" color={GOLD} />
                                  : selected && <Ionicons name="checkmark-circle" size={20} color={GOLD} />
                                }
                              </TouchableOpacity>
                              {selected && (
                                <TouchableOpacity
                                  style={[styles.statusChip, cp!.status === 'invited' && styles.statusChipInvited]}
                                  onPress={() => toggleDraftStatus(cp!)}
                                  activeOpacity={0.7}
                                >
                                  <Text style={[styles.statusChipText, cp!.status === 'invited' && styles.statusChipTextInvited]}>
                                    {cp!.status === 'invited' ? 'Invited' : 'Enrolled'}
                                  </Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          );
                        })
                      )}
                    </View>
                  );
                })()}

                {draftLoading ? (
                  <ActivityIndicator color={GOLD} style={{ marginTop: 20 }} />
                ) : pickedTeamIds.size === 0 && !expandedTeamId ? (
                  <View style={styles.empty}>
                    <Text style={styles.emptyHint}>No players yet. Tap a crest above to draft from that squad.</Text>
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <View style={styles.sectionRow}>
                  <Text style={styles.fieldLabel}>{compPlayers.length} PLAYERS ENROLLED</Text>
                  <TouchableOpacity style={styles.addPlayersBtn} onPress={openAddPlayersModal} activeOpacity={0.8}>
                    <Text style={styles.addPlayersBtnText}>+ ADD</Text>
                  </TouchableOpacity>
                </View>

                {draftLoading ? (
                  <ActivityIndicator color={GOLD} style={{ marginTop: 20 }} />
                ) : compPlayers.length === 0 ? (
                  <View style={styles.empty}>
                    <Text style={styles.emptyHint}>No players yet. Tap + ADD to enrol players.</Text>
                  </View>
                ) : (
                  compPlayers.map(cp => (
                    <View key={cp.id} style={styles.draftPlayerRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.draftPlayerName}>{cp.display_name}</Text>
                        {cp.handicap_index != null && <Text style={styles.draftPlayerHcp}>HCP {cp.handicap_index}</Text>}
                      </View>
                      <TouchableOpacity
                        style={[styles.statusChip, cp.status === 'invited' && styles.statusChipInvited]}
                        onPress={() => toggleDraftStatus(cp)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.statusChipText, cp.status === 'invited' && styles.statusChipTextInvited]}>
                          {cp.status === 'invited' ? 'Invited' : 'Enrolled'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => removeDraftPlayer(cp)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="close-circle-outline" size={20} color="#555" />
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </>
            )}

            <TouchableOpacity
              style={[styles.createBtn, (finishing || compPlayers.length === 0) && { opacity: 0.6 }]}
              onPress={finishDraft}
              disabled={finishing || compPlayers.length === 0}
              activeOpacity={0.85}
            >
              {finishing
                ? <ActivityIndicator color="#000" />
                : <Text style={styles.createBtnText}>Finish & Go Live</Text>
              }
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>

      {step < 3 && (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.nextBtn, (!canNext || creating) && styles.nextBtnOff]}
            onPress={step === 2 ? createShellAndAdvance : next}
            disabled={!canNext || creating}
            activeOpacity={0.85}
          >
            {creating
              ? <ActivityIndicator color="#000" />
              : <Text style={styles.nextBtnText}>{step === 2 ? 'Add Players →' : 'Next →'}</Text>
            }
          </TouchableOpacity>
        </View>
      )}

      <CourseSheet
        visible={courseSheetDay !== null}
        courses={courses}
        selected={courseSheetDay !== null ? days[courseSheetDay]?.courseName ?? null : null}
        onSelect={name => { if (courseSheetDay !== null) updateDay(courseSheetDay, { courseName: name }); }}
        onClose={() => setCourseSheetDay(null)}
      />

      {/* Add Players modal — same picker draw.tsx used, ported in so the
          whole build lives in one place. */}
      <Modal visible={addModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAddModal(false)}>
        <View style={styles.addModal}>
          <View style={styles.addModalHeader}>
            <TouchableOpacity onPress={() => setAddModal(false)}>
              <Text style={styles.addModalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.addModalTitle}>ADD PLAYERS</Text>
            <TouchableOpacity onPress={confirmAddPlayers} disabled={adding}>
              {adding ? <ActivityIndicator color={GOLD} size="small" /> : <Text style={styles.addModalDone}>Done</Text>}
            </TouchableOpacity>
          </View>

          <View style={styles.addModalTeamRow}>
            <Text style={styles.addModalTeamLabel}>ADD AS</Text>
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
              <TouchableOpacity
                style={[styles.addAsChip, addStatus === 'enrolled' && styles.addAsChipOn]}
                onPress={() => setAddStatus('enrolled')}
                activeOpacity={0.8}
              >
                <Text style={[styles.addAsChipText, addStatus === 'enrolled' && styles.addAsChipTextOn]}>Enrolled</Text>
                <Text style={styles.addAsChipSub}>Definitely playing</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.addAsChip, addStatus === 'invited' && styles.addAsChipOn]}
                onPress={() => setAddStatus('invited')}
                activeOpacity={0.8}
              >
                <Text style={[styles.addAsChipText, addStatus === 'invited' && styles.addAsChipTextOn]}>Invited</Text>
                <Text style={styles.addAsChipSub}>Ask first, they can accept or decline</Text>
              </TouchableOpacity>
            </View>
          </View>

          {isMatchplay && (
            <View style={styles.addModalTeamRow}>
              <Text style={styles.addModalTeamLabel}>ASSIGN TO TEAM</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
                {squadTeams.map(t => (
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.teamChip, { borderColor: addTeam === t.id ? t.accent_color : '#333' }]}
                    onPress={() => setAddTeam(t.id)}
                  >
                    <Text style={[styles.teamChipText, { color: addTeam === t.id ? t.accent_color : '#888' }]}>{t.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          <FlatList
            data={societyMembers}
            keyExtractor={m => m.player_id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
            ListEmptyComponent={<Text style={[styles.emptyHint, { marginTop: 40 }]}>All society members already enrolled</Text>}
            renderItem={({ item }) => {
              const selected = selectedToAdd.has(item.player_id);
              return (
                <TouchableOpacity
                  style={[styles.memberRow, selected && styles.memberRowOn]}
                  onPress={() => setSelectedToAdd(prev => {
                    const next = new Set(prev);
                    if (next.has(item.player_id)) next.delete(item.player_id); else next.add(item.player_id);
                    return next;
                  })}
                  activeOpacity={0.7}
                >
                  <View>
                    <Text style={[styles.memberName, selected && { color: GOLD }]}>{item.display_name}</Text>
                    {item.handicap_index != null && <Text style={styles.memberHcp}>HCP {item.handicap_index}</Text>}
                  </View>
                  {selected && <Ionicons name="checkmark-circle" size={20} color={GOLD} />}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </Modal>

    </KeyboardAvoidingView>
  );
}

function CourseSheet({
  visible, courses, selected, onSelect, onClose,
}: {
  visible: boolean; courses: CourseItem[]; selected: string | null;
  onSelect: (name: string) => void; onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = courses.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={sheetStyles.overlay} activeOpacity={1} onPress={onClose} />
      <View style={sheetStyles.sheet}>
        <View style={sheetStyles.handle} />
        <Text style={sheetStyles.sheetTitle}>Select Course</Text>
        <TextInput
          style={sheetStyles.searchInput}
          placeholder="Search courses…"
          placeholderTextColor="#555"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        <FlatList
          data={filtered}
          keyExtractor={c => c.name}
          style={{ flexGrow: 0, maxHeight: 360 }}
          ListEmptyComponent={<Text style={sheetStyles.emptyText}>No courses in the database yet — add one in Admin → Courses first.</Text>}
          renderItem={({ item }) => {
            const on = item.name === selected;
            return (
              <TouchableOpacity style={sheetStyles.sheetRow} onPress={() => { onSelect(item.name); onClose(); setSearch(''); }} activeOpacity={0.7}>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[sheetStyles.sheetOpt, on && { color: GOLD }]} numberOfLines={1}>{item.name}</Text>
                  {item.hasGps && <Ionicons name="location" size={13} color={GOLD} />}
                </View>
                <Text style={sheetStyles.courseParLabel}>Par {item.par}</Text>
                {on && <Ionicons name="checkmark" size={16} color={GOLD} style={{ marginLeft: 6 }} />}
              </TouchableOpacity>
            );
          }}
        />
        <TouchableOpacity style={sheetStyles.cancelBtn} onPress={() => { onClose(); setSearch(''); }} activeOpacity={0.7}>
          <Text style={sheetStyles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  header: {
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  backText: { fontSize: 13, fontFamily: FFB, color: GOLD, width: 80 },
  headerCenter: { alignItems: 'center', gap: 2 },
  logo: { width: 28, height: 28, marginBottom: 2 },
  headerTitle: { fontSize: 12, fontFamily: FFB, color: '#fff', letterSpacing: 1.5 },
  headerSub: { fontSize: 9, fontFamily: FFB, color: '#fff' },
  stepDots: { flexDirection: 'row', gap: 6, width: 80, justifyContent: 'flex-end' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1c1c1c' },
  dotOn: { backgroundColor: GOLD },

  scroll: { padding: 20, paddingBottom: 48 },
  stepTitle: { fontSize: 20, fontFamily: FFB, color: '#fff', marginBottom: 6 },
  stepSub: { fontSize: 13, fontFamily: FFB, color: '#fff', marginBottom: 20, lineHeight: 20 },

  // Format cards
  formatCard: {
    backgroundColor: '#111', borderRadius: 14, borderWidth: 1,
    borderColor: '#1c1c1c', padding: 16, marginBottom: 10,
  },
  formatCardOn: { borderColor: GOLD, backgroundColor: '#1a1500' },
  formatCardOff: { opacity: 0.4 },
  formatRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  formatLabel: { flex: 1, fontSize: 15, fontFamily: FFB, color: '#fff' },
  formatSub: { fontSize: 13, fontFamily: FFB, color: '#fff', lineHeight: 18 },
  comingSoon: { fontSize: 11, fontFamily: FFB, color: '#fff', letterSpacing: 1 },
  tick: { fontSize: 15, fontFamily: FFB, color: GOLD },

  // Fields
  fieldLabel: {
    fontSize: 11, fontFamily: FFB, color: '#fff',
    letterSpacing: 1.5, marginBottom: 6, marginTop: 16,
  },
  input: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 15, fontFamily: FFB, color: '#fff',
  },
  courseInput: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
  },
  courseInputText:        { fontSize: 15, fontFamily: FFB, color: '#fff' },
  courseInputPlaceholder: { fontSize: 15, fontFamily: FFB, color: '#444' },

  // Stepper
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 6 },
  stepperBtn: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: '#111',
    borderWidth: 1, borderColor: '#1c1c1c', alignItems: 'center', justifyContent: 'center',
  },
  stepperBtnOff: { opacity: 0.35 },
  stepperBtnText: { fontSize: 20, fontFamily: FFB, color: GOLD },
  stepperValue: { fontSize: 17, fontFamily: FFB, color: '#fff', minWidth: 88, textAlign: 'center' },

  logoPicker: {
    height: 90, borderRadius: 12, borderWidth: 1, borderColor: '#1c1c1c', borderStyle: 'dashed',
    backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  logoPreview:    { width: '100%', height: '100%' },
  logoPickerText: { fontFamily: FFB, fontSize: 13, color: GOLD },

  // Day cards
  dayCard: {
    backgroundColor: '#111', borderRadius: 14, borderWidth: 1,
    borderColor: '#1c1c1c', padding: 16, marginBottom: 16,
  },
  dayLabel: { fontSize: 11, fontFamily: FFB, color: GOLD, letterSpacing: 2, marginBottom: 4 },

  // Format chips (horizontal scroll)
  chip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12,
    borderWidth: 1, borderColor: '#1c1c1c', backgroundColor: '#1a1a1a',
    alignItems: 'center', minWidth: 80,
  },
  chipOn: { backgroundColor: GOLD, borderColor: GOLD },
  chipText: { fontSize: 13, fontFamily: FFB, color: '#fff' },
  chipTextOn: { color: '#000' },
  chipSub: { fontSize: 10, fontFamily: FFB, color: '#fff', marginTop: 2 },

  // HCP chips
  hcpRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  hcpChip: {
    flex: 1, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: '#1c1c1c', backgroundColor: '#1a1a1a',
    alignItems: 'center',
  },
  hcpChipOn: { backgroundColor: `${GOLD}18`, borderColor: `${GOLD}55` },
  hcpText: { fontSize: 13, fontFamily: FFB, color: '#fff' },
  hcpTextOn: { color: GOLD },

  // Kronos toggle
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: '#111', borderRadius: 12, borderWidth: 1,
    borderColor: '#1c1c1c', padding: 16, marginTop: 6,
  },
  toggleLabel: { fontSize: 13, fontFamily: FFB, color: '#fff', marginBottom: 2 },
  toggleSub: { fontSize: 11, fontFamily: FFB, color: '#fff', lineHeight: 16 },

  reviewNote: { fontSize: 13, fontFamily: FFB, color: '#fff', lineHeight: 20, marginBottom: 20 },
  createBtn: {
    backgroundColor: GOLD, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 20,
  },
  createBtnText: { fontSize: 15, fontFamily: FFB, color: '#000', letterSpacing: 0.5 },

  // Draft step
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  addPlayersBtn: { backgroundColor: `${GOLD}18`, borderWidth: 1, borderColor: `${GOLD}55`, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  addPlayersBtnText: { fontSize: 12, fontFamily: FFB, color: GOLD },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyHint: { fontSize: 13, fontFamily: FFB, color: '#555', textAlign: 'center' },
  // Team badge row
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 16 },
  badgeItem: { alignItems: 'center', width: 68 },
  badgeCircle: {
    width: 56, height: 56, borderRadius: 28, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#111', marginBottom: 4,
  },
  badgeCircleDark: { opacity: 0.4 },
  badgeLogo: { width: 36, height: 36 },
  badgeInitial: { fontSize: 20, fontFamily: FFB },
  badgeName: { fontSize: 10, fontFamily: FFB, color: '#888', textAlign: 'center' },

  // Inline roster picker (expanded team)
  rosterPanel: { backgroundColor: '#0a0a0a', borderRadius: 12, borderWidth: 1, borderColor: GOLD + '44', padding: 12, marginBottom: 16 },
  rosterPanelTitle: { fontSize: 11, fontFamily: FFB, color: GOLD, letterSpacing: 0.5, marginBottom: 10 },
  rosterPickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 10, borderWidth: 1, borderColor: '#1c1c1c', backgroundColor: '#111',
    padding: 8, marginBottom: 6,
  },
  rosterPickRowOn: { borderColor: GOLD, backgroundColor: `${GOLD}0F` },
  rosterPickAvatar: { width: 32, height: 32, borderRadius: 16 },
  rosterPickAvatarFallback: { backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  rosterPickInitial: { fontSize: 13, fontFamily: FFB, color: '#fff' },
  rosterPickName: { fontSize: 13, fontFamily: FFB, color: '#fff' },
  draftPlayerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#111', borderRadius: 10, borderWidth: 1, borderColor: '#1c1c1c',
    padding: 10, marginBottom: 8,
  },
  draftPlayerName: { fontSize: 14, fontFamily: FFB, color: '#fff' },
  draftPlayerHcp: { fontSize: 11, fontFamily: FFB, color: '#666', marginTop: 1 },
  teamChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
  },
  teamChipText: { fontSize: 11, fontFamily: FFB },

  statusChip: {
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: 'rgba(74,222,128,0.1)', borderWidth: 1, borderColor: 'rgba(74,222,128,0.35)',
  },
  statusChipInvited: { backgroundColor: `${PURPLE}18`, borderColor: `${PURPLE}55` },
  statusChipText: { fontSize: 10, fontFamily: FFB, color: GREEN, letterSpacing: 0.5 },
  statusChipTextInvited: { color: PURPLE },

  // Add Players modal
  addModal: { flex: 1, backgroundColor: '#000' },
  addModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  addModalCancel: { fontFamily: FFB, fontSize: 14, color: '#fff' },
  addModalTitle:  { fontFamily: FFB, fontSize: 14, color: '#fff', letterSpacing: 1 },
  addModalDone:   { fontFamily: FFB, fontSize: 14, color: GOLD },
  addModalTeamRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  addModalTeamLabel: { fontFamily: FFB, fontSize: 10, color: '#666', letterSpacing: 1.5, marginBottom: 10, marginLeft: 16 },
  addAsChip: {
    flex: 1, borderRadius: 12, borderWidth: 1, borderColor: '#1c1c1c',
    backgroundColor: '#111', padding: 12,
  },
  addAsChipOn: { borderColor: GOLD, backgroundColor: `${GOLD}12` },
  addAsChipText: { fontFamily: FFB, fontSize: 13, color: '#888' },
  addAsChipTextOn: { color: GOLD },
  addAsChipSub: { fontFamily: FFB, fontSize: 10, color: '#555', marginTop: 3, lineHeight: 14 },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#111',
  },
  memberRowOn: { backgroundColor: 'rgba(212,175,55,0.06)' },
  memberName: { fontSize: 15, fontFamily: FFB, color: '#fff' },
  memberHcp:  { fontSize: 11, fontFamily: FFB, color: '#666', marginTop: 2 },

  // Footer
  footer: { padding: 16, paddingBottom: 20, borderTopWidth: 1, borderTopColor: '#1c1c1c' },
  nextBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  nextBtnOff: { opacity: 0.35 },
  nextBtnText: { fontSize: 15, fontFamily: FFB, color: '#000' },
});

const sheetStyles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#111', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingBottom: 34, paddingHorizontal: 16,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: '#333',
    alignSelf: 'center', marginVertical: 12,
  },
  sheetTitle: { fontFamily: FFB, fontSize: 18, color: '#fff', marginBottom: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  sheetRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  sheetOpt:   { fontFamily: FFB, fontSize: 16, color: '#fff' },
  cancelBtn:  { marginTop: 12, alignItems: 'center', paddingVertical: 14 },
  cancelText: { fontFamily: FFB, fontSize: 16, color: '#fff' },
  courseParLabel: { fontFamily: FFB, fontSize: 12, color: '#fff' },
  searchInput: {
    backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1, borderColor: '#2a2a2a',
    paddingHorizontal: 12, paddingVertical: 10, color: '#fff',
    fontFamily: FFB, fontSize: 15, marginBottom: 8,
  },
  emptyText: { fontFamily: FFB, fontSize: 13, color: '#666', textAlign: 'center', paddingVertical: 24 },
});
