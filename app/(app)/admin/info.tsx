import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import type {
  InfoSection, SectionType, ScheduleItem, TravelItem, ContactItem,
  TextSection, ScheduleSection, TravelSection, LocationSection, ContactsSection, RulesSection,
} from '../feed/index';

// ── TITAN constants ───────────────────────────────────────────
const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const RED    = '#f87171';
const PURPLE = '#a78bfa';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

// ── Section defaults ──────────────────────────────────────────
function newSection(type: SectionType): InfoSection {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  switch (type) {
    case 'text':     return { id, type, title: '', content: '' };
    case 'schedule': return { id, type, title: '', items: [{ time: '', label: '', note: '' }] };
    case 'travel':   return { id, type, title: '', items: [{ label: '', detail: '' }] };
    case 'location': return { id, type, title: '', name: '', address: '', phone: '', notes: '' };
    case 'contacts': return { id, type, title: '', items: [{ name: '', role: '', phone: '' }] };
    case 'rules':    return { id, type, title: '', items: [''] };
  }
}

const SECTION_TYPES: Array<{ id: SectionType; label: string; sub: string }> = [
  { id: 'schedule', label: 'Schedule', sub: 'Timetable with times'    },
  { id: 'travel',   label: 'Travel',   sub: 'Flights & transfers'      },
  { id: 'location', label: 'Location', sub: 'Hotel or venue details'   },
  { id: 'contacts', label: 'Contacts', sub: 'Key people & numbers'     },
  { id: 'text',     label: 'Text',     sub: 'Note or announcement'     },
  { id: 'rules',    label: 'Rules',    sub: 'Numbered list of rules'   },
];

// ── Main screen ───────────────────────────────────────────────
export default function InfoEditorScreen() {
  const router = useRouter();
  const [compId, setCompId]       = useState<string | null>(null);
  const [compName, setCompName]   = useState('');
  const [sections, setSections]   = useState<InfoSection[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('competitions')
        .select('id, name, info_sections')
        .eq('status', 'active')
        .neq('format', 'casual')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (data) {
        setCompId(data.id);
        setCompName(data.name);
        setSections((data.info_sections ?? []) as InfoSection[]);
      }
      setLoading(false);
    })();
  }, []);

  function update(id: string, patch: Partial<InfoSection>) {
    setSections(prev => prev.map(s => s.id === id ? { ...s, ...patch } as InfoSection : s));
  }

  function remove(id: string) {
    Alert.alert('Remove Section', 'Delete this section?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => setSections(prev => prev.filter(s => s.id !== id)) },
    ]);
  }

  function move(id: string, dir: 'up' | 'down') {
    setSections(prev => {
      const idx = prev.findIndex(s => s.id === id);
      const next = dir === 'up' ? idx - 1 : idx + 1;
      if (next < 0 || next >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr;
    });
  }

  function addSection(type: SectionType) {
    const s = newSection(type);
    setSections(prev => [...prev, s]);
    setExpandedId(s.id);
    setShowPicker(false);
  }

  function updateItem(sectionId: string, i: number, patch: any) {
    setSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      if (!('items' in s)) return s;
      const items = [...(s as any).items];
      items[i] = typeof items[i] === 'string' ? patch : { ...items[i], ...patch };
      return { ...s, items } as InfoSection;
    }));
  }

  function addItem(sectionId: string) {
    setSections(prev => prev.map(s => {
      if (s.id !== sectionId || !('items' in s)) return s;
      switch (s.type) {
        case 'schedule': return { ...s, items: [...s.items, { time: '', label: '', note: '' }] };
        case 'travel':   return { ...s, items: [...s.items, { label: '', detail: '' }] };
        case 'contacts': return { ...s, items: [...s.items, { name: '', role: '', phone: '' }] };
        case 'rules':    return { ...s, items: [...s.items, ''] };
        default: return s;
      }
    }));
  }

  function removeItem(sectionId: string, i: number) {
    setSections(prev => prev.map(s => {
      if (s.id !== sectionId || !('items' in s)) return s;
      return { ...s, items: (s as any).items.filter((_: any, idx: number) => idx !== i) } as InfoSection;
    }));
  }

  async function save() {
    if (!compId) return;
    setSaving(true);
    const { error } = await supabase
      .from('competitions')
      .update({ info_sections: sections })
      .eq('id', compId);
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Saved', 'Info pack updated.', [{ text: 'OK', onPress: () => router.back() }]);
    }
  }

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  if (!compId) {
    return (
      <View style={styles.centered}>
        <StatusBar style="light" />
        <Text style={styles.noComp}>No active competition found.</Text>
        <Text style={styles.noCompSub}>Build a tournament first from Society Tools.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.headerSide}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Image source={titanLogo} style={styles.logo} resizeMode="contain" />
          <Text style={styles.headerTitle}>Info Pack</Text>
          <Text style={styles.headerSub}>{compName}</Text>
        </View>
        <View style={styles.headerSide}>
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={save}
            disabled={saving}
            activeOpacity={0.8}
          >
            {saving
              ? <ActivityIndicator color="#000" size="small" />
              : <Text style={styles.saveBtnText}>Save</Text>
            }
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {sections.length === 0 && (
          <View style={styles.emptyHint}>
            <Text style={styles.emptyHintText}>Tap "+ Add Section" to start building the info pack.</Text>
            <Text style={styles.emptyHintSub}>Add your schedule, flights, hotel details, key contacts and rules.</Text>
          </View>
        )}

        {sections.map((section, idx) => (
          <SectionCard
            key={section.id}
            section={section}
            expanded={expandedId === section.id}
            isFirst={idx === 0}
            isLast={idx === sections.length - 1}
            onToggle={() => setExpandedId(expandedId === section.id ? null : section.id)}
            onUpdate={patch => update(section.id, patch)}
            onRemove={() => remove(section.id)}
            onMoveUp={() => move(section.id, 'up')}
            onMoveDown={() => move(section.id, 'down')}
            onAddItem={() => addItem(section.id)}
            onRemoveItem={i => removeItem(section.id, i)}
            onUpdateItem={(i, patch) => updateItem(section.id, i, patch)}
          />
        ))}

        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => setShowPicker(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.addBtnText}>+ Add Section</Text>
        </TouchableOpacity>

      </ScrollView>

      {/* Type picker overlay */}
      {showPicker && (
        <View style={styles.pickerOverlay}>
          <TouchableOpacity style={styles.pickerBackdrop} onPress={() => setShowPicker(false)} activeOpacity={1} />
          <View style={styles.pickerSheet}>
            <Text style={styles.pickerTitle}>Add Section</Text>
            {SECTION_TYPES.map(t => (
              <TouchableOpacity
                key={t.id}
                style={styles.pickerRow}
                onPress={() => addSection(t.id)}
                activeOpacity={0.7}
              >
                <Text style={styles.pickerLabel}>{t.label}</Text>
                <Text style={styles.pickerSub}>{t.sub}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.pickerCancel} onPress={() => setShowPicker(false)} activeOpacity={0.7}>
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// ── Section card ──────────────────────────────────────────────
interface SectionCardProps {
  section: InfoSection;
  expanded: boolean;
  isFirst: boolean;
  isLast: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<InfoSection>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onAddItem: () => void;
  onRemoveItem: (i: number) => void;
  onUpdateItem: (i: number, patch: any) => void;
}

function SectionCard(p: SectionCardProps) {
  const { section, expanded, isFirst, isLast } = p;
  const typeLabel = SECTION_TYPES.find(t => t.id === section.type)?.label ?? section.type;

  return (
    <View style={sc.container}>
      {/* Header row */}
      <TouchableOpacity style={sc.header} onPress={p.onToggle} activeOpacity={0.7}>
        <View style={sc.headerLeft}>
          <View style={sc.typeBadge}>
            <Text style={sc.typeLabel}>{typeLabel.toUpperCase()}</Text>
          </View>
          <Text style={sc.sectionTitle} numberOfLines={1}>
            {section.title || 'Untitled'}
          </Text>
        </View>
        <View style={sc.headerRight}>
          <TouchableOpacity onPress={p.onMoveUp} disabled={isFirst} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[sc.arrow, isFirst && sc.arrowOff]}>↑</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={p.onMoveDown} disabled={isLast} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[sc.arrow, isLast && sc.arrowOff]}>↓</Text>
          </TouchableOpacity>
          <Text style={sc.chevron}>{expanded ? '∨' : '›'}</Text>
        </View>
      </TouchableOpacity>

      {/* Editor (expanded) */}
      {expanded && (
        <View style={sc.editor}>
          <FieldLabel>TITLE</FieldLabel>
          <Inp value={section.title} onChange={v => p.onUpdate({ title: v } as any)} placeholder="Section heading" />

          {section.type === 'text' && (
            <>
              <FieldLabel>CONTENT</FieldLabel>
              <Inp value={section.content} onChange={v => p.onUpdate({ content: v } as any)} placeholder="Enter text..." multiline />
            </>
          )}

          {section.type === 'schedule' && (
            <>
              <FieldLabel>TIME SLOTS</FieldLabel>
              {section.items.map((item, i) => (
                <View key={i} style={sc.itemRow}>
                  <Inp value={item.time} onChange={v => p.onUpdateItem(i, { time: v })} placeholder="09:00" style={sc.timeField} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Inp value={item.label} onChange={v => p.onUpdateItem(i, { label: v })} placeholder="Event" />
                    <Inp value={item.note ?? ''} onChange={v => p.onUpdateItem(i, { note: v })} placeholder="Note (optional)" small />
                  </View>
                  <TouchableOpacity onPress={() => p.onRemoveItem(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={sc.removeItem}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <AddItemBtn label="+ Add time slot" onPress={p.onAddItem} />
            </>
          )}

          {section.type === 'travel' && (
            <>
              <FieldLabel>FLIGHTS / TRANSFERS</FieldLabel>
              {section.items.map((item, i) => (
                <View key={i} style={sc.itemRow}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Inp value={item.label} onChange={v => p.onUpdateItem(i, { label: v })} placeholder="e.g. Luton → Faro" />
                    <Inp value={item.detail} onChange={v => p.onUpdateItem(i, { detail: v })} placeholder="Flight no · times" small />
                  </View>
                  <TouchableOpacity onPress={() => p.onRemoveItem(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={sc.removeItem}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <AddItemBtn label="+ Add flight / transfer" onPress={p.onAddItem} />
            </>
          )}

          {section.type === 'location' && (
            <>
              <FieldLabel>VENUE NAME</FieldLabel>
              <Inp value={section.name} onChange={v => p.onUpdate({ name: v } as any)} placeholder="Hotel or venue name" />
              <FieldLabel>ADDRESS</FieldLabel>
              <Inp value={section.address ?? ''} onChange={v => p.onUpdate({ address: v } as any)} placeholder="Full address" />
              <FieldLabel>PHONE</FieldLabel>
              <Inp value={section.phone ?? ''} onChange={v => p.onUpdate({ phone: v } as any)} placeholder="+351 282..." keyboardType="phone-pad" />
              <FieldLabel>NOTES</FieldLabel>
              <Inp value={section.notes ?? ''} onChange={v => p.onUpdate({ notes: v } as any)} placeholder="Check-in times, access info..." multiline />
            </>
          )}

          {section.type === 'contacts' && (
            <>
              <FieldLabel>PEOPLE</FieldLabel>
              {section.items.map((item, i) => (
                <View key={i} style={sc.itemRow}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Inp value={item.name} onChange={v => p.onUpdateItem(i, { name: v })} placeholder="Name" />
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <Inp value={item.role ?? ''} onChange={v => p.onUpdateItem(i, { role: v })} placeholder="Role" style={{ flex: 1 }} small />
                      <Inp value={item.phone ?? ''} onChange={v => p.onUpdateItem(i, { phone: v })} placeholder="Phone" style={{ flex: 1 }} small keyboardType="phone-pad" />
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => p.onRemoveItem(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={sc.removeItem}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <AddItemBtn label="+ Add person" onPress={p.onAddItem} />
            </>
          )}

          {section.type === 'rules' && (
            <>
              <FieldLabel>RULES</FieldLabel>
              {section.items.map((item, i) => (
                <View key={i} style={sc.itemRow}>
                  <View style={sc.ruleNum}><Text style={sc.ruleNumText}>{i + 1}</Text></View>
                  <Inp value={item} onChange={v => p.onUpdateItem(i, v)} placeholder="Rule description" style={{ flex: 1 }} />
                  <TouchableOpacity onPress={() => p.onRemoveItem(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={sc.removeItem}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <AddItemBtn label="+ Add rule" onPress={p.onAddItem} />
            </>
          )}

          <TouchableOpacity style={sc.deleteBtn} onPress={p.onRemove} activeOpacity={0.7}>
            <Text style={sc.deleteBtnText}>Remove Section</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ── Small helpers ─────────────────────────────────────────────
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={sc.fieldLabel}>{children}</Text>;
}

function Inp({
  value, onChange, placeholder, multiline, small, style, keyboardType,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  small?: boolean;
  style?: any;
  keyboardType?: any;
}) {
  return (
    <TextInput
      style={[sc.input, small && sc.inputSmall, multiline && sc.inputMulti, style]}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor="#444"
      multiline={multiline}
      keyboardType={keyboardType}
      autoCapitalize="sentences"
    />
  );
}

function AddItemBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={sc.addItemBtn} onPress={onPress} activeOpacity={0.7}>
      <Text style={sc.addItemBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#000' },
  centered:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#000' },
  noComp:       { fontSize: 16, fontFamily: FFB, color: '#fff', marginBottom: 8 },
  noCompSub:    { fontSize: 13, fontFamily: FFB, color: '#fff', textAlign: 'center' },

  header: {
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
    flexDirection: 'row', alignItems: 'center',
  },
  headerSide:   { width: 72 },
  back:         { fontSize: 15, fontFamily: FFB, color: GOLD },
  headerCenter: { flex: 1, alignItems: 'center', gap: 2 },
  logo:         { width: 24, height: 24, marginBottom: 2 },
  headerTitle:  { fontSize: 15, fontFamily: FFB, color: '#fff' },
  headerSub:    { fontSize: 9, fontFamily: FFB, color: '#fff' },

  saveBtn: {
    backgroundColor: GOLD, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 6, minWidth: 56, alignItems: 'center',
    alignSelf: 'flex-end',
  },
  saveBtnText: { fontSize: 13, fontFamily: FFB, color: '#000' },

  scroll:       { padding: 16, paddingBottom: 48 },

  emptyHint:    { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  emptyHintText: { fontSize: 15, fontFamily: FFB, color: '#fff', marginBottom: 8, textAlign: 'center' },
  emptyHintSub: { fontSize: 13, fontFamily: FFB, color: '#444', textAlign: 'center', lineHeight: 20 },

  addBtn: {
    borderWidth: 1, borderColor: '#2a2a2a', borderStyle: 'dashed',
    borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', marginTop: 8,
  },
  addBtnText: { fontSize: 13, fontFamily: FFB, color: '#fff' },

  pickerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' },
  pickerBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  pickerSheet: {
    backgroundColor: '#111', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40, borderWidth: 1, borderColor: '#1c1c1c',
  },
  pickerTitle: { fontSize: 15, fontFamily: FFB, color: '#fff', marginBottom: 16 },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  pickerLabel:      { fontSize: 15, fontFamily: FFB, color: '#fff' },
  pickerSub:        { fontSize: 11, fontFamily: FFB, color: '#fff' },
  pickerCancel:     { alignItems: 'center', marginTop: 16 },
  pickerCancelText: { fontSize: 13, fontFamily: FFB, color: '#fff' },
});

const sc = StyleSheet.create({
  container: {
    backgroundColor: '#111', borderRadius: 14, borderWidth: 1,
    borderColor: '#1c1c1c', marginBottom: 10, overflow: 'hidden',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 14,
  },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  typeBadge: {
    backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)',
  },
  typeLabel:    { fontSize: 9, fontFamily: FFB, color: GOLD, letterSpacing: 1 },
  sectionTitle: { flex: 1, fontSize: 13, fontFamily: FFB, color: '#fff' },

  arrow:    { fontSize: 15, color: '#fff', fontFamily: FFB, padding: 2 },
  arrowOff: { color: '#222' },
  chevron:  { fontSize: 15, color: '#fff', width: 16, textAlign: 'center' },

  editor: { padding: 14, paddingTop: 0, borderTopWidth: 1, borderTopColor: '#1c1c1c' },

  fieldLabel: { fontSize: 9, fontFamily: FFB, color: '#fff', letterSpacing: 1.5, marginTop: 14, marginBottom: 6 },

  input: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 13, fontFamily: FFB, color: '#fff',
  },
  inputSmall: { paddingVertical: 7, fontSize: 11 },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },

  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 6 },
  timeField: { width: 58 },

  ruleNum: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(212,175,55,0.12)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)',
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  ruleNumText: { fontSize: 10, fontFamily: FFB, color: GOLD },

  removeItem: { fontSize: 20, color: '#fff', lineHeight: 22, paddingTop: 8 },

  addItemBtn: {
    marginTop: 6, paddingVertical: 8, alignItems: 'center',
    borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 12, borderStyle: 'dashed',
  },
  addItemBtnText: { fontSize: 11, fontFamily: FFB, color: '#fff' },

  deleteBtn:     { marginTop: 20, paddingVertical: 10, alignItems: 'center' },
  deleteBtnText: { fontSize: 11, fontFamily: FFB, color: RED, letterSpacing: 0.5 },
});
