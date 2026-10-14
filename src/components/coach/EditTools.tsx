import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { View as ViewState } from '../../lib/coachAnalysis';
import { Annotation, COLORS, IDENTITY_VIEW, Tool, zoomBy } from '../../lib/coachAnalysis';

const GOLD = '#D4AF37';
const FFB = 'JUSTSans-ExBold';
const FF = 'JUSTSans';

const TOOLS: { key: Tool; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'line',   label: 'Line',   icon: 'remove-outline' },
  { key: 'angle',  label: 'Angle',  icon: 'git-merge-outline' },
  { key: 'circle', label: 'Circle', icon: 'ellipse-outline' },
  { key: 'rect',   label: 'Box',    icon: 'square-outline' },
  { key: 'free',   label: 'Draw',   icon: 'brush-outline' },
];

interface Props {
  editable: boolean;
  tool: Tool | null;
  color: string;
  mode: 'all' | 'frame';
  annotations: Annotation[];
  onTool: (t: Tool) => void;
  onColor: (c: string) => void;
  onMode?: (m: 'all' | 'frame') => void;     // omit on a still: hides the frame/video choice
  onChange: (next: Annotation[]) => void;
  onSave?: () => void;
  saving?: boolean;
  dirty?: boolean;
  view: ViewState;
  onView: (v: ViewState) => void;
  w: number;
  h: number;
}

export default function EditTools({
  editable, tool, color, mode, annotations, onTool, onColor, onMode, onChange,
  onSave, saving, dirty, view, onView, w, h,
}: Props) {
  return (
    <>
      <View style={st.chipRow}>
        <TouchableOpacity style={st.chip} onPress={() => onView(zoomBy(view, 1 / 1.5, w, h))} activeOpacity={0.8}>
          <Text style={st.chipText}>−</Text>
        </TouchableOpacity>
        <TouchableOpacity style={st.chip} onPress={() => onView(zoomBy(view, 1.5, w, h))} activeOpacity={0.8}>
          <Text style={st.chipText}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity style={st.chip} onPress={() => onView(IDENTITY_VIEW)} activeOpacity={0.8}>
          <Text style={st.chipText}>Reset</Text>
        </TouchableOpacity>
        <Text style={st.time}>{view.scale.toFixed(1)}×</Text>
      </View>

      {editable && (
        <>
          <Text style={st.label}>TOOLS</Text>
          <View style={st.chipRow}>
            {TOOLS.map(t => (
              <TouchableOpacity key={t.key} style={[st.tool, tool === t.key && st.chipOn]} onPress={() => onTool(t.key)} activeOpacity={0.8}>
                <Ionicons name={t.icon} size={20} color={tool === t.key ? '#000' : '#fff'} />
                <Text style={[st.toolText, tool === t.key && st.chipTextOn]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {tool === 'angle' && <Text style={st.hint}>Tap three points: end of one arm, the corner, end of the other.</Text>}

          <View style={st.chipRow}>
            {COLORS.map(c => (
              <TouchableOpacity key={c} onPress={() => onColor(c)} activeOpacity={0.8}
                style={[st.swatch, { backgroundColor: c }, color === c && st.swatchOn]} />
            ))}
          </View>

          {onMode && (
            <View style={st.chipRow}>
              <TouchableOpacity style={[st.chip, mode === 'all' && st.chipOn]} onPress={() => onMode('all')} activeOpacity={0.8}>
                <Text style={[st.chipText, mode === 'all' && st.chipTextOn]}>Stays on whole video</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.chip, mode === 'frame' && st.chipOn]} onPress={() => onMode('frame')} activeOpacity={0.8}>
                <Text style={[st.chipText, mode === 'frame' && st.chipTextOn]}>This frame only</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={st.chipRow}>
            <TouchableOpacity style={st.chip} onPress={() => onChange(annotations.slice(0, -1))} disabled={!annotations.length} activeOpacity={0.8}>
              <Text style={[st.chipText, !annotations.length && { opacity: 0.4 }]}>Undo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.chip} onPress={() => onChange([])} disabled={!annotations.length} activeOpacity={0.8}>
              <Text style={[st.chipText, { color: '#f87171' }, !annotations.length && { opacity: 0.4 }]}>Clear all</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[st.save, (!dirty || saving) && { opacity: 0.45 }]} onPress={onSave} disabled={!dirty || saving} activeOpacity={0.85}>
            <Text style={st.saveText}>{saving ? 'Saving…' : dirty ? 'Save analysis' : 'Saved'}</Text>
          </TouchableOpacity>
        </>
      )}
    </>
  );
}

const st = StyleSheet.create({
  time: { color: '#fff', fontFamily: FF, fontSize: 11, width: 52, textAlign: 'center' },
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
