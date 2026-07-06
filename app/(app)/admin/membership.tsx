import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, TextInput, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { fonts, spacing, radius } from '../../../src/lib/theme';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';

interface Player {
  id: string;
  display_name: string;
  handicap_index: number | null;
  membership_types: string[];
}

const AREAS = [
  { key: 'casual',  label: 'Casual',  color: '#4ade80' },
  { key: 'tour',    label: 'Tour',    color: '#D4AF37' },
  { key: 'swindle', label: 'Swindle', color: '#a78bfa' },
] as const;

export default function MembershipScreen() {
  const colors = useDynamicColors();
  const router = useRouter();
  const { societyId, loading: societyLoading } = useAdminSociety();

  const styles = useMemo(() => StyleSheet.create({
    container:   { flex: 1, backgroundColor: colors.bg },
    centered:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
    header:      {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    back:        { fontSize: fonts.sm, color: colors.gold, fontWeight: '600' },
    headerTitle: { fontSize: fonts.md, fontWeight: '800', color: colors.white, letterSpacing: 0.5 },
    searchBar:   {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: colors.card, borderRadius: radius.md,
      borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      margin: spacing.md, marginBottom: 0,
    },
    searchInput: { flex: 1, fontSize: fonts.sm, color: colors.white, padding: 0 },
    scroll:      { padding: spacing.md, paddingBottom: 48 },
    playerCard:  {
      backgroundColor: colors.card, borderRadius: radius.md,
      borderWidth: 1, borderColor: colors.border,
      padding: spacing.md, marginBottom: spacing.sm,
    },
    playerName:  { fontSize: fonts.md, fontWeight: '800', color: colors.white, marginBottom: 4 },
    playerHcp:   { fontSize: fonts.xs, color: colors.textMuted, marginBottom: spacing.sm },
    chips:       { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
    chip:        {
      paddingHorizontal: spacing.sm, paddingVertical: 5,
      borderRadius: 99, borderWidth: 1.5, borderColor: '#374151',
      backgroundColor: 'transparent',
    },
    chipOn:      { borderColor: 'transparent' },
    chipText:    { fontSize: fonts.xs, fontWeight: '700', color: '#6b7280', letterSpacing: 0.5 },
    empty:       { alignItems: 'center', paddingVertical: spacing.xxl },
    emptyText:   { fontSize: fonts.md, color: colors.textMuted, textAlign: 'center' },
    count:       { fontSize: fonts.xs, color: colors.textMuted, marginBottom: spacing.md, textAlign: 'center' },
  }), [colors]);

  const [players, setPlayers]   = useState<Player[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [saving, setSaving]     = useState<string | null>(null);

  async function load() {
    if (!societyId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('society_members')
      .select('player_id, membership_types, players(id, display_name, handicap_index)')
      .eq('society_id', societyId)
      .order('players(display_name)');

    if (error) { Alert.alert('Error', error.message); setLoading(false); return; }
    const rows: Player[] = (data ?? []).map((row: any) => ({
      id:               row.players?.id ?? row.player_id,
      display_name:     row.players?.display_name ?? 'Unknown',
      handicap_index:   row.players?.handicap_index ?? null,
      membership_types: row.membership_types ?? [],
    }));
    setPlayers(rows);
    setLoading(false);
  }

  useEffect(() => {
    if (!societyLoading) load();
  }, [societyId, societyLoading]);

  async function toggleArea(player: Player, area: string) {
    const has = player.membership_types.includes(area);
    const newTypes = has
      ? player.membership_types.filter(t => t !== area)
      : [...player.membership_types, area].sort();

    setSaving(player.id + area);
    const { error } = await supabase.rpc('admin_set_membership_types', {
      p_society_id: societyId,
      p_player_id:  player.id,
      p_types:      newTypes,
    });
    setSaving(null);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setPlayers(prev => prev.map(p =>
      p.id === player.id ? { ...p, membership_types: newTypes } : p
    ));
  }

  const filtered = useMemo(() =>
    players.filter(p => p.display_name.toLowerCase().includes(search.toLowerCase())),
    [players, search]
  );

  if (loading || societyLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top:10,bottom:10,left:10,right:10 }}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Player Access</Text>
        <View style={{ width: 48 }} />
      </View>

      <View style={styles.searchBar}>
        <Text style={{ fontSize: 14, color: colors.textMuted }}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search players…"
          placeholderTextColor={colors.textMuted}
          autoCorrect={false}
        />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.count}>{filtered.length} player{filtered.length !== 1 ? 's' : ''}</Text>

        {filtered.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No players found</Text>
          </View>
        )}

        {filtered.map(player => (
          <View key={player.id} style={styles.playerCard}>
            <Text style={styles.playerName}>{player.display_name}</Text>
            {player.handicap_index != null && (
              <Text style={styles.playerHcp}>HCP {player.handicap_index}</Text>
            )}
            <View style={styles.chips}>
              {AREAS.map(area => {
                const on = player.membership_types.includes(area.key);
                const busy = saving === player.id + area.key;
                return (
                  <TouchableOpacity
                    key={area.key}
                    style={[styles.chip, on && styles.chipOn, on && { backgroundColor: area.color + '22', borderColor: area.color }]}
                    onPress={() => toggleArea(player, area.key)}
                    disabled={!!saving}
                    activeOpacity={0.7}
                  >
                    {busy
                      ? <ActivityIndicator size="small" color={on ? area.color : colors.textMuted} style={{ width: 40 }} />
                      : <Text style={[styles.chipText, on && { color: area.color }]}>{on ? '✓ ' : ''}{area.label}</Text>
                    }
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
