import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Image, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { resolveAvatar } from '../lib/assets';
import { fetchLastRounds, type RecentRound } from '../lib/playerTiers';
import PlayerEditSheet, { type EditablePlayer } from './PlayerEditSheet';

interface TournamentHandicapSummary {
  starting: number;
  current: number;
  cut: number;
}
interface TournamentHandicapHistoryRow {
  dayNumber: number;
  handicapBefore: number;
  stablefordPts: number;
  pointsOverTrigger: number;
  cutApplied: number;
  handicapAfter: number;
}

const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const FFB   = 'JUSTSans-ExBold';

export interface PlayingNow {
  matchId: string;
  courseName: string;
  hole: number;
  pts: number | null;
}

// The "trading card" popup for tapping another player — T-Tag, photo,
// handicap, last 3 rounds, live online dot, Message and (admin-only) Edit
// (Dave, 2026-08-21: "click on anyone in player library and the T-Card
// comes up over the top ... like a trading card thing"). Read-only for
// everyone; the Edit button is the one exception, straight into the same
// merged Players+Access edit sheet.
export default function TCardSheet({
  visible, member, tTag, playingNow, isAdmin, societyId, myRole, onClose, onSaved, competitionId,
}: {
  visible: boolean;
  member: EditablePlayer | null;
  tTag: string | null;
  playingNow: PlayingNow | null;
  isAdmin: boolean;
  societyId: string;
  myRole: string;
  onClose: () => void;
  onSaved: () => void;
  // Only set by callers with an active tournament context (e.g. the Tour
  // leaderboard) — when present, shows the locked starting/current/cut
  // tournament handicap breakdown. Absent for general-context callers
  // (friends.tsx, Player Library), which simply skip that section.
  competitionId?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [online, setOnline] = useState(false);
  const [rounds, setRounds] = useState<RecentRound[] | null>(null);
  const [tournamentHcp, setTournamentHcp] = useState<TournamentHandicapSummary | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<TournamentHandicapHistoryRow[] | null>(null);

  useEffect(() => {
    if (!visible || !member) { setRounds(null); return; }
    const playerId = member.player.id;
    supabase.rpc('is_player_online', { p_player_id: playerId }).then(({ data }) => setOnline(!!data));
    fetchLastRounds(playerId, 3).then(setRounds);
  }, [visible, member?.player.id]);

  useEffect(() => {
    if (!visible || !member || !competitionId) { setTournamentHcp(null); return; }
    supabase.from('competition_players')
      .select('starting_tournament_handicap, current_tournament_handicap, total_tournament_cut')
      .eq('competition_id', competitionId).eq('player_id', member.player.id).maybeSingle()
      .then(({ data }) => {
        if (!data || (data as any).starting_tournament_handicap == null) { setTournamentHcp(null); return; }
        setTournamentHcp({
          starting: Number((data as any).starting_tournament_handicap),
          current: Number((data as any).current_tournament_handicap),
          cut: Number((data as any).total_tournament_cut),
        });
      });
  }, [visible, member?.player.id, competitionId]);

  function openHistory() {
    if (!member || !competitionId) return;
    setShowHistory(true);
    setHistory(null);
    supabase.from('tournament_handicap_history')
      .select('day_number, handicap_before_cut, stableford_pts, points_over_trigger, cut_applied, handicap_after_cut')
      .eq('competition_id', competitionId).eq('player_id', member.player.id).is('superseded_at', null)
      .order('day_number', { ascending: true })
      .then(({ data }) => setHistory((data ?? []).map((r: any) => ({
        dayNumber: r.day_number, handicapBefore: Number(r.handicap_before_cut), stablefordPts: r.stableford_pts,
        pointsOverTrigger: r.points_over_trigger, cutApplied: Number(r.cut_applied), handicapAfter: Number(r.handicap_after_cut),
      }))));
  }

  if (!member) return null;
  const { player, committee_role } = member;
  const avatarSrc = resolveAvatar(player.id, player.avatar_url);

  return (
    <>
      <Modal visible={visible && !editing} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable style={s.backdrop} onPress={onClose}>
          <Pressable style={s.card} onPress={() => {}}>
            <TouchableOpacity style={s.closeBtn} onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={20} color="#666" />
            </TouchableOpacity>

            <View style={s.avatarWrap}>
              {avatarSrc ? (
                <Image source={avatarSrc} style={s.avatar} />
              ) : (
                <View style={s.avatar}>
                  <Text style={s.avatarText}>{player.display_name[0]?.toUpperCase() ?? '?'}</Text>
                </View>
              )}
              {online && <View style={s.onlineDot} />}
            </View>

            <Text style={s.name}>{player.display_name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              {tTag && <Text style={s.tTag}>@{tTag}</Text>}
              {online && <Text style={s.onlineLabel}>ONLINE</Text>}
            </View>
            {committee_role && <Text style={s.committeeRole}>{committee_role}</Text>}

            <View style={s.statRow}>
              {player.handicap_index != null && (
                <View style={s.statBox}>
                  <Text style={s.statValue}>{player.handicap_index}</Text>
                  <Text style={s.statLabel}>HCP</Text>
                </View>
              )}
              {playingNow && (
                <View style={s.statBox}>
                  <Text style={[s.statValue, { color: GOLD }]}>{playingNow.hole}</Text>
                  <Text style={s.statLabel}>HOLE</Text>
                </View>
              )}
            </View>

            <View style={s.lastRoundsBlock}>
              <Text style={s.lastRoundsLabel}>LAST 3 ROUNDS</Text>
              {rounds === null ? (
                <ActivityIndicator size="small" color="#555" style={{ marginTop: 6 }} />
              ) : rounds.length === 0 ? (
                <Text style={s.lastRoundsEmpty}>No completed rounds yet</Text>
              ) : (
                <View style={s.lastRoundsRow}>
                  {rounds.map(r => (
                    <View key={r.matchId} style={s.roundChip}>
                      <Text style={s.roundChipPts}>{r.points ?? '—'}</Text>
                      <Text style={s.roundChipSub} numberOfLines={1}>{r.courseName ?? 'Round'}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {tournamentHcp && (
              <TouchableOpacity
                style={s.lastRoundsBlock}
                activeOpacity={competitionId ? 0.7 : 1}
                onPress={openHistory}
              >
                <Text style={s.lastRoundsLabel}>TOURNAMENT HANDICAP {tournamentHcp.cut > 0 ? '· TAP FOR HISTORY' : ''}</Text>
                <View style={s.statRow}>
                  <View style={s.statBox}>
                    <Text style={s.statValue}>{tournamentHcp.starting.toFixed(1)} 🔒</Text>
                    <Text style={s.statLabel}>STARTING</Text>
                  </View>
                  <View style={s.statBox}>
                    <Text style={[s.statValue, { color: GOLD }]}>{tournamentHcp.current.toFixed(1)}</Text>
                    <Text style={s.statLabel}>CURRENT</Text>
                  </View>
                  <View style={s.statBox}>
                    <Text style={[s.statValue, { color: tournamentHcp.cut > 0 ? GREEN : '#666' }]}>
                      {tournamentHcp.cut > 0 ? `-${tournamentHcp.cut.toFixed(1)}` : '0.0'}
                    </Text>
                    <Text style={s.statLabel}>CUT</Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}

            {playingNow && (
              <TouchableOpacity
                style={s.watchBtn}
                activeOpacity={0.85}
                onPress={() => { onClose(); router.push(`/(app)/spectate/${playingNow.matchId}` as any); }}
              >
                <Ionicons name="golf-outline" size={16} color={GOLD} />
                <Text style={s.watchBtnText}>Watch Live — {playingNow.courseName}</Text>
              </TouchableOpacity>
            )}

            <View style={s.actionRow}>
              <TouchableOpacity
                style={s.actionBtn}
                activeOpacity={0.85}
                onPress={() => {
                  onClose();
                  router.push(`/(app)/inbox/${player.id}?name=${encodeURIComponent(player.display_name)}&avatar=${encodeURIComponent(player.avatar_url ?? '')}` as any);
                }}
              >
                <Ionicons name="mail-outline" size={16} color="#fff" />
                <Text style={s.actionBtnText}>Message</Text>
              </TouchableOpacity>

              {isAdmin && (
                <TouchableOpacity style={[s.actionBtn, s.editBtn]} activeOpacity={0.85} onPress={() => setEditing(true)}>
                  <Ionicons name="create-outline" size={16} color={GOLD} />
                  <Text style={[s.actionBtnText, { color: GOLD }]}>Edit</Text>
                </TouchableOpacity>
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showHistory} transparent animationType="fade" onRequestClose={() => setShowHistory(false)}>
        <Pressable style={s.backdrop} onPress={() => setShowHistory(false)}>
          <Pressable style={[s.card, { maxHeight: '70%' }]} onPress={() => {}}>
            <TouchableOpacity style={s.closeBtn} onPress={() => setShowHistory(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={20} color="#666" />
            </TouchableOpacity>
            <Text style={s.name}>Tournament Handicap History</Text>
            {history === null ? (
              <ActivityIndicator color="#555" style={{ marginTop: 16 }} />
            ) : history.length === 0 ? (
              <Text style={[s.lastRoundsEmpty, { marginTop: 12 }]}>No rounds processed yet</Text>
            ) : (
              history.map(h => (
                <View key={h.dayNumber} style={{ width: '100%', marginTop: 12 }}>
                  <Text style={{ color: '#888', fontFamily: FFB, fontSize: 11, letterSpacing: 1 }}>ROUND {h.dayNumber}</Text>
                  <Text style={{ color: '#fff', fontFamily: FFB, fontSize: 13, marginTop: 2 }}>
                    Played off {h.handicapBefore.toFixed(1)} · {h.stablefordPts} pts
                    {h.cutApplied > 0 ? ` · -${h.cutApplied.toFixed(1)} cut` : ' · no cut'}
                  </Text>
                  <Text style={{ color: GOLD, fontFamily: FFB, fontSize: 12, marginTop: 2 }}>New handicap: {h.handicapAfter.toFixed(1)}</Text>
                </View>
              ))
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {isAdmin && (
        <PlayerEditSheet
          visible={editing}
          member={member}
          societyId={societyId}
          myRole={myRole}
          onClose={() => { setEditing(false); onClose(); }}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%', maxWidth: 320, backgroundColor: '#0f0f0f', borderRadius: 24,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.35)', padding: 28,
    alignItems: 'center',
    shadowColor: GOLD, shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: 0 },
  },
  closeBtn: { position: 'absolute', top: 14, right: 14, padding: 4 },

  avatarWrap: { marginBottom: 14 },
  avatar: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: GOLD + '22', borderWidth: 2, borderColor: GOLD,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: FFB, fontSize: 30, color: GOLD },
  onlineDot: {
    position: 'absolute', bottom: -2, right: -2,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: GREEN, borderWidth: 3, borderColor: '#0f0f0f',
  },

  name: { fontFamily: FFB, fontSize: 18, color: '#fff', textAlign: 'center' },
  tTag: { fontFamily: FFB, fontSize: 12, color: '#888' },
  onlineLabel: { fontFamily: FFB, fontSize: 9, color: GREEN, letterSpacing: 1 },
  committeeRole: { fontFamily: FFB, fontSize: 12, color: GOLD, fontStyle: 'italic', marginTop: 4 },

  statRow: { flexDirection: 'row', gap: 24, marginTop: 18 },
  statBox: { alignItems: 'center' },
  statValue: { fontFamily: FFB, fontSize: 22, color: '#fff' },
  statLabel: { fontFamily: FFB, fontSize: 9, color: '#555', letterSpacing: 1.5, marginTop: 2 },

  lastRoundsBlock: { alignSelf: 'stretch', marginTop: 20, alignItems: 'center' },
  lastRoundsLabel: { fontFamily: FFB, fontSize: 9, color: '#555', letterSpacing: 1.5 },
  lastRoundsEmpty: { fontFamily: FFB, fontSize: 11, color: '#444', marginTop: 6 },
  lastRoundsRow: { flexDirection: 'row', gap: 8, marginTop: 8, alignSelf: 'stretch' },
  roundChip: {
    flex: 1, alignItems: 'center', backgroundColor: '#161616', borderRadius: 10,
    borderWidth: 1, borderColor: '#242424', paddingVertical: 8, paddingHorizontal: 4,
  },
  roundChipPts: { fontFamily: FFB, fontSize: 16, color: GOLD },
  roundChipSub: { fontFamily: FFB, fontSize: 9, color: '#666', marginTop: 2 },

  watchBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 20,
    backgroundColor: 'rgba(212,175,55,0.1)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.4)',
    borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8,
  },
  watchBtnText: { fontFamily: FFB, fontSize: 12, color: GOLD },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 20, alignSelf: 'stretch' },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#1c1c1c', borderRadius: 12, paddingVertical: 12,
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  editBtn: { backgroundColor: 'rgba(212,175,55,0.1)', borderColor: 'rgba(212,175,55,0.4)' },
  actionBtnText: { fontFamily: FFB, fontSize: 13, color: '#fff' },
});
