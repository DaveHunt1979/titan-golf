import { useState } from 'react';
import { Modal, View, Platform, TouchableOpacity, Text } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { st } from './styles';

// iOS: spinner in a bottom sheet with an explicit Done (a tap on an already
// selected value fires no onChange — see admin/build.tsx's date picker fix).
// Android: the native dialog, which closes itself.
export default function DateTimeSheet({ visible, mode, value, onConfirm, onClose }: {
  visible: boolean; mode: 'date' | 'time'; value: Date;
  onConfirm: (d: Date) => void; onClose: () => void;
}) {
  const [temp, setTemp] = useState(value);
  if (!visible) return null;
  if (Platform.OS === 'android') {
    return <DateTimePicker value={value} mode={mode} is24Hour minimumDate={mode === 'date' ? new Date() : undefined}
      onChange={(e, d) => { onClose(); if (e.type === 'set' && d) onConfirm(d); }} />;
  }
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={st.pickerOverlay}>
        <View style={[st.pickerSheet, { paddingTop: 8 }]}>
          <DateTimePicker value={temp} mode={mode} display="spinner" themeVariant="dark" is24Hour
            minimumDate={mode === 'date' ? new Date() : undefined}
            onChange={(_, d) => { if (d) setTemp(d); }} />
          <TouchableOpacity style={[st.primaryBtn, { marginHorizontal: 16 }]} onPress={() => { onConfirm(temp); onClose(); }} activeOpacity={0.85}>
            <Text style={st.primaryText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
