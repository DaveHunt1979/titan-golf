import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import VideoAnalyser from '../../../../src/components/coach/VideoAnalyser';
import { supabase } from '../../../../src/lib/supabase';
import { useDynamicColors } from '../../../../src/lib/SocietyThemeContext';
import { goBack } from '../../../../src/lib/navigation';
import { Annotation, parseAnnotations } from '../../../../src/lib/coachAnalysis';

const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';

// One screen for both uses: analysing a player's swing video (source=submission,
// the coach edits, the player just watches) and drawing on one of the coach's
// own library videos, e.g. a model swing (source=library).
export default function AnalyseScreen() {
  const router = useRouter();
  const dc = useDynamicColors();
  const { videoId, source } = useLocalSearchParams<{ videoId: string; source?: string }>();
  const isLibrary = source === 'library';
  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uri, setUri] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [owner, setOwner] = useState<{ coachId: string; playerId: string | null } | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [aspect, setAspect] = useState<number | null>(null);
  const [saved, setSaved] = useState<string>('[]');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      const { data: me } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (!me) throw new Error('Player not found');

      let storagePath: string; let coachId: string; let playerId: string | null = null; let label = 'Video';
      if (isLibrary) {
        const { data: row, error: e } = await supabase.from('coach_video_library').select('title, storage_path, coach_id').eq('id', videoId).single();
        if (e || !row) throw new Error('Video not found');
        storagePath = row.storage_path; coachId = row.coach_id; label = row.title;
      } else {
        const { data: row, error: e } = await supabase.from('coaching_videos').select('storage_path, coach_id, player_id, camera_angle').eq('id', videoId).single();
        if (e || !row) throw new Error('Video not found');
        storagePath = row.storage_path; coachId = row.coach_id; playerId = row.player_id;
        label = row.camera_angle === 'face_on' ? 'Face On' : row.camera_angle === 'down_the_line' ? 'Down The Line' : 'Swing';
      }
      setTitle(label);
      setOwner({ coachId, playerId });
      setCanEdit(coachId === me.id);

      const { data: signed, error: sErr } = await supabase.storage.from('coaching-videos').createSignedUrl(storagePath, 3600);
      if (sErr || !signed) throw new Error('Could not load the video');
      setUri(signed.signedUrl);

      const { data: an } = await supabase.from('coaching_analyses').select('annotations, video_aspect')
        .eq(isLibrary ? 'library_video_id' : 'coaching_video_id', videoId).maybeSingle();
      const parsed = parseAnnotations(an?.annotations);
      setAnnotations(parsed);
      setSaved(JSON.stringify(parsed));
      if (an?.video_aspect) setAspect(Number(an.video_aspect));
    } catch (e: any) {
      setError(e.message ?? 'Could not open this video.');
    } finally {
      setLoading(false);
    }
  }, [videoId, isLibrary]);

  useEffect(() => { load(); }, [load]);

  const dirty = JSON.stringify(annotations) !== saved;

  async function save() {
    if (!owner || !canEdit) return;
    setSaving(true);
    setError('');
    const { error: e } = await supabase.from('coaching_analyses').upsert({
      coach_id: owner.coachId,
      player_id: owner.playerId,
      [isLibrary ? 'library_video_id' : 'coaching_video_id']: videoId,
      video_aspect: aspect,
      annotations,
      updated_at: new Date().toISOString(),
    }, { onConflict: isLibrary ? 'library_video_id' : 'coaching_video_id' });
    setSaving(false);
    if (e) { setError(e.message); return; }
    setSaved(JSON.stringify(annotations));
  }

  if (loading || !fontsLoaded) {
    return (
      <View style={[s.container, s.centered, { backgroundColor: '#000' }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={dc.gold} size="large" />
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: '#000' }]}>
      <StatusBar style="light" />
      <View style={[s.header, { borderBottomColor: dc.border }]}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/coach')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={[s.back, { color: dc.gold }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: dc.cardText }]} numberOfLines={1}>{canEdit ? 'ANALYSE' : 'COACH ANALYSIS'} · {title.toUpperCase()}</Text>
        <Text style={[s.unsaved, !(canEdit && dirty) && { opacity: 0 }]}>Unsaved</Text>
      </View>

      {!!error && <Text style={s.error}>{error}</Text>}

      {uri ? (
        <VideoAnalyser
          uri={uri}
          annotations={annotations}
          onChange={canEdit ? setAnnotations : undefined}
          aspect={aspect}
          onAspect={a => setAspect(cur => cur ?? a)}
          onSave={save}
          saving={saving}
          dirty={dirty}
        />
      ) : (
        <Text style={[s.error, { marginTop: 40 }]}>Video unavailable</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1 },
  back: { fontSize: 14, fontFamily: FFB },
  title: { fontSize: 13, fontFamily: FFB, letterSpacing: 0.5, flex: 1, textAlign: 'center', marginHorizontal: 8 },
  unsaved: { color: '#facc15', fontFamily: FFB, fontSize: 11, width: 60, textAlign: 'right' },
  error: { color: '#f87171', fontFamily: FF, fontSize: 13, textAlign: 'center', padding: 10 },
});
