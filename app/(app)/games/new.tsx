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
import { supabase, fetchAllRows } from '../../../src/lib/supabase';
import { useSociety } from '../../../src/lib/useSociety';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { getPlayerAvatar } from '../../../src/lib/assets';
import { downloadMatchPack, downloadCourseGps } from '../../../src/lib/offlinePack';
import { fetchFavouriteIds, fetchRecentlyPlayedWithIds, toggleFavourite } from '../../../src/lib/playerTiers';
import GroupBuilderSheet, { BuiltMatch, PlayerOverride } from './GroupBuilderSheet';
import { goBack } from '../../../src/lib/navigation';
import TeePickerSheet, { fetchCourseTees, SelectableTee } from '../../../src/components/TeePickerSheet';
import { calculateWHSPlayingHandicap } from '../../../src/lib/whs';

// ── Constants ─────────────────────────────────────────────────

type GameMode  = '4bbb' | '4bbb_stroke' | 'singles' | 'stableford' | 'medal' | 'skins' | 'nassau' | 'scramble' | 'greensome' | 'foursomes' | 'par_bogey' | 'team_stableford' | 'best2from4' | 'best2from4_par3all';
type HolesMode = 'full18' | 'front9' | 'back9';

interface Player      { id: string; display_name: string; handicap_index: number; avatar_url?: string | null; }
interface CourseItem  { name: string; par: number; hasGps: boolean; region: string | null; }
interface PlayerGroup { id: string; name: string; player_ids: string[]; }

const GREEN = '#22c55e';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';

const MODE_INFO: Record<GameMode, { label: string; sub: string; icon: keyof typeof Ionicons.glyphMap }> = {
  '4bbb':                { label: '4BBB Stableford',  sub: 'Best ball pairs',              icon: 'people-outline' },
  '4bbb_stroke':         { label: '4BBB Stroke',      sub: 'Best ball, relative handicap',  icon: 'people-outline' },
  'singles':             { label: 'Singles',           sub: 'Head to head matchplay',       icon: 'person-outline' },
  'nassau':              { label: 'Nassau',            sub: 'Front / Back / Overall',       icon: 'cash-outline' },
  'foursomes':           { label: 'Foursomes',         sub: 'Alternate shot matchplay',     icon: 'swap-horizontal-outline' },
  'greensome':           { label: 'Greensomes',        sub: 'Best drive, then alternate',   icon: 'leaf-outline' },
  'stableford':          { label: 'Stableford',        sub: 'Points per hole',              icon: 'star-outline' },
  'medal':               { label: 'Medal',             sub: 'Stroke play',                  icon: 'medal-outline' },
  'par_bogey':           { label: 'Par / Bogey',       sub: 'Win, halve or lose vs par',    icon: 'stats-chart-outline' },
  'skins':               { label: 'Skins',             sub: 'Per-hole prize pot',           icon: 'diamond-outline' },
  'scramble':            { label: 'Scramble',          sub: 'Team best ball',               icon: 'golf-outline' },
  'team_stableford':      { label: 'Team Stableford',        sub: 'Best N scores count per team',       icon: 'people-circle-outline' },
  'best2from4':           { label: 'Best 2 From 4',          sub: 'Best 2 stableford scores per hole',  icon: 'people-outline' },
  'best2from4_par3all':   { label: 'Best 2 From 4 (Par 3s)', sub: 'All scores count on par 3 holes',    icon: 'golf-outline' },
};

function getModeSections(gold: string): { label: string; accent: string; modes: GameMode[] }[] {
  return [
    { label: 'MATCHPLAY',    accent: gold,      modes: ['4bbb', '4bbb_stroke', 'singles'] },
    { label: 'INDIVIDUAL',   accent: '#4ade80', modes: ['stableford', 'medal'] },
    { label: 'TEAM GAMES',   accent: '#f97316', modes: ['team_stableford'] },
    { label: 'MASHIE GOLF',  accent: '#a78bfa', modes: ['best2from4', 'best2from4_par3all'] },
  ];
}

const HCP_ALLOWANCES: { pct: number; label: string }[] = [
  { pct: 100, label: 'Full (100%)' },
  { pct: 95,  label: '95%' },
  { pct: 90,  label: '90%' },
  { pct: 85,  label: '85%' },
  { pct: 80,  label: '80%' },
  { pct: 75,  label: '3/4 (75%)' },
  { pct: 0,   label: 'Scratch' },
  { pct: -1,  label: 'Manual...' },
];

const HOLES_OPTIONS: { key: HolesMode; label: string }[] = [
  { key: 'full18', label: 'Full 18' },
  { key: 'front9', label: 'Front 9' },
  { key: 'back9',  label: 'Back 9' },
];

const heroCourse = require('../../../assets/hero-course.jpeg');


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

// ── Mashie group builder sheet ────────────────────────────────

function MashieGroupSheet({
  visible, players, initialGroups, numTeams, onDone, onClose, ps, GOLD,
}: {
  visible: boolean;
  players: Player[];
  initialGroups: string[][];
  numTeams: number;
  onDone: (groups: string[][]) => void;
  onClose: () => void;
  ps: any;
  GOLD: string;
}) {
  const [groups, setGroups] = useState<string[][]>([]);
  const [pickGroup, setPickGroup] = useState<number | null>(null);

  useEffect(() => {
    if (visible) {
      setGroups(Array.from({ length: Math.max(numTeams, 1) }, (_, i) => initialGroups[i] ?? []));
      setPickGroup(null);
    }
  }, [visible]);

  const fn = (id: string) => players.find(p => p.id === id)?.display_name.split(' ')[0] ?? '?';
  const usedIds = useMemo(() => new Set(groups.flat()), [groups]);
  const available = useMemo(() => {
    if (pickGroup === null) return [];
    const inGroup = new Set(groups[pickGroup] ?? []);
    return players.filter(p => !usedIds.has(p.id) || inGroup.has(p.id));
  }, [pickGroup, players, groups, usedIds]);

  function addPlayer(id: string) {
    if (pickGroup === null) return;
    setGroups(prev => prev.map((g, i) => i === pickGroup ? [...g, id] : g));
    setPickGroup(null);
  }
  function removePlayer(gi: number, id: string) {
    setGroups(prev => prev.map((g, i) => i === gi ? g.filter(pid => pid !== id) : g));
  }

  const canDone = groups.some(g => g.length > 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={ps.overlay} activeOpacity={1} onPress={onClose} />
      <View style={[ps.sheet, { maxHeight: '90%' }]}>
        <View style={ps.handle} />
        <Text style={ps.sheetTitle}>Set Up Groups</Text>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 8, gap: 12 }}>
          {groups.map((group, gi) => (
            <View key={gi} style={{ backgroundColor: '#111', borderRadius: 12, padding: 12, gap: 8, marginBottom: 4 }}>
              <Text style={{ fontFamily: 'JUSTSans-ExBold', fontSize: 10, color: GOLD, letterSpacing: 1.5 }}>GROUP {gi + 1}</Text>
              {group.map(pid => (
                <View key={pid} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
                  <View style={ps.playerAvatar}>
                    <Text style={ps.playerAvatarLetter}>{fn(pid)[0]}</Text>
                  </View>
                  <Text style={{ fontFamily: 'JUSTSans-ExBold', fontSize: 14, color: '#fff', flex: 1 }}>{fn(pid)}</Text>
                  <TouchableOpacity onPress={() => removePlayer(gi, pid)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={20} color="#444" />
                  </TouchableOpacity>
                </View>
              ))}
              {group.length < 4 && (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}
                  onPress={() => setPickGroup(gi)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="add-circle-outline" size={18} color={GOLD} />
                  <Text style={{ fontFamily: 'JUSTSans-ExBold', fontSize: 13, color: GOLD }}>Add Player</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              paddingVertical: 14, borderWidth: 1, borderColor: `${GOLD}40`, borderRadius: 12, borderStyle: 'dashed' }}
            onPress={() => setGroups(prev => [...prev, []])}
            activeOpacity={0.7}
          >
            <Ionicons name="add" size={18} color={GOLD} />
            <Text style={{ fontFamily: 'JUSTSans-ExBold', fontSize: 14, color: GOLD }}>Add Group</Text>
          </TouchableOpacity>
        </ScrollView>

        <TouchableOpacity style={[ps.doneBtn, !canDone && { opacity: 0.4 }]} onPress={canDone ? () => onDone(groups) : undefined} activeOpacity={0.8}>
          <Text style={ps.doneBtnText}>Done</Text>
        </TouchableOpacity>
        <TouchableOpacity style={ps.cancelBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={ps.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>

      {pickGroup !== null && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setPickGroup(null)}>
          <TouchableOpacity style={ps.overlay} activeOpacity={1} onPress={() => setPickGroup(null)} />
          <View style={[ps.sheet, { maxHeight: '70%' }]}>
            <View style={ps.handle} />
            <Text style={ps.sheetTitle}>Add to Group {pickGroup + 1}</Text>
            <ScrollView>
              {available.length === 0
                ? <Text style={{ color: '#555', textAlign: 'center', padding: 20, fontFamily: 'JUSTSans' }}>No players available</Text>
                : available.map(p => (
                  <TouchableOpacity key={p.id} style={ps.sheetRow} onPress={() => addPlayer(p.id)} activeOpacity={0.7}>
                    <View style={ps.playerRow}>
                      <View style={ps.playerAvatar}>
                        <Text style={ps.playerAvatarLetter}>{p.display_name.split(' ')[0][0]}</Text>
                      </View>
                      <Text style={ps.sheetOpt}>{p.display_name}</Text>
                    </View>
                    {p.handicap_index != null && <Text style={ps.playerHcp}>HCP {p.handicap_index}</Text>}
                  </TouchableOpacity>
                ))
              }
            </ScrollView>
            <TouchableOpacity style={ps.cancelBtn} onPress={() => setPickGroup(null)} activeOpacity={0.7}>
              <Text style={ps.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}
    </Modal>
  );
}

// ── Course picker sheet ───────────────────────────────────────

// Regions ordered biggest-first (matches the real split of the course
// database) rather than alphabetically, so the tabs a user reaches for most
// often sit closest to "All".
const REGION_ORDER = ['England', 'Spain', 'France', 'Scotland', 'Portugal', 'Ireland & Northern Ireland', 'Orlando / Central Florida', 'Wales', 'Turkey'];

function CourseSheet({
  visible, courses, selected, onSelect, onClose, ps, GOLD,
}: {
  visible: boolean; courses: CourseItem[]; selected: string | null;
  onSelect: (name: string) => void; onClose: () => void;
  ps: any; GOLD: string;
}) {
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState<string | null>(null);
  const availableRegions = REGION_ORDER.filter(r => courses.some(c => c.region === r));
  const hasOther = courses.some(c => !c.region);
  const filtered = courses
    .filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
    .filter(c => region === null || (region === 'Other' ? !c.region : c.region === region));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={ps.overlay} activeOpacity={1} onPress={onClose} />
      <View style={[ps.sheet, { maxHeight: '75%' }]}>
        <View style={ps.handle} />
        <Text style={ps.sheetTitle}>Select Course</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ height: 48, marginBottom: 10, flexGrow: 0 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 2, alignItems: 'center' }}>
          {[{ key: null, label: 'All' }, ...availableRegions.map(r => ({ key: r, label: r })), ...(hasOther ? [{ key: 'Other', label: 'Other' }] : [])].map(opt => (
            <TouchableOpacity
              key={opt.label}
              onPress={() => setRegion(opt.key)}
              activeOpacity={0.7}
              style={{
                paddingHorizontal: 14, paddingVertical: 7, borderRadius: 100,
                borderWidth: 1, borderColor: region === opt.key ? GOLD : '#2a2a2a',
                backgroundColor: region === opt.key ? 'rgba(212,175,55,0.14)' : 'transparent',
              }}
            >
              <Text style={{ fontFamily: 'JUSTSans-ExBold', fontSize: 12.5, lineHeight: 18, color: region === opt.key ? GOLD : '#9ca3af' }}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
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
              <TouchableOpacity style={ps.sheetRow} onPress={() => { onSelect(item.name); onClose(); setSearch(''); setRegion(null); }} activeOpacity={0.7}>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[ps.sheetOpt, on && ps.sheetOptOn]} numberOfLines={1}>{item.name}</Text>
                  {item.hasGps && <Ionicons name="location" size={13} color={GOLD} />}
                </View>
                <Text style={ps.courseParLabel}>Par {item.par}</Text>
                {on && <Ionicons name="checkmark" size={16} color={GOLD} style={{ marginLeft: 6 }} />}
              </TouchableOpacity>
            );
          }}
        />
        <TouchableOpacity style={ps.cancelBtn} onPress={() => { onClose(); setSearch(''); setRegion(null); }} activeOpacity={0.7}>
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
  const { existingDayId, course: preselectedCourse, openPlayers, resumeMode, totalGroups, groupNum } = useLocalSearchParams<{ existingDayId?: string; course?: string; openPlayers?: string; resumeMode?: string; totalGroups?: string; groupNum?: string }>();

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
  const [whsEnabled, setWhsEnabled]         = useState(false);
  const [courseTees, setCourseTees]         = useState<SelectableTee[]>([]);
  const [playerTees, setPlayerTees]         = useState<Record<string, SelectableTee>>({});
  const [teePickerPlayerId, setTeePickerPlayerId] = useState<string | null>(null);
  const [showWhsDetails, setShowWhsDetails] = useState(false);
  const [sideGames, setSideGames]           = useState<string[]>([]);
  const [secondaryFormat, setSecondaryFormat] = useState<string | null>('stableford');
  const [holesMode, setHoles]               = useState<HolesMode>('full18');
  const [voiceEnabled, setVoiceEnabled]     = useState(false);
  const [statsEnabled, setStatsEnabled]     = useState(false);
  const [ldActive, setLdActive]             = useState(false);
  const [npActive, setNpActive]             = useState(false);
  const [ldHole, setLdHole]                 = useState<number | null>(null);
  const [ntpHole, setNtpHole]               = useState<number | null>(null);
  const [startHole, setStartHole]           = useState(1);
  const [creating, setCreating]             = useState(false);
  const [takenPlayerIds, setTakenPlayerIds] = useState<string[]>([]);
  const [teamSize, setTeamSize]             = useState<2 | 3 | 4>(2);
  const [countingScores, setCounting]       = useState<number>(2);

  // Data
  const [players, setPlayers]           = useState<Player[]>([]);
  const [groups,  setGroups]            = useState<PlayerGroup[]>([]);
  const [favouriteIds, setFavouriteIds] = useState<Set<string>>(new Set());
  const [recentIds,    setRecentIds]    = useState<string[]>([]);
  const [myPlayerId,   setMyPlayerId]   = useState<string | null>(null);
  const [friendOnlyIds, setFriendOnlyIds] = useState<Set<string>>(new Set());
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [courses, setCourses]           = useState<CourseItem[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [courseHoleData, setCourseHoleData] = useState<{ hole_number: number; par: number }[]>([]);

  const [numGroups, setNumGroups] = useState<number>(1);

  // Pickers
  const [showFormat, setShowFormat]   = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);
  const [showCourse, setShowCourse]   = useState(false);
  const [showHoles, setShowHoles]     = useState(false);
  const [showHcp, setShowHcp]         = useState(false);
  const [showTeamSize, setShowTeamSize]   = useState(false);
  const [showCounting, setShowCounting]   = useState(false);
  const [showNumTeams, setShowNumTeams]   = useState(false);
  const [showNumGroups, setShowNumGroups] = useState(false);
  const [showMashie, setShowMashie] = useState(false);
  const [showGroupBuilder, setShowGroupBuilder] = useState(false);
  const [builtMatches, setBuiltMatches] = useState<BuiltMatch[] | null>(null);
  const [playerOverrides, setPlayerOverrides] = useState<Record<string, PlayerOverride>>({});

  useFocusEffect(useCallback(() => {
    setMode((resumeMode as GameMode | undefined) ?? 'stableford');
    setPair1([]); setPair2([]); setPairStep(1);
    setSelectedCourse(existingDayId && preselectedCourse ? preselectedCourse : null);
    setHcpAllowance(100); setSideGames([]); setSecondaryFormat('stableford');
    setWhsEnabled(false); setPlayerTees({}); setTeePickerPlayerId(null); setShowWhsDetails(false);
    setHoles('full18'); setVoiceEnabled(false); setStatsEnabled(false); setLdActive(false); setNpActive(false);
    setLdHole(null); setNtpHole(null); setCreating(false); setTakenPlayerIds([]);
    setTeamSize(2); setCounting(2); setNumTeams(2); setExtraTeams([]);
    setStartHole(1); setBuiltMatches(null);
    setShowFormat(false); setShowPlayers(false); setShowCourse(false); setShowMashie(false); setShowGroupBuilder(false);
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
        setTimeout(() => setShowGroupBuilder(true), 300);
      }
    }
  }, [existingDayId, preselectedCourse, openPlayers, resumeMode]));

  useEffect(() => {
    if (!selectedCourse) { setCourseHoleData([]); return; }
    supabase.from('course_holes').select('hole_number,par').eq('course_name', selectedCourse).order('hole_number')
      .then(({ data }) => { if (data) setCourseHoleData(data as any[]); });
  }, [selectedCourse]);

  useEffect(() => {
    setPlayerTees({});
    if (!selectedCourse) { setCourseTees([]); return; }
    fetchCourseTees(selectedCourse).then(setCourseTees);
  }, [selectedCourse]);

  useEffect(() => {
    if (societyLoading) return;
    // green_lat/green_lng populated (via the admin GPS download tool) is
    // the same signal the rangefinder itself checks for — a course "has
    // GPS data" once at least one hole carries it.
    Promise.all([
      fetchAllRows<{ course_name: string; par: number; green_lat: number | null; green_lng: number | null }>(
        (from, to) => supabase.from('course_holes').select('course_name, par, green_lat, green_lng').range(from, to)
      ),
      supabase.from('courses').select('name, region'),
    ]).then(([data, { data: regionRows }]) => {
      const parMap: Record<string, number> = {};
      const gpsMap: Record<string, boolean> = {};
      for (const row of data) {
        parMap[row.course_name] = (parMap[row.course_name] ?? 0) + row.par;
        if (row.green_lat != null && row.green_lng != null) gpsMap[row.course_name] = true;
      }
      const regionMap: Record<string, string | null> = {};
      for (const r of (regionRows ?? []) as any[]) regionMap[r.name] = r.region;
      setCourses(Object.entries(parMap)
        .map(([name, par]) => ({ name, par, hasGps: !!gpsMap[name], region: regionMap[name] ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name)));
      setLoadingCourses(false);
    });
    if (!societyId) { setLoadingPlayers(false); return; }
    (async () => {
      const { data: members } = await supabase.from('society_members').select('player_id').eq('society_id', societyId);
      const societyIds = new Set((members ?? []).map((m: any) => m.player_id as string));

      let societyPlayers: Player[] = [];
      if (societyIds.size > 0) {
        const { data } = await supabase
          .from('players').select('id, display_name, handicap_index, avatar_url')
          .in('id', Array.from(societyIds)).order('display_name');
        societyPlayers = (data ?? []) as Player[];
      }

      const { data: groupData } = await supabase.from('player_groups').select('id,name,player_ids').eq('society_id', societyId).order('name');
      if (groupData) setGroups(groupData as PlayerGroup[]);

      // Favourites/recently-played/private-library "friends" all key off the
      // logged-in user's own id — fetched here (not a separate parallel
      // effect) so the final setPlayers below can't race the society fetch
      // above and silently drop the merged-in friends.
      const { data: { user } } = await supabase.auth.getUser();
      let allPlayers = societyPlayers;
      const friendIds = new Set<string>();
      if (user) {
        const { data: me } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
        if (me) {
          const myId = (me as any).id;
          setMyPlayerId(myId);
          const [favIds, recentPlayed, libRes] = await Promise.all([
            fetchFavouriteIds(myId),
            fetchRecentlyPlayedWithIds(myId),
            supabase.rpc('get_my_player_library'),
          ]);
          setFavouriteIds(favIds);
          setRecentIds(recentPlayed);

          // Someone in your private library who isn't a society member (e.g.
          // added by T-Tag from elsewhere) was previously invisible here —
          // fold real, non-guest library entries in as their own "Friends"
          // tier below Society Players.
          const extraFriends: Player[] = [];
          for (const e of (libRes.data ?? []) as any[]) {
            if (e.is_guest || !e.member_player_id || societyIds.has(e.member_player_id)) continue;
            friendIds.add(e.member_player_id);
            extraFriends.push({
              id: e.member_player_id,
              display_name: e.display_name,
              handicap_index: e.handicap_index,
              avatar_url: e.avatar_url,
            });
          }
          allPlayers = [...societyPlayers, ...extraFriends];
        }
      }
      setPlayers(allPlayers);
      setFriendOnlyIds(friendIds);
      setLoadingPlayers(false);
    })();
  }, [societyId, societyLoading]);

  async function handleToggleFavourite(targetId: string, makeFav: boolean) {
    if (!myPlayerId) return;
    setFavouriteIds(prev => {
      const next = new Set(prev);
      if (makeFav) next.add(targetId); else next.delete(targetId);
      return next;
    });
    const err = await toggleFavourite(myPlayerId, targetId, makeFav);
    if (err) Alert.alert('Error', err);
  }

  const isSolo    = ['stableford', 'medal', 'skins', 'scramble', 'par_bogey'].includes(mode);
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

  function handleGroupBuilderDone(matches: BuiltMatch[], overrides: Record<string, PlayerOverride>) {
    setBuiltMatches(matches);
    setPlayerOverrides(overrides);
    setShowGroupBuilder(false);
    // Mirror into pair1/pair2 for legacy code paths that read them
    const home0 = matches[0]?.home ?? [];
    const away0 = matches[0]?.away ?? [];
    setPair1(home0.length > 0 ? home0 : away0);
    setPair2(away0.length > 0 && home0.length > 0 ? away0 : []);
  }

  const playersLabel = (() => {
    if (!builtMatches || builtMatches.length === 0) return 'Add players';
    const allPlayerIds = new Set(builtMatches.flatMap(m => [...m.home, ...m.away]));
    if (builtMatches.length === 1) {
      const ids = [...builtMatches[0].home, ...builtMatches[0].away];
      const names = ids.map(id => players.find(p => p.id === id)?.display_name.split(' ')[0] ?? '?');
      return names.length <= 2 ? names.join(' & ') : `${names[0]} +${names.length - 1} more`;
    }
    return `${allPlayerIds.size} players · ${builtMatches.length} groups`;
  })();

  const formatLabel  = MODE_INFO[mode]?.label ?? 'Stableford';
  const holesLabel   = HOLES_OPTIONS.find(h => h.key === holesMode)?.label ?? 'Full 18';
  const hcpLabel     = HCP_ALLOWANCES.find(h => h.pct === hcpAllowance)?.label ?? `${hcpAllowance}%`;
  const isTeamMode   = mode === 'team_stableford' || isMashie;
  const allTeamsFilled = numTeams === 2
    ? pair2.length >= 1
    : (pair2.length >= 1 && extraTeams.filter(t => t.length >= 1).length >= numTeams - 2);
  const allRoundPlayerIds = useMemo(
    () => builtMatches ? [...new Set(builtMatches.flatMap(m => [...m.home, ...m.away]))] : [],
    [builtMatches]
  );
  const whsReady = !whsEnabled || allRoundPlayerIds.every(pid => {
    const t = playerTees[pid];
    return t && t.par != null && t.course_rating != null && t.slope_rating != null;
  });
  const canStart     = !!selectedCourse && !!builtMatches && builtMatches.length > 0 && !creating && whsReady;
  const selectedItem = courses.find(c => c.name === selectedCourse);

  async function createGame() {
    if (!selectedCourse || !societyId || creating) return;
    if (whsEnabled) {
      const missing = allRoundPlayerIds.filter(pid => {
        const t = playerTees[pid];
        return !t || t.par == null || t.course_rating == null || t.slope_rating == null;
      });
      if (missing.length > 0) {
        const names = missing.map(pid => players.find(p => p.id === pid)?.display_name ?? 'a player').join(', ');
        Alert.alert('WHS Handicap', `Select a rated tee for: ${names}`);
        return;
      }
    }
    console.log('[createGame] start', { mode, selectedCourse });
    setCreating(true);
    try {
      let resolvedDayId: string;
      let dayCode: string | null = null;

      if (existingDayId) {
        resolvedDayId = existingDayId;
        console.log('[createGame] using existing day', { resolvedDayId });
      } else {
        console.log('[createGame] creating game day...');
        const { data: dayResult, error: dayErr } = await supabase.rpc('create_game_day_with_code', {
          p_society_id: societyId,
          p_course_name: selectedCourse,
        });
        if (dayErr) throw dayErr;
        const row = Array.isArray(dayResult) ? dayResult[0] : dayResult;
        resolvedDayId = row.day_id;
        dayCode = row.join_code;
        console.log('[createGame] game day created', { resolvedDayId, dayCode });
      }

      if (whsEnabled) {
        await supabase.from('competition_days').update({ whs_enabled: true }).eq('id', resolvedDayId);
        const snapshotRows = allRoundPlayerIds.map(pid => {
          const p = players.find(pl => pl.id === pid)!;
          const tee = playerTees[pid];
          const whs = calculateWHSPlayingHandicap(p.handicap_index, tee.slope_rating!, tee.course_rating!, tee.par!, hcpAllowance);
          return {
            day_id: resolvedDayId,
            player_id: pid,
            tee_name: tee.tee_name,
            gender: tee.gender,
            handicap_index_at_start: p.handicap_index,
            slope_at_start: tee.slope_rating,
            course_rating_at_start: tee.course_rating,
            par_at_start: tee.par,
            course_handicap_at_start: whs.courseHandicapUnrounded,
            allowance_at_start: hcpAllowance,
            playing_handicap_at_start: whs.playingHandicap,
            whs_enabled_at_start: true,
          };
        });
        if (snapshotRows.length > 0) {
          await supabase.from('round_player_tees').upsert(snapshotRows, { onConflict: 'day_id,player_id' });
        }
      }

      const matchNum = Math.floor(Date.now() / 1000) % 100000;
      const sideGamesList = [
        ...(ldActive && ldHole ? [`Longest Drive:${ldHole}`] : []),
        ...(npActive && ntpHole ? [`Closest to Pin:${ntpHole}`] : []),
        ...(voiceEnabled ? ['voice:on'] : []),
        ...(statsEnabled ? [] : ['stats:off']),
      ];

      const isTeamStableford = mode === 'team_stableford' || isMashie;
      const teamCommonFields = {
        competition_id: null,
        day_id: resolvedDayId,
        match_number: matchNum,
        home_team_id: null,
        away_team_id: null,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        holes_string: '..................',
        start_hole: startHole,
        holes_to_play: holesMode === 'full18' ? 18 : 9,
        is_singles: mode === 'singles',
        round_format: (mode === '4bbb' || mode === '4bbb_stroke' || mode === 'singles') ? 'matchplay' : isMashie ? 'team_stableford' : mode,
        hcp_allowance: hcpAllowance,
        handicap_method: mode === '4bbb_stroke' ? 'relative_low' : mode === '4bbb' ? 'relative_low_stableford' : 'individual',
        side_games: mode === 'best2from4_par3all' ? [...sideGamesList, 'par3all'] : sideGamesList,
        secondary_format: secondaryFormat,
        ...(isTeamStableford ? { team_size: isMashie ? 4 : teamSize, counting_scores: isMashie ? 2 : countingScores } : {}),
      };

      let newMatch: any;
      let firstMatchId: string;

      if (!builtMatches || builtMatches.length === 0) throw new Error('No players selected');

      console.log('[createGame] inserting matches...', { count: builtMatches.length });
      const results = await Promise.all(builtMatches.map(bm => {
        const extra = isMashie ? { group_code: genGroupCode() } : {};
        const nameExtra = (bm.homeName || bm.awayName)
          ? { home_name: bm.homeName || null, away_name: bm.awayName || null }
          : {};
        const matchPlayerIds = new Set([...bm.home, ...bm.away]);
        const matchOverrides = Object.fromEntries(
          Object.entries(playerOverrides).filter(([id]) => matchPlayerIds.has(id))
        );
        return supabase.from('matches').insert({
          ...teamCommonFields,
          ...extra,
          ...nameExtra,
          start_hole: bm.startHole,
          home_player_ids: bm.home,
          away_player_ids: bm.away,
          ...(Object.keys(matchOverrides).length > 0 ? { player_overrides: matchOverrides } : {}),
        }).select().single();
      }));

      const firstResult = results[0];
      if (firstResult.error || !firstResult.data) throw firstResult.error ?? new Error('Could not create game');
      newMatch = firstResult.data;
      firstMatchId = firstResult.data.id;
      console.log('[createGame] matches inserted', { firstMatchId, matchIds: results.map(r => r.data?.id) });
      results.forEach(r => { if (r.data?.id) downloadMatchPack(r.data.id).catch(() => {}); });
      // Signal is at its best right now (clubhouse), so grab the course's GPS
      // data too — otherwise rangefinder only tries on first use, out on the
      // course, where it can be too weak to ever complete.
      downloadCourseGps(selectedCourse).catch(() => {});

      if (isMashie) {
        // Group codes are already visible in Admin → Codes ("MASHIE GROUP CODES")
        // — Dave no longer wants the extra popup here, just go straight to the day.
        setCreating(false);
        router.push(`/(app)/score/day/${resolvedDayId}` as any);
        return;
      }

      setCreating(false);

      if (builtMatches.length > 1) {
        console.log('[createGame] navigating to day', { resolvedDayId });
        router.push(`/(app)/score/day/${resolvedDayId}` as any);
      } else if (isTeamStableford) {
        console.log('[createGame] navigating to teamstableford', { firstMatchId });
        router.push(`/(app)/score/teamstableford/${firstMatchId}` as any);
      } else if (existingDayId) {
        console.log('[createGame] navigating to day (existing)', { resolvedDayId });
        router.push(`/(app)/score/day/${resolvedDayId}` as any);
      } else {
        const paramParts: string[] = [];
        if (dayCode) { paramParts.push(`dayId=${resolvedDayId}`); paramParts.push(`dayCode=${dayCode}`); }
        const sh = builtMatches[0].startHole;
        if (sh !== 1) paramParts.push(`startHole=${sh}`);
        const params = paramParts.length > 0 ? `?${paramParts.join('&')}` : '';
        console.log('[createGame] navigating to preview', { firstMatchId, params });
        router.push(`/(app)/score/preview/${firstMatchId}${params}` as any);
      }
    } catch (e: any) {
      console.error('[createGame] failed', e);
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
        <TouchableOpacity onPress={() => goBack(router, '/(app)/games')} style={s.headerSide} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close-outline" size={28} color="#ffffff" />
        </TouchableOpacity>
        <View style={s.headerCenter} />
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
          <SettingRow icon="people-outline" label="Players" value={playersLabel} valueColor={!builtMatches ? GOLD : undefined} onPress={() => setShowGroupBuilder(true)} s={s} GOLD={GOLD} />
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

          {/* WHS Handicap — off by default; existing behaviour is unchanged until this is switched on */}
          <SettingRow
            icon="calculator-outline" label="WHS Handicap"
            value={whsEnabled ? 'On' : 'Off'} valueColor={whsEnabled ? GOLD : '#6b7280'}
            onPress={() => whsEnabled && setShowWhsDetails(true)}
            s={s} GOLD={GOLD}
          >
            <TouchableOpacity
              onPress={() => setWhsEnabled(v => !v)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <View style={[s.toggle, whsEnabled && s.toggleOn]}>
                <View style={[s.toggleThumb, whsEnabled && s.toggleThumbOn]} />
              </View>
            </TouchableOpacity>
          </SettingRow>
          <View style={s.settingDivider} />

          {whsEnabled && allRoundPlayerIds.length > 0 && (
            <>
              {allRoundPlayerIds.map(pid => {
                const p = players.find(pl => pl.id === pid);
                const tee = playerTees[pid];
                return (
                  <View key={pid}>
                    <SettingRow
                      icon="flag-outline"
                      label={p?.display_name ?? 'Player'}
                      value={tee ? `${tee.tee_name}${tee.gender ? ` (${tee.gender})` : ''}` : 'Select tee'}
                      valueColor={tee ? GOLD : '#f87171'}
                      onPress={() => setTeePickerPlayerId(pid)}
                      s={s} GOLD={GOLD}
                    />
                    <View style={s.settingDivider} />
                  </View>
                );
              })}
            </>
          )}

          {/* Chip & Birdie */}
          <SettingRow icon="mic-outline" label="Chip & Birdie" value={voiceEnabled ? 'On' : 'Off'} valueColor={voiceEnabled ? GOLD : '#6b7280'} onPress={() => setVoiceEnabled(v => !v)} s={s} GOLD={GOLD}>
            <View style={[s.toggle, voiceEnabled && s.toggleOn]}>
              <View style={[s.toggleThumb, voiceEnabled && s.toggleThumbOn]} />
            </View>
          </SettingRow>
          <View style={s.settingDivider} />

          {/* Track Stats */}
          <SettingRow icon="analytics-outline" label="Track Stats" value={statsEnabled ? 'On' : 'Off'} valueColor={statsEnabled ? GOLD : '#6b7280'} onPress={() => setStatsEnabled(v => !v)} s={s} GOLD={GOLD}>
            <View style={[s.toggle, statsEnabled && s.toggleOn]}>
              <View style={[s.toggleThumb, statsEnabled && s.toggleThumbOn]} />
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

          {mode !== 'stableford' && (
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
            </>
          )}
          {mode !== 'stableford' && mode !== 'medal' && (
            <>
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

        {/* ── Ready to Play ───────────────────────────────────── */}
        <Text style={s.sectionLabel}>READY TO PLAY</Text>
        <View style={s.readyCard}>
          <View style={s.readyItem}>
            <Ionicons name="people-outline" size={20} color={GOLD} />
            <Text style={s.readyLabel}>PLAYERS</Text>
            <Text style={[s.readyValue, builtMatches && { color: GREEN }]}>
              {builtMatches ? new Set(builtMatches.flatMap(m => [...m.home, ...m.away])).size : '—'}
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
          {whsEnabled && (
            <>
              <View style={s.readyDivider} />
              <View style={s.readyItem}>
                <Ionicons name="calculator-outline" size={20} color={GOLD} />
                <Text style={s.readyLabel}>WHS</Text>
                <Text style={[s.readyValue, { color: whsReady ? GREEN : '#f87171' }]}>
                  {whsReady ? 'Set' : 'Tees needed'}
                </Text>
              </View>
            </>
          )}
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
      <TeePickerSheet
        visible={!!teePickerPlayerId}
        title={`Select tee — ${players.find(p => p.id === teePickerPlayerId)?.display_name ?? ''}`}
        tees={courseTees}
        onSelect={tee => {
          if (teePickerPlayerId) setPlayerTees(prev => ({ ...prev, [teePickerPlayerId]: tee }));
          setTeePickerPlayerId(null);
        }}
        onClose={() => setTeePickerPlayerId(null)}
      />
      <Modal visible={showWhsDetails} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowWhsDetails(false)}>
        <View style={{ flex: 1, backgroundColor: '#000', paddingTop: 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' }}>
            <TouchableOpacity onPress={() => setShowWhsDetails(false)}><Text style={{ color: '#fff', fontFamily: 'JUSTSans-ExBold', fontSize: 14 }}>Close</Text></TouchableOpacity>
            <Text style={{ color: '#fff', fontFamily: 'JUSTSans-ExBold', fontSize: 13, letterSpacing: 1 }}>WHS HANDICAPS</Text>
            <View style={{ width: 50 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {allRoundPlayerIds.map(pid => {
              const p = players.find(pl => pl.id === pid);
              const tee = playerTees[pid];
              const ready = p && tee && tee.par != null && tee.course_rating != null && tee.slope_rating != null;
              const whs = ready ? calculateWHSPlayingHandicap(p!.handicap_index, tee!.slope_rating!, tee!.course_rating!, tee!.par!, hcpAllowance) : null;
              return (
                <View key={pid} style={{ marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' }}>
                  <Text style={{ color: '#fff', fontFamily: 'JUSTSans-ExBold', fontSize: 14, marginBottom: 4 }}>{p?.display_name}</Text>
                  <Text style={{ color: '#9ca3af', fontFamily: 'JUSTSans-ExBold', fontSize: 11 }}>
                    HI {p?.handicap_index}{tee ? ` · Tee ${tee.tee_name}${tee.gender ? ` (${tee.gender})` : ''} · CR ${tee.course_rating ?? '—'} · Slope ${tee.slope_rating ?? '—'}` : ' · No tee selected'}
                  </Text>
                  <Text style={{ color: GOLD, fontFamily: 'JUSTSans-ExBold', fontSize: 20, marginTop: 6 }}>
                    {whs ? `PLAYING HANDICAP: ${whs.playingHandicap}` : 'Unavailable — select a rated tee'}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
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
      <GroupBuilderSheet
        visible={showGroupBuilder}
        mode={mode}
        players={players}
        teamSize={teamSize}
        initialStartHole={startHole}
        initialMatches={builtMatches ?? undefined}
        favouriteIds={favouriteIds}
        recentIds={recentIds}
        myPlayerId={myPlayerId}
        friendOnlyIds={friendOnlyIds}
        onToggleFavourite={handleToggleFavourite}
        onDone={handleGroupBuilderDone}
        onClose={() => setShowGroupBuilder(false)}
      />
      <CourseSheet visible={showCourse} courses={courses} selected={selectedCourse} onSelect={setSelectedCourse} onClose={() => setShowCourse(false)} ps={ps} GOLD={GOLD} />
      <PickerSheet
        visible={showHoles} title="Holes" options={HOLES_OPTIONS}
        selected={holesMode}
        onSelect={(v: HolesMode) => {
          setHoles(v);
          // Back 9 only means something if play actually starts at hole 10 —
          // nudge the default start hole along, but only when it's still at
          // the untouched default so a deliberately custom start isn't clobbered.
          if (v === 'back9' && startHole === 1) setStartHole(10);
          else if (v !== 'back9' && startHole === 10) setStartHole(1);
        }}
        onClose={() => setShowHoles(false)}
        ps={ps} GOLD={GOLD}
      />
      <PickerSheet
        visible={showHcp} title="Handicap Allowance" options={HCP_ALLOWANCES.map(h => ({ key: h.pct.toString() as any, label: h.label }))}
        selected={hcpAllowance.toString() as any}
        onSelect={(v: any) => {
          if (v === '-1') {
            Alert.prompt('Handicap Allowance', 'Enter a percentage (1–100):', (txt) => {
              const n = parseInt(txt, 10);
              if (!isNaN(n) && n >= 1 && n <= 100) setHcpAllowance(n);
            }, 'plain-text', '', 'number-pad');
          } else {
            setHcpAllowance(parseInt(v, 10));
          }
        }}
        onClose={() => setShowHcp(false)}
        ps={ps} GOLD={GOLD}
      />
      <PickerSheet
        visible={showNumGroups} title="Total Groups"
        options={Array.from({ length: 50 }, (_, i) => ({ key: String(i + 1), label: i === 0 ? '1 group' : `${i + 1} groups` }))}
        selected={numGroups.toString() as any}
        onSelect={(v: any) => setNumGroups(parseInt(v, 10))}
        onClose={() => setShowNumGroups(false)}
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

