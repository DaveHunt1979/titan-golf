import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { ResizeMode, Video } from 'expo-av';
import { supabase } from '../../../../src/lib/supabase';
import { useDynamicColors } from '../../../../src/lib/SocietyThemeContext';
import { goBack } from '../../../../src/lib/navigation';

const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';

const SHOT_LABEL: Record<string, string> = {
  driver: 'Driver', fairway_wood: 'Fairway Wood', hybrid: 'Hybrid', iron: 'Iron',
  wedge: 'Wedge', pitch: 'Pitch', chip: 'Chip', bunker: 'Bunker', putting: 'Putting', other: 'Other',
};
const ANGLE_LABEL: Record<string, string> = { down_the_line: 'Down The Line', face_on: 'Face On' };
const STATUS_LABEL: Record<string, string> = {
  submitted: 'Submitted', awaiting_review: 'Awaiting Review', reviewing: 'Coach Reviewing',
  feedback_ready: 'Feedback Ready', completed: 'Completed',
};
const DRILL_AREAS = ['driver', 'iron', 'short_game', 'putting', 'bunker', 'general'] as const;
const DRILL_AREA_LABEL: Record<string, string> = {
  driver: 'Driver', iron: 'Iron', short_game: 'Short Game', putting: 'Putting', bunker: 'Bunker', general: 'General',
};

interface SubmissionVideo { id: string; camera_angle: string | null; storage_path: string; signedUrl?: string; }
interface Submission {
  id: string; relationship_id: string; player_id: string; shot_type: string; camera_angle: string | null;
  player_note: string | null; status: string; created_at: string; coach_id: string; player: { display_name: string } | null;
}
interface Lesson { id: string; coach_feedback_text: string | null; created_at: string; }
interface LibraryVideo { id: string; title: string; area: string | null; }

export default function SubmissionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const dc = useDynamicColors();
  const s = makeStyles(dc);
  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [loading, setLoading] = useState(true);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [videos, setVideos] = useState<SubmissionVideo[]>([]);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [feedbackText, setFeedbackText] = useState('');
  const [assignDrill, setAssignDrill] = useState(false);
  const [drillName, setDrillName] = useState('');
  const [drillArea, setDrillArea] = useState<string | null>(null);
  const [drillPurpose, setDrillPurpose] = useState('');
  const [drillInstructions, setDrillInstructions] = useState('');
  const [drillReps, setDrillReps] = useState('');
  const [drillFrequency, setDrillFrequency] = useState('');
  const [libraryVideos, setLibraryVideos] = useState<LibraryVideo[]>([]);
  const [selectedLibraryVideo, setSelectedLibraryVideo] = useState<string | null>(null);
  const [sendError, setSendError] = useState('');

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: me } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
    if (me) setMyId(me.id);

    const { data: sub } = await supabase
      .from('coaching_submissions')
      .select('id, relationship_id, player_id, shot_type, camera_angle, player_note, status, created_at, coach_id, player:player_id(display_name)')
      .eq('id', id).maybeSingle();
    setSubmission(sub as unknown as Submission | null);

    const { data: vids } = await supabase
      .from('coaching_videos').select('id, camera_angle, storage_path')
      .eq('submission_id', id);
    const withUrls = await Promise.all((vids ?? []).map(async v => {
      const { data: signed } = await supabase.storage.from('coaching-videos').createSignedUrl(v.storage_path, 3600);
      return { ...v, signedUrl: signed?.signedUrl };
    }));
    setVideos(withUrls);

    const { data: lessonRow } = await supabase
      .from('coaching_lessons').select('id, coach_feedback_text, created_at')
      .eq('submission_id', id).maybeSingle();
    setLesson(lessonRow as Lesson | null);

    if (me && sub && (sub as any).coach_id === me.id) {
      const { data: libRows } = await supabase
        .from('coach_video_library').select('id, title, area')
        .eq('coach_id', me.id).order('created_at', { ascending: false });
      setLibraryVideos((libRows ?? []) as LibraryVideo[]);
    }

    setLoading(false);
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function startReview() {
    if (!submission) return;
    setBusy(true);
    await supabase.from('coaching_submissions').update({ status: 'reviewing' }).eq('id', submission.id);
    setBusy(false);
    load();
  }

  async function sendFeedback() {
    if (!submission || !feedbackText.trim()) return;
    setSendError('');
    setBusy(true);
    try {
      const { data: newLesson, error: lessonError } = await supabase
        .from('coaching_lessons')
        .insert({
          relationship_id: submission.relationship_id,
          submission_id: submission.id,
          player_id: submission.player_id,
          coach_id: submission.coach_id,
          shot_type: submission.shot_type,
          coach_feedback_text: feedbackText.trim(),
        })
        .select().single();
      if (lessonError) throw lessonError;

      if (assignDrill && drillName.trim()) {
        const { error: drillError } = await supabase.from('coaching_drills').insert({
          relationship_id: submission.relationship_id,
          lesson_id: newLesson.id,
          player_id: submission.player_id,
          coach_id: submission.coach_id,
          name: drillName.trim(),
          area: drillArea,
          purpose: drillPurpose.trim() || null,
          instructions: drillInstructions.trim() || null,
          repetitions: drillReps.trim() ? parseInt(drillReps.trim(), 10) : null,
          frequency: drillFrequency.trim() || null,
          library_video_id: selectedLibraryVideo,
        });
        if (drillError) throw drillError;
      }

      const { error: statusError } = await supabase
        .from('coaching_submissions').update({ status: 'feedback_ready' }).eq('id', submission.id);
      if (statusError) throw statusError;

      load();
    } catch (e: any) {
      setSendError(e.message ?? 'Could not send feedback.');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !fontsLoaded) {
    return (
      <View style={[s.container, s.centered, { backgroundColor: dc.bg }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={dc.gold} size="large" />
      </View>
    );
  }

  if (!submission) {
    return (
      <View style={[s.container, s.centered, { backgroundColor: dc.bg }]}>
        <StatusBar style="light" />
        <Text style={{ color: dc.cardText, fontFamily: FFB }}>Submission not found.</Text>
      </View>
    );
  }

  const isMine = submission.coach_id === myId;

  return (
    <KeyboardAvoidingView style={[s.container, { backgroundColor: dc.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      <View style={[s.header, { borderBottomColor: dc.border }]}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/coach')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={[s.back, { color: dc.gold }]}>← Coach</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: dc.cardText }]}>SWING REVIEW</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={[s.metaCard, { backgroundColor: dc.card, borderColor: dc.border }]}>
          <Text style={[s.playerName, { color: dc.cardText }]}>{submission.player?.display_name ?? 'Player'}</Text>
          <Text style={[s.metaLine, { color: dc.textSecondary }]}>
            {SHOT_LABEL[submission.shot_type] ?? submission.shot_type}
            {submission.camera_angle ? `  ·  ${submission.camera_angle === 'both' ? 'Both Angles' : ANGLE_LABEL[submission.camera_angle]}` : ''}
          </Text>
          <View style={[s.statusPill, { backgroundColor: dc.goldDim }]}>
            <Text style={[s.statusText, { color: dc.gold }]}>{STATUS_LABEL[submission.status] ?? submission.status}</Text>
          </View>
        </View>

        {!!submission.player_note && (
          <View style={[s.noteCard, { backgroundColor: dc.card, borderColor: dc.border }]}>
            <Text style={[s.noteLabel, { color: dc.textSecondary }]}>PLAYER NOTE</Text>
            <Text style={[s.noteText, { color: dc.cardText }]}>{submission.player_note}</Text>
          </View>
        )}

        {videos.map(v => (
          <View key={v.id} style={[s.videoCard, { borderColor: dc.border, backgroundColor: dc.card }]}>
            <Text style={[s.videoLabel, { color: dc.textSecondary }]}>{v.camera_angle ? ANGLE_LABEL[v.camera_angle] : 'Video'}</Text>
            {v.signedUrl
              ? <Video source={{ uri: v.signedUrl }} style={s.videoPreview} useNativeControls resizeMode={ResizeMode.CONTAIN} isLooping={false} />
              : <Text style={{ color: dc.textMuted, fontFamily: FF }}>Video unavailable</Text>
            }
          </View>
        ))}

        {lesson?.coach_feedback_text && (
          <View style={[s.noteCard, { backgroundColor: dc.goldDim, borderColor: dc.border }]}>
            <Text style={[s.noteLabel, { color: dc.gold }]}>COACH FEEDBACK</Text>
            <Text style={[s.noteText, { color: dc.cardText }]}>{lesson.coach_feedback_text}</Text>
          </View>
        )}

        {isMine && (submission.status === 'submitted' || submission.status === 'awaiting_review') && (
          <TouchableOpacity style={[s.primaryBtn, { backgroundColor: dc.gold }, busy && { opacity: 0.5 }]} onPress={startReview} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color="#000" /> : <Text style={s.primaryBtnText}>Start Review</Text>}
          </TouchableOpacity>
        )}

        {isMine && submission.status === 'reviewing' && !lesson && (
          <View style={[s.feedbackCard, { backgroundColor: dc.card, borderColor: dc.border }]}>
            <Text style={[s.noteLabel, { color: dc.textSecondary }]}>SEND FEEDBACK</Text>
            <TextInput
              style={[s.textarea, { backgroundColor: dc.bg, borderColor: dc.border, color: dc.cardText }]}
              value={feedbackText} onChangeText={setFeedbackText}
              placeholder="Watch your club here…" placeholderTextColor={dc.textMuted}
              multiline
            />

            <TouchableOpacity style={s.toggleRow} onPress={() => setAssignDrill(v => !v)} activeOpacity={0.7}>
              <View style={[s.checkbox, { borderColor: dc.gold }, assignDrill && { backgroundColor: dc.gold }]} />
              <Text style={[s.toggleText, { color: dc.cardText }]}>Also assign a drill</Text>
            </TouchableOpacity>

            {assignDrill && (
              <View style={s.drillForm}>
                <TextInput
                  style={[s.input, { backgroundColor: dc.bg, borderColor: dc.border, color: dc.cardText }]}
                  value={drillName} onChangeText={setDrillName}
                  placeholder="Drill name, e.g. Split Grip Drill" placeholderTextColor={dc.textMuted}
                />
                <View style={s.chipWrap}>
                  {DRILL_AREAS.map(area => (
                    <TouchableOpacity
                      key={area}
                      style={[s.chip, { borderColor: dc.border }, drillArea === area && { backgroundColor: dc.gold, borderColor: dc.gold }]}
                      onPress={() => setDrillArea(area)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.chipText, { color: drillArea === area ? '#000' : dc.cardText }]}>{DRILL_AREA_LABEL[area]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={[s.input, { backgroundColor: dc.bg, borderColor: dc.border, color: dc.cardText }]}
                  value={drillPurpose} onChangeText={setDrillPurpose}
                  placeholder="Purpose, e.g. Stop the club moving too far inside" placeholderTextColor={dc.textMuted}
                />
                <TextInput
                  style={[s.textareaSmall, { backgroundColor: dc.bg, borderColor: dc.border, color: dc.cardText }]}
                  value={drillInstructions} onChangeText={setDrillInstructions}
                  placeholder="Instructions" placeholderTextColor={dc.textMuted}
                  multiline
                />
                <View style={s.row2}>
                  <TextInput
                    style={[s.input, { flex: 1, backgroundColor: dc.bg, borderColor: dc.border, color: dc.cardText }]}
                    value={drillReps} onChangeText={setDrillReps}
                    placeholder="Reps, e.g. 20" placeholderTextColor={dc.textMuted}
                    keyboardType="number-pad"
                  />
                  <TextInput
                    style={[s.input, { flex: 1, backgroundColor: dc.bg, borderColor: dc.border, color: dc.cardText }]}
                    value={drillFrequency} onChangeText={setDrillFrequency}
                    placeholder="Frequency, e.g. 3x/week" placeholderTextColor={dc.textMuted}
                  />
                </View>

                {libraryVideos.length > 0 && (
                  <>
                    <Text style={[s.noteLabel, { color: dc.textSecondary, marginTop: 4 }]}>INSTRUCTION VIDEO (OPTIONAL)</Text>
                    <View style={s.chipWrap}>
                      {libraryVideos.map(v => (
                        <TouchableOpacity
                          key={v.id}
                          style={[s.chip, { borderColor: dc.border }, selectedLibraryVideo === v.id && { backgroundColor: dc.gold, borderColor: dc.gold }]}
                          onPress={() => setSelectedLibraryVideo(prev => prev === v.id ? null : v.id)}
                          activeOpacity={0.8}
                        >
                          <Text style={[s.chipText, { color: selectedLibraryVideo === v.id ? '#000' : dc.cardText }]}>{v.title}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}
              </View>
            )}

            {!!sendError && <Text style={s.errorText}>{sendError}</Text>}
            <TouchableOpacity
              style={[s.primaryBtn, { backgroundColor: dc.gold }, (!feedbackText.trim() || busy) && { opacity: 0.4 }]}
              onPress={sendFeedback}
              disabled={!feedbackText.trim() || busy}
              activeOpacity={0.85}
            >
              {busy ? <ActivityIndicator color="#000" /> : <Text style={s.primaryBtnText}>Send Feedback</Text>}
            </TouchableOpacity>
          </View>
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
    playerName: { fontFamily: FFB, fontSize: 17 },
    metaLine: { fontFamily: FFB, fontSize: 13 },
    statusPill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginTop: 4 },
    statusText: { fontFamily: FFB, fontSize: 11, letterSpacing: 0.5 },

    noteCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 14 },
    noteLabel: { fontFamily: FFB, fontSize: 10.5, letterSpacing: 1, marginBottom: 6 },
    noteText: { fontFamily: FF, fontSize: 14, lineHeight: 20 },

    videoCard: { borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 14 },
    videoLabel: { fontFamily: FFB, fontSize: 11, letterSpacing: 1, marginBottom: 8 },
    videoPreview: { width: '100%', aspectRatio: 9 / 16, borderRadius: 10, backgroundColor: '#000' },

    primaryBtn: { borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 6 },
    primaryBtnText: { fontFamily: FFB, fontSize: 14, color: '#000' },

    feedbackCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginTop: 6 },
    textarea: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: FF, fontSize: 14, minHeight: 80, textAlignVertical: 'top', marginBottom: 4 },
    textareaSmall: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: FF, fontSize: 13, minHeight: 60, textAlignVertical: 'top', marginBottom: 10 },
    input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontFamily: FF, fontSize: 13, marginBottom: 10 },
    row2: { flexDirection: 'row', gap: 10 },

    toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
    checkbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5 },
    toggleText: { fontFamily: FFB, fontSize: 13 },

    drillForm: { marginBottom: 4 },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
    chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    chipText: { fontFamily: FFB, fontSize: 11.5 },

    errorText: { color: '#f87171', fontFamily: FFB, fontSize: 12, textAlign: 'center', marginBottom: 6 },
  });
}
