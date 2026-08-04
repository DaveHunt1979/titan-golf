import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Image, Modal, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { resolveAvatar } from '../../../src/lib/assets';

const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';

type GameMode =
  | 'stableford' | 'medal' | 'skins' | 'nassau' | 'scramble'
  | 'greensome' | 'foursomes' | 'modified_stableford' | 'par_bogey'
  | 'singles' | '4bbb' | 'team_stableford' | 'best2from4' | 'best2from4_par3all';

interface Player {
  id: string;
  display_name: string;
  handicap_index: number;
  avatar_url?: string | null;
}

export interface BuiltMatch {
  home: string[];
  away: string[];
  homeName: string;
  awayName: string;
  startHole: number;
}

type LayoutType = 'individual' | 'singles' | 'twoteam' | 'mashie';

interface MatchSlot {
  home: string[];
  away: string[];
  homeName: string;
  awayName: string;
}

interface GroupState {
  startHole: number;
  teeTime: string;
  slots: MatchSlot[];
}

function getLayout(mode: GameMode): LayoutType {
  if (mode === 'singles' || mode === 'nassau') return 'singles';
  if (mode === '4bbb' || mode === 'greensome' || mode === 'foursomes') return 'twoteam';
  if (mode === 'best2from4' || mode === 'best2from4_par3all') return 'mashie';
  if (mode === 'team_stableford') return 'twoteam';
  return 'individual';
}

function getPlayersPerTeam(mode: GameMode, teamSize: number): number {
  if (mode === 'singles' || mode === 'nassau') return 1;
  if (mode === '4bbb' || mode === 'greensome' || mode === 'foursomes') return 2;
  if (mode === 'team_stableford') return teamSize;
  return 4;
}

function makeFreshSlot(slotIdx: number, mode: GameMode): MatchSlot {
  const isTeam = mode === '4bbb' || mode === 'team_stableford';
  return {
    home: [],
    away: [],
    homeName: isTeam ? (slotIdx === 0 ? 'Team A' : 'Team C') : '',
    awayName: isTeam ? (slotIdx === 0 ? 'Team B' : 'Team D') : '',
  };
}

function incrementTime(t: string, mins: number): string {
  const [h, m] = t.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function restoreGroups(matches: BuiltMatch[], m: GameMode): GroupState[] {
  if (matches.length === 0) return [];
  return matches.map((bm, i) => ({
    startHole: bm.startHole,
    teeTime: incrementTime('10:00', i * 10),
    slots: [{
      home: bm.home,
      away: bm.away,
      homeName: (m === '4bbb' || m === 'team_stableford') ? 'Team A' : '',
      awayName: (m === '4bbb' || m === 'team_stableford') ? 'Team B' : '',
    }],
  }));
}

export default function GroupBuilderSheet({
  visible, mode, players, teamSize, initialStartHole, initialMatches, onDone, onClose,
}: {
  visible: boolean;
  mode: GameMode;
  players: Player[];
  teamSize: number;
  initialStartHole?: number;
  initialMatches?: BuiltMatch[];
  onDone: (matches: BuiltMatch[]) => void;
  onClose: () => void;
}) {
  const dc = useDynamicColors();
  const GOLD = dc.gold;
  const layout = getLayout(mode);
  const pps    = getPlayersPerTeam(mode, teamSize);

  const [groups,    setGroups]    = useState<GroupState[]>([]);
  const [pickTarget, setPickTarget] = useState<{ gi: number; si: number; side: 'home' | 'away' } | null>(null);
  const [holeGi,    setHoleGi]    = useState<number | null>(null);
  const [editName,  setEditName]  = useState<{ gi: number; si: number; side: 'home' | 'away'; val: string } | null>(null);

  useEffect(() => {
    if (visible) {
      const restored = initialMatches && initialMatches.length > 0
        ? restoreGroups(initialMatches, mode)
        : [makeGroup(mode, '10:00', initialStartHole ?? 1)];
      setGroups(restored);
      setPickTarget(null);
      setHoleGi(null);
      setEditName(null);
    }
  }, [visible, mode, initialStartHole]);

  function makeGroup(m: GameMode, teeTime: string, startHole: number): GroupState {
    return { startHole, teeTime, slots: [makeFreshSlot(0, m)] };
  }

  const usedIds = useMemo(
    () => new Set(groups.flatMap(g => g.slots.flatMap(s => [...s.home, ...s.away]))),
    [groups],
  );

  const availablePlayers = useMemo(() => {
    if (!pickTarget) return players;
    return players.filter(p => !usedIds.has(p.id));
  }, [pickTarget, players, usedIds]);

  // ── Mutators ─────────────────────────────────────────────────

  function addPlayerToSlot(pid: string) {
    if (!pickTarget) return;
    const { gi, si, side } = pickTarget;
    setGroups(prev => prev.map((g, i) => i !== gi ? g : {
      ...g, slots: g.slots.map((s, j) => j !== si ? s : ({
        ...s, [side]: [...s[side], pid],
      })),
    }));
    setPickTarget(null);
  }

  function removePlayer(gi: number, si: number, side: 'home' | 'away', pid: string) {
    setGroups(prev => prev.map((g, i) => i !== gi ? g : {
      ...g, slots: g.slots.map((s, j) => j !== si ? s : ({
        ...s, [side]: s[side].filter(id => id !== pid),
      })),
    }));
  }

  function addGroup() {
    setGroups(prev => {
      const last = prev[prev.length - 1];
      const teeTime = last?.teeTime ? incrementTime(last.teeTime, 10) : '10:10';
      return [...prev, makeGroup(mode, teeTime, initialStartHole ?? 1)];
    });
  }

  function removeGroup(gi: number) {
    if (groups.length > 1) setGroups(prev => prev.filter((_, i) => i !== gi));
  }

  function addMatch(gi: number) {
    setGroups(prev => prev.map((g, i) => i !== gi ? g : ({
      ...g, slots: [...g.slots, makeFreshSlot(g.slots.length, mode)],
    })));
  }

  function removeMatch(gi: number, si: number) {
    setGroups(prev => prev.map((g, i) => i !== gi ? g : ({
      ...g, slots: g.slots.filter((_, j) => j !== si),
    })));
  }

  function saveTeamName(gi: number, si: number, side: 'home' | 'away', name: string) {
    setGroups(prev => prev.map((g, i) => i !== gi ? g : ({
      ...g, slots: g.slots.map((s, j) => j !== si ? s : ({
        ...s, [side === 'home' ? 'homeName' : 'awayName']: name,
      })),
    })));
  }

  function buildResult(): BuiltMatch[] {
    const out: BuiltMatch[] = [];
    for (const g of groups) {
      for (const s of g.slots) {
        if (s.home.length + s.away.length > 0)
          out.push({ home: s.home, away: s.away, homeName: s.homeName, awayName: s.awayName, startHole: g.startHole });
      }
    }
    return out;
  }

  const canDone = groups.some(g => g.slots.some(s => s.home.length > 0 || s.away.length > 0));

  // ── Sub-components ────────────────────────────────────────────

  function AvatarCircle({ player, size = 36 }: { player: Player; size?: number }) {
    const src = resolveAvatar(player.id, player.avatar_url);
    if (src) return <Image source={src} style={{ width: size, height: size, borderRadius: size / 2 }} />;
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${GOLD}20`, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: FFB, fontSize: Math.round(size * 0.4), color: GOLD }}>{player.display_name[0]}</Text>
      </View>
    );
  }

  function FilledRow({ gi, si, side, pid }: { gi: number; si: number; side: 'home' | 'away'; pid: string }) {
    const p = players.find(x => x.id === pid);
    if (!p) return null;
    return (
      <View style={[css.playerRow, { borderColor: dc.border }]}>
        <AvatarCircle player={p} />
        <View style={{ flex: 1 }}>
          <Text style={[css.playerName, { color: dc.white }]} numberOfLines={1}>{p.display_name}</Text>
          {p.handicap_index != null && (
            <Text style={css.playerHcp}>HCP {p.handicap_index}</Text>
          )}
        </View>
        <TouchableOpacity onPress={() => removePlayer(gi, si, side, pid)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close-circle" size={20} color="#555" />
        </TouchableOpacity>
      </View>
    );
  }

  function EmptySlot({ gi, si, side }: { gi: number; si: number; side: 'home' | 'away' }) {
    return (
      <TouchableOpacity
        style={[css.emptySlot, { borderColor: `${GOLD}40` }]}
        onPress={() => setPickTarget({ gi, si, side })}
        activeOpacity={0.7}
      >
        <Ionicons name="add-circle-outline" size={18} color={GOLD} />
        <Text style={[css.emptyText, { color: GOLD }]}>Add Player</Text>
      </TouchableOpacity>
    );
  }

  // ── Format-specific bodies ────────────────────────────────────

  function IndividualBody({ gi }: { gi: number }) {
    const filled = groups[gi].slots[0].home;
    return (
      <View style={{ gap: 4 }}>
        {filled.map(pid => <FilledRow key={pid} gi={gi} si={0} side="home" pid={pid} />)}
        {filled.length < 4 && <EmptySlot gi={gi} si={0} side="home" />}
      </View>
    );
  }

  function SinglesBody({ gi }: { gi: number }) {
    const g = groups[gi];
    return (
      <View style={{ gap: 12 }}>
        {g.slots.map((slot, si) => (
          <View key={si}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={[css.matchLabel, { color: GOLD }]}>MATCH {si + 1}</Text>
              {g.slots.length > 1 && (
                <TouchableOpacity onPress={() => removeMatch(gi, si)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Ionicons name="trash-outline" size={15} color="#555" />
                </TouchableOpacity>
              )}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                {slot.home[0]
                  ? <FilledRow gi={gi} si={si} side="home" pid={slot.home[0]} />
                  : <EmptySlot gi={gi} si={si} side="home" />}
              </View>
              <Text style={{ fontFamily: FFB, fontSize: 11, color: '#666' }}>VS</Text>
              <View style={{ flex: 1 }}>
                {slot.away[0]
                  ? <FilledRow gi={gi} si={si} side="away" pid={slot.away[0]} />
                  : <EmptySlot gi={gi} si={si} side="away" />}
              </View>
            </View>
          </View>
        ))}
        {g.slots.length < 2 && (
          <TouchableOpacity
            style={[css.addMatchBtn, { borderColor: `${GOLD}30` }]}
            onPress={() => addMatch(gi)}
            activeOpacity={0.7}
          >
            <Ionicons name="add" size={15} color={GOLD} />
            <Text style={[css.emptyText, { color: GOLD }]}>Add Match</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  function TwoTeamBody({ gi }: { gi: number }) {
    const slot    = groups[gi].slots[0];
    const canEdit = mode === '4bbb' || mode === 'team_stableford';
    return (
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <Text style={[css.teamLabel, { color: GOLD }]}>{slot.homeName || 'Team A'}</Text>
          {canEdit && (
            <TouchableOpacity onPress={() => setEditName({ gi, si: 0, side: 'home', val: slot.homeName })} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="pencil" size={13} color="#555" />
            </TouchableOpacity>
          )}
        </View>
        {Array.from({ length: pps }, (_, idx) =>
          slot.home[idx]
            ? <FilledRow key={idx} gi={gi} si={0} side="home" pid={slot.home[idx]} />
            : <EmptySlot key={`he${idx}`} gi={gi} si={0} side="home" />
        )}
        <View style={{ height: 1, backgroundColor: dc.border, marginVertical: 4 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <Text style={[css.teamLabel, { color: '#60a5fa' }]}>{slot.awayName || 'Team B'}</Text>
          {canEdit && (
            <TouchableOpacity onPress={() => setEditName({ gi, si: 0, side: 'away', val: slot.awayName })} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="pencil" size={13} color="#555" />
            </TouchableOpacity>
          )}
        </View>
        {Array.from({ length: pps }, (_, idx) =>
          slot.away[idx]
            ? <FilledRow key={idx} gi={gi} si={0} side="away" pid={slot.away[idx]} />
            : <EmptySlot key={`ae${idx}`} gi={gi} si={0} side="away" />
        )}
      </View>
    );
  }

  function MashieBody({ gi }: { gi: number }) {
    const filled = groups[gi].slots[0].home;
    return (
      <View style={{ gap: 4 }}>
        {[0, 1, 2, 3].map(idx =>
          filled[idx]
            ? <FilledRow key={idx} gi={gi} si={0} side="home" pid={filled[idx]} />
            : <EmptySlot key={`e${idx}`} gi={gi} si={0} side="home" />
        )}
      </View>
    );
  }

  function GroupCard({ gi }: { gi: number }) {
    const g = groups[gi];
    const premium = gi === 0;
    const hdrBg   = premium ? GOLD : '#0a0a0a';
    const hdrText = premium ? '#fff' : GOLD;
    const pillBg  = premium ? 'rgba(0,0,0,0.18)' : `${GOLD}18`;
    const pillBdr = premium ? 'rgba(255,255,255,0.3)' : `${GOLD}50`;
    return (
      <View style={[css.groupCard, { backgroundColor: dc.card, borderColor: premium ? GOLD : dc.border }]}>
        <View style={[css.groupHeader, { backgroundColor: hdrBg }]}>
          <Text style={[css.groupTitle, { color: hdrText }]}>Group {gi + 1}</Text>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <TouchableOpacity style={[css.pill, { backgroundColor: pillBg, borderColor: pillBdr }]} onPress={() => setHoleGi(gi)} activeOpacity={0.7}>
              <Text style={[css.pillText, { color: hdrText }]}>Hole {g.startHole} ▾</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[css.pill, { backgroundColor: pillBg, borderColor: pillBdr }]}
              onPress={() => {
                Alert.prompt(
                  'Tee Time',
                  'e.g. 09:30',
                  val => {
                    if (val && /^\d{1,2}:\d{2}$/.test(val))
                      setGroups(prev => prev.map((x, i) => i !== gi ? x : { ...x, teeTime: val }));
                  },
                  'plain-text',
                  g.teeTime,
                );
              }}
              activeOpacity={0.7}
            >
              <Text style={[css.pillText, { color: hdrText }]}>{g.teeTime || 'Set time'} ▾</Text>
            </TouchableOpacity>
            {groups.length > 1 && (
              <TouchableOpacity onPress={() => removeGroup(gi)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="trash-outline" size={16} color="#555" />
              </TouchableOpacity>
            )}
          </View>
        </View>
        <View style={{ padding: 12 }}>
          {layout === 'individual' && <IndividualBody gi={gi} />}
          {layout === 'singles'    && <SinglesBody gi={gi} />}
          {layout === 'twoteam'    && <TwoTeamBody gi={gi} />}
          {layout === 'mashie'     && <MashieBody gi={gi} />}
        </View>
      </View>
    );
  }

  // ── Main render ───────────────────────────────────────────────

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[css.root, { backgroundColor: dc.bg }]}>

        {/* Header */}
        <View style={[css.header, { borderBottomColor: dc.border }]}>
          <View style={{ width: 70 }} />
          <Text style={[css.headerTitle, { color: dc.white }]}>PLAYERS</Text>
          <TouchableOpacity
            style={[css.doneBtn, !canDone && { opacity: 0.35 }]}
            onPress={canDone ? () => onDone(buildResult()) : undefined}
            activeOpacity={0.85}
          >
            <Text style={css.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={css.scroll} showsVerticalScrollIndicator={false}>
          {groups.map((_, gi) => <GroupCard key={gi} gi={gi} />)}
          <TouchableOpacity
            style={[css.addGroupBtn, { borderColor: `${GOLD}40` }]}
            onPress={addGroup}
            activeOpacity={0.7}
          >
            <Ionicons name="add-circle-outline" size={20} color={GOLD} />
            <Text style={[css.addGroupText, { color: GOLD }]}>Add Group</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Game Setup back footer */}
        <TouchableOpacity
          style={[css.footer, { borderTopColor: dc.border, backgroundColor: dc.card }]}
          onPress={onClose}
          activeOpacity={0.85}
        >
          <Ionicons name="chevron-back" size={18} color={GOLD} />
          <Text style={[css.footerText, { color: GOLD }]}>Game Setup</Text>
        </TouchableOpacity>
      </View>

      {/* Start hole picker */}
      {holeGi !== null && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setHoleGi(null)}>
          <TouchableOpacity style={css.overlay} activeOpacity={1} onPress={() => setHoleGi(null)} />
          <View style={[css.subSheet, { backgroundColor: dc.card }]}>
            <Text style={[css.subTitle, { color: dc.white, borderBottomColor: dc.border }]}>Starting Hole</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              {Array.from({ length: 18 }, (_, i) => i + 1).map(h => (
                <TouchableOpacity
                  key={h}
                  style={[css.subRow, { borderBottomColor: dc.border }]}
                  onPress={() => {
                    setGroups(prev => prev.map((g, i) => i !== holeGi ? g : { ...g, startHole: h }));
                    setHoleGi(null);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[css.subRowText, { color: dc.white }, groups[holeGi]?.startHole === h && { color: GOLD }]}>
                    Hole {h}
                  </Text>
                  {groups[holeGi]?.startHole === h && <Ionicons name="checkmark" size={18} color={GOLD} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={css.subCancel} onPress={() => setHoleGi(null)}>
              <Text style={[css.subCancelText, { color: dc.white }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}

      {/* Team name editor */}
      {editName !== null && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setEditName(null)}>
          <TouchableOpacity style={css.overlay} activeOpacity={1} onPress={() => setEditName(null)} />
          <View style={[css.subSheet, { backgroundColor: dc.card }]}>
            <Text style={[css.subTitle, { color: dc.white, borderBottomColor: dc.border }]}>Team Name</Text>
            <TextInput
              style={[css.nameInput, { color: dc.white, borderColor: dc.border }]}
              value={editName.val}
              onChangeText={v => setEditName(prev => prev ? { ...prev, val: v } : null)}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => {
                saveTeamName(editName.gi, editName.si, editName.side, editName.val);
                setEditName(null);
              }}
            />
            <TouchableOpacity
              style={[css.doneBtn, { marginTop: 12 }]}
              onPress={() => { saveTeamName(editName.gi, editName.si, editName.side, editName.val); setEditName(null); }}
            >
              <Text style={css.doneBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}

      {/* Player picker */}
      {pickTarget !== null && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setPickTarget(null)}>
          <TouchableOpacity style={css.overlay} activeOpacity={1} onPress={() => setPickTarget(null)} />
          <View style={[css.subSheet, { backgroundColor: dc.card, maxHeight: '75%' }]}>
            <Text style={[css.subTitle, { color: dc.white, borderBottomColor: dc.border }]}>
              Group {pickTarget.gi + 1}
              {layout === 'singles' ? `  ·  Match ${pickTarget.si + 1}` : ''}
            </Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {availablePlayers.length === 0
                ? <Text style={{ color: '#555', textAlign: 'center', padding: 20, fontFamily: FF }}>No players available</Text>
                : availablePlayers.map(p => {
                  const src = resolveAvatar(p.id, p.avatar_url);
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[css.subRow, { borderBottomColor: dc.border }]}
                      onPress={() => addPlayerToSlot(p.id)}
                      activeOpacity={0.7}
                    >
                      {src
                        ? <Image source={src} style={css.pickerAvatar} />
                        : (
                          <View style={[css.pickerAvatar, { backgroundColor: `${GOLD}20`, alignItems: 'center', justifyContent: 'center' }]}>
                            <Text style={{ fontFamily: FFB, fontSize: 15, color: GOLD }}>{p.display_name[0]}</Text>
                          </View>
                        )
                      }
                      <View style={{ flex: 1 }}>
                        <Text style={[css.playerName, { color: dc.white }]}>{p.display_name}</Text>
                        {p.handicap_index != null && <Text style={css.playerHcp}>HCP {p.handicap_index}</Text>}
                      </View>
                    </TouchableOpacity>
                  );
                })
              }
            </ScrollView>
            <TouchableOpacity style={css.subCancel} onPress={() => setPickTarget(null)}>
              <Text style={[css.subCancelText, { color: dc.white }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}
    </Modal>
  );
}

const css = StyleSheet.create({
  root:   { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontFamily: FFB, fontSize: 18, letterSpacing: 2 },
  doneBtn:     { backgroundColor: '#22c55e', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8, alignItems: 'center' },
  doneBtnText: { fontFamily: FFB, fontSize: 14, color: '#fff' },

  scroll: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 110, gap: 16 },

  groupCard:   { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  groupHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#174d17', paddingHorizontal: 14, paddingVertical: 12,
  },
  groupTitle: { fontFamily: FFB, fontSize: 16, color: '#fff' },
  pill: {
    backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 8,
    paddingHorizontal: 9, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  pillText: { fontFamily: FFB, fontSize: 11, color: '#fff' },

  playerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 1,
  },
  playerName: { fontFamily: FFB, fontSize: 14 },
  playerHcp:  { fontFamily: FF, fontSize: 11, color: '#777', marginTop: 1 },

  emptySlot: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderStyle: 'dashed', borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 12, marginBottom: 2,
  },
  emptyText: { fontFamily: FFB, fontSize: 13 },

  matchLabel:  { fontFamily: FFB, fontSize: 11, letterSpacing: 1.5 },
  addMatchBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderWidth: 1, borderStyle: 'dashed', borderRadius: 10,
  },
  teamLabel: { fontFamily: FFB, fontSize: 13, letterSpacing: 0.5 },

  addGroupBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, borderWidth: 1, borderStyle: 'dashed', borderRadius: 12,
  },
  addGroupText: { fontFamily: FFB, fontSize: 15 },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 18, paddingBottom: 34, borderTopWidth: 1,
  },
  footerText: { fontFamily: FFB, fontSize: 16 },

  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  subSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 16, paddingBottom: 38,
  },
  subTitle: {
    fontFamily: FFB, fontSize: 17,
    marginBottom: 12, paddingBottom: 10, borderBottomWidth: 1,
  },
  subRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, gap: 12 },
  subRowText: { fontFamily: FFB, fontSize: 15, flex: 1 },
  subCancel:  { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  subCancelText: { fontFamily: FFB, fontSize: 16 },

  pickerAvatar: { width: 38, height: 38, borderRadius: 19 },
  nameInput:    {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontFamily: FFB, fontSize: 16, marginTop: 4,
  },
});
