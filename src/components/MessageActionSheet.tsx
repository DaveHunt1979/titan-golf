import { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDynamicColors } from '../lib/SocietyThemeContext';

const FFB = 'JUSTSans-ExBold';
const FF  = 'JUSTSans';
const RED = '#f87171';

export interface MessageAction {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  destructive?: boolean;
  // When set, tapping the option swaps THIS modal to a confirm step rather
  // than opening a second <Modal> — iOS silently drops a modal presented in
  // the same frame another one is dismissing.
  confirm?: { title: string; message: string; confirmLabel: string };
  onPress: () => void;
}

// Long-press action menu for a chat message (WhatsApp/iMessage style).
// Same visual convention as ConfirmDialog (Dave dislikes native Alert.alert
// popups) — dim backdrop, gold accent, 16px card — just with a list of
// options instead of a single yes/no.
export default function MessageActionSheet({ visible, preview, actions, onCancel }: {
  visible: boolean;
  preview: string;
  actions: MessageAction[];
  onCancel: () => void;
}) {
  const dc = useDynamicColors();
  const [confirming, setConfirming] = useState<MessageAction | null>(null);

  function close() { setConfirming(null); onCancel(); }

  function tapOption(action: MessageAction) {
    if (action.confirm) { setConfirming(action); return; }
    setConfirming(null);
    action.onPress();
  }

  const step = confirming?.confirm;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={s.backdrop} onPress={close}>
        <Pressable style={[s.card, { backgroundColor: dc.card, borderColor: dc.border }]} onPress={() => {}}>
          {step ? (
            <>
              <Text style={[s.title, { color: dc.cardText }]}>{step.title}</Text>
              <Text style={[s.message, { color: dc.textSecondary }]}>{step.message}</Text>
              <TouchableOpacity
                style={[s.btn, { backgroundColor: confirming?.destructive ? RED : dc.gold }]}
                onPress={() => { const action = confirming!; setConfirming(null); action.onPress(); }}
                activeOpacity={0.85}
              >
                <Text style={[s.btnText, confirming?.destructive && { color: '#1a0000' }]}>{step.confirmLabel}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {!!preview.trim() && (
                <View style={[s.preview, { borderLeftColor: dc.gold }]}>
                  <Text style={[s.previewText, { color: dc.textSecondary }]} numberOfLines={2}>{preview}</Text>
                </View>
              )}
              {actions.map(action => (
                <TouchableOpacity
                  key={action.label}
                  style={[s.option, { borderColor: dc.border }]}
                  onPress={() => tapOption(action)}
                  activeOpacity={0.85}
                >
                  <Ionicons name={action.icon} size={17} color={action.destructive ? RED : dc.gold} />
                  <Text style={[s.optionText, { color: action.destructive ? RED : dc.cardText }]}>{action.label}</Text>
                </TouchableOpacity>
              ))}
            </>
          )}

          <TouchableOpacity
            style={s.cancelBtn}
            onPress={step ? () => setConfirming(null) : close}
            activeOpacity={0.85}
          >
            <Text style={[s.cancelText, { color: dc.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  card: { width: '100%', maxWidth: 340, borderRadius: 16, borderWidth: 1, padding: 24 },

  preview: {
    borderLeftWidth: 2,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 16,
  },
  previewText: { fontSize: 12, fontFamily: FFB, lineHeight: 16 },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  optionText: { fontSize: 15, fontFamily: FFB },

  title: { fontSize: 17, fontFamily: FFB, marginBottom: 8, textAlign: 'center' },
  message: { fontSize: 13, fontFamily: FF, textAlign: 'center', marginBottom: 20, lineHeight: 18 },
  btn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnText: { fontSize: 15, fontFamily: FFB, color: '#000' },

  cancelBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  cancelText: { fontSize: 14, fontFamily: FFB },
});
