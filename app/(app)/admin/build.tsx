import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View, Text, ScrollView, StyleSheet, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert, Switch, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { uploadImage } from '../../../src/lib/uploadImage';

const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const RED    = '#f87171';
const PURPLE = '#a78bfa';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

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
  { id: 'four_bbb',   label: '4BBB',       sub: 'Best ball pairs' },
  { id: 'foursomes',  label: 'Foursomes',  sub: 'Alternate shot' },
  { id: 'greensomes', label: 'Greensomes', sub: 'Pick best drive' },
  { id: 'singles',    label: 'Singles',    sub: '1v1 matchplay' },
  { id: 'stableford', label: 'Stableford', sub: 'Points per hole' },
  { id: 'medal',      label: 'Medal',      sub: 'Stroke play' },
  { id: 'scramble',   label: 'Scramble',   sub: 'Team scramble' },
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
}

const STEPS = ['Format', 'Details', 'Days', 'Review'];

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
  const [description, setDescription]     = useState('');
  const [startDate, setStartDate]         = useState('');
  const [endDate, setEndDate]             = useState('');
  const [numTeams, setNumTeams]           = useState('2');
  const [maxHandicap, setMaxHandicap]     = useState('');
  const [logoUri, setLogoUri]             = useState<string | null>(null);
  const [creating, setCreating]             = useState(false);

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
  }, []));

  const formatDef = COMP_FORMATS.find(f => f.id === selectedFormat);

  function pickFormat(f: CompFormat) {
    if (!f.available) return;
    setSelectedFormat(f.id);
    setIncludeInKronos(f.id === 'team_matchplay');
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

  function tournamentType(f: FormatId): 'ryder_cup' | 'titan_tour' | 'casual' {
    if (f === 'ryder_cup') return 'ryder_cup';
    if (f === 'team_matchplay') return 'titan_tour';
    return 'casual';
  }

  const isMatchplay = selectedFormat === 'ryder_cup' || selectedFormat === 'team_matchplay';

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

  async function create() {
    if (!selectedFormat || !name.trim()) return;
    if (!societyId) { Alert.alert('Error', 'Society not found.'); return; }

    const numTeamsN = parseInt(numTeams, 10) || 0;
    if (isMatchplay && numTeamsN % 2 !== 0) {
      Alert.alert('Number of teams must be even', 'Titan Tour and Ryder Cup formats need an even number of teams to pair up.');
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
    };

    const pin = String(1000 + Math.floor(Math.random() * 9000));

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
        start_date:      startDate.trim() || null,
        end_date:        endDate.trim() || null,
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
    }));

    const { error: daysErr } = await supabase.from('competition_days').insert(dayRows);
    setCreating(false);

    if (daysErr) {
      Alert.alert('Warning', 'Created but days failed: ' + daysErr.message);
      return;
    }

    Alert.alert(
      'Tournament Created',
      `${name.trim()} is ready!\n\nTournament PIN: ${pin}\n\nShare this PIN with players so they can unlock the Tour tab. You can also find it in Admin at any time.`,
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
            <Text style={styles.stepSub}>Name it and set how many days you want to play.</Text>

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
            <TextInput
              style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
              value={description}
              onChangeText={setDescription}
              placeholder="What's this tournament about?"
              placeholderTextColor="#444"
              multiline
            />

            <Text style={styles.fieldLabel}>START DATE (OPTIONAL)</Text>
            <TextInput
              style={styles.input}
              value={startDate}
              onChangeText={setStartDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#444"
            />
            <Text style={styles.fieldLabel}>END DATE (OPTIONAL)</Text>
            <TextInput
              style={styles.input}
              value={endDate}
              onChangeText={setEndDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#444"
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
          </View>
        )}

        {/* Step 2: Day Setup */}
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
                  placeholderTextColor="#444"
                  autoCapitalize="words"
                />

                <Text style={styles.fieldLabel}>FORMAT</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', gap: 8, paddingRight: 16 }}>
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

        {/* Step 3: Review + Create */}
        {step === 3 && (
          <View>
            <Text style={styles.stepTitle}>Ready to Launch</Text>
            <Text style={styles.stepSub}>Review your tournament setup and create it.</Text>

            <View style={styles.reviewCard}>
              <ReviewRow label="Format" value={formatDef?.label ?? '—'} />
              <ReviewRow label="Name" value={name.trim() || '—'} />
              <ReviewRow label="Year" value={year} />
              <ReviewRow label="Days" value={String(days.length)} />
              {isMatchplay && <ReviewRow label="Teams" value={numTeams} />}
              {isMatchplay && <ReviewRow label="Points" value={`Win ${ptsWin} / Half ${ptsHalf}`} />}
              {isMatchplay && <ReviewRow label="Opening Rounds" value={openingRounds} />}
              {isMatchplay && <ReviewRow label="Sweep Bonus" value={bonusPoints} />}
              {maxHandicap.trim() !== '' && <ReviewRow label="Max HCP" value={maxHandicap} />}
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
                ? <ActivityIndicator color="#000" />
                : <Text style={styles.createBtnText}>Create Tournament</Text>
              }
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>

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
    flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  rowLast: { borderBottomWidth: 0 },
  key: { width: 72, fontSize: 13, fontFamily: 'JUSTSans-ExBold', color: '#fff' },
  val: { flex: 1, fontSize: 13, fontFamily: 'JUSTSans-ExBold', color: '#fff' },
});

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

  // Review
  reviewCard: {
    backgroundColor: '#111', borderRadius: 12, borderWidth: 1,
    borderColor: '#1c1c1c', overflow: 'hidden', marginBottom: 16,
  },
  reviewNote: { fontSize: 13, fontFamily: FFB, color: '#fff', lineHeight: 20, marginBottom: 20 },
  createBtn: {
    backgroundColor: GOLD, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center',
  },
  createBtnText: { fontSize: 15, fontFamily: FFB, color: '#000', letterSpacing: 0.5 },

  // Footer
  footer: { padding: 16, paddingBottom: 20, borderTopWidth: 1, borderTopColor: '#1c1c1c' },
  nextBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  nextBtnOff: { opacity: 0.35 },
  nextBtnText: { fontSize: 15, fontFamily: FFB, color: '#000' },
});
