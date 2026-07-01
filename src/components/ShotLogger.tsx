import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { fonts, spacing, radius } from '../lib/theme';
import { useDynamicColors } from '../lib/SocietyThemeContext';
import { scanNfcTagId, isNfcSupported } from '../lib/nfc';

type Club = { id: string; name: string; short_name: string; nfc_tag_id: string | null };
type ShotEntry = { id: string; shot_number: number; club_short: string | null; distance_yards: number | null };

const ORDINAL = (n: number) =>
  n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;

const DISTANCES = [50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300];

export default function ShotLogger({
  matchId,
  holeNumber,
}: {
  matchId: string;
  holeNumber: number;
}) {
  const colors = useDynamicColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [playerId,          setPlayerId]          = useState<string | null>(null);
  const [clubs,             setClubs]             = useState<Club[]>([]);
  const [shots,             setShots]             = useState<ShotEntry[]>([]);
  const [nfcAvail,          setNfcAvail]          = useState(false);
  const [scanning,          setScanning]          = useState(false);
  const [logging,           setLogging]           = useState(false);
  const [pendingDistanceId, setPendingDistanceId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [nfc, { data: { user } }] = await Promise.all([
        isNfcSupported(),
        supabase.auth.getUser(),
      ]);
      setNfcAvail(nfc);
      if (!user) return;

      const { data: player } = await supabase
        .from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (!player) return;
      const pid = (player as any).id as string;
      setPlayerId(pid);

      const { data: clubData } = await supabase
        .from('clubs')
        .select('id,name,short_name,nfc_tag_id')
        .eq('player_id', pid)
        .eq('in_bag', true)
        .order('sort_order');
      setClubs((clubData ?? []) as Club[]);
    })();
  }, []);

  useEffect(() => {
    if (playerId) fetchShots(playerId, holeNumber);
  }, [playerId, holeNumber, matchId]);

  async function fetchShots(pid: string, hole: number) {
    const { data } = await supabase
      .from('shots')
      .select('id,shot_number,club_short,distance_yards')
      .eq('match_id', matchId)
      .eq('player_id', pid)
      .eq('hole_number', hole)
      .order('shot_number');
    setShots((data ?? []) as ShotEntry[]);
  }

  async function logShot(club: Club | null) {
    if (!playerId || logging || scanning) return;
    setLogging(true);
    setPendingDistanceId(null);
    try {
      const nextShot = shots.length + 1;
      const { data: inserted } = await supabase
        .from('shots')
        .insert({
          match_id:    matchId,
          player_id:   playerId,
          hole_number: holeNumber,
          shot_number: nextShot,
          club_id:     club?.id         ?? null,
          club_name:   club?.name       ?? null,
          club_short:  club?.short_name ?? null,
        })
        .select('id')
        .single();
      await fetchShots(playerId, holeNumber);
      if (inserted) setPendingDistanceId((inserted as any).id);
    } finally {
      setLogging(false);
    }
  }

  async function applyDistance(yards: number) {
    if (!pendingDistanceId || !playerId) return;
    await supabase.from('shots').update({ distance_yards: yards }).eq('id', pendingDistanceId);
    setPendingDistanceId(null);
    await fetchShots(playerId, holeNumber);
  }

  async function undoShot() {
    if (!shots.length || !playerId) return;
    const last = shots[shots.length - 1];
    await supabase.from('shots').delete().eq('id', last.id);
    setPendingDistanceId(null);
    await fetchShots(playerId, holeNumber);
  }

  async function scanNfc() {
    if (!nfcAvail || scanning || logging) return;
    setScanning(true);
    const tagId = await scanNfcTagId();
    setScanning(false);
    if (!tagId) return;
    const club = clubs.find(c => c.nfc_tag_id === tagId);
    if (!club) {
      Alert.alert('Unknown Sticker', 'No club linked to this sticker. Assign it in My Bag first.');
      return;
    }
    await logShot(club);
  }

  if (!playerId) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>
          SHOT LOG{shots.length > 0 ? ` · ${shots.length} shot${shots.length > 1 ? 's' : ''}` : ''}
        </Text>
        <View style={styles.headerRight}>
          {shots.length > 0 && (
            <TouchableOpacity onPress={undoShot} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.undo}>↩</Text>
            </TouchableOpacity>
          )}
          {nfcAvail && (
            <TouchableOpacity
              style={[styles.nfcBtn, (scanning || logging) && styles.disabled]}
              onPress={scanNfc}
              disabled={scanning || logging}
              activeOpacity={0.7}
            >
              {scanning
                ? <ActivityIndicator size="small" color={colors.gold} />
                : <Text style={styles.nfcBtnText}>📡 Scan Club</Text>}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {shots.length > 0 && (
        <View style={styles.pills}>
          {shots.map(s => (
            <View key={s.id} style={styles.pill}>
              <Text style={styles.pillOrd}>{ORDINAL(s.shot_number)}</Text>
              <Text style={styles.pillClub}>
                {s.club_short ?? '?'}{s.distance_yards ? ` · ${s.distance_yards}y` : ''}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Distance picker — appears after each shot */}
      {pendingDistanceId && (
        <View style={styles.distancePicker}>
          <Text style={styles.distanceLabel}>HOW FAR?</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
            <View style={{ flexDirection: 'row', gap: 6, paddingVertical: 2 }}>
              {DISTANCES.map(d => (
                <TouchableOpacity
                  key={d}
                  style={styles.distanceChip}
                  onPress={() => applyDistance(d)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.distanceChipText}>{d}y</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.distanceSkip}
                onPress={() => setPendingDistanceId(null)}
                activeOpacity={0.7}
              >
                <Text style={styles.distanceSkipText}>Skip</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      )}

      <View style={styles.grid}>
        {clubs.map(club => (
          <TouchableOpacity
            key={club.id}
            style={[styles.clubBtn, (logging || scanning) && styles.disabled]}
            onPress={() => logShot(club)}
            disabled={logging || scanning}
            activeOpacity={0.7}
          >
            <Text style={styles.clubBtnText}>{club.short_name}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function makeStyles(c: ReturnType<typeof useDynamicColors>) {
  return StyleSheet.create({
    container: {
      marginTop: spacing.md,
      backgroundColor: c.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.sm,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.xs,
    },
    title: {
      fontSize: fonts.xs,
      fontWeight: '800',
      color: c.textMuted,
      letterSpacing: 1.5,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    undo: {
      fontSize: fonts.sm,
      color: c.gold,
      fontWeight: '700',
    },
    nfcBtn: {
      backgroundColor: c.goldDim,
      borderWidth: 1,
      borderColor: c.goldBorder,
      borderRadius: radius.sm,
      paddingVertical: 4,
      paddingHorizontal: spacing.sm,
      minWidth: 80,
      alignItems: 'center',
    },
    nfcBtnText: {
      fontSize: fonts.xs,
      fontWeight: '700',
      color: c.gold,
    },
    disabled: { opacity: 0.45 },

    pills: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginBottom: spacing.sm,
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: c.bg,
      borderRadius: radius.sm,
      paddingVertical: 3,
      paddingHorizontal: 7,
      borderWidth: 1,
      borderColor: c.border,
    },
    pillOrd:  { fontSize: 10, color: c.textMuted },
    pillClub: { fontSize: 10, fontWeight: '800', color: c.gold },

    distancePicker: {
      backgroundColor: c.bg,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: c.goldBorder,
      padding: spacing.sm,
      marginBottom: spacing.sm,
    },
    distanceLabel: {
      fontSize: 9,
      fontWeight: '800',
      color: c.gold,
      letterSpacing: 1.5,
    },
    distanceChip: {
      backgroundColor: c.cardAlt,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: 5,
      paddingHorizontal: spacing.sm,
    },
    distanceChipText: {
      fontSize: fonts.xs,
      fontWeight: '700',
      color: c.white,
    },
    distanceSkip: {
      paddingVertical: 5,
      paddingHorizontal: spacing.sm,
    },
    distanceSkipText: {
      fontSize: fonts.xs,
      color: c.textMuted,
      fontWeight: '600',
    },

    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    clubBtn: {
      width: 44,
      height: 36,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderColor: c.goldBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    clubBtnText: {
      fontSize: fonts.xs,
      fontWeight: '800',
      color: c.gold,
    },
  });
}
