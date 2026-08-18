import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Image } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../src/lib/supabase';
import { useDynamicColors, useSocietyTheme } from '../../src/lib/SocietyThemeContext';
import { titanLogo, getSocietyLogo } from '../../src/lib/assets';

const FFB = 'JUSTSans-ExBold';
const FF  = 'JUSTSans';
const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

interface Membership {
  societyId: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  role: string;
}

export default function SocietiesScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { societyId: activeId, switchSociety } = useSocietyTheme();

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading]         = useState(true);
  const [switching, setSwitching]     = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: player } = await supabase
        .from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (!player) { setLoading(false); return; }

      const { data } = await supabase
        .from('society_members')
        .select('society_id, role, societies(id, name, logo_url, primary_color)')
        .eq('player_id', (player as any).id);

      if (!active) return;
      const rows: Membership[] = ((data as any[]) ?? [])
        .filter(m => m.societies)
        .map(m => ({
          societyId:    m.society_id,
          name:         m.societies.name,
          logoUrl:      m.societies.logo_url,
          primaryColor: m.societies.primary_color ?? '#D4AF37',
          role:         m.role ?? 'member',
        }));
      setMemberships(rows);
      setLoading(false);
    }
    load();
    return () => { active = false; };
  }, []));

  async function handleSwitch(m: Membership) {
    if (m.societyId === activeId || switching) return;
    setSwitching(m.societyId);
    await switchSociety(m.societyId);
    setSwitching(null);
    router.replace('/(app)' as any);
  }

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={HIT}>
          <Text style={[s.back, { color: dc.gold }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: dc.cardText }]}>My Societies</Text>
        <View style={{ width: 50 }} />
      </View>

      <Text style={[s.subtitle, { color: dc.textSecondary }]}>Switch between societies you belong to</Text>

      {loading ? (
        <ActivityIndicator color={dc.gold} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {memberships.map(m => {
            const isActive = m.societyId === activeId;
            return (
              <TouchableOpacity
                key={m.societyId}
                style={[
                  s.card,
                  { backgroundColor: dc.card, borderColor: isActive ? dc.gold : dc.border, borderWidth: isActive ? 2 : 1 },
                ]}
                onPress={() => handleSwitch(m)}
                activeOpacity={0.85}
                disabled={!!switching}
              >
                <Image
                  source={getSocietyLogo(m.name) ?? (m.logoUrl ? { uri: m.logoUrl } : titanLogo)}
                  style={s.logo}
                  resizeMode="contain"
                />
                <View style={{ flex: 1 }}>
                  <Text style={[s.cardName, { color: dc.cardText }]}>{m.name}</Text>
                  <Text style={[s.cardMeta, { color: dc.textSecondary }]}>{m.role.toUpperCase()}</Text>
                </View>
                {switching === m.societyId ? (
                  <ActivityIndicator color={dc.gold} size="small" />
                ) : isActive ? (
                  <View style={[s.activeBadge, { backgroundColor: dc.gold }]}>
                    <Text style={s.activeBadgeText}>ACTIVE</Text>
                  </View>
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={dc.textSecondary} />
                )}
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity
            style={[s.actionBtn, { backgroundColor: dc.card, borderColor: dc.border }]}
            onPress={() => router.push('/(app)/join' as any)}
            activeOpacity={0.85}
          >
            <Ionicons name="key-outline" size={18} color={dc.gold} />
            <Text style={[s.actionBtnText, { color: dc.cardText }]}>Join with a Code</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.actionBtn, { backgroundColor: dc.gold, borderColor: dc.gold }]}
            onPress={() => router.push('/(app)/admin/create-society' as any)}
            activeOpacity={0.85}
          >
            <Ionicons name="add-circle-outline" size={18} color="#000" />
            <Text style={[s.actionBtnText, { color: '#000' }]}>Create a Society</Text>
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 8,
  },
  back:  { fontSize: 14, fontFamily: FFB },
  title: { fontSize: 16, fontFamily: FFB },
  subtitle: { fontSize: 12, fontFamily: FF, paddingHorizontal: 20, marginBottom: 16 },

  scroll: { paddingHorizontal: 20, gap: 12 },
  card: {
    borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  logo: { width: 40, height: 40, borderRadius: 8 },
  cardName: { fontSize: 15, fontFamily: FFB, marginBottom: 4 },
  cardMeta: { fontSize: 11, fontFamily: FFB, letterSpacing: 0.5 },

  activeBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  activeBadgeText: { fontSize: 10, fontFamily: FFB, color: '#000', letterSpacing: 0.5 },

  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1, paddingVertical: 14, marginTop: 4,
  },
  actionBtnText: { fontSize: 14, fontFamily: FFB, letterSpacing: 0.5 },
});
