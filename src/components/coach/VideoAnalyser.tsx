import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, PanResponder, LayoutChangeEvent } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import AnalysisCanvas from './AnalysisCanvas';
import { Annotation, COLORS, Tool, fitBox, stepTime } from '../../lib/coachAnalysis';
import { useDeviceLayout } from '../../lib/useDeviceLayout';

const GOLD = '#D4AF37';
const FFB = 'JUSTSans-ExBold';
const FF = 'JUSTSans';
const SPEEDS = [0.1, 0.25, 0.5, 1];

const TOOLS: { key: Tool; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'line',   label: 'Line',   icon: 'remove-outline' },
  { key: 'angle',  label: 'Angle',  icon: 'git-merge-outline' },
  { key: 'circle', label: 'Circle', icon: 'ellipse-outline' },
  { key: 'rect',   label: 'Box',    icon: 'square-outline' },
  { key: 'free',   label: 'Draw',   icon: 'brush-outline' },
];

interface Props {
  uri: string;
  annotations: Annotation[];
  onChange?: (next: Annotation[]) => void;   // omit for read-only (player view)
  aspect?: number | null;                    // aspect the drawings were made against
  onAspect?: (aspect: number) => void;
  onSave?: () => void;
  saving?: boolean;
  dirty?: boolean;
}

const fmt = (t: number) => {
  const m = Math.floor(t / 60), s = Math.floor(t % 60), f = Math.floor((t % 1) * 30);
  return `${m}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
};

export default function VideoAnalyser({ uri, annotations, onChange, aspect: savedAspect, onAspect, onSave, saving, dirty }: Props) {
  const editable = !!onChange;
  const { isPad } = useDeviceLayout();

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
      </View>

      {editable && (
        <>
          <Text style={st.label}>TOOLS</Text>
          <View style={st.chipRow}>
            {TOOLS.map(t => (
              <TouchableOpacity key={t.key} style={[st.tool, tool === t.key && st.chipOn]} onPress={() => pickTool(t.key)} activeOpacity={0.8}>
                <Ionicons name={t.icon} size={20} color={tool === t.key ? '#000' : '#fff'} />
                <Text style={[st.toolText, tool === t.key && st.chipTextOn]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {tool === 'angle' && <Text style={st.hint}>Tap three points: end of one arm, the corner, end of the other.</Text>}

          <View style={st.chipRow}>
            {COLORS.map(c => (
              <TouchableOpacity key={c} onPress={() => setColor(c)} activeOpacity={0.8}
                style={[st.swatch, { backgroundColor: c }, color === c && st.swatchOn]} />
            ))}
          </View>

          <View style={st.chipRow}>
            <TouchableOpacity style={[st.chip, mode === 'all' && st.chipOn]} onPress={() => setMode('all')} activeOpacity={0.8}>
              <Text style={[st.chipText, mode === 'all' && st.chipTextOn]}>Stays on whole video</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.chip, mode === 'frame' && st.chipOn]} onPress={() => setMode('frame')} activeOpacity={0.8}>
              <Text style={[st.chipText, mode === 'frame' && st.chipTextOn]}>This frame only</Text>
            </TouchableOpacity>
          </View>

          <View style={st.chipRow}>
            <TouchableOpacity style={st.chip} onPress={() => onChange!(annotations.slice(0, -1))} disabled={!annotations.length} activeOpacity={0.8}>
              <Text style={[st.chipText, !annotations.length && { opacity: 0.4 }]}>Undo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.chip} onPress={() => onChange!([])} disabled={!annotations.length} activeOpacity={0.8}>
              <Text style={[st.chipText, { color: '#f87171' }, !annotations.length && { opacity: 0.4 }]}>Clear all</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[st.save, (!dirty || saving) && { opacity: 0.45 }]} onPress={onSave} disabled={!dirty || saving} activeOpacity={0.85}>
            <Text style={st.saveText}>{saving ? 'Saving…' : dirty ? 'Save analysis' : 'Saved'}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  return (
    <View style={[st.root, landscape && { flexDirection: 'row' }]} onLayout={e => setRoot({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <View style={st.stage} onLayout={e => setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {stage.w > 0 && (
          <View style={{ width: box.width, height: box.height }}>
            <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls={false} contentFit="contain" />
            <AnalysisCanvas
              width={box.width} height={box.height} aspect={aspect} time={time}
              annotations={annotations} tool={editable ? tool : null} color={color} mode={mode}
              onCommit={a => onChange?.([...annotations, a])}
            />
          </View>
        )}
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

  label: { color: '#9ca3af', fontFamily: FFB, fontSize: 10.5, letterSpacing: 1, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: { borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#111' },
  chipOn: { backgroundColor: GOLD, borderColor: GOLD },
  chipText: { color: '#fff', fontFamily: FFB, fontSize: 12 },
  chipTextOn: { color: '#000' },
  tool: { borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#111', alignItems: 'center', gap: 2, minWidth: 58 },
  toolText: { color: '#fff', fontFamily: FFB, fontSize: 10.5 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: GOLD },

  save: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  saveText: { color: '#000', fontFamily: FFB, fontSize: 14 },
});
