import { View, Text, Modal, TouchableOpacity, FlatList, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { resolveAvatar } from '../lib/assets';

const GOLD = '#D4AF37';
const FF   = 'JUSTSans';
const FFB  = 'JUSTSans-ExBold';

export interface SelectablePlayer {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

// Reusable single-pick player sheet for the Info Pack rebuild (Rick's
// brief, section 5) — used by both the Committee and Room Sharing cards in
// admin/info.tsx. `flagLabels` marks a player with a soft warning (e.g.
// "already in Room 2") without blocking the pick — Rick's brief explicitly
// wants room-sharing duplicates preventable but overridable, not blocked.
export default function PlayerSelectorSheet({
  visible, title, players, flagLabels, onSelect, onClose,
}: {
  visible: boolean;
  title: string;
  players: SelectablePlayer[];
  flagLabels?: Record<string, string>;
  onSelect: (player: SelectablePlayer) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={s.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={s.title}>{title}</Text>
          <View style={{ width: 50 }} />
        </View>

        <FlatList
          data={players}
          keyExtractor={p => p.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          ListEmptyComponent={<Text style={s.empty}>No players enrolled yet</Text>}
          renderItem={({ item }) => {
            const flag = flagLabels?.[item.id];
            return (
              <TouchableOpacity style={s.row} onPress={() => onSelect(item)} activeOpacity={0.7}>
                <Image source={resolveAvatar(item.id, item.avatarUrl)} style={s.avatar} />
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{item.name}</Text>
                  {flag ? <Text style={s.flag}>{flag}</Text> : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color="#444" />
              </TouchableOpacity>
            );
          }}
        />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 20, paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  cancel: { fontSize: 14, fontFamily: FFB, color: '#fff', width: 50 },
  title:  { fontSize: 13, fontFamily: FFB, color: '#fff', letterSpacing: 1 },
  empty:  { fontSize: 13, fontFamily: FFB, color: '#444', textAlign: 'center', marginTop: 40 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1c1c1c' },
  name:   { fontSize: 14, fontFamily: FFB, color: '#fff' },
  flag:   { fontSize: 11, fontFamily: FFB, color: GOLD, marginTop: 2 },
});
