import { View, Text, Modal, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

const GOLD = '#D4AF37';
const FFB  = 'JUSTSans-ExBold';

export interface SelectableTee {
  tee_name: string;
  gender: string; // 'M' | 'F' | ''
  par: number | null;
  course_rating: number | null;
  slope_rating: number | null;
}

// One shared query so every round-setup screen (casual, swindle, tournament)
// reads tee/rating data the same way — course_tees is additive reference
// data from the course-master import, never guessed at or defaulted.
export async function fetchCourseTees(courseName: string): Promise<SelectableTee[]> {
  const { data } = await supabase
    .from('course_tees')
    .select('tee_name, gender, par, course_rating, slope_rating')
    .eq('course_name', courseName)
    .order('tee_name');
  return data ?? [];
}

function teeLabel(t: SelectableTee): string {
  return t.gender ? `${t.tee_name} (${t.gender})` : t.tee_name;
}

// Reusable single-pick tee sheet, modeled on PlayerSelectorSheet. Used by
// every round-setup screen to let each player independently pick which tee
// they're playing — WHS needs this to calculate a mixed-tee group (e.g. a
// lady or junior on a shorter tee) correctly, each player's own numbers.
export default function TeePickerSheet({
  visible, title, tees, onSelect, onClose,
}: {
  visible: boolean;
  title: string;
  tees: SelectableTee[];
  onSelect: (tee: SelectableTee) => void;
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
          data={tees}
          keyExtractor={t => `${t.tee_name}-${t.gender}`}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          ListEmptyComponent={<Text style={s.empty}>No tee data available for this course</Text>}
          renderItem={({ item }) => {
            const missingRating = item.par == null || item.course_rating == null || item.slope_rating == null;
            return (
              <TouchableOpacity style={s.row} onPress={() => onSelect(item)} activeOpacity={0.7}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{teeLabel(item)}</Text>
                  {missingRating ? (
                    <Text style={s.warn}>Rating data incomplete — WHS unavailable for this tee</Text>
                  ) : (
                    <Text style={s.detail}>Par {item.par} · CR {item.course_rating} · Slope {item.slope_rating}</Text>
                  )}
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
  name:   { fontSize: 14, fontFamily: FFB, color: '#fff' },
  detail: { fontSize: 11, fontFamily: FFB, color: GOLD, marginTop: 2 },
  warn:   { fontSize: 11, fontFamily: FFB, color: '#f87171', marginTop: 2 },
});
