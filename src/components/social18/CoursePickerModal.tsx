import { useState } from 'react';
import { Modal, KeyboardAvoidingView, Platform, View, Text, TouchableOpacity, ScrollView, TextInput, FlatList } from 'react-native';
import { st, GOLD, FFB } from './styles';

export interface PickerCourse { name: string; region: string | null; country: string | null }

// Same grouping as the tournament/casual/swindle course pickers.
const COUNTRY_TO_GROUP: Record<string, string> = {
  England: 'UK', Scotland: 'UK', Wales: 'UK', Ireland: 'UK', 'Northern Ireland': 'UK', 'Isle of Man': 'UK',
  France: 'Europe', Spain: 'Europe', Portugal: 'Europe', Italy: 'Europe', Germany: 'Europe', Austria: 'Europe',
  Belgium: 'Europe', Netherlands: 'Europe', Denmark: 'Europe', 'Czech Republic': 'Europe', Greece: 'Europe', Turkey: 'Europe',
  USA: 'USA', Morocco: 'Africa', 'South Africa': 'Africa', UAE: 'Middle East',
};
const COURSE_GROUP_ORDER = ['UK', 'Europe', 'USA', 'Africa', 'Middle East'];

export default function CoursePickerModal({ visible, courses, selected, onSelect, onClose }: {
  visible: boolean; courses: PickerCourse[]; selected: string;
  onSelect: (name: string) => void; onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState<string | null>(null);
  const finish = (name: string) => { onSelect(name); onClose(); setSearch(''); setRegion(null); };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={st.pickerOverlay}>
          <View style={st.pickerSheet}>
            <View style={st.pickerHeader}>
              <Text style={st.pickerTitle}>Select Course</Text>
              <TouchableOpacity onPress={onClose}><Text style={st.pickerClose}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ height: 48, marginBottom: 10, flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 2, alignItems: 'center' }}>
              {[{ key: null as string | null, label: 'All' },
                ...COURSE_GROUP_ORDER.filter(g => courses.some(c => (c.country ? COUNTRY_TO_GROUP[c.country] : null) === g)).map(g => ({ key: g as string | null, label: g })),
                ...(courses.some(c => !c.country || !COUNTRY_TO_GROUP[c.country]) ? [{ key: 'Other' as string | null, label: 'Other' }] : []),
              ].map(opt => (
                <TouchableOpacity key={opt.label} onPress={() => setRegion(opt.key)} activeOpacity={0.7}
                  style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 100, borderWidth: 1,
                    borderColor: region === opt.key ? GOLD : '#2a2a2a',
                    backgroundColor: region === opt.key ? 'rgba(212,175,55,0.14)' : 'transparent' }}>
                  <Text style={{ fontFamily: FFB, fontSize: 12.5, lineHeight: 18, color: region === opt.key ? GOLD : '#9ca3af' }}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TextInput style={st.pickerSearch} placeholder="Search courses…" placeholderTextColor="#444" value={search} onChangeText={setSearch} autoCorrect={false} clearButtonMode="while-editing" />
            <FlatList
              style={{ flexGrow: 0 }}
              data={courses
                .filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
                .filter(c => {
                  if (region === null) return true;
                  const g = c.country ? COUNTRY_TO_GROUP[c.country] ?? null : null;
                  return region === 'Other' ? g === null : g === region;
                })}
              keyExtractor={item => item.name}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity style={[st.pickerItem, selected === item.name && st.pickerItemActive]} onPress={() => finish(item.name)} activeOpacity={0.8}>
                  <Text style={[st.pickerItemText, selected === item.name && st.pickerItemTextActive]}>{item.name}</Text>
                  <Text style={st.pickerChevron}>{selected === item.name ? '✓' : '›'}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={st.pickerEmpty}>No courses found</Text>}
            />
            <TouchableOpacity style={st.pickerClear} onPress={() => finish('')}><Text style={st.pickerClearText}>Clear selection</Text></TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
