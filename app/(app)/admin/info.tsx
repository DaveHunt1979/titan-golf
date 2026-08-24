import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform,
  ActivityIndicator, Image,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import DateTimePicker from '@react-native-community/datetimepicker';
import { supabase } from '../../../src/lib/supabase';
import { goBack } from '../../../src/lib/navigation';
import { isoToUk, ukDateToDate, dateToUk, dateToHm, hmToDate } from '../../../src/lib/dateHelpers';
import PlayerSelectorSheet, { SelectablePlayer } from '../../../src/components/PlayerSelectorSheet';
import ConfirmDialog from '../../../src/components/ConfirmDialog';
import {
  emptyInfoPack,
  type InfoPack, type FlightLeg, type CommitteeEntry, type DinnerEntry,
  type RoomEntry, type TransportEntry, type TransportLeg, type RoundInfo, type RosterPlayer,
} from '../feed/index';

// ── TITAN constants ───────────────────────────────────────────
const GOLD   = '#D4AF37';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Trip-specific committee roles — deliberately separate from
// society_members.committee_role (a permanent society position like
// "Secretary"). This trip's role for a given player is suggested from that
// permanent role if set, but stored independently (Rick's examples —
// "Tournament Director", "Chairman" — are one-off event roles, not society
// positions).
const COMMITTEE_TRIP_ROLES = [
  'Tournament Director', 'Chairman', 'Treasurer', 'Secretary', 'Vice Captain', 'Social Secretary',
];

const STANDARD_LEGS: { id: TransportLeg; label: string; hasLocation: boolean; hasProvider: boolean }[] = [
  { id: 'airport-hotel', label: 'Airport → Hotel',      hasLocation: true,  hasProvider: true  },
  { id: 'hotel-golf',    label: 'Hotel → Golf Course',  hasLocation: false, hasProvider: true  },
  { id: 'golf-hotel',    label: 'Golf Course → Hotel',  hasLocation: false, hasProvider: false },
  { id: 'hotel-airport', label: 'Hotel → Airport',      hasLocation: false, hasProvider: false },
];

type CardKey = 'travel' | 'accommodation' | 'golf' | 'committee' | 'dinner' | 'rooms' | 'transport' | 'general';
const CARDS: { key: CardKey; label: string }[] = [
  { key: 'travel',        label: 'Travel' },
  { key: 'accommodation', label: 'Accommodation' },
  { key: 'golf',          label: 'Golf' },
  { key: 'committee',     label: 'Committee' },
  { key: 'dinner',        label: 'Dinner' },
  { key: 'rooms',         label: 'Room Sharing' },
  { key: 'transport',     label: 'Transport' },
  { key: 'general',       label: 'General Information' },
];

type PickerTarget =
  | { kind: 'flight-date'; leg: 'outbound' | 'return' }
  | { kind: 'flight-dep-time'; leg: 'outbound' | 'return' }
  | { kind: 'flight-arr-time'; leg: 'outbound' | 'return' }
  | { kind: 'tee-time'; dayId: string; index: number }
  | { kind: 'dinner-time'; id: string }
  | { kind: 'transport-time'; leg: TransportLeg; customId?: string };

// ── Main screen ───────────────────────────────────────────────
export default function InfoEditorScreen() {
  const router = useRouter();
  const { id: paramId, back: backParam } = useLocalSearchParams<{ id?: string; back?: string }>();
  const backTarget = backParam ?? '/(app)/admin/hub-tournament';

  const [compId, setCompId]       = useState<string | null>(null);
  const [compName, setCompName]   = useState('');
  const [societyId, setSocietyId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate]     = useState<string | null>(null);
  const [rounds, setRounds]       = useState<RoundInfo[]>([]);
  const [roster, setRoster]       = useState<RosterPlayer[]>([]);
  const [pack, setPack]           = useState<InfoPack>(emptyInfoPack());
  const [expanded, setExpanded]   = useState<CardKey | null>(null);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);

  const [activePicker, setActivePicker]         = useState<PickerTarget | null>(null);
  const [committeePickerOpen, setCommitteePickerOpen] = useState(false);
  const [roomPickerFor, setRoomPickerFor]        = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string; message: string; confirmLabel: string; destructive?: boolean; onConfirm: () => void;
  } | null>(null);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  useEffect(() => {
    (async () => {
      const { data } = paramId
        ? await supabase.from('competitions').select('id, name, society_id, start_date, end_date, info_pack').eq('id', paramId).single()
        : await supabase
            .from('competitions')
            .select('id, name, society_id, start_date, end_date, info_pack')
            .eq('status', 'active')
            .neq('format', 'casual')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

      if (data) {
        setCompId(data.id);
        setCompName(data.name);
        setSocietyId(data.society_id);
        setStartDate(data.start_date ?? null);
        setEndDate(data.end_date ?? null);
        setPack({ ...emptyInfoPack(), ...(data.info_pack ?? {}) });

        const [{ data: dayRows }, { data: playerRows }] = await Promise.all([
          supabase.from('competition_days').select('id, day_number, course_name').eq('competition_id', data.id).order('day_number'),
          supabase.from('competition_players').select('player_id, players(display_name, avatar_url)').eq('competition_id', data.id),
        ]);
        setRounds((dayRows ?? []).map((d: any) => ({ id: d.id, dayNumber: d.day_number, courseName: d.course_name })));
        setRoster((playerRows ?? []).map((p: any) => ({ id: p.player_id, name: p.players?.display_name ?? '?', avatarUrl: p.players?.avatar_url ?? null })));
      }
      setLoading(false);
    })();
  }, [paramId]);

  function updatePack(patch: Partial<InfoPack>) {
    setPack(prev => ({ ...prev, ...patch }));
  }

  // ── Hotels ──
  function addHotel() { updatePack({ hotels: [...pack.hotels, ''] }); }
  function updateHotel(i: number, v: string) { const next = [...pack.hotels]; next[i] = v; updatePack({ hotels: next }); }
  function removeHotel(i: number) { updatePack({ hotels: pack.hotels.filter((_, idx) => idx !== i) }); }

  // ── Flights ──
  function updateFlightField(leg: 'outbound' | 'return', field: keyof FlightLeg, value: string) {
    setPack(prev => ({ ...prev, flights: { ...prev.flights, [leg]: { ...prev.flights[leg], [field]: value } } }));
  }

  // ── Tee times ──
  function addTeeTime(dayId: string) {
    const list = [...(pack.teeTimes[dayId] ?? []), '09:00'];
    setPack(prev => ({ ...prev, teeTimes: { ...prev.teeTimes, [dayId]: list } }));
    setActivePicker({ kind: 'tee-time', dayId, index: list.length - 1 });
  }
  function updateTeeTime(dayId: string, index: number, value: string) {
    setPack(prev => {
      const list = [...(prev.teeTimes[dayId] ?? [])];
      list[index] = value;
      return { ...prev, teeTimes: { ...prev.teeTimes, [dayId]: list } };
    });
  }
  function removeTeeTime(dayId: string, index: number) {
    setPack(prev => ({ ...prev, teeTimes: { ...prev.teeTimes, [dayId]: (prev.teeTimes[dayId] ?? []).filter((_, i) => i !== index) } }));
  }

  // ── Committee ──
  async function addCommitteeMember(player: SelectablePlayer) {
    setCommitteePickerOpen(false);
    let prefill = '';
    if (societyId) {
      const { data } = await supabase.from('society_members').select('committee_role').eq('society_id', societyId).eq('player_id', player.id).maybeSingle();
      prefill = (data as any)?.committee_role ?? '';
    }
    const entry: CommitteeEntry = { id: newId(), playerId: player.id, role: prefill };
    setPack(prev => ({ ...prev, committee: [...prev.committee, entry] }));
  }
  function updateCommitteeRole(id: string, role: string) {
    setPack(prev => ({ ...prev, committee: prev.committee.map(c => c.id === id ? { ...c, role } : c) }));
  }
  function removeCommitteeMember(id: string) {
    setPack(prev => ({ ...prev, committee: prev.committee.filter(c => c.id !== id) }));
  }

  // ── Dinner ──
  function addDinner() {
    const entry: DinnerEntry = { id: newId(), day: '', restaurant: '', time: '', dressCode: '', notes: '' };
    setPack(prev => ({ ...prev, dinners: [...prev.dinners, entry] }));
  }
  function updateDinner(id: string, patch: Partial<DinnerEntry>) {
    setPack(prev => ({ ...prev, dinners: prev.dinners.map(d => d.id === id ? { ...d, ...patch } : d) }));
  }
  function removeDinner(id: string) {
    setPack(prev => ({ ...prev, dinners: prev.dinners.filter(d => d.id !== id) }));
  }

  // ── Room sharing ──
  function addRoom() {
    const entry: RoomEntry = { id: newId(), playerIds: [] };
    setPack(prev => ({ ...prev, rooms: [...prev.rooms, entry] }));
  }
  function removeRoom(id: string) {
    setPack(prev => ({ ...prev, rooms: prev.rooms.filter(r => r.id !== id) }));
  }
  function removePlayerFromRoom(roomId: string, playerId: string) {
    setPack(prev => ({ ...prev, rooms: prev.rooms.map(r => r.id === roomId ? { ...r, playerIds: r.playerIds.filter(id => id !== playerId) } : r) }));
  }
  function handleRoomPlayerSelect(player: SelectablePlayer) {
    const roomId = roomPickerFor;
    setRoomPickerFor(null);
    if (!roomId) return;
    const doAdd = () => setPack(prev => ({
      ...prev,
      rooms: prev.rooms.map(r => r.id === roomId ? { ...r, playerIds: [...r.playerIds, player.id] } : r),
    }));
    const elsewhereIdx = pack.rooms.findIndex(r => r.id !== roomId && r.playerIds.includes(player.id));
    if (elsewhereIdx >= 0) {
      setConfirm({
        title: 'Already Sharing a Room',
        message: `${player.name} is already assigned to Room ${elsewhereIdx + 1}. Add them here as well?`,
        confirmLabel: 'Add Anyway',
        onConfirm: () => { setConfirm(null); doAdd(); },
      });
    } else {
      doAdd();
    }
  }

  // ── Transport ──
  function updateStandardLeg(leg: TransportLeg, patch: Partial<TransportEntry>) {
    setPack(prev => {
      const exists = prev.transport.find(t => t.leg === leg);
      const transport = exists
        ? prev.transport.map(t => t.leg === leg ? { ...t, ...patch } : t)
        : [...prev.transport, { id: newId(), leg, pickupTime: '', notes: '', ...patch } as TransportEntry];
      return { ...prev, transport };
    });
  }
  function addCustomTransport() {
    const entry: TransportEntry = { id: newId(), leg: 'custom', label: '', pickupTime: '', pickupLocation: '', provider: '', notes: '' };
    setPack(prev => ({ ...prev, transport: [...prev.transport, entry] }));
  }
  function updateCustomTransport(id: string, patch: Partial<TransportEntry>) {
    setPack(prev => ({ ...prev, transport: prev.transport.map(t => t.id === id ? { ...t, ...patch } : t) }));
  }
  function removeCustomTransport(id: string) {
    setPack(prev => ({ ...prev, transport: prev.transport.filter(t => t.id !== id) }));
  }

  // ── Date/time picker plumbing ──
  function pickerMode(target: PickerTarget): 'date' | 'time' {
    return target.kind === 'flight-date' ? 'date' : 'time';
  }
  function pickerValue(target: PickerTarget): Date {
    switch (target.kind) {
      case 'flight-date':     return pack.flights[target.leg].departureDate ? ukDateToDate(pack.flights[target.leg].departureDate) : new Date();
      case 'flight-dep-time': return hmToDate(pack.flights[target.leg].departureTime);
      case 'flight-arr-time': return hmToDate(pack.flights[target.leg].arrivalTime);
      case 'tee-time':        return hmToDate(pack.teeTimes[target.dayId]?.[target.index] ?? '');
      case 'dinner-time':     return hmToDate(pack.dinners.find(d => d.id === target.id)?.time ?? '');
      case 'transport-time': {
        const t = target.leg === 'custom' ? pack.transport.find(x => x.id === target.customId) : pack.transport.find(x => x.leg === target.leg);
        return hmToDate(t?.pickupTime ?? '');
      }
    }
  }
  function applyPickerValue(target: PickerTarget, selected: Date) {
    switch (target.kind) {
      case 'flight-date':     updateFlightField(target.leg, 'departureDate', dateToUk(selected)); break;
      case 'flight-dep-time': updateFlightField(target.leg, 'departureTime', dateToHm(selected)); break;
      case 'flight-arr-time': updateFlightField(target.leg, 'arrivalTime', dateToHm(selected)); break;
      case 'tee-time':        updateTeeTime(target.dayId, target.index, dateToHm(selected)); break;
      case 'dinner-time':     updateDinner(target.id, { time: dateToHm(selected) }); break;
      case 'transport-time':
        if (target.leg === 'custom' && target.customId) updateCustomTransport(target.customId, { pickupTime: dateToHm(selected) });
        else updateStandardLeg(target.leg, { pickupTime: dateToHm(selected) });
        break;
    }
  }

  async function save() {
    if (!compId) return;
    setSaving(true);
    const { error } = await supabase.from('competitions').update({ info_pack: pack }).eq('id', compId);
    setSaving(false);
    if (error) {
      setConfirm({ title: 'Error', message: error.message, confirmLabel: 'OK', onConfirm: () => setConfirm(null) });
    } else {
      setConfirm({
        title: 'Saved', message: 'Info pack updated.', confirmLabel: 'OK',
        onConfirm: () => { setConfirm(null); goBack(router, backTarget); },
      });
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

  const courseNames = Array.from(new Set(rounds.map(r => r.courseName).filter(Boolean))) as string[];
  const committeeRoster = roster.filter(p => !pack.committee.some(c => c.playerId === p.id));
  const activeRoom = pack.rooms.find(r => r.id === roomPickerFor);
  const roomRoster = activeRoom ? roster.filter(p => !activeRoom.playerIds.includes(p.id)) : [];
  const roomFlags: Record<string, string> = {};
  if (activeRoom) {
    pack.rooms.forEach((r, idx) => {
      if (r.id === activeRoom.id) return;
      r.playerIds.forEach(pid => { roomFlags[pid] = `Already in Room ${idx + 1}`; });
    });
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goBack(router, backTarget)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.headerSide}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Image source={titanLogo} style={styles.logo} resizeMode="contain" />
          <Text style={styles.headerTitle}>Info Pack</Text>
          <Text style={styles.headerSub}>{compName}</Text>
        </View>
        <View style={styles.headerSide}>
          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} activeOpacity={0.8}>
            {saving ? <ActivityIndicator color="#000" size="small" /> : <Text style={styles.saveBtnText}>Save</Text>}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {CARDS.map(c => (
          <View key={c.key} style={sc.container}>
            <TouchableOpacity style={sc.header} onPress={() => setExpanded(expanded === c.key ? null : c.key)} activeOpacity={0.7}>
              <Text style={sc.cardTitle}>{c.label}</Text>
              <Text style={sc.chevron}>{expanded === c.key ? '∨' : '›'}</Text>
            </TouchableOpacity>

            {expanded === c.key && (
              <View style={sc.editor}>
                {c.key === 'travel' && (
                  <>
                    {(['outbound', 'return'] as const).map(leg => {
                      const f = pack.flights[leg];
                      return (
                        <View key={leg} style={{ marginBottom: 20 }}>
                          <FieldLabel>{leg === 'outbound' ? 'OUTBOUND FLIGHT' : 'RETURN FLIGHT'}</FieldLabel>
                          {(f.departureAirport || f.arrivalAirport) && (
                            <View style={fl.route}>
                              <Text style={fl.routeAirport}>{f.departureAirport || '—'}</Text>
                              <Text style={fl.routeArrow}>↓</Text>
                              <Text style={fl.routeAirport}>{f.arrivalAirport || '—'}</Text>
                            </View>
                          )}
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            <Inp value={f.airline} onChange={v => updateFlightField(leg, 'airline', v)} placeholder="Airline" style={{ flex: 1 }} />
                            <Inp value={f.flightNumber} onChange={v => updateFlightField(leg, 'flightNumber', v)} placeholder="Flight No." style={{ flex: 1 }} />
                          </View>
                          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                            <Inp value={f.departureAirport} onChange={v => updateFlightField(leg, 'departureAirport', v)} placeholder="Departure Airport" style={{ flex: 1 }} />
                            <Inp value={f.arrivalAirport} onChange={v => updateFlightField(leg, 'arrivalAirport', v)} placeholder="Arrival Airport" style={{ flex: 1 }} />
                          </View>
                          <View style={{ marginTop: 6 }}>
                            <FieldLabel>DEPARTURE DATE</FieldLabel>
                            <PickerField value={f.departureDate} placeholder="DD-MM-YYYY" onPress={() => setActivePicker({ kind: 'flight-date', leg })} />
                          </View>
                          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                            <View style={{ flex: 1 }}>
                              <FieldLabel>DEP. TIME</FieldLabel>
                              <PickerField value={f.departureTime} placeholder="--:--" onPress={() => setActivePicker({ kind: 'flight-dep-time', leg })} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <FieldLabel>ARR. TIME</FieldLabel>
                              <PickerField value={f.arrivalTime} placeholder="--:--" onPress={() => setActivePicker({ kind: 'flight-arr-time', leg })} />
                            </View>
                          </View>
                        </View>
                      );
                    })}
                  </>
                )}

                {c.key === 'accommodation' && (
                  <>
                    <FieldLabel>TOURNAMENT DATES</FieldLabel>
                    <View style={ro.row}>
                      <Text style={ro.text}>{startDate ? isoToUk(startDate) : 'Not set'} → {endDate ? isoToUk(endDate) : 'Not set'}</Text>
                    </View>
                    <Text style={ro.hint}>Inherited from the Tournament Builder.</Text>

                    <FieldLabel>GOLF COURSES</FieldLabel>
                    {courseNames.length === 0 && <Text style={ro.hint}>No courses set yet in the Builder.</Text>}
                    {courseNames.map(name => (
                      <View key={name} style={ro.row}><Text style={ro.text}>{name}</Text></View>
                    ))}

                    <FieldLabel>HOTELS</FieldLabel>
                    {pack.hotels.map((h, i) => (
                      <View key={i} style={sc.itemRow}>
                        <Inp value={h} onChange={v => updateHotel(i, v)} placeholder="Hotel name" style={{ flex: 1 }} />
                        <TouchableOpacity onPress={() => removeHotel(i)} hitSlop={hit}><Text style={sc.removeItem}>×</Text></TouchableOpacity>
                      </View>
                    ))}
                    <AddItemBtn label="+ Add Hotel" onPress={addHotel} />
                  </>
                )}

                {c.key === 'golf' && (
                  <>
                    {rounds.length === 0 && <Text style={ro.hint}>No rounds set yet in the Builder.</Text>}
                    {rounds.map(r => (
                      <View key={r.id} style={{ marginBottom: 16 }}>
                        <FieldLabel>ROUND {r.dayNumber}{r.courseName ? ` · ${r.courseName}` : ''}</FieldLabel>
                        {(pack.teeTimes[r.id] ?? []).map((t, i) => (
                          <View key={i} style={sc.itemRow}>
                            <TouchableOpacity style={[sc.input, sc.timeField]} onPress={() => setActivePicker({ kind: 'tee-time', dayId: r.id, index: i })} activeOpacity={0.8}>
                              <Text style={{ fontFamily: FF, fontSize: 13, color: '#fff' }}>{t}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => removeTeeTime(r.id, i)} hitSlop={hit}><Text style={sc.removeItem}>×</Text></TouchableOpacity>
                          </View>
                        ))}
                        <AddItemBtn label="+ Add Tee Time" onPress={() => addTeeTime(r.id)} />
                      </View>
                    ))}
                  </>
                )}

                {c.key === 'committee' && (
                  <>
                    {pack.committee.map(entry => {
                      const player = roster.find(p => p.id === entry.playerId);
                      return (
                        <View key={entry.id} style={cm.card}>
                          <View style={cm.rowHeader}>
                            <Text style={cm.name}>{player?.name ?? 'Unknown player'}</Text>
                            <TouchableOpacity onPress={() => removeCommitteeMember(entry.id)} hitSlop={hit}><Text style={sc.removeItem}>×</Text></TouchableOpacity>
                          </View>
                          <View style={cm.chips}>
                            {COMMITTEE_TRIP_ROLES.map(r => (
                              <TouchableOpacity key={r} style={[cm.chip, entry.role === r && cm.chipOn]} onPress={() => updateCommitteeRole(entry.id, r)} activeOpacity={0.8}>
                                <Text style={[cm.chipText, entry.role === r && cm.chipTextOn]}>{r}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                          <Inp value={entry.role} onChange={v => updateCommitteeRole(entry.id, v)} placeholder="Or type a custom role…" small />
                        </View>
                      );
                    })}
                    <AddItemBtn label="+ Add Committee Member" onPress={() => setCommitteePickerOpen(true)} />
                  </>
                )}

                {c.key === 'dinner' && (
                  <>
                    {pack.dinners.map(d => (
                      <View key={d.id} style={cm.card}>
                        <View style={cm.rowHeader}>
                          <Inp value={d.day} onChange={v => updateDinner(d.id, { day: v })} placeholder="e.g. Wednesday" style={{ flex: 1 }} />
                          <TouchableOpacity onPress={() => removeDinner(d.id)} hitSlop={hit}><Text style={sc.removeItem}>×</Text></TouchableOpacity>
                        </View>
                        <FieldLabel>RESTAURANT</FieldLabel>
                        <Inp value={d.restaurant} onChange={v => updateDinner(d.id, { restaurant: v })} placeholder="Restaurant name" />
                        <FieldLabel>TIME</FieldLabel>
                        <PickerField value={d.time} placeholder="--:--" onPress={() => setActivePicker({ kind: 'dinner-time', id: d.id })} />
                        <FieldLabel>DRESS CODE</FieldLabel>
                        <Inp value={d.dressCode} onChange={v => updateDinner(d.id, { dressCode: v })} placeholder="e.g. Smart Casual" />
                        <FieldLabel>NOTES</FieldLabel>
                        <Inp value={d.notes} onChange={v => updateDinner(d.id, { notes: v })} placeholder="Optional notes" multiline />
                      </View>
                    ))}
                    <AddItemBtn label="+ Add Dinner" onPress={addDinner} />
                  </>
                )}

                {c.key === 'rooms' && (
                  <>
                    {pack.rooms.map((r, idx) => (
                      <View key={r.id} style={cm.card}>
                        <View style={cm.rowHeader}>
                          <Text style={cm.name}>Room {idx + 1}</Text>
                          <TouchableOpacity onPress={() => removeRoom(r.id)} hitSlop={hit}><Text style={sc.removeItem}>×</Text></TouchableOpacity>
                        </View>
                        <View style={cm.chips}>
                          {r.playerIds.map(pid => {
                            const player = roster.find(p => p.id === pid);
                            return (
                              <View key={pid} style={cm.playerChip}>
                                <Text style={cm.playerChipText}>{player?.name ?? '?'}</Text>
                                <TouchableOpacity onPress={() => removePlayerFromRoom(r.id, pid)} hitSlop={hit}>
                                  <Text style={cm.playerChipRemove}>×</Text>
                                </TouchableOpacity>
                              </View>
                            );
                          })}
                        </View>
                        <AddItemBtn label="+ Add Player" onPress={() => setRoomPickerFor(r.id)} />
                      </View>
                    ))}
                    <AddItemBtn label="+ Add Room" onPress={addRoom} />
                  </>
                )}

                {c.key === 'transport' && (
                  <>
                    {STANDARD_LEGS.map(leg => {
                      const entry = pack.transport.find(t => t.leg === leg.id);
                      return (
                        <View key={leg.id} style={cm.card}>
                          <FieldLabel>{leg.label.toUpperCase()}</FieldLabel>
                          <Text style={ro.hint}>PICKUP TIME</Text>
                          <PickerField value={entry?.pickupTime ?? ''} placeholder="--:--" onPress={() => setActivePicker({ kind: 'transport-time', leg: leg.id })} />
                          {leg.hasLocation && (
                            <>
                              <FieldLabel>PICKUP LOCATION</FieldLabel>
                              <Inp value={entry?.pickupLocation ?? ''} onChange={v => updateStandardLeg(leg.id, { pickupLocation: v })} placeholder="Pickup location" />
                            </>
                          )}
                          {leg.hasProvider && (
                            <>
                              <FieldLabel>TRANSPORT PROVIDER</FieldLabel>
                              <Inp value={entry?.provider ?? ''} onChange={v => updateStandardLeg(leg.id, { provider: v })} placeholder="Provider name" />
                            </>
                          )}
                          <FieldLabel>NOTES</FieldLabel>
                          <Inp value={entry?.notes ?? ''} onChange={v => updateStandardLeg(leg.id, { notes: v })} placeholder="Optional notes" multiline small />
                        </View>
                      );
                    })}

                    {pack.transport.filter(t => t.leg === 'custom').map(t => (
                      <View key={t.id} style={cm.card}>
                        <View style={cm.rowHeader}>
                          <Inp value={t.label ?? ''} onChange={v => updateCustomTransport(t.id, { label: v })} placeholder="e.g. Course transfer" style={{ flex: 1 }} />
                          <TouchableOpacity onPress={() => removeCustomTransport(t.id)} hitSlop={hit}><Text style={sc.removeItem}>×</Text></TouchableOpacity>
                        </View>
                        <FieldLabel>PICKUP TIME</FieldLabel>
                        <PickerField value={t.pickupTime} placeholder="--:--" onPress={() => setActivePicker({ kind: 'transport-time', leg: 'custom', customId: t.id })} />
                        <FieldLabel>PICKUP LOCATION</FieldLabel>
                        <Inp value={t.pickupLocation ?? ''} onChange={v => updateCustomTransport(t.id, { pickupLocation: v })} placeholder="Pickup location" />
                        <FieldLabel>TRANSPORT PROVIDER</FieldLabel>
                        <Inp value={t.provider ?? ''} onChange={v => updateCustomTransport(t.id, { provider: v })} placeholder="Provider name" />
                        <FieldLabel>NOTES</FieldLabel>
                        <Inp value={t.notes} onChange={v => updateCustomTransport(t.id, { notes: v })} placeholder="Optional notes" multiline small />
                      </View>
                    ))}
                    <AddItemBtn label="+ Add Transport" onPress={addCustomTransport} />
                  </>
                )}

                {c.key === 'general' && (
                  <Inp value={pack.generalInfo} onChange={v => updatePack({ generalInfo: v })} placeholder="Anything else the group needs to know…" multiline />
                )}
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      {activePicker && (
        <DateTimePicker
          value={pickerValue(activePicker)}
          mode={pickerMode(activePicker)}
          display={Platform.OS === 'ios' ? (pickerMode(activePicker) === 'date' ? 'inline' : 'spinner') : 'default'}
          onChange={(_event, selected) => {
            const target = activePicker;
            setActivePicker(null);
            if (selected && target) applyPickerValue(target, selected);
          }}
        />
      )}

      <PlayerSelectorSheet
        visible={committeePickerOpen}
        title="ADD COMMITTEE MEMBER"
        players={committeeRoster.map(p => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl }))}
        onSelect={addCommitteeMember}
        onClose={() => setCommitteePickerOpen(false)}
      />

      <PlayerSelectorSheet
        visible={roomPickerFor !== null}
        title="ADD PLAYER TO ROOM"
        players={roomRoster.map(p => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl }))}
        flagLabels={roomFlags}
        onSelect={handleRoomPlayerSelect}
        onClose={() => setRoomPickerFor(null)}
      />

      {confirm && (
        <ConfirmDialog
          visible
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          destructive={confirm.destructive}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const hit = { top: 8, bottom: 8, left: 8, right: 8 };

// ── Small helpers ─────────────────────────────────────────────
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={sc.fieldLabel}>{children}</Text>;
}

function PickerField({ value, placeholder, onPress }: { value: string; placeholder: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={sc.input} onPress={onPress} activeOpacity={0.8}>
      <Text style={{ fontFamily: FF, fontSize: 13, color: value ? '#fff' : '#444' }}>{value || placeholder}</Text>
    </TouchableOpacity>
  );
}

function Inp({
  value, onChange, placeholder, multiline, small, style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  small?: boolean;
  style?: any;
}) {
  return (
    <TextInput
      style={[sc.input, small && sc.inputSmall, multiline && sc.inputMulti, style]}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor="#444"
      multiline={multiline}
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

  scroll: { padding: 16, paddingBottom: 48 },
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
  cardTitle: { flex: 1, fontSize: 13, fontFamily: FFB, color: '#fff' },
  chevron:   { fontSize: 15, color: '#fff', width: 16, textAlign: 'center' },

  editor: { padding: 14, paddingTop: 0, borderTopWidth: 1, borderTopColor: '#1c1c1c' },

  fieldLabel: { fontSize: 9, fontFamily: FFB, color: '#fff', letterSpacing: 1.5, marginTop: 14, marginBottom: 6 },

  input: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 13, fontFamily: FFB, color: '#fff',
  },
  inputSmall: { paddingVertical: 7, fontSize: 11 },
  inputMulti: { minHeight: 60, textAlignVertical: 'top' },

  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  timeField: { width: 90 },

  removeItem: { fontSize: 20, color: '#fff', lineHeight: 22, paddingHorizontal: 4 },

  addItemBtn: {
    marginTop: 6, paddingVertical: 8, alignItems: 'center',
    borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 12, borderStyle: 'dashed',
  },
  addItemBtnText: { fontSize: 11, fontFamily: FFB, color: '#fff' },
});

const ro = StyleSheet.create({
  row:  { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  text: { fontSize: 13, fontFamily: FFB, color: '#fff' },
  hint: { fontSize: 10, fontFamily: FF, color: '#555', marginTop: 4, marginBottom: 4 },
});

const fl = StyleSheet.create({
  route: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginBottom: 10, paddingVertical: 8,
  },
  routeAirport: { fontSize: 13, fontFamily: FFB, color: GOLD, flex: 1 },
  routeArrow:   { fontSize: 14, color: '#fff' },
});

const cm = StyleSheet.create({
  card: {
    backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#1c1c1c',
    borderRadius: 12, padding: 12, marginBottom: 10,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  name: { flex: 1, fontSize: 13, fontFamily: FFB, color: '#fff' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: {
    borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  chipOn:      { backgroundColor: 'rgba(212,175,55,0.12)', borderColor: GOLD },
  chipText:    { fontSize: 11, fontFamily: FFB, color: '#888' },
  chipTextOn:  { color: GOLD },
  playerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(212,175,55,0.12)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
  },
  playerChipText:   { fontSize: 12, fontFamily: FFB, color: GOLD },
  playerChipRemove: { fontSize: 14, fontFamily: FFB, color: GOLD, paddingHorizontal: 2 },
});
