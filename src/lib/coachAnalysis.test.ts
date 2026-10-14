import { angleDegrees, circleRadius, fitBox, parseAnnotations, stepTime, visibleAt, Annotation, clampView, pinchView, panView, zoomBy, IDENTITY_VIEW, MAX_SCALE, fmtTime, stillTitle } from './coachAnalysis';

const ann = (over: Partial<Annotation> = {}): Annotation => ({
  id: 'a', tool: 'line', color: '#fff', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], mode: 'all', t: 0, ...over,
});

describe('angleDegrees', () => {
  it('right angle on a square frame', () => {
    expect(angleDegrees({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }, 1)).toBeCloseTo(90);
  });
  it('straight line is 180', () => {
    expect(angleDegrees({ x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }, 9 / 16)).toBeCloseTo(180);
  });
  it('accounts for a portrait frame: same normalised diagonal is steeper', () => {
    const square = angleDegrees({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }, 1);
    const portrait = angleDegrees({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }, 9 / 16);
    expect(square).toBeCloseTo(45);
    expect(portrait).toBeGreaterThan(45);
  });
  it('degenerate points give 0, not NaN', () => {
    expect(angleDegrees({ x: 0.2, y: 0.2 }, { x: 0.2, y: 0.2 }, { x: 0.5, y: 0.5 }, 1)).toBe(0);
  });
});

describe('circleRadius', () => {
  it('uses real proportions', () => {
    expect(circleRadius({ x: 0, y: 0 }, { x: 1, y: 0 }, 0.5)).toBeCloseTo(0.5);
  });
});

describe('fitBox', () => {
  it('letterboxes a portrait video in a wide area', () => {
    const b = fitBox(1000, 600, 9 / 16);
    expect(b.height).toBe(600);
    expect(b.width).toBeCloseTo(337.5);
  });
  it('fits by width when the area is tall', () => {
    const b = fitBox(300, 900, 16 / 9);
    expect(b.width).toBe(300);
    expect(b.height).toBeCloseTo(168.75);
  });
});

describe('visibleAt', () => {
  it("'all' always shows", () => expect(visibleAt(ann(), 3.7)).toBe(true));
  it("'frame' only on its own frame", () => {
    const a = ann({ mode: 'frame', t: 2 });
    expect(visibleAt(a, 2.01)).toBe(true);
    expect(visibleAt(a, 2.5)).toBe(false);
  });
});

describe('stepTime', () => {
  it('clamps at both ends', () => {
    expect(stepTime(0, -1, 5)).toBe(0);
    expect(stepTime(4.99, 3, 5)).toBe(5);
  });
  it('moves one frame', () => expect(stepTime(1, 1, 5)).toBeCloseTo(1 + 1 / 30));
});

describe('parseAnnotations', () => {
  it('drops garbage and clamps out-of-range points', () => {
    const out = parseAnnotations([
      { id: 'x', tool: 'line', color: '#f00', points: [{ x: -1, y: 2 }, { x: 0.5, y: 0.5 }], mode: 'frame', t: 1 },
      { tool: 'banana', points: [{ x: 0, y: 0 }] },
      { tool: 'line', points: [] },
      null,
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].points[0]).toEqual({ x: 0, y: 1 });
    expect(out[0].mode).toBe('frame');
  });
  it('non-array is empty', () => expect(parseAnnotations({})).toEqual([]));
});

describe('zoom', () => {
  const W = 400, H = 300;
  it('clamps scale and keeps content covering the box', () => {
    expect(clampView({ scale: 9, x: 0, y: 0 }, W, H).scale).toBe(MAX_SCALE);
    expect(clampView({ scale: 0.2, x: 50, y: 50 }, W, H)).toEqual({ scale: 1, x: 0, y: 0 });
    const v = clampView({ scale: 2, x: 999, y: -999 }, W, H);
    expect(v.x).toBe(200);   // W*(2-1)/2
    expect(v.y).toBe(-150);  // H*(2-1)/2
  });
  it('pinch about the centre doubles scale without moving', () => {
    const v = pinchView(IDENTITY_VIEW, { x: 0, y: 0 }, 100, { x: 0, y: 0 }, 200, W, H);
    expect(v.scale).toBe(2); expect(v.x).toBeCloseTo(0); expect(v.y).toBeCloseTo(0);
  });
  it('pinch keeps the content point under the fingers fixed', () => {
    const mid = { x: 100, y: 50 };
    const v = pinchView(IDENTITY_VIEW, mid, 100, mid, 200, W, H);
    // content point c = mid (scale 1, x 0); after: x = mid - scale*c = 100 - 200
    expect(v.x).toBeCloseTo(-100); expect(v.y).toBeCloseTo(-50);
  });
  it('two-finger drag pans', () => {
    const start = { scale: 2, x: 0, y: 0 };
    const v = pinchView(start, { x: 0, y: 0 }, 100, { x: 30, y: 10 }, 100, W, H);
    expect(v.x).toBeCloseTo(30); expect(v.y).toBeCloseTo(10);
  });
  it('panView does nothing at 1x', () => {
    expect(panView(IDENTITY_VIEW, 50, 50, W, H)).toEqual(IDENTITY_VIEW);
  });
  it('zoomBy scales about the centre and returns to 1x', () => {
    const v = zoomBy(IDENTITY_VIEW, 2, W, H);
    expect(v.scale).toBe(2);
    expect(zoomBy(v, 0.5, W, H)).toEqual(IDENTITY_VIEW);
  });
});

describe('fmtTime / stillTitle', () => {
  it('formats m:ss.ff at 30fps', () => {
    expect(fmtTime(0)).toBe('0:00.00');
    expect(fmtTime(1.5)).toBe('0:01.15');
    expect(fmtTime(75.2)).toBe('1:15.06');
  });
  it('default still title', () => {
    expect(stillTitle(1.5)).toBe('Frame 0:01.15');
  });
});
