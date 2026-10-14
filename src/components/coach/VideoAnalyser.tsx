import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, PanResponder, LayoutChangeEvent, Image, PixelRatio, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { captureRef } from 'react-native-view-shot';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import AnalysisCanvas from './AnalysisCanvas';
import ZoomView from './ZoomView';
import EditTools from './EditTools';
import type { View as ViewState } from '../../lib/coachAnalysis';
import { Annotation, COLORS, IDENTITY_VIEW, Tool, fitBox, fmtTime as fmt, stepTime, stillTitle } from '../../lib/coachAnalysis';
import { grabFrame, saveStill, saveToPhotos } from '../../lib/coachStills';
import { useDeviceLayout } from '../../lib/useDeviceLayout';

const GOLD = '#D4AF37';
const FFB = 'JUSTSans-ExBold';
const FF = 'JUSTSans';
const SPEEDS = [0.1, 0.25, 0.5, 1];
const noop = () => {};

interface Props {
  uri: string;
  annotations: Annotation[];
  onChange?: (next: Annotation[]) => void;   // omit for read-only (player view)
  aspect?: number | null;                    // aspect the drawings were made against
  onAspect?: (aspect: number) => void;
  onSave?: () => void;
  saving?: boolean;
  dirty?: boolean;
  coachId?: string;                          // enables Screenshot (coach's own library)
}

export default function VideoAnalyser({ uri, annotations, onChange, aspect: savedAspect, onAspect, onSave, saving, dirty, coachId }: Props) {
  const editable = !!onChange;
  const { isPad } = useDeviceLayout();
  const router = useRouter();

  const player = useVideoPlayer({ uri }, p => { p.loop = false; p.timeUpdateEventInterval = 0.04; p.preservesPitch = true; });
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [detectedAspect, setDetectedAspect] = useState<number | null>(null);

  const [tool, setTool] = useState<Tool | null>(null);
  const [color, setColor] = useState<string>(COLORS[0]);
  const [mode, setMode] = useState<'all' | 'frame'>('all');

  const [root, setRoot] = useState({ w: 0, h: 0 });
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [trackW, setTrackW] = useState(0);
  const [view, setView] = useState<ViewState>(IDENTITY_VIEW);

  // Screenshot: raw frame -> library, copy with drawings burned in -> Photos.
  const [shotBusy, setShotBusy] = useState(false);
  const [shot, setShot] = useState<{ libraryId: string; photos: boolean } | null>(null);
  const [shotErr, setShotErr] = useState('');
  const [burn, setBurn] = useState<{ uri: string; time: number; w: number; h: number } | null>(null);
  const burnRef = useRef<View>(null);
  const burnLoaded = useRef<(() => void) | null>(null);
  const burnFailed = useRef<(() => void) | null>(null);

  useEffect(() => {
    const subs = [
      player.addListener('timeUpdate', e => setTime(e.currentTime)),
      player.addListener('playingChange', e => setPlaying(e.isPlaying)),
      player.addListener('sourceLoad', e => {
        setDuration(e.duration);
        const sz = e.availableVideoTracks?.[0]?.size;
        if (sz && sz.width > 0 && sz.height > 0) {
          const a = sz.width / sz.height;
          setDetectedAspect(a);
          onAspect?.(a);
        }
      }),
    ];
    return () => subs.forEach(s => s.remove());
  }, [player]);

  // Drawings always use the aspect they were made against; a fresh video uses
  // what the player reports; 9:16 is the fallback for a phone swing video.
  const aspect = savedAspect ?? detectedAspect ?? 9 / 16;
  const box = fitBox(stage.w, stage.h, aspect);

  useEffect(() => setView(IDENTITY_VIEW), [box.width, box.height]);

  const seek = (t: number) => {
    const clamped = Math.min(Math.max(0, t), duration || t);
    player.currentTime = clamped;
    setTime(clamped);
  };
  const togglePlay = () => { if (playing) player.pause(); else { setTool(null); player.play(); } };
  const step = (frames: number) => { player.pause(); seek(stepTime(time, frames, duration)); };
  const setSpeed = (r: number) => { player.playbackRate = r; setRate(r); };
  const pickTool = (t: Tool) => { player.pause(); setTool(cur => (cur === t ? null : t)); };

  // Scrubber
  const scrubRef = useRef({ trackW: 0, duration: 0 });
  scrubRef.current = { trackW, duration };
  const scrub = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: e => { player.pause(); applyScrub(e.nativeEvent.locationX); },
    onPanResponderMove: e => applyScrub(e.nativeEvent.locationX),
  }), [player]);
  function applyScrub(x: number) {
    const { trackW: w, duration: d } = scrubRef.current;
    if (!w || !d) return;
    const t = Math.min(1, Math.max(0, x / w)) * d;
    player.currentTime = t;
    setTime(t);
  }

  // Renders the frame + drawings in a hidden view, waits for the image to
  // load, then captures it to a temp PNG.
  function burnIn(frameUri: string, t: number, frameW: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { burnLoaded.current = null; burnFailed.current = null; reject(new Error('Timed out')); }, 10000);
      burnFailed.current = () => {
        burnLoaded.current = null; burnFailed.current = null;
        clearTimeout(timer);
        reject(new Error('Could not load the frame'));
      };
      burnLoaded.current = () => {
        burnLoaded.current = null; burnFailed.current = null;
        requestAnimationFrame(() => {
          captureRef(burnRef, { format: 'png', quality: 1, result: 'tmpfile' })
            .then(r => { clearTimeout(timer); resolve(r); }, e => { clearTimeout(timer); reject(e); });
        });
      };
      const w = frameW / PixelRatio.get();
      setBurn({ uri: frameUri, time: t, w, h: w / aspect });
    });
  }

  async function screenshot() {
    if (shotBusy || !coachId) return;
    player.pause();
    setShotBusy(true); setShot(null); setShotErr('');
    const t = player.currentTime ?? time;
    try {
      const frame = await grabFrame(player, t);
      const { libraryId } = await saveStill({ coachId, title: stillTitle(t), frameUri: frame.uri });
      let photos = false;
      try { photos = await saveToPhotos(await burnIn(frame.uri, t, frame.width)); } catch { photos = false; }
      setShot({ libraryId, photos });
    } catch (e: any) {
      setShotErr(e?.message ?? 'Could not save the screenshot.');
    } finally {
      setBurn(null);
      setShotBusy(false);
    }
  }

  const landscape = isPad && root.w > root.h;
  const progress = duration > 0 ? Math.min(1, time / duration) : 0;

  const controls = (
    <View style={[st.panel, landscape && st.panelSide]}>
      <View style={st.scrubRow}>
        <Text style={st.time}>{fmt(time)}</Text>
        <View style={st.track} onLayout={(e: LayoutChangeEvent) => setTrackW(e.nativeEvent.layout.width)} {...scrub.panHandlers}>
          <View style={st.trackBg} />
          <View style={[st.trackFill, { width: `${progress * 100}%` }]} />
          <View style={[st.thumb, { left: `${progress * 100}%` }]} />
        </View>
        <Text style={st.time}>{fmt(duration)}</Text>
      </View>

      <View style={st.transport}>
        <TouchableOpacity style={st.tBtn} onPress={() => step(-1)} onLongPress={() => step(-5)} activeOpacity={0.7}>
          <Ionicons name="play-skip-back" size={22} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={[st.tBtn, st.playBtn]} onPress={togglePlay} activeOpacity={0.8}>
          <Ionicons name={playing ? 'pause' : 'play'} size={26} color="#000" />
        </TouchableOpacity>
        <TouchableOpacity style={st.tBtn} onPress={() => step(1)} onLongPress={() => step(5)} activeOpacity={0.7}>
          <Ionicons name="play-skip-forward" size={22} color="#fff" />
        </TouchableOpacity>
      </View>
      <Text style={st.hint}>Step one frame at a time · hold to jump 5 frames</Text>

      <View style={st.chipRow}>
        {SPEEDS.map(r => (
          <TouchableOpacity key={r} style={[st.chip, rate === r && st.chipOn]} onPress={() => setSpeed(r)} activeOpacity={0.8}>
            <Text style={[st.chipText, rate === r && st.chipTextOn]}>{r}×</Text>
          </TouchableOpacity>
        ))}
        {editable && !!coachId && (
          <TouchableOpacity style={[st.chip, st.shotChip, shotBusy && { opacity: 0.5 }]} onPress={screenshot} disabled={shotBusy} activeOpacity={0.8}>
            {shotBusy ? <ActivityIndicator size="small" color={GOLD} /> : <Ionicons name="camera" size={14} color={GOLD} />}
            <Text style={[st.chipText, { color: GOLD }]}>Screenshot</Text>
          </TouchableOpacity>
        )}
      </View>
      <EditTools
        editable={editable} tool={tool} color={color} mode={mode} annotations={annotations}
        onTool={pickTool} onColor={setColor} onMode={setMode} onChange={onChange ?? noop}
        onSave={onSave} saving={saving} dirty={dirty}
        view={view} onView={setView} w={box.width} h={box.height}
      />
    </View>
  );

  return (
    <View style={[st.root, landscape && { flexDirection: 'row' }]} onLayout={e => setRoot({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {/* Hidden under the opaque stage/panel; only mounted while burning a screenshot. */}
      {burn && (
        <View ref={burnRef} collapsable={false} pointerEvents="none" style={[st.burn, { width: burn.w, height: burn.h }]}>
          <Image source={{ uri: burn.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" onLoad={() => burnLoaded.current?.()} onError={() => burnFailed.current?.()} />
          <AnalysisCanvas
            width={burn.w} height={burn.h} aspect={aspect} time={burn.time}
            annotations={annotations} tool={null} color={color} mode="all"
          />
        </View>
      )}
      <View style={st.stage} onLayout={e => setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {stage.w > 0 && (
          <ZoomView width={box.width} height={box.height} view={view} onViewChange={setView} panWithOneFinger={!(editable && tool)}>
            <View style={{ width: box.width, height: box.height }}>
              <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls={false} contentFit="contain" surfaceType="textureView" />
              <AnalysisCanvas
                width={box.width} height={box.height} aspect={aspect} time={time}
                annotations={annotations} tool={editable ? tool : null} color={color} mode={mode}
                onCommit={a => onChange?.([...annotations, a])} zoom={view.scale}
              />
            </View>
          </ZoomView>
        )}
        {/* Overlaid on the stage so showing it never resizes the stage (which would reset the zoom). */}
        {!!shot && (
          <View style={[st.banner, st.overlay]}>
            <Text style={st.bannerText}>{shot.photos ? 'Saved to your library and Photos' : 'Saved to your library (Photos access not allowed)'}</Text>
            <TouchableOpacity
              style={st.bannerBtn}
              onPress={() => { const id = shot.libraryId; setShot(null); router.push({ pathname: '/(app)/coach/analyse/[videoId]', params: { videoId: id, source: 'library' } } as any); }}
              activeOpacity={0.85}
            >
              <Text style={st.bannerBtnText}>Edit</Text>
            </TouchableOpacity>
          </View>
        )}
        {!!shotErr && <Text style={[st.shotErr, st.overlay]}>{shotErr}</Text>}
      </View>
      {controls}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  panel: { backgroundColor: '#0d0d0d', padding: 14, gap: 10, borderTopWidth: 1, borderTopColor: '#1c1c1c' },
  panelSide: { width: 320, borderTopWidth: 0, borderLeftWidth: 1, borderLeftColor: '#1c1c1c' },

  scrubRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  time: { color: '#fff', fontFamily: FF, fontSize: 11, width: 52, textAlign: 'center' },
  track: { flex: 1, height: 36, justifyContent: 'center' },
  trackBg: { height: 4, borderRadius: 2, backgroundColor: '#2a2a2a' },
  trackFill: { position: 'absolute', height: 4, borderRadius: 2, backgroundColor: GOLD },
  thumb: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: GOLD, marginLeft: -9 },

  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 },
  tBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  playBtn: { width: 58, height: 58, borderRadius: 29, backgroundColor: GOLD },
  hint: { color: '#9ca3af', fontFamily: FF, fontSize: 11, textAlign: 'center' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: { borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#111' },
  chipOn: { backgroundColor: GOLD, borderColor: GOLD },
  chipText: { color: '#fff', fontFamily: FFB, fontSize: 12 },
  chipTextOn: { color: '#000' },
  shotChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderColor: GOLD },

  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1a1608', borderWidth: 1, borderColor: GOLD, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  bannerText: { flex: 1, color: GOLD, fontFamily: FFB, fontSize: 12 },
  bannerBtn: { backgroundColor: GOLD, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  bannerBtnText: { color: '#000', fontFamily: FFB, fontSize: 12 },
  shotErr: { color: '#f87171', fontFamily: FF, fontSize: 12, textAlign: 'center' },
  overlay: { position: 'absolute', left: 12, right: 12, bottom: 8 },
  burn: { position: 'absolute', top: 0, left: 0, backgroundColor: '#000' },

});
