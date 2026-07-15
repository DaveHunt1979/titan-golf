import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, Image,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';

const GOLD = '#D4AF37';
const FF   = 'JUSTSans';
const FFB  = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

const CLUBS = ['Driver','3W','5W','3i','4i','5i','6i','7i','8i','9i','PW','GW','SW','LW'];

interface Session {
  id: string;
  created_at: string;
  notes: string | null;
  shot_count?: number;
}

interface ClubAvg {
  club: string;
  avg: number;
  max: number;
  count: number;
}

export default function RangeHomeScreen() {
  const router = useRouter();
  const [fontsLoaded] = useFonts({
    [FF]:  require('../../../assets/fonts/JUSTSans-Regular.otf'),
    [FFB]: require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [clubAvgs, setClubAvgs] = useState<ClubAvg[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: player } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (player) setPlayerId((player as any).id);
    })();
  }, []);

  useFocusEffect(useCallback(() => {
    if (playerId) loadData(playerId);
  }, [playerId]));

  async function loadData(pid: string) {
    setLoading(true);
    const [{ data: sessionData }, { data: shotData }] = await Promise.all([
      supabase.from('range_sessions').select('id,created_at,notes').eq('player_id', pid).order('created_at', { ascending: false }).limit(10),
      supabase.from('range_shots').select('club,carry').eq('player_id', pid).not('carry', 'is', null),
    ]);

    if (sessionData) {
      const sessionsWithCount = await Promise.all(
        (sessionData as Session[]).map(async sess => {
          const { count } = await supabase.from('range_shots').select('*', { count: 'exact', head: true }).eq('session_id', sess.id);
          return { ...sess, shot_count: count ?? 0 };
        })
      );
      setSessions(sessionsWithCount);
    }

    if (shotData) {
      const byClub: Record<string, number[]> = {};
      (shotData as { club: string; carry: number }[]).forEach(s => {
        if (!byClub[s.club]) byClub[s.club] = [];
        byClub[s.club].push(s.carry);
      });
      const avgs: ClubAvg[] = CLUBS
        .filter(c => byClub[c] && byClub[c].length > 0)
        .map(c => {
          const vals = byClub[c];
          return {
            club: c,
            avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
            max: Math.max(...vals),
            count: vals.length,
          };
        });
      setClubAvgs(avgs);
    }
    setLoading(false);
  }

  async function startSession() {
    if (!playerId || starting) return;
    setStarting(true);
    const { data, error } = await supabase.from('range_sessions').insert({ player_id: playerId }).select().single();
    setStarting(false);
    if (error || !data) { Alert.alert('Error', error?.message ?? 'Could not start session'); return; }
    router.push(`/(app)/range/${(data as any).id}` as any);
  }

  async function deleteSession(id: string) {
    Alert.alert('Delete Session', 'Remove this range session and all its shots?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await supabase.from('range_shots').delete().eq('session_id', id);
        await supabase.from('range_sessions').delete().eq('id', id);
        setSessions(prev => prev.filter(s => s.id !== id));
        if (playerId) loadData(playerId);
      }},
    ]);
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  if (!fontsLoaded) {
    return (
      <View style={s.container}>
        <StatusBar style="light" />
        <ActivityIndicator color={GOLD} style={{ flex: 1 }} />
      </View>
    );
  }

  const maxAvg = clubAvgs[0]?.avg || 1;

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerSide} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={GOLD} />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.logoImg} resizeMode="contain" />
          <Text style={s.headerSubtitle}>DRIVING RANGE</Text>
        </View>
        <View style={s.headerSide} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Start session card */}
        <TouchableOpacity style={s.startBtn} onPress={startSession} disabled={starting} activeOpacity={0.85}>
          {starting
            ? <ActivityIndicator color="#000" />
            : <>
                <Ionicons name="barbell-outline" size={32} color="#000" style={s.startIcon} />
                <Text style={s.startBtnText}>Start Range Session</Text>
                <Text style={s.startBtnSub}>Log shots, track distances, build your bag profile</Text>
              </>
          }
        </TouchableOpacity>

        {/* Bag distances */}
        {clubAvgs.length > 0 && (
          <>
            <Text style={s.sectionLabel}>YOUR BAG · CARRY DISTANCES</Text>
            <View style={s.bagCard}>
              {clubAvgs.map((c, i) => (
                <View key={c.club} style={[s.bagRow, i < clubAvgs.length - 1 && s.bagRowBorder]}>
                  <Text style={s.bagClub}>{c.club}</Text>
                  <View style={s.bagBarTrack}>
                    <View style={[s.bagBarFill, { width: `${Math.round((c.avg / maxAvg) * 100)}%` as any }]} />
                  </View>
                  <Text style={s.bagAvg}>{c.avg}<Text style={s.bagYds}> yds</Text></Text>
                  <Text style={s.bagMax}>{c.max}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Recent sessions */}
        {sessions.length > 0 && (
          <>
            <Text style={s.sectionLabel}>RECENT SESSIONS</Text>
            {sessions.map(sess => (
              <TouchableOpacity
                key={sess.id}
                style={s.sessionCard}
                onPress={() => router.push(`/(app)/range/${sess.id}` as any)}
                onLongPress={() => deleteSession(sess.id)}
                activeOpacity={0.8}
              >
                <View style={s.sessionLeft}>
                  <Text style={s.sessionDate}>{formatDate(sess.created_at)}</Text>
                  <Text style={s.sessionCount}>{sess.shot_count} shots</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={GOLD} />
              </TouchableOpacity>
            ))}
            <Text style={s.longPressHint}>Long press a session to delete</Text>
          </>
        )}

        {/* Empty state */}
        {!loading && sessions.length === 0 && (
          <View style={s.emptyState}>
            <Text style={s.emptyTitle}>No sessions yet</Text>
            <Text style={s.emptySub}>Hit Start Range Session to begin tracking your distances</Text>
          </View>
        )}

        {/* Loading */}
        {loading && <ActivityIndicator color={GOLD} style={{ marginTop: 32 }} />}

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  // Header
  header: {
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1c',
  },
  headerSide:   { width: 40, alignItems: 'flex-start' },
  headerCenter: { flex: 1, alignItems: 'center' },
  logoImg:      { width: 80, height: 28 },
  headerSubtitle: {
    fontFamily: FFB,
    fontSize: 10,
    color: '#fff',
    letterSpacing: 2,
    marginTop: 2,
  },

  scroll: { padding: 16, paddingBottom: 100 },

  // Start session button
  startBtn: {
    backgroundColor: GOLD,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 24,
  },
  startIcon:    { marginBottom: 6 },
  startBtnText: {
    fontFamily: FFB,
    fontSize: 16,
    color: '#000',
    letterSpacing: 0.5,
  },
  startBtnSub: {
    fontFamily: FFB,
    fontSize: 12,
    color: 'rgba(0,0,0,0.55)',
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 24,
  },

  // Section labels
  sectionLabel: {
    fontFamily: FFB,
    fontSize: 10,
    color: '#fff',
    letterSpacing: 2,
    marginBottom: 8,
    marginTop: 12,
  },

  // Bag card
  bagCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1c1c1c',
    overflow: 'hidden',
    marginBottom: 8,
  },
  bagRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  bagRowBorder: { borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  bagClub: {
    width: 44,
    fontFamily: FFB,
    fontSize: 13,
    color: '#fff',
  },
  bagBarTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#1c1c1c',
    borderRadius: 3,
    marginHorizontal: 10,
    overflow: 'hidden',
  },
  bagBarFill:   { height: '100%', backgroundColor: GOLD, borderRadius: 3 },
  bagAvg: {
    width: 68,
    fontFamily: FFB,
    fontSize: 13,
    color: GOLD,
    textAlign: 'right',
  },
  bagYds: {
    fontFamily: FFB,
    fontSize: 11,
    color: '#fff',
  },
  bagMax: {
    width: 40,
    fontFamily: FFB,
    fontSize: 11,
    color: '#fff',
    textAlign: 'right',
  },

  // Session cards
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1c1c1c',
    padding: 14,
    marginBottom: 8,
  },
  sessionLeft:  { flex: 1 },
  sessionDate: {
    fontFamily: FFB,
    fontSize: 15,
    color: '#fff',
  },
  sessionCount: {
    fontFamily: FFB,
    fontSize: 12,
    color: '#fff',
    marginTop: 2,
  },
  longPressHint: {
    fontFamily: FFB,
    fontSize: 11,
    color: '#fff',
    textAlign: 'center',
    marginTop: 6,
    opacity: 0.7,
  },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 48 },
  emptyTitle: {
    fontFamily: FFB,
    fontSize: 18,
    color: '#fff',
    marginBottom: 8,
  },
  emptySub: {
    fontFamily: FFB,
    fontSize: 14,
    color: '#fff',
    textAlign: 'center',
    lineHeight: 22,
  },
});
