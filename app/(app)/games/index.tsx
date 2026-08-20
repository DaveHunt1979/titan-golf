import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { goBack } from '../../../src/lib/navigation';

const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';

const FORMAT_LABELS: Record<string, string> = {
  stableford: 'Stableford', medal: 'Medal', singles: 'Singles Matchplay',
  '4bbb': '4BBB Stableford', skins: 'Skins', nassau: 'Nassau',
  scramble: 'Scramble', greensome: 'Greensomes', foursomes: 'Foursomes',
  par_bogey: 'Par / Bogey', team_stableford: 'Team Stableford',
  best2from4: 'Best 2 From 4', best2from4_par3all: 'Best 2 From 4 (Par 3s)',
};

interface LiveMatch {
  id: string;
  format: string;
  status: string;
  home_player_ids: string[];
  away_player_ids: string[];
  home_name: string | null;
  away_name: string | null;
  day: { course_name: string } | null;
  day_id: string | null;
}

export default function GamesLobbyScreen() {
  const router = useRouter();
  const dc = useDynamicColors();

  const [fontsLoaded] = useFonts({
    [FF]:  require('../../../assets/fonts/JUSTSans-Regular.otf'),
    [FFB]: require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [liveMatches, setLiveMatches] = useState<LiveMatch[]>([]);
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [dayCode, setDayCode] = useState('');
  const [joining, setJoining] = useState(false);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    let pid = myPlayerId;
    if (!pid && user) {
      const { data: p } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (p) { pid = (p as any).id; setMyPlayerId((p as any).id); }
    }

    const { data } = await supabase
      .from('matches')
      .select('id,format,status,home_player_ids,away_player_ids,home_name,away_name,day_id,day:day_id(course_name)')
      .in('status', ['in_progress', 'upcoming'])
      .order('created_at', { ascending: false });

    const mine = ((data ?? []) as unknown as LiveMatch[]).filter(m =>
      !pid || m.home_player_ids.includes(pid) || m.away_player_ids.includes(pid)
    );
    setLiveMatches(mine);

    const allIds = [...new Set(mine.flatMap(m => [...m.home_player_ids, ...m.away_player_ids]))];
    if (allIds.length > 0) {
      const { data: players } = await supabase.from('players').select('id,display_name').in('id', allIds);
      if (players) {
        const names: Record<string, string> = {};
        (players as any[]).forEach(p => { names[p.id] = p.display_name; });
        setPlayerNames(names);
      }
    }
    setLoading(false);
  }

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, []));

  async function joinWithCode() {
    const code = dayCode.trim().toUpperCase();
    if (code.length !== 6) { Alert.alert('Enter the 6-character game code'); return; }
    setJoining(true);

    // Try day join_code first — this code is always view-only (spectator).
    // To actually join as a scorer, use a per-match group code instead.
    const { data: day } = await supabase
      .from('competition_days').select('id').eq('join_code', code).maybeSingle();
    if (day) {
      setJoining(false);
      router.push(`/(app)/score/day/${(day as any).id}?spectate=1` as any);
      return;
    }

    // Try group_code on matches
    const { data: match } = await supabase
      .from('matches').select('id,day_id').eq('group_code', code).maybeSingle();
    setJoining(false);
    if (match) {
      const dayId = (match as any).day_id;
      if (dayId) router.push(`/(app)/score/day/${dayId}` as any);
      else router.push(`/(app)/score/enter/${(match as any).id}` as any);
      return;
    }

    Alert.alert('Code not found', 'No game matches that code. Ask your group for the correct code.');
  }

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#000' }}><StatusBar style="light" /></View>;

  const GOLD   = dc.gold;
  const BG     = dc.bg;
  const CARD   = dc.card;
  const BORDER = dc.border;

  const live     = liveMatches.filter(m => m.status === 'in_progress');
  const upcoming = liveMatches.filter(m => m.status === 'upcoming');

  function matchSubtitle(m: LiveMatch) {
    const all = [...m.home_player_ids, ...m.away_player_ids];
    return all.map(id => playerNames[id]?.split(' ')[0] ?? '…').join(', ');
  }

  function enterMatch(m: LiveMatch) {
    const dayId = m.day_id ?? (m.day as any)?.id;
    if (dayId) router.push(`/(app)/score/day/${dayId}` as any);
    else router.push(`/(app)/score/enter/${m.id}` as any);
  }

  return (
    <View style={[s.root, { backgroundColor: BG }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { borderBottomColor: BORDER }]}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color={GOLD} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: '#fff' }]}>PLAY</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Live / upcoming matches */}
        {loading ? (
          <ActivityIndicator color={GOLD} style={{ marginVertical: 32 }} />
        ) : live.length > 0 || upcoming.length > 0 ? (
          <>
            {live.length > 0 && (
              <View style={s.section}>
                <Text style={[s.sectionLabel, { color: GOLD }]}>IN PROGRESS</Text>
                {live.map(m => (
                  <TouchableOpacity
                    key={m.id}
                    style={[s.matchCard, { backgroundColor: CARD, borderColor: GOLD }]}
                    onPress={() => enterMatch(m)}
                    activeOpacity={0.8}
                  >
                    <View style={s.matchCardInner}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.matchFormat, { color: '#fff' }]}>{FORMAT_LABELS[m.format] ?? m.format}</Text>
                        <Text style={[s.matchPlayers, { color: '#9ca3af' }]}>{matchSubtitle(m)}</Text>
                        {m.day?.course_name ? (
                          <Text style={[s.matchCourse, { color: '#6b7280' }]}>{m.day.course_name}</Text>
                        ) : null}
                      </View>
                      <View style={[s.continueBadge, { backgroundColor: GOLD }]}>
                        <Text style={s.continueBadgeText}>CONTINUE</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {upcoming.length > 0 && (
              <View style={s.section}>
                <Text style={[s.sectionLabel, { color: '#9ca3af' }]}>UPCOMING</Text>
                {upcoming.map(m => (
                  <TouchableOpacity
                    key={m.id}
                    style={[s.matchCard, { backgroundColor: CARD, borderColor: BORDER }]}
                    onPress={() => enterMatch(m)}
                    activeOpacity={0.8}
                  >
                    <View style={s.matchCardInner}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.matchFormat, { color: '#fff' }]}>{FORMAT_LABELS[m.format] ?? m.format}</Text>
                        <Text style={[s.matchPlayers, { color: '#9ca3af' }]}>{matchSubtitle(m)}</Text>
                        {m.day?.course_name ? (
                          <Text style={[s.matchCourse, { color: '#6b7280' }]}>{m.day.course_name}</Text>
                        ) : null}
                      </View>
                      <Ionicons name="chevron-forward" size={18} color="#6b7280" />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        ) : null}

        {/* Join with code */}
        <View style={s.section}>
          <Text style={[s.sectionLabel, { color: '#9ca3af' }]}>JOIN A GAME</Text>
          <Text style={[s.joinSub, { color: '#6b7280' }]}>
            Enter the 6-character code shared by your group organiser.
          </Text>
          <View style={[s.codeRow, { backgroundColor: CARD, borderColor: BORDER }]}>
            <TextInput
              style={[s.codeInput, { color: '#fff', fontFamily: FFB }]}
              value={dayCode}
              onChangeText={v => setDayCode(v.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase())}
              placeholder="A1B2C3"
              placeholderTextColor="#555"
              keyboardType="default"
              autoCapitalize="characters"
              maxLength={6}
            />
            <TouchableOpacity
              style={[s.joinBtn, { backgroundColor: dayCode.length === 6 ? GOLD : '#222', borderColor: dayCode.length === 6 ? GOLD : BORDER }]}
              onPress={joinWithCode}
              disabled={joining || dayCode.length !== 6}
              activeOpacity={0.8}
            >
              {joining
                ? <ActivityIndicator size="small" color="#000" />
                : <Text style={[s.joinBtnText, { color: dayCode.length === 6 ? '#000' : '#555' }]}>JOIN</Text>
              }
            </TouchableOpacity>
          </View>
        </View>

        {/* Start new game */}
        <View style={s.section}>
          <Text style={[s.sectionLabel, { color: '#9ca3af' }]}>NEW GAME</Text>
          <TouchableOpacity
            style={[s.newGameBtn, { borderColor: GOLD }]}
            onPress={() => router.push('/(app)/games/new' as any)}
            activeOpacity={0.85}
          >
            <Ionicons name="golf-outline" size={22} color={GOLD} />
            <Text style={[s.newGameText, { color: GOLD }]}>START NEW GAME</Text>
            <Ionicons name="chevron-forward" size={18} color={GOLD} />
          </TouchableOpacity>
        </View>

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 60 : 36,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTitle: { fontFamily: 'JUSTSans-ExBold', fontSize: 13, letterSpacing: 2 },
  scroll: { padding: 16, paddingBottom: 60 },

  section: { marginBottom: 28 },
  sectionLabel: { fontFamily: 'JUSTSans-ExBold', fontSize: 10, letterSpacing: 2, marginBottom: 10 },

  matchCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  matchCardInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  matchFormat:  { fontFamily: 'JUSTSans-ExBold', fontSize: 15, marginBottom: 3 },
  matchPlayers: { fontFamily: 'JUSTSans', fontSize: 13, marginBottom: 2 },
  matchCourse:  { fontFamily: 'JUSTSans', fontSize: 12 },
  continueBadge: {
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
  },
  continueBadgeText: { fontFamily: 'JUSTSans-ExBold', fontSize: 10, color: '#000', letterSpacing: 1 },

  joinSub: { fontFamily: 'JUSTSans', fontSize: 13, marginBottom: 12, lineHeight: 18 },
  codeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 14, borderWidth: 1, padding: 10,
  },
  codeInput: { flex: 1, fontSize: 22, letterSpacing: 4, paddingVertical: 4 },
  joinBtn: {
    borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 18, paddingVertical: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  joinBtnText: { fontFamily: 'JUSTSans-ExBold', fontSize: 13, letterSpacing: 1 },

  newGameBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 16, borderWidth: 1.5,
    padding: 18,
  },
  newGameText: { flex: 1, fontFamily: 'JUSTSans-ExBold', fontSize: 16, letterSpacing: 1 },
});
