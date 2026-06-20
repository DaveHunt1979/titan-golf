import { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';

interface Round {
  score: string;
  rating: string;
  slope: string;
}

function blankRound(): Round {
  return { score: '', rating: '72', slope: '113' };
}

function calcDifferential(score: number, rating: number, slope: number): number {
  return (score - rating) * 113 / slope;
}

function whsBestCount(n: number): number {
  if (n <= 5)  return 1;
  if (n <= 8)  return 2;
  if (n <= 11) return 3;
  if (n <= 14) return 4;
  if (n <= 16) return 5;
  if (n <= 18) return 6;
  if (n === 19) return 7;
  return 8;
}

function calcHandicapIndex(differentials: number[]): number {
  const sorted = [...differentials].sort((a, b) => a - b);
  const n = whsBestCount(sorted.length);
  const best = sorted.slice(0, n);
  const avg = best.reduce((a, b) => a + b, 0) / best.length;
  return Math.round(avg * 0.96 * 10) / 10;
}

export default function HandicapCalculatorScreen() {
  const router = useRouter();
  const [rounds, setRounds] = useState<Round[]>([blankRound(), blankRound(), blankRound()]);
  const [saving, setSaving] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('players').select('id, handicap_rounds').eq('auth_uid', user.id).maybeSingle()
        .then(({ data }) => {
          if (!data) return;
          setPlayerId(data.id);
          const saved = (data as any).handicap_rounds as Round[] | null;
          if (saved && saved.length >= 3) setRounds(saved);
        });
    });
  }, []);

  function updateRound(i: number, field: keyof Round, value: string) {
    setRounds(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  }

  function addRound() {
    if (rounds.length >= 20) return;
    setRounds(prev => [...prev, blankRound()]);
  }

  function removeRound(i: number) {
    if (rounds.length <= 3) return;
    setRounds(prev => prev.filter((_, idx) => idx !== i));
  }

  // Build differentials from filled rounds
  const differentials = rounds
    .map(r => {
      const score  = parseFloat(r.score);
      const rating = parseFloat(r.rating) || 72;
      const slope  = parseFloat(r.slope)  || 113;
      if (isNaN(score)) return null;
      return calcDifferential(score, rating, slope);
    })
    .filter((d): d is number => d !== null);

  const canCalculate = differentials.length >= 3;
  const handicapIndex = canCalculate ? calcHandicapIndex(differentials) : null;

  async function saveHandicap() {
    if (!canCalculate || handicapIndex === null || !playerId) return;
    setSaving(true);
    const { error } = await supabase
      .from('players')
      .update({ handicap_index: handicapIndex, handicap_rounds: rounds } as any)
      .eq('id', playerId);
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    Alert.alert(
      'Handicap Saved',
      `Your Handicap Index has been set to ${handicapIndex}.`,
      [{ text: 'Done', onPress: () => router.back() }]
    );
  }

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={s.back}>← Profile</Text>
        </TouchableOpacity>
        <Text style={s.title}>Handicap Calculator</Text>
        <View style={{ width: 70 }} />
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.infoCard}>
          <Text style={s.infoText}>
            Enter your recent scorecards — minimum 3 rounds. We'll calculate your WHS Handicap Index using the official formula.
          </Text>
        </View>

        {/* Column headers */}
        <View style={s.colHeaders}>
          <Text style={[s.colHeader, { flex: 0.5 }]}>#</Text>
          <Text style={[s.colHeader, { flex: 1.2 }]}>GROSS SCORE</Text>
          <Text style={[s.colHeader, { flex: 1 }]}>COURSE RATING</Text>
          <Text style={[s.colHeader, { flex: 0.8 }]}>SLOPE</Text>
          <View style={{ width: 28 }} />
        </View>

        {rounds.map((r, i) => {
          const score  = parseFloat(r.score);
          const rating = parseFloat(r.rating) || 72;
          const slope  = parseFloat(r.slope)  || 113;
          const diff   = !isNaN(score) ? calcDifferential(score, rating, slope) : null;

          return (
            <View key={i} style={s.roundCard}>
              <View style={s.roundRow}>
                <Text style={[s.roundNum, { flex: 0.5 }]}>{i + 1}</Text>

                <TextInput
                  style={[s.cell, { flex: 1.2 }]}
                  value={r.score}
                  onChangeText={v => updateRound(i, 'score', v.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  placeholder="e.g. 84"
                  placeholderTextColor={colors.textMuted}
                  maxLength={3}
                />
                <TextInput
                  style={[s.cell, { flex: 1 }]}
                  value={r.rating}
                  onChangeText={v => updateRound(i, 'rating', v)}
                  keyboardType="decimal-pad"
                  placeholder="72.0"
                  placeholderTextColor={colors.textMuted}
                  maxLength={5}
                />
                <TextInput
                  style={[s.cell, { flex: 0.8 }]}
                  value={r.slope}
                  onChangeText={v => updateRound(i, 'slope', v.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  placeholder="113"
                  placeholderTextColor={colors.textMuted}
                  maxLength={3}
                />
                <TouchableOpacity
                  onPress={() => removeRound(i)}
                  disabled={rounds.length <= 3}
                  style={s.removeBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={[s.removeText, rounds.length <= 3 && { opacity: 0.2 }]}>✕</Text>
                </TouchableOpacity>
              </View>

              {diff !== null && (
                <Text style={s.diffLabel}>Differential: {diff.toFixed(1)}</Text>
              )}
            </View>
          );
        })}

        {rounds.length < 20 && (
          <TouchableOpacity style={s.addBtn} onPress={addRound} activeOpacity={0.7}>
            <Text style={s.addBtnText}>+ Add Round</Text>
          </TouchableOpacity>
        )}

        {/* Result card */}
        <View style={[s.resultCard, !canCalculate && { opacity: 0.4 }]}>
          <Text style={s.resultLabel}>WHS Handicap Index</Text>
          <Text style={s.resultValue}>
            {handicapIndex !== null ? handicapIndex.toFixed(1) : '—'}
          </Text>
          {canCalculate && (
            <Text style={s.resultSub}>
              Best {whsBestCount(differentials.length)} of {differentials.length} differentials × 0.96
            </Text>
          )}
          {!canCalculate && (
            <Text style={s.resultSub}>Enter at least 3 scores to calculate</Text>
          )}
        </View>

        <TouchableOpacity
          style={[s.saveBtn, (!canCalculate || saving) && { opacity: 0.4 }]}
          onPress={saveHandicap}
          disabled={!canCalculate || saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color={colors.bg} />
            : <Text style={s.saveBtnText}>Save Handicap Index</Text>
          }
        </TouchableOpacity>

        <View style={s.noteCard}>
          <Text style={s.noteText}>
            Course Rating and Slope are printed on the scorecard. If you don't have them, the defaults (72 / 113) give a reasonable estimate.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back:  { fontSize: fonts.sm, fontWeight: '600', color: colors.gold },
  title: { fontSize: fonts.md, fontWeight: '800', color: colors.white },
  scroll: { padding: spacing.lg, paddingBottom: 60 },

  infoCard: {
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.lg,
  },
  infoText: { fontSize: fonts.sm, color: colors.textSecondary, lineHeight: 20 },

  colHeaders: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs, paddingHorizontal: 2 },
  colHeader:  { fontSize: 9, fontWeight: '800', color: colors.textMuted, letterSpacing: 1 },

  roundCard: {
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, marginBottom: spacing.sm, padding: spacing.sm,
  },
  roundRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  roundNum:  { fontSize: fonts.sm, fontWeight: '800', color: colors.textMuted, textAlign: 'center' },
  cell: {
    backgroundColor: colors.cardAlt, borderRadius: radius.sm, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    fontSize: fonts.md, fontWeight: '700', color: colors.white, textAlign: 'center',
  },
  removeBtn:  { width: 28, alignItems: 'center' },
  removeText: { fontSize: 13, color: colors.red, fontWeight: '700' },
  diffLabel:  { fontSize: fonts.xs, color: colors.gold, marginTop: 6, marginLeft: 2 },

  addBtn: {
    borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed',
    borderRadius: radius.md, paddingVertical: spacing.md,
    alignItems: 'center', marginBottom: spacing.lg,
  },
  addBtnText: { fontSize: fonts.sm, fontWeight: '700', color: colors.textMuted },

  resultCard: {
    backgroundColor: colors.goldDim, borderRadius: radius.md, borderWidth: 2,
    borderColor: colors.goldBorder, padding: spacing.lg, alignItems: 'center',
    marginBottom: spacing.md,
  },
  resultLabel: { fontSize: fonts.xs, fontWeight: '800', color: colors.gold, letterSpacing: 2, textTransform: 'uppercase', marginBottom: spacing.xs },
  resultValue: { fontSize: 48, fontWeight: '900', color: colors.white, letterSpacing: -1 },
  resultSub:   { fontSize: fonts.xs, color: colors.textMuted, marginTop: 4 },

  saveBtn: {
    backgroundColor: colors.gold, borderRadius: radius.md,
    paddingVertical: spacing.md, alignItems: 'center', marginBottom: spacing.lg,
  },
  saveBtnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg },

  noteCard: {
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md,
  },
  noteText: { fontSize: fonts.xs, color: colors.textMuted, lineHeight: 18 },
});
