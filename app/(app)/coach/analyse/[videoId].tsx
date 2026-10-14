import { useCallback, useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import VideoAnalyser from '../../../../src/components/coach/VideoAnalyser';
import StillAnalyser from '../../../../src/components/coach/StillAnalyser';
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
  const [isImage, setIsImage] = useState(false);
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
        const { data: row, error: e } = await supabase.from('coach_video_library').select('title, storage_path, coach_id, media_type').eq('id', videoId).single();
        if (e || !row) throw new Error('Video not found');
        storagePath = row.storage_path; coachId = row.coach_id; label = row.title;
        setIsImage(row.media_type === 'image');
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
      savedRef.current = JSON.stringify(parsed);
      setSaved(savedRef.current);
      if (an?.video_aspect) setAspect(Number(an.video_aspect));
    } catch (e: any) {
      setError(e.message ?? 'Could not open this video.');
    } finally {
      setLoading(false);
    }
  }, [videoId, isLibrary]);

  useEffect(() => { load(); }, [load]);

  const dirty = JSON.stringify(annotations) !== saved;

  // Saves are chained: each waits for the one in flight, then re-reads the
  // latest annotations, so the last edit is always persisted.
  const latest = useRef({ annotations, owner, canEdit, aspect });
  latest.current = { annotations, owner, canEdit, aspect };
  const savedRef = useRef('[]');
  const failedRef = useRef<string | null>(null);
  const inflightRef = useRef<Promise<boolean> | null>(null);

  async function doSave(): Promise<boolean> {
    const { annotations: snapshot, owner: o, canEdit: ce, aspect: asp } = latest.current;
    if (!o || !ce) return true;
    const snapshotJson = JSON.stringify(snapshot);
    if (snapshotJson === savedRef.current) return true;
    setSaving(true);
    setError('');
    const { error: e } = await supabase.from('coaching_analyses').upsert({
      coach_id: o.coachId,
      player_id: o.playerId,
      [isLibrary ? 'library_video_id' : 'coaching_video_id']: videoId,
      video_aspect: asp,
      annotations: snapshot,
      updated_at: new Date().toISOString(),
    }, { onConflict: isLibrary ? 'library_video_id' : 'coaching_video_id' });
    setSaving(false);
    if (e) { failedRef.current = snapshotJson; setError(e.message); return false; }
    failedRef.current = null;
    savedRef.current = snapshotJson;
    setSaved(snapshotJson);
    return true;
  }

  function save(): Promise<boolean> {
    const p = (inflightRef.current ?? Promise.resolve(true)).then(doSave, doSave);
    inflightRef.current = p;
    const clear = () => { if (inflightRef.current === p) inflightRef.current = null; };
    p.then(clear, clear);
    return p;
  }

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    // After a failed save, wait for the next edit rather than retrying in a loop.
    if (!canEdit || !dirty || failedRef.current === JSON.stringify(annotations)) return;
    const h = setTimeout(() => { saveRef.current(); }, 1500);
    return () => clearTimeout(h);
  }, [annotations, dirty, canEdit, saving]);
  // Swiping back / leaving any way still saves the last edit.
  useEffect(() => () => { saveRef.current(); }, []);

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
        <TouchableOpacity onPress={async () => { if (canEdit && !(await save())) return; goBack(router, '/(app)/coach'); }} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={[s.back, { color: dc.gold }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: dc.cardText }]} numberOfLines={1}>{canEdit ? 'ANALYSE' : 'COACH ANALYSIS'} · {title.toUpperCase()}</Text>
        <Text style={[s.unsaved, !canEdit && { opacity: 0 }, !dirty && !saving && { color: '#4ade80' }]}>
          {saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved ✓'}
        </Text>
      </View>

      {!!error && <Text style={s.error}>{error}</Text>}

      {uri && isImage ? (
        <StillAnalyser
          uri={uri}
          annotations={annotations}
          onChange={canEdit ? setAnnotations : undefined}
          aspect={aspect}
          onAspect={a => setAspect(cur => cur ?? a)}
          onSave={save}
          saving={saving}
          dirty={dirty}
        />
      ) : uri ? (
        <VideoAnalyser
          uri={uri}
          annotations={annotations}
          onChange={canEdit ? setAnnotations : undefined}
          aspect={aspect}
          onAspect={a => setAspect(cur => cur ?? a)}
          onSave={save}
          saving={saving}
          dirty={dirty}
          coachId={canEdit ? owner?.coachId : undefined}
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
