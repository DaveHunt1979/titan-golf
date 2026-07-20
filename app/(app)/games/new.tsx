import { useEffect, useState, useCallback, useMemo } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, Alert, TextInput, Modal, FlatList,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useSociety } from '../../../src/lib/useSociety';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { getPlayerAvatar } from '../../../src/lib/assets';
import { downloadMatchPack } from '../../../src/lib/offlinePack';

// ── Constants ─────────────────────────────────────────────────

type GameMode  = '4bbb' | 'singles' | 'stableford' | 'medal' | 'skins' | 'nassau' | 'scramble' | 'greensome' | 'foursomes' | 'modified_stableford' | 'par_bogey' | 'team_stableford' | 'best2from4' | 'best2from4_par3all';
type HolesMode = 'full18' | 'front9' | 'back9';

interface Player      { id: string; display_name: string; handicap_index: number; avatar_url?: string | null; }
interface CourseItem  { name: string; par: number; }
interface PlayerGroup { id: string; name: string; player_ids: string[]; }

const GREEN = '#22c55e';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';

const MODE_INFO: Record<GameMode, { label: string; sub: string; icon: keyof typeof Ionicons.glyphMap }> = {
  '4bbb':                { label: '4BBB',             sub: 'Best ball pairs',              icon: 'people-outline' },
  'singles':             { label: 'Singles',           sub: 'Head to head matchplay',       icon: 'person-outline' },
  'nassau':              { label: 'Nassau',            sub: 'Front / Back / Overall',       icon: 'cash-outline' },
  'foursomes':           { label: 'Foursomes',         sub: 'Alternate shot matchplay',     icon: 'swap-horizontal-outline' },
  'greensome':           { label: 'Greensomes',        sub: 'Best drive, then alternate',   icon: 'leaf-outline' },
  'stableford':          { label: 'Stableford',        sub: 'Points per hole',              icon: 'star-outline' },
  'medal':               { label: 'Medal',             sub: 'Stroke play',                  icon: 'medal-outline' },
  'modified_stableford': { label: 'Mod Stableford',    sub: 'Eagle +8 · Birdie +4',         icon: 'trophy-outline' },
  'par_bogey':           { label: 'Par / Bogey',       sub: 'Win, halve or lose vs par',    icon: 'stats-chart-outline' },
  'skins':               { label: 'Skins',             sub: 'Per-hole prize pot',           icon: 'diamond-outline' },
  'scramble':            { label: 'Scramble',          sub: 'Team best ball',               icon: 'golf-outline' },
  'team_stableford':      { label: 'Team Stableford',        sub: 'Best N scores count per team',       icon: 'people-circle-outline' },
  'best2from4':           { label: 'Best 2 From 4',          sub: 'Best 2 stableford scores per hole',  icon: 'people-outline' },
  'best2from4_par3all':   { label: 'Best 2 From 4 (Par 3s)', sub: 'All scores count on par 3 holes',    icon: 'golf-outline' },
};

function getModeSections(gold: string): { label: string; accent: string; modes: GameMode[] }[] {
  return [
    { label: 'MATCHPLAY',    accent: gold,      modes: ['4bbb', 'singles'] },
    { label: 'INDIVIDUAL',   accent: '#4ade80', modes: ['stableford', 'medal', 'modified_stableford', 'par_bogey'] },
    { label: 'TEAM GAMES',   accent: '#f97316', modes: ['team_stableford'] },
    { label: 'MASHIE GOLF',  accent: '#a78bfa', modes: ['best2from4', 'best2from4_par3all'] },
  ];
}

const HCP_ALLOWANCES: { pct: number; label: string }[] = [
  { pct: 100, label: 'Full (100%)' },
  { pct: 87,  label: '7/8 (87.5%)' },
  { pct: 75,  label: '3/4 (75%)' },
  { pct: 0,   label: 'Scratch' },
];

const HOLES_OPTIONS: { key: HolesMode; label: string }[] = [
  { key: 'full18', label: 'Full 18' },
  { key: 'front9', label: 'Front 9' },
  { key: 'back9',  label: 'Back 9' },
];

const heroCourse = require('../../../assets/hero-course.jpeg');
const titanLogo  = require('../../../assets/TitanAppLogo.png');

function nowTime() {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ── Picker sheet (generic) ────────────────────────────────────

function genGroupCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function PickerSheet<T extends string>({
  visible, title, options, selected, onSelect, onClose, ps, GOLD,
}: {
  visible: boolean; title: string; options: { key: T; label: string }[];
  selected: T; onSelect: (v: T) => void; onClose: () => void;
  ps: any; GOLD: string;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={ps.overlay} activeOpacity={1} onPress={onClose} />
      <View style={ps.sheet}>
        <View style={ps.handle} />
        <Text style={ps.sheetTitle}>{title}</Text>
        <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
          {options.map(o => (
            <TouchableOpacity key={o.key} style={ps.sheetRow} onPress={() => { onSelect(o.key); onClose(); }} activeOpacity={0.7}>
              <Text style={[ps.sheetOpt, o.key === selected && ps.sheetOptOn]}>{o.label}</Text>
              {o.key === selected && <Ionicons name="checkmark" size={18} color={GOLD} />}
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity style={ps.cancelBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={ps.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ── Format picker sheet (sectioned) ──────────────────────────

function FormatSheet({
  visible, selected, onSelect, onClose, ps, GOLD,
}: {
  visible: boolean; selected: GameMode; onSelect: (v: GameMode) => void; onClose: () => void;
  ps: any; GOLD: string;
}) {
  const MODE_SECTIONS = getModeSections(GOLD);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={ps.overlay} activeOpacity={1} onPress={onClose} />
      <View style={[ps.sheet, { maxHeight: '80%' }]}>
        <View style={ps.handle} />
        <Text style={ps.sheetTitle}>Choose Format</Text>
        <ScrollView style={{ flexGrow: 0 }} showsVerticalScrollIndicator={false}>
          {MODE_SECTIONS.map(section => (
            <View key={section.label}>
              <View style={ps.sectionHead}>
                <View style={[ps.sectionDot, { backgroundColor: section.accent }]} />
                <Text style={[ps.sectionLabel, { color: section.accent }]}>{section.label}</Text>
              </View>
              {section.modes.map(key => {
                const info = MODE_INFO[key];
                const sel  = key === selected;
                return (
                  <TouchableOpacity
                    key={key}
                    style={[ps.formatRow, sel && ps.formatRowOn]}
                    onPress={() => { onSelect(key); onClose(); }}
                    activeOpacity={0.7}
                  >
                    <View style={[ps.formatIconWrap, sel && { backgroundColor: `${GOLD}18`, borderColor: `${GOLD}40` }]}>
                      <Ionicons name={info.icon} size={15} color={sel ? GOLD : '#6b7280'} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[ps.sheetOpt, sel && ps.sheetOptOn]}>{info.label}</Text>
                      <Text style={ps.formatSub}>{info.sub}</Text>
                    </View>
                    {sel && <Ionicons name="checkmark-circle" size={20} color={GOLD} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </ScrollView>
        <TouchableOpacity style={ps.cancelBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={ps.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ── Player picker sheet ───────────────────────────────────────

function PlayerSheet({
  visible, players, groups, pair1, pair2, pairStep, numTeams, extraTeams, isSolo, atMax, takenIds,
  teamLabels, isSingles, onToggle, onNextPair, onLoadGroup, onClose, ps, GOLD,
}: {
  visible: boolean; players: Player[]; groups: PlayerGroup[];
  pair1: string[]; pair2: string[];
  pairStep: number; numTeams: number; extraTeams: string[][];
  isSolo: boolean; atMax: boolean; takenIds: string[];
  teamLabels?: boolean; isSingles?: boolean;
  onToggle: (id: string) => void; onNextPair: () => void;
  onLoadGroup: (ids: string[]) => void; onClose: () => void;
  ps: any; GOLD: string;
}) {
  const firstName = (id: string) => players.find(p => p.id === id)?.display_name.split(' ')[0] ?? '?';
  const activePair = pairStep === 1 ? pair1 : pairStep === 2 ? pair2 : (extraTeams[pairStep - 3] ?? []);
  const otherTeamIds = [
    ...(pairStep !== 1 ? pair1 : []),
    ...(pairStep !== 2 ? pair2 : []),
    ...extraTeams.flatMap((t, i) => (i + 3) !== pairStep ? t : []),
  ];
  const isLastTeam = pairStep >= numTeams;

  const teamTitle = isSolo ? 'Add Players'
    : isSingles ? (pairStep === 1 ? 'Player 1' : 'Player 2')
    : numTeams === 2 ? (pairStep === 1 ? (teamLabels ? 'Team A' : 'First Pair') : (teamLabels ? 'Team B' : 'Second Pair'))
    : `Team ${pairStep} of ${numTeams}`;

  const prevTeams: { label: string; names: string[] }[] = [];
  if (!isSolo && pairStep > 1 && pair1.length > 0) prevTeams.push({ label: numTeams === 2 ? (isSingles ? 'PLAYER 1' : 'PAIR 1') : 'TEAM 1', names: pair1.map(firstName) });
  if (!isSolo && pairStep > 2 && pair2.length > 0) prevTeams.push({ label: 'TEAM 2', names: pair2.map(firstName) });
  for (let i = 0; i < pairStep - 3; i++) {
    if (extraTeams[i]?.length > 0) prevTeams.push({ label: `TEAM ${i + 3}`, names: extraTeams[i].map(firstName) });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={ps.overlay} activeOpacity={1} onPress={onClose} />
      <View style={[ps.sheet, { maxHeight: '80%' }]}>
        <View style={ps.handle} />
        <View style={ps.playerSheetHeader}>
          <Text style={ps.sheetTitle}>{teamTitle}</Text>
          {prevTeams.map((t, i) => (
            <View key={i} style={ps.pair1Summary}>
              <Text style={ps.pair1SummaryLabel}>{t.label}: </Text>
              <Text style={ps.pair1SummaryNames}>{t.names.join(' & ')}</Text>
            </View>
          ))}
        </View>
        {groups.length > 0 && (
          <View style={ps.groupRow}>
            <Text style={ps.groupRowLabel}>LOAD GROUP</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ps.groupScroll}>
              {groups.map(g => (
                <TouchableOpacity key={g.id} style={ps.groupChip} onPress={() => onLoadGroup(g.player_ids)} activeOpacity={0.7}>
                  <Text style={ps.groupChipText}>{g.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
        <FlatList
          data={players}
          keyExtractor={p => p.id}
          style={{ flexGrow: 0 }}
          renderItem={({ item }) => {
            const inActive = activePair.includes(item.id);
            const inOther  = otherTeamIds.includes(item.id);
            const taken    = takenIds.includes(item.id);
            const disabled = inOther || taken || (atMax && !inActive);
            const av = item.avatar_url ?? getPlayerAvatar(item.id, 'normal');
            return (
              <TouchableOpacity
                style={[ps.sheetRow, disabled && { opacity: 0.3 }]}
                onPress={() => !disabled && onToggle(item.id)}
                activeOpacity={0.7}
              >
                <View style={ps.playerRow}>
                  <View style={ps.playerAvatar}>
                    {av
                      ? <Image source={typeof av === 'string' ? { uri: av } : av} style={ps.playerAvatarImg} />
                      : <Text style={ps.playerAvatarLetter}>{item.display_name[0]}</Text>
                    }
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[ps.sheetOpt, inActive && ps.sheetOptOn]}>{item.display_name}</Text>
                    <Text style={ps.playerHcp}>HCP {item.handicap_index}</Text>
                  </View>
                  {inActive && <Ionicons name="checkmark-circle" size={22} color={GOLD} />}
                </View>
              </TouchableOpacity>
            );
          }}
        />
        {!isSolo && !isLastTeam ? (
          <TouchableOpacity
            style={[ps.doneBtn, activePair.length === 0 && { opacity: 0.35 }]}
            onPress={activePair.length > 0 ? onNextPair : undefined}
            activeOpacity={0.8}
          >
            <Text style={ps.doneBtnText}>
              {numTeams === 2 ? (teamLabels ? 'Pick Team B  →' : isSingles ? 'Pick Player 2  →' : 'Pick Pair 2  →') : `Pick Team ${pairStep + 1}  →`}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[ps.doneBtn, activePair.length === 0 && { opacity: 0.35 }]}
            onPress={activePair.length > 0 ? onClose : undefined}
            activeOpacity={0.8}
          >
            <Text style={ps.doneBtnText}>Done</Text>
          </TouchableOpacity>
        )}
      </View>
    </Modal>
  );
}

// ── Course picker sheet ───────────────────────────────────────

function CourseSheet({
  visible, courses, selected, onSelect, onClose, ps, GOLD,
}: {
  visible: boolean; courses: CourseItem[]; selected: string | null;
  onSelect: (name: string) => void; onClose: () => void;
  ps: any; GOLD: string;
}) {
  const [search, setSearch] = useState('');
  const filtered = courses.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={ps.overlay} activeOpacity={1} onPress={onClose} />
      <View style={[ps.sheet, { maxHeight: '75%' }]}>
        <View style={ps.handle} />
        <Text style={ps.sheetTitle}>Select Course</Text>
        <TextInput
          style={ps.searchInput}
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
          style={{ flexGrow: 0 }}
          renderItem={({ item }) => {
            const on = item.name === selected;
            return (
              <TouchableOpacity style={ps.sheetRow} onPress={() => { onSelect(item.name); onClose(); setSearch(''); }} activeOpacity={0.7}>
                <Text style={[ps.sheetOpt, on && ps.sheetOptOn]}>{item.name}</Text>
                <Text style={ps.courseParLabel}>Par {item.par}</Text>
                {on && <Ionicons name="checkmark" size={16} color={GOLD} style={{ marginLeft: 6 }} />}
              </TouchableOpacity>
            );
          }}
        />
        <TouchableOpacity style={ps.cancelBtn} onPress={() => { onClose(); setSearch(''); }} activeOpacity={0.7}>
          <Text style={ps.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ── Setting row helper ────────────────────────────────────────

function SettingRow({
  icon, label, value, valueColor, onPress, children, last, s, GOLD,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string; value?: string; valueColor?: string;
  onPress?: () => void; children?: React.ReactNode; last?: boolean;
  s: any; GOLD: string;
}) {
  return (
    <TouchableOpacity style={s.settingRow} onPress={onPress} activeOpacity={onPress ? 0.7 : 1}>
      <View style={s.settingLeft}>
        <View style={s.settingIconWrap}>
          <Ionicons name={icon} size={16} color={GOLD} />
        </View>
        <Text style={s.settingLabel}>{label}</Text>
      </View>
      <View style={s.settingRight}>
        {value && <Text style={[s.settingValue, valueColor ? { color: valueColor } : undefined]}>{value}</Text>}
        {children}
        {onPress && <Ionicons name="chevron-forward" size={14} color="#444" />}
      </View>
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────

export default function NewGameScreen() {
  const router = useRouter();
  const { societyId, loading: societyLoading } = useSociety();
  const { existingDayId, course: preselectedCourse, openPlayers, resumeMode } = useLocalSearchParams<{ existingDayId?: string; course?: string; openPlayers?: string; resumeMode?: string }>();

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const dc     = useDynamicColors();
  const GOLD   = dc.gold;
  const BG     = dc.bg;
  const CARD   = dc.card;
  const BORDER = dc.border;

  // Game state
  const [mode, setMode]         = useState<GameMode>('stableford');
  const [pair1, setPair1]         = useState<string[]>([]);
  const [pair2, setPair2]         = useState<string[]>([]);
  const [pairStep, setPairStep]   = useState<number>(1);
  const [numTeams, setNumTeams]   = useState(2);
  const [extraTeams, setExtraTeams] = useState<string[][]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string | null>(preselectedCourse ?? null);
  const [hcpAllowance, setHcpAllowance]     = useState<number>(100);
  const [sideGames, setSideGames]           = useState<string[]>([]);
  const [secondaryFormat, setSecondaryFormat] = useState<string | null>(null);
  const [holesMode, setHoles]               = useState<HolesMode>('full18');
  const [voiceEnabled, setVoiceEnabled]     = useState(false);
  const [ldActive, setLdActive]             = useState(false);
  const [npActive, setNpActive]             = useState(false);
  const [ldHole, setLdHole]                 = useState<number | null>(null);
  const [ntpHole, setNtpHole]               = useState<number | null>(null);
  const [creating, setCreating]             = useState(false);
  const [takenPlayerIds, setTakenPlayerIds] = useState<string[]>([]);
  const [teamSize, setTeamSize]             = useState<2 | 3 | 4>(2);
  const [countingScores, setCounting]       = useState<number>(2);

  // Data
  const [players, setPlayers]           = useState<Player[]>([]);
  const [groups,  setGroups]            = useState<PlayerGroup[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [courses, setCourses]           = useState<CourseItem[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [courseHoleData, setCourseHoleData] = useState<{ hole_number: number; par: number }[]>([]);

  // Pickers
  const [showFormat, setShowFormat]   = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);
  const [showCourse, setShowCourse]   = useState(false);
  const [showHoles, setShowHoles]     = useState(false);
  const [showHcp, setShowHcp]         = useState(false);
  const [showTeamSize, setShowTeamSize]   = useState(false);
  const [showCounting, setShowCounting]   = useState(false);
  const [showNumTeams, setShowNumTeams]   = useState(false);

  useFocusEffect(useCallback(() => {
    setMode((resumeMode as GameMode | undefined) ?? 'stableford');
    setPair1([]); setPair2([]); setPairStep(1);
    setSelectedCourse(existingDayId && preselectedCourse ? preselectedCourse : null);
    setHcpAllowance(100); setSideGames([]); setSecondaryFormat(null);
    setHoles('full18'); setVoiceEnabled(true); setLdActive(false); setNpActive(false);
    setLdHole(null); setNtpHole(null); setCreating(false); setTakenPlayerIds([]);
    setTeamSize(2); setCounting(2); setNumTeams(2); setExtraTeams([]);
    setShowFormat(false); setShowPlayers(false); setShowCourse(false);
    setShowHoles(false); setShowHcp(false); setShowTeamSize(false); setShowCounting(false); setShowNumTeams(false);
    if (existingDayId) {
      supabase.from('matches').select('home_player_ids, away_player_ids')
        .eq('day_id', existingDayId).neq('status', 'cancelled')
        .then(({ data }) => {
          if (data) {
            const ids = (data as any[]).flatMap(m => [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])]);
            setTakenPlayerIds([...new Set(ids)]);
          }
        });
      if (openPlayers === '1') {
        setTimeout(() => setShowPlayers(true), 300);
      }
    }
  }, [existingDayId, preselectedCourse, openPlayers, resumeMode]));

  useEffect(() => {
    if (!selectedCourse) { setCourseHoleData([]); return; }
    supabase.from('course_holes').select('hole_number,par').eq('course_name', selectedCourse).order('hole_number')
      .then(({ data }) => { if (data) setCourseHoleData(data as any[]); });
  }, [selectedCourse]);

  useEffect(() => {
    if (societyLoading) return;
    supabase.from('course_holes').select('course_name, par').then(({ data }) => {
      if (data) {
        const map: Record<string, number> = {};
        for (const row of data as any[]) map[row.course_name] = (map[row.course_name] ?? 0) + row.par;
        setCourses(Object.entries(map).map(([name, par]) => ({ name, par })).sort((a, b) => a.name.localeCompare(b.name)));
      }
      setLoadingCourses(false);
    });
    if (!societyId) { setLoadingPlayers(false); return; }
    (async () => {
      const { data: members } = await supabase.from('society_members').select('player_id').eq('society_id', societyId);
      if (!members || members.length === 0) { setLoadingPlayers(false); return; }
      const ids = (members as any[]).map(m => m.player_id);
      const { data } = await supabase.from('players').select('id, display_name, handicap_index, avatar_url').in('id', ids).order('display_name');
      if (data) setPlayers(data as Player[]);
      setLoadingPlayers(false);
      const { data: groupData } = await supabase.from('player_groups').select('id,name,player_ids').eq('society_id', societyId).order('name');
      if (groupData) setGroups(groupData as PlayerGroup[]);
    })();
  }, [societyId, societyLoading]);

  const isSolo    = ['stableford', 'medal', 'skins', 'scramble', 'modified_stableford', 'par_bogey'].includes(mode);
  const isMashie  = mode === 'best2from4' || mode === 'best2from4_par3all';
  const maxPer = mode === 'team_stableford' ? teamSize
               : (mode === 'singles' || mode === 'nassau') ? 1
               : isSolo ? 4
               : isMashie ? 4
               : 2;
  const currentTeamPlayers = pairStep === 1 ? pair1 : pairStep === 2 ? pair2 : (extraTeams[pairStep - 3] ?? []);
  const atMax = isSolo ? pair1.length >= maxPer : (isMashie || mode === 'team_stableford') && currentTeamPlayers.length >= maxPer;

  function togglePlayer(id: string) {
    const inOtherTeam = [
      ...(pairStep !== 1 ? pair1 : []),
      ...(pairStep !== 2 ? pair2 : []),
      ...extraTeams.flatMap((t, i) => (i + 3) !== pairStep ? t : []),
    ].includes(id);
    if (inOtherTeam) return;
    if (pairStep === 1) {
      setPair1(prev => prev.includes(id) ? prev.filter(p => p !== id) : prev.length < maxPer ? [...prev, id] : prev);
    } else if (pairStep === 2) {
      setPair2(prev => prev.includes(id) ? prev.filter(p => p !== id) : prev.length < maxPer ? [...prev, id] : prev);
    } else {
      const tIdx = pairStep - 3;
      setExtraTeams(prev => {
        const next = [...prev];
        const curr = next[tIdx] ?? [];
        next[tIdx] = curr.includes(id) ? curr.filter(p => p !== id) : curr.length < maxPer ? [...curr, id] : curr;
        return next;
      });
    }
  }

  function selectMode(key: GameMode) {
    setMode(key);
    setPair1([]); setPair2([]); setPairStep(1); setExtraTeams([]); setNumTeams(2);
  }

  const firstName = (id: string) => players.find(p => p.id === id)?.display_name.split(' ')[0] ?? '?';

  const playersLabel = (() => {
    if (pair1.length === 0) return 'Add players';
    if (isSolo) {
      const n = pair1.map(firstName);
      return n.length <= 2 ? n.join(', ') : `${n[0]} +${n.length - 1} more`;
    }
    const teams = [pair1, pair2, ...extraTeams].filter(t => t.length > 0);
    if (teams.length === 1) return `${pair1.map(firstName).join(' & ')}  ·  + group 2`;
    if (isMashie) return `${teams.length} group${teams.length !== 1 ? 's' : ''} ready`;
    return teams.map(t => t.map(firstName).join(' & ')).join('  vs  ');
  })();

  const formatLabel  = MODE_INFO[mode]?.label ?? 'Stableford';
  const holesLabel   = HOLES_OPTIONS.find(h => h.key === holesMode)?.label ?? 'Full 18';
  const hcpLabel     = HCP_ALLOWANCES.find(h => h.pct === hcpAllowance)?.label ?? '100%';
  const isTeamMode   = mode === 'team_stableford' || isMashie;
  const allTeamsFilled = numTeams === 2
    ? pair2.length >= 1
    : (pair2.length >= 1 && extraTeams.filter(t => t.length >= 1).length >= numTeams - 2);
  const canStart     = !!selectedCourse && pair1.length >= 1 && (!isTeamMode || allTeamsFilled) && !creating;
  const selectedItem = courses.find(c => c.name === selectedCourse);

  async function createGame() {
    if (!selectedCourse || !societyId || creating) return;
    setCreating(true);
    try {
      let resolvedDayId: string;
      let dayCode: string | null = null;

      if (existingDayId) {
        resolvedDayId = existingDayId;
      } else {
        const { data: dayResult, error: dayErr } = await supabase.rpc('create_game_day_with_code', {
          p_society_id: societyId,
          p_course_name: selectedCourse,
        });
        if (dayErr) throw dayErr;
        const row = Array.isArray(dayResult) ? dayResult[0] : dayResult;
        resolvedDayId = row.day_id;
        dayCode = row.join_code;
      }

      const matchNum = Math.floor(Date.now() / 1000) % 100000;
      const sideGamesList = [
        ...(ldActive && ldHole ? [`Longest Drive:${ldHole}`] : []),
        ...(npActive && ntpHole ? [`Closest to Pin:${ntpHole}`] : []),
        ...(voiceEnabled ? ['voice:on'] : []),
      ];

      const isTeamStableford = mode === 'team_stableford' || isMashie;
      const teamCommonFields = {
        competition_id: null,
        day_id: resolvedDayId,
        match_number: matchNum,
        home_team_id: null,
        away_team_id: null,
        status: 'in_progress',
        holes_string: '..................',
        is_singles: mode === 'singles',
        round_format: (mode === '4bbb' || mode === 'singles') ? 'matchplay' : isMashie ? 'team_stableford' : mode,
        hcp_allowance: hcpAllowance,
        side_games: mode === 'best2from4_par3all' ? [...sideGamesList, 'par3all'] : sideGamesList,
        secondary_format: secondaryFormat,
        ...(isTeamStableford ? { team_size: isMashie ? 4 : teamSize, counting_scores: isMashie ? 2 : countingScores } : {}),
      };

      let newMatch: any;
      let firstMatchId: string;

      if (isTeamStableford && numTeams > 2) {
        // Create one match per team; Mashie groups each get their own join code
        const allTeamsList = [pair1, pair2, ...extraTeams].filter(t => t.length > 0);
        const results = await Promise.all(allTeamsList.map(team => {
          const extra = isMashie ? { group_code: genGroupCode() } : {};
          return supabase.from('matches').insert({ ...teamCommonFields, ...extra, home_player_ids: team, away_player_ids: [] }).select().single();
        }));
        const firstResult = results[0];
        if (firstResult.error || !firstResult.data) throw firstResult.error ?? new Error('Could not create game');
        newMatch = firstResult.data;
        firstMatchId = firstResult.data.id;
        results.forEach(r => { if (r.data?.id) downloadMatchPack(r.data.id).catch(() => {}); });
        // Build group code summary for the alert
        if (isMashie) {
          const groupSummary = results.map((r, i) => {
            const teamNames = allTeamsList[i].map(id => players.find(p => p.id === id)?.display_name.split(' ')[0] ?? '').join(', ');
            const code = (r.data as any)?.group_code ?? '—';
            return `Group ${i + 1} (${teamNames}): ${code}`;
          }).join('\n');
          setCreating(false);
          Alert.alert(
            'Mashie groups created!',
            `Share each group code so players can score their own group:\n\n${groupSummary}\n\nRick shares the codes — each group of 4 can only score themselves.`,
            [
              {
                text: 'Add Another Group',
                onPress: () => router.replace(`/(app)/games/new?existingDayId=${resolvedDayId}&course=${encodeURIComponent(selectedCourse ?? '')}&openPlayers=1&resumeMode=${mode}` as any),
              },
              {
                text: "Let's Play",
                style: 'default',
                onPress: () => router.push(`/(app)/score/day/${resolvedDayId}` as any),
              },
            ]
          );
          return;
        }
      } else {
        const { data, error } = await supabase.from('matches').insert({
          ...teamCommonFields,
          home_player_ids: pair1,
          away_player_ids: isSolo ? [] : pair2,
        }).select().single();
        if (error || !data) throw error ?? new Error('Could not create game');
        newMatch = data;
        firstMatchId = data.id;
        downloadMatchPack(firstMatchId).catch(() => {});
      }

      const codeMsg = dayCode ? `\nDay code: ${dayCode}` : '';
      setCreating(false);
      Alert.alert(
        'Group added!',
        `${pair1.map(id => players.find(p => p.id === id)?.display_name.split(' ')[0] ?? '').join(', ')} are on.${codeMsg}\n\nAdd another group?`,
        [
          {
            text: 'Add Another Group',
            onPress: () => router.replace(`/(app)/games/new?existingDayId=${resolvedDayId}&course=${encodeURIComponent(selectedCourse ?? '')}&openPlayers=1&resumeMode=${mode}` as any),
          },
          {
            text: "Let's Play",
            style: 'default',
            onPress: () => {
              if (isTeamStableford && numTeams > 2) {
                router.push(`/(app)/score/day/${resolvedDayId}` as any);
              } else if (isTeamStableford) {
                router.push(`/(app)/score/teamstableford/${firstMatchId}` as any);
              } else if (existingDayId) {
                router.push(`/(app)/score/day/${resolvedDayId}` as any);
              } else {
                const params = dayCode ? `?dayId=${resolvedDayId}&dayCode=${dayCode}` : '';
                router.push(`/(app)/score/preview/${firstMatchId}${params}` as any);
              }
            },
          },
        ]
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not create game');
      setCreating(false);
    }
  }

  const s = useMemo(() => StyleSheet.create({
    root:    { flex: 1, backgroundColor: BG },
    centered:{ flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll:  { paddingBottom: 48 },

    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12,
    },
    headerSide:   { width: 40 },
    headerCenter: { alignItems: 'center' },
    headerLogo:   { width: 36, height: 36 },

    pageTitle:    { fontFamily: FFB, fontSize: 36, color: '#ffffff', paddingHorizontal: 20, letterSpacing: -0.5, marginTop: 4 },
    pageSubtitle: { fontFamily: FFB, fontSize: 13, color: '#fff', paddingHorizontal: 20, marginTop: 4, marginBottom: 20 },

    // Course card
    courseCard: {
      marginHorizontal: 16, borderRadius: 16,
      overflow: 'hidden', marginBottom: 16,
      backgroundColor: CARD,
    },
    courseHero:    { width: '100%', height: 200 },
    courseOverlay: {
      position: 'absolute', top: 0, left: 0, right: 0, height: 200,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    todayBadge: {
      position: 'absolute', top: 14, left: 14,
      borderWidth: 1, borderColor: GOLD,
      borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
      backgroundColor: `${GOLD}15`,
    },
    todayText: { fontFamily: FFB, fontSize: 10, color: GOLD, letterSpacing: 2 },
    courseInfo: { position: 'absolute', bottom: 64, left: 16, right: 16 },
    courseName: { fontFamily: FFB, fontSize: 20, color: '#ffffff', marginBottom: 6 },
    courseMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 },
    courseMeta:    { fontFamily: FFB, fontSize: 12, color: 'rgba(255,255,255,0.6)' },
    teetimeRow: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.85)',
      paddingHorizontal: 14, paddingVertical: 12,
      borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
      gap: 8,
    },
    teetimeItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    teetimeText: { fontFamily: FFB, fontSize: 12, color: 'rgba(255,255,255,0.55)' },
    teetimeDivider: { width: 1, height: 14, backgroundColor: 'rgba(255,255,255,0.1)', marginHorizontal: 4 },
    startBtn: {
      marginLeft: 'auto', backgroundColor: GOLD,
      borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8,
    },
    startBtnOff:  { opacity: 0.3 },
    startBtnText: { fontFamily: FFB, fontSize: 13, color: '#000000' },

    // Settings
    settingsCard: {
      marginHorizontal: 16, marginBottom: 20,
      backgroundColor: CARD, borderRadius: 14,
      borderWidth: 1, borderColor: BORDER, overflow: 'hidden',
    },
    settingRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 14, paddingVertical: 14,
    },
    settingLeft:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
    settingRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    settingIconWrap: {
      width: 32, height: 32, borderRadius: 8,
      backgroundColor: `${GOLD}0d`, borderWidth: 1, borderColor: `${GOLD}20`,
      alignItems: 'center', justifyContent: 'center',
    },
    settingLabel:  { fontFamily: FFB, fontSize: 15, color: '#ffffff' },
    settingValue:  { fontFamily: FFB, fontSize: 14, color: '#fff' },
    settingDivider:{ height: 1, backgroundColor: '#1a1a1a', marginHorizontal: 14 },

    toggle:        { width: 40, height: 24, borderRadius: 12, backgroundColor: '#2c2c2e', justifyContent: 'center', padding: 2 },
    toggleOn:      { backgroundColor: `${GOLD}50` },
    toggleThumb:   { width: 20, height: 20, borderRadius: 10, backgroundColor: '#6b7280' },
    toggleThumbOn: { transform: [{ translateX: 16 }], backgroundColor: GOLD },

    sectionLabel: {
      fontFamily: FFB, fontSize: 10, color: GOLD,
      letterSpacing: 2, paddingHorizontal: 16, marginBottom: 10,
    },

    // Hole picker
    holePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, paddingBottom: 12 },
    holeBtn: {
      width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
      backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a',
    },
    holeBtnOn:     { borderColor: GOLD, backgroundColor: `${GOLD}15` },
    holeBtnText:   { fontFamily: FFB, fontSize: 14, color: '#fff' },
    holeBtnTextOn: { color: GOLD },
    holeBtnPar:    { fontFamily: FFB, fontSize: 8, color: '#444', marginTop: 1 },

    // Features
    featuresGrid: { paddingHorizontal: 16, gap: 10, marginBottom: 20 },
    featuresRow:  { flexDirection: 'row', gap: 10 },
    featureCard: {
      flex: 1, backgroundColor: CARD,
      borderRadius: 12, borderWidth: 1, borderColor: BORDER,
      padding: 12, alignItems: 'center', gap: 8,
    },
    featureIcon: {
      width: 46, height: 46, borderRadius: 23,
      alignItems: 'center', justifyContent: 'center', borderWidth: 1,
    },
    featureTitle: { fontFamily: FFB, fontSize: 12, color: '#ffffff', textAlign: 'center' },
    featureSub:   { fontFamily: FFB, fontSize: 10, color: '#fff', textAlign: 'center', lineHeight: 14 },

    // Ready
    readyCard: {
      marginHorizontal: 16, marginBottom: 24,
      backgroundColor: CARD, borderRadius: 14,
      borderWidth: 1, borderColor: BORDER,
      flexDirection: 'row', alignItems: 'center', paddingVertical: 16,
    },
    readyItem:    { flex: 1, alignItems: 'center', gap: 5 },
    readyDivider: { width: 1, height: 36, backgroundColor: BORDER },
    readyLabel:   { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 1.5 },
    readyValue:   { fontFamily: FFB, fontSize: 12, color: '#ffffff' },

    // CTA
    ctaBtn: {
      marginHorizontal: 16, marginBottom: 16,
      backgroundColor: GOLD, borderRadius: 14,
      paddingVertical: 18, flexDirection: 'row',
      alignItems: 'center', justifyContent: 'center', gap: 8,
    },
    ctaBtnOff:  { opacity: 0.3 },
    ctaBtnText: { fontFamily: FFB, fontSize: 17, color: '#000000' },
  }), [GOLD, BG, CARD, BORDER]);

  const ps = useMemo(() => StyleSheet.create({
    overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
    sheet: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      backgroundColor: CARD, borderTopLeftRadius: 20, borderTopRightRadius: 20,
      paddingBottom: 34, paddingHorizontal: 16,
    },
    handle: {
      width: 36, height: 4, borderRadius: 2, backgroundColor: '#333',
      alignSelf: 'center', marginVertical: 12,
    },
    sheetTitle:  { fontFamily: FFB, fontSize: 18, color: '#ffffff', marginBottom: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: BORDER },
    sheetRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
    sheetOpt:    { fontFamily: FFB, fontSize: 16, color: '#fff' },
    sheetOptOn:  { color: '#ffffff' },
    cancelBtn:   { marginTop: 12, alignItems: 'center', paddingVertical: 14 },
    cancelText:  { fontFamily: FFB, fontSize: 16, color: '#fff' },
    doneBtn:     { marginTop: 12, backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    doneBtnText: { fontFamily: FFB, fontSize: 16, color: '#000000' },
    courseParLabel: { fontFamily: FFB, fontSize: 12, color: '#fff' },
    searchInput: {
      backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1, borderColor: '#2a2a2a',
      paddingHorizontal: 12, paddingVertical: 10, color: '#fff',
      fontFamily: FFB, fontSize: 15, marginBottom: 8,
    },
    playerSheetHeader: {},
    groupRow:      { paddingHorizontal: 16, paddingBottom: 10 },
    groupRowLabel: { fontFamily: FFB, fontSize: 10, color: GOLD, letterSpacing: 1.5, marginBottom: 6 },
    groupScroll:   { flexGrow: 0 },
    groupChip:     { backgroundColor: `${GOLD}18`, borderWidth: 1, borderColor: `${GOLD}40`, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginRight: 8 },
    groupChipText: { fontFamily: FFB, fontSize: 13, color: GOLD },
    pair1Summary: { flexDirection: 'row', paddingBottom: 6 },
    pair1SummaryLabel: { fontFamily: FFB, fontSize: 12, color: '#fff' },
    pair1SummaryNames: { fontFamily: FFB, fontSize: 12, color: GOLD },
    playerRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
    playerAvatar: {
      width: 36, height: 36, borderRadius: 18,
      backgroundColor: `${GOLD}18`, alignItems: 'center', justifyContent: 'center',
    },
    playerAvatarImg:    { width: 36, height: 36, borderRadius: 18 },
    playerAvatarLetter: { fontFamily: FFB, fontSize: 15, color: GOLD },
    playerHcp:          { fontFamily: FFB, fontSize: 11, color: '#fff' },
    sectionHead:   { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, marginTop: 4 },
    sectionDot:    { width: 5, height: 5, borderRadius: 2.5 },
    sectionLabel:  { fontFamily: FFB, fontSize: 9, fontWeight: '800', letterSpacing: 2 },
    formatRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', gap: 10 },
    formatRowOn:   { backgroundColor: 'rgba(212,175,55,0.04)', borderRadius: 8 },
    formatIconWrap:{ width: 28, height: 28, borderRadius: 7, backgroundColor: `${GOLD}0d`, borderWidth: 1, borderColor: `${GOLD}20`, alignItems: 'center', justifyContent: 'center' },
    formatSub:     { fontFamily: FFB, fontSize: 11, color: '#fff', marginTop: 1 },
  }), [GOLD, BG, CARD, BORDER]);

  if (!fontsLoaded) {
    return (
      <View style={s.root}>
        <StatusBar style="light" />
        <View style={s.centered}><ActivityIndicator color={GOLD} size="large" /></View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* ── Header ────────────────────────────────────────────── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerSide} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close-outline" size={28} color="#ffffff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
        </View>
        <View style={[s.headerSide, { alignItems: 'flex-end' }]} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

        {/* ── Page title ─────────────────────────────────────── */}
        <Text style={s.pageTitle}>Casual Round</Text>
        <Text style={s.pageSubtitle}>Set up a premium social round</Text>

        {/* ── Course card ────────────────────────────────────── */}
        <TouchableOpacity style={s.courseCard} onPress={() => setShowCourse(true)} activeOpacity={0.9}>
          <Image source={heroCourse} style={s.courseHero} resizeMode="cover" />
          <View style={s.courseOverlay} />

          <View style={s.todayBadge}>
            <Text style={s.todayText}>TODAY</Text>
          </View>

          <View style={s.courseInfo}>
            <Text style={s.courseName}>{selectedCourse ?? 'Tap to select a course'}</Text>
            {selectedItem && (
              <View style={s.courseMetaRow}>
                <Ionicons name="flag-outline" size={12} color="rgba(255,255,255,0.6)" />
                <Text style={s.courseMeta}>Par {selectedItem.par}</Text>
              </View>
            )}
            <View style={s.courseMetaRow}>
              <Ionicons name="location-outline" size={12} color="rgba(255,255,255,0.6)" />
              <Text style={s.courseMeta}>Tap to change course</Text>
            </View>
          </View>

          <View style={s.teetimeRow}>
            <View style={s.teetimeItem}>
              <Ionicons name="flag-outline" size={13} color="rgba(255,255,255,0.5)" />
              <Text style={s.teetimeText}>Hole 1 Start</Text>
            </View>
            <View style={s.teetimeDivider} />
            <View style={s.teetimeItem}>
              <Ionicons name="time-outline" size={13} color="rgba(255,255,255,0.5)" />
              <Text style={s.teetimeText}>{nowTime()} Tee Time</Text>
            </View>
            <TouchableOpacity
              style={[s.startBtn, !canStart && s.startBtnOff]}
              onPress={canStart ? createGame : undefined}
              disabled={!canStart || creating}
              activeOpacity={0.85}
            >
              {creating
                ? <ActivityIndicator color="#000" size="small" />
                : <Text style={s.startBtnText}>Start Round</Text>
              }
            </TouchableOpacity>
          </View>
        </TouchableOpacity>

        {/* ── Settings card ──────────────────────────────────── */}
        <View style={s.settingsCard}>

          {/* Format */}
          <SettingRow icon="trophy-outline" label="Format" value={formatLabel} onPress={() => setShowFormat(true)} s={s} GOLD={GOLD} />
          <View style={s.settingDivider} />

          {/* Players */}
          <SettingRow icon="people-outline" label="Players" value={playersLabel} valueColor={pair1.length === 0 ? GOLD : undefined} onPress={() => setShowPlayers(true)} s={s} GOLD={GOLD} />

          {/* Team / Mashie config */}
          {isTeamMode && (
            <>
              <View style={s.settingDivider} />
              <SettingRow icon="albums-outline" label="Teams" value={`${numTeams} teams`} onPress={() => setShowNumTeams(true)} s={s} GOLD={GOLD} />
            </>
          )}
          {mode === 'team_stableford' && (
            <>
              <View style={s.settingDivider} />
              <SettingRow icon="people-outline" label="Team Size" value={`${teamSize} players per side`} onPress={() => setShowTeamSize(true)} s={s} GOLD={GOLD} />
              <View style={s.settingDivider} />
              <SettingRow icon="checkmark-circle-outline" label="Counting Scores" value={`Best ${countingScores} of ${teamSize}`} onPress={() => setShowCounting(true)} s={s} GOLD={GOLD} />
            </>
          )}
          <View style={s.settingDivider} />

          {/* Holes */}
          <SettingRow icon="golf-outline" label="Holes" value={holesLabel} onPress={() => setShowHoles(true)} s={s} GOLD={GOLD} />
          <View style={s.settingDivider} />

          {/* Handicap */}
          <SettingRow icon="stats-chart-outline" label="Handicap" value={hcpLabel} onPress={() => setShowHcp(true)} s={s} GOLD={GOLD} />
          <View style={s.settingDivider} />

          {/* Chip & Birdie */}
          <SettingRow icon="mic-outline" label="Chip & Birdie" value={voiceEnabled ? 'On' : 'Off'} valueColor={voiceEnabled ? GOLD : '#6b7280'} onPress={() => setVoiceEnabled(v => !v)} s={s} GOLD={GOLD}>
            <View style={[s.toggle, voiceEnabled && s.toggleOn]}>
              <View style={[s.toggleThumb, voiceEnabled && s.toggleThumbOn]} />
            </View>
          </SettingRow>

        </View>

        {/* ── Side Games ─────────────────────────────────────── */}
        <Text style={s.sectionLabel}>SIDE GAMES</Text>
        <View style={s.settingsCard}>

          {/* Longest Drive */}
          <SettingRow
            icon="arrow-forward-circle-outline"
            label="Longest Drive"
            value={ldActive ? (ldHole ? `Hole ${ldHole}` : 'Pick hole') : 'Off'}
            valueColor={ldActive ? GOLD : '#6b7280'}
            onPress={() => setLdActive(v => !v)}
            s={s} GOLD={GOLD}
          >
            <View style={[s.toggle, ldActive && s.toggleOn]}>
              <View style={[s.toggleThumb, ldActive && s.toggleThumbOn]} />
            </View>
          </SettingRow>

          {ldActive && courseHoleData.filter(h => h.par === 5).length > 0 && (
            <View style={s.holePicker}>
              {courseHoleData.filter(h => h.par === 5).map(h => (
                <TouchableOpacity
                  key={h.hole_number}
                  style={[s.holeBtn, ldHole === h.hole_number && s.holeBtnOn]}
                  onPress={() => setLdHole(h.hole_number)}
                >
                  <Text style={[s.holeBtnText, ldHole === h.hole_number && s.holeBtnTextOn]}>{h.hole_number}</Text>
                  <Text style={s.holeBtnPar}>P5</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={s.settingDivider} />

          {/* Nearest the Pin */}
          <SettingRow
            icon="golf-outline"
            label="Nearest the Pin"
            value={npActive ? (ntpHole ? `Hole ${ntpHole}` : 'Pick hole') : 'Off'}
            valueColor={npActive ? GOLD : '#6b7280'}
            onPress={() => setNpActive(v => !v)}
            s={s} GOLD={GOLD}
          >
            <View style={[s.toggle, npActive && s.toggleOn]}>
              <View style={[s.toggleThumb, npActive && s.toggleThumbOn]} />
            </View>
          </SettingRow>

          {npActive && courseHoleData.filter(h => h.par === 3).length > 0 && (
            <View style={s.holePicker}>
              {courseHoleData.filter(h => h.par === 3).map(h => (
                <TouchableOpacity
                  key={h.hole_number}
                  style={[s.holeBtn, ntpHole === h.hole_number && s.holeBtnOn]}
                  onPress={() => setNtpHole(h.hole_number)}
                >
                  <Text style={[s.holeBtnText, ntpHole === h.hole_number && s.holeBtnTextOn]}>{h.hole_number}</Text>
                  <Text style={s.holeBtnPar}>P3</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {mode !== 'stableford' && mode !== 'medal' && (
            <>
              <View style={s.settingDivider} />
              <SettingRow
                icon="star-outline"
                label="Stableford"
                value={secondaryFormat === 'stableford' ? 'On' : 'Off'}
                valueColor={secondaryFormat === 'stableford' ? GOLD : '#6b7280'}
                onPress={() => setSecondaryFormat(f => f === 'stableford' ? null : 'stableford')}
                s={s} GOLD={GOLD}
              >
                <View style={[s.toggle, secondaryFormat === 'stableford' && s.toggleOn]}>
                  <View style={[s.toggleThumb, secondaryFormat === 'stableford' && s.toggleThumbOn]} />
                </View>
              </SettingRow>
              <View style={s.settingDivider} />
              <SettingRow
                icon="medal-outline"
                label="Medal"
                value={secondaryFormat === 'medal' ? 'On' : 'Off'}
                valueColor={secondaryFormat === 'medal' ? GOLD : '#6b7280'}
                onPress={() => setSecondaryFormat(f => f === 'medal' ? null : 'medal')}
                s={s} GOLD={GOLD}
              >
                <View style={[s.toggle, secondaryFormat === 'medal' && s.toggleOn]}>
                  <View style={[s.toggleThumb, secondaryFormat === 'medal' && s.toggleThumbOn]} />
                </View>
              </SettingRow>
            </>
          )}

        </View>

        {/* ── GPS & Course Features ───────────────────────────── */}
        <Text style={s.sectionLabel}>GPS & COURSE FEATURES</Text>
        <View style={s.featuresGrid}>
          <View style={s.featuresRow}>
            <View style={s.featureCard}>
              <View style={[s.featureIcon, { backgroundColor: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.25)' }]}>
                <Ionicons name="navigate-circle-outline" size={24} color={GREEN} />
              </View>
              <Text style={s.featureTitle}>Live Yardages</Text>
              <Text style={s.featureSub}>Real-time{'\n'}distances</Text>
            </View>
            <View style={s.featureCard}>
              <View style={[s.featureIcon, { backgroundColor: `${GOLD}12`, borderColor: `${GOLD}30` }]}>
                <Ionicons name="map-outline" size={24} color={GOLD} />
              </View>
              <Text style={s.featureTitle}>Hole Maps</Text>
              <Text style={s.featureSub}>Detailed view{'\n'}of every hole</Text>
            </View>
          </View>
          <View style={s.featuresRow}>
            <View style={s.featureCard}>
              <View style={[s.featureIcon, { backgroundColor: 'rgba(99,102,241,0.12)', borderColor: 'rgba(99,102,241,0.25)' }]}>
                <Ionicons name="analytics-outline" size={24} color="#818cf8" />
              </View>
              <Text style={s.featureTitle}>Shot Tracking</Text>
              <Text style={s.featureSub}>Track every{'\n'}shot</Text>
            </View>
            <TouchableOpacity style={s.featureCard} onPress={() => router.push('/(app)/rangefinder' as any)} activeOpacity={0.8}>
              <View style={[s.featureIcon, { backgroundColor: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.22)' }]}>
                <Ionicons name="scan-outline" size={24} color="#f87171" />
              </View>
              <Text style={s.featureTitle}>Rangefinder</Text>
              <Text style={s.featureSub}>GPS pin-point{'\n'}accuracy</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Ready to Play ───────────────────────────────────── */}
        <Text style={s.sectionLabel}>READY TO PLAY</Text>
        <View style={s.readyCard}>
          <View style={s.readyItem}>
            <Ionicons name="people-outline" size={20} color={GOLD} />
            <Text style={s.readyLabel}>PLAYERS</Text>
            <Text style={[s.readyValue, pair1.length > 0 && { color: GREEN }]}>
              {pair1.length > 0 ? pair1.length : '—'}
            </Text>
          </View>
          <View style={s.readyDivider} />
          <View style={s.readyItem}>
            <Ionicons name="trophy-outline" size={20} color={GOLD} />
            <Text style={s.readyLabel}>FORMAT</Text>
            <Text style={[s.readyValue, { color: GREEN }]}>{MODE_INFO[mode]?.label}</Text>
          </View>
          <View style={s.readyDivider} />
          <View style={s.readyItem}>
            <Ionicons name="cloud-done-outline" size={20} color={GOLD} />
            <Text style={s.readyLabel}>COURSE</Text>
            <Text style={[s.readyValue, { color: selectedCourse ? GREEN : '#6b7280' }]}>
              {selectedCourse ? 'Set' : 'Not set'}
            </Text>
          </View>
        </View>

        {/* ── Main CTA ────────────────────────────────────────── */}
        <TouchableOpacity
          style={[s.ctaBtn, !canStart && s.ctaBtnOff]}
          onPress={canStart ? createGame : undefined}
          disabled={!canStart || creating}
          activeOpacity={0.85}
        >
          {creating
            ? <ActivityIndicator color="#000" />
            : <>
                <Text style={s.ctaBtnText}>Start Round</Text>
                <Ionicons name="arrow-forward" size={18} color="#000" />
              </>
          }
        </TouchableOpacity>

      </ScrollView>

      {/* ── Pickers ───────────────────────────────────────────── */}
      <FormatSheet visible={showFormat} selected={mode} onSelect={selectMode} onClose={() => setShowFormat(false)} ps={ps} GOLD={GOLD} />
      <PlayerSheet
        visible={showPlayers} players={players} groups={groups} pair1={pair1} pair2={pair2}
        pairStep={pairStep} numTeams={isTeamMode ? numTeams : 2} extraTeams={extraTeams}
        isSolo={isSolo} atMax={atMax} takenIds={takenPlayerIds}
        teamLabels={mode === 'team_stableford' || isMashie}
        isSingles={mode === 'singles'}
        onToggle={togglePlayer}
        onNextPair={() => {
          const next = pairStep + 1;
          if (next > 2) setExtraTeams(prev => { const a = [...prev]; if (!a[next - 3]) a[next - 3] = []; return a; });
          setPairStep(next);
        }}
        onLoadGroup={(ids) => {
          const valid = ids.filter(id => players.some(p => p.id === id));
          setPair1(valid.slice(0, maxPer));
          setPair2([]); setExtraTeams([]); setPairStep(1);
        }}
        onClose={() => { setShowPlayers(false); setPairStep(1); }}
        ps={ps} GOLD={GOLD}
      />
      <CourseSheet visible={showCourse} courses={courses} selected={selectedCourse} onSelect={setSelectedCourse} onClose={() => setShowCourse(false)} ps={ps} GOLD={GOLD} />
      <PickerSheet
        visible={showHoles} title="Holes" options={HOLES_OPTIONS}
        selected={holesMode} onSelect={setHoles} onClose={() => setShowHoles(false)}
        ps={ps} GOLD={GOLD}
      />
      <PickerSheet
        visible={showHcp} title="Handicap Allowance" options={HCP_ALLOWANCES.map(h => ({ key: h.pct.toString() as any, label: h.label }))}
        selected={hcpAllowance.toString() as any}
        onSelect={(v: any) => setHcpAllowance(parseInt(v, 10))}
        onClose={() => setShowHcp(false)}
        ps={ps} GOLD={GOLD}
      />
      <PickerSheet
        visible={showNumTeams} title="Number of Teams"
        options={Array.from({ length: 29 }, (_, i) => ({ key: String(i + 2), label: `${i + 2} teams` }))}
        selected={numTeams.toString() as any}
        onSelect={(v: any) => {
          const n = parseInt(v, 10);
          setNumTeams(n);
          setExtraTeams(n > 2 ? Array.from({ length: n - 2 }, () => []) : []);
          setPair1([]); setPair2([]); setPairStep(1);
        }}
        onClose={() => setShowNumTeams(false)}
        ps={ps} GOLD={GOLD}
      />
      <PickerSheet
        visible={showTeamSize} title="Team Size"
        options={[
          { key: '2', label: '2 players per side' },
          { key: '3', label: '3 players per side' },
          { key: '4', label: '4 players per side' },
        ]}
        selected={teamSize.toString() as any}
        onSelect={(v: any) => {
          const n = parseInt(v, 10) as 2 | 3 | 4;
          setTeamSize(n);
          if (countingScores > n) setCounting(n);
          setPair1([]); setPair2([]); setPairStep(1);
        }}
        onClose={() => setShowTeamSize(false)}
        ps={ps} GOLD={GOLD}
      />
      <PickerSheet
        visible={showCounting} title="Counting Scores"
        options={Array.from({ length: teamSize }, (_, i) => ({
          key: String(i + 1),
          label: i + 1 === teamSize ? `All ${teamSize} scores count` : `Best ${i + 1} of ${teamSize}`,
        }))}
        selected={countingScores.toString() as any}
        onSelect={(v: any) => setCounting(parseInt(v, 10))}
        onClose={() => setShowCounting(false)}
        ps={ps} GOLD={GOLD}
      />

    </View>
  );
}

