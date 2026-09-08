import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { ResizeMode, Video } from 'expo-av';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { goBack } from '../../../src/lib/navigation';

const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';

const SHOT_TYPES = [
  { key: 'driver', label: 'Driver' }, { key: 'fairway_wood', label: 'Fairway Wood' },
  { key: 'hybrid', label: 'Hybrid' }, { key: 'iron', label: 'Iron' },
  { key: 'wedge', label: 'Wedge' }, { key: 'pitch', label: 'Pitch' },
  { key: 'chip', label: 'Chip' }, { key: 'bunker', label: 'Bunker' },
  { key: 'putting', label: 'Putting' }, { key: 'other', label: 'Other' },
] as const;

const ANGLES = [
  { key: 'down_the_line', label: 'Down The Line' },
  { key: 'face_on', label: 'Face On' },
  { key: 'both', label: 'Both' },
] as const;

type Step = 'type' | 'angle' | 'capture' | 'review' | 'note' | 'sending' | 'done';
type AngleKey = 'down_the_line' | 'face_on';
const ANGLE_LABEL: Record<AngleKey, string> = { down_the_line: 'Down The Line', face_on: 'Face On' };

export default function SendSwingScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const s = makeStyles(dc);
  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [loading, setLoading] = useState(true);
  const [relationship, setRelationship] = useState<{ id: string; coach_id: string; player_id: string } | null>(null);

  const [step, setStep] = useState<Step>('type');
  const [shotType, setShotType] = useState<string | null>(null);
  const [angleChoice, setAngleChoice] = useState<'down_the_line' | 'face_on' | 'both' | null>(null);
  const [neededAngles, setNeededAngles] = useState<AngleKey[]>([]);
  const [angleIdx, setAngleIdx] = useState(0);
  const [videos, setVideos] = useState<Partial<Record<AngleKey, string>>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: me } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (!me) { setLoading(false); return; }
      const { data: rel } = await supabase
        .from('coaching_relationships').select('id, coach_id, player_id')
        .eq('player_id', me.id).eq('status', 'active').maybeSingle();
      setRelationship(rel as any);
      setLoading(false);
    })();
  }, []);

  function pickShotType(key: string) {
    setShotType(key);
    setStep('angle');
  }

  function pickAngle(key: 'down_the_line' | 'face_on' | 'both') {
    setAngleChoice(key);
    const angles: AngleKey[] = key === 'both' ? ['down_the_line', 'face_on'] : [key];
    setNeededAngles(angles);
    setAngleIdx(0);
    setStep('capture');
  }

  async function captureVideo(angle: AngleKey, fromLibrary: boolean) {
    setError('');
    const perm = fromLibrary
      ? await ImagePicker.requestMediaLibraryPermissionsAsync()
      : await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== 'granted') { setError('Permission needed to continue.'); return; }

    const result = fromLibrary
      ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 0.7 })
      : await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], quality: 0.7, videoMaxDuration: 30 });
    if (result.canceled || !result.assets[0]) return;

    const uri = result.assets[0].uri;
    setVideos(prev => ({ ...prev, [angle]: uri }));
    if (angleIdx < neededAngles.length - 1) setAngleIdx(i => i + 1);
    else setStep('review');
  }

  function retake(angle: AngleKey) {
    setVideos(prev => { const next = { ...prev }; delete next[angle]; return next; });
    setAngleIdx(neededAngles.indexOf(angle));
    setStep('capture');
  }

  async function send() {
    if (!relationship) return;
    setStep('sending');
    setError('');
    try {
      const uploaded: { angle: AngleKey; path: string }[] = [];
      for (const angle of neededAngles) {
        const uri = videos[angle];
        if (!uri) continue;
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${angle}.mov`;
        const path = `${relationship.id}/${filename}`;
        const { error: uploadError } = await supabase.storage
          .from('coaching-videos').upload(path, bytes, { contentType: 'video/quicktime' });
        if (uploadError) throw uploadError;
        uploaded.push({ angle, path });
      }

      const { data: submission, error: subError } = await supabase
        .from('coaching_submissions')
        .insert({
          relationship_id: relationship.id,
          player_id: relationship.player_id,
          coach_id: relationship.coach_id,
          shot_type: shotType,
          camera_angle: angleChoice,
          player_note: note.trim() || null,
          status: 'awaiting_review',
        })
        .select().single();
      if (subError) throw subError;

      for (const u of uploaded) {
        const { error: videoError } = await supabase.from('coaching_videos').insert({
          relationship_id: relationship.id,
          uploader_id: relationship.player_id,
          player_id: relationship.player_id,
          coach_id: relationship.coach_id,
          submission_id: submission.id,
          video_type: 'swing_submission',
          camera_angle: u.angle,
          shot_type: shotType,
          storage_path: u.path,
        });
        if (videoError) throw videoError;
      }

      setStep('done');
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong sending your swing.');
      setStep('review');
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

  if (!relationship) {
    return (
      <View style={[s.container, s.centered, { backgroundColor: dc.bg, padding: 24 }]}>
        <StatusBar style="light" />
        <Text style={[s.stepTitle, { color: dc.cardText, textAlign: 'center' }]}>No Coach Connected</Text>
        <Text style={[s.stepSub, { textAlign: 'center', color: dc.textSecondary }]}>You need an active coach before you can send a swing.</Text>
        <TouchableOpacity style={[s.primaryBtn, { backgroundColor: dc.gold, marginTop: 16 }]} onPress={() => goBack(router, '/(app)/coach')} activeOpacity={0.85}>
          <Text style={s.primaryBtnText}>Back to Titan Coach</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: dc.bg }]}>
      <StatusBar style="light" />
      <View style={[s.header, { borderBottomColor: dc.border }]}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/coach')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={[s.back, { color: dc.gold }]}>← Coach</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: dc.cardText }]}>SEND SWING</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {step === 'type' && (
          <>
            <Text style={[s.stepTitle, { color: dc.cardText }]}>What are you sending your coach?</Text>
            <View style={s.chipWrap}>
              {SHOT_TYPES.map(t => (
                <TouchableOpacity key={t.key} style={[s.chip, { borderColor: dc.border, backgroundColor: dc.card }]} onPress={() => pickShotType(t.key)} activeOpacity={0.8}>
                  <Text style={[s.chipText, { color: dc.cardText }]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {step === 'angle' && (
          <>
            <Text style={[s.stepTitle, { color: dc.cardText }]}>Which camera angle?</Text>
            {ANGLES.map(a => (
              <TouchableOpacity key={a.key} style={[s.optionRow, { borderColor: dc.border, backgroundColor: dc.card }]} onPress={() => pickAngle(a.key)} activeOpacity={0.8}>
                <Text style={[s.optionText, { color: dc.cardText }]}>{a.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={dc.textSecondary} />
              </TouchableOpacity>
            ))}
          </>
        )}

        {step === 'capture' && (
          <>
            <Text style={[s.stepTitle, { color: dc.cardText }]}>
              Record: {ANGLE_LABEL[neededAngles[angleIdx]]}
              {neededAngles.length > 1 ? ` (${angleIdx + 1}/${neededAngles.length})` : ''}
            </Text>
            <Text style={[s.stepSub, { color: dc.textSecondary }]}>
              {neededAngles[angleIdx] === 'down_the_line'
                ? 'Stand behind the ball, phone level with the ground, facing down your target line.'
                : 'Stand facing the golfer, phone level with the ball position.'}
            </Text>
            {!!error && <Text style={s.errorText}>{error}</Text>}
            <TouchableOpacity style={[s.primaryBtn, { backgroundColor: dc.gold }]} onPress={() => captureVideo(neededAngles[angleIdx], false)} activeOpacity={0.85}>
              <Ionicons name="videocam" size={18} color="#000" />
              <Text style={s.primaryBtnText}>Record Video</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.secondaryBtn, { borderColor: dc.border }]} onPress={() => captureVideo(neededAngles[angleIdx], true)} activeOpacity={0.85}>
              <Text style={[s.secondaryBtnText, { color: dc.cardText }]}>Upload Video</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'review' && (
          <>
            <Text style={[s.stepTitle, { color: dc.cardText }]}>Review your swing</Text>
            {neededAngles.map(angle => {
              const uri = videos[angle];
              if (!uri) return null;
              return (
                <View key={angle} style={[s.videoCard, { borderColor: dc.border, backgroundColor: dc.card }]}>
                  <Text style={[s.videoLabel, { color: dc.textSecondary }]}>{ANGLE_LABEL[angle]}</Text>
                  <Video source={{ uri }} style={s.videoPreview} useNativeControls resizeMode={ResizeMode.CONTAIN} isLooping={false} />
                  <TouchableOpacity style={s.retakeBtn} onPress={() => retake(angle)} activeOpacity={0.7}>
                    <Text style={[s.retakeText, { color: '#f87171' }]}>Retake</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
            {!!error && <Text style={s.errorText}>{error}</Text>}
            <TouchableOpacity style={[s.primaryBtn, { backgroundColor: dc.gold }]} onPress={() => setStep('note')} activeOpacity={0.85}>
              <Text style={s.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'note' && (
          <>
            <Text style={[s.stepTitle, { color: dc.cardText }]}>Add a note for your coach</Text>
            <Text style={[s.stepSub, { color: dc.textSecondary }]}>Optional — e.g. what you're feeling or working on.</Text>
            <TextInput
              style={[s.textarea, { backgroundColor: dc.card, borderColor: dc.border, color: dc.cardText }]}
              value={note} onChangeText={setNote}
              placeholder="My driver has been going left recently…" placeholderTextColor={dc.textMuted}
              multiline
            />
            <TouchableOpacity style={[s.primaryBtn, { backgroundColor: dc.gold }]} onPress={send} activeOpacity={0.85}>
              <Text style={s.primaryBtnText}>Send To Coach</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'sending' && (
          <View style={s.centered}>
            <ActivityIndicator color={dc.gold} size="large" />
            <Text style={[s.stepSub, { color: dc.textSecondary, marginTop: 12 }]}>Sending your swing…</Text>
          </View>
        )}

        {step === 'done' && (
          <View style={s.centered}>
            <Ionicons name="checkmark-circle" size={48} color={dc.gold} />
            <Text style={[s.stepTitle, { color: dc.cardText, marginTop: 12 }]}>Sent!</Text>
            <Text style={[s.stepSub, { color: dc.textSecondary }]}>Your coach will review it and get back to you.</Text>
            <TouchableOpacity style={[s.primaryBtn, { backgroundColor: dc.gold, marginTop: 16 }]} onPress={() => goBack(router, '/(app)/coach')} activeOpacity={0.85}>
              <Text style={s.primaryBtnText}>Back to Titan Coach</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(dc: ReturnType<typeof useDynamicColors>) {
  return StyleSheet.create({
    container: { flex: 1 },
    centered: { alignItems: 'center', justifyContent: 'center', paddingTop: 40 },

    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1,
    },
    back: { fontSize: 14, fontFamily: FFB },
    title: { fontSize: 14, fontFamily: FFB, letterSpacing: 0.5 },

    scroll: { padding: 20, paddingBottom: 60 },

    stepTitle: { fontFamily: FFB, fontSize: 18, marginBottom: 8, textAlign: 'center' },
    stepSub: { fontFamily: FF, fontSize: 13, lineHeight: 19, marginBottom: 16, textAlign: 'center' },

    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
    chip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
    chipText: { fontFamily: FFB, fontSize: 14 },

    optionRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 16, marginBottom: 10,
    },
    optionText: { fontFamily: FFB, fontSize: 15 },

    primaryBtn: {
      flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
      borderRadius: 12, paddingVertical: 15, marginTop: 6,
    },
    primaryBtnText: { fontFamily: FFB, fontSize: 14, color: '#000' },
    secondaryBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 10 },
    secondaryBtnText: { fontFamily: FFB, fontSize: 14 },

    errorText: { color: '#f87171', fontFamily: FFB, fontSize: 12, textAlign: 'center', marginBottom: 8 },

    videoCard: { borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 14 },
    videoLabel: { fontFamily: FFB, fontSize: 11, letterSpacing: 1, marginBottom: 8 },
    videoPreview: { width: '100%', aspectRatio: 9 / 16, borderRadius: 10, backgroundColor: '#000' },
    retakeBtn: { alignSelf: 'center', paddingVertical: 10 },
    retakeText: { fontFamily: FFB, fontSize: 13 },

    textarea: {
      borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
      fontFamily: FF, fontSize: 14, minHeight: 90, textAlignVertical: 'top', marginBottom: 6,
    },
  });
}
