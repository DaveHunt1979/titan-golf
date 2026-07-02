import { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert, Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';

type FormatId = 'team_matchplay' | 'ryder_cup' | 'stableford' | 'medal' | 'knockout';
type DayFormatId = 'four_bbb' | 'foursomes' | 'greensomes' | 'singles' | 'stableford' | 'medal' | 'scramble';

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
  { id: 'four_bbb', label: '4BBB', sub: 'Best ball pairs' },
  { id: 'foursomes', label: 'Foursomes', sub: 'Alternate shot' },
  { id: 'greensomes', label: 'Greensomes', sub: 'Pick best drive' },
  { id: 'singles', label: 'Singles', sub: '1v1 matchplay' },
  { id: 'stableford', label: 'Stableford', sub: 'Points per hole' },
  { id: 'medal', label: 'Medal', sub: 'Stroke play' },
  { id: 'scramble', label: 'Scramble', sub: 'Team scramble' },
];

const HCP_OPTIONS = [
  { pct: 100, label: 'Full' },
  { pct: 87, label: '7/8' },
  { pct: 75, label: '3/4' },
  { pct: 0, label: 'Scratch' },
];

interface DayConfig {
  courseName: string;
  format: DayFormatId;
  hcpPct: number;
}

const STEPS = ['Format', 'Details', 'Days', 'Review'];

export default function BuildTournamentScreen() {
  const router = useRouter();
  const { societyId } = useAdminSociety();
  const [step, setStep] = useState(0);

  const [selectedFormat, setSelectedFormat] = useState<FormatId | null>(null);
  const [name, setName] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear() + 1));
  const [days, setDays] = useState<DayConfig[]>([]);
  const [includeInKronos, setIncludeInKronos] = useState(false);
  const [creating, setCreating] = useState(false);

  const formatDef = COMP_FORMATS.find(f => f.id === selectedFormat);

  function pickFormat(f: CompFormat) {
    if (!f.available) return;
    setSelectedFormat(f.id);
    setIncludeInKronos(f.id === 'team_matchplay');
    // Smart defaults: last day is singles for multi-team tour
    const builtDays: DayConfig[] = Array.from({ length: f.defaultDays }, (_, i) => {
      const isLastDay = i === f.defaultDays - 1;
      const isTour = f.id === 'team_matchplay';
      return {
        courseName: '',
        format: isLastDay && isTour ? 'singles' : f.defaultDayFormat,
        hcpPct: isLastDay && isTour ? 85 : f.defaultHcp,
      };
    });
    setDays(builtDays);
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
    }]);
  }

  function removeLastDay() {
    if (days.length <= 1) return;
    setDays(prev => prev.slice(0, -1));
  }

  async function create() {
    if (!selectedFormat || !name.trim()) return;
    if (!societyId) { Alert.alert('Error', 'Society not found.'); return; }
    setCreating(true);

    const settings = {
      format_type: selectedFormat,
      num_days: days.length,
      day_configs: days.map(d => ({ format: d.format, hcp_pct: d.hcpPct })),
      ...(selectedFormat === 'team_matchplay' || selectedFormat === 'ryder_cup'
        ? { pts_win: 2, pts_win_singles: 3, pts_half: 1 }
        : {}),
    };

    const { data: comp, error: compErr } = await supabase
      .from('competitions')
      .insert({
        society_id: societyId,
        name: name.trim(),
        year: parseInt(year, 10) || new Date().getFullYear() + 1,
        format: selectedFormat,
        status: 'draft',
        settings,
        include_in_kronos: includeInKronos,
      })
      .select()
      .single();

    if (compErr || !comp) {
      setCreating(false);
      Alert.alert('Error', compErr?.message ?? 'Could not create competition');
      return;
    }

    const dayRows = days.map((d, i) => ({
      competition_id: comp.id,
      day_number: i + 1,
      course_name: d.courseName.trim() || null,
    }));

    const { error: daysErr } = await supabase.from('competition_days').insert(dayRows);
    setCreating(false);

    if (daysErr) {
      Alert.alert('Warning', 'Created but days failed: ' + daysErr.message);
      return;
    }

    Alert.alert(
      'Tournament Created',
      `${name.trim()} is ready. Add players and generate the draw from the admin screen.`,
      [{ text: 'View Tour', onPress: () => router.replace('/(app)/tour' as any) }],
    );
  }

  function next() { setStep(s => Math.min(s + 1, 3)); }
  function back() {
    if (step === 0) router.back();
    else setStep(s => s - 1);
  }

  const canNext = [
    selectedFormat !== null,
    name.trim().length >= 2,
    true,
  ][step] ?? true;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={back} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.backText}>{step === 0 ? '✕ Cancel' : '‹ Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Build Tournament</Text>
        {/* Step dots */}
        <View style={styles.stepDots}>
          {STEPS.map((_, i) => (
            <View key={i} style={[styles.dot, step >= i && styles.dotOn]} />
          ))}
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Step 0: Format ── */}
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
                  <Text style={[styles.formatLabel, !f.available && { color: colors.textMuted }]}>
                    {f.label}
                  </Text>
                  {!f.available && (
                    <Text style={styles.comingSoon}>COMING SOON</Text>
                  )}
                  {selectedFormat === f.id && (
                    <Text style={styles.tick}>✓</Text>
                  )}
                </View>
                <Text style={[styles.formatSub, !f.available && { color: colors.textMuted }]}>
                  {f.sub}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── Step 1: Details ── */}
        {step === 1 && (
          <View>
            <Text style={styles.stepTitle}>Competition Details</Text>
            <Text style={styles.stepSub}>Name it and set how many days you want to play.</Text>

            <Text style={styles.fieldLabel}>NAME</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Titan Tour 2028"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
            />

            <Text style={styles.fieldLabel}>YEAR</Text>
            <TextInput
              style={styles.input}
              value={year}
              onChangeText={setYear}
              placeholder="2028"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              maxLength={4}
            />

            <Text style={styles.fieldLabel}>NUMBER OF DAYS</Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={[styles.stepperBtn, days.length <= 1 && styles.stepperBtnOff]}
                onPress={removeLastDay}
                activeOpacity={0.7}
              >
                <Text style={styles.stepperBtnText}>–</Text>
              </TouchableOpacity>
              <Text style={styles.stepperValue}>{days.length} {days.length === 1 ? 'day' : 'days'}</Text>
              <TouchableOpacity
                style={[styles.stepperBtn, days.length >= 10 && styles.stepperBtnOff]}
                onPress={addDay}
                activeOpacity={0.7}
              >
                <Text style={styles.stepperBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>KRONOS TROPHY</Text>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>Include in Kronos Trophy</Text>
                <Text style={styles.toggleSub}>Individual Stableford scores count toward the season leaderboard</Text>
              </View>
              <Switch
                value={includeInKronos}
                onValueChange={setIncludeInKronos}
                trackColor={{ false: colors.border, true: colors.goldBorder }}
                thumbColor={includeInKronos ? colors.gold : colors.textMuted}
              />
            </View>
          </View>
        )}

        {/* ── Step 2: Day Setup ── */}
        {step === 2 && (
          <View>
            <Text style={styles.stepTitle}>Day Setup</Text>
            <Text style={styles.stepSub}>Set the course and format for each day. Rick can mix it up every year.</Text>
            {days.map((day, i) => (
              <View key={i} style={styles.dayCard}>
                <Text style={styles.dayLabel}>DAY {i + 1}</Text>

                <Text style={styles.fieldLabel}>COURSE</Text>
                <TextInput
                  style={styles.input}
                  value={day.courseName}
                  onChangeText={v => updateDay(i, { courseName: v })}
                  placeholder="e.g. West Cliffs"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="words"
                />

                <Text style={styles.fieldLabel}>FORMAT</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.xs }}>
                  <View style={{ flexDirection: 'row', gap: spacing.xs, paddingRight: spacing.md }}>
                    {DAY_FORMATS.map(f => (
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
              </View>
            ))}
          </View>
        )}

        {/* ── Step 3: Review + Create ── */}
        {step === 3 && (
          <View>
            <Text style={styles.stepTitle}>Ready to Launch</Text>
            <Text style={styles.stepSub}>Review your tournament setup and create it.</Text>

            <View style={styles.reviewCard}>
              <ReviewRow label="Format" value={formatDef?.label ?? '—'} />
              <ReviewRow label="Name" value={name.trim() || '—'} />
              <ReviewRow label="Year" value={year} />
              <ReviewRow label="Days" value={String(days.length)} />
              <ReviewRow label="Kronos" value={includeInKronos ? '✓ Included' : 'Not included'} last />
            </View>

            <View style={styles.reviewCard}>
              {days.map((d, i) => (
                <ReviewRow
                  key={i}
                  label={`Day ${i + 1}`}
                  value={`${d.courseName || 'TBC'} · ${DAY_FORMATS.find(f => f.id === d.format)?.label} · ${d.hcpPct}% hcp`}
                  last={i === days.length - 1}
                />
              ))}
            </View>

            <Text style={styles.reviewNote}>
              The tournament is created as a draft. Add players, assign teams and generate the draw from the admin screen before activating.
            </Text>

            <TouchableOpacity
              style={[styles.createBtn, creating && { opacity: 0.6 }]}
              onPress={create}
              disabled={creating}
              activeOpacity={0.85}
            >
              {creating
                ? <ActivityIndicator color={colors.bg} />
                : <Text style={styles.createBtnText}>Create Tournament</Text>
              }
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>

      {/* Next button (steps 0–2) */}
      {step < 3 && (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.nextBtn, !canNext && styles.nextBtnOff]}
            onPress={next}
            disabled={!canNext}
            activeOpacity={0.85}
          >
            <Text style={styles.nextBtnText}>{step === 2 ? 'Review →' : 'Next →'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function ReviewRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[reviewStyles.row, last && reviewStyles.rowLast]}>
      <Text style={reviewStyles.key}>{label}</Text>
      <Text style={reviewStyles.val} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const reviewStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', paddingVertical: 10, paddingHorizontal: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  key: { width: 72, fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600' },
  val: { flex: 1, fontSize: fonts.sm, color: colors.white, fontWeight: '600' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  backText: { fontSize: fonts.sm, color: colors.gold, fontWeight: '600', width: 80 },
  headerTitle: { fontSize: fonts.md, fontWeight: '800', color: colors.white, letterSpacing: 0.5 },
  stepDots: { flexDirection: 'row', gap: 6, width: 80, justifyContent: 'flex-end' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { backgroundColor: colors.gold },
  scroll: { padding: spacing.lg, paddingBottom: 48 },
  stepTitle: { fontSize: fonts.xl, fontWeight: '800', color: colors.white, marginBottom: 6 },
  stepSub: { fontSize: fonts.sm, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 20 },

  // Format cards
  formatCard: {
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  formatCardOn: { borderColor: colors.gold, backgroundColor: colors.cardAlt },
  formatCardOff: { opacity: 0.4 },
  formatRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  formatLabel: { flex: 1, fontSize: fonts.md, fontWeight: '700', color: colors.white },
  formatSub: { fontSize: fonts.sm, color: colors.textSecondary, lineHeight: 18 },
  comingSoon: { fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 1 },
  tick: { fontSize: fonts.md, color: colors.gold, fontWeight: '800' },

  // Fields
  fieldLabel: {
    fontSize: fonts.xs, fontWeight: '700', color: colors.textMuted,
    letterSpacing: 1.5, marginBottom: spacing.xs, marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12,
    fontSize: fonts.md, color: colors.white,
  },

  // Stepper
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs },
  stepperBtn: {
    width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  stepperBtnOff: { opacity: 0.35 },
  stepperBtnText: { fontSize: fonts.xl, color: colors.gold, fontWeight: '700' },
  stepperValue: { fontSize: fonts.lg, fontWeight: '700', color: colors.white, minWidth: 88, textAlign: 'center' },

  // Day cards
  dayCard: {
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md,
  },
  dayLabel: { fontSize: fonts.xs, fontWeight: '800', color: colors.gold, letterSpacing: 2, marginBottom: 4 },

  // Format chips (horizontal scroll)
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardAlt,
    alignItems: 'center', minWidth: 80,
  },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { fontSize: fonts.sm, fontWeight: '700', color: colors.textSecondary },
  chipTextOn: { color: colors.bg },
  chipSub: { fontSize: 10, color: colors.textMuted, marginTop: 2 },

  // HCP chips
  hcpRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
  hcpChip: {
    flex: 1, paddingVertical: 10, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardAlt,
    alignItems: 'center',
  },
  hcpChipOn: { backgroundColor: colors.goldDim, borderColor: colors.goldBorder },
  hcpText: { fontSize: fonts.sm, fontWeight: '700', color: colors.textSecondary },
  hcpTextOn: { color: colors.gold },

  // Kronos toggle
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginTop: spacing.xs,
  },
  toggleLabel: { fontSize: fonts.sm, fontWeight: '700', color: colors.white, marginBottom: 2 },
  toggleSub: { fontSize: fonts.xs, color: colors.textSecondary, lineHeight: 16 },

  // Review
  reviewCard: {
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, overflow: 'hidden', marginBottom: spacing.md,
  },
  reviewNote: { fontSize: fonts.sm, color: colors.textMuted, lineHeight: 20, marginBottom: spacing.lg },
  createBtn: {
    backgroundColor: colors.gold, borderRadius: radius.md,
    paddingVertical: spacing.md, alignItems: 'center',
  },
  createBtnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg, letterSpacing: 0.5 },

  // Footer
  footer: { padding: spacing.md, paddingBottom: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
  nextBtn: { backgroundColor: colors.gold, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  nextBtnOff: { opacity: 0.35 },
  nextBtnText: { fontSize: fonts.md, fontWeight: '700', color: colors.bg },
});
