import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDynamicColors } from '../lib/SocietyThemeContext';
import { resolveAvatar, teamLogos } from '../lib/assets';

const SILVER = '#9ca3af';
const BRONZE = '#cd7f32';
const RED    = '#f87171';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';

export interface LeaderboardRow {
  id: string;
  // Rows arrive pre-sorted by the caller (every screen already has its own
  // tiebreak-tested sort — getStandings(), swindle's points sort, etc.) —
  // this is only compared against the previous row to detect a tie, never
  // used to re-sort.
  sortKey: number;
  name: string;
  subtitle?: string;
  playerId?: string;
  avatarUrl?: string | null;
  teamName?: string;
  teamLogoUrl?: string | null;
  teamAccentColor?: string;
  isCaptain?: boolean;
  isMe?: boolean;
  columns?: (string | number | null)[];
  totalDisplay: string;
}

export interface LeaderboardProps {
  title?: string;
  columnLabels?: string[];
  totalLabel?: string;
  rows: LeaderboardRow[];
  emptyMessage?: string;
  pointsKey?: { label: string; value: string }[];
  // Optional — rows render as plain Views when omitted, unchanged from
  // before this existed. Only Kronos (tap a player for their scorecard)
  // uses this today.
  onRowPress?: (row: LeaderboardRow) => void;
}

function tierColor(rank: number, rowCount: number): string {
  if (rank === 1) return '#D4AF37';
  if (rank === 2) return SILVER;
  if (rank === 3) return BRONZE;
  if (rowCount > 3 && rank === rowCount) return RED;
  return 'transparent';
}

// A row's own crest/avatar — team crest (with accent-dot fallback) when
// this is a team row, else a player avatar (with initials fallback),
// consolidating the ~4 different bespoke Avatar components this
// codebase had scattered across screens into one place.
function RowIcon({ row, size, dc }: { row: LeaderboardRow; size: number; dc: ReturnType<typeof useDynamicColors> }) {
  if (row.teamName) {
    // A real uploaded crest (teams.logo_url) always wins over the static
    // teamLogos[] lookup — that map only covers a handful of named teams
    // and was silently leaving any other team (e.g. one with its own
    // uploaded photo/crest) as just a bare accent-color dot.
    if (row.teamLogoUrl) return <Image source={{ uri: row.teamLogoUrl }} style={{ width: size, height: size, borderRadius: 4 }} resizeMode="cover" />;
    const logo = teamLogos[row.teamName];
    if (logo) return <Image source={logo} style={{ width: size, height: size }} resizeMode="contain" />;
    return <View style={{ width: size * 0.36, height: size * 0.36, borderRadius: size * 0.18, backgroundColor: row.teamAccentColor ?? dc.gold }} />;
  }
  const avatar = row.playerId ? resolveAvatar(row.playerId, row.avatarUrl) : null;
  if (avatar) return <Image source={avatar} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: dc.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: dc.border }}>
      <Text style={{ fontFamily: FFB, fontSize: size * 0.4, color: dc.cardText }}>{(row.name || '?').charAt(0).toUpperCase()}</Text>
    </View>
  );
}

export default function Leaderboard({ title, columnLabels, totalLabel = 'TOTAL', rows, emptyMessage = 'No results yet', pointsKey, onRowPress }: LeaderboardProps) {
  const dc = useDynamicColors();

  // Tie-aware ranking: same sortKey as the row before it → shares that
  // row's displayed rank, marked "T{rank}" (e.g. two players tied for
  // 9th both show "T9") — every leaderboard in this app previously showed
  // strict sequential positions even on an exact tie; the one place that
  // tried (ipad/LeaderboardPanel.tsx) never actually finished the job.
  let lastRank = 0;
  let lastSortKey: number | null = null;
  const ranked = rows.map((row, i) => {
    const tied = lastSortKey !== null && row.sortKey === lastSortKey;
    const rank = tied ? lastRank : i + 1;
    lastRank = rank;
    lastSortKey = row.sortKey;
    return { row, rank, tied };
  });

  return (
    <View style={s.wrap}>
      {title && <Text style={[s.title, { color: dc.gold }]}>{title}</Text>}

      {columnLabels && columnLabels.length > 0 && (
        <View style={s.headerRow}>
          <View style={s.headerRank} />
          <View style={s.headerIcon} />
          <Text style={[s.headerCell, s.headerName, { color: dc.textSecondary }]}>PLAYER</Text>
          {columnLabels.map(label => (
            <Text key={label} style={[s.headerCell, { color: dc.textSecondary }]}>{label}</Text>
          ))}
          <Text style={[s.headerCell, { color: dc.textSecondary }]}>{totalLabel}</Text>
        </View>
      )}

      {ranked.length === 0 ? (
        <Text style={[s.empty, { color: dc.textSecondary }]}>{emptyMessage}</Text>
      ) : ranked.map(({ row, rank, tied }) => {
        const accent = tierColor(rank, ranked.length);
        const RowContainer: any = onRowPress ? TouchableOpacity : View;
        return (
          <RowContainer
            key={row.id}
            activeOpacity={onRowPress ? 0.7 : undefined}
            onPress={onRowPress ? () => onRowPress(row) : undefined}
            style={[
              s.row,
              { backgroundColor: dc.card, borderColor: dc.border, borderLeftColor: accent, borderLeftWidth: accent === 'transparent' ? 1 : 3 },
              row.isMe && { backgroundColor: dc.goldDim },
            ]}
          >
            <Text style={[s.rank, { color: accent === 'transparent' ? dc.textMuted : accent }]}>{tied ? `T${rank}` : rank}</Text>
            <RowIcon row={row} size={32} dc={dc} />
            <View style={s.nameCol}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {row.isCaptain && <Ionicons name="star" size={12} color={dc.gold} />}
                <Text style={[s.name, { color: dc.cardText }]} numberOfLines={1}>{row.name}{row.isMe ? ' (you)' : ''}</Text>
              </View>
              {row.subtitle && <Text style={[s.subtitle, { color: dc.textSecondary }]} numberOfLines={1}>{row.subtitle}</Text>}
            </View>
            {(row.columns ?? []).map((val, i) => (
              <Text key={i} style={[s.cell, { color: dc.textSecondary }]}>{val ?? '–'}</Text>
            ))}
            <Text style={[s.total, { color: rank === 1 ? dc.gold : dc.cardText }]}>{row.totalDisplay}</Text>
          </RowContainer>
        );
      })}

      {pointsKey && pointsKey.length > 0 && (
        <View style={[s.keyPanel, { backgroundColor: dc.card, borderColor: dc.border }]}>
          <Text style={[s.keyTitle, { color: dc.textSecondary }]}>POINTS KEY</Text>
          {pointsKey.map(k => (
            <View key={k.label} style={s.keyRow}>
              <Text style={[s.keyLabel, { color: dc.cardText }]}>{k.label}</Text>
              <Text style={[s.keyValue, { color: dc.gold }]}>{k.value}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  title: { fontFamily: FFB, fontSize: 12, letterSpacing: 1.5 },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10 },
  headerRank: { width: 28 },
  headerIcon: { width: 32 },
  headerCell: { flex: 1, fontFamily: FFB, fontSize: 10, letterSpacing: 0.5, textAlign: 'center' },
  headerName: { flex: 2, textAlign: 'left' },

  empty: { fontFamily: FFB, fontSize: 13, textAlign: 'center', paddingVertical: 20 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 10 },
  rank: { width: 28, fontFamily: FFB, fontSize: 14, textAlign: 'center' },
  nameCol: { flex: 2, minWidth: 0 },
  name: { fontFamily: FFB, fontSize: 14 },
  subtitle: { fontFamily: FF, fontSize: 11, marginTop: 1 },
  cell: { flex: 1, fontFamily: FFB, fontSize: 13, textAlign: 'center' },
  total: { flex: 1, fontFamily: FFB, fontSize: 15, textAlign: 'center' },

  keyPanel: { borderRadius: 10, borderWidth: 1, padding: 12, gap: 8, marginTop: 4 },
  keyTitle: { fontFamily: FFB, fontSize: 10, letterSpacing: 1.5 },
  keyRow: { flexDirection: 'row', justifyContent: 'space-between' },
  keyLabel: { fontFamily: FF, fontSize: 13 },
  keyValue: { fontFamily: FFB, fontSize: 13 },
});
