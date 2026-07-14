import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, TextInput, Alert, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';

// ── TITAN constants ───────────────────────────────────────────
const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const RED    = '#f87171';
const PURPLE = '#a78bfa';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

interface Player {
  id: string;
  display_name: string;
  handicap_index: number | null;
  membership_types: string[];
}

const AREAS = [
  { key: 'casual',  label: 'Casual',  color: GREEN  },
  { key: 'tour',    label: 'Tour',    color: GOLD   },
  { key: 'swindle', label: 'Swindle', color: PURPLE },
] as const;

export default function MembershipScreen() {
  const router = useRouter();
  const { societyId, loading: societyLoading } = useAdminSociety();

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [saving, setSaving]   = useState<string | null>(null);

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

  if (loading || societyLoading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.headerSide}
        >
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Image source={titanLogo} style={styles.logo} resizeMode="contain" />
          <Text style={styles.headerTitle}>Player Access</Text>
          <Text style={styles.headerSub}>Membership tiers</Text>
        </View>
        <View style={styles.headerSide} />
      </View>

      {/* Search bar */}
      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search players…"
          placeholderTextColor="#444"
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
                const on   = player.membership_types.includes(area.key);
                const busy = saving === player.id + area.key;
                return (
                  <TouchableOpacity
                    key={area.key}
                    style={[
                      styles.chip,
                      on
                        ? { backgroundColor: area.color + '22', borderColor: area.color }
                        : { backgroundColor: '#333', borderColor: '#333' },
                    ]}
                    onPress={() => toggleArea(player, area.key)}
                    disabled={!!saving}
                    activeOpacity={0.7}
                  >
                    {busy
                      ? <ActivityIndicator size="small" color={on ? area.color : '#666'} style={{ width: 48 }} />
                      : <Text style={[styles.chipText, { color: on ? area.color : '#888' }]}>
                          {on ? '✓ ' : ''}{area.label}
                        </Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  headerSide:   { width: 72 },
  back:         { fontSize: 15, fontFamily: FFB, color: GOLD },
  headerCenter: { flex: 1, alignItems: 'center', gap: 2 },
  logo:         { width: 24, height: 24, marginBottom: 2 },
  headerTitle:  { fontSize: 15, fontFamily: FFB, color: '#fff' },
  headerSub:    { fontSize: 9, fontFamily: FF, color: '#555' },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingHorizontal: 14, paddingVertical: 10,
    margin: 16, marginBottom: 0,
  },
  searchIcon:  { fontSize: 14, color: '#555' },
  searchInput: { flex: 1, fontSize: 13, fontFamily: FF, color: '#fff', padding: 0 },

  scroll:  { padding: 16, paddingBottom: 48 },
  count:   { fontSize: 11, fontFamily: FF, color: '#555', marginBottom: 12, textAlign: 'center' },

  empty:     { alignItems: 'center', paddingVertical: 48 },
  emptyText: { fontSize: 15, fontFamily: FF, color: '#555', textAlign: 'center' },

  playerCard: {
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1c1c1c',
    padding: 14, marginBottom: 10,
  },
  playerName: { fontSize: 15, fontFamily: FFB, color: '#fff', marginBottom: 2 },
  playerHcp:  { fontSize: 11, fontFamily: FF, color: '#555', marginBottom: 10 },

  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 99, borderWidth: 1.5,
  },
  chipText: { fontSize: 11, fontFamily: FFB, letterSpacing: 0.5 },
});
