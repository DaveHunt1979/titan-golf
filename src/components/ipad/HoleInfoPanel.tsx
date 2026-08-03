import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const GOLD   = '#D4AF37';
const BG     = '#0a0a0a';
const BORDER = '#1c1c1c';
const MUTED  = '#6b7280';

const TEE_COLORS: Record<string, { dot: string; label: string }> = {
  blue:   { dot: '#3b82f6', label: 'Blue'   },
  white:  { dot: '#e5e7eb', label: 'White'  },
  yellow: { dot: '#eab308', label: 'Yellow' },
  red:    { dot: '#ef4444', label: 'Red'    },
};

interface Props {
  holeNumber: number;
  par: number | null;
  strokeIndex: number | null;
  yardage: number | null;
  teeYardages: Record<string, number> | null;
  onRangefinder: () => void;
}

export default function HoleInfoPanel({ holeNumber, par, strokeIndex, yardage, teeYardages, onRangefinder }: Props) {
  const teeRows = teeYardages
    ? Object.entries(teeYardages)
        .filter(([k, v]) => TEE_COLORS[k] && v > 0)
        .sort((a, b) => b[1] - a[1])
    : yardage
      ? [['white', yardage] as [string, number]]
      : [];

  return (
    <View style={s.root}>
      {/* Hole number */}
      <View style={s.holeWrap}>
        <Text style={s.holeLabel}>HOLE</Text>
        <Text style={s.holeNum}>{String(holeNumber).padStart(2, '0')}</Text>
        <View style={s.parRow}>
          {par != null && (
            <View style={s.badge}>
              <Text style={s.badgeText}>Par {par}</Text>
            </View>
          )}
          {strokeIndex != null && (
            <View style={[s.badge, { borderColor: MUTED }]}>
              <Text style={[s.badgeText, { color: MUTED }]}>SI {strokeIndex}</Text>
            </View>
          )}
        </View>
      </View>

      <View style={s.divider} />

      {/* Tee yardages */}
      {teeRows.length > 0 && (
        <View style={s.yardageSection}>
          <Text style={s.sectionLabel}>DISTANCE FROM TEE</Text>
          {teeRows.map(([key, yards]) => {
            const tc = TEE_COLORS[key] ?? { dot: '#fff', label: key };
            return (
              <View key={key} style={s.yardRow}>
                <View style={[s.teeDot, { backgroundColor: tc.dot }]} />
                <Text style={s.teeLabel}>{tc.label}</Text>
                <Text style={s.yardNum}>{yards}</Text>
                <Text style={s.yardUnit}>yds</Text>
              </View>
            );
          })}
        </View>
      )}

      <View style={{ flex: 1 }} />

      <View style={s.divider} />

      {/* Rangefinder button */}
      <TouchableOpacity style={s.rfBtn} onPress={onRangefinder} activeOpacity={0.8}>
        <Ionicons name="navigate-outline" size={18} color={GOLD} />
        <Text style={s.rfBtnText}>RANGEFINDER</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: BORDER,
    paddingBottom: 24,
  },
  holeWrap: {
    alignItems: 'center',
    paddingTop: 40,
    paddingBottom: 24,
  },
  holeLabel: {
    color: MUTED,
    fontSize: 11,
    fontFamily: 'JUSTSans-ExBold',
    letterSpacing: 3,
    marginBottom: 4,
  },
  holeNum: {
    color: GOLD,
    fontSize: 88,
    fontFamily: 'JUSTSans-ExBold',
    lineHeight: 92,
  },
  parRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  badge: {
    borderWidth: 1,
    borderColor: GOLD,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    color: GOLD,
    fontSize: 12,
    fontFamily: 'JUSTSans-ExBold',
    letterSpacing: 0.5,
  },
  divider: { height: 1, backgroundColor: BORDER, marginHorizontal: 0 },
  yardageSection: { paddingHorizontal: 24, paddingTop: 20, gap: 12 },
  sectionLabel: {
    color: MUTED,
    fontSize: 10,
    fontFamily: 'JUSTSans-ExBold',
    letterSpacing: 2,
    marginBottom: 4,
  },
  yardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  teeDot: { width: 10, height: 10, borderRadius: 5 },
  teeLabel: { color: '#9ca3af', fontSize: 13, fontFamily: 'JUSTSans', flex: 1 },
  yardNum: { color: '#fff', fontSize: 22, fontFamily: 'JUSTSans-ExBold' },
  yardUnit: { color: MUTED, fontSize: 12, fontFamily: 'JUSTSans', marginBottom: 2 },
  rfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 20,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: GOLD,
    borderRadius: 10,
  },
  rfBtnText: {
    color: GOLD,
    fontSize: 13,
    fontFamily: 'JUSTSans-ExBold',
    letterSpacing: 1.5,
  },
});
