import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Switch, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { goBack } from '../../../src/lib/navigation';

const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';

const SPECIALISMS = [
  'Beginners', 'Juniors', 'Driving', 'Iron Play', 'Short Game',
  'Putting', 'Bunkers', 'Course Management', 'Elite Golf', 'Senior Golf',
];

export default function CoachRegisterScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const s = makeStyles(dc);
  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);

  const [bio, setBio]                     = useState('');
  const [qualifications, setQualifications] = useState('');
  const [clubLocation, setClubLocation]   = useState('');
  const [online, setOnline]               = useState(true);
  const [inPerson, setInPerson]           = useState(true);
  const [specialisms, setSpecialisms]     = useState<string[]>([]);
  const [contactPref, setContactPref]     = useState('');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: player } = await supabase
        .from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (player) setPlayerId(player.id);

      if (player) {
        const { data: existing } = await supabase
          .from('coach_profiles').select('*').eq('player_id', player.id).maybeSingle();
        if (existing) {
          setBio(existing.bio ?? '');
          setQualifications(existing.qualifications ?? '');
          setClubLocation(existing.club_location ?? '');
          setOnline(existing.online_coaching);
          setInPerson(existing.in_person_coaching);
          setSpecialisms(existing.specialisms ?? []);
          setContactPref(existing.contact_preferences ?? '');
        }
      }
      setLoading(false);
    })();
  }, []);

  function toggleSpecialism(name: string) {
    setSpecialisms(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name]);
  }

  async function save() {
    if (!playerId) return;
    setSaving(true);
    const payload = {
      player_id: playerId,
      bio: bio.trim() || null,
      qualifications: qualifications.trim() || null,
      club_location: clubLocation.trim() || null,
      online_coaching: online,
      in_person_coaching: inPerson,
      specialisms,
      contact_preferences: contactPref.trim() || null,
      is_active: true,
    };
    const { error } = await supabase.from('coach_profiles').upsert(payload as any, { onConflict: 'player_id' });
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    goBack(router, '/(app)/coach');
  }

  if (loading || !fontsLoaded) {
    return (
      <View style={[s.container, s.centered, { backgroundColor: dc.bg }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={dc.gold} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={[s.container, { backgroundColor: dc.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />

      <View style={[s.header, { borderBottomColor: dc.border }]}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/coach')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={[s.back, { color: dc.gold }]}>← Coach</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: dc.cardText }]}>COACH PROFILE</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Field label="Bio" dc={dc}>
          <TextInput
            style={[s.textarea, { backgroundColor: dc.card, borderColor: dc.border, color: dc.cardText }]}
            value={bio} onChangeText={setBio}
            placeholder="A short intro players will see" placeholderTextColor={dc.textMuted}
            multiline
          />
        </Field>

        <Field label="Qualifications" dc={dc}>
          <TextInput
            style={[s.input, { backgroundColor: dc.card, borderColor: dc.border, color: dc.cardText }]}
            value={qualifications} onChangeText={setQualifications}
            placeholder="e.g. PGA Professional" placeholderTextColor={dc.textMuted}
          />
        </Field>

        <Field label="Club / Location" dc={dc}>
          <TextInput
            style={[s.input, { backgroundColor: dc.card, borderColor: dc.border, color: dc.cardText }]}
            value={clubLocation} onChangeText={setClubLocation}
            placeholder="e.g. Titan Golf Club" placeholderTextColor={dc.textMuted}
          />
        </Field>

        <View style={s.switchRow}>
          <Text style={[s.switchLabel, { color: dc.cardText }]}>Online coaching</Text>
          <Switch value={online} onValueChange={setOnline} trackColor={{ true: dc.gold }} />
        </View>
        <View style={s.switchRow}>
          <Text style={[s.switchLabel, { color: dc.cardText }]}>In-person coaching</Text>
          <Switch value={inPerson} onValueChange={setInPerson} trackColor={{ true: dc.gold }} />
        </View>

        <Field label="Specialisms" dc={dc}>
          <View style={s.chipWrap}>
            {SPECIALISMS.map(name => {
              const on = specialisms.includes(name);
              return (
                <TouchableOpacity
                  key={name}
                  style={[s.chip, { borderColor: dc.border }, on && { backgroundColor: dc.gold, borderColor: dc.gold }]}
                  onPress={() => toggleSpecialism(name)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.chipText, { color: on ? '#000' : dc.cardText }]}>{name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Field>

        <Field label="Contact preferences" dc={dc}>
          <TextInput
            style={[s.input, { backgroundColor: dc.card, borderColor: dc.border, color: dc.cardText }]}
            value={contactPref} onChangeText={setContactPref}
            placeholder="e.g. Message me on Titan first" placeholderTextColor={dc.textMuted}
          />
        </Field>

        <TouchableOpacity
          style={[s.saveBtn, { backgroundColor: dc.gold }, saving && { opacity: 0.5 }]}
          onPress={save} disabled={saving} activeOpacity={0.85}
        >
          {saving ? <ActivityIndicator color="#000" /> : <Text style={s.saveBtnText}>Save Coach Profile</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, dc, children }: { label: string; dc: ReturnType<typeof useDynamicColors>; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={{ fontFamily: FFB, fontSize: 11, letterSpacing: 1, color: dc.textSecondary, marginBottom: 8 }}>{label.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function makeStyles(dc: ReturnType<typeof useDynamicColors>) {
  return StyleSheet.create({
    container: { flex: 1 },
    centered: { alignItems: 'center', justifyContent: 'center' },

    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1,
    },
    back: { fontSize: 14, fontFamily: FFB },
    title: { fontSize: 14, fontFamily: FFB, letterSpacing: 0.5 },

    scroll: { padding: 20, paddingBottom: 60 },

    input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontFamily: FF, fontSize: 14 },
    textarea: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontFamily: FF, fontSize: 14, minHeight: 80, textAlignVertical: 'top' },

    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, marginBottom: 6 },
    switchLabel: { fontFamily: FFB, fontSize: 14 },

    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
    chipText: { fontFamily: FFB, fontSize: 12 },

    saveBtn: { borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
    saveBtnText: { fontFamily: FFB, fontSize: 15, color: '#000' },
  });
}
