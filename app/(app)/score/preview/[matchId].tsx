import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Image, ActivityIndicator, ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase } from '../../../../src/lib/supabase';
import { getPlayerAvatar } from '../../../../src/lib/assets';
import { speakIntro } from '../../../../src/lib/caddie';

const GOLD  = '#D4AF37';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../../assets/TitanAppLogo.png');

interface MatchPreview {
  id: string;
  round_format: string | null;
  is_singles: boolean;
  hcp_allowance: number | null;
  side_games: string[] | null;
  home_player_ids: string[];
  away_player_ids: string[];
  day: { course_name: string; course_par: number } | null;
}

interface Player {
  id: string;
  display_name: string;
  handicap_index: number;
  avatar_url: string | null;
}

function Avatar({ name, size = 72, src }: { name: string; size?: number; src?: any }) {
  if (src) {
    const imgSrc = typeof src === 'string' ? { uri: src } : src;
    return <Image source={imgSrc} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${GOLD}20`, borderWidth: 2, borderColor: `${GOLD}50`, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: FFB, fontSize: size * 0.38, color: GOLD }}>{(name || '?')[0].toUpperCase()}</Text>
    </View>
  );
}

export default function MatchPreviewScreen() {
  const { matchId, dayId, dayCode } = useLocalSearchParams<{ matchId: string; dayId?: string; dayCode?: string }>();
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [match, setMatch] = useState<MatchPreview | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [teeing, setTeeing] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: matchData } = await supabase
        .from('matches')
        .select('*,day:day_id(course_name,course_par)')
        .eq('id', matchId)
        .single();

      if (!matchData) { setLoading(false); return; }
      setMatch(matchData as any);

      const allIds = [...(matchData.home_player_ids ?? []), ...(matchData.away_player_ids ?? [])];
      if (allIds.length) {
        const { data: playersData } = await supabase
          .from('players')
          .select('id,display_name,handicap_index,avatar_url')
          .in('id', allIds);
        if (playersData) setPlayers(playersData as Player[]);
      }
      setLoading(false);
    }
    load();
  }, [matchId]);

  async function startRound() {
    if (teeing || !match) return;
    setTeeing(true);
    const firstNames = [...(match.home_player_ids ?? []), ...(match.away_player_ids ?? [])]
      .map(id => players.find(p => p.id === id)?.display_name.split(' ')[0])
      .filter(Boolean) as string[];
    const voiceOff = match.side_games?.includes('voice:off');
    if (!voiceOff) {
      await Promise.race([speakIntro(firstNames), new Promise(resolve => setTimeout(resolve, 6000))]);
    }
    router.replace(`/(app)/score/${matchId}` as any);
  }

  if (loading || !fontsLoaded) return (
    <View style={s.loading}>
      <ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  if (!match) return null;

  const allIds = [...match.home_player_ids, ...match.away_player_ids];
  const homePlayers = match.home_player_ids.map(id => players.find(p => p.id === id)).filter(Boolean) as Player[];
  const awayPlayers = match.away_player_ids.map(id => players.find(p => p.id === id)).filter(Boolean) as Player[];
  const isSolo = match.away_player_ids.length === 0;

  const modeName = (() => {
    const map: Record<string, string> = {
      stableford: 'Stableford', medal: 'Medal', matchplay: 'Matchplay',
      skins: 'Skins', nassau: 'Nassau', wolf: 'Wolf', scramble: 'Scramble',
      bbb: 'Best Ball Betterball', modified_stableford: 'Modified Stableford',
      par_bogey: 'Par / Bogey', chacha: 'Cha Cha Cha',
      greensome: 'Greensomes', foursomes: 'Foursomes',
      team_stableford: 'Team Stableford',
    };
    return map[match.round_format ?? ''] ?? (match.round_format ?? 'Matchplay');
  })();

  const hcpLabel = (() => {
    const h = match.hcp_allowance;
    if (!h || h === 100) return 'Full Handicap';
    if (h === 87) return '7/8 Handicap';
    if (h === 75) return '3/4 Handicap';
    if (h === 0) return 'Off Scratch';
    return `${h}% Handicap`;
  })();

  const voiceOn = !match.side_games?.includes('voice:off');
  const sideGames = (match.side_games ?? []).filter(g => !g.startsWith('voice'));

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerSide} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerSub}>READY TO TEE OFF</Text>
        </View>
        <View style={s.headerSide} />
      </View>

      {/* Course block */}
      <View style={s.courseBlock}>
        <Text style={s.courseName} numberOfLines={1}>{match.day?.course_name ?? 'Course'}</Text>
        <Text style={s.coursePar}>Par {match.day?.course_par ?? 72}</Text>
        {voiceOn && (
          <View style={s.voiceBadge}>
            <Ionicons name="mic-outline" size={10} color={GOLD} />
            <Text style={s.voiceBadgeText}>CHIP & BIRDIE ACTIVE</Text>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Players */}
        <View style={isSolo ? s.soloRow : s.matchupRow}>
          {isSolo ? (
            homePlayers.map(p => <PlayerCard key={p.id} player={p} size={homePlayers.length > 2 ? 60 : 80} />)
          ) : (
            <>
              <View style={s.side}>
                {homePlayers.map(p => <PlayerCard key={p.id} player={p} size={60} />)}
              </View>
              <View style={s.vsWrap}>
                <Text style={s.vsText}>VS</Text>
              </View>
              <View style={s.side}>
                {awayPlayers.map(p => <PlayerCard key={p.id} player={p} size={60} />)}
              </View>
            </>
          )}
        </View>

        {/* Match details */}
        <View style={s.detailCard}>
          <DetailRow icon="flag-outline" label="Format" value={modeName} />
          <View style={s.divider} />
          <DetailRow icon="person-outline" label="Handicap" value={hcpLabel} />
          {sideGames.length > 0 && (
            <>
              <View style={s.divider} />
              <DetailRow icon="locate-outline" label="Side Games" value={sideGames.join(' · ')} />
            </>
          )}
        </View>

        {/* Game day */}
        {dayCode && dayId && (
          <View style={s.dayCard}>
            <Text style={s.dayCardTitle}>GAME DAY</Text>
            <Text style={s.dayCardSub}>Share this code so others can join the leaderboard</Text>
            <Text style={s.dayCode}>{dayCode}</Text>
            <TouchableOpacity
              style={s.dayBtn}
              onPress={() => router.push(`/(app)/score/day/${dayId}` as any)}
              activeOpacity={0.8}
            >
              <Ionicons name="trophy-outline" size={14} color={GOLD} />
              <Text style={s.dayBtnText}>View Day Leaderboard</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>

      {/* Tee Off CTA */}
      <View style={s.footer}>
        <TouchableOpacity style={s.teeBtn} onPress={startRound} disabled={teeing} activeOpacity={0.85}>
          {teeing
            ? <ActivityIndicator color="#000000" />
            : <>
                <Ionicons name="golf-outline" size={20} color="#000000" />
                <Text style={s.teeBtnText}>Tee Off</Text>
              </>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

function PlayerCard({ player, size }: { player: Player; size: number }) {
  const avatar = player.avatar_url ?? getPlayerAvatar(player.id, 'normal');
  const firstName = player.display_name.split(' ')[0];
  return (
    <View style={s.playerCard}>
      <View style={[s.avatarRing, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }]}>
        <Avatar name={firstName} size={size} src={avatar} />
      </View>
      <Text style={s.playerName}>{firstName}</Text>
      <Text style={s.playerHcp}>Hcp {player.handicap_index}</Text>
    </View>
  );
}

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={s.detailRow}>
      <Ionicons name={icon as any} size={16} color="#6b7280" />
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#000000' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 56, paddingHorizontal: 16, paddingBottom: 8,
  },
  headerSide:   { width: 40 },
  headerCenter: { flex: 1, alignItems: 'center', gap: 2 },
  headerLogo:   { width: 28, height: 28 },
  headerSub:    { fontFamily: FFB, fontSize: 9, color: GOLD, letterSpacing: 2.5 },

  courseBlock: { alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16, gap: 4 },
  courseName:  { fontFamily: FFB, fontSize: 28, color: '#ffffff', textAlign: 'center' },
  coursePar:   { fontFamily: FFB, fontSize: 14, color: '#fff' },
  voiceBadge:  { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, backgroundColor: `${GOLD}0d`, borderWidth: 1, borderColor: `${GOLD}30` },
  voiceBadgeText: { fontFamily: FFB, fontSize: 9, color: GOLD, letterSpacing: 1.5 },

  scroll: { paddingHorizontal: 16, paddingBottom: 120, gap: 16 },

  matchupRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  soloRow:    { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 20, paddingVertical: 8 },
  side:       { flex: 1, alignItems: 'center', gap: 12 },
  vsWrap:     { width: 44, alignItems: 'center' },
  vsText:     { fontFamily: FFB, fontSize: 18, color: '#333', letterSpacing: 2 },

  playerCard: { alignItems: 'center', gap: 6 },
  avatarRing: { borderWidth: 2, borderColor: `${GOLD}40`, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  playerName: { fontFamily: FFB, fontSize: 14, color: '#ffffff' },
  playerHcp:  { fontFamily: FFB, fontSize: 12, color: '#fff' },

  detailCard: {
    backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden',
  },
  detailRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  detailLabel: { fontFamily: FFB, fontSize: 12, color: '#fff', width: 80 },
  detailValue: { flex: 1, fontFamily: FFB, fontSize: 13, color: '#ffffff', textAlign: 'right' },
  divider:     { height: 1, backgroundColor: '#1a1a1a' },

  dayCard: {
    backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 1, borderColor: `${GOLD}30`,
    padding: 16, alignItems: 'center', gap: 8,
  },
  dayCardTitle: { fontFamily: FFB, fontSize: 9, color: GOLD, letterSpacing: 2 },
  dayCardSub:   { fontFamily: FFB, fontSize: 11, color: '#fff', textAlign: 'center' },
  dayCode:      { fontFamily: FFB, fontSize: 38, color: '#ffffff', letterSpacing: 10, marginVertical: 4 },
  dayBtn:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: `${GOLD}0d`, borderWidth: 1, borderColor: `${GOLD}30` },
  dayBtnText:   { fontFamily: FFB, fontSize: 13, color: GOLD },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 16, paddingBottom: 40,
    backgroundColor: '#000000',
    borderTopWidth: 1, borderTopColor: '#111111',
  },
  teeBtn: {
    backgroundColor: GOLD, borderRadius: 14,
    paddingVertical: 17,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  teeBtnText: { fontFamily: FFB, fontSize: 18, color: '#000000' },
});
