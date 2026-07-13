import { useEffect, useRef, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Image, RefreshControl, TextInput,
  KeyboardAvoidingView, Platform, Alert, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../../src/lib/supabase';
import { getStandings } from '../../../src/lib/scoring';
import { useDynamicColors, useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { teamLogos } from '../../../src/lib/assets';
import type { Competition, CompetitionDay, Match, Team, Champion, Notification } from '../../../src/types';

// ── TITAN constants ───────────────────────────────────────────────────
const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

const STORAGE_KEY = 'tour_joined_competition_id';

type TourTab = 'teams' | 'scores' | 'kronos' | 'honours' | 'info' | 'live' | 'instagram';

const TABS: { id: TourTab; label: string }[] = [
  { id: 'teams',     label: 'Teams' },
  { id: 'scores',    label: 'Scores' },
  { id: 'kronos',    label: 'Kronos' },
  { id: 'honours',   label: 'Honours' },
  { id: 'info',      label: 'Info Pack' },
  { id: 'live',      label: 'Live' },
  { id: 'instagram', label: '📷' },
];

// ── Info section types (mirrors feed/index) ──────────────────────────
export type SectionType = 'text' | 'schedule' | 'travel' | 'location' | 'contacts' | 'rules';
export interface ScheduleItem { time: string; label: string; note?: string; }
export interface TravelItem   { label: string; detail: string; }
export interface ContactItem  { name: string; role?: string; phone?: string; }
export interface TextSection     { id: string; type: 'text';     title: string; content: string; }
export interface ScheduleSection { id: string; type: 'schedule'; title: string; items: ScheduleItem[]; }
export interface TravelSection   { id: string; type: 'travel';   title: string; items: TravelItem[]; }
export interface LocationSection { id: string; type: 'location'; title: string; name: string; address?: string; phone?: string; notes?: string; }
export interface ContactsSection { id: string; type: 'contacts'; title: string; items: ContactItem[]; }
export interface RulesSection    { id: string; type: 'rules';    title: string; items: string[]; }
export type InfoSection = TextSection | ScheduleSection | TravelSection | LocationSection | ContactsSection | RulesSection;

const NOTIF_LABELS: Record<string, string> = {
  birdie: 'Birdie', eagle: 'Eagle', hole_in_one: 'Hole in One!',
  match_result: 'Match Result', draw: 'Draw Published',
  tournament_winner: 'Tournament Winner', kronos_champ: 'Kronos Champion',
  admin: 'Announcement',
};

function luminance(hex: string): number {
  const c = hex.replace('#', '');
  if (c.length < 6) return 0;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function formatDate(s: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function TourScreen() {
  const colors = useDynamicColors();
  const { palette, societyId: SOCIETY_ID } = useSocietyTheme();

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const router = useRouter();
  const pinRef = useRef<TextInput>(null);

  const [competition, setCompetition] = useState<Competition | null>(null);
  const [joinedId, setJoinedId]       = useState<string | null>(null);
  const [days, setDays]               = useState<CompetitionDay[]>([]);
  const [matches, setMatches]         = useState<Match[]>([]);
  const [teams, setTeams]             = useState<Team[]>([]);
  const [players, setPlayers]         = useState<{ id: string; display_name: string }[]>([]);
  const [kronosRows, setKronosRows]   = useState<{ playerId: string; name: string; total: number; holes: number }[]>([]);
  const [champions, setChampions]     = useState<Champion[]>([]);
  const [myPlayerId, setMyPlayerId]   = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [selectedSection, setSelectedSection] = useState<'matches' | 'standings' | 'info' | 'social' | null>(null);
  const [pin, setPin]                 = useState('');
  const [verifying, setVerifying]     = useState(false);
  const [sections, setSections]         = useState<InfoSection[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [instagramUrl, setInstagramUrl] = useState<string | null>(null);

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" />
      <ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  // ── Data loading ────────────────────────────────────────────────────

  async function loadTournamentData(compId: string) {
    const [
      { data: daysData },
      { data: matchesData },
      { data: teamsData },
      { data: holesData },
      { data: playersData },
      { data: kronosComps },
      { data: champsData },
    ] = await Promise.all([
      supabase.from('competition_days').select('*').eq('competition_id', compId).order('day_number'),
      supabase.from('matches').select('*').eq('competition_id', compId).order('match_number'),
      supabase.from('teams').select('*').order('sort_order'),
      supabase.from('match_holes').select('player_id,stableford_pts,match_id'),
      supabase.from('players').select('id,display_name'),
      supabase.from('competitions').select('id').eq('include_in_kronos', true),
      supabase.from('champions').select('*').order('year', { ascending: false }),
    ]);

    if (daysData)    setDays(daysData as CompetitionDay[]);
    if (matchesData) setMatches(matchesData as Match[]);
    if (teamsData)   setTeams(teamsData as Team[]);
    if (champsData)  setChampions(champsData as Champion[]);
    if (playersData) setPlayers(playersData as any[]);

    if (holesData && playersData) {
      const kronosIds = new Set((kronosComps ?? []).map((c: any) => c.id));
      const kronosMatchIds = new Set(
        (matchesData as any[] ?? [])
          .filter(m => kronosIds.has(m.competition_id))
          .map(m => m.id),
      );
      const totals: Record<string, { total: number; holes: number }> = {};
      (holesData as any[]).forEach(h => {
        if (h.stableford_pts != null && kronosMatchIds.has(h.match_id)) {
          if (!totals[h.player_id]) totals[h.player_id] = { total: 0, holes: 0 };
          totals[h.player_id].total += h.stableford_pts;
          totals[h.player_id].holes += 1;
        }
      });
      const rows = Object.entries(totals)
        .map(([pid, v]) => {
          const p = (playersData as any[]).find(x => x.id === pid);
          return { playerId: pid, name: p?.display_name ?? '—', total: v.total, holes: v.holes };
        })
        .sort((a, b) => b.total - a.total);
      setKronosRows(rows);
    }
  }

  async function load() {
    // Resolve current player once
    if (!myPlayerId) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: p } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
        if (p) setMyPlayerId(p.id);
      }
    }

    const [{ data: comp }, { data: notifs }, { data: soc }] = await Promise.all([
      supabase.from('competitions').select('*').eq('status', 'active').limit(1).single(),
      supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('societies').select('instagram_url').eq('id', SOCIETY_ID).single(),
    ]);

    if (notifs) setNotifications(notifs);
    if (soc)    setInstagramUrl((soc as any).instagram_url ?? null);

    if (!comp) {
      setCompetition(null);
      setJoinedId(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setCompetition(comp as unknown as Competition);
    setSections(((comp as any).info_sections ?? []) as InfoSection[]);
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    setJoinedId(stored);
    if (stored === comp.id) await loadTournamentData(comp.id);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    load();
    const sub = supabase.channel('tour-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, load)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, []);

  useEffect(() => {
    if (pin.length === 4) verifyPin(pin);
  }, [pin]);

  async function verifyPin(p: string) {
    setVerifying(true);
    const { data } = await supabase
      .from('competitions').select('*').eq('pin', p).eq('status', 'active').limit(1).single();
    setVerifying(false);
    if (!data) {
      Alert.alert('Wrong PIN', 'No active tournament matches that PIN. Ask your admin for the correct code.', [
        { text: 'Try again', onPress: () => setPin('') },
      ]);
      return;
    }
    setCompetition(data as unknown as Competition);
    await AsyncStorage.setItem(STORAGE_KEY, data.id);
    setJoinedId(data.id);
    await loadTournamentData(data.id);
  }

  function leaveTournament() {
    Alert.alert('Leave Tournament', 'You will need to re-enter the PIN to rejoin.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive', onPress: async () => {
          await AsyncStorage.removeItem(STORAGE_KEY);
          setJoinedId(null);
          setPin('');
        },
      },
    ]);
  }

  // ── Derived data ────────────────────────────────────────────────────

  const standings = getStandings((matches as any[]).filter((m: any) => m.home_team_id && m.away_team_id));
  const enriched  = standings.map(s => {
    const t = teams.find(t => t.id === s.teamId);
    return { ...s, name: t?.name ?? '—', accent_color: t?.accent_color ?? '#555' };
  });

  function matchNames(m: Match): { home: string; away: string } {
    if (m.home_team_id && m.away_team_id) {
      return {
        home: teams.find(t => t.id === m.home_team_id)?.name ?? '—',
        away: teams.find(t => t.id === m.away_team_id)?.name ?? '—',
      };
    }
    return {
      home: players.find(p => p.id === m.home_player_ids[0])?.display_name ?? '—',
      away: players.find(p => p.id === m.away_player_ids[0])?.display_name ?? '—',
    };
  }

  function matchColors(m: Match): { home: string; away: string } {
    return {
      home: teams.find(t => t.id === m.home_team_id)?.accent_color ?? '#555',
      away: teams.find(t => t.id === m.away_team_id)?.accent_color ?? '#555',
    };
  }

  const champYears = [...new Set(champions.map(c => c.year))].sort((a, b) => b - a);

  // My match in this tournament
  const myMatch = myPlayerId
    ? (matches as any[]).find(m =>
        (m.home_player_ids ?? []).includes(myPlayerId) ||
        (m.away_player_ids ?? []).includes(myPlayerId)
      ) ?? null
    : null;
  const myMatchActive = myMatch && (myMatch.status === 'upcoming' || myMatch.status === 'in_progress');

  // ── No active tournament ────────────────────────────────────────────
  if (!competition) return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar style="light" />
      {/* TITAN header */}
      <View style={st.titanHeader}>
        <Image source={titanLogo} style={st.titanLogoImg} resizeMode="contain" />
        <Text style={st.titanSubtitle}>THE TOUR</Text>
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ fontSize: 56, marginBottom: 20 }}>⛳</Text>
        <Text style={{ fontSize: 20, fontFamily: FFB, color: '#555', marginBottom: 8, textAlign: 'center' }}>
          No Tournament Running
        </Text>
        <Text style={{ fontSize: 14, fontFamily: FF, color: '#444', textAlign: 'center', lineHeight: 20 }}>
          Ask your admin to create and activate{'\n'}a competition to unlock this tab.
        </Text>
      </View>
    </View>
  );

  // ── PIN entry ───────────────────────────────────────────────────────
  if (joinedId !== competition.id) return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#000' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      {/* TITAN header */}
      <View style={st.titanHeader}>
        <Image source={titanLogo} style={st.titanLogoImg} resizeMode="contain" />
        <Text style={st.titanSubtitle}>THE TOUR</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 24, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ fontSize: 56, marginBottom: 24 }}>🏆</Text>
        <Text style={{ fontSize: 26, fontFamily: FFB, color: '#fff', marginBottom: 8, textAlign: 'center' }}>
          Enter Tournament PIN
        </Text>
        <Text style={{ fontSize: 14, fontFamily: FF, color: '#555', textAlign: 'center', lineHeight: 20, marginBottom: 32 }}>
          A tournament is live.{'\n'}Enter the 4-digit PIN your admin shared with you.
        </Text>

        <View style={{ position: 'relative', marginBottom: 24 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <View
                key={i}
                style={[
                  st.pinBox,
                  pin.length === i && st.pinBoxActive,
                  pin[i] ? { borderColor: GOLD } : {},
                ]}
              >
                <Text style={{ fontSize: 32, fontFamily: FFB, color: '#fff' }}>{pin[i] ?? ''}</Text>
              </View>
            ))}
          </View>
          <TextInput
            ref={pinRef}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0 }}
            value={pin}
            onChangeText={v => setPin(v.replace(/\D/g, '').slice(0, 4))}
            keyboardType="number-pad"
            maxLength={4}
            autoFocus
            caretHidden
          />
        </View>

        {verifying && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <ActivityIndicator color={GOLD} size="small" />
            <Text style={{ fontSize: 14, fontFamily: FF, color: '#555' }}>Checking PIN…</Text>
          </View>
        )}

        <TouchableOpacity
          style={{ marginTop: 16 }}
          onPress={() => setPin('')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={{ fontSize: 14, fontFamily: FF, color: '#555', textDecorationLine: 'underline' }}>
            {pin.length > 0 ? 'Clear' : ' '}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  // ── Tournament hub ──────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar style="light" />

      {/* TITAN header — logo centred, leave button right */}
      <View style={st.titanHeader}>
        <View style={{ position: 'absolute', right: 16, bottom: 10 }}>
          <TouchableOpacity onPress={leaveTournament} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ fontSize: 10, fontFamily: FFB, color: '#555', letterSpacing: 1.5 }}>LEAVE</Text>
          </TouchableOpacity>
        </View>
        <Image source={titanLogo} style={st.titanLogoImg} resizeMode="contain" />
        <Text style={st.titanSubtitle}>THE TOUR</Text>
      </View>

      {/* Tournament name + LIVE badge */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' }}>
        <Text style={{ fontSize: 22, fontFamily: FFB, color: '#fff', marginBottom: 6 }}>{competition.name}</Text>
        <View style={{
          alignSelf: 'flex-start',
          backgroundColor: 'rgba(74,222,128,0.1)',
          paddingHorizontal: 10, paddingVertical: 3,
          borderRadius: 6, borderWidth: 1, borderColor: 'rgba(74,222,128,0.35)',
        }}>
          <Text style={{ fontSize: 10, fontFamily: FFB, color: GREEN, letterSpacing: 1 }}>● LIVE</Text>
        </View>
      </View>

      {/* Section back button — shown when inside a section */}
      {selectedSection !== null && (
        <TouchableOpacity
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingHorizontal: 16, paddingVertical: 10,
            borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
            backgroundColor: '#000',
          }}
          onPress={() => setSelectedSection(null)}
          activeOpacity={0.7}
        >
          <Text style={{ fontSize: 14, fontFamily: FF, color: '#555' }}>‹ Back</Text>
          <Text style={{ fontSize: 16, fontFamily: FFB, color: '#fff' }}>
            {selectedSection === 'matches' ? 'Matches' : selectedSection === 'standings' ? 'Standings' : selectedSection === 'info' ? 'Info Pack' : 'Live & Social'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Play Your Match banner */}
      {myMatchActive && (
        <TouchableOpacity
          style={{
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: GOLD, paddingHorizontal: 16, paddingVertical: 10,
            borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.15)',
            gap: 12,
          }}
          onPress={() => router.push(
            myMatch.status === 'in_progress'
              ? `/(app)/score/enter/${myMatch.id}` as any
              : `/(app)/score/preview/${myMatch.id}` as any
          )}
          activeOpacity={0.88}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 9, fontFamily: FFB, color: 'rgba(0,0,0,0.5)', letterSpacing: 1.5, marginBottom: 2 }}>
              YOUR MATCH
            </Text>
            <Text style={{ fontSize: 15, fontFamily: FFB, color: '#000' }}>
              {(() => {
                const names = matchNames(myMatch as Match);
                return `${names.home} vs ${names.away}`;
              })()}
            </Text>
          </View>
          <View style={{ backgroundColor: '#000', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 }}>
            <Text style={{ fontSize: 13, fontFamily: FFB, color: GOLD }}>
              {myMatch.status === 'in_progress' ? '▶ Resume' : '⛳ Play'}
            </Text>
          </View>
        </TouchableOpacity>
      )}

      {/* 2×2 section grid — shown when no section selected */}
      {selectedSection === null && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={GOLD}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <TouchableOpacity style={st.sectionTile} onPress={() => setSelectedSection('matches')} activeOpacity={0.82}>
              <Text style={st.sectionTileIcon}>🏌️</Text>
              <Text style={st.sectionTileLabel}>Matches</Text>
              <Text style={st.sectionTileSub}>Results & fixtures</Text>
              <Text style={[st.sectionTileArrow, { color: palette.accent }]}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.sectionTile} onPress={() => setSelectedSection('standings')} activeOpacity={0.82}>
              <Text style={st.sectionTileIcon}>📊</Text>
              <Text style={st.sectionTileLabel}>Standings</Text>
              <Text style={st.sectionTileSub}>Teams, points & honours</Text>
              <Text style={[st.sectionTileArrow, { color: palette.accent }]}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.sectionTile} onPress={() => setSelectedSection('info')} activeOpacity={0.82}>
              <Text style={st.sectionTileIcon}>📋</Text>
              <Text style={st.sectionTileLabel}>Info Pack</Text>
              <Text style={st.sectionTileSub}>Schedule & travel</Text>
              <Text style={[st.sectionTileArrow, { color: palette.accent }]}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.sectionTile} onPress={() => setSelectedSection('social')} activeOpacity={0.82}>
              <Text style={st.sectionTileIcon}>📸</Text>
              <Text style={st.sectionTileLabel}>Live & Social</Text>
              <Text style={st.sectionTileSub}>Feed & Instagram</Text>
              <Text style={[st.sectionTileArrow, { color: palette.accent }]}>›</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* Content — shown when a section is selected */}
      <ScrollView
        style={{ flex: 1, display: selectedSection !== null && selectedSection !== 'social' ? 'flex' : 'none' }}
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={GOLD}
          />
        }
        showsVerticalScrollIndicator={false}
        key={selectedSection ?? 'grid'}
      >

        {/* ── Standings (teams + kronos + honours combined) ── */}
        {selectedSection === 'standings' && (
          <View>
            <Text style={st.sectionHeader}>TEAM STANDINGS</Text>
            <View>
              <View style={st.tableHeader}>
                <Text style={[st.cell, st.cellTeam, st.th]}>TEAM</Text>
                <Text style={[st.cell, st.th]}>P</Text>
                <Text style={[st.cell, st.th]}>W</Text>
                <Text style={[st.cell, st.th]}>H</Text>
                <Text style={[st.cell, st.th]}>L</Text>
                <Text style={[st.cell, st.cellPts, st.th]}>PTS</Text>
              </View>
              {enriched.map((s, i) => (
                <View key={s.teamId} style={[st.row, i === 0 && st.rowFirst]}>
                  <View style={[st.cell, st.cellTeam, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                    <Text style={st.pos}>{i + 1}</Text>
                    {teamLogos[s.name]
                      ? <Image source={teamLogos[s.name]} style={{ width: 28, height: 28 }} resizeMode="contain" />
                      : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.accent_color }} />
                    }
                    <Text style={st.teamName}>{s.name}</Text>
                  </View>
                  <Text style={st.cell}>{s.played}</Text>
                  <Text style={st.cell}>{s.w}</Text>
                  <Text style={st.cell}>{s.h}</Text>
                  <Text style={st.cell}>{s.l}</Text>
                  <Text style={[st.cell, st.cellPts, st.pts]}>{s.pts}</Text>
                </View>
              ))}
              {enriched.length === 0 && (
                <Text style={st.noResults}>No matches played yet.{'\n'}Results will appear here as games complete.</Text>
              )}
            </View>

            <Text style={st.sectionHeader}>ORDER OF MERIT</Text>
            <View>
              <View style={st.tableHeader}>
                <Text style={[st.cell, st.cellTeam, st.th]}>PLAYER</Text>
                <Text style={[st.cell, st.th]}>HLS</Text>
                <Text style={[st.cell, st.cellPts, st.th]}>PTS</Text>
              </View>
              {kronosRows.map((r, i) => (
                <View key={r.playerId} style={[st.row, i === 0 && st.rowFirst]}>
                  <View style={[st.cell, st.cellTeam, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                    <Text style={st.pos}>{i + 1}</Text>
                    <Text style={st.teamName}>{r.name}</Text>
                  </View>
                  <Text style={st.cell}>{r.holes}</Text>
                  <Text style={[st.cell, st.cellPts, st.pts]}>{r.total}</Text>
                </View>
              ))}
              {kronosRows.length === 0 && (
                <Text style={st.noResults}>No Stableford scores yet.</Text>
              )}
            </View>

            <Text style={st.sectionHeader}>ROLL OF HONOUR</Text>
            <View>
              {champYears.map(year => {
                const yearChamps = champions.filter(c => c.year === year);
                return (
                  <View key={year} style={{ marginBottom: 20 }}>
                    <Text style={{
                      fontSize: 10, fontFamily: FFB, color: '#555',
                      letterSpacing: 2, marginBottom: 10,
                    }}>
                      {year}
                    </Text>
                    {yearChamps.map(c => (
                      <View key={c.id} style={st.champCard}>
                        <Text style={{ fontSize: 10, fontFamily: FFB, color: GOLD, letterSpacing: 1, marginBottom: 4 }}>
                          {c.award_name.toUpperCase()}
                        </Text>
                        <Text style={{ fontSize: 18, fontFamily: FFB, color: '#fff' }}>{c.winner_name}</Text>
                        {c.detail && (
                          <Text style={{ fontSize: 13, fontFamily: FF, color: '#888', marginTop: 4 }}>{c.detail}</Text>
                        )}
                      </View>
                    ))}
                  </View>
                );
              })}
              {champYears.length === 0 && (
                <Text style={st.noResults}>No champions recorded yet.</Text>
              )}
            </View>
          </View>
        )}

        {/* ── Matches ── */}
        {selectedSection === 'matches' && (
          <View>
            {days.length === 0 && (
              <Text style={st.noResults}>No days scheduled yet.</Text>
            )}
            {days.map(day => {
              const dayMatches = matches.filter(m => m.day_id === day.id);
              const live     = dayMatches.filter(m => m.status === 'in_progress').length;
              const complete = dayMatches.filter(m => m.status === 'complete').length;
              const isLive   = live > 0;
              const isDone   = complete === dayMatches.length && dayMatches.length > 0;

              return (
                <View key={day.id} style={{ marginBottom: 20 }}>
                  {/* Day header */}
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 10, fontFamily: FFB, color: GOLD, letterSpacing: 1.5, marginBottom: 2 }}>
                        DAY {day.day_number}
                      </Text>
                      <Text style={{ fontSize: 15, fontFamily: FFB, color: '#fff' }}>{day.course_name ?? 'TBC'}</Text>
                      {day.play_date && (
                        <Text style={{ fontSize: 11, fontFamily: FF, color: '#555', marginTop: 1 }}>
                          {formatDate(day.play_date)}
                        </Text>
                      )}
                    </View>
                    <View style={[
                      st.dayStatusBadge,
                      isLive && { backgroundColor: 'rgba(74,222,128,0.1)', borderColor: 'rgba(74,222,128,0.35)' },
                    ]}>
                      <Text style={[
                        { fontSize: 10, fontFamily: FFB, color: '#555', letterSpacing: 0.5 },
                        isLive && { color: GREEN },
                      ]}>
                        {isDone ? 'COMPLETE' : isLive ? 'LIVE' : 'UPCOMING'}
                      </Text>
                    </View>
                  </View>

                  {dayMatches.map(m => {
                    const { home, away } = matchNames(m);
                    const mc = matchColors(m);
                    const isTeamMatch = !!(m.home_team_id && m.away_team_id);
                    const isMatchLive = m.status === 'in_progress';
                    const isComplete  = m.status === 'complete';
                    return (
                      <TouchableOpacity
                        key={m.id}
                        style={[
                          st.matchRow,
                          isMatchLive && { borderColor: 'rgba(74,222,128,0.35)' },
                        ]}
                        onPress={() => router.push(`/(app)/score/${m.id}` as any)}
                        activeOpacity={0.75}
                      >
                        {/* Home side */}
                        <View style={{ flex: 1, alignItems: 'flex-start' }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                            {isTeamMatch && (
                              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: mc.home }} />
                            )}
                            <Text style={st.matchName} numberOfLines={1}>{home}</Text>
                          </View>
                        </View>

                        {/* Middle: vs / result / live */}
                        <View style={{ alignItems: 'center', paddingHorizontal: 10, minWidth: 52 }}>
                          {isMatchLive && (
                            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: GREEN, marginBottom: 2 }} />
                          )}
                          {isComplete && m.result_str ? (
                            <Text style={{ fontSize: 11, fontFamily: FFB, color: GOLD, textAlign: 'center' }}>
                              {m.result_str}
                            </Text>
                          ) : (
                            <Text style={{ fontSize: 10, fontFamily: FFB, color: '#555' }}>vs</Text>
                          )}
                        </View>

                        {/* Away side */}
                        <View style={{ flex: 1, alignItems: 'flex-end' }}>
                          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 5 }}>
                            {isTeamMatch && (
                              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: mc.away }} />
                            )}
                            <Text style={st.matchName} numberOfLines={1}>{away}</Text>
                          </View>
                        </View>

                        <Text style={{ fontSize: 18, color: '#555', marginLeft: 6 }}>›</Text>
                      </TouchableOpacity>
                    );
                  })}

                  {dayMatches.length === 0 && (
                    <Text style={[st.noResults, { paddingVertical: 8 }]}>No matches yet.</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* ── Info Pack ── */}
        {selectedSection === 'info' && (
          <View>
            {competition && (
              <View style={infoStyles.heroBanner}>
                <Text style={infoStyles.heroLabel}>COMPETITION INFO PACK</Text>
                <Text style={infoStyles.heroName}>{competition.name}</Text>
              </View>
            )}
            {sections.length === 0 && (
              <View style={infoStyles.empty}>
                <Text style={infoStyles.emptyTitle}>No info pack yet</Text>
                <Text style={infoStyles.emptySub}>
                  Society leaders can add the tour schedule, flights, accommodation and more.
                </Text>
                <TouchableOpacity style={infoStyles.emptyBtn} onPress={() => router.push('/(app)/admin/info' as any)} activeOpacity={0.8}>
                  <Text style={infoStyles.emptyBtnText}>Add Info Pack →</Text>
                </TouchableOpacity>
              </View>
            )}
            {sections.map(section => <SectionView key={section.id} section={section} />)}
          </View>
        )}

      </ScrollView>

      {/* ── Live & Social (outside scroll — Live feed + Instagram) ── */}
      {selectedSection === 'social' && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={GOLD}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <Text style={st.sectionHeader}>LIVE FEED</Text>
          {notifications.length === 0 && (
            <View style={infoStyles.empty}>
              <Text style={infoStyles.emptyTitle}>Nothing yet</Text>
              <Text style={infoStyles.emptySub}>
                Birdies, match results and announcements will appear here.
              </Text>
            </View>
          )}
          {notifications.map(n => <TourFeedCard key={n.id} n={n} />)}

          {instagramUrl && (
            <>
              <Text style={[st.sectionHeader, { marginTop: 20 }]}>INSTAGRAM</Text>
              <TourInstagramView
                url={instagramUrl}
                onGoAdmin={() => router.push('/(app)/admin' as any)}
              />
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ── Shared static styles ──────────────────────────────────────────────
const st = StyleSheet.create({
  // TITAN header
  titanHeader: {
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingBottom: 10,
    backgroundColor: '#000',
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1c',
  },
  titanLogoImg: { width: 120, height: 36 },
  titanSubtitle: { fontSize: 9, fontFamily: 'JUSTSans', color: '#555', letterSpacing: 2, marginTop: 2 },

  // PIN
  pinBox: {
    width: 56, height: 68, borderRadius: 10,
    backgroundColor: '#111', borderWidth: 2, borderColor: '#1c1c1c',
    alignItems: 'center', justifyContent: 'center',
  },
  pinBoxActive: { borderColor: '#D4AF37' },

  // Section grid tiles
  sectionTile: {
    width: '48%', backgroundColor: '#111',
    borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c',
    padding: 16, paddingVertical: 22,
  },
  sectionTileIcon:  { fontSize: 32, marginBottom: 8 },
  sectionTileLabel: { fontSize: 18, fontFamily: 'JUSTSans-ExBold', color: '#fff', marginBottom: 4 },
  sectionTileSub:   { fontSize: 12, fontFamily: 'JUSTSans', color: '#555', lineHeight: 17, marginBottom: 8 },
  sectionTileArrow: { fontSize: 22, fontFamily: 'JUSTSans', fontWeight: '300' },

  // Section headings
  sectionHeader: {
    fontSize: 10, fontFamily: 'JUSTSans-ExBold', letterSpacing: 1.5,
    color: '#555', paddingVertical: 10, marginTop: 8,
  },

  // Table
  tableHeader: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8, marginBottom: 6 },
  th:       { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: '#555', letterSpacing: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#111',
    borderRadius: 10, paddingVertical: 12, paddingHorizontal: 8,
    marginBottom: 6, borderWidth: 1, borderColor: '#1c1c1c',
  },
  rowFirst:  { borderColor: 'rgba(212,175,55,0.35)', backgroundColor: '#111' },
  cell:      { flex: 1, textAlign: 'center', fontSize: 13, fontFamily: 'JUSTSans', color: '#888' },
  cellTeam:  { flex: 4, textAlign: 'left' },
  cellPts:   { flex: 1.5 },
  pos:       { fontSize: 13, fontFamily: 'JUSTSans', color: '#555', width: 18, textAlign: 'center' },
  teamName:  { fontSize: 13, fontFamily: 'JUSTSans-ExBold', color: '#fff' },
  pts:       { fontSize: 15, fontFamily: 'JUSTSans-ExBold', color: '#D4AF37' },

  // Honours
  champCard: {
    backgroundColor: '#111', borderRadius: 10, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },

  // Day status badge
  dayStatusBadge: {
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6,
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c',
    marginBottom: 2,
  },

  // Match row
  matchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#111', borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 14,
    marginBottom: 6, borderWidth: 1, borderColor: '#1c1c1c',
  },
  matchName: { fontSize: 13, fontFamily: 'JUSTSans-ExBold', color: '#fff' },

  // No results
  noResults: { fontSize: 13, fontFamily: 'JUSTSans', color: '#555', textAlign: 'center', padding: 20, lineHeight: 22 },
});

// ── Info section renderer ─────────────────────────────────────────────
function SectionView({ section }: { section: InfoSection }) {
  switch (section.type) {
    case 'text':     return <TextCard s={section} />;
    case 'schedule': return <ScheduleCard s={section} />;
    case 'travel':   return <TravelCard s={section} />;
    case 'location': return <LocationCard s={section} />;
    case 'contacts': return <ContactsCard s={section} />;
    case 'rules':    return <RulesCard s={section} />;
    default:         return null;
  }
}

function CardShell({ title, accent, children }: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <View style={[cardSt.shell, accent ? { borderLeftColor: accent, borderLeftWidth: 3 } : {}]}>
      <Text style={cardSt.title}>{title}</Text>
      {children}
    </View>
  );
}
function TextCard({ s }: { s: TextSection }) {
  return <CardShell title={s.title}><Text style={cardSt.body}>{s.content}</Text></CardShell>;
}
function ScheduleCard({ s }: { s: ScheduleSection }) {
  return (
    <CardShell title={s.title} accent='#D4AF37'>
      {s.items.map((item, i) => (
        <View key={i} style={schedSt.row}>
          <View style={schedSt.timeCol}>
            <Text style={schedSt.time}>{item.time}</Text>
            {i < s.items.length - 1 && <View style={schedSt.line} />}
          </View>
          <View style={schedSt.content}>
            <Text style={schedSt.label}>{item.label}</Text>
            {item.note ? <Text style={schedSt.note}>{item.note}</Text> : null}
          </View>
        </View>
      ))}
    </CardShell>
  );
}
function TravelCard({ s }: { s: TravelSection }) {
  return (
    <CardShell title={s.title}>
      {s.items.map((item, i) => (
        <View key={i} style={travelSt.row}>
          <View style={travelSt.dot} />
          <View style={{ flex: 1 }}>
            <Text style={travelSt.label}>{item.label}</Text>
            <Text style={travelSt.detail}>{item.detail}</Text>
          </View>
        </View>
      ))}
    </CardShell>
  );
}
function LocationCard({ s }: { s: LocationSection }) {
  return (
    <CardShell title={s.title}>
      <Text style={locSt.name}>{s.name}</Text>
      {s.address ? <Text style={locSt.detail}>{s.address}</Text> : null}
      {s.phone ? <Text style={locSt.detail}><Text style={{ color: '#6b7280' }}>T  </Text>{s.phone}</Text> : null}
      {s.notes ? <Text style={[locSt.detail, { marginTop: 4, fontStyle: 'italic' }]}>{s.notes}</Text> : null}
    </CardShell>
  );
}
function ContactsCard({ s }: { s: ContactsSection }) {
  return (
    <CardShell title={s.title}>
      {s.items.map((item, i) => (
        <View key={i} style={[contactSt.row, i < s.items.length - 1 && contactSt.rowBorder]}>
          <View style={contactSt.avatar}><Text style={contactSt.initial}>{item.name[0] ?? '?'}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={contactSt.name}>{item.name}</Text>
            {item.role ? <Text style={contactSt.role}>{item.role}</Text> : null}
          </View>
          {item.phone ? <Text style={contactSt.phone}>{item.phone}</Text> : null}
        </View>
      ))}
    </CardShell>
  );
}
function RulesCard({ s }: { s: RulesSection }) {
  return (
    <CardShell title={s.title}>
      {s.items.map((rule, i) => (
        <View key={i} style={rulesSt.row}>
          <View style={rulesSt.numBadge}><Text style={rulesSt.num}>{i + 1}</Text></View>
          <Text style={rulesSt.text}>{rule}</Text>
        </View>
      ))}
    </CardShell>
  );
}

// ── Live feed card ────────────────────────────────────────────────────
function TourFeedCard({ n }: { n: Notification }) {
  const label = NOTIF_LABELS[n.type] ?? n.type;
  const payload = (n.payload as any) ?? {};
  const time = new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <View style={feedSt.container}>
      <View style={feedSt.dot} />
      <View style={{ flex: 1 }}>
        <View style={feedSt.top}>
          <Text style={feedSt.label}>{label}</Text>
          <Text style={feedSt.time}>{time}</Text>
        </View>
        {payload.message
          ? <Text style={feedSt.body}>{payload.message}</Text>
          : payload.player_name
          ? <Text style={feedSt.body}>{payload.player_name}{payload.hole ? ` · Hole ${payload.hole}` : ''}</Text>
          : null}
      </View>
    </View>
  );
}

// ── Instagram view ────────────────────────────────────────────────────
function extractHandle(url: string): string {
  const match = url.match(/instagram\.com\/([^/?#]+)/);
  return match ? match[1] : url.replace(/^@/, '');
}

function TourInstagramView({ url, onGoAdmin }: { url: string | null; onGoAdmin: () => void }) {
  if (!url) {
    return (
      <View style={igSt.centered}>
        <Text style={igSt.emptyTitle}>No Instagram connected</Text>
        <Text style={igSt.emptySub}>Society admins can link the Instagram page in Society Admin settings.</Text>
        <TouchableOpacity style={igSt.emptyBtn} onPress={onGoAdmin} activeOpacity={0.8}>
          <Text style={igSt.emptyBtnText}>Go to Society Admin →</Text>
        </TouchableOpacity>
      </View>
    );
  }
  const handle = extractHandle(url);
  async function openInApp() {
    const appUrl = `instagram://user?username=${handle}`;
    const canOpen = await Linking.canOpenURL(appUrl);
    Linking.openURL(canOpen ? appUrl : `https://www.instagram.com/${handle}/`);
  }
  return (
    <View style={[igSt.centered, { gap: 24 }]}>
      <View style={igSt.iconWrap}><Text style={igSt.iconText}>📷</Text></View>
      <View style={{ alignItems: 'center' }}>
        <Text style={igSt.handle}>@{handle}</Text>
        <Text style={igSt.sub}>Tap below to view on Instagram</Text>
      </View>
      <TouchableOpacity style={igSt.openBtn} onPress={openInApp} activeOpacity={0.85}>
        <Text style={igSt.openBtnText}>Open Instagram Profile</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => Linking.openURL(`https://www.instagram.com/${handle}/`)} activeOpacity={0.7}>
        <Text style={igSt.webLink}>Open in browser instead</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Info Pack / Live / Instagram styles ───────────────────────────────
const infoStyles = StyleSheet.create({
  heroBanner: { backgroundColor: '#111', borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)' },
  heroLabel:  { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: '#D4AF37', letterSpacing: 2, marginBottom: 4 },
  heroName:   { fontSize: 18, fontFamily: 'JUSTSans-ExBold', color: '#ffffff' },
  empty:      { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 18, fontFamily: 'JUSTSans-ExBold', color: '#555', marginBottom: 8 },
  emptySub:   { fontSize: 14, fontFamily: 'JUSTSans', color: '#444', textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  emptyBtn:   { backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)' },
  emptyBtnText: { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#D4AF37' },
});
const cardSt = StyleSheet.create({
  shell:  { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 16, marginBottom: 12 },
  title:  { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: '#555', letterSpacing: 2, marginBottom: 12, textTransform: 'uppercase' },
  body:   { fontSize: 14, fontFamily: 'JUSTSans', color: '#9ca3af', lineHeight: 22 },
});
const schedSt = StyleSheet.create({
  row:     { flexDirection: 'row', marginBottom: 0 },
  timeCol: { width: 52, alignItems: 'flex-end', marginRight: 12 },
  time:    { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#D4AF37', lineHeight: 22 },
  line:    { width: 1, flex: 1, backgroundColor: 'rgba(212,175,55,0.2)', alignSelf: 'center', marginTop: 2, marginBottom: 2, minHeight: 20 },
  content: { flex: 1, paddingBottom: 12 },
  label:   { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#ffffff', lineHeight: 22 },
  note:    { fontSize: 12, fontFamily: 'JUSTSans', color: '#555', marginTop: 1 },
});
const travelSt = StyleSheet.create({
  row:    { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  dot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D4AF37', marginTop: 6 },
  label:  { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#ffffff', marginBottom: 2 },
  detail: { fontSize: 14, fontFamily: 'JUSTSans', color: '#9ca3af' },
});
const locSt = StyleSheet.create({
  name:   { fontSize: 16, fontFamily: 'JUSTSans-ExBold', color: '#ffffff', marginBottom: 6 },
  detail: { fontSize: 14, fontFamily: 'JUSTSans', color: '#9ca3af', lineHeight: 20 },
});
const contactSt = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  avatar:    { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1c1c1c', alignItems: 'center', justifyContent: 'center' },
  initial:   { fontSize: 16, fontFamily: 'JUSTSans-ExBold', color: '#D4AF37' },
  name:      { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#ffffff' },
  role:      { fontSize: 12, fontFamily: 'JUSTSans', color: '#555' },
  phone:     { fontSize: 12, fontFamily: 'JUSTSans-ExBold', color: '#9ca3af' },
});
const rulesSt = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  numBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(212,175,55,0.1)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.2)', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  num:      { fontSize: 10, fontFamily: 'JUSTSans-ExBold', color: '#D4AF37' },
  text:     { flex: 1, fontSize: 14, fontFamily: 'JUSTSans', color: '#9ca3af', lineHeight: 22 },
});
const feedSt = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#111', borderRadius: 14, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: '#1c1c1c' },
  dot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D4AF37', marginTop: 5 },
  top:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label:     { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#ffffff' },
  time:      { fontSize: 12, fontFamily: 'JUSTSans', color: '#555' },
  body:      { fontSize: 14, fontFamily: 'JUSTSans', color: '#9ca3af' },
});
const igSt = StyleSheet.create({
  centered:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { fontSize: 18, fontFamily: 'JUSTSans-ExBold', color: '#555', marginBottom: 8, textAlign: 'center' },
  emptySub:   { fontSize: 14, fontFamily: 'JUSTSans', color: '#444', textAlign: 'center', lineHeight: 20, marginBottom: 20, paddingHorizontal: 16 },
  emptyBtn:   { backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)' },
  emptyBtnText: { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#D4AF37' },
  iconWrap:   { width: 96, height: 96, borderRadius: 28, backgroundColor: '#833AB4', alignItems: 'center', justifyContent: 'center' },
  iconText:   { fontSize: 44 },
  handle:     { fontSize: 20, fontFamily: 'JUSTSans-ExBold', color: '#ffffff', marginBottom: 4 },
  sub:        { fontSize: 14, fontFamily: 'JUSTSans', color: '#555' },
  openBtn:    { backgroundColor: '#833AB4', borderRadius: 10, paddingVertical: 14, paddingHorizontal: 32 },
  openBtnText:{ fontSize: 16, fontFamily: 'JUSTSans-ExBold', color: '#ffffff', letterSpacing: 0.5 },
  webLink:    { fontSize: 14, fontFamily: 'JUSTSans', color: '#555', textDecorationLine: 'underline' },
});
