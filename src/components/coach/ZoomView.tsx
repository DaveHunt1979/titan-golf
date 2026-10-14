import { useMemo, useRef } from 'react';
import { View, PanResponder, GestureResponderEvent } from 'react-native';
import type { View as ZoomState } from '../../lib/coachAnalysis';
import { panView, pinchView } from '../../lib/coachAnalysis';

interface Props {
  width: number; height: number;
  view: ZoomState; onViewChange: (v: ZoomState) => void;
  panWithOneFinger: boolean;           // true when no drawing tool is active
  children: React.ReactNode;
}

const dist = (t: readonly { pageX: number; pageY: number }[]) => Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
const mid = (t: readonly { pageX: number; pageY: number }[]) => ({ x: (t[0].pageX + t[1].pageX) / 2, y: (t[0].pageY + t[1].pageY) / 2 });

// Pinch to zoom, drag to pan, double-tap to reset. Children (video + drawing
// layer) are transformed together so normalised annotation points stay aligned.
export default function ZoomView({ width, height, view, onViewChange, panWithOneFinger, children }: Props) {
  const live = useRef({ width, height, view, onViewChange, panWithOneFinger });
  live.current = { width, height, view, onViewChange, panWithOneFinger };
  const origin = useRef({ x: 0, y: 0 });                 // box centre in page coords
  const outer = useRef<View>(null);
  const g = useRef({ n: 0, start: live.current.view, d0: 0, m0: { x: 0, y: 0 }, p0: { x: 0, y: 0 }, multi: false, t0: 0 });
  const lastTap = useRef(0);

  const measure = () => outer.current?.measureInWindow((x, y, w, h) => { origin.current = { x: x + w / 2, y: y + h / 2 }; });
  const rel = (p: { x: number; y: number }) => ({ x: p.x - origin.current.x, y: p.y - origin.current.y });

  const rebase = (e: GestureResponderEvent) => {
    const t = e.nativeEvent.touches;
    g.current.n = t.length;
    g.current.start = live.current.view;
    if (t.length >= 2) { g.current.d0 = dist(t); g.current.m0 = rel(mid(t)); }
    else if (t.length === 1) g.current.p0 = { x: t[0].pageX, y: t[0].pageY };
  };

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: e => e.nativeEvent.touches.length >= 2,
    onMoveShouldSetPanResponderCapture: e =>
      e.nativeEvent.touches.length >= 2 || (live.current.panWithOneFinger && live.current.view.scale > 1),
    onStartShouldSetPanResponder: () => live.current.panWithOneFinger && live.current.view.scale > 1,
    onPanResponderGrant: e => { measure(); rebase(e); g.current.multi = false; g.current.t0 = Date.now(); },
    onPanResponderMove: e => {
      const t = e.nativeEvent.touches;
      if (t.length !== g.current.n) rebase(e);            // finger added/lifted: restart from here
      const L = live.current;
      if (t.length >= 2) {
        g.current.multi = true;
        L.onViewChange(pinchView(g.current.start, g.current.m0, g.current.d0, rel(mid(t)), dist(t), L.width, L.height));
      } else if (t.length === 1 && L.panWithOneFinger) {
        L.onViewChange(panView(g.current.start, t[0].pageX - g.current.p0.x, t[0].pageY - g.current.p0.y, L.width, L.height));
      }
    },
    onPanResponderRelease: (e, gs) => {
      // Double-tap resets zoom (short single-finger taps only, never the end of a pinch).
      if (!g.current.multi && Date.now() - g.current.t0 < 250 && Math.hypot(gs.dx, gs.dy) < 6) {
        const now = Date.now();
        if (now - lastTap.current < 300) live.current.onViewChange({ scale: 1, x: 0, y: 0 });
        lastTap.current = now;
      }
    },
  }), []);

  return (
    <View ref={outer} onLayout={measure} style={{ width, height, overflow: 'hidden' }} {...responder.panHandlers}>
      <View style={{ width, height, transform: [{ translateX: view.x }, { translateY: view.y }, { scale: view.scale }] }}>
        {children}
      </View>
    </View>
  );
}
