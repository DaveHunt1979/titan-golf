import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { ResizeMode, Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { goBack } from '../../../src/lib/navigation';

const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';

const AREAS = ['driver', 'iron', 'short_game', 'putting', 'bunker', 'general'] as const;
const AREA_LABEL: Record<string, string> = {
  driver: 'Driver', iron: 'Iron', short_game: 'Short Game', putting: 'Putting', bunker: 'Bunker', general: 'General',
};

interface LibraryVideo { id: string; title: string; area: string | null; storage_path: string; created_at: string; signedUrl?: string; }

export default function CoachLibraryScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const s = makeStyles(dc);
  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [loading, setLoading] = useState(true);
  const [coachId, setCoachId] = useState<string | null>(null);
  const [videos, setVideos] = useState<LibraryVideo[]>([]);

  const [adding, setAdding] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [area, setArea] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: me } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
    if (!me) { setLoading(false); return; }
    setCoachId(me.id);

    const { data: rows } = await supabase
      .from('coach_video_library').select('id, title, area, storage_path, created_at')
      .eq('coach_id', me.id).order('created_at', { ascending: false });
    const withUrls = await Promise.all((rows ?? []).map(async v => {
      const { data: signed } = await supabase.storage.from('coaching-videos').createSignedUrl(v.storage_path, 3600);
      return { ...v, signedUrl: signed?.signedUrl };
    }));
    setVideos(withUrls);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function captureVideo(fromLibrary: boolean) {
    setError('');
    const perm = fromLibrary
      ? await ImagePicker.requestMediaLibraryPermissionsAsync()
      : await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== 'granted') { setError('Permission needed to continue.'); return; }
    const result = fromLibrary
      ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 0.7 })
      : await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], quality: 0.7, videoMaxDuration: 60 });
    if (result.canceled || !result.assets[0]) return;
    setVideoUri(result.assets[0].uri);
  }

  async function save() {
    if (!coachId || !videoUri || !title.trim()) return;
    setBusy(true);
    setError('');
    try {
      const base64 = await FileSystem.readAsStringAsync(videoUri, { encoding: FileSystem.EncodingType.Base64 });
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mov`;
      const path = `library/${coachId}/${filename}`;
      const { error: uploadError } = await supabase.storage
        .from('coaching-videos').upload(path, bytes, { contentType: 'video/quicktime' });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from('coach_video_library').insert({
        coach_id: coachId, title: title.trim(), area, storage_path: path,
      });
      if (insertError) throw insertError;

      setAdding(false); setVideoUri(null); setTitle(''); setArea(null);
      load();
    } catch (e: any) {
      setError(e.message ?? 'Could not save video.');
    } finally {
      setBusy(false);
    }
  }

  async function removeVideo(id: string) {
    await supabase.from('coach_video_library').delete().eq('id', id);
    load();
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
        <Text style={[s.title, { color: dc.cardText }]}>VIDEO LIBRARY</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={[s.intro, { color: dc.textSecondary }]}>
          Build up a reusable set of drill demo videos — attach them to any player's drill instead of re-recording the same thing every time.
        </Text>

        {!adding ? (
          <TouchableOpacity style={[s.primaryBtn, { backgroundColor: dc.gold }]} onPress={() => setAdding(true)} activeOpacity={0.85}>
            <Ionicons name="add" size={18} color="#000" />
            <Text style={s.primaryBtnText}>Add Video</Text>
          </TouchableOpacity>
        ) : (
          <View style={[s.addCard, { backgroundColor: dc.card, borderColor: dc.border }]}>
            {!videoUri ? (
              <>
                <TouchableOpacity style={[s.primaryBtn, { backgroundColor: dc.gold }]} onPress={() => captureVideo(false)} activeOpacity={0.85}>
                  <Ionicons name="videocam" size={18} color="#000" />
                  <Text style={s.primaryBtnText}>Record Video</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.secondaryBtn, { borderColor: dc.border }]} onPress={() => captureVideo(true)} activeOpacity={0.85}>
                  <Text style={[s.secondaryBtnText, { color: dc.cardText }]}>Upload Video</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.linkBtn} onPress={() => setAdding(false)} activeOpacity={0.7}>
                  <Text style={[s.linkBtnText, { color: dc.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Video source={{ uri: videoUri }} style={s.videoPreview} useNativeControls resizeMode={ResizeMode.CONTAIN} isLooping={false} />
                <TextInput
                  style={[s.input, { backgroundColor: dc.bg, borderColor: dc.border, color: dc.cardText }]}
                  value={title} onChangeText={setTitle}
                  placeholder="Title, e.g. Split Grip Drill Demo" placeholderTextColor={dc.textMuted}
                />
                <View style={s.chipWrap}>
                  {AREAS.map(a => (
                    <TouchableOpacity
                      key={a}
                      style={[s.chip, { borderColor: dc.border }, area === a && { backgroundColor: dc.gold, borderColor: dc.gold }]}
                      onPress={() => setArea(a)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.chipText, { color: area === a ? '#000' : dc.cardText }]}>{AREA_LABEL[a]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {!!error && <Text style={s.errorText}>{error}</Text>}
                <TouchableOpacity
                  style={[s.primaryBtn, { backgroundColor: dc.gold }, (!title.trim() || busy) && { opacity: 0.4 }]}
                  onPress={save} disabled={!title.trim() || busy} activeOpacity={0.85}
                >
                  {busy ? <ActivityIndicator color="#000" /> : <Text style={s.primaryBtnText}>Save to Library</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={s.linkBtn} onPress={() => setVideoUri(null)} activeOpacity={0.7}>
                  <Text style={[s.linkBtnText, { color: '#f87171' }]}>Retake</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {videos.length > 0 && (
          <>
            <Text style={[s.sectionLabel, { color: dc.textSecondary }]}>YOUR VIDEOS</Text>
            {videos.map(v => (
              <View key={v.id} style={[s.videoCard, { backgroundColor: dc.card, borderColor: dc.border }]}>
                <View style={s.videoCardTop}>
                  <Text style={[s.videoTitle, { color: dc.cardText }]}>{v.title}</Text>
                  {!!v.area && (
                    <View style={[s.areaPill, { backgroundColor: dc.goldDim }]}>
                      <Text style={[s.areaPillText, { color: dc.gold }]}>{AREA_LABEL[v.area]}</Text>
                    </View>
                  )}
                </View>
                {v.signedUrl && (
                  <Video source={{ uri: v.signedUrl }} style={s.videoPreview} useNativeControls resizeMode={ResizeMode.CONTAIN} isLooping={false} />
                )}
                <TouchableOpacity style={s.linkBtn} onPress={() => removeVideo(v.id)} activeOpacity={0.7}>
                  <Text style={[s.linkBtnText, { color: '#f87171' }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
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
    intro: { fontFamily: FF, fontSize: 13, lineHeight: 19, marginBottom: 16, textAlign: 'center' },

    primaryBtn: {
      flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
      borderRadius: 12, paddingVertical: 15, marginTop: 6,
    },
    primaryBtnText: { fontFamily: FFB, fontSize: 14, color: '#000' },
    secondaryBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 10 },
    secondaryBtnText: { fontFamily: FFB, fontSize: 14 },
    linkBtn: { paddingVertical: 12, alignItems: 'center' },
    linkBtnText: { fontFamily: FFB, fontSize: 13 },

    addCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 20 },
    input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontFamily: FF, fontSize: 14, marginTop: 12, marginBottom: 10 },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
    chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    chipText: { fontFamily: FFB, fontSize: 11.5 },
    errorText: { color: '#f87171', fontFamily: FFB, fontSize: 12, textAlign: 'center', marginBottom: 6 },

    sectionLabel: { fontFamily: FFB, fontSize: 11, letterSpacing: 1, marginBottom: 10 },
    videoCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 14 },
    videoCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    videoTitle: { fontFamily: FFB, fontSize: 14, flex: 1 },
    areaPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    areaPillText: { fontFamily: FFB, fontSize: 10.5 },
    videoPreview: { width: '100%', aspectRatio: 9 / 16, borderRadius: 10, backgroundColor: '#000' },
  });
}
