import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Image, ActivityIndicator, Alert, TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { useSociety } from '../../../src/lib/useSociety';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';
import { getPlayerAvatar } from '../../../src/lib/assets';

type GameMode  = '4bbb' | 'singles' | 'stableford' | 'medal';
type HolesMode = 'full18' | 'front9' | 'back9';
interface Player     { id: string; display_name: string; handicap_index: number; avatar_url?: string | null; }
interface CourseItem { name: string; par: number; }

const MODES: { key: GameMode; label: string; sub: string; available: boolean }[] = [
  { key: '4bbb',       label: '4BBB Matchplay', sub: 'Two pairs · best ball',         available: true },
  { key: 'singles',    label: 'Singles',        sub: 'Head-to-head matchplay',         available: true },
  { key: 'stableford', label: 'Stableford',     sub: '1–4 players · points per hole',   available: true },
  { key: 'medal',      label: 'Medal',          sub: '1–4 players · total stroke play', available: true },
];

const HCP_ALLOWANCES: { pct: number; label: string; sub: string }[] = [
  { pct: 100, label: 'Full Handicap', sub: 'WHS course handicap · 100%' },
  { pct: 87,  label: '7/8 Handicap', sub: '87.5% of course handicap' },
  { pct: 75,  label: '3/4 Handicap', sub: '75% of course handicap' },
  { pct: 0,   label: 'Off Scratch',  sub: 'No strokes — play level' },
];

const SIDE_GAMES_ALL      = ['Skins', 'Nassau', 'Stableford', 'Stroke Play', 'Bingo Bango Bongo', 'Greensomes', 'Wolf', 'Closest to Pin', 'Longest Drive'];
const SIDE_GAMES_STROKE   = ['Skins', 'Closest to Pin', 'Longest Drive'];

const HOLES: { key: HolesMode; label: string; sub: string }[] = [
  { key: 'full18', label: 'Full 18', sub: 'All 18 holes' },
  { key: 'front9', label: 'Front 9', sub: 'Holes 1–9' },
  { key: 'back9',  label: 'Back 9',  sub: 'Holes 10–18' },
];

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

export default function NewGameScreen() {
  const router = useRouter();
  const { societyId, loading: societyLoading } = useSociety();

  const [step, setStep]         = useState<1 | 2 | 3 | 4>(1);
  const [pairStep, setPairStep] = useState<1 | 2>(1);
  const [mode, setMode]         = useState<GameMode | null>(null);
  const [pair1, setPair1]       = useState<string[]>([]);
  const [pair2, setPair2]       = useState<string[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [hcpAllowance, setHcpAllowance]     = useState<number>(100);
  const [customHcp, setCustomHcp]           = useState<string>('');
  const [sideGames, setSideGames]           = useState<string[]>([]);
  const [holesMode, setHoles]               = useState<HolesMode>('full18');
  const [players, setPlayers]               = useState<Player[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [courses, setCourses]               = useState<CourseItem[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [creating, setCreating]             = useState(false);
  const [courseHoleData, setCourseHoleData] = useState<{ hole_number: number; par: number }[]>([]);
  const [coursePinsSet, setCoursePinsSet]   = useState<boolean | null>(null);
  const [ldHole,  setLdHole]  = useState<number | null>(null);
  const [ntpHole, setNtpHole] = useState<number | null>(null);

  useEffect(() => {
    if (!selectedCourse) { setCourseHoleData([]); setCoursePinsSet(null); return; }
    supabase.from('course_holes').select('hole_number,par,green_lat').eq('course_name', selectedCourse).order('hole_number')
      .then(({ data, error }) => {
        if (error || !data) { setCoursePinsSet(false); return; }
        setCourseHoleData(data as any[]);
        setCoursePinsSet((data as any[]).some((h: any) => !!h.green_lat));
      });
  }, [selectedCourse]);

  useEffect(() => {
    if (societyLoading) return;

    // Load courses (shared across all societies)
    supabase
      .from('course_holes')
      .select('course_name, par')
      .then(({ data }) => {
        if (data) {
          const map: Record<string, number> = {};
          for (const row of data as any[]) {
            map[row.course_name] = (map[row.course_name] ?? 0) + row.par;
          }
          setCourses(
            Object.entries(map)
              .map(([name, par]) => ({ name, par }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          );
        }
        setLoadingCourses(false);
      });

    if (!societyId) { setLoadingPlayers(false); return; }

    // Load players in this society only
    (async () => {
      const { data: members } = await supabase
        .from('society_members')
        .select('player_id')
        .eq('society_id', societyId);

      if (!members || members.length === 0) { setLoadingPlayers(false); return; }
      const ids = (members as any[]).map(m => m.player_id);

      const { data } = await supabase
        .from('players')
        .select('id, display_name, handicap_index, avatar_url')
        .in('id', ids)
        .order('display_name');

      if (data) setPlayers(data as Player[]);
      setLoadingPlayers(false);
    })();
  }, [societyId, societyLoading]);

  const isSolo    = mode === 'stableford' || mode === 'medal';
  const maxPer    = mode === 'singles' ? 1 : isSolo ? 4 : 2;
  const atMax     = isSolo && pair1.length >= maxPer;
  const sideGamesList = isSolo ? SIDE_GAMES_STROKE : SIDE_GAMES_ALL;
  const activePair    = pairStep === 1 ? pair1 : pair2;
  const setActivePair = pairStep === 1 ? setPair1 : setPair2;

  function togglePlayer(id: string) {
    const inOther = pairStep === 1 ? pair2.includes(id) : pair1.includes(id);
    if (inOther) return;
    setActivePair(prev =>
      prev.includes(id) ? prev.filter(p => p !== id)
        : prev.length < maxPer ? [...prev, id] : prev,
    );
  }

  function goNext() {
    if (step === 1) { setPair1([]); setPair2([]); setPairStep(1); setSideGames([]); setStep(2); return; }
    if (step === 2 && pairStep === 1 && !isSolo) { setPairStep(2); return; }
    if (step === 2) { setStep(3); return; }
    if (step === 3) { setStep(4); return; }
    createGame();
  }

  function goBack() {
    if (step === 1) { router.back(); return; }
    if (step === 2 && pairStep === 2) { setPairStep(1); return; }
    if (step === 2) { setStep(1); return; }
    setStep(s => (s - 1) as any);
  }

  const canNext = (() => {
    if (step === 1) return mode !== null && MODES.find(m => m.key === mode)?.available === true;
    if (step === 2) {
      if (isSolo) return pair1.length >= 1;
      const need = mode === 'singles' ? 1 : 2;
      return pairStep === 1 ? pair1.length === need : pair2.length === need;
    }
    if (step === 3) return selectedCourse !== null;
    return true;
  })();

  async function createGame() {
    if (!mode || !selectedCourse || !societyId || creating) return;
    setCreating(true);
    try {
      const { data: compId, error: compErr } = await supabase.rpc('get_or_create_casual_competition', {
        p_society_id: societyId,
      });
      if (compErr) throw compErr;

      const { data: dayId, error: dayErr } = await supabase.rpc('get_or_create_course_day', {
        p_competition_id: compId,
        p_course_name: selectedCourse,
      });
      if (dayErr) throw dayErr;

      const matchNum = Math.floor(Date.now() / 1000) % 100000;
      const { data: newMatch, error } = await supabase.from('matches').insert({
        competition_id: compId,
        day_id: dayId,
        match_number: matchNum,
        home_team_id: null,
        away_team_id: null,
        home_player_ids: pair1,
        away_player_ids: isSolo ? [] : pair2,
        status: 'in_progress',
        holes_string: '..................',
        is_singles: mode === 'singles',
        round_format: isSolo ? mode : 'matchplay',
        hcp_allowance: hcpAllowance,
        side_games: sideGames.map(g => {
            if (g === 'Longest Drive' && ldHole) return `Longest Drive:${ldHole}`;
            if (g === 'Closest to Pin' && ntpHole) return `Closest to Pin:${ntpHole}`;
            return g;
          }),
      }).select().single();

      if (error || !newMatch) throw error ?? new Error('Could not create game');

      router.replace(`/(app)/score/preview/${newMatch.id}` as any);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not create game');
      setCreating(false);
    }
  }

  const firstName = (id: string) => players.find(p => p.id === id)?.display_name.split(' ')[0] ?? '?';

  const stepTitle = (() => {
    if (step === 1) return 'Choose Game Mode';
    if (step === 2) {
      if (isSolo) {
        if (pair1.length === 0) return 'Who is playing today?';
        if (atMax) return `${pair1.length} players selected — ready to go!`;
        return `${pair1.length} player${pair1.length > 1 ? 's' : ''} selected — add more or tap Next`;
      }
      if (mode === 'singles') return pairStep === 1 ? 'Pick Player 1' : 'Pick Player 2';
      return pairStep === 1 ? 'Pick Pair 1  ·  choose 2 players' : 'Pick Pair 2  ·  choose 2 players';
    }
    if (step === 3) return 'Course & Holes';
    return 'Handicap Settings';
  })();

  const nextLabel = (() => {
    if (step === 4) return 'Start Round';
    if (step === 2 && pairStep === 1 && !isSolo) return mode === 'singles' ? 'Next' : 'Pick Pair 2 →';
    return 'Next →';
  })();

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backText}>{step === 1 ? 'Cancel' : '‹ Back'}</Text>
        </TouchableOpacity>
        <View style={styles.stepDots}>
          {[1, 2, 3, 4].map(s => (
            <View key={s} style={[styles.stepDot, s <= step && styles.stepDotActive]} />
          ))}
        </View>
      </View>

      <Text style={styles.stepTitle}>{stepTitle}</Text>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>

        {/* ── Step 1 — Mode ──────────────────────────────────── */}
        {step === 1 && MODES.map(m => (
          <TouchableOpacity
            key={m.key}
            style={[styles.card, mode === m.key && styles.cardSelected, !m.available && styles.cardDim]}
            onPress={() => m.available && setMode(m.key)}
            activeOpacity={m.available ? 0.8 : 1}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardLabel, mode === m.key && styles.cardLabelSelected]}>{m.label}</Text>
              <Text style={styles.cardSub}>{m.sub}</Text>
            </View>
            {!m.available && <View style={styles.soonBadge}><Text style={styles.soonText}>SOON</Text></View>}
            {mode === m.key && <Text style={styles.cardCheck}>✓</Text>}
          </TouchableOpacity>
        ))}

        {/* ── Step 2 — Players ───────────────────────────────── */}
        {step === 2 && (
          <>
            {isSolo && pair1.length > 0 && (
              <View style={styles.pairBanner}>
                <Text style={styles.pairBannerLabel}>PLAYING TODAY</Text>
                <View style={styles.pairBannerAvatars}>
                  {pair1.map(id => {
                    const player = players.find(p => p.id === id);
                    const av = player?.avatar_url ?? getPlayerAvatar(id, 'normal');
                    return (
                      <View key={id} style={styles.bannerPlayer}>
                        {av
                          ? <Image source={typeof av === 'string' ? { uri: av } : av} style={styles.bannerAvatar} />
                          : <View style={[styles.bannerAvatar, styles.avatarFallback]}><Text style={styles.avatarInitial}>{firstName(id)[0]}</Text></View>
                        }
                        <Text style={styles.bannerName}>{firstName(id)}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {pairStep === 2 && pair1.length > 0 && (
              <View style={styles.pairBanner}>
                <Text style={styles.pairBannerLabel}>Pair 1</Text>
                <View style={styles.pairBannerAvatars}>
                  {pair1.map(id => {
                    const player = players.find(p => p.id === id);
                    const av = player?.avatar_url ?? getPlayerAvatar(id, 'normal');
                    return (
                      <View key={id} style={styles.bannerPlayer}>
                        {av
                          ? <Image source={typeof av === 'string' ? { uri: av } : av} style={styles.bannerAvatar} />
                          : <View style={[styles.bannerAvatar, styles.avatarFallback]}><Text style={styles.avatarInitial}>{firstName(id)[0]}</Text></View>
                        }
                        <Text style={styles.bannerName}>{firstName(id)}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {loadingPlayers
              ? <ActivityIndicator color={colors.gold} style={{ marginTop: 40 }} />
              : chunkArray(players, 3).map((row, ri) => (
                <View key={ri} style={styles.playerRow}>
                  {row.map(p => {
                    const avatar  = p.avatar_url ?? getPlayerAvatar(p.id, 'normal');
                    const inP1     = pair1.includes(p.id);
                    const inP2     = pair2.includes(p.id);
                    const inActive = pairStep === 1 ? inP1 : inP2;
                    const inOther  = pairStep === 1 ? inP2 : inP1;
                    const isDisabled = inOther || (atMax && !inActive);
                    return (
                      <TouchableOpacity
                        key={p.id}
                        style={[styles.playerTile, inActive && styles.playerTileOn, isDisabled && styles.playerTileDim]}
                        onPress={() => togglePlayer(p.id)}
                        disabled={isDisabled}
                        activeOpacity={0.8}
                      >
                        <View style={[styles.avatarRing, inActive && styles.avatarRingOn]}>
                          {avatar
                            ? <Image source={typeof avatar === 'string' ? { uri: avatar } : avatar} style={styles.playerAvatar} />
                            : <View style={[styles.playerAvatar, styles.avatarFallback]}><Text style={styles.avatarInitial}>{p.display_name[0]}</Text></View>
                          }
                          {inActive && (
                            <View style={styles.checkBadge}><Text style={styles.checkBadgeText}>✓</Text></View>
                          )}
                        </View>
                        <Text style={[styles.playerName, inActive && styles.playerNameOn]} numberOfLines={1}>
                          {p.display_name.split(' ')[0]}
                        </Text>
                        <Text style={styles.playerHcp}>{p.handicap_index}</Text>
                      </TouchableOpacity>
                    );
                  })}
                  {row.length < 3 && Array.from({ length: 3 - row.length }, (_, i) => (
                    <View key={`gap-${i}`} style={styles.playerTile} />
                  ))}
                </View>
              ))
            }
          </>
        )}

        {/* ── Step 3 — Course & Holes ────────────────────────── */}
        {step === 3 && (
          <>
            {selectedCourse && coursePinsSet === false && (
              <TouchableOpacity
                style={styles.pinsNotice}
                onPress={() => router.push('/(app)/admin/pins' as any)}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.pinsNoticeTitle}>⛳ No rangefinder pins set</Text>
                  <Text style={styles.pinsNoticeSub}>Tap to drop green pins for this course — distances won't show without them</Text>
                </View>
                <Text style={{ color: colors.gold, fontSize: 20 }}>›</Text>
              </TouchableOpacity>
            )}
            {loadingCourses
              ? <ActivityIndicator color={colors.gold} style={{ marginTop: 40 }} />
              : courses.length === 0
                ? (
                  <View style={styles.card}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardLabel}>No courses configured</Text>
                      <Text style={styles.cardSub}>Ask your admin to add courses under Admin → Manage Courses.</Text>
                    </View>
                  </View>
                )
                : courses.map(c => (
                  <TouchableOpacity
                    key={c.name}
                    style={[styles.card, selectedCourse === c.name && styles.cardSelected]}
                    onPress={() => setSelectedCourse(c.name)}
                    activeOpacity={0.8}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cardLabel, selectedCourse === c.name && styles.cardLabelSelected]}>{c.name}</Text>
                      <Text style={styles.cardSub}>Par {c.par}</Text>
                    </View>
                    {selectedCourse === c.name && <Text style={styles.cardCheck}>✓</Text>}
                  </TouchableOpacity>
                ))
            }

            <Text style={styles.sectionLabel}>HOLES TO PLAY</Text>
            <View style={styles.holesRow}>
              {HOLES.map(h => (
                <TouchableOpacity
                  key={h.key}
                  style={[styles.holeBtn, holesMode === h.key && styles.holeBtnOn]}
                  onPress={() => setHoles(h.key)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.holeBtnLabel, holesMode === h.key && styles.holeBtnLabelOn]}>{h.label}</Text>
                  <Text style={styles.holeBtnSub}>{h.sub}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* ── Step 4 — Settings ──────────────────────────────── */}
        {step === 4 && (
          <>
            <Text style={styles.sectionLabel}>HANDICAP ALLOWANCE</Text>
            {HCP_ALLOWANCES.map(h => (
              <TouchableOpacity
                key={h.pct}
                style={[styles.card, hcpAllowance === h.pct && !customHcp && styles.cardSelected]}
                onPress={() => { setHcpAllowance(h.pct); setCustomHcp(''); }}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardLabel, hcpAllowance === h.pct && !customHcp && styles.cardLabelSelected]}>{h.label}</Text>
                  <Text style={styles.cardSub}>{h.sub}</Text>
                </View>
                {hcpAllowance === h.pct && !customHcp && <Text style={styles.cardCheck}>✓</Text>}
              </TouchableOpacity>
            ))}

            <View style={[styles.card, !!customHcp && styles.cardSelected]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardLabel, !!customHcp && styles.cardLabelSelected]}>Custom %</Text>
                <Text style={styles.cardSub}>Enter any allowance percentage</Text>
              </View>
              <TextInput
                style={[styles.customHcpInput, !!customHcp && styles.customHcpInputOn]}
                placeholder="e.g. 90"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                maxLength={3}
                value={customHcp}
                onChangeText={val => {
                  setCustomHcp(val);
                  const n = parseInt(val, 10);
                  if (!isNaN(n) && n >= 0 && n <= 100) setHcpAllowance(n);
                }}
              />
            </View>

            <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>SIDE GAMES</Text>
            <View style={styles.sideGamesGrid}>
              {sideGamesList.map(g => {
                const on = sideGames.includes(g);
                return (
                  <TouchableOpacity
                    key={g}
                    style={[styles.sideGameChip, on && styles.sideGameChipOn]}
                    onPress={() => setSideGames(prev => on ? prev.filter(x => x !== g) : [...prev, g])}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.sideGameText, on && styles.sideGameTextOn]}>{g}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Longest Drive hole picker */}
            {sideGames.includes('Longest Drive') && courseHoleData.filter(h => h.par === 5).length > 0 && (
              <>
                <Text style={styles.sectionLabel}>LONGEST DRIVE — PICK HOLE (PAR 5)</Text>
                <View style={styles.holePickerRow}>
                  {courseHoleData.filter(h => h.par === 5).map(h => (
                    <TouchableOpacity
                      key={h.hole_number}
                      style={[styles.holePickerBtn, ldHole === h.hole_number && styles.holePickerBtnOn]}
                      onPress={() => setLdHole(h.hole_number)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.holePickerNum, ldHole === h.hole_number && styles.holePickerNumOn]}>{h.hole_number}</Text>
                      <Text style={styles.holePickerPar}>Par 5</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Closest to Pin hole picker */}
            {sideGames.includes('Closest to Pin') && courseHoleData.filter(h => h.par === 3).length > 0 && (
              <>
                <Text style={styles.sectionLabel}>NEAREST THE PIN — PICK HOLE (PAR 3)</Text>
                <View style={styles.holePickerRow}>
                  {courseHoleData.filter(h => h.par === 3).map(h => (
                    <TouchableOpacity
                      key={h.hole_number}
                      style={[styles.holePickerBtn, ntpHole === h.hole_number && styles.holePickerBtnOn]}
                      onPress={() => setNtpHole(h.hole_number)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.holePickerNum, ntpHole === h.hole_number && styles.holePickerNumOn]}>{h.hole_number}</Text>
                      <Text style={styles.holePickerPar}>Par 3</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Summary */}
            <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>GAME SUMMARY</Text>
            <View style={styles.summaryCard}>
              {[
                { k: 'Mode',   v: MODES.find(m => m.key === mode)?.label ?? '—' },
                isSolo
                  ? { k: pair1.length > 1 ? 'Players' : 'Player', v: pair1.map(firstName).join(', ') || '—' }
                  : { k: 'Pair 1', v: pair1.map(firstName).join(' & ') },
                ...(!isSolo ? [{ k: 'Pair 2', v: pair2.map(firstName).join(' & ') }] : []),
                { k: 'Course',   v: selectedCourse ?? '—' },
                { k: 'Holes',    v: HOLES.find(h => h.key === holesMode)?.label ?? '—' },
                { k: 'Handicap', v: customHcp ? `Custom ${hcpAllowance}%` : (HCP_ALLOWANCES.find(h => h.pct === hcpAllowance)?.label ?? '—') },
                ...sideGames.length > 0 ? [{ k: 'Side Games', v: sideGames.join(', ') }] : [],
              ].map(row => (
                <View key={row.k} style={styles.summaryRow}>
                  <Text style={styles.summaryKey}>{row.k}</Text>
                  <Text style={styles.summaryVal}>{row.v}</Text>
                </View>
              ))}
            </View>
          </>
        )}

      </ScrollView>

      {/* Bottom CTA */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.nextBtn, (!canNext || creating) && styles.nextBtnOff]}
          onPress={goNext}
          disabled={!canNext || creating}
          activeOpacity={0.85}
        >
          {creating
            ? <ActivityIndicator color={colors.bg} />
            : <Text style={styles.nextBtnText}>{nextLabel}</Text>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  backBtn: {},
  backText: { fontSize: fonts.md, color: colors.gold, fontWeight: '600' },
  stepDots: { flexDirection: 'row', gap: spacing.xs },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  stepDotActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  stepTitle: { fontSize: fonts.lg, fontWeight: '800', color: colors.white, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  scrollView: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: 120 },

  card: {
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
    flexDirection: 'row', alignItems: 'center',
  },
  cardSelected: { borderColor: colors.gold, backgroundColor: colors.goldDim },
  cardDim: { opacity: 0.45 },
  cardLabel: { fontSize: fonts.md, fontWeight: '700', color: colors.textSecondary },
  cardLabelSelected: { color: colors.white },
  cardSub: { fontSize: fonts.xs, color: colors.textMuted, marginTop: 2 },
  cardCheck: { fontSize: fonts.lg, color: colors.gold, fontWeight: '800', marginLeft: spacing.sm },
  soonBadge: { backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2, borderWidth: 1, borderColor: colors.goldBorder },
  soonText: { fontSize: 9, color: colors.gold, fontWeight: '700', letterSpacing: 1 },

  pairBanner: {
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.goldBorder, marginBottom: spacing.md,
  },
  pairBannerLabel: { fontSize: fonts.xs, color: colors.gold, fontWeight: '700', letterSpacing: 1, marginBottom: spacing.sm },
  pairBannerAvatars: { flexDirection: 'row', gap: spacing.md },
  bannerPlayer: { alignItems: 'center', gap: 4 },
  bannerAvatar: { width: 44, height: 44, borderRadius: 22 },
  bannerName: { fontSize: fonts.xs, color: colors.white, fontWeight: '600' },

  playerRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  playerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  playerTile: { width: '30%', alignItems: 'center', paddingVertical: spacing.sm },
  playerTileOn: {},
  playerTileDim: { opacity: 0.3 },
  avatarRing: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: 'transparent', overflow: 'hidden', position: 'relative' },
  avatarRingOn: { borderColor: colors.gold },
  playerAvatar: { width: 60, height: 60 },
  avatarFallback: { backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: fonts.xl, fontWeight: '800', color: colors.white },
  checkBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center',
  },
  checkBadgeText: { fontSize: 10, fontWeight: '900', color: colors.bg },
  playerName: { fontSize: fonts.xs, color: colors.textSecondary, fontWeight: '600', marginTop: 4, textAlign: 'center' },
  playerNameOn: { color: colors.white },
  playerHcp: { fontSize: 9, color: colors.textMuted, marginTop: 1 },

  sectionLabel: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginTop: spacing.lg, marginBottom: spacing.sm },
  pinsNotice: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(212,175,55,0.08)', borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.goldBorder,
    padding: spacing.md, marginTop: spacing.sm,
  },
  pinsNoticeTitle: { fontSize: fonts.sm, fontWeight: '700', color: colors.gold, marginBottom: 2 },
  pinsNoticeSub:   { fontSize: fonts.xs, color: colors.textMuted },

  holesRow: { flexDirection: 'row', gap: spacing.sm },
  holeBtn: {
    flex: 1, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md,
    alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  },
  holeBtnOn: { borderColor: colors.gold, backgroundColor: colors.goldDim },
  holeBtnLabel: { fontSize: fonts.sm, fontWeight: '700', color: colors.textSecondary },
  holeBtnLabelOn: { color: colors.white },
  holeBtnSub: { fontSize: 9, color: colors.textMuted, marginTop: 2, textAlign: 'center' },

  summaryCard: {
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  summaryKey: { fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600' },
  summaryVal: { fontSize: fonts.sm, color: colors.white, fontWeight: '700', textAlign: 'right', flex: 1, marginLeft: spacing.md },

  customHcpInput: {
    width: 64, height: 36, borderRadius: radius.sm, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.cardAlt,
    color: colors.textSecondary, fontSize: fonts.md, fontWeight: '700',
    textAlign: 'center',
  },
  customHcpInputOn: { borderColor: colors.gold, color: colors.white },

  sideGamesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sideGameChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.card,
  },
  sideGameChipOn: { borderColor: colors.gold, backgroundColor: colors.goldDim },
  sideGameText: { fontSize: fonts.sm, fontWeight: '600', color: colors.textSecondary },
  sideGameTextOn: { color: colors.white },

  holePickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  holePickerBtn: {
    width: 52, alignItems: 'center', paddingVertical: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.card,
  },
  holePickerBtnOn: { borderColor: colors.gold, backgroundColor: colors.goldDim },
  holePickerNum: { fontSize: fonts.lg, fontWeight: '800', color: colors.textSecondary },
  holePickerNumOn: { color: colors.white },
  holePickerPar: { fontSize: 8, color: colors.textMuted, fontWeight: '600', marginTop: 1 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: spacing.lg, paddingBottom: 40, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border },
  nextBtn: { backgroundColor: colors.gold, borderRadius: radius.lg, paddingVertical: spacing.md + 2, alignItems: 'center' },
  nextBtnOff: { opacity: 0.35 },
  nextBtnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg, letterSpacing: 1 },
});
