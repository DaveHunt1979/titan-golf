import { useMemo, useRef, useState } from 'react';
import { View, PanResponder, StyleSheet } from 'react-native';
import Svg, { Line, Circle, Rect, Polyline, Text as SvgText } from 'react-native-svg';
import {
  Annotation, Pt, Tool, angleDegrees, circleRadius, clamp01, visibleAt,
} from '../../lib/coachAnalysis';

// Drawing layer that sits exactly over the video frame. All stored points are
// 0..1 fractions of the frame; this component converts to pixels to draw and
// back again when the coach draws, so the same saved analysis replays
// correctly at any size.

interface Props {
  width: number;
  height: number;
  aspect: number;            // video width / height
  time: number;              // current playback time (s)
  annotations: Annotation[];
  // Editing is on when `tool` is set; null = read-only / just watching.
  tool: Tool | null;
  color: string;
  mode: 'all' | 'frame';
  onCommit?: (a: Annotation) => void;
  zoom?: number;             // view scale, so strokes stay constant on screen
}

const STROKE = 3;
const TAP_SLOP = 8;

function Shape({ a, w, h, aspect, zoom, draft }: { a: Annotation; w: number; h: number; aspect: number; zoom: number; draft?: boolean }) {
  const px = (p: Pt) => ({ x: p.x * w, y: p.y * h });
  const common = { stroke: a.color, strokeWidth: STROKE / zoom, strokeOpacity: draft ? 0.7 : 1, fill: 'none' as const, strokeLinecap: 'round' as const };
  const P = a.points.map(px);

  if (a.tool === 'line' && P.length >= 2) {
    return <Line x1={P[0].x} y1={P[0].y} x2={P[1].x} y2={P[1].y} {...common} />;
  }
  if (a.tool === 'rect' && P.length >= 2) {
    const x = Math.min(P[0].x, P[1].x), y = Math.min(P[0].y, P[1].y);
    return <Rect x={x} y={y} width={Math.abs(P[1].x - P[0].x)} height={Math.abs(P[1].y - P[0].y)} {...common} />;
  }
  if (a.tool === 'circle' && P.length >= 2) {
    // Radius measured in real proportions then drawn in pixels of the shorter side.
    const r = circleRadius(a.points[0], a.points[1], aspect) * h;
    return <Circle cx={P[0].x} cy={P[0].y} r={r} {...common} />;
  }
  if (a.tool === 'free' && P.length >= 2) {
    return <Polyline points={P.map(p => `${p.x},${p.y}`).join(' ')} {...common} strokeLinejoin="round" />;
  }
  if (a.tool === 'angle') {
    const dots = P.map((p, i) => <Circle key={i} cx={p.x} cy={p.y} r={4 / zoom} fill={a.color} />);
    if (P.length < 2) return <>{dots}</>;
    const lines = [
      <Line key="l1" x1={P[1].x} y1={P[1].y} x2={P[0].x} y2={P[0].y} {...common} />,
      P.length >= 3 ? <Line key="l2" x1={P[1].x} y1={P[1].y} x2={P[2].x} y2={P[2].y} {...common} /> : null,
    ];
    const deg = P.length >= 3 ? angleDegrees(a.points[0], a.points[1], a.points[2], aspect) : null;
    return (
      <>
        {lines}{dots}
        {deg != null && (
          <SvgText x={P[1].x + 10 / zoom} y={P[1].y - 10 / zoom} fill={a.color} fontSize={18 / zoom} fontWeight="bold" stroke="#000" strokeWidth={0.6 / zoom}>
            {`${deg.toFixed(0)}°`}
          </SvgText>
        )}
      </>
    );
  }
  return null;
}

export default function AnalysisCanvas({ width, height, aspect, time, annotations, tool, color, mode, onCommit, zoom = 1 }: Props) {
  const [draft, setDraft] = useState<Annotation | null>(null);

  // PanResponder is built once; read the latest props through a ref.
  const live = useRef({ width, height, tool, color, mode, time, onCommit, zoom, draft: null as Annotation | null, angle: [] as Pt[] });
  live.current = { ...live.current, width, height, tool, color, mode, time, onCommit, zoom };

  const startRef = useRef<Pt>({ x: 0, y: 0 });
  const downRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const toPt = (x: number, y: number): Pt => ({ x: clamp01(x / live.current.width), y: clamp01(y / live.current.height) });
  const newId = () => Math.random().toString(36).slice(2, 10);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !!live.current.tool,
    onMoveShouldSetPanResponder: () => !!live.current.tool,
    onPanResponderGrant: e => {
      const { locationX, locationY } = e.nativeEvent;
      downRef.current = { x: locationX, y: locationY };
      startRef.current = toPt(locationX, locationY);
      const L = live.current;
      if (L.tool && L.tool !== 'angle') {
        const d: Annotation = { id: newId(), tool: L.tool, color: L.color, mode: L.mode, t: L.time, points: [startRef.current, startRef.current] };
        L.draft = d;
        setDraft(d);
      }
    },
    onPanResponderMove: (e, g) => {
      const L = live.current;
      if (!L.tool || L.tool === 'angle' || !L.draft) return;
      // g.dx/dy are screen px; the start point is in the (zoomed) view's own space.
      const cur = toPt(downRef.current.x + g.dx / L.zoom, downRef.current.y + g.dy / L.zoom);
      const d = L.tool === 'free'
        ? { ...L.draft, points: [...L.draft.points, cur] }
        : { ...L.draft, points: [startRef.current, cur] };
      L.draft = d;
      setDraft(d);
    },
    onPanResponderRelease: (e, g) => {
      const L = live.current;
      if (!L.tool) return;
      const moved = Math.hypot(g.dx, g.dy);

      if (L.tool === 'angle') {
        // Angle is three taps: end of arm 1, the corner, end of arm 2.
        if (moved > TAP_SLOP) return;
        const pts = [...L.angle, startRef.current];
        if (pts.length < 3) {
          L.angle = pts;
          setDraft({ id: 'draft', tool: 'angle', color: L.color, mode: L.mode, t: L.time, points: pts });
        } else {
          L.angle = [];
          setDraft(null);
          L.onCommit?.({ id: newId(), tool: 'angle', color: L.color, mode: L.mode, t: L.time, points: pts });
        }
        return;
      }

      const d = L.draft;
      L.draft = null;
      setDraft(null);
      if (d && moved > TAP_SLOP) L.onCommit?.(d);
    },
    onPanResponderTerminate: () => {
      live.current.draft = null;
      setDraft(null);
    },
  }), []);

  // Switching tool abandons a half-finished angle.
  const lastTool = useRef<Tool | null>(tool);
  if (lastTool.current !== tool) {
    lastTool.current = tool;
    live.current.angle = [];
    if (draft) setDraft(null);
  }

  const shown = annotations.filter(a => visibleAt(a, time));

  return (
    <View style={[StyleSheet.absoluteFill, { width, height }]} {...(tool ? responder.panHandlers : {})}>
      <Svg width={width} height={height} pointerEvents="none">
        {shown.map(a => <Shape key={a.id} a={a} w={width} h={height} aspect={aspect} zoom={zoom} />)}
        {draft && <Shape a={draft} w={width} h={height} aspect={aspect} zoom={zoom} draft />}
      </Svg>
    </View>
  );
}
