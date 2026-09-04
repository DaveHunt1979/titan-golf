import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, Image, ScrollView, Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { supabase, fetchAllRows } from '../../../../src/lib/supabase';
import { calcStrokesReceived, calcStablefordPoints, formatStrokeHoles, scoreVsPar, formatVsPar, SCORE_COLORS, ptsColor } from '../../../../src/lib/scoring';
import { resolvePlayingHandicap, type RoundPlayerTeeSnapshot } from '../../../../src/lib/whs';
import { resolveAvatar } from '../../../../src/lib/assets';
import { courseHasGps } from '../../../../src/lib/courseGps';
import { dedupeInitials } from '../../../../src/lib/playerDisplay';
import { enqueueSwindleHole } from '../../../../src/lib/swindleOfflineQueue';
import { goBack } from '../../../../src/lib/navigation';
import { useSwindleSyncStatus } from '../../../../src/lib/useSwindleSyncStatus';
import { isNetworkError } from '../../../../src/lib/offlineQueue';
import { speakIntro, speakBack9, speakOutro, speakPressure } from '../../../../src/lib/caddie';
import RangeMap from '../../../../src/components/RangeMap';

const { width: W } = Dimensions.get('window');
const GOLD     = '#D4AF37';
const GREEN    = '#4ade80';
const RED      = '#f87171';
const BLUE     = '#3b82f6';
const DARKBLUE = '#1e3a8a';
const PLAIN    = '#ffffff';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';
const titanLogo = require('../../../../assets/TitanAppLogo.png');

function Avatar({ playerId, name, size = 44, avatarUrl }: { playerId?: string; name: string; size?: number; avatarUrl?: string | null }) {
  const resolved = playerId ? resolveAvatar(playerId, avatarUrl ?? null, 'normal') : null;
  if (resolved) {
    const imgSrc = typeof resolved === 'string' ? { uri: resolved } : resolved;
    return <Image source={imgSrc} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${GOLD}20`, borderWidth: 1.5, borderColor: `${GOLD}60`, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: FFB, fontSize: size * 0.38, color: GOLD }}>{(name || '?')[0].toUpperCase()}</Text>
    </View>
  );
}

function StatBox({ count, label, color }: { count: number; label: string; color: string }) {
  const textColor = color === PLAIN ? '#000' : '#fff';
  return (
    <View style={[s.statBox, { backgroundColor: color }]}>
      <Text style={[s.statVal, { color: textColor }]}>{count}</Text>
      <Text style={[s.statLbl, { color: textColor }]}>{label}</Text>
    </View>
  );
}

interface Game {
  id: string; name: string; course_name: string | null; format: 'stableford' | 'stroke';
  status: string; slope_rating: number | null; course_rating: number | null; hcp_allowance: number | null;
}
interface CourseHole { hole_number: number; par: number; stroke_index: number; yardage: number | null; green_lat?: number | null; green_lng?: number | null; }
interface HoleScore { hole_number: number; gross: number; pts: number; }
interface GroupPlayer {
  playerId: string; name: string; avatarUrl: string | null;
  handicapIndex: number; courseHcp: number;
  scores: Record<number, { gross: number; pts: number }>;
}

export default function SwindleScoreScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    'JUSTSans':        require('../../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [game, setGame]               = useState<Game | null>(null);
  const [courseHoles, setCourseHoles] = useState<CourseHole[]>([]);
  const [myId, setMyId]               = useState<string | null>(null);
  const [playerName, setPlayerName]   = useState('');
  const [avatarUrl, setAvatarUrl]     = useState<string | null>(null);
  const [playerHcp, setPlayerHcp]     = useState(0);
  const [courseHcp, setCourseHcp]     = useState(0);
  const [savedScores, setSavedScores] = useState<HoleScore[]>([]);
  const [groupPlayers, setGroupPlayers] = useState<GroupPlayer[] | null>(null);
  const [groupStartHole, setGroupStartHole] = useState(1);
  const [groupVoiceOn, setGroupVoiceOn] = useState(true);
  const [entryStartHole, setEntryStartHole] = useState(1);
  const [entryVoiceOn, setEntryVoiceOn] = useState(true);
  const [guestCount, setGuestCount]     = useState(0);
  const [groupLoadError, setGroupLoadError] = useState(false);
  const [loading, setLoading]         = useState(true);
  const [loadError, setLoadError]     = useState(false);
  const [retryTick, setRetryTick]     = useState(0);
  const [saving, setSaving]           = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [selectedScore, setSelectedScore] = useState<number | null>(null);
  const [editingHole, setEditingHole] = useState<number | null>(null);
  const [showRangeMap, setShowRangeMap] = useState(false);
  const syncStatus = useSwindleSyncStatus();

  const isGroupMode = groupPlayers !== null;

  // useFocusEffect, not a plain mount effect — this screen previously only
  // reloaded when gameId itself changed, so re-entering the SAME game (e.g.
  // "Score My Round" again after finishing) reused whatever stale
  // groupPlayers/savedScores state was left over from the last visit. If
  // that state happened to read as complete, the screen just kept showing
  // Round Complete forever regardless of what was actually saved — the
  // "end and back in a loop" bug.
  useFocusEffect(useCallback(() => {
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setLoadError(true); setLoading(false); return; }
        const { data: p } = await supabase.from('players').select('id,display_name,handicap_index,avatar_url').eq('auth_uid', user.id).maybeSingle();
        if (!p) { setLoadError(true); setLoading(false); return; }
        setMyId(p.id);
        setPlayerName(p.display_name ?? '');
        setAvatarUrl(p.avatar_url ?? null);
        setPlayerHcp(p.handicap_index ?? 0);

        const { data: g, error: gameErr } = await supabase.from('swindle_games').select('*').eq('id', gameId).single();
        if (gameErr) throw gameErr;
        if (!g) { setLoadError(true); setLoading(false); return; }
        setGame(g as Game);

        let holes: CourseHole[] = [];
        if (g.course_name) {
          const { data: holesData } = await supabase
            .from('course_holes').select('hole_number,par,stroke_index,yardage,green_lat,green_lng')
            .eq('course_name', g.course_name).order('hole_number');
          if (holesData) holes = holesData as CourseHole[];
        }
        setCourseHoles(holes);
        const coursePar = holes.length > 0 ? holes.reduce((s, h) => s + h.par, 0) : 72;
        const slope = g.slope_rating ?? 113;
        const rating = g.course_rating ?? coursePar;
        // Percentage, matching swindle_games.hcp_allowance and
        // resolvePlayingHandicap's convention (not a 0-1 fraction).
        const allowance = g.hcp_allowance ?? 100;
        const gameAsDay = { slope_rating: slope, course_rating: rating, course_par: coursePar };

        // WHS layer: a frozen per-player snapshot, if this game was started
        // with WHS on. With no row (every existing game) resolvePlayingHandicap
        // falls through to exactly the previous calcCourseHandicap maths.
        const { data: rptData } = await supabase
          .from('round_player_tees')
          .select('player_id,whs_enabled_at_start,playing_handicap_at_start')
          .eq('swindle_game_id', gameId);
        const roundPlayerTees: Record<string, RoundPlayerTeeSnapshot> = {};
        for (const r of (rptData ?? []) as any[]) roundPlayerTees[r.player_id] = r;

        setCourseHcp(resolvePlayingHandicap(p.handicap_index ?? 0, gameAsDay, allowance, roundPlayerTees[p.id]));

        // Does this player belong to a tee-time group for this swindle? If
        // so, "Score My Round" scores the whole group (one scorer, everyone
        // else spectates) — same as casual round's group scoring, restored
        // here from the pre-rollback reference (see the git stash from the
        // 2026-08-10 session) rather than rebuilt from scratch.
        const { data: myMembership, error: membershipErr } = await supabase
          .from('swindle_group_players')
          .select('group_id, swindle_groups!inner(game_id, start_hole, voice_on)')
          .eq('player_id', p.id)
          .eq('is_guest', false)
          .eq('swindle_groups.game_id', gameId)
          .maybeSingle();
        if (membershipErr) console.error('[swindle.score.load] group membership lookup failed', membershipErr);

        if (myMembership) {
          setGroupStartHole((myMembership as any).swindle_groups?.start_hole ?? 1);
          setGroupVoiceOn((myMembership as any).swindle_groups?.voice_on ?? true);
          const { data: roster, error: rosterErr } = await supabase
            .from('swindle_group_players')
            .select('player_id, is_guest')
            .eq('group_id', myMembership.group_id);
          if (rosterErr) console.error('[swindle.score.load] group roster fetch failed', rosterErr);

          const realRows = ((roster ?? []) as any[]).filter(r => !r.is_guest && r.player_id);
          setGuestCount(((roster ?? []) as any[]).filter(r => r.is_guest).length);

          if (realRows.length === 0) {
            // We know we're in a group (myMembership found it) but the
            // roster came back with no real players — including not even
            // ourselves. That's a genuine data problem, not "the group has
            // no one in it" (save() blocks a 0-player group) and definitely
            // not "everyone's finished" — surfacing it as Round Complete
            // here previously was the bug. Show a clear error instead.
            console.error('[swindle.score.load] group found but roster empty', { groupId: myMembership.group_id, rosterErr });
            setGroupLoadError(true);
            setLoading(false);
            return;
          }

          const playerIds = realRows.map(r => r.player_id);
          // Fetch player details as a separate bulk query rather than
          // embedding players(...) inside the swindle_group_players select —
          // matches every other player-detail fetch in this codebase (and
          // the casual group-scoring reference this screen was restored
          // from). players' own RLS is "read own row only", and an embed
          // for teammates here was the suspected cause of the roster
          // silently coming back empty for a real, populated group.
          const { data: playersData, error: playersErr } = playerIds.length
            ? await supabase.from('players').select('id,display_name,avatar_url,handicap_index').in('id', playerIds)
            : { data: [], error: null };
          if (playersErr) console.error('[swindle.score.load] group player details fetch failed', playersErr);
          const playerMap: Record<string, { display_name: string; avatar_url: string | null; handicap_index: number | null }> = {};
          for (const pd of (playersData ?? []) as any[]) playerMap[pd.id] = pd;

          const { data: groupScores } = playerIds.length
            ? await supabase.from('swindle_scores').select('player_id,hole_number,gross_score,stableford_pts').eq('game_id', gameId).in('player_id', playerIds)
            : { data: [] };

          const built: GroupPlayer[] = realRows.map(r => {
            const info = playerMap[r.player_id] ?? { display_name: '—', avatar_url: null, handicap_index: 0 };
            const hcp = info.handicap_index ?? 0;
            const scores: Record<number, { gross: number; pts: number }> = {};
            for (const row of (groupScores ?? []) as any[]) {
              if (row.player_id !== r.player_id) continue;
              scores[row.hole_number] = { gross: row.gross_score ?? 0, pts: row.stableford_pts ?? 0 };
            }
            return {
              playerId: r.player_id, name: info.display_name ?? '—', avatarUrl: info.avatar_url ?? null,
              handicapIndex: hcp, courseHcp: resolvePlayingHandicap(hcp, gameAsDay, allowance, roundPlayerTees[r.player_id]), scores,
            };
          });
          setGroupPlayers(built);
        } else {
          setGroupPlayers(null);
          const { data: entry } = await supabase
            .from('swindle_entries').select('start_hole, voice_on')
            .eq('game_id', gameId).eq('player_id', p.id).maybeSingle();
          setEntryStartHole((entry as any)?.start_hole ?? 1);
          setEntryVoiceOn((entry as any)?.voice_on ?? true);
          const { data: scores } = await supabase
            .from('swindle_scores').select('hole_number, gross_score, stableford_pts')
            .eq('game_id', gameId).eq('player_id', p.id);
          if (scores) {
            setSavedScores(scores.map((sc: any) => ({ hole_number: sc.hole_number, gross: sc.gross_score ?? 0, pts: sc.stableford_pts ?? 0 })));
          }
        }
      } catch (e) {
        console.error('[swindle.score.load] failed', e);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    }
    setLoading(true);
    setLoadError(false);
    setGroupLoadError(false);
    setSavedScores([]);
    setGroupPlayers(null);
    load();
  }, [gameId, retryTick]));

  const scoredSet = new Set(savedScores.map(s => s.hole_number));
  // Same wraparound shape as the group path's groupHoleSequence — a solo
  // player can also start on a shifted hole (two-tee start), so "next hole"
  // and the voice checkpoints below must walk this sequence, not raw 1-18.
  const holeSequence = entryStartHole > 1
    ? [...Array.from({ length: 19 - entryStartHole }, (_, i) => entryStartHole + i), ...Array.from({ length: entryStartHole - 1 }, (_, i) => i + 1)]
    : Array.from({ length: 18 }, (_, i) => i + 1);
  const nextHole  = holeSequence.find(h => !scoredSet.has(h)) ?? 19;
  const activeHole = editingHole ?? nextHole;
  const isComplete = scoredSet.size >= 18;
  const isStableford = (game?.format ?? 'stableford') === 'stableford';

  const courseHole = courseHoles.find(h => h.hole_number === activeHole);
  const shots = courseHole ? calcStrokesReceived(courseHcp, courseHole.stroke_index) : 0;

  const totalGross = savedScores.reduce((s, h) => s + h.gross, 0);
  const totalPts   = savedScores.reduce((s, h) => s + h.pts, 0);
  const parPlayed  = savedScores.reduce((s, h) => {
    const ch = courseHoles.find(c => c.hole_number === h.hole_number);
    return s + (ch?.par ?? 0);
  }, 0);
  const vsPar = totalGross - parPlayed;


  // ── Group mode derived state ──────────────────────────────────────────
  const gp = groupPlayers ?? [];
  const gpInitials = Object.fromEntries(
    dedupeInitials(gp.map(p => p.name)).map((initials, i) => [gp[i].playerId, initials])
  );
  const totalPtsForG   = (p: GroupPlayer) => Object.values(p.scores).reduce((s, v) => s + v.pts, 0);
  const totalVsParForG = (p: GroupPlayer) => Object.entries(p.scores).reduce((s, [h, v]) => {
    const ch = courseHoles.find(c => c.hole_number === Number(h));
    return s + (v.gross - (ch?.par ?? 0));
  }, 0);
  // Two-tee starts (front 9 first vs back 9 first), chosen at group creation
  // — same wraparound shape as casual's start_hole handling in solo.tsx.
  const groupHoleSequence = groupStartHole > 1
    ? [...Array.from({ length: 19 - groupStartHole }, (_, i) => groupStartHole + i), ...Array.from({ length: groupStartHole - 1 }, (_, i) => i + 1)]
    : Array.from({ length: 18 }, (_, i) => i + 1);
  const groupActiveHole   = gp.length > 0 ? (groupHoleSequence.find(h => gp.some(p => !p.scores[h])) ?? 19) : 19;
  const groupCourseHole   = courseHoles.find(h => h.hole_number === groupActiveHole);
  const groupActivePlayer = gp.find(p => !p.scores[groupActiveHole]) ?? null;
  const groupStrokes      = groupActivePlayer && groupCourseHole ? calcStrokesReceived(groupActivePlayer.courseHcp, groupCourseHole.stroke_index) : 0;
  const groupComplete     = gp.length > 0 && gp.every(p => Object.keys(p.scores).length >= 18);
  const groupStandings    = [...gp].sort((a, b) => isStableford ? totalPtsForG(b) - totalPtsForG(a) : totalVsParForG(a) - totalVsParForG(b));
  const groupScoreLineFor = (p: GroupPlayer) => isStableford ? `${totalPtsForG(p)} pts` : formatVsPar(totalVsParForG(p));

  useEffect(() => { setSelectedScore(null); }, [groupActivePlayer?.playerId, groupActiveHole]);

  const introPlayedRef = useRef(false);
  const back9PlayedRef = useRef(false);
  useEffect(() => {
    if (isGroupMode || !game || !playerName || loading || introPlayedRef.current || !entryVoiceOn) return;
    if (nextHole === holeSequence[0]) {
      introPlayedRef.current = true;
      speakIntro([playerName.split(' ')[0]], entryStartHole, holeSequence[17]);
    }
  }, [isGroupMode, game, playerName, loading, nextHole, entryVoiceOn]);

  useEffect(() => {
    if (isGroupMode || !game || !playerName || loading || back9PlayedRef.current || !entryVoiceOn) return;
    if (nextHole === holeSequence[9]) {
      back9PlayedRef.current = true;
      const front9 = savedScores.filter(h => h.hole_number <= 9);
      const frontGross  = front9.reduce((s, h) => s + h.gross, 0);
      const frontPts    = front9.reduce((s, h) => s + h.pts,   0);
      const frontParSum = front9.reduce((s, h) => {
        const ch = courseHoles.find(c => c.hole_number === h.hole_number);
        return s + (ch?.par ?? 0);
      }, 0);
      speakBack9(playerName.split(' ')[0], isStableford ? 'stableford' : 'medal', frontPts, frontGross, frontGross - frontParSum);
    }
  }, [isGroupMode, nextHole]);

  async function saveScore() {
    if (selectedScore === null || !myId || !game || !courseHole) return;

    const par   = courseHole.par;
    const gross = selectedScore;
    const pts   = calcStablefordPoints(gross, par, shots);
    const holeToSave = activeHole;
    const wasEditing = editingHole !== null;

    setModalVisible(false);
    setSavedScores(prev => [...prev.filter(h => h.hole_number !== holeToSave), { hole_number: holeToSave, gross, pts }]);
    setEditingHole(null);
    setSelectedScore(null);

    setSaving(true);
    try {
      if (syncStatus.pendingCount > 0) await syncStatus.syncNow();

      let savedOffline = false;
      try {
        const { error } = await supabase.from('swindle_scores').upsert({
          game_id: gameId, player_id: myId, hole_number: holeToSave,
          gross_score: gross, stableford_pts: pts,
        }, { onConflict: 'game_id,player_id,hole_number' });
        if (error) throw error;
      } catch (err: any) {
        if (!isNetworkError(err)) {
          console.error('swindle save error:', err);
          Alert.alert('Save failed', `That score didn't save: ${err?.message ?? 'unknown error'}`);
          return;
        }
        savedOffline = true;
        await enqueueSwindleHole({ gameId: gameId as string, playerId: myId, holeNumber: holeToSave, grossScore: gross, stablefordPts: pts });
        syncStatus.syncNow();
      }

      // Everything below needs the network — the score itself is already
      // safe locally either way, so skip these rather than fail loudly.
      if (savedOffline) return;

      if (game.status === 'open') {
        await supabase.from('swindle_games').update({ status: 'in_progress' }).eq('id', gameId);
        setGame(prev => prev ? { ...prev, status: 'in_progress' } : prev);
      }

      if (!wasEditing && entryVoiceOn && [6, 9, 12, 15, 16, 17, 18].includes(holeSequence.indexOf(holeToSave) + 1)) {
        // Paged — an unbounded .select() stops at PostgREST's 1000-row cap,
        // which a big field (18 rows per entrant) passes at ~55 players, and
        // Chip/Birdie would then call the pressure standings off a truncated
        // points total.
        const allScores = await fetchAllRows<any>(
          (from, to) => supabase.from('swindle_scores').select('player_id, stableford_pts').eq('game_id', gameId).order('id').range(from, to)
        );
        const { data: entries } = await supabase.from('swindle_entries').select('player_id, players(display_name)').eq('game_id', gameId);
        if (allScores.length && entries) {
          const totals: Record<string, number> = {};
          for (const sc of allScores as any[]) totals[sc.player_id] = (totals[sc.player_id] ?? 0) + (sc.stableford_pts ?? 0);
          const standings = (entries as any[]).map(e => ({
            name: (e.players?.display_name ?? 'Player').split(' ')[0],
            pts: totals[e.player_id] ?? 0,
          })).sort((a, b) => b.pts - a.pts);
          speakPressure({ standings, holeNumber: holeToSave, holesLeft: 18 - scoredSet.size - (wasEditing ? 0 : 1), format: 'stableford' });
        }
      }
    } finally {
      setSaving(false);
    }
  }

  async function chooseStartHole(h: 1 | 10) {
    if (!myId) return;
    setEntryStartHole(h);
    await supabase.from('swindle_entries')
      .upsert({ game_id: gameId, player_id: myId, start_hole: h }, { onConflict: 'game_id,player_id' });
  }

  async function chooseVoiceOn(v: boolean) {
    if (!myId) return;
    setEntryVoiceOn(v);
    await supabase.from('swindle_entries')
      .upsert({ game_id: gameId, player_id: myId, voice_on: v }, { onConflict: 'game_id,player_id' });
  }

  async function undoHole() {
    const seqPos = holeSequence.indexOf(nextHole);
    if (!myId || saving || seqPos <= 0) return;
    const lastDone = holeSequence[seqPos - 1];
    setSaving(true);
    await supabase.from('swindle_scores').delete().eq('game_id', gameId).eq('player_id', myId).eq('hole_number', lastDone);
    setSavedScores(prev => prev.filter(h => h.hole_number !== lastDone));
    setSaving(false);
  }

  async function saveScoreGroup() {
    if (selectedScore === null || !groupActivePlayer || !groupCourseHole || saving || !game) return;
    const gross = selectedScore;
    const pts   = calcStablefordPoints(gross, groupCourseHole.par, groupStrokes);
    const forPlayerId = groupActivePlayer.playerId;
    const forHole = groupActiveHole;

    // Optimistic update first, same as solo — the local group state should
    // never wait on the network, only the eventual sync does.
    const updated = gp.map(p => p.playerId !== forPlayerId ? p : {
      ...p, scores: { ...p.scores, [forHole]: { gross, pts } },
    });
    setGroupPlayers(updated);
    const holeStillNeedsSomeone = updated.some(p => !p.scores[forHole]);
    if (!holeStillNeedsSomeone) setModalVisible(false);

    setSaving(true);
    try {
      if (syncStatus.pendingCount > 0) await syncStatus.syncNow();

      let savedOffline = false;
      try {
        const { error } = await supabase.from('swindle_scores').upsert({
          game_id: gameId, player_id: forPlayerId, hole_number: forHole,
          gross_score: gross, stableford_pts: pts,
        }, { onConflict: 'game_id,player_id,hole_number' });
        if (error) throw error;
      } catch (err: any) {
        if (!isNetworkError(err)) {
          console.error('[swindle.group.save] failed', err);
          Alert.alert('Save failed', `That score didn't save: ${err?.message ?? 'unknown error'}`);
          return;
        }
        savedOffline = true;
        await enqueueSwindleHole({ gameId: gameId as string, playerId: forPlayerId, holeNumber: forHole, grossScore: gross, stablefordPts: pts });
        syncStatus.syncNow();
      }

      if (savedOffline) return;

      if (game.status === 'open') {
        await supabase.from('swindle_games').update({ status: 'in_progress' }).eq('id', gameId);
        setGame(prev => prev ? { ...prev, status: 'in_progress' } : prev);
      }

      // One commentary line per completed hole for the whole group — not
      // per player saved, or four players finishing hole 15 would each
      // trigger it back-to-back on whoever's holding the scoring phone.
      if (!holeStillNeedsSomeone && groupVoiceOn) {
        const pos = groupHoleSequence.indexOf(forHole) + 1;
        if ([6, 9, 12, 15, 16, 17, 18].includes(pos)) {
          const standings = [...updated]
            .sort((a, b) => totalPtsForG(b) - totalPtsForG(a))
            .map(pl => ({ name: pl.name.split(' ')[0], pts: totalPtsForG(pl) }));
          speakPressure({ standings, holeNumber: forHole, holesLeft: 18 - pos, format: 'stableford' });
        }
      }
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return (
    <View style={s.loading}>
      <Text style={{ fontFamily: FFB, color: '#fff', fontSize: 16, marginBottom: 16 }}>Couldn't load this round.</Text>
      <TouchableOpacity style={s.ctaBtn} onPress={() => setRetryTick(t => t + 1)} activeOpacity={0.85}>
        <Text style={s.ctaBtnText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
  if (groupLoadError) return (
    <View style={s.loading}>
      <Text style={{ fontFamily: FFB, color: '#fff', fontSize: 16, marginBottom: 16, textAlign: 'center', paddingHorizontal: 24 }}>
        Couldn't load your tee-time group's players.
      </Text>
      <TouchableOpacity style={s.ctaBtn} onPress={() => setRetryTick(t => t + 1)} activeOpacity={0.85}>
        <Text style={s.ctaBtnText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
  if (loading || !fontsLoaded) return (
    <View style={s.loading}><ActivityIndicator color={GOLD} size="large" /></View>
  );
  if (!game) return (
    <View style={s.loading}><Text style={{ fontFamily: FFB, color: '#fff' }}>Swindle not found.</Text></View>
  );

  const formatLabel = isStableford ? 'Stableford' : 'Medal';

  // ══════════════════════════════════════════════════════════════════════
  // GROUP MODE — one scorer for the whole tee-time group, everyone else
  // spectates via the swindle lobby. Restored from the casual round's group
  // scoring feature (build 111/112, rolled back 2026-08-10 but recovered
  // from the git stash) rather than redesigned — same two-layer shape as
  // solo scoring: a persistent background (hole strip, current-hole card,
  // standings) with the hero-circle/grid entry living in a modal per turn.
  // ══════════════════════════════════════════════════════════════════════
  if (isGroupMode) {
    // gp.length > 0 is required explicitly, not just "no active player" —
    // an empty roster (data problem) must never render as Round Complete.
    // load() already redirects to groupLoadError before setting an empty
    // groupPlayers array, but this stays as a second line of defence.
    if (gp.length === 0) return (
      <View style={s.loading}>
        <Text style={{ fontFamily: FFB, color: '#fff', fontSize: 16, marginBottom: 16, textAlign: 'center', paddingHorizontal: 24 }}>
          Couldn't load your tee-time group's players.
        </Text>
        <TouchableOpacity style={s.ctaBtn} onPress={() => setRetryTick(t => t + 1)} activeOpacity={0.85}>
          <Text style={s.ctaBtnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
    if (groupComplete || !groupActivePlayer || !groupCourseHole) {
      return (
        <View style={s.root}>
          <StatusBar style="light" />
          <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 64, paddingBottom: 60 }}>
            <Ionicons name="trophy" size={48} color={GOLD} style={{ alignSelf: 'center' }} />
            <Text style={s.doneTitle}>ROUND COMPLETE</Text>
            <Text style={s.doneSub}>{game.course_name ?? game.name}</Text>

            {groupStandings.map((p, i) => {
              const holesWithPar = Object.entries(p.scores)
                .map(([h, v]) => { const par = courseHoles.find(c => c.hole_number === Number(h))?.par ?? 0; return { hole: Number(h), gross: v.gross, pts: v.pts, par, vsPar: v.gross - par }; })
                .sort((a, b) => a.hole - b.hole);
              const eagles  = holesWithPar.filter(h => h.vsPar <= -2).length;
              const birdies = holesWithPar.filter(h => h.vsPar === -1).length;
              const pars    = holesWithPar.filter(h => h.vsPar === 0).length;
              const bogeys  = holesWithPar.filter(h => h.vsPar === 1).length;
              const doubles = holesWithPar.filter(h => h.vsPar >= 2).length;
              const bestHole  = holesWithPar.length ? holesWithPar.reduce((b, h) => h.vsPar < b.vsPar ? h : b) : null;
              const worstHole = holesWithPar.length ? holesWithPar.reduce((b, h) => h.vsPar > b.vsPar ? h : b) : null;
              const vsParLabel = (v: number) => v <= -2 ? 'Eagle+' : v === -1 ? 'Birdie' : v === 0 ? 'Par' : v === 1 ? 'Bogey' : v === 2 ? 'Double' : 'Triple+';
              const totalGrossP = holesWithPar.reduce((s, h) => s + h.gross, 0);
              return (
                <View key={p.playerId} style={s.playerResultCard}>
                  <View style={[s.standRow, { borderBottomWidth: 0, marginBottom: 0 }]}>
                    <Text style={[s.standRank, i === 0 && { color: GOLD }]}>{i + 1}</Text>
                    <Avatar playerId={p.playerId} avatarUrl={p.avatarUrl} name={p.name} size={36} />
                    <Text style={s.standName}>{p.name}</Text>
                    <Text style={[s.standPts, i === 0 && { color: GOLD }]}>{groupScoreLineFor(p)}</Text>
                  </View>
                  <Text style={s.playerResultDetail}>
                    {isStableford ? `${totalGrossP} gross · ${totalPtsForG(p)} pts` : `${totalGrossP} gross`}
                  </Text>

                  <View style={s.statGrid}>
                    {eagles  > 0 && <StatBox count={eagles}  color={GOLD}     label={`Eagle${eagles !== 1 ? 's' : ''}`} />}
                    {birdies > 0 && <StatBox count={birdies} color={RED}      label={`Birdie${birdies !== 1 ? 's' : ''}`} />}
                    {pars    > 0 && <StatBox count={pars}    color={PLAIN}    label={`Par${pars !== 1 ? 's' : ''}`} />}
                    {bogeys  > 0 && <StatBox count={bogeys}  color={BLUE}     label={`Bogey${bogeys !== 1 ? 's' : ''}`} />}
                    {doubles > 0 && <StatBox count={doubles} color={DARKBLUE} label={`Double${doubles !== 1 ? 's' : ''}+`} />}
                  </View>

                  {bestHole && worstHole && bestHole.hole !== worstHole.hole && (
                    <View style={s.bestWorstRow}>
                      <View style={s.bestWorstBox}>
                        <Text style={s.bestWorstLbl}>BEST</Text>
                        <Text style={[s.bestWorstVal, { color: GREEN }]}>Hole {bestHole.hole}</Text>
                        <Text style={s.bestWorstSub}>{vsParLabel(bestHole.vsPar)}</Text>
                      </View>
                      <View style={s.bestWorstBox}>
                        <Text style={s.bestWorstLbl}>WORST</Text>
                        <Text style={[s.bestWorstVal, { color: RED }]}>Hole {worstHole.hole}</Text>
                        <Text style={s.bestWorstSub}>{vsParLabel(worstHole.vsPar)}</Text>
                      </View>
                    </View>
                  )}
                </View>
              );
            })}

            <TouchableOpacity
              style={s.ctaBtn}
              onPress={() => router.replace(`/(app)/swindle/${gameId}` as any)}
              activeOpacity={0.85}
            >
              <Text style={s.ctaBtnText}>Back to Swindle</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      );
    }

    const gPar = groupCourseHole.par;

    return (
      <View style={s.root}>
        <StatusBar style="light" />

        <View style={s.header}>
          <TouchableOpacity onPress={() => goBack(router, `/(app)/swindle/${gameId}`)} style={s.headerSide} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={24} color="#ffffff" />
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
            <Text style={s.headerSub} numberOfLines={1}>{game.course_name ?? game.name} · Group Scoring</Text>
          </View>
          <View style={s.headerSide} />
        </View>

        <View style={s.playerBlock}>
          <Avatar playerId={groupActivePlayer.playerId} avatarUrl={groupActivePlayer.avatarUrl} name={groupActivePlayer.name} size={44} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.playerNameText}>{groupActivePlayer.name}'s turn</Text>
            <Text style={s.playerHcpText}>HCP {groupActivePlayer.handicapIndex.toFixed(1)} · Course {groupActivePlayer.courseHcp}</Text>
          </View>
          <View style={s.scoreDisplay}>
            <Text style={[s.scoreDisplayVal, { color: isStableford ? GOLD : PLAIN }]}>{groupScoreLineFor(groupActivePlayer)}</Text>
            <Text style={s.scoreDisplayLabel}>{isStableford ? 'POINTS' : 'VS PAR'}</Text>
          </View>
        </View>

        <View style={s.progressRow}>
          {gp.map(p => {
            const done = !!p.scores[groupActiveHole];
            const isTurn = p.playerId === groupActivePlayer.playerId;
            return (
              <View key={p.playerId} style={[s.progressDotWrap, isTurn && s.progressDotWrapActive]}>
                <Avatar playerId={p.playerId} avatarUrl={p.avatarUrl} name={p.name} size={30} />
                <View style={[s.progressDot, done ? { backgroundColor: GREEN } : isTurn ? { backgroundColor: GOLD } : { backgroundColor: '#333' }]} />
              </View>
            );
          })}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.holeStrip} style={s.holeStripWrap}>
          {groupHoleSequence.map(h => {
            const done = gp.every(p => !!p.scores[h]);
            const active = h === groupActiveHole;
            const ch = courseHoles.find(x => x.hole_number === h);
            const holeStat = done
              ? (isStableford
                  ? String(gp.reduce((sum, p) => sum + (p.scores[h]?.pts ?? 0), 0))
                  : formatVsPar(Math.min(...gp.map(p => (p.scores[h]?.gross ?? Infinity) - (ch?.par ?? 0)))))
              : null;
            return (
              <View
                key={h}
                style={[
                  s.holeTile,
                  done && { backgroundColor: `${GREEN}18`, borderColor: `${GREEN}50` },
                  active && !done && { borderColor: `${GOLD}80` },
                ]}
              >
                <Text allowFontScaling={false} style={[s.holeTileNum, done && { color: GREEN }, active && !done && { color: GOLD }]}>{h}</Text>
                <Text allowFontScaling={false} style={s.holeTilePar}>P{ch?.par ?? '?'}</Text>
                {holeStat !== null && <Text allowFontScaling={false} style={[s.holeTilePts, { color: GREEN }]}>{holeStat}</Text>}
              </View>
            );
          })}
        </ScrollView>
        <View style={s.halfLabels}>
          <Text style={s.halfLabel}>FRONT 9</Text>
          <Text style={s.halfLabel}>BACK 9</Text>
        </View>

        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {syncStatus.pendingCount > 0 && (
            <View style={s.offlineBanner}>
              <Ionicons name="cloud-offline-outline" size={13} color="#fff" />
              <Text style={s.offlineBannerText}>{syncStatus.pendingCount} score{syncStatus.pendingCount !== 1 ? 's' : ''} saved offline — will sync when connected</Text>
            </View>
          )}
          {guestCount > 0 && (
            <View style={s.guestNote}>
              <Ionicons name="information-circle-outline" size={13} color="#9ca3af" />
              <Text style={s.guestNoteText}>{guestCount} guest{guestCount !== 1 ? 's' : ''} in this group {guestCount !== 1 ? "aren't" : "isn't"} scored here — guest scoring isn't set up yet.</Text>
            </View>
          )}

          <View style={s.groupHoleCard}>
            <View style={s.holeCardTop}>
              <View style={s.holeNumberBlock}>
                <Text style={s.holeLabelSmall}>HOLE</Text>
                {/* Force one line regardless of the device's text-size/zoom
                    setting — without this, a 2-digit hole number can wrap
                    into a digit stacked on a digit when Dynamic Type is
                    scaled up (matches score/enter's identical fix). */}
                <Text
                  style={s.holeBig}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.5}
                  allowFontScaling={false}
                >
                  {groupActiveHole}
                </Text>
                <View style={s.groupHoleChips}>
                  <View style={s.holeChip}><Text style={s.holeChipText}>Par {gPar}</Text></View>
                  <View style={s.holeChip}><Text style={s.holeChipText}>SI {groupCourseHole.stroke_index}</Text></View>
                  {groupCourseHole.yardage ? <View style={s.holeChip}><Text style={s.holeChipText}>{groupCourseHole.yardage}y</Text></View> : null}
                </View>
              </View>

              <View style={s.holeCardDivider} />

              <View style={s.leaderboard}>
                <Text style={[s.holeLabelSmall, { marginBottom: 4 }]}>HOLES WITH EXTRA SHOTS</Text>
                {gp.map(p => {
                  const getsShotHere = calcStrokesReceived(p.courseHcp, groupCourseHole.stroke_index) > 0;
                  return (
                    <View key={p.playerId} style={s.lbRow}>
                      <Avatar playerId={p.playerId} avatarUrl={p.avatarUrl} name={p.name} size={28} />
                      {/* Fixed-width initials (not flex) — always 2
                          characters, so the freed width goes to the
                          stroke-holes text instead. Matches score/enter. */}
                      <Text style={[s.lbName, { flex: 0, width: 32 }]} numberOfLines={1}>{gpInitials[p.playerId]}</Text>
                      {getsShotHere && (
                        <View style={s.shotPill}><Text style={s.shotPillText}>SHOT</Text></View>
                      )}
                      <Text style={s.lbStrokes} numberOfLines={3}>{formatStrokeHoles(p.courseHcp, courseHoles)}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            <View style={s.quickActions}>
              {courseHasGps(courseHoles) && (
                <>
                  <TouchableOpacity style={s.quickActionBtn} onPress={() => setShowRangeMap(true)} activeOpacity={0.7}>
                    <Ionicons name="scan-outline" size={20} color="#ffffff" />
                    <Text style={s.quickActionLbl}>RANGE</Text>
                  </TouchableOpacity>
                  <View style={s.quickActionSep} />
                </>
              )}
              <TouchableOpacity style={s.quickActionBtn} onPress={() => router.push(`/(app)/swindle/${gameId}` as any)} activeOpacity={0.7}>
                <Ionicons name="trophy-outline" size={20} color="#ffffff" />
                <Text style={s.quickActionLbl}>LEADERS</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={s.ctaBtn} onPress={() => setModalVisible(true)} activeOpacity={0.85}>
            <Ionicons name="create-outline" size={20} color="#000000" />
            <Text style={s.ctaBtnText}>Score Hole {groupActiveHole} · {groupActivePlayer.name.split(' ')[0]}'s turn</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.undoBtn}
            // replace, not push — same dangling-subscription risk as
            // score/enter/[matchId].tsx's identical button; see that
            // file's comment for the full explanation.
            onPress={() => router.replace(`/(app)/swindle/${gameId}` as any)}
            activeOpacity={0.85}
          >
            <Ionicons name="eye-outline" size={16} color="#6b7280" />
            <Text style={s.undoBtnText}>Spectator — just watch, don't score</Text>
          </TouchableOpacity>

          <View style={s.scorecardCard}>
            <Text style={s.scorecardTitle}>STANDINGS</Text>
            {groupStandings.map((p, i) => {
              const holesPlayed = Object.keys(p.scores).length;
              return (
                <View key={p.playerId} style={s.standRowCompact}>
                  <Text style={[s.standRank, i === 0 && { color: GOLD }]}>{i + 1}</Text>
                  <Avatar playerId={p.playerId} avatarUrl={p.avatarUrl} name={p.name} size={28} />
                  <Text style={s.standNameCompact}>{p.name.split(' ')[0]}</Text>
                  <Text style={s.standHoles}>{holesPlayed} hole{holesPlayed !== 1 ? 's' : ''}</Text>
                  <Text style={[s.standPtsCompact, i === 0 && { color: GOLD }]}>{groupScoreLineFor(p)}</Text>
                </View>
              );
            })}
          </View>
        </ScrollView>

        <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
          <View style={s.overlay}>
            <View style={s.sheet}>
              <ScrollView contentContainerStyle={s.sheetScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <View style={s.sheetHandle} />
                <View style={s.sheetPlayerRow}>
                  <Avatar playerId={groupActivePlayer.playerId} avatarUrl={groupActivePlayer.avatarUrl} name={groupActivePlayer.name} size={38} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={s.sheetPlayerName}>{groupActivePlayer.name}</Text>
                    <Text style={s.sheetHoleInfo}>Hole {groupActiveHole} · Par {gPar} · SI {groupCourseHole.stroke_index}</Text>
                  </View>
                </View>
                {groupStrokes > 0 && (
                  <View style={s.sheetShotBadge}>
                    <Ionicons name="golf-outline" size={12} color={GOLD} />
                    <Text style={s.sheetShotBadgeText}>Gets {groupStrokes} shot{groupStrokes > 1 ? 's' : ''} on this hole</Text>
                  </View>
                )}

                {(() => {
                  const result = selectedScore ? scoreVsPar(selectedScore, gPar) : null;
                  const accent = result ? (SCORE_COLORS[result] ?? '#6b7280') : '#1c1c1c';
                  const stablePts = selectedScore ? calcStablefordPoints(selectedScore, gPar, groupStrokes) : null;

                  return (
                    <>
                      <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 28 }}>
                          <TouchableOpacity
                            onPress={() => setSelectedScore(selectedScore === null ? gPar : Math.max(1, selectedScore - 1))}
                            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                          >
                            <Ionicons name="remove-circle" size={42} color={selectedScore && selectedScore > 1 ? '#ffffff' : '#555'} />
                          </TouchableOpacity>

                          <View style={{
                            width: 100, height: 100, borderRadius: 50,
                            backgroundColor: selectedScore ? accent : '#111',
                            borderWidth: 2, borderColor: selectedScore ? accent : '#2c2c2c',
                            alignItems: 'center', justifyContent: 'center',
                            shadowColor: selectedScore ? accent : 'transparent',
                            shadowOffset: { width: 0, height: 0 }, shadowRadius: 20, shadowOpacity: 0.6,
                            elevation: 10,
                          }}>
                            <Text style={{ fontFamily: FFB, fontSize: 50, color: selectedScore ? (accent === PLAIN ? '#000' : '#fff') : '#2c2c2c', lineHeight: 56 }}>
                              {selectedScore ?? '?'}
                            </Text>
                          </View>

                          <TouchableOpacity
                            onPress={() => setSelectedScore(selectedScore === null ? gPar : Math.min(12, selectedScore + 1))}
                            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                          >
                            <Ionicons name="add-circle" size={42} color="#ffffff" />
                          </TouchableOpacity>
                        </View>

                        <View style={{ alignItems: 'center', marginTop: 10, minHeight: 36 }}>
                          {selectedScore ? (
                            isStableford && stablePts !== null
                              ? <Text style={{ fontFamily: FFB, fontSize: 22, color: '#fff' }}>{stablePts}<Text style={{ fontFamily: FFB, fontSize: 13, color: '#fff' }}> pts</Text></Text>
                              : null
                          ) : (
                            <Text style={{ fontFamily: FF, fontSize: 13, color: '#ffffff' }}>tap a number or use arrows</Text>
                          )}
                        </View>
                      </View>

                      {[[1,2,3,4,5],[6,7,8,9,10]].map((row, ri) => (
                        <View key={ri} style={{ flexDirection: 'row', gap: 7, marginTop: ri === 0 ? 0 : 7 }}>
                          {row.map(n => {
                            const r = scoreVsPar(n, gPar);
                            const a = SCORE_COLORS[r] ?? '#6b7280';
                            const on = selectedScore === n;
                            return (
                              <TouchableOpacity
                                key={n}
                                style={{
                                  flex: 1, height: 44, borderRadius: 10,
                                  backgroundColor: on ? a : '#111',
                                  borderWidth: 1.5, borderColor: on ? a : '#222',
                                  alignItems: 'center', justifyContent: 'center',
                                }}
                                onPress={() => setSelectedScore(n)}
                                activeOpacity={0.7}
                              >
                                <Text style={{ fontFamily: FFB, fontSize: 16, color: on ? (a === PLAIN ? '#000' : '#fff') : '#fff' }}>{n}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ))}

                      <TouchableOpacity
                        style={[s.submitBtn, (!selectedScore || saving) && { opacity: 0.35 }]}
                        onPress={saveScoreGroup}
                        disabled={!selectedScore || saving}
                        activeOpacity={0.85}
                      >
                        {saving ? <ActivityIndicator color="#000" /> : <Text style={s.submitBtnText}>Save Hole {groupActiveHole}</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setModalVisible(false)} style={{ paddingVertical: 14, alignItems: 'center' }}>
                        <Text style={{ fontFamily: FFB, color: '#ffffff', fontSize: 14 }}>Cancel</Text>
                      </TouchableOpacity>
                    </>
                  );
                })()}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal visible={showRangeMap} transparent animationType="slide" onRequestClose={() => setShowRangeMap(false)}>
          <View style={s.popupOverlay}>
            <View style={[s.popupSheet, { height: '75%' }]}>
              <View style={s.sheetHandle} />
              <View style={s.popupTitleRow}>
                <Ionicons name="scan-outline" size={16} color={GOLD} />
                <Text style={s.popupTitleText}>RANGE FINDER</Text>
                <TouchableOpacity onPress={() => setShowRangeMap(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-outline" size={22} color="#ffffff" />
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1 }}>
                <RangeMap courseName={game?.course_name ?? undefined} holeNumber={groupActiveHole} />
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // SOLO MODE — no tee-time group; scoring just your own round.
  // ══════════════════════════════════════════════════════════════════════
  const scoreDisplay = isStableford ? `${totalPts} pts` : formatVsPar(vsPar);
  const scoreColor = isStableford ? GOLD : (vsPar < 0 ? GREEN : vsPar > 0 ? RED : '#ffffff');

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack(router, `/(app)/swindle/${gameId}`)} style={s.headerSide} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Image source={titanLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerSub} numberOfLines={1}>{game.course_name ?? game.name} · {formatLabel}</Text>
        </View>
        <View style={s.headerSide} />
      </View>

      {/* ── Player + score ── */}
      <View style={s.playerBlock}>
        <Avatar playerId={myId ?? undefined} name={playerName} size={52} avatarUrl={avatarUrl} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={s.playerNameText}>{playerName}</Text>
          <Text style={s.playerHcpText}>HCP {playerHcp} · Course {courseHcp}</Text>
        </View>
        <View style={s.scoreDisplay}>
          <Text style={[s.scoreDisplayVal, { color: scoreColor }]}>{scoreDisplay}</Text>
          <Text style={s.scoreDisplayLabel}>{isStableford ? 'POINTS' : 'VS PAR'}</Text>
        </View>
      </View>

      {/* ── Hole strip ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.holeStrip} style={s.holeStripWrap}>
        {Array.from({ length: 18 }, (_, i) => {
          const h = i + 1;
          const done = scoredSet.has(h);
          const active = h === activeHole && !isComplete;
          const ch = courseHoles.find(x => x.hole_number === h);
          const sc = savedScores.find(sv => sv.hole_number === h);
          const tc = done ? (sc ? SCORE_COLORS[scoreVsPar(sc.gross, ch?.par ?? 4)] : '#6b7280') : 'transparent';
          return (
            <TouchableOpacity
              key={h}
              onPress={done ? () => {
                setSelectedScore(sc?.gross ?? null);
                setEditingHole(h);
                setModalVisible(true);
              } : undefined}
              style={[
                s.holeTile,
                done && { backgroundColor: `${tc}22`, borderColor: `${tc}60` },
                active && !done && { borderColor: `${GOLD}80` },
              ]}
              activeOpacity={done ? 0.7 : 1}
            >
              <Text allowFontScaling={false} style={[s.holeTileNum, done && { color: tc }, active && !done && { color: GOLD }]}>{h}</Text>
              <Text allowFontScaling={false} style={s.holeTilePar}>P{ch?.par ?? '?'}</Text>
              {done && sc && (
                <Text allowFontScaling={false} style={[s.holeTilePts, { color: tc }]}>
                  {isStableford ? sc.pts : (sc.gross - (ch?.par ?? 4) === 0 ? 'E' : sc.gross - (ch?.par ?? 4) > 0 ? `+${sc.gross - (ch?.par ?? 4)}` : String(sc.gross - (ch?.par ?? 4)))}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View style={s.halfLabels}>
        <Text style={s.halfLabel}>FRONT 9</Text>
        <Text style={s.halfLabel}>BACK 9</Text>
      </View>

      {/* ── Scrollable body ── */}
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {syncStatus.pendingCount > 0 && (
          <View style={s.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={13} color="#fff" />
            <Text style={s.offlineBannerText}>{syncStatus.pendingCount} score{syncStatus.pendingCount !== 1 ? 's' : ''} saved offline — will sync when connected</Text>
          </View>
        )}
        {!isComplete ? (
          <>
            {/* Hole card */}
            <View style={s.holeCard}>
              <Text style={s.holeLabelSmall}>HOLE</Text>
              <Text
                style={s.holeBig}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.5}
                allowFontScaling={false}
              >
                {nextHole}
              </Text>
              {courseHole && (
                <View style={s.holeChips}>
                  <View style={s.holeChip}><Text style={s.holeChipText}>Par {courseHole.par}</Text></View>
                  <View style={s.holeChip}><Text style={s.holeChipText}>SI {courseHole.stroke_index}</Text></View>
                  {courseHole.yardage ? <View style={s.holeChip}><Text style={s.holeChipText}>{courseHole.yardage}y</Text></View> : null}
                  {shots > 0 && (
                    <View style={[s.holeChip, s.holeChipGold]}>
                      <Ionicons name="golf-outline" size={10} color={GOLD} />
                      <Text style={[s.holeChipText, { color: GOLD }]}>+{shots} shot{shots > 1 ? 's' : ''}</Text>
                    </View>
                  )}
                </View>
              )}
              <View style={s.quickActions}>
                {courseHasGps(courseHoles) && (
                  <>
                    <TouchableOpacity style={s.quickActionBtn} onPress={() => setShowRangeMap(true)} activeOpacity={0.7}>
                      <Ionicons name="scan-outline" size={20} color="#ffffff" />
                      <Text style={s.quickActionLbl}>RANGE</Text>
                    </TouchableOpacity>
                    <View style={s.quickActionSep} />
                  </>
                )}
                <TouchableOpacity
                  style={s.quickActionBtn}
                  onPress={() => router.push(`/(app)/swindle/${gameId}` as any)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="trophy-outline" size={20} color="#ffffff" />
                  <Text style={s.quickActionLbl}>LEADERS</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Starting hole — two-tee starts, same choice groups get in swindle/group/new.tsx.
                Only shown before the first score is entered. */}
            {savedScores.length === 0 && !editingHole && (
              <View style={s.startHoleRow}>
                <Text style={s.startHoleLabel}>STARTING HOLE</Text>
                <View style={s.startHoleToggle}>
                  {([1, 10] as const).map(h => (
                    <TouchableOpacity
                      key={h}
                      style={[s.startHoleBtn, entryStartHole === h && s.startHoleBtnActive]}
                      onPress={() => chooseStartHole(h)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.startHoleBtnText, entryStartHole === h && s.startHoleBtnTextActive]}>Hole {h}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {savedScores.length === 0 && !editingHole && (
              <View style={s.startHoleRow}>
                <Text style={s.startHoleLabel}>CHIP &amp; BIRDIE VOICE</Text>
                <View style={s.startHoleToggle}>
                  {([true, false] as const).map(v => (
                    <TouchableOpacity
                      key={String(v)}
                      style={[s.startHoleBtn, entryVoiceOn === v && s.startHoleBtnActive]}
                      onPress={() => chooseVoiceOn(v)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.startHoleBtnText, entryVoiceOn === v && s.startHoleBtnTextActive]}>{v ? 'On' : 'Off'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Main CTA */}
            <TouchableOpacity
              style={[s.ctaBtn, editingHole ? { backgroundColor: '#ffffff' } : null]}
              onPress={() => { setEditingHole(null); setSelectedScore(null); setModalVisible(true); }}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Ionicons name="create-outline" size={20} color="#000000" />
              <Text style={s.ctaBtnText}>
                {editingHole ? `Edit Hole ${editingHole}` : `Score Hole ${nextHole}`}
              </Text>
            </TouchableOpacity>

            {editingHole ? (
              <TouchableOpacity style={s.undoBtn} onPress={() => setEditingHole(null)} disabled={saving}>
                <Text style={s.undoBtnText}>Cancel Edit</Text>
              </TouchableOpacity>
            ) : holeSequence.indexOf(nextHole) > 0 ? (
              <TouchableOpacity style={s.undoBtn} onPress={undoHole} disabled={saving}>
                <Ionicons name="arrow-undo-outline" size={14} color="#ffffff" />
                <Text style={s.undoBtnText}>Undo Hole {holeSequence[holeSequence.indexOf(nextHole) - 1]}</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : (() => {
          const holesWithPar = savedScores.map(sv => {
            const ch = courseHoles.find(c => c.hole_number === sv.hole_number);
            return { ...sv, par: ch?.par ?? 0, vsPar: sv.gross - (ch?.par ?? 0) };
          });
          const eagles  = holesWithPar.filter(h => h.vsPar <= -2).length;
          const birdies = holesWithPar.filter(h => h.vsPar === -1).length;
          const pars    = holesWithPar.filter(h => h.vsPar === 0).length;
          const bogeys  = holesWithPar.filter(h => h.vsPar === 1).length;
          const doubles = holesWithPar.filter(h => h.vsPar >= 2).length;
          const bestHole  = holesWithPar.length ? holesWithPar.reduce((b, h) => h.vsPar < b.vsPar ? h : b) : null;
          const worstHole = holesWithPar.length ? holesWithPar.reduce((b, h) => h.vsPar > b.vsPar ? h : b) : null;
          const vsParLabel = (v: number) => v <= -2 ? 'Eagle+' : v === -1 ? 'Birdie' : v === 0 ? 'Par' : v === 1 ? 'Bogey' : v === 2 ? 'Double' : 'Triple+';
          return (
            <View style={s.completeCard}>
              <Ionicons name="trophy" size={48} color={GOLD} />
              <Text style={s.completeTitle}>ROUND COMPLETE</Text>
              <Text style={[s.completeScore, { color: scoreColor }]}>{scoreDisplay}</Text>
              <Text style={s.completeDetail}>
                {isStableford ? `${totalGross} gross · ${totalPts} pts` : `${totalGross} gross`}
              </Text>
              <View style={s.statGrid}>
                {eagles  > 0 && <View style={s.statBox}><Text style={[s.statVal, { color: GOLD }]}>{eagles}</Text><Text style={s.statLbl}>Eagle{eagles !== 1 ? 's' : ''}</Text></View>}
                {birdies > 0 && <View style={s.statBox}><Text style={[s.statVal, { color: RED }]}>{birdies}</Text><Text style={s.statLbl}>Birdie{birdies !== 1 ? 's' : ''}</Text></View>}
                {pars    > 0 && <View style={s.statBox}><Text style={[s.statVal, { color: PLAIN }]}>{pars}</Text><Text style={s.statLbl}>Par{pars !== 1 ? 's' : ''}</Text></View>}
                {bogeys  > 0 && <View style={s.statBox}><Text style={[s.statVal, { color: BLUE }]}>{bogeys}</Text><Text style={s.statLbl}>Bogey{bogeys !== 1 ? 's' : ''}</Text></View>}
                {doubles > 0 && <View style={s.statBox}><Text style={[s.statVal, { color: DARKBLUE }]}>{doubles}</Text><Text style={s.statLbl}>Double{doubles !== 1 ? 's' : ''}+</Text></View>}
              </View>
              {bestHole && worstHole && bestHole.hole_number !== worstHole.hole_number && (
                <View style={s.bestWorstRow}>
                  <View style={s.bestWorstBox}>
                    <Text style={s.bestWorstLbl}>BEST</Text>
                    <Text style={[s.bestWorstVal, { color: GREEN }]}>Hole {bestHole.hole_number}</Text>
                    <Text style={s.bestWorstSub}>{vsParLabel(bestHole.vsPar)}</Text>
                  </View>
                  <View style={s.bestWorstBox}>
                    <Text style={s.bestWorstLbl}>WORST</Text>
                    <Text style={[s.bestWorstVal, { color: RED }]}>Hole {worstHole.hole_number}</Text>
                    <Text style={s.bestWorstSub}>{vsParLabel(worstHole.vsPar)}</Text>
                  </View>
                </View>
              )}
              <TouchableOpacity
                style={[s.ctaBtn, { marginTop: 16, alignSelf: 'stretch' }]}
                onPress={() => {
                  // Fire-and-forget — the outro voice line calls a network
                  // API (tts-caddie) with no timeout of its own; awaiting it
                  // here blocked finishing the round for 45s+ on poor signal.
                  if (playerName && entryVoiceOn) speakOutro(playerName.split(' ')[0], scoreDisplay);
                  router.replace(`/(app)/swindle/${gameId}` as any);
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="trophy-outline" size={20} color="#000000" />
                <Text style={s.ctaBtnText}>View Leaderboard</Text>
              </TouchableOpacity>
              {nextHole > 1 && (
                <TouchableOpacity style={s.undoBtn} onPress={undoHole} disabled={saving}>
                  <Ionicons name="arrow-undo-outline" size={14} color="#ffffff" />
                  <Text style={s.undoBtnText}>Undo Last Hole</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })()}

        {/* Mini scorecard */}
        {savedScores.length > 0 && courseHoles.length > 0 && (
          <View style={s.scorecardCard}>
            <Text style={s.scorecardTitle}>SCORECARD</Text>
            {[
              courseHoles.filter(h => h.hole_number <= 9).sort((a, b) => a.hole_number - b.hole_number),
              courseHoles.filter(h => h.hole_number >= 10).sort((a, b) => a.hole_number - b.hole_number),
            ].map((half, hi) => {
              const halfScores = savedScores.filter(sv => hi === 0 ? sv.hole_number <= 9 : sv.hole_number >= 10);
              if (halfScores.length === 0 && hi === 1) return null;
              return (
                <View key={hi}>
                  <View style={s.scorecardRow}>
                    <Text allowFontScaling={false} style={s.scorecardHoleLabel}>HOLE</Text>
                    {half.map(h => <Text allowFontScaling={false} key={h.hole_number} style={[s.scorecardCell, { color: savedScores.find(sv => sv.hole_number === h.hole_number) ? '#ffffff' : '#2a2a2a' }]}>{h.hole_number}</Text>)}
                    <Text allowFontScaling={false} style={s.scorecardTot}>{hi === 0 ? 'OUT' : 'IN'}</Text>
                  </View>
                  <View style={s.scorecardRow}>
                    <Text allowFontScaling={false} style={s.scorecardHoleLabel}>PAR</Text>
                    {half.map(h => <Text allowFontScaling={false} key={h.hole_number} style={[s.scorecardCell, { color: GOLD }]}>{h.par}</Text>)}
                    <Text allowFontScaling={false} style={[s.scorecardTot, { color: GOLD }]}>{half.reduce((s, h) => s + h.par, 0)}</Text>
                  </View>
                  <View style={s.scorecardRow}>
                    <Text allowFontScaling={false} style={s.scorecardHoleLabel}>GROSS</Text>
                    {half.map(h => {
                      const sv = halfScores.find(sc => sc.hole_number === h.hole_number);
                      const cellColor = sv ? SCORE_COLORS[scoreVsPar(sv.gross, h.par)] : null;
                      return (
                        <View key={h.hole_number} style={[s.scorecardScoreCell, cellColor && cellColor !== PLAIN && { backgroundColor: `${cellColor}25` }]}>
                          <Text allowFontScaling={false} style={[s.scorecardScoreText, cellColor && { color: cellColor }]}>{sv?.gross ?? '·'}</Text>
                        </View>
                      );
                    })}
                    <Text allowFontScaling={false} style={s.scorecardTot}>{halfScores.reduce((s, h) => s + h.gross, 0) || '·'}</Text>
                  </View>
                  {isStableford && (
                    <View style={s.scorecardRow}>
                      <Text allowFontScaling={false} style={s.scorecardHoleLabel}>PTS</Text>
                      {half.map(h => {
                        const sv = halfScores.find(sc => sc.hole_number === h.hole_number);
                        return <Text allowFontScaling={false} key={h.hole_number} style={[s.scorecardCell, { color: sv ? ptsColor(sv.pts) : '#2a2a2a' }]}>{sv?.pts ?? '·'}</Text>;
                      })}
                      <Text allowFontScaling={false} style={[s.scorecardTot, { color: GOLD }]}>{halfScores.reduce((s, h) => s + h.pts, 0) || '·'}</Text>
                    </View>
                  )}
                  {hi === 0 && <View style={{ height: 1, backgroundColor: '#1a1a1a', marginVertical: 4 }} />}
                </View>
              );
            })}
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      {saving && (
        <View style={s.savingOverlay}>
          <ActivityIndicator color={GOLD} size="small" />
        </View>
      )}

      {/* ── Score entry modal ── */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <ScrollView contentContainerStyle={s.sheetScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={s.sheetHandle} />
              <View style={s.sheetPlayerRow}>
                <Avatar playerId={myId ?? undefined} name={playerName} size={38} avatarUrl={avatarUrl} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={s.sheetPlayerName}>{playerName}</Text>
                  {courseHole && <Text style={s.sheetHoleInfo}>{editingHole ? `Edit Hole ${editingHole}` : `Hole ${nextHole}`} · Par {courseHole.par} · SI {courseHole.stroke_index}</Text>}
                </View>
                {selectedScore !== null && courseHole && isStableford && (
                  <Text style={[s.sheetPts, { color: ptsColor(calcStablefordPoints(selectedScore, courseHole.par, shots)) }]}>
                    {calcStablefordPoints(selectedScore, courseHole.par, shots)} pts
                  </Text>
                )}
              </View>
              {shots > 0 && (
                <View style={s.sheetShotBadge}>
                  <Ionicons name="golf-outline" size={12} color={GOLD} />
                  <Text style={s.sheetShotBadgeText}>Gets {shots} shot{shots > 1 ? 's' : ''} on this hole</Text>
                </View>
              )}

              {(() => {
                const par = courseHole?.par ?? 4;
                const result = selectedScore ? scoreVsPar(selectedScore, par) : null;
                const accent = result ? (SCORE_COLORS[result] ?? '#6b7280') : '#1c1c1c';
                const stablePts = selectedScore ? calcStablefordPoints(selectedScore, par, shots) : null;

                return (
                  <>
                    <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 28 }}>
                        <TouchableOpacity
                          onPress={() => setSelectedScore(selectedScore === null ? par : Math.max(1, selectedScore - 1))}
                          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        >
                          <Ionicons name="remove-circle" size={42} color={selectedScore && selectedScore > 1 ? '#ffffff' : '#555'} />
                        </TouchableOpacity>

                        <View style={{
                          width: 100, height: 100, borderRadius: 50,
                          backgroundColor: selectedScore ? accent : '#111',
                          borderWidth: 2, borderColor: selectedScore ? accent : '#2c2c2c',
                          alignItems: 'center', justifyContent: 'center',
                          shadowColor: selectedScore ? accent : 'transparent',
                          shadowOffset: { width: 0, height: 0 }, shadowRadius: 20, shadowOpacity: 0.6,
                          elevation: 10,
                        }}>
                          <Text style={{ fontFamily: FFB, fontSize: 50, color: selectedScore ? (accent === PLAIN ? '#000' : '#fff') : '#2c2c2c', lineHeight: 56 }}>
                            {selectedScore ?? '?'}
                          </Text>
                        </View>

                        <TouchableOpacity
                          onPress={() => setSelectedScore(selectedScore === null ? par : Math.min(12, selectedScore + 1))}
                          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        >
                          <Ionicons name="add-circle" size={42} color="#ffffff" />
                        </TouchableOpacity>
                      </View>

                      <View style={{ alignItems: 'center', marginTop: 10, minHeight: 36 }}>
                        {selectedScore ? (
                          isStableford && stablePts !== null
                            ? <Text style={{ fontFamily: FFB, fontSize: 22, color: '#fff' }}>{stablePts}<Text style={{ fontFamily: FFB, fontSize: 13, color: '#fff' }}> pts</Text></Text>
                            : null
                        ) : (
                          <Text style={{ fontFamily: FF, fontSize: 13, color: '#ffffff' }}>tap a number or use arrows</Text>
                        )}
                      </View>
                    </View>

                    {[[1,2,3,4,5],[6,7,8,9,10]].map((row, ri) => (
                      <View key={ri} style={{ flexDirection: 'row', gap: 7, marginTop: ri === 0 ? 0 : 7 }}>
                        {row.map(n => {
                          const r = courseHole ? scoreVsPar(n, par) : 'par';
                          const a = SCORE_COLORS[r] ?? '#6b7280';
                          const on = selectedScore === n;
                          return (
                            <TouchableOpacity
                              key={n}
                              style={{
                                flex: 1, height: 44, borderRadius: 10,
                                backgroundColor: on ? a : '#111',
                                borderWidth: 1.5, borderColor: on ? a : '#222',
                                alignItems: 'center', justifyContent: 'center',
                              }}
                              onPress={() => setSelectedScore(n)}
                              activeOpacity={0.7}
                            >
                              <Text style={{ fontFamily: FFB, fontSize: 16, color: on ? (a === PLAIN ? '#000' : '#fff') : '#fff' }}>{n}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ))}

                    <TouchableOpacity
                      style={[s.submitBtn, !selectedScore && { opacity: 0.35 }, { marginTop: 20 }]}
                      onPress={saveScore}
                      disabled={!selectedScore}
                      activeOpacity={0.85}
                    >
                      <Text style={s.submitBtnText}>{editingHole ? `Save Hole ${editingHole}` : `Save Hole ${nextHole}`}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setModalVisible(false)} style={{ paddingVertical: 14, alignItems: 'center' }}>
                      <Text style={{ fontFamily: FFB, color: '#ffffff', fontSize: 14 }}>Cancel</Text>
                    </TouchableOpacity>
                  </>
                );
              })()}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Range finder ── */}
      <Modal visible={showRangeMap} transparent animationType="slide" onRequestClose={() => setShowRangeMap(false)}>
        <View style={s.popupOverlay}>
          <View style={s.popupSheet}>
            <View style={s.sheetHandle} />
            <View style={s.popupTitleRow}>
              <Ionicons name="scan-outline" size={16} color={GOLD} />
              <Text style={s.popupTitleText}>RANGE FINDER</Text>
              <TouchableOpacity onPress={() => setShowRangeMap(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-outline" size={22} color="#ffffff" />
              </TouchableOpacity>
            </View>
            <View style={{ padding: 16 }}>
              <RangeMap courseName={game?.course_name ?? undefined} holeNumber={nextHole} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#000000' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' },

  startHoleRow:         { paddingHorizontal: 16, marginTop: 14 },
  startHoleLabel:       { fontFamily: FFB, fontSize: 10, color: '#888', letterSpacing: 1, marginBottom: 6 },
  startHoleToggle:      { flexDirection: 'row', gap: 8 },
  startHoleBtn:         { flex: 1, backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  startHoleBtnActive:   { borderColor: GOLD, backgroundColor: 'rgba(212,175,55,0.12)' },
  startHoleBtnText:     { fontFamily: FFB, fontSize: 13, color: '#fff' },
  startHoleBtnTextActive: { color: GOLD },

  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 56, paddingHorizontal: 16, paddingBottom: 8 },
  headerSide:   { width: 40 },
  headerCenter: { flex: 1, alignItems: 'center', gap: 2 },
  headerLogo:   { width: 28, height: 28 },
  headerSub:    { fontFamily: FFB, fontSize: 11, color: '#fff', letterSpacing: 0.5 },

  playerBlock: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#0a0a0a', borderBottomWidth: 1, borderBottomColor: '#111111' },
  playerNameText: { fontFamily: FFB, fontSize: 16, color: '#ffffff' },
  playerHcpText:  { fontFamily: FFB, fontSize: 11, color: '#fff', marginTop: 2 },
  scoreDisplay:   { alignItems: 'center' },
  scoreDisplayVal:   { fontFamily: FFB, fontSize: 26, letterSpacing: -0.5 },
  scoreDisplayLabel: { fontFamily: FFB, fontSize: 8, color: '#fff', letterSpacing: 1.5, marginTop: 1 },

  progressRow: { flexDirection: 'row', justifyContent: 'center', gap: 18, paddingVertical: 10, backgroundColor: '#0a0a0a', borderBottomWidth: 1, borderBottomColor: '#111111' },
  progressDotWrap: { alignItems: 'center', gap: 6, opacity: 0.5 },
  progressDotWrapActive: { opacity: 1 },
  progressDot: { width: 8, height: 8, borderRadius: 4 },

  holeStripWrap: { maxHeight: 72 },
  holeStrip:     { paddingHorizontal: 12, paddingVertical: 6, gap: 6, alignItems: 'center' },
  holeTile: { width: 42, height: 58, borderRadius: 10, backgroundColor: '#111111', borderWidth: 1, borderColor: '#1c1c1c', alignItems: 'center', justifyContent: 'center', gap: 2 },
  holeTileNum:   { fontFamily: FFB, fontSize: 14, color: '#ffffff' },
  holeTilePar:   { fontFamily: FFB, fontSize: 9, color: '#ffffff' },
  holeTilePts:   { fontFamily: FFB, fontSize: 11, marginTop: 1 },
  halfLabels:    { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 12, paddingBottom: 4 },
  halfLabel:     { fontFamily: FFB, fontSize: 8, color: '#ffffff', letterSpacing: 1.5 },

  scroll: { padding: 16, paddingBottom: 40 },

  guestNote: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#111111', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 10 },
  guestNoteText: { flex: 1, fontFamily: FF, fontSize: 11, color: '#9ca3af' },
  offlineBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1c1c1c', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8 },
  offlineBannerText: { flex: 1, fontFamily: 'JUSTSans-ExBold', fontSize: 11, color: '#fff' },

  holeCard: { alignItems: 'center', marginBottom: 12, paddingVertical: 20, backgroundColor: '#111111', borderRadius: 16, borderWidth: 1, borderColor: '#1c1c1c' },
  // Group mode's card is the two-column (hole info | leaderboard) layout
  // from score/enter — needs its own wrapper since solo's centered/padded
  // s.holeCard would otherwise squash holeCardTop's row to content-width.
  groupHoleCard:   { backgroundColor: '#111111', borderRadius: 16, borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden', marginBottom: 12 },
  holeCardTop:     { flexDirection: 'row', padding: 16, gap: 12 },
  holeCardDivider: { width: 1, backgroundColor: '#1c1c1c' },
  holeNumberBlock: { width: 80, alignItems: 'flex-start', justifyContent: 'center', gap: 6 },
  holeLabelSmall: { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 2 },
  holeBig:        { fontFamily: FFB, fontSize: 64, color: '#ffffff', lineHeight: 72 },
  holeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4, justifyContent: 'center', paddingHorizontal: 12 },
  groupHoleChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  holeChip:     { flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#222' },
  holeChipGold: { backgroundColor: `${GOLD}0d`, borderColor: `${GOLD}30` },
  holeChipText: { fontFamily: FFB, fontSize: 10, color: '#fff' },

  leaderboard:  { flex: 1, justifyContent: 'center', gap: 10 },
  lbRow:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lbName:       { flex: 1, fontFamily: FFB, fontSize: 13, color: '#ffffff' },
  lbStrokes:    { flex: 1, fontFamily: FFB, fontSize: 10, color: '#9ca3af', textAlign: 'right', lineHeight: 13 },
  shotPill:     { backgroundColor: GOLD, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  shotPillText: { fontFamily: FFB, fontSize: 9, color: '#000', letterSpacing: 0.5 },

  quickActions:   { flexDirection: 'row', alignItems: 'center', marginTop: 14, borderTopWidth: 1, borderTopColor: '#1a1a1a', width: '100%' },
  quickActionBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, gap: 3 },
  quickActionLbl: { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 1 },
  quickActionSep: { width: 1, height: 28, backgroundColor: '#1a1a1a' },

  ctaBtn:     { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 },
  ctaBtnText: { fontFamily: FFB, fontSize: 17, color: '#000000' },

  undoBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  undoBtnText: { fontFamily: FFB, fontSize: 13, color: '#ffffff' },

  completeCard:   { alignItems: 'center', paddingVertical: 32, gap: 8 },
  completeTitle:  { fontFamily: FFB, fontSize: 10, color: '#fff', letterSpacing: 3, marginTop: 8 },
  completeScore:  { fontFamily: FFB, fontSize: 60, letterSpacing: -1 },
  completeDetail: { fontFamily: FFB, fontSize: 13, color: '#fff' },
  statGrid:     { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 20, marginBottom: 8 },
  statBox:      { alignItems: 'center', minWidth: 68, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 },
  statVal:      { fontFamily: FFB, fontSize: 24 },
  statLbl:      { fontFamily: FFB, fontSize: 9, letterSpacing: 0.5, marginTop: 2 },
  bestWorstRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  bestWorstBox: { alignItems: 'center', flex: 1, backgroundColor: '#111111', borderRadius: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#1c1c1c' },
  bestWorstLbl: { fontFamily: FFB, fontSize: 8, color: '#fff', letterSpacing: 1 },
  bestWorstVal: { fontFamily: FFB, fontSize: 14, marginTop: 2 },
  bestWorstSub: { fontFamily: FFB, fontSize: 10, color: '#fff', marginTop: 1 },

  scorecardCard:    { backgroundColor: '#111111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden', marginTop: 8, marginBottom: 8, padding: 10 },
  scorecardTitle:   { fontFamily: FFB, fontSize: 9, color: '#fff', letterSpacing: 2, marginBottom: 8 },
  scorecardRow:     { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  scorecardHoleLabel: { width: 36, fontFamily: FFB, fontSize: 8, color: '#ffffff' },
  scorecardCell:    { flex: 1, fontFamily: FFB, fontSize: 10, textAlign: 'center' },
  scorecardTot:     { width: 30, fontFamily: FFB, fontSize: 10, color: '#ffffff', textAlign: 'center' },
  scorecardScoreCell:  { flex: 1, height: 20, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  scorecardScoreText:  { fontFamily: FFB, fontSize: 10, color: '#fff' },

  standRowCompact:   { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  standNameCompact:  { flex: 1, fontFamily: FFB, fontSize: 13, color: '#fff' },
  standHoles:        { fontFamily: FFB, fontSize: 10, color: '#888', marginRight: 8 },
  standPtsCompact:   { fontFamily: FFB, fontSize: 14, color: '#fff' },

  savingOverlay: { position: 'absolute', bottom: 40, alignSelf: 'center', backgroundColor: '#111111', borderRadius: 20, padding: 10, borderWidth: 1, borderColor: '#1c1c1c' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#111111', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 48, borderTopWidth: 1, borderTopColor: '#1c1c1c' },
  sheetScroll: { alignItems: 'stretch', paddingBottom: 16 },
  sheetHandle:     { width: 40, height: 4, borderRadius: 2, backgroundColor: '#333', alignSelf: 'center', marginTop: 12, marginBottom: 16 },
  sheetPlayerRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  sheetPlayerName: { fontFamily: FFB, fontSize: 16, color: '#ffffff' },
  sheetHoleInfo:   { fontFamily: FFB, fontSize: 11, color: '#fff', marginTop: 2 },
  sheetPts:        { fontFamily: FFB, fontSize: 22 },
  sheetShotBadge:  { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: `${GOLD}0d`, borderWidth: 1, borderColor: `${GOLD}30`, marginBottom: 12 },
  sheetShotBadgeText: { fontFamily: FFB, fontSize: 12, color: GOLD },

  submitBtn:    { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  submitBtnText:{ fontFamily: FFB, fontSize: 16, color: '#000000' },

  popupOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  popupSheet:   { backgroundColor: '#111111', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderTopColor: '#1c1c1c', overflow: 'hidden', paddingBottom: 32 },
  popupTitleRow:{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  popupTitleText: { flex: 1, fontFamily: FFB, fontSize: 11, color: '#ffffff', letterSpacing: 2 },

  doneTitle: { fontFamily: FFB, fontSize: 10, color: '#fff', letterSpacing: 3, textAlign: 'center', marginTop: 8 },
  doneSub:   { fontFamily: FFB, fontSize: 13, color: '#888', textAlign: 'center', marginTop: 4, marginBottom: 24 },
  standRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#1c1c1c', padding: 12, marginBottom: 8 },
  standRank: { fontFamily: FFB, fontSize: 16, color: '#fff', width: 20 },
  standName: { flex: 1, fontFamily: FFB, fontSize: 14, color: '#fff' },
  standPts:  { fontFamily: FFB, fontSize: 16, color: '#fff' },

  playerResultCard:   { backgroundColor: '#0a0a0a', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', padding: 12, marginBottom: 12 },
  playerResultDetail: { fontFamily: FFB, fontSize: 12, color: '#9ca3af', marginTop: 8, marginLeft: 2 },
});
