import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Image } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { titanLogo, resolveAvatar } from '../../../src/lib/assets';

type FoundPlayer = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  handicap_index: number | null;
  t_tag: string | null;
};

// Reached via a titangolf://add/<TAG> link shared from another player's
// Profile ("Share My T-Tag") — same lookup + insert the "Enter T-Tag" flow
// in profile/library.tsx uses, just landed on directly instead of typed in.
export default function AddByTagScreen() {
  const { tag } = useLocalSearchParams<{ tag: string }>();
  const router = useRouter();
  const dc = useDynamicColors();
  const s = makeStyles(dc);
  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [found,   setFound]   = useState<FoundPlayer | null>(null);
  const [saving,  setSaving]  = useState(false);
  const [added,   setAdded]   = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: player } = await supabase
        .from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (player) setOwnerId((player as any).id);

      const { data, error } = await supabase.rpc('find_player_by_ttag', { p_tag: tag ?? '' });
      if (error) Alert.alert('Error', error.message);
      const row = Array.isArray(data) ? data[0] : data;
      setFound(row ?? null);
      setLoading(false);
    })();
  }, [tag]);

  async function addToLibrary() {
    if (!found || !ownerId) return;
    setSaving(true);
    const { error } = await supabase.from('player_library').insert({
      owner_player_id: ownerId,
      member_player_id: found.id,
      is_guest: false,
    } as any);
    setSaving(false);
    if (error && (error as any).code !== '23505') { Alert.alert('Error', error.message); return; }
    setAdded(true);
  }

  function done() { router.replace('/(app)/' as any); }

  const isSelf = !!found && !!ownerId && found.id === ownerId;

  return (
    <View style={[s.container, s.centered]}>
      <StatusBar style="light" />

      <Image source={titanLogo} style={s.logo} resizeMode="contain" />

      {(loading || !fontsLoaded) ? (
        <ActivityIndicator color={dc.gold} size="large" style={{ marginTop: 24 }} />
      ) : !ownerId ? (
        <>
          <Text style={s.title}>Sign in to add this player</Text>
          <TouchableOpacity style={[s.btn, { backgroundColor: dc.gold }]} onPress={() => router.replace('/(auth)' as any)} activeOpacity={0.85}>
            <Text style={s.btnText}>Go to Sign In</Text>
          </TouchableOpacity>
        </>
      ) : !found ? (
        <>
          <Text style={s.title}>Player not found</Text>
          <Text style={s.sub}>No Titan account with tag @{(tag ?? '').toUpperCase()}.</Text>
          <TouchableOpacity style={s.skipBtn} onPress={done} activeOpacity={0.7}>
            <Text style={s.skipBtnText}>Back to Titan</Text>
          </TouchableOpacity>
        </>
      ) : isSelf ? (
        <>
          <Text style={s.title}>That's you!</Text>
          <Text style={s.sub}>You can't add yourself to your own Player Library.</Text>
          <TouchableOpacity style={s.skipBtn} onPress={done} activeOpacity={0.7}>
            <Text style={s.skipBtnText}>Back to Titan</Text>
          </TouchableOpacity>
        </>
      ) : added ? (
        <>
          <Text style={s.title}>Added ✓</Text>
          <Text style={s.sub}>{found.display_name} is in your Player Library.</Text>
          <TouchableOpacity style={[s.btn, { backgroundColor: dc.gold }]} onPress={() => router.replace('/(app)/profile/library' as any)} activeOpacity={0.85}>
            <Text style={s.btnText}>View My Library</Text>
          </TouchableOpacity>
        </>
      ) : (
        <View style={s.card}>
          {resolveAvatar(found.id, found.avatar_url)
            ? <Image source={resolveAvatar(found.id, found.avatar_url)!} style={s.avatarImg} />
            : (
              <View style={[s.avatarPlaceholder, { backgroundColor: `${dc.gold}18` }]}>
                <Text style={[s.avatarInitial, { color: dc.gold }]}>{found.display_name.charAt(0).toUpperCase()}</Text>
              </View>
            )
          }
          <Text style={s.foundName}>{found.display_name}</Text>
          <Text style={s.foundMeta}>
            @{found.t_tag}{found.handicap_index != null ? `  ·  HCP ${found.handicap_index}` : ''}
          </Text>
          <TouchableOpacity
            style={[s.btn, { backgroundColor: dc.gold }, saving && { opacity: 0.5 }]}
            onPress={addToLibrary}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? <ActivityIndicator color="#000" /> : <Text style={s.btnText}>Add to My Player Library</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.skipBtn} onPress={done} activeOpacity={0.7}>
            <Text style={s.skipBtnText}>Not now</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function makeStyles(c: ReturnType<typeof useDynamicColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg, padding: 24 },
    centered:  { alignItems: 'center', justifyContent: 'center' },
    logo:      { width: 100, height: 32, marginBottom: 32 },

    title: { fontSize: 18, fontFamily: 'JUSTSans-ExBold', color: c.white, textAlign: 'center', marginBottom: 8 },
    sub:   { fontSize: 13, fontFamily: 'JUSTSans-ExBold', color: c.textMuted, textAlign: 'center', lineHeight: 19, marginBottom: 24 },

    card: {
      alignItems: 'center', alignSelf: 'stretch',
      backgroundColor: c.card, borderRadius: 16,
      borderWidth: 1, borderColor: c.border, padding: 24,
    },
    avatarImg: { width: 76, height: 76, borderRadius: 38, marginBottom: 14 },
    avatarPlaceholder: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
    avatarInitial: { fontSize: 28, fontFamily: 'JUSTSans-ExBold' },
    foundName: { fontSize: 18, fontFamily: 'JUSTSans-ExBold', color: c.white },
    foundMeta: { fontSize: 13, fontFamily: 'JUSTSans-ExBold', color: c.textMuted, marginTop: 4, marginBottom: 20 },

    btn: { alignSelf: 'stretch', borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
    btnText: { fontSize: 14, fontFamily: 'JUSTSans-ExBold', color: '#000' },
    skipBtn: { paddingVertical: 14, alignItems: 'center' },
    skipBtnText: { fontSize: 13, fontFamily: 'JUSTSans-ExBold', color: c.textMuted },
  });
}
