import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Platform, Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { goBack } from '../../../src/lib/navigation';
import { getFormatRules } from '../../../src/lib/tournamentFormat';

const GOLD = '#D4AF37';
const FF   = 'JUSTSans';
const FFB  = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

// Read-only summary of everything a tournament was created with — the
// Builder's Review step only exists while building, so a live tournament had
// no way to look back at what was set up. Display only: nothing here edits.
export default function ReviewTournamentScreen() {
  const { id: competitionId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    [FF]:  require('../../../assets/fonts/JUSTSans-Regular.otf'),
    [FFB]: require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [loading, setLoading] = useState(true);
  const [comp, setComp]       = useState<any>(null);
  const [days, setDays]       = useState<any[]>([]);
  const [players, setPlayers] = useState<any[]>([]);
  const [teams, setTeams]     = useState<Record<string, string>>({});
  const [cats, setCats]       = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!competitionId) return;
    const [{ data: c }, { data: d }, { data: cp }, { data: t }, { data: pc }] = await Promise.all([
      supabase.from('competitions').select('*').eq('id', competitionId).single(),
      supabase.from('competition_days').select('*').eq('competition_id', competitionId).order('day_number'),
      supabase.from('competition_players').select('player_id, team_id, handicap_index, status, is_captain, players(display_name)').eq('competition_id', competitionId),
      supabase.from('teams').select('id, name').eq('competition_id', competitionId),
      supabase.from('prize_categories').select('id, name, hcp_min, hcp_max, display_order, prize_payouts(position, prize_money)').eq('competition_id', competitionId).order('display_order'),
    ]);
    setComp(c);
    setDays((d ?? []) as any[]);
    setPlayers((cp ?? []) as any[]);
    setTeams(Object.fromEntries(((t ?? []) as any[]).map(x => [x.id, x.name])));
    setCats((pc ?? []) as any[]);
    setLoading(false);
  }, [competitionId]);

  useEffect(() => { load(); }, [load]);

  if (!fontsLoaded || loading || !comp) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" />
      <ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  const active = players.filter(p => p.status !== 'declined');
  const bands: any[] = comp.handicap_cut_bands ?? [];
  const fmtBand = (b: any) => `${b.min}${b.max == null ? '+' : `–${Math.floor(b.max)}`}: ${b.cutPerPoint}/pt`;
  const fmtRange = (c: any) => c.hcp_min == null && c.hcp_max == null ? 'All handicaps'
    : `${c.hcp_min ?? 0}${c.hcp_max == null ? '+' : `–${c.hcp_max}`}`;
  const fmtDate = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  const Row = ({ label, value }: { label: string; value: string }) => (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );

  const teamIds = [...new Set(active.map(p => p.team_id).filter(Boolean))] as string[];
  const unassigned = active.filter(p => !p.team_id);

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/admin/live-tournaments')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Image source={titanLogo} style={s.logo} resizeMode="contain" />
          <Text style={s.headerTitle}>REVIEW TOURNAMENT</Text>
          <Text style={s.headerSub} numberOfLines={1}>{comp.name}</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.sectionTitle}>DETAILS</Text>
        <View style={s.card}>
          <Row label="Name" value={comp.name} />
          <Row label="Format" value={getFormatRules(comp.format).label} />
          <Row label="Dates" value={`${fmtDate(comp.start_date)} – ${fmtDate(comp.end_date)}`} />
          <Row label="Rounds" value={String(days.length)} />
          <Row label="Players" value={String(active.length)} />
          <Row label="Max handicap" value={comp.max_handicap != null ? String(comp.max_handicap) : 'None'} />
          <Row label="PIN" value={comp.pin ?? '—'} />
          <Row label="Counts for Kronos" value={comp.include_in_kronos ? 'Yes' : 'No'} />
          {!!comp.description && <Row label="Notes" value={comp.description} />}
        </View>

        <Text style={s.sectionTitle}>ROUNDS</Text>
        {days.map(d => (
          <View key={d.id} style={s.card}>
            <Text style={s.cardTitle}>Round {d.day_number} · {getFormatRules(d.day_format ?? comp.format).label}</Text>
            <Row label="Course" value={d.course_name ?? '—'} />
            <Row label="Tee" value={d.tee_name ? `${d.tee_name}${d.tee_gender === 'F' ? ' (ladies)' : d.tee_gender === 'M' ? ' (men)' : ''}` : '—'} />
            <Row label="Rating / Slope" value={d.course_rating != null ? `${d.course_rating} / ${d.slope_rating ?? '—'}` : '—'} />
            <Row label="Handicap allowance" value={d.hcp_pct != null ? `${d.hcp_pct}%` : '—'} />
            <Row label="WHS" value={d.whs_enabled ? 'On' : 'Off'} />
            <Row label="Date" value={fmtDate(d.day_date ?? d.play_date)} />
            {!!d.tee_time && <Row label="First tee" value={String(d.tee_time).slice(0, 5)} />}
          </View>
        ))}

        <Text style={s.sectionTitle}>HANDICAP CUTS</Text>
        <View style={s.card}>
          <Row label="Automatic cuts" value={comp.handicap_cuts_enabled ? 'On' : 'Off'} />
          {comp.handicap_cuts_enabled && (
            <>
              <Row label="Trigger score" value={`${comp.handicap_cut_trigger_score ?? 36} pts`} />
              <Row label="Lowest handicap" value={String(comp.handicap_cut_minimum ?? 0)} />
              <Row label="Cut rates" value={bands.map(fmtBand).join('\n')} />
            </>
          )}
        </View>

        <Text style={s.sectionTitle}>PRIZES</Text>
        <View style={s.card}>
          <Row label="Prize money" value={comp.prizes_enabled ? 'On' : 'Off'} />
          {comp.prizes_enabled && (
            <>
              {comp.include_in_kronos && <Row label="Overall trophy" value={comp.kronos_overall_prize != null ? `£${comp.kronos_overall_prize}` : 'Not set'} />}
              <Row label="Division prizes" value={comp.division_prizes_enabled ? 'On' : 'Off'} />
            </>
          )}
          {comp.prizes_enabled && comp.division_prizes_enabled && cats.map(c => (
            <View key={c.id} style={s.subBlock}>
              <Text style={s.subTitle}>{c.name} · {fmtRange(c)}</Text>
              <Text style={s.subText}>
                {[...(c.prize_payouts ?? [])].sort((a: any, b: any) => a.position - b.position)
                  .map((p: any) => `${p.position}${['st', 'nd', 'rd'][p.position - 1] ?? 'th'} £${p.prize_money}`).join('  ·  ') || 'No prize amounts set'}
              </Text>
            </View>
          ))}
        </View>

        <Text style={s.sectionTitle}>PLAYERS</Text>
        {teamIds.map(tid => (
          <View key={tid} style={s.card}>
            <Text style={s.cardTitle}>{teams[tid] ?? 'Team'}</Text>
            {active.filter(p => p.team_id === tid).map(p => (
              <Row key={p.player_id} label={`${p.players?.display_name ?? 'Player'}${p.is_captain ? ' (C)' : ''}`} value={`HCP ${p.handicap_index}`} />
            ))}
          </View>
        ))}
        {unassigned.length > 0 && (
          <View style={s.card}>
            {teamIds.length > 0 && <Text style={s.cardTitle}>No team</Text>}
            {unassigned.map(p => (
              <Row key={p.player_id} label={p.players?.display_name ?? 'Player'} value={`HCP ${p.handicap_index}`} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 32, paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  back:        { fontFamily: FFB, fontSize: 13, color: GOLD },
  logo:        { width: 24, height: 24, marginBottom: 2 },
  headerTitle: { fontFamily: FFB, fontSize: 12, color: '#fff', letterSpacing: 1 },
  headerSub:   { fontFamily: FF, fontSize: 11, color: '#888', marginTop: 2, maxWidth: 160, textAlign: 'center' },
  scroll:      { padding: 16, paddingBottom: 60 },
  sectionTitle: { fontFamily: FFB, fontSize: 11, color: GOLD, letterSpacing: 1.5, marginTop: 18, marginBottom: 8 },
  card:      { backgroundColor: '#0d0d0d', borderWidth: 1, borderColor: '#1c1c1c', borderRadius: 12, padding: 14, marginBottom: 10 },
  cardTitle: { fontFamily: FFB, fontSize: 14, color: '#fff', marginBottom: 8 },
  row:       { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, gap: 16 },
  rowLabel:  { fontFamily: FF, fontSize: 13, color: '#888' },
  rowValue:  { fontFamily: FFB, fontSize: 13, color: '#fff', flexShrink: 1, textAlign: 'right' },
  subBlock:  { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#1c1c1c' },
  subTitle:  { fontFamily: FFB, fontSize: 12, color: '#fff' },
  subText:   { fontFamily: FF, fontSize: 12, color: '#aaa', marginTop: 2 },
});
