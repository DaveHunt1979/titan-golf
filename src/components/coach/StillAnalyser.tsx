import { useEffect, useState } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import AnalysisCanvas from './AnalysisCanvas';
import ZoomView from './ZoomView';
import EditTools from './EditTools';
import type { View as ViewState } from '../../lib/coachAnalysis';
import { Annotation, COLORS, IDENTITY_VIEW, Tool, fitBox } from '../../lib/coachAnalysis';
import { useDeviceLayout } from '../../lib/useDeviceLayout';

const noop = () => {};

interface Props {
  uri: string;
  annotations: Annotation[];
  onChange?: (next: Annotation[]) => void;   // omit for read-only
  aspect?: number | null;                    // aspect the drawings were made against
  onAspect?: (aspect: number) => void;
  onSave?: () => void;
  saving?: boolean;
  dirty?: boolean;
}

// Same drawing/zoom tools as VideoAnalyser, on a single still image: no
// scrubber or transport, every drawing lives at time 0.
export default function StillAnalyser({ uri, annotations, onChange, aspect: savedAspect, onAspect, onSave, saving, dirty }: Props) {
  const editable = !!onChange;
  const { isPad } = useDeviceLayout();
  const [detectedAspect, setDetectedAspect] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [color, setColor] = useState<string>(COLORS[0]);
  const [root, setRoot] = useState({ w: 0, h: 0 });
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<ViewState>(IDENTITY_VIEW);

  useEffect(() => {
    Image.getSize(uri, (w, h) => {
      if (w > 0 && h > 0) { setDetectedAspect(w / h); onAspect?.(w / h); }
    }, () => {});
  }, [uri]);

  const aspect = savedAspect ?? detectedAspect ?? 9 / 16;
  const box = fitBox(stage.w, stage.h, aspect);
  useEffect(() => setView(IDENTITY_VIEW), [box.width, box.height]);

  const landscape = isPad && root.w > root.h;

  return (
    <View style={[st.root, landscape && { flexDirection: 'row' }]} onLayout={e => setRoot({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <View style={st.stage} onLayout={e => setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {stage.w > 0 && (
          <ZoomView width={box.width} height={box.height} view={view} onViewChange={setView} panWithOneFinger={!(editable && tool)}>
            <View style={{ width: box.width, height: box.height }}>
              <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
              <AnalysisCanvas
                width={box.width} height={box.height} aspect={aspect} time={0}
                annotations={annotations} tool={editable ? tool : null} color={color} mode="all"
                onCommit={a => onChange?.([...annotations, a])} zoom={view.scale}
              />
            </View>
          </ZoomView>
        )}
      </View>
      <View style={[st.panel, landscape && st.panelSide]}>
        <EditTools
          editable={editable} tool={tool} color={color} mode="all" annotations={annotations}
          onTool={t => setTool(cur => (cur === t ? null : t))} onColor={setColor} onChange={onChange ?? noop}
          onSave={onSave} saving={saving} dirty={dirty}
          view={view} onView={setView} w={box.width} h={box.height}
        />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  panel: { backgroundColor: '#0d0d0d', padding: 14, gap: 10, borderTopWidth: 1, borderTopColor: '#1c1c1c' },
  panelSide: { width: 320, borderTopWidth: 0, borderLeftWidth: 1, borderLeftColor: '#1c1c1c' },
});
