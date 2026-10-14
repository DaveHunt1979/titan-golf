// Titan Coach video analysis — the drawing data model and the maths behind it.
// Pure functions only, so the editing screen on the coach's iPad and the
// read-only replay on a player's phone interpret a saved analysis identically.
//
// Every point is stored normalised (0..1) against the video FRAME itself, not
// the screen, so a drawing lines up over the swing at any size or device.

export type Tool = 'line' | 'angle' | 'circle' | 'rect' | 'free';

export interface Pt { x: number; y: number }

export interface Annotation {
  id: string;
  tool: Tool;
  color: string;
  points: Pt[];
  // 'all' = stays on screen for the whole video (address lines etc.);
  // 'frame' = only shown on the frame it was drawn.
  mode: 'all' | 'frame';
  // Playback time (s) it was drawn at — what 'frame' mode keys off.
  t: number;
}

export const COLORS = ['#ef4444', '#facc15', '#22c55e', '#38bdf8', '#ffffff'] as const;

// A 'frame' drawing counts as "on this frame" within about one frame at 30fps.
const FRAME_WINDOW = 1 / 30;

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function visibleAt(a: Annotation, time: number): boolean {
  return a.mode === 'all' || Math.abs(a.t - time) <= FRAME_WINDOW;
}

// Interior angle at `vertex` between the rays to `a` and `c`, in degrees.
// The aspect ratio matters: x/y are fractions of different pixel lengths, so
// work in real proportions or a 45° line on a portrait video reads wrong.
export function angleDegrees(a: Pt, vertex: Pt, c: Pt, aspect: number): number {
  const v1 = { x: (a.x - vertex.x) * aspect, y: a.y - vertex.y };
  const v2 = { x: (c.x - vertex.x) * aspect, y: c.y - vertex.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (m === 0) return 0;
  return (Math.acos(Math.min(1, Math.max(-1, dot / m))) * 180) / Math.PI;
}

// Circle through centre + edge point, radius in the same real proportions.
export function circleRadius(center: Pt, edge: Pt, aspect: number): number {
  return Math.hypot((edge.x - center.x) * aspect, edge.y - center.y);
}

// Largest box with the given aspect that fits inside w x h (CSS "contain").
export function fitBox(w: number, h: number, aspect: number): { width: number; height: number } {
  if (!(aspect > 0) || w <= 0 || h <= 0) return { width: w, height: h };
  return w / h > aspect ? { width: h * aspect, height: h } : { width: w, height: w / aspect };
}

export const FRAME_STEP = 1 / 30;

// m:ss.ff with ff = frame number at 30fps, e.g. 0:01.15.
export function fmtTime(t: number): string {
  const m = Math.floor(t / 60), s = Math.floor(t % 60), f = Math.floor((t % 1) * 30);
  return `${m}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
}

// Default library title for a still grabbed from a video at `t` seconds.
export const stillTitle = (t: number) => `Frame ${fmtTime(t)}`;

export function stepTime(t: number, frames: number, duration: number): number {
  return Math.min(Math.max(0, duration), Math.max(0, t + frames * FRAME_STEP));
}

// Tolerant read of whatever came back from the jsonb column.
export function parseAnnotations(raw: unknown): Annotation[] {
  if (!Array.isArray(raw)) return [];
  const tools: Tool[] = ['line', 'angle', 'circle', 'rect', 'free'];
  return raw.filter((a: any) =>
    a && tools.includes(a.tool) && Array.isArray(a.points) && a.points.length > 0
    && a.points.every((p: any) => typeof p?.x === 'number' && typeof p?.y === 'number'),
  ).map((a: any) => ({
    id: String(a.id ?? Math.random().toString(36).slice(2)),
    tool: a.tool, color: typeof a.color === 'string' ? a.color : COLORS[0],
    points: a.points.map((p: any) => ({ x: clamp01(p.x), y: clamp01(p.y) })),
    mode: a.mode === 'frame' ? 'frame' : 'all',
    t: typeof a.t === 'number' ? a.t : 0,
  }));
}

export interface View { scale: number; x: number; y: number }
export const MIN_SCALE = 1;
export const MAX_SCALE = 5;
export const IDENTITY_VIEW: View = { scale: 1, x: 0, y: 0 };

const clampTo = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// Keep the zoomed content covering the box: no empty margins when panning.
export function clampView(v: View, w: number, h: number): View {
  const scale = clampTo(v.scale, MIN_SCALE, MAX_SCALE);
  const maxX = (w * (scale - 1)) / 2;
  const maxY = (h * (scale - 1)) / 2;
  return { scale, x: clampTo(v.x, -maxX, maxX) + 0, y: clampTo(v.y, -maxY, maxY) + 0 };
}

// Mids are px relative to the box centre. The content point under the fingers
// at the start stays under the fingers throughout (x = mid - scale * contentPt).
export function pinchView(start: View, startMid: Pt, startDist: number, mid: Pt, dist: number, w: number, h: number): View {
  const scale = clampTo(start.scale * (startDist > 0 ? dist / startDist : 1), MIN_SCALE, MAX_SCALE);
  const cx = (startMid.x - start.x) / start.scale;
  const cy = (startMid.y - start.y) / start.scale;
  return clampView({ scale, x: mid.x - scale * cx, y: mid.y - scale * cy }, w, h);
}

export function panView(start: View, dx: number, dy: number, w: number, h: number): View {
  if (start.scale <= MIN_SCALE) return IDENTITY_VIEW;
  return clampView({ scale: start.scale, x: start.x + dx, y: start.y + dy }, w, h);
}

export function zoomBy(v: View, factor: number, w: number, h: number): View {
  const scale = clampTo(v.scale * factor, MIN_SCALE, MAX_SCALE);
  const k = scale / v.scale;
  return clampView({ scale, x: v.x * k, y: v.y * k }, w, h);
}
