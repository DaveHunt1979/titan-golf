# Coach Analyse — George's Feedback (Autosave, Zoom, Screenshot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix George's "my lines didn't save", add pinch/pan zoom, and add a Screenshot button that saves the paused frame to the coach's library + Photos and opens it in the same drawing editor.

**Architecture:** Zoom is a pure-math module (`coachAnalysis.ts`) plus a `ZoomView` wrapper that transforms video+canvas together, so normalised annotation coordinates are untouched. Autosave is a debounced effect in the Analyse screen. Stills are library rows with `media_type='image'`, reusing `coach_video_library` + `coaching_analyses` (keyed by `library_video_id`), edited in a `StillAnalyser` that shares `EditTools` and `ZoomView` with `VideoAnalyser`.

**Tech Stack:** Expo SDK 54 (installed; AGENTS.md says v56 docs — the installed version wins, verify any API you use against `node_modules/expo-*/build/*.d.ts`), expo-video 3.0.x (`player.generateThumbnailsAsync`), expo-media-library, react-native-view-shot, expo-image-manipulator (NEW), react-native-svg, jest-expo.

## Global Constraints

- iOS **and** Android must both work (standing rule: ios-android parity).
- Do not break existing data: additive migration only, existing library rows default to `media_type='video'`.
- Reuse existing visual patterns (gold `#D4AF37`, JUSTSans fonts, chip/tool styles from `VideoAnalyser.tsx`). No `Alert.alert`; use on-brand UI.
- No `react-native-gesture-handler` / `reanimated` in this project: gestures use `PanResponder`.
- Run `npx jest src/lib/coachAnalysis.test.ts` and `npx tsc --noEmit 2>&1 | grep -E "coach|Coach"` — the pre-existing `react-native-webview` / `web/` tsc errors are to be ignored.
- Dave commits/pushes himself. **Do not run `git commit` or `git push`.** (Plan steps below that say "checkpoint" mean: run tests, stop.)
- Evidence from live DB (2026-10-13): `coaching_analyses` has exactly one row (Dave's test, 10 shapes). George never successfully saved, so saving works; the only path is a small "Save analysis" button he never pressed. Fix = autosave, not a DB fix.

## File Structure

- Modify `src/lib/coachAnalysis.ts` — add zoom math (`View`, `clampView`, `pinchView`, `zoomBy`).
- Modify `src/lib/coachAnalysis.test.ts` — tests for the above.
- Create `src/components/coach/ZoomView.tsx` — pinch/pan wrapper.
- Create `src/components/coach/EditTools.tsx` — tools/colours/mode/undo/clear/save/zoom buttons, extracted from `VideoAnalyser`.
- Modify `src/components/coach/VideoAnalyser.tsx` — use ZoomView + EditTools, add Screenshot button.
- Modify `src/components/coach/AnalysisCanvas.tsx` — `zoom` prop so strokes stay visually constant.
- Modify `app/(app)/coach/analyse/[videoId].tsx` — autosave, save-on-leave, still mode.
- Create `src/components/coach/StillAnalyser.tsx` — editor for a still image.
- Create `src/lib/coachStills.ts` — capture + upload + Photos save.
- Create `supabase/migrations/20261013000000_coach_stills.sql`.
- Modify `app/(app)/coach/library.tsx` — show stills, filter video-only consumers.

---

### Task 1: Autosave + save-on-leave

**Files:** Modify `app/(app)/coach/analyse/[videoId].tsx`

**Interfaces:** Produces header status `Saving…` / `Saved` / `Unsaved`; no signature changes.

- [ ] **Step 1: Make `save` re-entrant safe and snapshot-based.** Replace the `save` function (lines 82-97) with:

```tsx
  const savingRef = useRef(false);
  async function save() {
    if (!owner || !canEdit || savingRef.current) return;
    const snapshot = annotations;
    const snapshotJson = JSON.stringify(snapshot);
    if (snapshotJson === saved) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    const { error: e } = await supabase.from('coaching_analyses').upsert({
      coach_id: owner.coachId,
      player_id: owner.playerId,
      [isLibrary ? 'library_video_id' : 'coaching_video_id']: videoId,
      video_aspect: aspect,
      annotations: snapshot,
      updated_at: new Date().toISOString(),
    }, { onConflict: isLibrary ? 'library_video_id' : 'coaching_video_id' });
    savingRef.current = false;
    setSaving(false);
    if (e) { setError(e.message); return; }
    setSaved(snapshotJson);
  }
```

Add `useRef` to the react import.

- [ ] **Step 2: Debounced autosave + flush on unmount.** After the `dirty` line add:

```tsx
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!canEdit || !dirty) return;
    const h = setTimeout(() => saveRef.current(), 1500);
    return () => clearTimeout(h);
  }, [annotations, dirty, canEdit]);
  // Swiping back / leaving any way still saves the last edit.
  useEffect(() => () => { saveRef.current(); }, []);
```

- [ ] **Step 3: Back button waits for the save.** Replace the Back `onPress` with:

```tsx
onPress={async () => { if (canEdit && dirty) await save(); goBack(router, '/(app)/coach'); }}
```

- [ ] **Step 4: Visible status.** Replace the `Unsaved` Text (line 116) with:

```tsx
<Text style={[s.unsaved, !canEdit && { opacity: 0 }, !dirty && !saving && { color: '#4ade80' }]}>
  {saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved ✓'}
</Text>
```

- [ ] **Step 5: Typecheck + manual.** `npx tsc --noEmit 2>&1 | grep -i coach` → no new errors. Manual (Dave): draw a line, wait 2 s, header shows `Saved ✓`; kill app; reopen → line is there.

---

### Task 2: Zoom math (TDD)

**Files:** Modify `src/lib/coachAnalysis.ts`, `src/lib/coachAnalysis.test.ts`

**Interfaces — Produces:**
```ts
export interface View { scale: number; x: number; y: number }   // x,y = px translation, applied about the box centre
export const MIN_SCALE = 1; export const MAX_SCALE = 5;
export const IDENTITY_VIEW: View;
export function clampView(v: View, w: number, h: number): View;
export function pinchView(start: View, startMid: Pt, startDist: number, mid: Pt, dist: number, w: number, h: number): View; // mids in px relative to box centre
export function panView(start: View, dx: number, dy: number, w: number, h: number): View;
export function zoomBy(v: View, factor: number, w: number, h: number): View;
```

- [ ] **Step 1: Failing tests** (append to `coachAnalysis.test.ts`; import the new names):

```ts
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
```

- [ ] **Step 2: Run, expect FAIL** (`npx jest src/lib/coachAnalysis.test.ts` → "pinchView is not a function").

- [ ] **Step 3: Implement** (append to `coachAnalysis.ts`):

```ts
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
```

- [ ] **Step 4: Run, expect PASS** (all existing 13 + 6 new).

---

### Task 3: ZoomView + wire into VideoAnalyser + canvas stroke scaling

**Files:** Create `src/components/coach/ZoomView.tsx`, modify `AnalysisCanvas.tsx`, `VideoAnalyser.tsx`.

**Interfaces:** Consumes Task 2. Produces `<ZoomView width height view onViewChange panWithOneFinger>children</ZoomView>`; `AnalysisCanvas` gains optional `zoom?: number` (default 1).

- [ ] **Step 1: Create `ZoomView.tsx`:**

```tsx
import { useMemo, useRef } from 'react';
import { View, PanResponder, GestureResponderEvent } from 'react-native';
import { View as ZView, panView, pinchView } from '../../lib/coachAnalysis';

interface Props {
  width: number; height: number;
  view: ZView; onViewChange: (v: ZView) => void;
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
  const g = useRef({ n: 0, start: live.current.view, d0: 0, m0: { x: 0, y: 0 }, p0: { x: 0, y: 0 } });
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
    onPanResponderGrant: e => { measure(); rebase(e); },
    onPanResponderMove: e => {
      const t = e.nativeEvent.touches;
      if (t.length !== g.current.n) rebase(e);            // finger added/lifted: restart from here
      const L = live.current;
      if (t.length >= 2) {
        L.onViewChange(pinchView(g.current.start, g.current.m0, g.current.d0, rel(mid(t)), dist(t), L.width, L.height));
      } else if (t.length === 1 && L.panWithOneFinger) {
        L.onViewChange(panView(g.current.start, t[0].pageX - g.current.p0.x, t[0].pageY - g.current.p0.y, L.width, L.height));
      }
    },
    onPanResponderRelease: (e, gs) => {
      // Double-tap resets zoom.
      if (Math.hypot(gs.dx, gs.dy) < 6) {
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
```

Note: `View as ZView` is the type from `coachAnalysis` — if the name clash with RN `View` is confusing, import the type as `import type { View as ZoomState }` and use that name throughout.

- [ ] **Step 2: Canvas strokes constant on screen.** In `AnalysisCanvas.tsx` add `zoom?: number` to `Props`, destructure `zoom = 1`, pass `zoom` to `Shape`, and inside `Shape` use `strokeWidth: STROKE / zoom`, angle dots `r={4 / zoom}`, angle label `fontSize={18 / zoom}` and offsets `10 / zoom`. (Normalised points are unaffected.)

- [ ] **Step 3: Wire into `VideoAnalyser.tsx`.** Add state `const [view, setView] = useState<ViewState>(IDENTITY_VIEW);` Wrap the existing `<View style={{ width: box.width, height: box.height }}>` contents:

```tsx
<ZoomView width={box.width} height={box.height} view={view} onViewChange={setView} panWithOneFinger={!tool}>
  <View style={{ width: box.width, height: box.height }}>
    <VideoView .../>
    <AnalysisCanvas ... zoom={view.scale} />
  </View>
</ZoomView>
```

Reset the view when the box changes: `useEffect(() => setView(IDENTITY_VIEW), [box.width, box.height]);`

- [ ] **Step 4: Zoom buttons.** In the controls panel (above TOOLS, visible to viewers too) add a row: `−` (`zoomBy(view, 1/1.5, …)`), `+` (`zoomBy(view, 1.5, …)`), `Reset`, and a `{view.scale.toFixed(1)}×` label, styled with the existing `chip` styles.

- [ ] **Step 5: Verify.** `npx tsc --noEmit | grep -i coach`; jest passes. **Needs a real iPad/phone check:** (a) pinch zooms and video+lines stay aligned; (b) one-finger draw while zoomed lands under the finger (RN `locationX` in a scaled parent — if lines land offset, divide `locationX/Y` by `zoom` and add pan correction in `AnalysisCanvas.toPt`); (c) starting a draw then adding a second finger cancels the draft, not crashes.

---

### Task 4: Extract `EditTools` (pure refactor, no behaviour change)

**Files:** Create `src/components/coach/EditTools.tsx`; modify `VideoAnalyser.tsx`.

**Interfaces — Produces:**
```tsx
<EditTools tool color mode annotations onTool onColor onMode onChange onSave saving dirty zoom view onView w h />
```
- [ ] **Step 1:** Move the `editable` block (VideoAnalyser lines 142-184: TOOLS chips, angle hint, colour swatches, mode chips, undo/clear, save) and the `TOOLS` array plus the styles it uses (`label, chipRow, chip, chipOn, chipText, chipTextOn, tool, toolText, swatch, swatchOn, save, saveText`) into `EditTools.tsx`; also move the zoom button row from Task 3 there. Props: the values above; in `VideoAnalyser` pass `onTool={pickTool}` (which pauses the player first).
- [ ] **Step 2:** Replace the block in `VideoAnalyser` with `<EditTools …/>`. `npx jest` + `tsc` clean; manual smoke: tools still draw.

---

### Task 5: Migration for stills

**Files:** Create `supabase/migrations/20261013000000_coach_stills.sql`

- [ ] **Step 1:**

```sql
-- Titan Coach: stills (screenshots) saved from a paused swing frame.
-- Additive: existing library rows stay videos.
ALTER TABLE coach_video_library
  ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'video'
    CHECK (media_type IN ('video', 'image'));
```

RLS needs no change (same coach-owned rows, same `coaching-videos` bucket, same `library/{coach_id}/…` prefix). **Check:** the bucket's `allowed_mime_types` (Supabase dashboard → Storage → coaching-videos). If it is restricted to video types, image/png uploads fail — in that case add `image/png` and `image/jpeg` in the dashboard (tell Dave).
- [ ] **Step 2:** Give Dave the SQL to run in the dashboard SQL Editor (he applies migrations himself); do not apply it.

---

### Task 6: Capture, save, and open the still

**Files:** `npx expo install expo-image-manipulator` (native dep → new build), create `src/lib/coachStills.ts`, modify `VideoAnalyser.tsx`, `[videoId].tsx`, create `StillAnalyser.tsx`, modify `library.tsx`, `app.json` (Photos permission).

**Interfaces — Produces:**
```ts
// coachStills.ts
export async function grabFrame(player: VideoPlayer, time: number): Promise<{ uri: string; width: number; height: number }>;
export async function saveStill(args: { coachId: string; title: string; frameUri: string }): Promise<{ libraryId: string }>;
export async function saveToPhotos(uri: string): Promise<boolean>;   // false if permission denied
```
- [ ] **Step 1: `grabFrame`:**

```ts
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { VideoPlayer } from 'expo-video';

export async function grabFrame(player: VideoPlayer, time: number) {
  const [thumb] = await player.generateThumbnailsAsync(time, { maxWidth: 2160 });
  const ctx = ImageManipulator.manipulate(thumb);           // thumb is a SharedRef<'image'>
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ format: SaveFormat.PNG });
  return { uri: out.uri, width: out.width, height: out.height };
}
```
Verify the `manipulate(SharedRef)` overload in `node_modules/expo-image-manipulator/build/*.d.ts` after install; if it only takes a `uri`, fall back to enabling `surfaceType="textureView"` on `VideoView` and `captureRef` from react-native-view-shot on the video box instead.
- [ ] **Step 2: `saveStill`** — mirror the exact upload pattern already used in `app/(app)/coach/library.tsx` (read it: path `library/{coachId}/{timestamp}.png`, `supabase.storage.from('coaching-videos').upload(...)` with the file as an ArrayBuffer/blob the same way that screen does), then `insert` into `coach_video_library` `{ coach_id, title, storage_path, media_type: 'image', area: 'general' }` returning `id`. Default title `Frame {m:ss.ff}` (use `fmt(time)`).
- [ ] **Step 3: `saveToPhotos`** — `MediaLibrary.requestPermissionsAsync(true)` (write-only), `saveToLibraryAsync(uri)`. Add `NSPhotoLibraryAddUsageDescription` to `app.json` `ios.infoPlist` if missing (check `app.json` first; expo-media-library plugin may already provide it). Android 10+ needs no extra permission for add-only.
- [ ] **Step 4: Screenshot button** in `VideoAnalyser` panel (editable only): `Screenshot` chip → pause → `grabFrame(player, time)` → `saveStill` (needs `coachId` prop passed from the screen) → `saveToPhotos` of a copy **with drawings burned in** (render an offscreen `<View collapsable={false}>` containing RN `Image` + `AnalysisCanvas` read-only at the frame's time, `captureRef` it with react-native-view-shot, then `saveToPhotos`) → show an on-brand toast "Saved to your library and Photos" with an **Edit** button → `router.push` analyse `{ videoId: libraryId, source: 'library' }`. Disable the button while working (`busy` state).
- [ ] **Step 5: Still editing.** In `[videoId].tsx` select `media_type` in the library query; if `'image'`, render `<StillAnalyser uri annotations onChange aspect onAspect onSave saving dirty />` instead of `VideoAnalyser`. `StillAnalyser` = RN `Image` (resizeMode contain, aspect from `Image.getSize`) + `AnalysisCanvas` (time 0, mode `'all'`) inside `ZoomView`, with `EditTools` (no frame-step/scrub). Autosave already covers it because the screen owns the state. Pass `onAspect` from `Image.getSize`.
- [ ] **Step 6: Library list.** In `library.tsx`, rows with `media_type==='image'` show a signed-URL thumbnail via `Image` (not the video player) and an Analyse button; every other consumer of `coach_video_library` that attaches a video to a drill (grep `coach_video_library` in `app/`) must add `.eq('media_type','video')`.
- [ ] **Step 7: Verify.** tsc clean; jest passes; manual on iPad after the new build + SQL applied: pause on impact → Screenshot → appears in Photos and Library → Edit → draw, zoom, auto-saves → reopen from Library shows the lines.

---

### Task 7: Independent verification pass

- [ ] Dispatch `oh-my-claudecode:verifier` (separate lane from the authoring) with: git diff, tsc output, jest output, and the manual checklist above. Do not claim completion until it returns evidence.
- [ ] Final report to Dave must say what is *unverified* until an iPad build: gesture alignment (Task 3 step 5b), `generateThumbnailsAsync` exact-frame accuracy on iOS vs Android, and the Photos permission prompt.

---

## Out of scope — separate specs/plans (Dave: "do all phases")

Each of these needs its own brainstorm → spec → plan; none is specified well enough to build blind:

1. **Voice-over** (George asked; Dave told him phase 3/4). Record narration against the video timeline. Risk: `expo-av` caused the Android "Start New Round" crash (`caddie.ts`) — evaluate `expo-audio` rather than reuse `expo-av` casually.
2. **Side-by-side compare** vs a model swing (`is_model` library flag already exists), synced scrub/play, shared zoom.
3. **Coach records himself with drills** (record straight into the library, attach to drills).
4. **Players' tracked stats + AI coaching reports to coach** (new edge-function work; must follow the standing rule that new features feed society-scoped AI reports where relevant).
