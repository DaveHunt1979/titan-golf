import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Image, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/lib/supabase';
import { useDynamicColors } from '../../../src/lib/SocietyThemeContext';
import { titanLogo, resolveAvatar } from '../../../src/lib/assets';
import ConfirmDialog from '../../../src/components/ConfirmDialog';

const FF  = 'JUSTSans';
const FFB = 'JUSTSans-ExBold';

interface Me { id: string; display_name: string; avatar_url: string | null; t_tag: string | null; }
interface RelPlayer { id: string; display_name: string; avatar_url: string | null; t_tag: string | null; handicap_index: number | null; }
interface MyRelationship { id: string; status: string; coach: RelPlayer | null; }
interface CoachSideRow { id: string; status: string; player: RelPlayer | null; player_id: string; }
interface SubmissionRow { id: string; shot_type: string; status: string; created_at: string; player?: { display_name: string } | null; }
interface DrillRow { id: string; name: string; status: string; created_at: string; player?: { display_name: string } | null; }

const DRILL_STATUS_LABEL: Record<string, string> = {
  not_started: 'Not Started', in_progress: 'In Progress', progress_sent: 'Progress Sent', completed: 'Completed',
};

const SHOT_LABEL: Record<string, string> = {
  driver: 'Driver', fairway_wood: 'Fairway Wood', hybrid: 'Hybrid', iron: 'Iron',
  wedge: 'Wedge', pitch: 'Pitch', chip: 'Chip', bunker: 'Bunker', putting: 'Putting', other: 'Other',
};
const STATUS_LABEL: Record<string, string> = {
  submitted: 'Submitted', awaiting_review: 'Awaiting Review', reviewing: 'Coach Reviewing',
  feedback_ready: 'Feedback Ready', completed: 'Completed',
};

export default function CoachHub() {
  const router = useRouter();
  const dc = useDynamicColors();
  const s = makeStyles(dc);
  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [loading, setLoading]   = useState(true);
  const [me, setMe]             = useState<Me | null>(null);
  const [isCoach, setIsCoach]   = useState(false);
  const [myRel, setMyRel]       = useState<MyRelationship | null>(null);
  const [pending, setPending]   = useState<CoachSideRow[]>([]);
  const [myPlayers, setMyPlayers] = useState<CoachSideRow[]>([]);
  const [mySwings, setMySwings] = useState<SubmissionRow[]>([]);
  const [reviewQueue, setReviewQueue] = useState<SubmissionRow[]>([]);
  const [myDrills, setMyDrills] = useState<DrillRow[]>([]);
  const [activeDrills, setActiveDrills] = useState<DrillRow[]>([]);
  const [viewMode, setViewMode] = useState<'player' | 'coach'>('player');

  const [tagInput, setTagInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; label: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: player } = await supabase
      .from('players').select('id, display_name, avatar_url, t_tag')
      .eq('auth_uid', user.id).maybeSingle();
    if (!player) { setLoading(false); return; }
    setMe(player as Me);

    const { data: cp } = await supabase
      .from('coach_profiles').select('is_active').eq('player_id', player.id).maybeSingle();
    const amCoach = !!cp?.is_active;
    setIsCoach(amCoach);
    setViewMode(prev => (amCoach ? prev : 'player'));

    const { data: rel } = await supabase
      .from('coaching_relationships')
      .select('id, status, coach:coach_id(id, display_name, avatar_url, t_tag, handicap_index)')
      .eq('player_id', player.id)
      .in('status', ['pending', 'active'])
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setMyRel(rel as unknown as MyRelationship | null);

    if (rel && (rel as any).status === 'active') {
      const { data: swings } = await supabase
        .from('coaching_submissions').select('id, shot_type, status, created_at')
        .eq('player_id', player.id).order('created_at', { ascending: false }).limit(10);
      setMySwings((swings ?? []) as SubmissionRow[]);

      const { data: drills } = await supabase
        .from('coaching_drills').select('id, name, status, created_at')
        .eq('player_id', player.id).order('created_at', { ascending: false }).limit(10);
      setMyDrills((drills ?? []) as DrillRow[]);
    } else {
      setMySwings([]); setMyDrills([]);
    }

    if (amCoach) {
      const { data: pendingRows } = await supabase
        .from('coaching_relationships')
        .select('id, status, player_id, player:player_id(display_name, avatar_url, t_tag, handicap_index)')
        .eq('coach_id', player.id).eq('status', 'pending')
        .order('requested_at', { ascending: false });
      setPending((pendingRows ?? []) as unknown as CoachSideRow[]);

      const { data: activeRows } = await supabase
        .from('coaching_relationships')
        .select('id, status, player_id, player:player_id(display_name, avatar_url, t_tag, handicap_index)')
        .eq('coach_id', player.id).eq('status', 'active')
        .order('accepted_at', { ascending: false });
      setMyPlayers((activeRows ?? []) as unknown as CoachSideRow[]);

      const { data: reviewRows } = await supabase
        .from('coaching_submissions')
        .select('id, shot_type, status, created_at, player:player_id(display_name)')
        .eq('coach_id', player.id).in('status', ['submitted', 'awaiting_review', 'reviewing'])
        .order('created_at', { ascending: false });
      setReviewQueue((reviewRows ?? []) as unknown as SubmissionRow[]);

      const { data: drillRows } = await supabase
        .from('coaching_drills')
        .select('id, name, status, created_at, player:player_id(display_name)')
        .eq('coach_id', player.id).neq('status', 'completed')
        .order('created_at', { ascending: false });
      setActiveDrills((drillRows ?? []) as unknown as DrillRow[]);
    } else {
      setPending([]); setMyPlayers([]); setReviewQueue([]); setActiveDrills([]);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function sendRequest() {
    if (!tagInput.trim()) return;
    setConnecting(true);
    setConnectError('');
    const { data: found, error: lookupError } = await supabase
      .rpc('find_player_by_ttag', { p_tag: tagInput.trim() });
    const foundRow = Array.isArray(found) ? found[0] : found;
    if (lookupError || !foundRow) {
      setConnectError(`No Titan player found with tag @${tagInput.trim().replace(/^@/, '').toUpperCase()}.`);
      setConnecting(false);
      return;
    }
    const { data: cp } = await supabase
      .from('coach_profiles').select('is_active').eq('player_id', foundRow.id).maybeSingle();
    if (!cp?.is_active) {
      setConnectError(`${foundRow.display_name} hasn't set up a Coach Profile on Titan.`);
      setConnecting(false);
      return;
    }
    const { error } = await supabase.rpc('request_coach_connection', { p_coach_id: foundRow.id });
    setConnecting(false);
    if (error) { setConnectError(error.message); return; }
    setTagInput('');
    load();
  }

  async function doRemove() {
    if (!confirmRemove) return;
    setBusyId(confirmRemove.id);
    await supabase.rpc('remove_coach_connection', { p_relationship_id: confirmRemove.id });
    setConfirmRemove(null);
    setBusyId(null);
    load();
  }

  async function acceptRequest(id: string) {
    setBusyId(id);
    await supabase.rpc('accept_coach_connection', { p_relationship_id: id });
    setBusyId(null);
    load();
  }

  if (loading || !fontsLoaded) {
    return (
      <View style={[s.container, s.centered, { backgroundColor: dc.bg }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={dc.gold} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={[s.container, { backgroundColor: dc.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />

      <View style={s.header}>
        <View style={s.headerSide} />
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.logo} resizeMode="contain" />
          <Text style={[s.headerSub, { color: dc.cardText }]}>TITAN COACH</Text>
        </View>
        <View style={[s.headerSide, { alignItems: 'flex-end' }]}>
          {isCoach && (
            <TouchableOpacity onPress={() => router.push('/(app)/coach/library' as any)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="videocam-outline" size={22} color={dc.gold} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {isCoach && (
        <View style={[s.segment, { borderColor: dc.border }]}>
          <TouchableOpacity
            style={[s.segmentBtn, viewMode === 'player' && { backgroundColor: dc.gold }]}
            onPress={() => setViewMode('player')} activeOpacity={0.8}
          >
            <Text style={[s.segmentText, { color: viewMode === 'player' ? '#000' : dc.cardText }]}>My Coaching</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.segmentBtn, viewMode === 'coach' && { backgroundColor: dc.gold }]}
            onPress={() => setViewMode('coach')} activeOpacity={0.8}
          >
            <Text style={[s.segmentText, { color: viewMode === 'coach' ? '#000' : dc.cardText }]}>My Players</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {viewMode === 'player' ? (
          !myRel ? (
            <View style={[s.card, { backgroundColor: dc.card, borderColor: dc.border }]}>
              <Ionicons name="school-outline" size={32} color={dc.gold} />
              <Text style={[s.cardTitle, { color: dc.cardText }]}>Add a Coach</Text>
              <Text style={[s.cardBody, { color: dc.textSecondary }]}>
                Enter your coach's T-Tag to send a connection request. They'll need to accept before anything's shared.
              </Text>
              <TextInput
                style={[s.input, { backgroundColor: dc.bg, borderColor: dc.border, color: dc.cardText }]}
                placeholder="e.g. T-DAVE-8427"
                placeholderTextColor={dc.textMuted}
                value={tagInput}
                onChangeText={t => { setTagInput(t); setConnectError(''); }}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              {!!connectError && <Text style={s.errorText}>{connectError}</Text>}
              <TouchableOpacity
                style={[s.btn, { backgroundColor: dc.gold }, (!tagInput.trim() || connecting) && { opacity: 0.4 }]}
                onPress={sendRequest}
                disabled={!tagInput.trim() || connecting}
                activeOpacity={0.85}
              >
                {connecting ? <ActivityIndicator color="#000" /> : <Text style={s.btnText}>Send Request</Text>}
              </TouchableOpacity>
            </View>
          ) : myRel.status === 'pending' ? (
            <View style={[s.card, { backgroundColor: dc.card, borderColor: dc.border }]}>
              <Ionicons name="time-outline" size={32} color={dc.gold} />
              <Text style={[s.cardTitle, { color: dc.cardText }]}>Request Sent</Text>
              <Text style={[s.cardBody, { color: dc.textSecondary }]}>
                Waiting for {myRel.coach?.display_name ?? 'your coach'} to accept your request.
              </Text>
              <TouchableOpacity
                style={s.linkBtn}
                onPress={() => setConfirmRemove({ id: myRel.id, label: 'Cancel this request?' })}
                activeOpacity={0.7}
              >
                <Text style={[s.linkBtnText, { color: '#f87171' }]}>Cancel Request</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={[s.card, { backgroundColor: dc.card, borderColor: dc.border }]}>
              <Text style={[s.sectionLabel, { color: dc.textSecondary }]}>MY COACH</Text>
              <View style={s.coachRow}>
                {resolveAvatar(myRel.coach?.id ?? '', myRel.coach?.avatar_url ?? null)
                  ? <Image source={resolveAvatar(myRel.coach?.id ?? '', myRel.coach?.avatar_url ?? null)!} style={s.avatar} />
                  : <View style={[s.avatar, s.avatarFallback, { backgroundColor: `${dc.gold}18` }]}>
                      <Text style={[s.avatarInitial, { color: dc.gold }]}>{(myRel.coach?.display_name ?? '?').charAt(0).toUpperCase()}</Text>
                    </View>
                }
                <View style={{ flex: 1 }}>
                  <Text style={[s.coachName, { color: dc.cardText }]}>{myRel.coach?.display_name}</Text>
                  {!!myRel.coach?.t_tag && <Text style={[s.coachMeta, { color: dc.textSecondary }]}>@{myRel.coach.t_tag}</Text>}
                </View>
              </View>
              <TouchableOpacity
                style={[s.btn, { backgroundColor: dc.gold, marginTop: 14 }]}
                onPress={() => router.push('/(app)/coach/send-swing' as any)}
                activeOpacity={0.85}
              >
                <Text style={s.btnText}>Send Swing</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.linkBtn}
                onPress={() => setConfirmRemove({ id: myRel.id, label: `Remove ${myRel.coach?.display_name ?? 'your coach'}? Your coaching history is kept, but they'll lose access.` })}
                activeOpacity={0.7}
              >
                <Text style={[s.linkBtnText, { color: '#f87171' }]}>Remove Coach</Text>
              </TouchableOpacity>
            </View>
          )
        ) : null}

        {viewMode === 'player' && mySwings.length > 0 && (
          <>
            <Text style={[s.sectionLabel, { color: dc.textSecondary }]}>MY SWINGS</Text>
            {mySwings.map(row => (
              <TouchableOpacity
                key={row.id}
                style={[s.playerRow, { backgroundColor: dc.card, borderColor: dc.border }]}
                onPress={() => router.push(`/(app)/coach/submission/${row.id}` as any)}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.coachName, { color: dc.cardText, fontSize: 14 }]}>{SHOT_LABEL[row.shot_type] ?? row.shot_type}</Text>
                  <Text style={[s.coachMeta, { color: dc.textSecondary }]}>{new Date(row.created_at).toLocaleDateString()}</Text>
                </View>
                <View style={[s.statusPill, { backgroundColor: dc.goldDim }]}>
                  <Text style={[s.statusPillText, { color: dc.gold }]}>{STATUS_LABEL[row.status] ?? row.status}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}

        {viewMode === 'player' && myDrills.length > 0 && (
          <>
            <Text style={[s.sectionLabel, { color: dc.textSecondary }]}>MY DRILLS</Text>
            {myDrills.map(row => (
              <TouchableOpacity
                key={row.id}
                style={[s.playerRow, { backgroundColor: dc.card, borderColor: dc.border }]}
                onPress={() => router.push(`/(app)/coach/drill/${row.id}` as any)}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.coachName, { color: dc.cardText, fontSize: 14 }]}>{row.name}</Text>
                  <Text style={[s.coachMeta, { color: dc.textSecondary }]}>{new Date(row.created_at).toLocaleDateString()}</Text>
                </View>
                <View style={[s.statusPill, { backgroundColor: dc.goldDim }]}>
                  <Text style={[s.statusPillText, { color: dc.gold }]}>{DRILL_STATUS_LABEL[row.status] ?? row.status}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}

        {viewMode === 'coach' && (
          <>
            <View style={s.statsRow}>
              <View style={[s.statTile, { backgroundColor: dc.card, borderColor: dc.border }]}>
                <Text style={[s.statN, { color: dc.gold }]}>{myPlayers.length}</Text>
                <Text style={[s.statLabel, { color: dc.textSecondary }]}>Players</Text>
              </View>
              <View style={[s.statTile, { backgroundColor: dc.card, borderColor: dc.border }]}>
                <Text style={[s.statN, { color: dc.gold }]}>{pending.length}</Text>
                <Text style={[s.statLabel, { color: dc.textSecondary }]}>Awaiting</Text>
              </View>
              <View style={[s.statTile, { backgroundColor: dc.card, borderColor: dc.border }]}>
                <Text style={[s.statN, { color: dc.gold }]}>{reviewQueue.length}</Text>
                <Text style={[s.statLabel, { color: dc.textSecondary }]}>Swings</Text>
              </View>
              <View style={[s.statTile, { backgroundColor: dc.card, borderColor: dc.border }]}>
                <Text style={[s.statN, { color: dc.gold }]}>{activeDrills.length}</Text>
                <Text style={[s.statLabel, { color: dc.textSecondary }]}>Drills</Text>
              </View>
            </View>

            {reviewQueue.length > 0 && (
              <>
                <Text style={[s.sectionLabel, { color: dc.textSecondary }]}>SWING REVIEWS</Text>
                {reviewQueue.map(row => (
                  <TouchableOpacity
                    key={row.id}
                    style={[s.playerRow, { backgroundColor: dc.card, borderColor: dc.border }]}
                    onPress={() => router.push(`/(app)/coach/submission/${row.id}` as any)}
                    activeOpacity={0.8}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[s.coachName, { color: dc.cardText, fontSize: 14 }]}>{row.player?.display_name ?? 'Player'}</Text>
                      <Text style={[s.coachMeta, { color: dc.textSecondary }]}>{SHOT_LABEL[row.shot_type] ?? row.shot_type} · {new Date(row.created_at).toLocaleDateString()}</Text>
                    </View>
                    <View style={[s.statusPill, { backgroundColor: dc.goldDim }]}>
                      <Text style={[s.statusPillText, { color: dc.gold }]}>{STATUS_LABEL[row.status] ?? row.status}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {activeDrills.length > 0 && (
              <>
                <Text style={[s.sectionLabel, { color: dc.textSecondary }]}>ACTIVE DRILLS</Text>
                {activeDrills.map(row => (
                  <TouchableOpacity
                    key={row.id}
                    style={[s.playerRow, { backgroundColor: dc.card, borderColor: dc.border }]}
                    onPress={() => router.push(`/(app)/coach/drill/${row.id}` as any)}
                    activeOpacity={0.8}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[s.coachName, { color: dc.cardText, fontSize: 14 }]}>{row.name}</Text>
                      <Text style={[s.coachMeta, { color: dc.textSecondary }]}>{row.player?.display_name ?? 'Player'}</Text>
                    </View>
                    <View style={[s.statusPill, { backgroundColor: dc.goldDim }]}>
                      <Text style={[s.statusPillText, { color: dc.gold }]}>{DRILL_STATUS_LABEL[row.status] ?? row.status}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {pending.length > 0 && (
              <>
                <Text style={[s.sectionLabel, { color: dc.textSecondary }]}>AWAITING YOUR RESPONSE</Text>
                {pending.map(row => (
                  <View key={row.id} style={[s.playerRow, { backgroundColor: dc.card, borderColor: dc.border }]}>
                    {resolveAvatar(row.player_id, row.player?.avatar_url ?? null)
                      ? <Image source={resolveAvatar(row.player_id, row.player?.avatar_url ?? null)!} style={s.avatarSm} />
                      : <View style={[s.avatarSm, s.avatarFallback, { backgroundColor: `${dc.gold}18` }]}>
                          <Text style={[s.avatarInitial, { color: dc.gold, fontSize: 14 }]}>{(row.player?.display_name ?? '?').charAt(0).toUpperCase()}</Text>
                        </View>
                    }
                    <View style={{ flex: 1 }}>
                      <Text style={[s.coachName, { color: dc.cardText, fontSize: 14 }]}>{row.player?.display_name}</Text>
                      <Text style={[s.coachMeta, { color: dc.textSecondary }]}>
                        {row.player?.t_tag ? `@${row.player.t_tag}` : ''}{row.player?.handicap_index != null ? `  ·  HCP ${row.player.handicap_index}` : ''}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[s.acceptBtn, { backgroundColor: dc.gold }, busyId === row.id && { opacity: 0.5 }]}
                      onPress={() => acceptRequest(row.id)}
                      disabled={busyId === row.id}
                      activeOpacity={0.85}
                    >
                      {busyId === row.id ? <ActivityIndicator color="#000" size="small" /> : <Text style={s.acceptBtnText}>Accept</Text>}
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            )}

            <Text style={[s.sectionLabel, { color: dc.textSecondary }]}>MY PLAYERS</Text>
            {myPlayers.length === 0 ? (
              <Text style={[s.emptyText, { color: dc.textMuted }]}>No players yet.</Text>
            ) : myPlayers.map(row => (
              <View key={row.id} style={[s.playerRow, { backgroundColor: dc.card, borderColor: dc.border }]}>
                {resolveAvatar(row.player_id, row.player?.avatar_url ?? null)
                  ? <Image source={resolveAvatar(row.player_id, row.player?.avatar_url ?? null)!} style={s.avatarSm} />
                  : <View style={[s.avatarSm, s.avatarFallback, { backgroundColor: `${dc.gold}18` }]}>
                      <Text style={[s.avatarInitial, { color: dc.gold, fontSize: 14 }]}>{(row.player?.display_name ?? '?').charAt(0).toUpperCase()}</Text>
                    </View>
                }
                <View style={{ flex: 1 }}>
                  <Text style={[s.coachName, { color: dc.cardText, fontSize: 14 }]}>{row.player?.display_name}</Text>
                  <Text style={[s.coachMeta, { color: dc.textSecondary }]}>
                    {row.player?.t_tag ? `@${row.player.t_tag}` : ''}{row.player?.handicap_index != null ? `  ·  HCP ${row.player.handicap_index}` : ''}
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}

        {!isCoach && (
          <TouchableOpacity style={s.becomeCoach} onPress={() => router.push('/(app)/coach/register' as any)} activeOpacity={0.7}>
            <Text style={[s.becomeCoachText, { color: dc.textSecondary }]}>Are you a coach? <Text style={{ color: dc.gold }}>Set up your Coach Profile</Text></Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={!!confirmRemove}
        title={confirmRemove?.label.startsWith('Cancel') ? 'Cancel Request' : 'Remove Coach'}
        message={confirmRemove?.label ?? ''}
        confirmLabel={confirmRemove?.label.startsWith('Cancel') ? 'Cancel Request' : 'Remove Coach'}
        destructive
        onConfirm={doRemove}
        onCancel={() => setConfirmRemove(null)}
      />
    </KeyboardAvoidingView>
  );
}

function makeStyles(dc: ReturnType<typeof useDynamicColors>) {
  return StyleSheet.create({
    container: { flex: 1 },
    centered: { alignItems: 'center', justifyContent: 'center' },

    header: {
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
      paddingTop: 60, paddingBottom: 16,
    },
    headerSide: { flex: 1 },
    headerCenter: { alignItems: 'center', gap: 4 },
    logo: { width: 28, height: 28 },
    headerSub: { fontFamily: FFB, fontSize: 9, letterSpacing: 2 },

    segment: {
      flexDirection: 'row', marginHorizontal: 16, marginBottom: 16,
      borderRadius: 10, borderWidth: 1, overflow: 'hidden',
    },
    segmentBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
    segmentText: { fontFamily: FFB, fontSize: 13 },

    scroll: { paddingHorizontal: 16, paddingBottom: 48 },

    card: { borderRadius: 16, borderWidth: 1, padding: 20, alignItems: 'center', gap: 8 },
    cardTitle: { fontFamily: FFB, fontSize: 17, marginTop: 4 },
    cardBody: { fontFamily: FF, fontSize: 13, textAlign: 'center', lineHeight: 19, marginBottom: 6 },

    input: {
      alignSelf: 'stretch', borderWidth: 1, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 12, fontFamily: FFB, fontSize: 14,
      textAlign: 'center', marginTop: 4,
    },
    errorText: { color: '#f87171', fontFamily: FFB, fontSize: 12, textAlign: 'center' },

    btn: { alignSelf: 'stretch', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
    btnText: { fontFamily: FFB, fontSize: 14, color: '#000' },
    linkBtn: { paddingVertical: 10, marginTop: 4 },
    linkBtnText: { fontFamily: FFB, fontSize: 13 },

    sectionLabel: { fontFamily: FFB, fontSize: 11, letterSpacing: 1, marginTop: 20, marginBottom: 10 },

    coachRow: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch' },
    coachName: { fontFamily: FFB, fontSize: 16 },
    coachMeta: { fontFamily: FFB, fontSize: 12, marginTop: 2 },

    avatar: { width: 56, height: 56, borderRadius: 28 },
    avatarSm: { width: 40, height: 40, borderRadius: 20 },
    avatarFallback: { alignItems: 'center', justifyContent: 'center' },
    avatarInitial: { fontFamily: FFB, fontSize: 22 },

    statsRow: { flexDirection: 'row', gap: 10 },
    statTile: { flex: 1, borderRadius: 14, borderWidth: 1, paddingVertical: 16, alignItems: 'center' },
    statN: { fontFamily: FFB, fontSize: 26 },
    statLabel: { fontFamily: FFB, fontSize: 11, marginTop: 2 },

    playerRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8,
    },
    acceptBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8 },
    acceptBtnText: { fontFamily: FFB, fontSize: 12, color: '#000' },

    statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
    statusPillText: { fontFamily: FFB, fontSize: 10.5 },

    emptyText: { fontFamily: FFB, fontSize: 13, textAlign: 'center', paddingVertical: 12 },

    becomeCoach: { marginTop: 24, alignItems: 'center' },
    becomeCoachText: { fontFamily: FFB, fontSize: 12.5, textAlign: 'center' },
  });
}
