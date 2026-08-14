import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useDynamicColors } from '../lib/SocietyThemeContext';

const FFB = 'JUSTSans-ExBold';
const FF  = 'JUSTSans';

// Dave dislikes native Alert.alert popups ("they look odd") — this is the
// on-brand replacement for new confirm/choice flows going forward.
export default function ConfirmDialog({
  visible, title, message, confirmLabel, destructive, onConfirm, onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dc = useDynamicColors();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.backdrop}>
        <View style={[s.card, { backgroundColor: dc.card, borderColor: dc.border }]}>
          <Text style={[s.title, { color: dc.cardText }]}>{title}</Text>
          <Text style={[s.message, { color: dc.textSecondary }]}>{message}</Text>

          <TouchableOpacity
            style={[s.btn, { backgroundColor: destructive ? '#f87171' : dc.gold }]}
            onPress={onConfirm}
            activeOpacity={0.85}
          >
            <Text style={[s.btnText, destructive && { color: '#1a0000' }]}>{confirmLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.cancelBtn} onPress={onCancel} activeOpacity={0.85}>
            <Text style={[s.cancelText, { color: dc.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  card: { width: '100%', maxWidth: 340, borderRadius: 16, borderWidth: 1, padding: 24 },
  title: { fontSize: 17, fontFamily: FFB, marginBottom: 8, textAlign: 'center' },
  message: { fontSize: 13, fontFamily: FF, textAlign: 'center', marginBottom: 20, lineHeight: 18 },
  btn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnText: { fontSize: 15, fontFamily: FFB, color: '#000' },
  cancelBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  cancelText: { fontSize: 14, fontFamily: FFB },
});
