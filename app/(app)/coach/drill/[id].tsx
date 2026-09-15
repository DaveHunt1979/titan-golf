import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import VideoPreview from '../../../../src/components/VideoPreview';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../src/lib/supabase';
import { useDynamicColors } from '../../../../src/lib/SocietyThemeContext';
import { goBack } from '../../../../src/lib/navigation';

const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';

const AREA_LABEL: Record<string, string> = {
  driver: 'Driver', iron: 'Iron', short_game: 'Short Game', putting: 'Putting', bunker: 'Bunker', general: 'General',
};
const DRILL_STATUS_LABEL: Record<string, string> = {
  not_started: 'Not Started', in_progress: 'In Progress', progress_sent: 'Progress Sent', completed: 'Completed',
};
const COACH_STATUS = [
  { key: 'improving', label: 'Improving' }, { key: 'continue', label: 'Continue' },
  { key: 'needs_adjustment', label: 'Needs Adjustment' }, { key: 'completed', label: 'Completed' },
] as const;
const COACH_STATUS_LABEL: Record<string, string> = Object.fromEntries(COACH_STATUS.map(c => [c.key, c.label]));

interface Drill {
  id: string; relationship_id: string; player_id: string; coach_id: string; name: string;
  area: string | null; purpose: string | null; instructions: string | null;
  repetitions: number | null; frequency: string | null; review_date: string | null; status: string;
  library_video_id: string | null;
}
interface LibraryVideo { id: string; title: string; signedUrl?: string; }
interface ProgressVideo { id: string; storage_path: string; signedUrl?: string; }
interface Progress {
  id: string; player_note: string | null; coach_status: string | null; coach_feedback_text: string | null;
  reviewed_at: string | null; created_at: string; videos: ProgressVideo[];
}

export default function DrillDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const dc = useDynamicColors();
  const s = makeStyles(dc);
  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [loading, setLoading] = useState(true);
  const [myId, setMyId] = useState<string | null>(null);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [libraryVideo, setLibraryVideo] = useState<LibraryVideo | null>(null);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [busy, setBusy] = useState(false);

  const [capturing, setCapturing] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [progressNote, setProgressNote] = useState('');
  const [captureError, setCaptureError] = useState('');

  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<string | null>(null);
  const [reviewText, setReviewText] = useState('');

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: me } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
    if (me) setMyId(me.id);

    const { data: d } = await supabase.from('coaching_drills').select('*').eq('id', id).maybeSingle();
    setDrill(d as Drill | null);

    if (d?.library_video_id) {
      const { data: lib } = await supabase
        .from('coach_video_library').select('id, title, storage_path').eq('id', d.library_video_id).maybeSingle();
      if (lib) {
        const { data: signed } = await supabase.storage.from('coaching-videos').createSignedUrl(lib.storage_path, 3600);
        setLibraryVideo({ id: lib.id, title: lib.title, signedUrl: signed?.signedUrl });
      }
    } else {
      setLibraryVideo(null);
    }

    const { data: progRows } = await supabase
      .from('drill_progress').select('*').eq('drill_id', id).order('created_at', { ascending: false });
    const withVideos = await Promise.all((progRows ?? []).map(async p => {
      const { data: vids } = await supabase.from('coaching_videos').select('id, storage_path').eq('drill_progress_id', p.id);
      const signed = await Promise.all((vids ?? []).map(async v => {
        const { data } = await supabase.storage.from('coaching-videos').createSignedUrl(v.storage_path, 3600);
        return { ...v, signedUrl: data?.signedUrl };
      }));
      return { ...p, videos: signed };
    }));
    setProgress(withVideos as Progress[]);
    setLoading(false);
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function captureVideo(fromLibrary: boolean) {
    setCaptureError('');
    const perm = fromLibrary
      ? await ImagePicker.requestMediaLibraryPermissionsAsync()
      : await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== 'granted') { setCaptureError('Permission needed to continue.'); return; }
    const result = fromLibrary
      ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 0.7 })
      : await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], quality: 0.7, videoMaxDuration: 30 });
    if (result.canceled || !result.assets[0]) return;
    setVideoUri(result.assets[0].uri);
  }

  async function sendProgress() {
    if (!drill || !videoUri) return;
    setBusy(true);
    setCaptureError('');
    try {
      const base64 = await FileSystem.readAsStringAsync(videoUri, { encoding: FileSystem.EncodingType.Base64 });
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-progress.mov`;
      const path = `${drill.relationship_id}/${filename}`;
      const { error: uploadError } = await supabase.storage
        .from('coaching-videos').upload(path, bytes, { contentType: 'video/quicktime' });
      if (uploadError) throw uploadError;

      const { data: progressRow, error: progressError } = await supabase
        .from('drill_progress')
        .insert({
          drill_id: drill.id, relationship_id: drill.relationship_id,
          player_id: drill.player_id, coach_id: drill.coach_id,
          player_note: progressNote.trim() || null,
        })
        .select().single();
      if (progressError) throw progressError;

      const { error: videoError } = await supabase.from('coaching_videos').insert({
        relationship_id: drill.relationship_id,
        uploader_id: drill.player_id,
        player_id: drill.player_id,
        coach_id: drill.coach_id,
        drill_progress_id: progressRow.id,
        video_type: 'progress',
        storage_path: path,
      });
      if (videoError) throw videoError;

      await supabase.from('coaching_drills').update({ status: 'progress_sent' }).eq('id', drill.id);

      setCapturing(false); setVideoUri(null); setProgressNote('');
      load();
    } catch (e: any) {
      setCaptureError(e.message ?? 'Could not send progress video.');
    } finally {
      setBusy(false);
    }
  }

  async function saveReview(progressId: string) {
    if (!drill || !reviewStatus) return;
    setBusy(true);
    await supabase.from('drill_progress').update({
      coach_status: reviewStatus, coach_feedback_text: reviewText.trim() || null, reviewed_at: new Date().toISOString(),
    }).eq('id', progressId);
    await supabase.from('coaching_drills')
      .update({ status: reviewStatus === 'completed' ? 'completed' : 'in_progress' })
      .eq('id', drill.id);
    setReviewingId(null); setReviewStatus(null); setReviewText('');
    setBusy(false);
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

  if (!drill) {
    return (
      <View style={[s.container, s.centered, { backgroundColor: dc.bg }]}>
        <StatusBar style="light" />
        <Text style={{ color: dc.cardText, fontFamily: FFB }}>Drill not found.</Text>
      </View>
    );
  }

  const isCoach = drill.coach_id === myId;

  return (
    <KeyboardAvoidingView style={[s.container, { backgroundColor: dc.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      <View style={[s.header, { borderBottomColor: dc.border }]}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/coach')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={[s.back, { color: dc.gold }]}>← Coach</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: dc.cardText }]}>DRILL</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={[s.metaCard, { backgroundColor: dc.card, borderColor: dc.border }]}>
          <Text style={[s.drillName, { color: dc.cardText }]}>{drill.name}</Text>
          {!!drill.area && <Text style={[s.metaLine, { color: dc.textSecondary }]}>{AREA_LABEL[drill.area] ?? drill.area}</Text>}
          <View style={[s.statusPill, { backgroundColor: dc.goldDim }]}>
            <Text style={[s.statusText, { color: dc.gold }]}>{DRILL_STATUS_LABEL[drill.status] ?? drill.status}</Text>
          </View>
        </View>

        {!!drill.purpose && (
          <View style={[s.noteCard, { backgroundColor: dc.card, borderColor: dc.border }]}>
            <Text style={[s.noteLabel, { color: dc.textSecondary }]}>PURPOSE</Text>
            <Text style={[s.noteText, { color: dc.cardText }]}>{drill.purpose}</Text>
          </View>
        )}
        {!!drill.instructions && (
          <View style={[s.noteCard, { backgroundColor: dc.card, borderColor: dc.border }]}>
            <Text style={[s.noteLabel, { color: dc.textSecondary }]}>INSTRUCTIONS</Text>
            <Text style={[s.noteText, { color: dc.cardText }]}>{drill.instructions}</Text>
          </View>
        )}
        {(drill.repetitions || drill.frequency) && (
          <View style={[s.noteCard, { backgroundColor: dc.card, borderColor: dc.border }]}>
            <Text style={[s.noteLabel, { color: dc.textSecondary }]}>SCHEDULE</Text>
            <Text style={[s.noteText, { color: dc.cardText }]}>
              {[drill.repetitions ? `${drill.repetitions} reps` : null, drill.frequency].filter(Boolean).join(' · ')}
            </Text>
          </View>
        )}
        {libraryVideo && (
          <View style={[s.noteCard, { backgroundColor: dc.card, borderColor: dc.border }]}>
            <Text style={[s.noteLabel, { color: dc.textSecondary }]}>{libraryVideo.title.toUpperCase()}</Text>
            {libraryVideo.signedUrl && (
              <VideoPreview uri={libraryVideo.signedUrl} style={s.videoPreview} />
            )}
          </View>
        )}

        {!isCoach && !capturing && (
          <TouchableOpacity style={[s.primaryBtn, { backgroundColor: dc.gold }]} onPress={() => setCapturing(true)} activeOpacity={0.85}>
            <Text style={s.primaryBtnText}>Send Progress Video</Text>
          </TouchableOpacity>
        )}

        {!isCoach && capturing && (
          <View style={[s.feedbackCard, { backgroundColor: dc.card, borderColor: dc.border }]}>
            {!videoUri ? (
              <>
                <TouchableOpacity style={[s.primaryBtn, { backgroundColor: dc.gold }]} onPress={() => captureVideo(false)} activeOpacity={0.85}>
                  <Ionicons name="videocam" size={18} color="#000" />
                  <Text style={s.primaryBtnText}>Record Video</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.secondaryBtn, { borderColor: dc.border }]} onPress={() => captureVideo(true)} activeOpacity={0.85}>
                  <Text style={[s.secondaryBtnText, { color: dc.cardText }]}>Upload Video</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <VideoPreview uri={videoUri} style={s.videoPreview} />
                <TextInput
                  style={[s.textareaSmall, { backgroundColor: dc.bg, borderColor: dc.border, color: dc.cardText }]}
                  value={progressNote} onChangeText={setProgressNote}
                  placeholder="Note for your coach (optional)" placeholderTextColor={dc.textMuted}
                  multiline
                />
                {!!captureError && <Text style={s.errorText}>{captureError}</Text>}
                <TouchableOpacity style={[s.primaryBtn, { backgroundColor: dc.gold }, busy && { opacity: 0.5 }]} onPress={sendProgress} disabled={busy} activeOpacity={0.85}>
                  {busy ? <ActivityIndicator color="#000" /> : <Text style={s.primaryBtnText}>Send To Coach</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={s.linkBtn} onPress={() => setVideoUri(null)} activeOpacity={0.7}>
                  <Text style={[s.linkBtnText, { color: '#f87171' }]}>Retake</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {progress.length > 0 && (
          <>
            <Text style={[s.sectionLabel, { color: dc.textSecondary }]}>PROGRESS</Text>
            {progress.map(p => (
              <View key={p.id} style={[s.progressCard, { backgroundColor: dc.card, borderColor: dc.border }]}>
                <Text style={[s.metaLine, { color: dc.textMuted }]}>{new Date(p.created_at).toLocaleDateString()}</Text>
                {p.videos.map(v => v.signedUrl && (
                  <VideoPreview key={v.id} uri={v.signedUrl} style={s.videoPreview} />
                ))}
                {!!p.player_note && <Text style={[s.noteText, { color: dc.cardText, marginTop: 8 }]}>{p.player_note}</Text>}

                {p.coach_status ? (
                  <View style={[s.statusPill, { backgroundColor: dc.goldDim, alignSelf: 'flex-start', marginTop: 10 }]}>
                    <Text style={[s.statusText, { color: dc.gold }]}>{COACH_STATUS_LABEL[p.coach_status] ?? p.coach_status}</Text>
                  </View>
                ) : isCoach ? (
                  reviewingId === p.id ? (
                    <View style={{ marginTop: 10 }}>
                      <View style={s.chipWrap}>
                        {COACH_STATUS.map(c => (
                          <TouchableOpacity
                            key={c.key}
                            style={[s.chip, { borderColor: dc.border }, reviewStatus === c.key && { backgroundColor: dc.gold, borderColor: dc.gold }]}
                            onPress={() => setReviewStatus(c.key)}
                            activeOpacity={0.8}
                          >
                            <Text style={[s.chipText, { color: reviewStatus === c.key ? '#000' : dc.cardText }]}>{c.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <TextInput
                        style={[s.textareaSmall, { backgroundColor: dc.bg, borderColor: dc.border, color: dc.cardText }]}
                        value={reviewText} onChangeText={setReviewText}
                        placeholder="Feedback (optional)" placeholderTextColor={dc.textMuted}
                        multiline
                      />
                      <TouchableOpacity
                        style={[s.primaryBtn, { backgroundColor: dc.gold }, (!reviewStatus || busy) && { opacity: 0.4 }]}
                        onPress={() => saveReview(p.id)}
                        disabled={!reviewStatus || busy}
                        activeOpacity={0.85}
                      >
                        {busy ? <ActivityIndicator color="#000" /> : <Text style={s.primaryBtnText}>Save Review</Text>}
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={s.linkBtn} onPress={() => { setReviewingId(p.id); setReviewStatus(null); setReviewText(''); }} activeOpacity={0.7}>
                      <Text style={[s.linkBtnText, { color: dc.gold }]}>Review Progress</Text>
                    </TouchableOpacity>
                  )
                ) : null}

                {!!p.coach_feedback_text && (
                  <Text style={[s.noteText, { color: dc.cardText, marginTop: 8 }]}>{p.coach_feedback_text}</Text>
                )}
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

    metaCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 14, alignItems: 'center', gap: 6 },
    drillName: { fontFamily: FFB, fontSize: 17, textAlign: 'center' },
    metaLine: { fontFamily: FFB, fontSize: 12 },
    statusPill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginTop: 4 },
    statusText: { fontFamily: FFB, fontSize: 11, letterSpacing: 0.5 },

    noteCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 14 },
    noteLabel: { fontFamily: FFB, fontSize: 10.5, letterSpacing: 1, marginBottom: 6 },
    noteText: { fontFamily: FF, fontSize: 14, lineHeight: 20 },

    primaryBtn: {
      flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
      borderRadius: 12, paddingVertical: 15, marginTop: 6,
    },
    primaryBtnText: { fontFamily: FFB, fontSize: 14, color: '#000' },
    secondaryBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 10 },
    secondaryBtnText: { fontFamily: FFB, fontSize: 14 },
    linkBtn: { paddingVertical: 10, alignItems: 'center', marginTop: 4 },
    linkBtnText: { fontFamily: FFB, fontSize: 13 },

    feedbackCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginTop: 6, marginBottom: 14 },
    videoPreview: { width: '100%', aspectRatio: 9 / 16, borderRadius: 10, backgroundColor: '#000', marginBottom: 10 },
    textareaSmall: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: FF, fontSize: 13, minHeight: 60, textAlignVertical: 'top', marginBottom: 10 },

    errorText: { color: '#f87171', fontFamily: FFB, fontSize: 12, textAlign: 'center', marginBottom: 6 },

    sectionLabel: { fontFamily: FFB, fontSize: 11, letterSpacing: 1, marginTop: 8, marginBottom: 10 },
    progressCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },

    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
    chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    chipText: { fontFamily: FFB, fontSize: 11.5 },
  });
}
