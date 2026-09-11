import { useCallback, useState } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { titanLogo } from '../../../src/lib/assets';
import { goBack } from '../../../src/lib/navigation';
import { formatVsPar } from '../../../src/lib/scoring';
import { speakerName, speakerPortrait } from '../../../src/lib/titanBanter';
import {
  listEligibleCourses, getCachedReport, generateCoachingReport,
  type EligibleCourse, type CoachingReport, type HoleStat,
} from '../../../src/lib/coachingInsights';

// Davey McFadey & Rick Driver's portraits and the banter-bubble layout are
// fixed Titan branding regardless of society theme — same gold used by
// Titan News' identical banter row (app/(app)/news/index.tsx).
const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const HIT   = { top: 10, bottom: 10, left: 10, right: 10 };

export default function CoachingScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { localLogo, logoUrl } = useSocietyTheme();
  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [playerId, setPlayerId]     = useState<string | null>(null);
  const [courses, setCourses]       = useState<EligibleCourse[]>([]);

  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [report, setReport]         = useState<CoachingReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); setRefreshing(false); return; }
    const { data: player } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
    if (!player) { setLoading(false); setRefreshing(false); return; }
    setPlayerId((player as any).id);
    const eligible = await listEligibleCourses((player as any).id);
    setCourses(eligible);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function selectCourse(courseName: string) {
    if (!playerId) return;
    setSelectedCourse(courseName);
    setReportLoading(true);
    const cached = await getCachedReport(playerId, courseName);
    setReport(cached);
    setReportLoading(false);
  }

  async function generate() {
    if (!playerId || !selectedCourse) return;
    setGenerating(true);
    try {
      const saved = await generateCoachingReport(playerId, selectedCourse);
      setReport(saved);
    } catch (e: any) {
      Alert.alert('Could not generate report', e.message ?? 'Davey and Rick are stuck in the clubhouse. Try again shortly.');
    } finally {
      setGenerating(false);
    }
  }

  function backToCourses() {
    setSelectedCourse(null);
    setReport(null);
  }

  if (!fontsLoaded || loading) {
    return (
      <View style={[s.container, { backgroundColor: dc.bg }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={dc.gold} style={{ marginTop: 100 }} />
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity
          onPress={() => (selectedCourse ? backToCourses() : goBack(router, '/(app)/profile'))}
          hitSlop={HIT}
          style={s.headerSide}
        >
          <Text style={[s.back, { color: dc.gold }]}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={localLogo ?? (logoUrl ? { uri: logoUrl } : titanLogo)} style={s.headerLogo} resizeMode="contain" />
          <Text style={[s.title, { color: dc.white }]}>McFADEY &amp; DRIVER COACHING</Text>
        </View>
        <View style={s.headerSide} />
      </View>
      <Text style={s.subtitle}>
        {selectedCourse ?? 'Davey McFadey and Rick Driver break down your game, hole by hole, course by course'}
      </Text>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={dc.gold} />}
      >
        {!selectedCourse ? (
          <CourseList courses={courses} onSelect={selectCourse} dc={dc} />
        ) : reportLoading ? (
          <ActivityIndicator color={dc.gold} style={{ marginTop: 40 }} />
        ) : (
          <ReportView
            report={report}
            generating={generating}
            onGenerate={generate}
          />
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ── Course list ──────────────────────────────────────────────────────────
function CourseList({ courses, onSelect, dc }: {
  courses: EligibleCourse[]; onSelect: (courseName: string) => void; dc: any;
}) {
  if (courses.length === 0) {
    return (
      <View style={s.empty}>
        <Text style={s.emptyEmoji}>⛳</Text>
        <Text style={[s.emptyTitle, { color: dc.white }]}>No coaching report yet</Text>
        <Text style={s.emptySub}>Play 3 or more rounds at the same course and Davey &amp; Rick will find the patterns in your game there.</Text>
      </View>
    );
  }
  return (
    <View style={[s.card, { backgroundColor: '#111', borderColor: '#1c1c1c' }]}>
      {courses.map((c, i) => (
        <View key={c.courseName}>
          {i > 0 && <View style={s.divider} />}
          <TouchableOpacity style={s.courseRow} onPress={() => onSelect(c.courseName)} activeOpacity={0.75}>
            <View style={{ flex: 1 }}>
              <Text style={[s.courseName, { color: dc.white }]}>{c.courseName}</Text>
              <Text style={s.courseSub}>{c.roundsPlayed} round{c.roundsPlayed === 1 ? '' : 's'} played</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#444" />
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

// ── Report view ──────────────────────────────────────────────────────────
function ReportView({ report, generating, onGenerate }: {
  report: CoachingReport | null; generating: boolean; onGenerate: () => void;
}) {
  if (!report) {
    return (
      <View style={s.empty}>
        <Text style={s.emptyEmoji}>📋</Text>
        <Text style={[s.emptyTitle, { color: '#fff' }]}>No report yet for this course</Text>
        <Text style={s.emptySub}>Davey and Rick will go through your rounds here and write you up a report.</Text>
        <GenerateButton generating={generating} onPress={onGenerate} label="Generate My Report" />
      </View>
    );
  }

  return (
    <>
      <View style={[s.card, { backgroundColor: '#111', borderColor: '#1c1c1c' }]}>
        <Text style={[s.cardType, { color: GOLD }]}>{report.rounds_analyzed} ROUND{report.rounds_analyzed === 1 ? '' : 'S'} ANALYSED</Text>
        <Text style={[s.headline, { color: '#fff' }]}>{report.headline}</Text>
        <Text style={[s.summary, { color: '#9ca3af' }]}>{report.summary}</Text>
        {!!report.body && <Text style={[s.body, { color: '#9ca3af' }]}>{report.body}</Text>}

        {report.banter_speaker && report.banter_text && (
          <View style={s.banterRow}>
            <Image source={speakerPortrait(report.banter_speaker)} style={s.banterPortrait} />
            <View style={s.banterBubble}>
              <Text style={s.banterName}>{speakerName(report.banter_speaker).toUpperCase()}</Text>
              <Text style={s.banterText}>{report.banter_text}</Text>
            </View>
          </View>
        )}
      </View>

      {report.strongest_holes?.length > 0 && (
        <HoleSection title="YOUR BEST HOLES" holes={report.strongest_holes} good />
      )}
      {report.problem_holes?.length > 0 && (
        <HoleSection title="HOLES TO WORK ON" holes={report.problem_holes} good={false} />
      )}

      {report.suggestions?.length > 0 && (
        <View style={[s.card, { backgroundColor: '#111', borderColor: '#1c1c1c' }]}>
          <Text style={[s.cardType, { color: GOLD }]}>TRY SOMETHING NEW</Text>
          {report.suggestions.map((sug, i) => (
            <View key={i} style={s.suggestionRow}>
              <View style={s.suggestionDot} />
              <Text style={s.suggestionText}>{sug}</Text>
            </View>
          ))}
        </View>
      )}

      <GenerateButton generating={generating} onPress={onGenerate} label="Refresh Report" subtle />
    </>
  );
}

function HoleSection({ title, holes, good }: { title: string; holes: HoleStat[]; good: boolean }) {
  return (
    <View style={[s.card, { backgroundColor: '#111', borderColor: '#1c1c1c' }]}>
      <Text style={[s.cardType, { color: GOLD }]}>{title}</Text>
      {holes.map(h => (
        <View key={h.holeNumber} style={s.holeRow}>
          <View style={[s.holeChip, { borderColor: good ? `${GREEN}55` : `${RED}55` }]}>
            <Text style={[s.holeChipNum, { color: good ? GREEN : RED }]}>{h.holeNumber}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.holeMeta}>Par {h.par ?? '—'} · {h.roundsPlayed} rounds</Text>
            <Text style={s.holeExtra}>
              {h.birdiesOrBetter > 0 ? `${h.birdiesOrBetter} birdie${h.birdiesOrBetter === 1 ? '' : 's'}+  ` : ''}
              {h.bogeysOrWorse > 0 ? `${h.bogeysOrWorse} bogey${h.bogeysOrWorse === 1 ? '' : 's'}+` : ''}
            </Text>
          </View>
          <Text style={[s.holeVsPar, { color: good ? GREEN : RED }]}>{formatVsPar(h.avgVsPar)}</Text>
        </View>
      ))}
    </View>
  );
}

function GenerateButton({ generating, onPress, label, subtle }: {
  generating: boolean; onPress: () => void; label: string; subtle?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[s.generateBtn, subtle && s.generateBtnSubtle, generating && { opacity: 0.6 }]}
      onPress={onPress}
      disabled={generating}
      activeOpacity={0.85}
    >
      {generating
        ? <ActivityIndicator color={subtle ? GOLD : '#000'} size="small" />
        : <Text style={[s.generateBtnText, subtle && { color: GOLD }]}>{label}</Text>
      }
    </TouchableOpacity>
  );
}

// ── styles ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 8,
  },
  headerSide:   { width: 60 },
  headerCenter: { alignItems: 'center' },
  headerLogo:   { width: 26, height: 26, marginBottom: 2 },
  back:  { fontSize: 14, fontFamily: FFB },
  title: { fontSize: 13, fontFamily: FFB, letterSpacing: 1 },
  subtitle: { fontSize: 12, fontFamily: FF, color: '#9ca3af', paddingHorizontal: 20, marginBottom: 16 },

  scroll: { paddingHorizontal: 20, gap: 12 },

  card: { borderRadius: 14, borderWidth: 1, padding: 16 },
  cardType: { fontSize: 10, fontFamily: FFB, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  headline: { fontSize: 16, fontFamily: FFB, marginBottom: 6 },
  summary:  { fontSize: 13, fontFamily: FF, lineHeight: 19 },
  body:     { fontSize: 13, fontFamily: FF, lineHeight: 20, marginTop: 12 },

  divider: { height: 1, backgroundColor: '#1c1c1c' },

  courseRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  courseName: { fontSize: 14, fontFamily: FFB, marginBottom: 3 },
  courseSub:  { fontSize: 11, fontFamily: FF, color: '#9ca3af' },

  banterRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 14,
    paddingTop: 12, borderTopWidth: 1, borderTopColor: '#1c1c1c',
  },
  banterPortrait: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: `${GOLD}55` },
  banterBubble: {
    flex: 1, backgroundColor: `${GOLD}0d`, borderWidth: 1, borderColor: `${GOLD}30`,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
  },
  banterName: { fontSize: 9, fontFamily: FFB, color: GOLD, letterSpacing: 1, marginBottom: 2 },
  banterText: { fontSize: 12, fontFamily: FF, color: '#fff', lineHeight: 17, fontStyle: 'italic' },

  holeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  holeChip: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  holeChipNum: { fontSize: 13, fontFamily: FFB },
  holeMeta:  { fontSize: 12, fontFamily: FFB, color: '#fff' },
  holeExtra: { fontSize: 10, fontFamily: FF, color: '#9ca3af', marginTop: 2 },
  holeVsPar: { fontSize: 15, fontFamily: FFB },

  suggestionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10 },
  suggestionDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: GOLD, marginTop: 6 },
  suggestionText: { flex: 1, fontSize: 13, fontFamily: FF, color: '#fff', lineHeight: 18 },

  generateBtn: {
    backgroundColor: GOLD, borderRadius: 14, paddingVertical: 15,
    alignItems: 'center', marginTop: 4,
  },
  generateBtnSubtle: { backgroundColor: 'transparent', borderWidth: 1, borderColor: `${GOLD}44` },
  generateBtnText: { fontSize: 14, fontFamily: FFB, color: '#000' },

  empty:      { alignItems: 'center', marginTop: 40, gap: 8, paddingHorizontal: 20 },
  emptyEmoji: { fontSize: 40 },
  emptyTitle: { fontSize: 15, fontFamily: FFB },
  emptySub:   { fontSize: 12, fontFamily: FF, color: '#9ca3af', textAlign: 'center', lineHeight: 18, marginBottom: 8 },
});
