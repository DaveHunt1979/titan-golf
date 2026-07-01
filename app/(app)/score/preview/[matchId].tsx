import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Image, ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../../src/lib/supabase';
import { colors, fonts, spacing, radius } from '../../../../src/lib/theme';
import { getPlayerAvatar } from '../../../../src/lib/assets';
import { speakIntro } from '../../../../src/lib/caddie';

interface MatchPreview {
  id: string;
  round_format: string | null;
  is_singles: boolean;
  hcp_allowance: number | null;
  side_games: string[] | null;
  home_player_ids: string[];
  away_player_ids: string[];
  day: {
    course_name: string;
    course_par: number;
  } | null;
}

interface Player {
  id: string;
  display_name: string;
  handicap_index: number;
  avatar_url: string | null;
}

export default function MatchPreviewScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();

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

      const [{ data: playersData }] = await Promise.all([
        allIds.length
          ? supabase.from('players').select('id,display_name,handicap_index,avatar_url').in('id', allIds)
          : Promise.resolve({ data: [] }),
      ]);

      if (playersData) setPlayers(playersData as Player[]);
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
    await Promise.race([
      speakIntro(firstNames),
      new Promise(resolve => setTimeout(resolve, 35000)),
    ]);
    router.replace(`/(app)/score/${matchId}` as any);
  }

  if (loading) return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.gold} size="large" />
    </View>
  );

  if (!match) return null;

  const isSolo = match.round_format === 'stableford' || match.round_format === 'medal';
  const homePlayers = match.home_player_ids.map(id => players.find(p => p.id === id)).filter(Boolean) as Player[];
  const awayPlayers = match.away_player_ids.map(id => players.find(p => p.id === id)).filter(Boolean) as Player[];

  const modeName = (() => {
    if (match.round_format === 'stableford') return 'Stableford';
    if (match.round_format === 'medal') return 'Medal';
    if (match.is_singles) return 'Singles Matchplay';
    return '4BBB Matchplay';
  })();

  const hcpLabel = (() => {
    if (match.hcp_allowance === 100 || match.hcp_allowance === null) return 'Full Handicap';
    if (match.hcp_allowance === 87) return '7/8 Handicap';
    if (match.hcp_allowance === 75) return '3/4 Handicap';
    if (match.hcp_allowance === 0) return 'Off Scratch';
    return `${match.hcp_allowance}% Handicap`;
  })();

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Course hero */}
      <View style={styles.hero}>
        <View style={styles.heroFallback} />
        <View style={styles.heroOverlay}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>READY TO TEE OFF</Text>
          </View>
          <Text style={styles.heroCourseName}>{match.day?.course_name}</Text>
          <Text style={styles.heroCourseDetail}>Par {match.day?.course_par}</Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        {/* Mode chip */}
        <View style={styles.modeRow}>
          <View style={styles.modeChip}>
            <Text style={styles.modeChipText}>{modeName.toUpperCase()}</Text>
          </View>
        </View>

        {/* Player matchup */}
        {isSolo ? (
          <View style={styles.soloRow}>
            {homePlayers.map(p => <PlayerCard key={p.id} player={p} size="large" />)}
          </View>
        ) : (
          <View style={styles.matchupRow}>
            <View style={styles.matchupSide}>
              {homePlayers.map(p => <PlayerCard key={p.id} player={p} size={homePlayers.length > 1 ? 'small' : 'large'} />)}
            </View>
            <View style={styles.vsCol}>
              <Text style={styles.vsText}>VS</Text>
            </View>
            <View style={styles.matchupSide}>
              {awayPlayers.map(p => <PlayerCard key={p.id} player={p} size={awayPlayers.length > 1 ? 'small' : 'large'} />)}
            </View>
          </View>
        )}

        {/* Details */}
        <View style={styles.detailCard}>
          <DetailRow icon="⛳" label="Format" value={modeName} />
          <View style={styles.divider} />
          <DetailRow icon="🏌️" label="Handicap" value={hcpLabel} />
          {match.side_games && match.side_games.length > 0 && (
            <>
              <View style={styles.divider} />
              <DetailRow icon="🎯" label="Side Games" value={match.side_games.join(', ')} />
            </>
          )}
        </View>

      </ScrollView>

      {/* Tee off */}
      <View style={styles.footer}>
        <TouchableOpacity style={[styles.teeBtn, teeing && styles.teeBtnLoading]} onPress={startRound} disabled={teeing} activeOpacity={0.85}>
          {teeing
            ? <ActivityIndicator color={colors.bg} />
            : <Text style={styles.teeBtnText}>Tee Off  →</Text>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

function PlayerCard({ player, size }: { player: Player; size: 'large' | 'small' }) {
  const avatar = player.avatar_url ?? getPlayerAvatar(player.id, 'normal');
  const firstName = player.display_name.split(' ')[0];
  const dim = size === 'large' ? 80 : 60;
  return (
    <View style={styles.playerCard}>
      <View style={[styles.avatarRing, { width: dim + 4, height: dim + 4, borderRadius: (dim + 4) / 2 }]}>
        {avatar
          ? <Image source={typeof avatar === 'string' ? { uri: avatar } : avatar} style={{ width: dim, height: dim, borderRadius: dim / 2 }} />
          : <View style={[{ width: dim, height: dim, borderRadius: dim / 2 }, styles.avatarFallback]}>
              <Text style={[styles.avatarInitial, { fontSize: size === 'large' ? 28 : 20 }]}>{firstName[0]}</Text>
            </View>
        }
      </View>
      <Text style={styles.playerName}>{firstName}</Text>
      <Text style={styles.playerHcp}>Hcp {player.handicap_index}</Text>
    </View>
  );
}

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailIcon}>{icon}</Text>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },

  hero: { height: 260, position: 'relative' },
  heroFallback: { flex: 1, backgroundColor: colors.card },
  heroOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    justifyContent: 'flex-end',
  },
  backBtn: { position: 'absolute', top: 60, left: spacing.lg },
  backText: { fontSize: fonts.md, color: colors.white, fontWeight: '600' },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.gold,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    marginBottom: spacing.sm,
  },
  heroBadgeText: { fontSize: 9, fontWeight: '900', color: colors.bg, letterSpacing: 2 },
  heroCourseName: { fontSize: 28, fontWeight: '900', color: colors.white, lineHeight: 32 },
  heroCourseDetail: { fontSize: fonts.sm, color: 'rgba(255,255,255,0.65)', fontWeight: '600', marginTop: 4 },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 120 },

  modeRow: { alignItems: 'center', paddingTop: spacing.lg, paddingBottom: spacing.sm },
  modeChip: {
    borderWidth: 1, borderColor: colors.goldBorder,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.xs + 2,
    backgroundColor: colors.goldDim,
  },
  modeChipText: { fontSize: fonts.xs, fontWeight: '800', color: colors.gold, letterSpacing: 2 },

  matchupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  matchupSide: { flex: 1, alignItems: 'center', gap: spacing.md },
  vsCol: { width: 44, alignItems: 'center' },
  vsText: { fontSize: fonts.xl, fontWeight: '900', color: colors.textMuted, letterSpacing: 2 },

  soloRow: { alignItems: 'center', paddingVertical: spacing.lg },

  playerCard: { alignItems: 'center', gap: 6 },
  avatarRing: { borderWidth: 2, borderColor: colors.gold, overflow: 'hidden' },
  avatarFallback: { backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontWeight: '800', color: colors.white },
  playerName: { fontSize: fonts.md, fontWeight: '700', color: colors.white },
  playerHcp: { fontSize: fonts.xs, color: colors.textMuted, fontWeight: '600' },

  detailCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  detailRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md + 2,
    gap: spacing.sm,
  },
  detailIcon: { fontSize: 18, width: 28 },
  detailLabel: { fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600', width: 80 },
  detailValue: { flex: 1, fontSize: fonts.sm, color: colors.white, fontWeight: '700', textAlign: 'right' },
  divider: { height: 1, backgroundColor: colors.border },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: spacing.lg, paddingBottom: 40,
    backgroundColor: colors.bg,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  teeBtn: {
    backgroundColor: colors.gold,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  teeBtnLoading: { opacity: 0.75 },
  teeBtnText: { fontSize: fonts.lg, fontWeight: '900', color: colors.bg, letterSpacing: 2 },
});
