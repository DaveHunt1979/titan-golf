import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Switch, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { supabase, fetchAllRows } from '../../../src/lib/supabase';
import { useSocietyTheme } from '../../../src/lib/SocietyThemeContext';
import { goBack } from '../../../src/lib/navigation';
import PlayerSelectorSheet, { SelectablePlayer } from '../../../src/components/PlayerSelectorSheet';
import CoursePickerModal, { PickerCourse } from '../../../src/components/social18/CoursePickerModal';
import DateTimeSheet from '../../../src/components/social18/DateTimeSheet';
import { st, GOLD, FFB, RED } from '../../../src/components/social18/styles';
import { PRIZE_SPLITS, MoneyMethod } from '../../../src/lib/socialEvents';
import { createSocialEvent, updateSocialEvent, fetchSocialEvent, getMyPlayer, formatEventDate } from '../../../src/lib/socialEventsApi';

const METHODS: { value: MoneyMethod; label: string; desc: string }[] = [
  { value: 'none', label: 'No money', desc: 'Just golf' },
  { value: 'collector', label: 'One person collects', desc: 'Everyone pays the entry fee to one person up front' },
  { value: 'winners', label: 'Pay the winners', desc: 'Everyone pays the winners directly at the end' },
];

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export default function Social18Create() {
  const router = useRouter();
  const { id: editId } = useLocalSearchParams<{ id?: string }>();
  const { societyId } = useSocietyTheme() as any;
  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [name, setName] = useState('Social 18');
  const [date, setDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 3); return d; });
  const [tee, setTee] = useState<Date | null>(null);
  const [course, setCourse] = useState('');
  const [courses, setCourses] = useState<PickerCourse[]>([]);
  const [format, setFormat] = useState<'singles' | 'team'>('singles');
  const [method, setMethod] = useState<MoneyMethod>('none');
  const [fee, setFee] = useState('20');
  const [splitIdx, setSplitIdx] = useState(0);
  const [postToChat, setPostToChat] = useState(true);
  const [invitees, setInvitees] = useState<SelectablePlayer[]>([]);
  const [roster, setRoster] = useState<SelectablePlayer[]>([]);
  const [me, setMe] = useState<{ id: string; display_name: string } | null>(null);
  const [showCourse, setShowCourse] = useState(false);
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(!!editId);

  useEffect(() => { getMyPlayer().then(setMe); }, []);

  useEffect(() => {
    Promise.all([
      fetchAllRows<{ course_name: string }>((from, to) => supabase.from('course_holes').select('course_name').range(from, to)),
      fetchAllRows<{ name: string; region: string | null; country: string | null }>((from, to) => supabase.from('courses').select('name, region, country').range(from, to)),
    ]).then(([holes, meta]) => {
      const m: Record<string, { region: string | null; country: string | null }> = {};
      for (const r of meta) m[r.name] = { region: r.region, country: r.country };
      const names = [...new Set(holes.map(r => r.course_name).filter(Boolean))].sort() as string[];
      setCourses(names.map(n => ({ name: n, region: m[n]?.region ?? null, country: m[n]?.country ?? null })));
    });
  }, []);

  // Society roster for the invite picker (real players only, no guests).
  useEffect(() => {
    if (!societyId) return;
    (async () => {
      const { data: members } = await supabase.from('society_members').select('player_id').eq('society_id', societyId);
      const ids = (members ?? []).map((x: any) => x.player_id as string);
      if (!ids.length) return;
      const { data } = await supabase.from('players').select('id, display_name, avatar_url, is_guest').in('id', ids).order('display_name');
      setRoster(((data ?? []) as any[]).filter(p => !p.is_guest).map(p => ({ id: p.id, name: p.display_name, avatarUrl: p.avatar_url })));
    })();
  }, [societyId]);

  // Edit mode: prefill from the event.
  useEffect(() => {
    if (!editId) return;
    fetchSocialEvent(editId).then(ev => {
      if (ev) {
        setName(ev.name); setDate(new Date(`${ev.event_date}T12:00:00`));
        if (ev.tee_time) { const [h, m] = ev.tee_time.split(':').map(Number); const t = new Date(); t.setHours(h, m, 0, 0); setTee(t); }
        setCourse(ev.course_name ?? ''); setFormat(ev.format ?? 'singles'); setMethod(ev.money_method); setFee(String(ev.entry_fee));
        const idx = PRIZE_SPLITS.findIndex(s => JSON.stringify(s.value) === JSON.stringify(ev.prize_split));
        setSplitIdx(idx >= 0 ? idx : 0);
      }
      setLoadingEdit(false);
    });
  }, [editId]);

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#000' }}><StatusBar style="light" /></View>;

  async function save() {
    setFormError(null);
    if (!name.trim()) { setFormError('Give the day a name.'); return; }
    const entryFee = method === 'none' ? 0 : parseFloat(fee);
    if (method !== 'none' && (isNaN(entryFee) || entryFee < 0)) { setFormError('Enter an entry fee as a number, e.g. 20.'); return; }
    if (!me || !societyId) { setFormError('Not ready yet — please try again in a moment.'); return; }
    setSaving(true);
    try {
      const fields = {
        name, eventDate: isoOf(date), teeTime: tee ? hhmm(tee) : null, courseName: course || null,
        format, entryFee, currency: '£', moneyMethod: method, collectorId: method === 'collector' ? me.id : null,
        prizeSplit: PRIZE_SPLITS[splitIdx].value,
      };
      if (editId) {
        await updateSocialEvent(editId, fields);
        router.replace(`/(app)/social18/${editId}` as any);
      } else {
        const id = await createSocialEvent({
          ...fields, societyId, hostId: me.id, hostName: me.display_name,
          inviteeIds: invitees.map(i => i.id), postToChat,
        });
        router.replace(`/(app)/social18/${id}` as any);
      }
    } catch (e) {
      console.error('[social18.create] failed', e);
      setFormError('Could not save — please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loadingEdit) return <View style={st.container}><ActivityIndicator color={GOLD} style={{ marginTop: 80 }} /></View>;

  return (
    <View style={st.container}>
      <StatusBar style="light" />
      <View style={st.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/social18')} style={st.backBtn} activeOpacity={0.7}>
          <Text style={st.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={st.headerTitle}>{editId ? 'Edit Social 18' : 'Social 18 Create'}</Text>
        <View style={st.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
        <View><Text style={st.label}>NAME</Text>
          <TextInput style={st.input} value={name} onChangeText={setName} placeholder="Social 18" placeholderTextColor="#444" />
        </View>

        <View><Text style={st.label}>DATE</Text>
          <TouchableOpacity style={st.input} onPress={() => setShowDate(true)} activeOpacity={0.8}>
            <Text style={{ color: '#fff', fontFamily: FFB, fontSize: 15 }}>{formatEventDate(isoOf(date))}</Text>
          </TouchableOpacity>
        </View>

        <View><Text style={st.label}>TEE TIME (OPTIONAL)</Text>
          <TouchableOpacity style={st.input} onPress={() => setShowTime(true)} activeOpacity={0.8}>
            <Text style={{ color: tee ? '#fff' : '#444', fontFamily: FFB, fontSize: 15 }}>{tee ? hhmm(tee) : 'Pick a time'}</Text>
          </TouchableOpacity>
        </View>

        <View><Text style={st.label}>COURSE</Text>
          <TouchableOpacity style={st.input} onPress={() => setShowCourse(true)} activeOpacity={0.8}>
            <Text style={{ color: course ? '#fff' : '#444', fontFamily: FFB, fontSize: 15 }}>{course || 'Choose a course'}</Text>
          </TouchableOpacity>
        </View>

        <View><Text style={st.label}>FORMAT</Text>
          {([{ value: 'singles', label: 'Singles', desc: 'Everyone plays their own Stableford' }, { value: 'team', label: 'Team event', desc: 'Teams of 2, 3 or 4 — you pick the team size on the day' }] as const).map(f => (
            <TouchableOpacity key={f.value} style={[st.card, { marginBottom: 8, borderColor: format === f.value ? GOLD : '#1c1c1c' }]} onPress={() => setFormat(f.value)} activeOpacity={0.85}>
              <Text style={[st.rowName, format === f.value && { color: GOLD }]}>{f.label}</Text>
              <Text style={st.sub}>{f.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View><Text style={st.label}>MONEY</Text>
          {METHODS.map(m => (
            <TouchableOpacity key={m.value} style={[st.card, { marginBottom: 8, borderColor: method === m.value ? GOLD : '#1c1c1c' }]} onPress={() => setMethod(m.value)} activeOpacity={0.85}>
              <Text style={[st.rowName, method === m.value && { color: GOLD }]}>{m.label}</Text>
              <Text style={st.sub}>{m.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {method !== 'none' && (
          <>
            <View><Text style={st.label}>ENTRY FEE (£)</Text>
              <TextInput style={st.input} value={fee} onChangeText={setFee} keyboardType="decimal-pad" placeholder="20" placeholderTextColor="#444" />
            </View>
            <View><Text style={st.label}>PRIZE SPLIT</Text>
              {PRIZE_SPLITS.map((s, i) => (
                <TouchableOpacity key={s.label} style={[st.card, { marginBottom: 8, borderColor: splitIdx === i ? GOLD : '#1c1c1c' }]} onPress={() => setSplitIdx(i)} activeOpacity={0.85}>
                  <Text style={[st.rowName, splitIdx === i && { color: GOLD }]}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {!editId && (
          <>
            <View><Text style={st.label}>INVITE ({invitees.length})</Text>
              {invitees.map(p => (
                <View key={p.id} style={st.row}>
                  <Text style={st.rowName}>{p.name}</Text>
                  <TouchableOpacity onPress={() => setInvitees(prev => prev.filter(x => x.id !== p.id))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={{ color: '#9ca3af', fontFamily: FFB }}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity style={st.ghostBtn} onPress={() => setShowInvite(true)} activeOpacity={0.85}>
                <Text style={st.ghostText}>+ Invite players</Text>
              </TouchableOpacity>
            </View>

            <View style={[st.row, { justifyContent: 'space-between' }]}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={st.rowName}>Post to society chat</Text>
                <Text style={st.sub}>"Who wants in?" with an I'm in button</Text>
              </View>
              <Switch value={postToChat} onValueChange={setPostToChat}
                trackColor={{ false: '#1c1c1c', true: `${GOLD}66` }} thumbColor={postToChat ? GOLD : '#555'} />
            </View>
          </>
        )}

        {formError ? <Text style={[st.sub, { color: RED }]}>{formError}</Text> : null}
        <TouchableOpacity style={[st.redBtn, saving && st.disabled]} onPress={save} disabled={saving} activeOpacity={0.85}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={st.redText}>{editId ? 'Save changes' : 'Create & send invites'}</Text>}
        </TouchableOpacity>
      </ScrollView>

      <CoursePickerModal visible={showCourse} courses={courses} selected={course} onSelect={setCourse} onClose={() => setShowCourse(false)} />
      <DateTimeSheet visible={showDate} mode="date" value={date} onConfirm={setDate} onClose={() => setShowDate(false)} />
      <DateTimeSheet visible={showTime} mode="time" value={tee ?? new Date(new Date().setHours(9, 0, 0, 0))} onConfirm={setTee} onClose={() => setShowTime(false)} />
      <PlayerSelectorSheet
        visible={showInvite}
        title="Tap to invite"
        players={roster.filter(p => p.id !== me?.id && !invitees.some(i => i.id === p.id))}
        onSelect={p => setInvitees(prev => [...prev, p])}
        onClose={() => setShowInvite(false)}
      />
    </View>
  );
}
