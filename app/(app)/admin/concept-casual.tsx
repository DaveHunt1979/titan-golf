/**
 * Concept Preview — TITAN premium Casual Round setup screen
 * Single-screen design replacing the current 4-step wizard
 */
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, Modal, FlatList, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useSocietyTheme } from '../../../src/lib/SocietyThemeContext';

const GOLD  = '#D4AF37';
const GREEN = '#22c55e';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const { width: W } = Dimensions.get('window');

type Format     = 'Stableford' | 'Medal' | 'Matchplay' | 'Skins' | 'Scramble';
type SecondGame = 'None' | Format;
type Tees       = 'Yellow' | 'White' | 'Red' | 'Blue' | 'Black';
type Holes      = 'Full 18' | 'Front 9' | 'Back 9';

const FORMATS: Format[]         = ['Stableford', 'Medal', 'Matchplay', 'Skins', 'Scramble'];
const SECOND_GAMES: SecondGame[] = ['None', 'Stableford', 'Medal', 'Matchplay', 'Skins', 'Scramble'];
const TEES_LIST: Tees[]          = ['Yellow', 'White', 'Red', 'Blue', 'Black'];
const HOLES_LIST: Holes[]        = ['Full 18', 'Front 9', 'Back 9'];
const ALL_HOLES                  = Array.from({ length: 18 }, (_, i) => String(i + 1));

interface Player { id: string; display_name: string; handicap_index: number | null; avatar_url?: string | null }
interface Course { name: string; par: number }

function nowTime(): string {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ── Picker sheet ──────────────────────────────────────────────
function PickerSheet<T extends string>({
  visible, title, options, selected, onSelect, onClose,
}: {
  visible: boolean; title: string; options: T[];
  selected: T; onSelect: (v: T) => void; onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={ps.overlay} activeOpacity={1} onPress={onClose} />
      <View style={ps.sheet}>
        <View style={ps.handle} />
        <Text style={ps.sheetTitle}>{title}</Text>
        {options.map(opt => (
          <TouchableOpacity
            key={opt} style={ps.sheetRow}
            onPress={() => { onSelect(opt); onClose(); }}
            activeOpacity={0.7}
          >
            <Text style={[ps.sheetOpt, opt === selected && ps.sheetOptOn]}>{opt}</Text>
            {opt === selected && <Ionicons name="checkmark" size={18} color={GOLD} />}
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={ps.cancelBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={ps.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ── Player picker sheet ───────────────────────────────────────
function PlayerSheet({
  visible, players, selected, currentId, onToggle, onClose,
}: {
  visible: boolean; players: Player[]; selected: string[];
  currentId: string; onToggle: (id: string) => void; onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={ps.overlay} activeOpacity={1} onPress={onClose} />
      <View style={[ps.sheet, { maxHeight: '70%' }]}>
        <View style={ps.handle} />
        <Text style={ps.sheetTitle}>Add Players</Text>
        <FlatList
          data={players.filter(p => p.id !== currentId)}
          keyExtractor={p => p.id}
          renderItem={({ item }) => {
            const on = selected.includes(item.id);
            return (
              <TouchableOpacity style={ps.sheetRow} onPress={() => onToggle(item.id)} activeOpacity={0.7}>
                <View style={ps.playerRow}>
                  <View style={ps.playerAvatar}>
                    {item.avatar_url
                      ? <Image source={{ uri: item.avatar_url }} style={ps.playerAvatarImg} />
                      : <Text style={ps.playerAvatarLetter}>{item.display_name.charAt(0)}</Text>
                    }
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[ps.sheetOpt, on && ps.sheetOptOn]}>{item.display_name}</Text>
                    {item.handicap_index != null && (
                      <Text style={ps.playerHcp}>HCP {item.handicap_index}</Text>
                    )}
                  </View>
                  {on && <Ionicons name="checkmark-circle" size={22} color={GOLD} />}
                </View>
              </TouchableOpacity>
            );
          }}
          style={{ flexGrow: 0 }}
        />
        <TouchableOpacity style={ps.doneBtn} onPress={onClose} activeOpacity={0.8}>
          <Text style={ps.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ── Course picker sheet ───────────────────────────────────────
function CourseSheet({
  visible, courses, selected, onSelect, onClose,
}: {
  visible: boolean; courses: Course[]; selected: string | null;
  onSelect: (name: string) => void; onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={ps.overlay} activeOpacity={1} onPress={onClose} />
      <View style={[ps.sheet, { maxHeight: '75%' }]}>
        <View style={ps.handle} />
        <Text style={ps.sheetTitle}>Select Course</Text>
        <FlatList
          data={courses}
          keyExtractor={c => c.name}
          renderItem={({ item }) => {
            const on = item.name === selected;
            return (
              <TouchableOpacity style={ps.sheetRow} onPress={() => { onSelect(item.name); onClose(); }} activeOpacity={0.7}>
                <Text style={[ps.sheetOpt, on && ps.sheetOptOn]}>{item.name}</Text>
                <Text style={ps.courseParLabel}>Par {item.par}</Text>
              </TouchableOpacity>
            );
          }}
          style={{ flexGrow: 0 }}
        />
        <TouchableOpacity style={ps.cancelBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={ps.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────
export default function ConceptCasualScreen() {
  const { societyId } = useSocietyTheme();
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  // Data
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [allPlayers,    setAllPlayers]    = useState<Player[]>([]);
  const [courses,       setCourses]       = useState<Course[]>([]);
  const [clubCount,     setClubCount]     = useState(0);
  const [taggedCount,   setTaggedCount]   = useState(0);
  const [notifCount,    setNotifCount]    = useState(0);
  const [loading,       setLoading]       = useState(true);

  // Settings
  const [selectedCourse,  setSelectedCourse]  = useState<string | null>(null);
  const [extraPlayers,    setExtraPlayers]    = useState<string[]>([]);
  const [format,          setFormat]          = useState<Format>('Stableford');
  const [tees,            setTees]            = useState<Tees>('Yellow');
  const [holes,           setHoles]           = useState<Holes>('Full 18');
  const [trackClubs,      setTrackClubs]      = useState(true);
  const [aiCommentary,    setAiCommentary]    = useState(true);

  // Scorecard
  const [courseHoles,   setCourseHoles]   = useState<{ hole_number: number; par: number; stroke_index: number }[]>([]);
  const [showScorecard, setShowScorecard] = useState(false);

  // Pickers open state
  // Side games
  const [secondGame,     setSecondGame]     = useState<SecondGame>('None');
  const [ldActive,       setLdActive]       = useState(false);
  const [ldHole,         setLdHole]         = useState<string | null>(null);
  const [npActive,       setNpActive]       = useState(false);
  const [npHole,         setNpHole]         = useState<string | null>(null);
  const [twosActive,     setTwosActive]     = useState(false);

  // Groups
  const [groupCount,     setGroupCount]     = useState(1);
  const [combineGroups,  setCombineGroups]  = useState(false);

  // Pickers open
  const [showCourse,      setShowCourse]      = useState(false);
  const [showPlayers,     setShowPlayers]     = useState(false);
  const [showFormat,      setShowFormat]      = useState(false);
  const [showTees,        setShowTees]        = useState(false);
  const [showHoles,       setShowHoles]       = useState(false);
  const [showSecondGame,  setShowSecondGame]  = useState(false);
  const [showLdHole,      setShowLdHole]      = useState(false);
  const [showNpHole,      setShowNpHole]      = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: player } = await supabase
      .from('players')
      .select('id, display_name, handicap_index, avatar_url')
      .eq('auth_uid', user.id)
      .maybeSingle();

    if (player) {
      const p = player as any;
      setCurrentPlayer(p);

      // Clubs
      const { data: clubs } = await supabase
        .from('clubs').select('in_bag, nfc_tag_id').eq('player_id', p.id);
      const bag    = (clubs ?? []).filter((c: any) => c.in_bag);
      const tagged = bag.filter((c: any) => c.nfc_tag_id);
      setClubCount(bag.length);
      setTaggedCount(tagged.length);

      // Society players
      if (societyId) {
        const { data: members } = await supabase
          .from('society_members').select('player_id').eq('society_id', societyId);
        if (members && members.length > 0) {
          const ids = (members as any[]).map(m => m.player_id);
          const { data: ps } = await supabase
            .from('players').select('id, display_name, handicap_index, avatar_url')
            .in('id', ids).order('display_name');
          setAllPlayers((ps ?? []) as Player[]);
        }
      }
    }

    // Courses
    const { data: holes } = await supabase.from('course_holes').select('course_name, par');
    if (holes) {
      const map: Record<string, number> = {};
      for (const row of holes as any[]) map[row.course_name] = (map[row.course_name] ?? 0) + row.par;
      const list = Object.entries(map).map(([name, par]) => ({ name, par })).sort((a, b) => a.name.localeCompare(b.name));
      setCourses(list);
      if (list.length > 0) setSelectedCourse(list[0].name);
    }

    // Notifications
    const { data: notifs } = await supabase.from('notifications').select('id').limit(5);
    setNotifCount((notifs as any)?.length ?? 0);

    setLoading(false);
  }, [societyId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selectedCourse) { setCourseHoles([]); return; }
    supabase.from('course_holes').select('hole_number, par, stroke_index')
      .eq('course_name', selectedCourse).order('hole_number')
      .then(({ data }) => setCourseHoles((data ?? []) as any[]));
  }, [selectedCourse]);

  const toggleExtraPlayer = (id: string) =>
    setExtraPlayers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const playerLabel = () => {
    if (!currentPlayer) return '—';
    const extras = extraPlayers.length;
    return extras > 0 ? `${currentPlayer.display_name.split(' ')[0]} + ${extras}` : currentPlayer.display_name.split(' ')[0];
  };

  const isReady = fontsLoaded && !loading;

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={s.headerSide}
        >
          <Ionicons name="chevron-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image
            source={require('../../../assets/TitanAppLogo.png')}
            style={s.headerLogo}
            resizeMode="contain"
          />
        </View>
        <View style={[s.headerSide, { alignItems: 'flex-end' }]}>
          <View style={s.bellWrap}>
            <Ionicons name="notifications-outline" size={24} color="#ffffff" />
            {notifCount > 0 && <View style={s.notifDot} />}
          </View>
        </View>
      </View>

      {!isReady ? (
        <View style={s.centered}><ActivityIndicator color={GOLD} size="large" /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

          {/* ── Page title ── */}
          <Text style={s.pageTitle}>Casual Round</Text>
          <Text style={s.pageSubtitle}>Start a premium practice or social round</Text>

          {/* ── Course card ── */}
          <TouchableOpacity
            style={s.courseCard}
            onPress={() => setShowCourse(true)}
            activeOpacity={0.9}
          >
            {/* Hero image */}
            <Image
              source={require('../../../assets/hero-course.jpeg')}
              style={s.courseHero}
              resizeMode="cover"
            />
            {/* Overlay gradient */}
            <View style={s.courseOverlay} />

            {/* TODAY badge */}
            <View style={s.todayBadge}>
              <Text style={s.todayText}>TODAY</Text>
            </View>

            {/* Course info */}
            <View style={s.courseInfo}>
              <Text style={s.courseName}>{selectedCourse ?? 'Select a course'}</Text>
              <View style={s.courseMetaRow}>
                <Ionicons name="location-outline" size={12} color="rgba(255,255,255,0.6)" />
                <Text style={s.courseMeta}>Tap to change course</Text>
              </View>
              <View style={s.courseMetaRow}>
                <Ionicons name="sunny-outline" size={12} color="rgba(255,255,255,0.6)" />
                <Text style={s.courseMeta}>18°C · Light Wind</Text>
              </View>
            </View>

            {/* Tee time row */}
            <View style={s.teetimeRow}>
              <View style={s.teetimeItem}>
                <Ionicons name="flag-outline" size={13} color="rgba(255,255,255,0.5)" />
                <Text style={s.teetimeItemText}>Hole 1 Start</Text>
              </View>
              <View style={s.teetimeDivider} />
              <View style={s.teetimeItem}>
                <Ionicons name="time-outline" size={13} color="rgba(255,255,255,0.5)" />
                <Text style={s.teetimeItemText}>{nowTime()} Tee Time</Text>
              </View>
              <TouchableOpacity style={s.startBtn} activeOpacity={0.8} onPress={() => router.push('/(app)/admin/concept-score' as any)}>
                <Text style={s.startBtnText}>Start Round</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>

          {/* ── Settings rows ── */}
          <View style={s.settingsCard}>
            {/* Course */}
            <TouchableOpacity style={s.settingRow} onPress={() => setShowCourse(true)} activeOpacity={0.7}>
              <View style={s.settingLeft}>
                <View style={s.settingIconWrap}>
                  <Ionicons name="map-outline" size={16} color={GOLD} />
                </View>
                <Text style={s.settingLabel}>Course</Text>
              </View>
              <View style={s.settingRight}>
                <Text style={s.settingValue} numberOfLines={1}>{selectedCourse ?? 'Select…'}</Text>
                <Ionicons name="chevron-forward" size={14} color="#444" />
              </View>
            </TouchableOpacity>
            <View style={s.settingDivider} />

            {/* Players */}
            <TouchableOpacity style={s.settingRow} onPress={() => setShowPlayers(true)} activeOpacity={0.7}>
              <View style={s.settingLeft}>
                <View style={s.settingIconWrap}>
                  <Ionicons name="people-outline" size={16} color={GOLD} />
                </View>
                <Text style={s.settingLabel}>Players</Text>
              </View>
              <View style={s.settingRight}>
                <Text style={s.settingValue}>{playerLabel()}</Text>
                <Ionicons name="chevron-forward" size={14} color="#444" />
              </View>
            </TouchableOpacity>
            <View style={s.settingDivider} />

            {/* Format */}
            <TouchableOpacity style={s.settingRow} onPress={() => setShowFormat(true)} activeOpacity={0.7}>
              <View style={s.settingLeft}>
                <View style={s.settingIconWrap}>
                  <Ionicons name="trophy-outline" size={16} color={GOLD} />
                </View>
                <Text style={s.settingLabel}>Format</Text>
              </View>
              <View style={s.settingRight}>
                <Text style={s.settingValue}>{format}</Text>
                <Ionicons name="chevron-forward" size={14} color="#444" />
              </View>
            </TouchableOpacity>
            <View style={s.settingDivider} />

            {/* 2nd Game */}
            <TouchableOpacity style={s.settingRow} onPress={() => setShowSecondGame(true)} activeOpacity={0.7}>
              <View style={s.settingLeft}>
                <View style={s.settingIconWrap}>
                  <Ionicons name="layers-outline" size={16} color={GOLD} />
                </View>
                <View>
                  <Text style={s.settingLabel}>2nd Game</Text>
                  {secondGame !== 'None' && (
                    <Text style={s.settingSubLabel}>Running alongside {format}</Text>
                  )}
                </View>
              </View>
              <View style={s.settingRight}>
                <Text style={[s.settingValue, secondGame !== 'None' && { color: GOLD }]}>
                  {secondGame}
                </Text>
                <Ionicons name="chevron-forward" size={14} color="#444" />
              </View>
            </TouchableOpacity>
            <View style={s.settingDivider} />

            {/* Tees */}
            <TouchableOpacity style={s.settingRow} onPress={() => setShowTees(true)} activeOpacity={0.7}>
              <View style={s.settingLeft}>
                <View style={s.settingIconWrap}>
                  <View style={[s.teeColorDot, { backgroundColor: teeColor(tees) }]} />
                </View>
                <Text style={s.settingLabel}>Tees</Text>
              </View>
              <View style={s.settingRight}>
                <Text style={s.settingValue}>{tees}</Text>
                <Ionicons name="chevron-forward" size={14} color="#444" />
              </View>
            </TouchableOpacity>
            <View style={s.settingDivider} />

            {/* Holes */}
            <TouchableOpacity style={s.settingRow} onPress={() => setShowHoles(true)} activeOpacity={0.7}>
              <View style={s.settingLeft}>
                <View style={s.settingIconWrap}>
                  <Ionicons name="golf-outline" size={16} color={GOLD} />
                </View>
                <Text style={s.settingLabel}>Holes</Text>
              </View>
              <View style={s.settingRight}>
                <Text style={s.settingValue}>{holes}</Text>
                <Ionicons name="chevron-forward" size={14} color="#444" />
              </View>
            </TouchableOpacity>
            <View style={s.settingDivider} />

            {/* Groups */}
            <View style={s.settingRow}>
              <View style={s.settingLeft}>
                <View style={s.settingIconWrap}>
                  <Ionicons name="people-circle-outline" size={16} color={GOLD} />
                </View>
                <View>
                  <Text style={s.settingLabel}>Groups</Text>
                  {groupCount > 1 && <Text style={s.settingSubLabel}>Leaderboard will combine all groups</Text>}
                </View>
              </View>
              <View style={s.settingRight}>
                <TouchableOpacity
                  onPress={() => setGroupCount(n => Math.max(1, n - 1))}
                  style={s.stepperBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={s.stepperBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={s.stepperVal}>{groupCount}</Text>
                <TouchableOpacity
                  onPress={() => setGroupCount(n => Math.min(6, n + 1))}
                  style={s.stepperBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={s.stepperBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={s.settingDivider} />

            {/* Track Clubs */}
            <TouchableOpacity
              style={s.settingRow}
              onPress={() => setTrackClubs(v => !v)}
              activeOpacity={0.7}
            >
              <View style={s.settingLeft}>
                <View style={s.settingIconWrap}>
                  <Ionicons name="wifi-outline" size={16} color={GOLD} />
                </View>
                <Text style={s.settingLabel}>Track Clubs</Text>
              </View>
              <View style={s.settingRight}>
                <Text style={[s.settingValue, { color: trackClubs ? GREEN : '#6b7280' }]}>
                  {trackClubs ? 'NFC Enabled' : 'Disabled'}
                </Text>
                <View style={[s.toggle, trackClubs && s.toggleOn]}>
                  <View style={[s.toggleThumb, trackClubs && s.toggleThumbOn]} />
                </View>
              </View>
            </TouchableOpacity>
            <View style={s.settingDivider} />

            {/* Scoring */}
            <View style={s.settingRow}>
              <View style={s.settingLeft}>
                <View style={s.settingIconWrap}>
                  <Ionicons name="stats-chart-outline" size={16} color={GOLD} />
                </View>
                <Text style={s.settingLabel}>Scoring</Text>
              </View>
              <View style={s.settingRight}>
                <Text style={s.settingValue}>{format}</Text>
              </View>
            </View>
            <View style={s.settingDivider} />

            {/* AI Commentary */}
            <TouchableOpacity style={s.settingRow} onPress={() => setAiCommentary(v => !v)} activeOpacity={0.7}>
              <View style={s.settingLeft}>
                <View style={[s.settingIconWrap, aiCommentary && { backgroundColor: `${GOLD}18`, borderColor: `${GOLD}40` }]}>
                  <Ionicons name="mic-outline" size={16} color={aiCommentary ? GOLD : '#6b7280'} />
                </View>
                <View>
                  <Text style={s.settingLabel}>AI Commentary</Text>
                  <Text style={s.settingSubLabel}>Chip &amp; Birdie live audio</Text>
                </View>
              </View>
              <View style={s.settingRight}>
                <Text style={[s.settingValue, { color: aiCommentary ? GOLD : '#6b7280' }]}>
                  {aiCommentary ? 'On' : 'Off'}
                </Text>
                <View style={[s.toggle, aiCommentary && s.toggleOn]}>
                  <View style={[s.toggleThumb, aiCommentary && s.toggleThumbOn]} />
                </View>
              </View>
            </TouchableOpacity>
          </View>

          {/* ── Side Games ── */}
          <Text style={s.sectionLabel}>SIDE GAMES</Text>
          <View style={s.settingsCard}>

            {/* Longest Drive */}
            <TouchableOpacity style={s.settingRow} onPress={() => setLdActive(v => !v)} activeOpacity={0.7}>
              <View style={s.settingLeft}>
                <View style={[s.settingIconWrap, ldActive && { backgroundColor: `${GOLD}18`, borderColor: `${GOLD}40` }]}>
                  <Ionicons name="arrow-forward-circle-outline" size={16} color={ldActive ? GOLD : '#6b7280'} />
                </View>
                <View>
                  <Text style={[s.settingLabel, !ldActive && { color: '#6b7280' }]}>Longest Drive</Text>
                  {ldActive && (
                    <TouchableOpacity onPress={() => setShowLdHole(true)}>
                      <Text style={s.settingSubLabel}>
                        Hole: <Text style={{ color: GOLD }}>{ldHole ?? 'Pick hole'}</Text>
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              <View style={s.settingRight}>
                <View style={[s.toggle, ldActive && s.toggleOn]}>
                  <View style={[s.toggleThumb, ldActive && s.toggleThumbOn]} />
                </View>
              </View>
            </TouchableOpacity>
            <View style={s.settingDivider} />

            {/* Nearest Pin */}
            <TouchableOpacity style={s.settingRow} onPress={() => setNpActive(v => !v)} activeOpacity={0.7}>
              <View style={s.settingLeft}>
                <View style={[s.settingIconWrap, npActive && { backgroundColor: `${GOLD}18`, borderColor: `${GOLD}40` }]}>
                  <Ionicons name="golf-outline" size={16} color={npActive ? GOLD : '#6b7280'} />
                </View>
                <View>
                  <Text style={[s.settingLabel, !npActive && { color: '#6b7280' }]}>Nearest the Pin</Text>
                  {npActive && (
                    <TouchableOpacity onPress={() => setShowNpHole(true)}>
                      <Text style={s.settingSubLabel}>
                        Hole: <Text style={{ color: GOLD }}>{npHole ?? 'Pick hole'}</Text>
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              <View style={s.settingRight}>
                <View style={[s.toggle, npActive && s.toggleOn]}>
                  <View style={[s.toggleThumb, npActive && s.toggleThumbOn]} />
                </View>
              </View>
            </TouchableOpacity>
            <View style={s.settingDivider} />

            {/* 2s Club */}
            <TouchableOpacity style={s.settingRow} onPress={() => setTwosActive(v => !v)} activeOpacity={0.7}>
              <View style={s.settingLeft}>
                <View style={[s.settingIconWrap, twosActive && { backgroundColor: `${GOLD}18`, borderColor: `${GOLD}40` }]}>
                  <Ionicons name="star-outline" size={16} color={twosActive ? GOLD : '#6b7280'} />
                </View>
                <View>
                  <Text style={[s.settingLabel, !twosActive && { color: '#6b7280' }]}>2s Club</Text>
                  <Text style={s.settingSubLabel}>Pot for holing out on par 3s</Text>
                </View>
              </View>
              <View style={s.settingRight}>
                <View style={[s.toggle, twosActive && s.toggleOn]}>
                  <View style={[s.toggleThumb, twosActive && s.toggleThumbOn]} />
                </View>
              </View>
            </TouchableOpacity>
          </View>

          {/* ── Combined Leaderboard (multiple groups) ── */}
          {groupCount > 1 && (
            <>
              <Text style={s.sectionLabel}>LEADERBOARD</Text>
              <View style={s.settingsCard}>
                <View style={s.groupsBanner}>
                  <View style={s.groupsCountRow}>
                    {Array.from({ length: groupCount }).map((_, i) => (
                      <View key={i} style={[s.groupPill, i === 0 && s.groupPillActive]}>
                        <Text style={[s.groupPillText, i === 0 && s.groupPillTextActive]}>
                          G{i + 1}
                        </Text>
                      </View>
                    ))}
                    <Text style={s.groupsLabel}>{groupCount} groups</Text>
                  </View>
                </View>
                <View style={s.settingDivider} />
                <TouchableOpacity
                  style={s.settingRow}
                  onPress={() => setCombineGroups(v => !v)}
                  activeOpacity={0.7}
                >
                  <View style={s.settingLeft}>
                    <View style={[s.settingIconWrap, combineGroups && { backgroundColor: `${GOLD}18`, borderColor: `${GOLD}40` }]}>
                      <Ionicons name="podium-outline" size={16} color={combineGroups ? GOLD : '#6b7280'} />
                    </View>
                    <View>
                      <Text style={s.settingLabel}>Combined Leaderboard</Text>
                      <Text style={s.settingSubLabel}>Live scoring across all groups</Text>
                    </View>
                  </View>
                  <View style={s.settingRight}>
                    <View style={[s.toggle, combineGroups && s.toggleOn]}>
                      <View style={[s.toggleThumb, combineGroups && s.toggleThumbOn]} />
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ── GPS & Course Features ── */}
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
              <TouchableOpacity
                style={s.featureCard}
                onPress={() => router.push('/(app)/rangefinder' as any)}
                activeOpacity={0.8}
              >
                <View style={[s.featureIcon, { backgroundColor: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.22)' }]}>
                  <Ionicons name="scan-outline" size={24} color="#f87171" />
                </View>
                <Text style={s.featureTitle}>Rangefinder</Text>
                <Text style={s.featureSub}>GPS pin-point{'\n'}accuracy</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Scorecard preview ── */}
          {courseHoles.length > 0 && (
            <>
              <TouchableOpacity
                style={s.scorecardToggle}
                onPress={() => setShowScorecard(v => !v)}
                activeOpacity={0.7}
              >
                <Text style={s.sectionLabel} >SCORECARD PREVIEW</Text>
                <Ionicons
                  name={showScorecard ? 'chevron-up' : 'chevron-down'}
                  size={14} color={GOLD}
                  style={{ marginBottom: 10 }}
                />
              </TouchableOpacity>
              {showScorecard && (
                <View style={s.scorecardCard}>
                  {[courseHoles.slice(0, 9), courseHoles.slice(9, 18)].map((half, hi) => {
                    const total = half.reduce((acc, h) => acc + h.par, 0);
                    const label = hi === 0 ? 'OUT' : 'IN';
                    return (
                      <View key={hi} style={[s.scorecardHalf, hi === 1 && { marginTop: 12 }]}>
                        <View style={s.scorecardRow}>
                          <Text style={s.scHole}>HOLE</Text>
                          {half.map(h => (
                            <Text key={h.hole_number} style={s.scHole}>{h.hole_number}</Text>
                          ))}
                          <Text style={[s.scHole, s.scTotal]}>{label}</Text>
                        </View>
                        <View style={[s.scorecardRow, { backgroundColor: '#0a0a0a' }]}>
                          <Text style={s.scPar}>PAR</Text>
                          {half.map(h => (
                            <Text key={h.hole_number} style={s.scPar}>{h.par}</Text>
                          ))}
                          <Text style={[s.scPar, s.scTotal, { color: GOLD }]}>{total}</Text>
                        </View>
                        <View style={s.scorecardRow}>
                          <Text style={s.scSi}>SI</Text>
                          {half.map(h => (
                            <Text key={h.hole_number} style={s.scSi}>{h.stroke_index}</Text>
                          ))}
                          <Text style={[s.scSi, s.scTotal]}>—</Text>
                        </View>
                      </View>
                    );
                  })}
                  <Text style={s.scFooter}>
                    Total par {courseHoles.reduce((a, h) => a + h.par, 0)} · {courseHoles.length} holes
                  </Text>
                </View>
              )}
            </>
          )}

          {/* ── Ready to Play ── */}
          <Text style={s.sectionLabel}>READY TO PLAY</Text>
          <View style={s.readyCard}>
            <View style={s.readyItem}>
              <Ionicons name="bag-outline" size={20} color={GOLD} />
              <Text style={s.readyLabel}>Clubs Linked</Text>
              <Text style={[s.readyValue, clubCount > 0 && { color: GREEN }]}>
                {clubCount > 0 ? `${taggedCount} / ${clubCount}` : '—'}
              </Text>
            </View>
            <View style={s.readyDivider} />
            <View style={s.readyItem}>
              <Ionicons name="radio-outline" size={20} color={GOLD} />
              <Text style={s.readyLabel}>Battery Tags</Text>
              <Text style={[s.readyValue, { color: taggedCount > 0 ? GREEN : '#6b7280' }]}>
                {taggedCount > 0 ? 'Good' : 'None linked'}
              </Text>
            </View>
            <View style={s.readyDivider} />
            <View style={s.readyItem}>
              <Ionicons name="cloud-done-outline" size={20} color={GOLD} />
              <Text style={s.readyLabel}>Course Synced</Text>
              <Text style={[s.readyValue, { color: selectedCourse ? GREEN : '#6b7280' }]}>
                {selectedCourse ? 'Up to date' : 'No course'}
              </Text>
            </View>
          </View>

          {/* ── Main CTA ── */}
          <TouchableOpacity style={s.ctaBtn} activeOpacity={0.85} onPress={() => router.push('/(app)/admin/concept-score' as any)}>
            <Text style={s.ctaBtnText}>Start Round</Text>
            <Ionicons name="arrow-forward" size={18} color="#000" />
          </TouchableOpacity>

          <View style={s.watermark}>
            <Text style={s.watermarkText}>CONCEPT PREVIEW · NOT LIVE</Text>
          </View>
        </ScrollView>
      )}

      {/* ── Pickers ── */}
      <CourseSheet
        visible={showCourse} courses={courses} selected={selectedCourse}
        onSelect={setSelectedCourse} onClose={() => setShowCourse(false)}
      />
      <PlayerSheet
        visible={showPlayers} players={allPlayers} selected={extraPlayers}
        currentId={currentPlayer?.id ?? ''} onToggle={toggleExtraPlayer}
        onClose={() => setShowPlayers(false)}
      />
      <PickerSheet
        visible={showFormat} title="Format" options={FORMATS}
        selected={format} onSelect={setFormat} onClose={() => setShowFormat(false)}
      />
      <PickerSheet
        visible={showTees} title="Tees" options={TEES_LIST}
        selected={tees} onSelect={setTees} onClose={() => setShowTees(false)}
      />
      <PickerSheet
        visible={showHoles} title="Holes" options={HOLES_LIST}
        selected={holes} onSelect={setHoles} onClose={() => setShowHoles(false)}
      />
      <PickerSheet
        visible={showSecondGame} title="2nd Game" options={SECOND_GAMES}
        selected={secondGame} onSelect={setSecondGame} onClose={() => setShowSecondGame(false)}
      />
      <PickerSheet
        visible={showLdHole} title="Longest Drive — pick hole"
        options={ALL_HOLES}
        selected={ldHole ?? '1'} onSelect={v => setLdHole(v)} onClose={() => setShowLdHole(false)}
      />
      <PickerSheet
        visible={showNpHole} title="Nearest the Pin — pick hole"
        options={
          courseHoles.filter(h => h.par === 3).length > 0
            ? courseHoles.filter(h => h.par === 3).map(h => String(h.hole_number))
            : ALL_HOLES
        }
        selected={npHole ?? '1'} onSelect={v => setNpHole(v)} onClose={() => setShowNpHole(false)}
      />
    </View>
  );
}

function teeColor(t: Tees): string {
  switch (t) {
    case 'Yellow': return '#eab308';
    case 'White':  return '#ffffff';
    case 'Red':    return '#ef4444';
    case 'Blue':   return '#3b82f6';
    case 'Black':  return '#1f2937';
    default:       return GOLD;
  }
}

// ── Styles ────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#000000' },
  centered:{ flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll:  { paddingBottom: 48 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12,
  },
  headerSide:   { width: 40 },
  headerCenter: { alignItems: 'center' },
  headerLogo:   { width: 36, height: 36 },
  bellWrap:     { position: 'relative' },
  notifDot: {
    position: 'absolute', top: -1, right: -1,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: GOLD, borderWidth: 1.5, borderColor: '#000',
  },

  // Title
  pageTitle:    { fontFamily: FF, fontSize: 36, color: '#ffffff', paddingHorizontal: 20, letterSpacing: -0.5 },
  pageSubtitle: { fontFamily: FF, fontSize: 13, color: '#6b7280', paddingHorizontal: 20, marginTop: 4, marginBottom: 20 },

  // Course card
  courseCard: {
    marginHorizontal: 16, borderRadius: 16,
    overflow: 'hidden', marginBottom: 16,
    backgroundColor: '#111',
  },
  courseHero:    { width: '100%', height: 200 },
  courseOverlay: {
    ...StyleSheet.absoluteFillObject,
    height: 200,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  todayBadge: {
    position: 'absolute', top: 14, left: 14,
    borderWidth: 1, borderColor: GOLD,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: `${GOLD}15`,
  },
  todayText:  { fontFamily: FF, fontSize: 10, color: GOLD, letterSpacing: 2 },
  courseInfo: { position: 'absolute', bottom: 64, left: 16, right: 16 },
  courseName: { fontFamily: FF, fontSize: 20, color: '#ffffff', marginBottom: 6 },
  courseMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 },
  courseMeta:    { fontFamily: FF, fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  teetimeRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingHorizontal: 14, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
    gap: 8,
  },
  teetimeItem:     { flexDirection: 'row', alignItems: 'center', gap: 5 },
  teetimeItemText: { fontFamily: FF, fontSize: 12, color: 'rgba(255,255,255,0.55)' },
  teetimeDivider:  { width: 1, height: 14, backgroundColor: 'rgba(255,255,255,0.1)', marginHorizontal: 4 },
  startBtn: {
    marginLeft: 'auto',
    backgroundColor: GOLD,
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8,
  },
  startBtnText: { fontFamily: FF, fontSize: 13, color: '#000000' },

  // Settings
  settingsCard: {
    marginHorizontal: 16, marginBottom: 20,
    backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden',
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
  teeColorDot:   { width: 14, height: 14, borderRadius: 7 },
  settingLabel:    { fontFamily: FF, fontSize: 15, color: '#ffffff' },
  settingSubLabel: { fontFamily: FF, fontSize: 11, color: '#6b7280', marginTop: 1 },
  settingValue:    { fontFamily: FF, fontSize: 14, color: '#6b7280', flexShrink: 1 },
  settingDivider:{ height: 1, backgroundColor: '#1a1a1a', marginHorizontal: 14 },

  // Toggle
  toggle: {
    width: 40, height: 24, borderRadius: 12,
    backgroundColor: '#2c2c2e', justifyContent: 'center', padding: 2,
  },
  toggleOn:      { backgroundColor: `${GOLD}40` },
  toggleThumb:   { width: 20, height: 20, borderRadius: 10, backgroundColor: '#6b7280' },
  toggleThumbOn: { transform: [{ translateX: 16 }], backgroundColor: GOLD },

  // Section label
  sectionLabel: {
    fontFamily: FF, fontSize: 10, color: GOLD,
    letterSpacing: 2, paddingHorizontal: 16, marginBottom: 10,
  },

  // Features
  featuresGrid: { paddingHorizontal: 16, gap: 10, marginBottom: 20 },
  featuresRow:  { flexDirection: 'row', gap: 10 },
  featureCard: {
    flex: 1, backgroundColor: '#111111',
    borderRadius: 12, borderWidth: 1, borderColor: '#1c1c1c',
    padding: 12, alignItems: 'center', gap: 8,
  },
  featureIcon: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  featureTitle: { fontFamily: FF, fontSize: 12, color: '#ffffff', textAlign: 'center' },
  featureSub:   { fontFamily: FF, fontSize: 10, color: '#6b7280', textAlign: 'center', lineHeight: 14 },

  // Scorecard
  scorecardToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  scorecardCard: {
    marginHorizontal: 16, marginBottom: 20,
    backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden', padding: 12,
  },
  scorecardHalf: {},
  scorecardRow:  { flexDirection: 'row', paddingVertical: 7, borderRadius: 6 },
  scHole:  { flex: 1, fontFamily: FF, fontSize: 10, color: '#6b7280', textAlign: 'center' },
  scPar:   { flex: 1, fontFamily: FF, fontSize: 12, color: '#ffffff', textAlign: 'center' },
  scTotal: { color: GOLD, fontFamily: FF },
  scSi:    { flex: 1, fontFamily: FF, fontSize: 10, color: '#6b7280', textAlign: 'center' },
  scFooter:{ fontFamily: FF, fontSize: 10, color: '#6b7280', textAlign: 'center', marginTop: 10 },

  // Ready
  readyCard: {
    marginHorizontal: 16, marginBottom: 24,
    backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c',
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 16,
  },
  readyItem:    { flex: 1, alignItems: 'center', gap: 5 },
  readyDivider: { width: 1, height: 36, backgroundColor: '#1c1c1c' },
  readyLabel:   { fontFamily: FF, fontSize: 9, color: '#6b7280', letterSpacing: 1.5 },
  readyValue:   { fontFamily: FF, fontSize: 12, color: '#ffffff' },

  // CTA
  ctaBtn: {
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: GOLD, borderRadius: 14,
    paddingVertical: 18, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  ctaBtnText: { fontFamily: FF, fontSize: 17, color: '#000000' },

  // Stepper (groups)
  stepperBtn:     { width: 28, height: 28, borderRadius: 8, backgroundColor: '#1c1c1c', alignItems: 'center', justifyContent: 'center' },
  stepperBtnText: { fontFamily: FFB, fontSize: 16, color: GOLD, lineHeight: 20 },
  stepperVal:     { fontFamily: FFB, fontSize: 18, color: '#ffffff', minWidth: 24, textAlign: 'center' },

  // Groups leaderboard
  groupsBanner:    { paddingHorizontal: 14, paddingVertical: 12 },
  groupsCountRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  groupsLabel:     { fontFamily: FF, fontSize: 12, color: '#6b7280', marginLeft: 4 },
  groupPill: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
    backgroundColor: '#1c1c1c', borderWidth: 1, borderColor: '#2c2c2c',
  },
  groupPillActive:     { backgroundColor: `${GOLD}15`, borderColor: `${GOLD}40` },
  groupPillText:       { fontFamily: FF, fontSize: 12, color: '#6b7280' },
  groupPillTextActive: { color: GOLD },

  // Watermark
  watermark:     { alignItems: 'center', paddingVertical: 12 },
  watermarkText: { fontFamily: FF, fontSize: 10, color: '#2a2a2a', letterSpacing: 2 },
});

// ── Picker sheet styles ───────────────────────────────────────
const ps = StyleSheet.create({
  overlay:  { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#111111', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingBottom: 34, paddingHorizontal: 16,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: '#333',
    alignSelf: 'center', marginVertical: 12,
  },
  sheetTitle: { fontFamily: FF, fontSize: 18, color: '#ffffff', marginBottom: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  sheetRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  sheetOpt:   { fontFamily: FF, fontSize: 16, color: '#6b7280' },
  sheetOptOn: { color: '#ffffff' },
  courseParLabel: { fontFamily: FF, fontSize: 12, color: '#6b7280' },
  cancelBtn:  { marginTop: 12, alignItems: 'center', paddingVertical: 14 },
  cancelText: { fontFamily: FF, fontSize: 16, color: '#6b7280' },
  doneBtn:    { marginTop: 12, backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  doneBtnText:{ fontFamily: FF, fontSize: 16, color: '#000000' },
  playerRow:  { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  playerAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: `${GOLD}18`, alignItems: 'center', justifyContent: 'center',
  },
  playerAvatarImg:    { width: 36, height: 36, borderRadius: 18 },
  playerAvatarLetter: { fontFamily: FF, fontSize: 15, color: GOLD },
  playerHcp:          { fontFamily: FF, fontSize: 11, color: '#6b7280' },
});
