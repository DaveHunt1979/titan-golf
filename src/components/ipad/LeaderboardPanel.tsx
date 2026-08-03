import { View, Text, StyleSheet, ScrollView } from 'react-native';

const GOLD   = '#D4AF37';
const BG     = '#0a0a0a';
const BORDER = '#1c1c1c';
const MUTED  = '#6b7280';
const GREEN  = '#4ade80';
const RED    = '#f87171';

interface Props {
  allPlayerIds: string[];
  playerNames: Record<string, string>;
  playerTotals: Record<string, number>;
  matchHomeIds: string[];
  homeColor: string;
  awayColor: string;
  holeChars: string[];
  isStrokePlay: boolean;
  isMatchplay: boolean;
  liveHomeUp: number;
  homeLabel: string;
  awayLabel: string;
}

export default function LeaderboardPanel({
  allPlayerIds, playerNames, playerTotals, matchHomeIds,
  homeColor, awayColor, holeChars,
  isStrokePlay, isMatchplay, liveHomeUp, homeLabel, awayLabel,
}: Props) {
  const played = holeChars.filter(c => c !== '.').length;

  // Sort players for the leaderboard
  const ranked = [...allPlayerIds].sort((a, b) => {
    const pa = playerTotals[a] ?? 0;
    const pb = playerTotals[b] ?? 0;
    return isStrokePlay && !isMatchplay ? pa - pb : pb - pa;
  });

  const matchStatus = liveHomeUp === 0
    ? 'All Square'
    : liveHomeUp > 0
      ? `${homeLabel}  ${Math.abs(liveHomeUp)} Up`
      : `${awayLabel}  ${Math.abs(liveHomeUp)} Up`;

  const statusColor = liveHomeUp === 0 ? GOLD : liveHomeUp > 0 ? homeColor : awayColor;

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>LEADERBOARD</Text>
        <View style={s.throughChip}>
          <Text style={s.throughText}>Thru {played}</Text>
        </View>
      </View>

      <View style={s.divider} />

      {isMatchplay ? (
        /* Match play: show match status prominently */
        <View style={s.matchWrap}>
          <Text style={s.matchStatusLabel}>MATCH STATUS</Text>
          <Text style={[s.matchStatus, { color: statusColor }]}>{matchStatus}</Text>
          <Text style={s.matchThru}>After {played} hole{played !== 1 ? 's' : ''}</Text>

          <View style={s.divider} />

          {/* Players */}
          <View style={s.teamsWrap}>
            <View style={s.teamRow}>
              <View style={[s.teamDot, { backgroundColor: homeColor }]} />
              <Text style={s.teamName}>{homeLabel}</Text>
            </View>
            <Text style={s.vsText}>vs</Text>
            <View style={s.teamRow}>
              <View style={[s.teamDot, { backgroundColor: awayColor }]} />
              <Text style={s.teamName}>{awayLabel}</Text>
            </View>
          </View>
        </View>
      ) : (
        /* Stroke / Stableford: ranked list */
        <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
          {ranked.map((id, idx) => {
            const isHome  = matchHomeIds.includes(id);
            const pts     = playerTotals[id] ?? 0;
            const name    = (playerNames[id] ?? '?').split(' ')[0];
            const ptsStr  = isStrokePlay ? (pts === 0 ? 'E' : pts > 0 ? `+${pts}` : `${pts}`) : `${pts}`;
            const ptsColor = isStrokePlay
              ? (pts < 0 ? GREEN : pts > 0 ? RED : MUTED)
              : pts > 0 ? GREEN : MUTED;
            const rank = idx + 1;
            const prevPts = idx > 0 ? (playerTotals[ranked[idx - 1]] ?? 0) : null;
            const tied = prevPts !== null && prevPts === pts;

            return (
              <View key={id} style={[s.row, idx === 0 && s.rowFirst]}>
                <Text style={[s.rank, tied && { color: 'transparent' }]}>
                  {tied ? rank : rank}
                </Text>
                <View style={[s.playerDot, { backgroundColor: isHome ? homeColor : awayColor }]} />
                <Text style={s.playerName} numberOfLines={1}>{name}</Text>
                <Text style={[s.pts, { color: ptsColor }]}>{ptsStr}</Text>
                {!isStrokePlay && <Text style={s.ptsUnit}>pts</Text>}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    width: 260,
    backgroundColor: BG,
    borderLeftWidth: 1,
    borderColor: BORDER,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 11,
    fontFamily: 'JUSTSans-ExBold',
    letterSpacing: 2,
  },
  throughChip: {
    backgroundColor: '#1c1c1c',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  throughText: {
    color: MUTED,
    fontSize: 11,
    fontFamily: 'JUSTSans',
  },
  divider: { height: 1, backgroundColor: BORDER },
  list: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
    gap: 8,
  },
  rowFirst: { paddingTop: 16 },
  rank: {
    color: MUTED,
    fontSize: 12,
    fontFamily: 'JUSTSans-ExBold',
    width: 18,
    textAlign: 'center',
  },
  playerDot: { width: 8, height: 8, borderRadius: 4 },
  playerName: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'JUSTSans',
    flex: 1,
  },
  pts: {
    fontSize: 18,
    fontFamily: 'JUSTSans-ExBold',
    minWidth: 32,
    textAlign: 'right',
  },
  ptsUnit: {
    color: MUTED,
    fontSize: 10,
    fontFamily: 'JUSTSans',
    marginBottom: 2,
  },
  // Matchplay styles
  matchWrap: { flex: 1, paddingTop: 32 },
  matchStatusLabel: {
    color: MUTED,
    fontSize: 10,
    fontFamily: 'JUSTSans-ExBold',
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: 12,
  },
  matchStatus: {
    fontSize: 22,
    fontFamily: 'JUSTSans-ExBold',
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  matchThru: {
    color: MUTED,
    fontSize: 12,
    fontFamily: 'JUSTSans',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  teamsWrap: { paddingHorizontal: 20, paddingTop: 20, gap: 16 },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  teamDot: { width: 10, height: 10, borderRadius: 5 },
  teamName: { color: '#fff', fontSize: 14, fontFamily: 'JUSTSans', flex: 1 },
  vsText: { color: MUTED, fontSize: 12, fontFamily: 'JUSTSans', textAlign: 'center' },
});
