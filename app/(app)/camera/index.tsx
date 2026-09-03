import { useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  useWindowDimensions, Image, Platform, Animated, Pressable,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as ScreenOrientation from 'expo-screen-orientation';
import { captureRef } from 'react-native-view-shot';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { resolveAvatar } from '../../../src/lib/assets';
import { goBack } from '../../../src/lib/navigation';

const COMPOSE_WIDTH = 1080; // offscreen render width for the branded photo — good enough for social sharing without being wasteful

// A round left mid-play and never explicitly finished stays status='in_progress'
// forever (no expiry/cleanup exists) — without this cutoff a player with more
// than one such stale round makes the live-match lookup below ambiguous and it
// silently comes back empty (Dave, 2026-08-21 era — "apparently we were on
// hole 15" days later; regressed once already in commit b53eb72).
const LIVE_MATCH_LOOKBACK_HOURS = 12;

// Local (not UTC) YYYY-MM-DD — competition_days.play_date/day_date are DATE
// columns holding the local calendar day the round is played on, so comparing
// them against a UTC ISO date would roll over an hour early for UK evening
// rounds in BST.
function localDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The day a round is actually played on. Tournaments carry play_date (set in
// the builder's Round Setup); casual rounds only ever have day_date, which
// create_game_day_with_code stamps with current_date at creation. play_date
// wins where both exist — a tournament day is created weeks before it's
// played, so its day_date is the day the organiser built the draw.
function roundPlayDate(m: any): string | null {
  const d = m?.day?.play_date ?? m?.day?.day_date ?? null;
  return d ? String(d).slice(0, 10) : null;
}

// Which of this player's open matches is the round they're standing on a tee
// in right now.
//
// The old lookup was `status = 'in_progress' AND created_at >= now() - 12h`,
// which silently excluded every tournament round (Dave, 2026-09-03 — "the
// names or courses dont come up when your in a round"):
//   • tournament matches are inserted by the admin's draw days or weeks
//     ahead, so created_at is nowhere near the 12-hour window; and
//   • they sit at status 'upcoming' until the first score is saved, i.e. for
//     exactly the walk down the 1st where the photo gets taken.
// Casual matches are inserted 'in_progress' with a same-day day_date, so they
// were the only kind that ever worked.
//
// A round played today is the strongest signal and covers both; the old
// recency rule is kept as the fallback for a live round whose day carries no
// usable date, and still keeps a stale never-finished round from being
// mistaken for the current one.
function pickLiveMatch(rows: any[], todayStr: string, liveCutoffMs: number): any | null {
  const ranked = rows
    .map(m => ({
      match: m,
      isToday: roundPlayDate(m) === todayStr,
      isLive:  m.status === 'in_progress',
      startedMs: new Date(m.started_at ?? m.created_at ?? 0).getTime(),
    }))
    .filter(r => r.isToday || (r.isLive && r.startedMs >= liveCutoffMs));
  if (ranked.length === 0) return null;
  ranked.sort((a, b) =>
    Number(b.isToday) - Number(a.isToday) ||
    Number(b.isLive)  - Number(a.isLive)  ||
    b.startedMs - a.startedMs
  );
  return ranked[0].match;
}

// Play order for a round that may start on a hole other than 1 (shotgun /
// two-tee start) — identical shape to score/enter's fullHoleSequence, sliced
// to holes_to_play for a 9-hole round.
function buildHoleSequence(startHole: number, holesToPlay: number): number[] {
  const full = startHole > 1
    ? [...Array.from({ length: 19 - startHole }, (_, i) => startHole + i), ...Array.from({ length: startHole - 1 }, (_, i) => i + 1)]
    : Array.from({ length: 18 }, (_, i) => i + 1);
  return full.slice(0, holesToPlay);
}

// Swindle's own "which round am I in, and what hole am I on" lookup. Swindle
// never writes a `matches` row (its own swindle_games/entries/scores tables
// predate the shared match model), so the match lookup above can never see
// one — this is the same three facts read from the swindle equivalents that
// swindle/score/[gameId].tsx reads them from, so the overlay says exactly
// what the swindle scorecard says.
async function loadSwindleRoundContext(
  playerId: string,
  todayStr: string,
): Promise<{ courseName: string | null; hole: number | null } | null> {
  const { data: entries, error } = await supabase
    .from('swindle_entries')
    .select('game_id, start_hole, game:game_id!inner(course_name, game_date, status)')
    .eq('player_id', playerId)
    .eq('game.game_date', todayStr)
    .in('game.status', ['open', 'in_progress'])
    .limit(1);
  if (error) { console.error('[camera] live swindle lookup failed', error); return null; }
  const entry = (entries ?? [])[0] as any;
  if (!entry) return null;

  // A player in a tee-time group starts on that group's hole, not their own
  // entry's — same precedence swindle/score/[gameId].tsx applies.
  const [{ data: membership }, { data: scores }] = await Promise.all([
    supabase
      .from('swindle_group_players')
      .select('swindle_groups!inner(game_id, start_hole)')
      .eq('player_id', playerId)
      .eq('is_guest', false)
      .eq('swindle_groups.game_id', entry.game_id)
      .maybeSingle(),
    supabase
      .from('swindle_scores')
      .select('hole_number')
      .eq('game_id', entry.game_id)
      .eq('player_id', playerId),
  ]);

  const startHole = Math.max(1, (membership as any)?.swindle_groups?.start_hole ?? entry.start_hole ?? 1);
  const holeSequence = buildHoleSequence(startHole, 18);
  const scored = new Set(((scores ?? []) as any[]).map(r => r.hole_number));
  return {
    courseName: entry.game?.course_name ?? null,
    hole: holeSequence.find(h => !scored.has(h)) ?? holeSequence[holeSequence.length - 1] ?? 18,
  };
}

// ── TITAN design tokens ───────────────────────────────────────
const GOLD  = '#D4AF37';
const GREEN = '#4ade80';
const RED   = '#f87171';
const FF    = 'JUSTSans';
const FFB   = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

type Mode = 'picture' | 'video';
type Flash = 'off' | 'on' | 'auto';

interface Preview {
  uri: string;
  type: 'photo' | 'video';
}

interface PlayerInfo {
  name: string;
  avatarUrl: string | null;
  playerId: string | null;
  courseName: string | null;
  hole: number | null;
  competitionId: string | null;
  dayId: string | null;
  matchId: string | null;
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function CameraScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const cameraRef = useRef<CameraView>(null);
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const [camPermission,  requestCamPerm]  = useCameraPermissions();
  const [micPermission,  requestMicPerm]  = useMicrophonePermissions();
  const [mediaPermission, requestMediaPerm] = MediaLibrary.usePermissions();

  const [facing,    setFacing]    = useState<'front' | 'back'>('back');
  const [flash,     setFlash]     = useState<Flash>('off');
  const [mode,      setMode]      = useState<Mode>('picture');
  const [recording, setRecording] = useState(false);
  const [recTime,   setRecTime]   = useState(0);
  const [preview,   setPreview]   = useState<Preview | null>(null);
  const [saving,    setSaving]    = useState(false);
  const [menuOpen,  setMenuOpen]  = useState(false);
  const menuAnim = useRef(new Animated.Value(0)).current;

  const [info, setInfo] = useState<PlayerInfo>({
    name: '', avatarUrl: null, playerId: null, courseName: null, hole: null,
    competitionId: null, dayId: null, matchId: null,
  });
  const [composing, setComposing] = useState<{ uri: string; width: number; height: number } | null>(null);
  const composeRef = useRef<View>(null);

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  // Unlock screen rotation on this screen only
  useFocusEffect(useCallback(() => {
    ScreenOrientation.unlockAsync();
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, []));

  // Load player + competition info. Re-run on every focus, not just mount —
  // this is a persistent tab, so a mount-only load left course/hole/match
  // stuck at whatever they were when the tab was first opened (null if
  // opened before a round started; stale hole/course if opened mid-round and
  // returned to later), and that stale data was what got burned permanently
  // into the photos table (Rick's brief, section 6).
  const loadRoundContext = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: player } = await supabase
      .from('players')
      .select('id, display_name, avatar_url')
      .eq('auth_uid', user.id)
      .maybeSingle();
    if (!player) return;

    // Course + current hole come from whatever live round the player is
    // actually in right now — casual or tournament both carry a day_id
    // with the real course, unlike the old "active competition" lookup
    // which only ever matched tournament play and pulled the wrong name.
    // The candidate list is deliberately narrowed in JS (pickLiveMatch)
    // rather than by more SQL filters: "today's round" spans two different
    // date columns and two different statuses, and the previous single
    // status+created_at filter pair is exactly what silently excluded every
    // tournament round. Ordering + a small limit still keeps a stale
    // never-finished round from being mistaken for the live one.
    let courseName: string | null = null;
    let hole: number | null = null;
    let matchId: string | null = null;
    let dayId: string | null = null;
    let competitionId: string | null = null;
    const todayStr = localDateString(new Date());
    const liveCutoffMs = Date.now() - LIVE_MATCH_LOOKBACK_HOURS * 60 * 60 * 1000;
    const { data: candidates, error: matchErr } = await supabase
      .from('matches')
      .select('id, competition_id, day_id, status, started_at, created_at, holes_string, holes_to_play, start_hole, day:day_id(course_name, day_date, play_date)')
      .in('status', ['in_progress', 'upcoming'])
      .or(`home_player_ids.cs.{${player.id}},away_player_ids.cs.{${player.id}}`)
      .order('created_at', { ascending: false })
      .limit(20);
    if (matchErr) console.error('[camera] live match lookup failed', matchErr);
    const match = pickLiveMatch((candidates ?? []) as any[], todayStr, liveCutoffMs);
    if (match) {
      courseName = match.day?.course_name ?? null;
      const holesToPlay = match.holes_to_play ?? 18;
      const holeChars = ((match.holes_string as string) ?? '..................').padEnd(18, '.').slice(0, 18).split('');
      // Same start_hole + wrapping-sequence derivation used by score/enter
      // and score/results — a shifted (shotgun) start plays holes out of
      // absolute order, so counting played holes from position 0 gives the
      // wrong hole number on any round that didn't start on hole 1.
      const holeSequence = buildHoleSequence(Math.max(1, match.start_hole ?? 1), holesToPlay);
      // First unplayed hole in PLAY order, falling back to the last hole of
      // the sequence once they're all in. There is deliberately no clamp
      // against the last hole's *number* here — on a wrapped sequence (a
      // hole-5 start plays 5…18,1,2,3,4) that number is 4, so clamping made
      // the overlay read "HOLE 4" for the entire front half of every
      // shotgun round. Same trap score/enter documents at its allHolesFilled.
      hole = holeSequence.find(h => holeChars[h - 1] === '.') ?? holeSequence[holeSequence.length - 1] ?? 18;
      matchId = match.id;
      dayId = match.day_id ?? null;
      competitionId = match.competition_id ?? null;
    }

    // Swindle rounds live in their own tables and never create a `matches`
    // row at all, so the lookup above can't see them — the overlay came up
    // blank for the whole of every swindle (Dave, 2026-09-03). Same
    // course/current-hole facts, read from the swindle equivalents that
    // swindle/score/[gameId].tsx itself uses: swindle_games.course_name,
    // swindle_groups.start_hole (tee-time group) or swindle_entries.start_hole
    // (solo), and swindle_scores for what's already been played.
    if (!courseName && !hole) {
      const swindle = await loadSwindleRoundContext(player.id, todayStr);
      if (swindle) {
        courseName = swindle.courseName;
        hole = swindle.hole;
      }
    }

    setInfo({
      name:       player.display_name ?? '',
      avatarUrl:  player.avatar_url ?? null,
      playerId:   player.id,
      courseName,
      hole,
      matchId,
      dayId,
      competitionId,
    });
  }, []);

  useFocusEffect(useCallback(() => { loadRoundContext(); }, [loadRoundContext]));

  async function ensurePermissions(): Promise<boolean> {
    if (!camPermission?.granted) {
      const r = await requestCamPerm();
      if (!r.granted) {
        Alert.alert('Camera access needed', 'Allow camera access in Settings to use this feature.');
        return false;
      }
    }
    if (mode === 'video' && !micPermission?.granted) {
      const r = await requestMicPerm();
      if (!r.granted) {
        Alert.alert('Microphone access needed', 'Allow microphone access in Settings to record video.');
        return false;
      }
    }
    if (!mediaPermission?.granted) {
      const r = await requestMediaPerm();
      if (!r.granted) {
        Alert.alert('Photo library access needed', 'Allow photo library access in Settings to save your shots.');
        return false;
      }
    }
    return true;
  }

  async function takePicture() {
    if (!cameraRef.current || !(await ensurePermissions())) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (!photo?.uri) return;
      // Hand off to the offscreen compositor below rather than showing the
      // raw photo directly — it burns the Titan branding footer into the
      // image once the compose view has actually painted (see onComposeReady).
      setComposing({ uri: photo.uri, width: photo.width, height: photo.height });
    } catch (e: any) {
      Alert.alert('Capture failed', e.message);
    }
  }

  // Fires once the offscreen photo+branding view has finished rendering the
  // captured photo (Image.onLoad, not just mount — the pixels must actually
  // be painted or the snapshot below would capture a blank frame).
  async function onComposeReady() {
    if (!composeRef.current) return;
    try {
      await new Promise(r => requestAnimationFrame(r));
      const uri = await captureRef(composeRef, { format: 'jpg', quality: 0.92 });
      setPreview({ uri, type: 'photo' });
    } catch (e) {
      // Compositing failed — still give them the shot rather than losing it.
      if (composing) setPreview({ uri: composing.uri, type: 'photo' });
    } finally {
      setComposing(null);
    }
  }

  async function startRecording() {
    if (!cameraRef.current || !(await ensurePermissions())) return;
    setRecording(true);
    setRecTime(0);
    timerRef.current = setInterval(() => setRecTime(t => t + 1), 1000);
    try {
      const result = await cameraRef.current.recordAsync({});
      if (result?.uri) setPreview({ uri: result.uri, type: 'video' });
    } catch {
      // recording stopped
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      setRecording(false);
      setRecTime(0);
    }
  }

  function stopRecording() {
    cameraRef.current?.stopRecording();
  }

  function handleCapture() {
    if (mode === 'picture') {
      takePicture();
    } else if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  // Permanent record — a photos-bucket upload + a photos row tagging the
  // exact game context Titan already knew at capture time (Rick's brief,
  // 2026-08-22, Section 6: "must remain associated with the photo
  // permanently, including after the round/tournament is completed").
  // Best-effort: a failed upload shouldn't block or alarm a player who just
  // saved their shot to the camera roll, same "side-effect can fail, the
  // player's own action still succeeds" pattern as casual match report
  // generation in titanNews.ts.
  async function persistPhotoRecord(uri: string) {
    if (!info.playerId) return;
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const path = `${info.playerId}/${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('photos')
        .upload(path, bytes, { contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;
      const { error: dbError } = await supabase.from('photos').insert({
        player_id:      info.playerId,
        competition_id: info.competitionId,
        day_id:         info.dayId,
        match_id:       info.matchId,
        player_name:    info.name || null,
        course_name:    info.courseName,
        hole_number:    info.hole,
        storage_path:   path,
        taken_at:       new Date().toISOString(),
      });
      if (dbError) throw dbError;
    } catch (e) {
      console.error('[camera] permanent photo record failed', e);
    }
  }

  async function saveToLibrary() {
    if (!preview) return;
    setSaving(true);
    try {
      await MediaLibrary.saveToLibraryAsync(preview.uri);
      if (preview.type === 'photo') persistPhotoRecord(preview.uri);
      Alert.alert('Saved', 'Saved to your camera roll.');
      setPreview(null);
    } catch (e: any) {
      Alert.alert('Save failed', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function shareMedia() {
    if (!preview) return;
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      Alert.alert('Sharing not available on this device.');
      return;
    }
    await Sharing.shareAsync(preview.uri, {
      mimeType: preview.type === 'video' ? 'video/mp4' : 'image/jpeg',
      dialogTitle: 'Share your shot',
    });
  }

  function toggleMenu() {
    if (!menuOpen) {
      setMenuOpen(true);
      menuAnim.setValue(0);
      Animated.spring(menuAnim, { toValue: 1, useNativeDriver: true, tension: 60, friction: 9 }).start();
    } else {
      Animated.spring(menuAnim, { toValue: 0, useNativeDriver: true, tension: 60, friction: 9 })
        .start(() => setMenuOpen(false));
    }
  }

  const flashCycles: Flash[] = ['off', 'auto', 'on'];
  const flashLabel = { off: 'OFF', auto: 'AUTO', on: 'ON' };
  const flashGlyph = { off: '○', auto: 'A', on: '⚡' };

  // ── Permission gate ───────────────────────────────────────────
  if (!camPermission) {
    return <View style={s.container} />;
  }
  if (!camPermission.granted) {
    return (
      <View style={[s.container, s.centered]}>
        <StatusBar style="light" />
        <Text style={s.permTitle}>Camera Access</Text>
        <Text style={s.permSub}>Allow camera access to film your shots.</Text>
        <TouchableOpacity style={s.permBtn} onPress={requestCamPerm}>
          <Text style={s.permBtnText}>Allow Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/')} style={{ marginTop: 16 }}>
          <Text style={s.closeText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Preview screen ────────────────────────────────────────────
  if (preview) {
    return (
      <View style={s.container}>
        <StatusBar style="light" hidden />
        <Image source={{ uri: preview.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        <View style={s.previewOverlay}>
          <TouchableOpacity style={s.previewClose} onPress={() => setPreview(null)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={s.previewCloseText}>✕ Retake</Text>
          </TouchableOpacity>
          <View style={s.previewActions}>
            <TouchableOpacity
              style={[s.previewBtn, saving && { opacity: 0.5 }]}
              onPress={saveToLibrary}
              disabled={saving}
            >
              <Text style={s.previewBtnIcon}>📥</Text>
              <Text style={s.previewBtnLabel}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.previewBtnPrimary} onPress={shareMedia}>
              <Text style={s.previewBtnIcon}>⬆</Text>
              <Text style={[s.previewBtnLabel, { color: '#000' }]}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // ── Camera layout (portrait / landscape) ─────────────────────
  const avatar = info.playerId ? resolveAvatar(info.playerId, info.avatarUrl) : null;

  // Single source of truth for the branded frame — shown live while framing
  // AND burned into the captured photo via the same JSX (see composeRef
  // below). Previously these were two separate elements (a live-only banner
  // with name/avatar, and a composited-only footer with just the logo +
  // course/hole) which is exactly how player name silently stopped
  // appearing in saved photos — whatever's true here is now true in both
  // places by construction. Works with no active round too — just the
  // player + logo, never fabricated course/hole. Positioning differs by
  // context (live overlay sits above the controls; the offscreen composite
  // needs to sit flush with the photo's own bottom edge), so this is just
  // the visual bar — callers wrap it to position it.
  const BrandFrame = (
    <View style={s.brandFooter}>
      <View style={s.brandLeft}>
        {avatar
          ? <Image source={avatar} style={s.brandAvatar} />
          : <View style={[s.brandAvatar, s.brandAvatarFallback]}>
                <Text style={s.brandInitial}>{info.name?.[0] ?? '?'}</Text>
              </View>
        }
        <View style={s.brandTextWrap}>
          <Text style={s.brandName} numberOfLines={1}>{(info.name || 'Player').toUpperCase()}</Text>
          {(info.hole || info.courseName) && (
            <Text style={s.brandSub} numberOfLines={1}>
              {info.hole ? `HOLE ${info.hole}` : ''}{info.hole && info.courseName ? '   ·   ' : ''}{info.courseName ?? ''}
            </Text>
          )}
        </View>
      </View>
      <Image source={titanLogo} style={s.brandLogo} resizeMode="contain" />
    </View>
  );

  const Controls = (
    <>
      {/* Slide-up menu panel — only in tree when open */}
      {menuOpen && (
        <>
          <Pressable style={s.menuBackdrop} onPress={toggleMenu} />
          <Animated.View style={[s.menuPanel, {
            transform: [{ translateY: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [160, 0] }) }],
            opacity: menuAnim,
          }]}>
            <Text style={s.menuTitle}>MODE</Text>
            <View style={s.modeToggle}>
              <TouchableOpacity
                style={[s.modeBtn, mode === 'picture' && s.modeBtnOn]}
                onPress={() => { if (!recording) { setMode('picture'); toggleMenu(); } }}
              >
                <Text style={[s.modeBtnText, mode === 'picture' && s.modeBtnTextOn]}>📷  Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modeBtn, mode === 'video' && s.modeBtnOn]}
                onPress={() => { if (!recording) { setMode('video'); toggleMenu(); } }}
              >
                <Text style={[s.modeBtnText, mode === 'video' && s.modeBtnTextOn]}>🎥  Video</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </>
      )}

      {/* Main control bar — 4 buttons */}
      <View style={[s.controls, isLandscape && s.controlsLandscape]}>
        {mode === 'video' && recording && (
          <Text style={s.recTimer}>⏺ {formatTime(recTime)}</Text>
        )}
        <View style={[s.captureRow, isLandscape && s.captureRowLandscape]}>
          {/* Burger */}
          <TouchableOpacity style={s.sideBtn} onPress={toggleMenu} disabled={recording}>
            <View style={[s.burgerIcon, menuOpen && s.burgerIconOpen]}>
              <View style={s.burgerLine} />
              <View style={s.burgerLine} />
              <View style={s.burgerLine} />
            </View>
            <Text style={s.sideBtnLabel}>{mode === 'picture' ? 'PHOTO' : 'VIDEO'}</Text>
          </TouchableOpacity>

          {/* Flash */}
          <TouchableOpacity
            style={s.sideBtn}
            onPress={() => setFlash(f => flashCycles[(flashCycles.indexOf(f) + 1) % 3])}
          >
            <Text style={s.sideBtnIcon}>{flashGlyph[flash]}</Text>
            <Text style={s.sideBtnLabel}>{flashLabel[flash]}</Text>
          </TouchableOpacity>

          {/* Capture */}
          <TouchableOpacity style={s.captureBtn} onPress={handleCapture} activeOpacity={0.8}>
            {mode === 'video' && recording
              ? <View style={s.captureBtnStop} />
              : <View style={[s.captureBtnInner, mode === 'video' && s.captureBtnVideo]} />
            }
            {mode === 'video' && recording && <View style={s.recordingRing} />}
          </TouchableOpacity>

          {/* Flip */}
          <TouchableOpacity
            style={s.sideBtn}
            onPress={() => { if (!recording) setFacing(f => f === 'back' ? 'front' : 'back'); }}
          >
            <Text style={s.sideBtnIcon}>🔄</Text>
            <Text style={s.sideBtnLabel}>FLIP</Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  );

  if (!fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000' }}><StatusBar style="light" /></View>
  );

  return (
    <View style={s.container}>
      <StatusBar style="light" hidden />

      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        flash={flash}
        mode={mode}
      />

      {/* Close button */}
      <TouchableOpacity
        style={s.closeBtn}
        onPress={() => goBack(router, '/(app)/')}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={s.closeBtnText}>✕</Text>
      </TouchableOpacity>

      {/* Branded frame — player, hole, course, logo. Same content burned
          into the saved photo, shown live so the shot can be framed with it
          in mind. */}
      <View style={[s.brandFrameLiveWrap, isLandscape && s.brandFrameLiveWrapLandscape]} pointerEvents="none">{BrandFrame}</View>

      {/* Camera controls */}
      {Controls}

      {/* Offscreen photo + branding compositor — rendered far off-screen
          (not hidden, since RN won't paint a hidden view for view-shot to
          capture), torn down again once the composite has been captured. */}
      {composing && (
        <View
          ref={composeRef}
          collapsable={false}
          style={{ position: 'absolute', top: -100000, left: 0, width: COMPOSE_WIDTH, height: COMPOSE_WIDTH * (composing.height / composing.width) }}
        >
          <Image
            source={{ uri: composing.uri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onLoad={onComposeReady}
          />
          <View style={s.brandFrameComposeWrap}>{BrandFrame}</View>
        </View>
      )}
    </View>
  );
}

const CONTROLS_HEIGHT = 140;

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  centered:  { alignItems: 'center', justifyContent: 'center', padding: 24 },

  // ── Permission gate
  permTitle:   { fontSize: 22, fontFamily: FFB, color: '#fff', marginBottom: 8, textAlign: 'center' },
  permSub:     { fontSize: 14, fontFamily: FFB, color: '#444', textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  permBtn:     { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24 },
  permBtnText: { fontSize: 15, fontFamily: FFB, color: '#000' },
  closeText:   { fontSize: 14, fontFamily: FFB, color: '#444', textDecorationLine: 'underline' },

  // ── Close button overlay
  closeBtn:     {
    position: 'absolute', top: 56, left: 16, zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 20,
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { fontSize: 16, fontFamily: FFB, color: '#fff' },

  // ── Branded frame — player, hole, course, logo. One bar, shown live and
  // burned into the saved photo via the same JSX (see BrandFrame above).
  brandFrameLiveWrap: {
    position: 'absolute',
    bottom: CONTROLS_HEIGHT,
    left: 0, right: 0,
  },
  brandFrameLiveWrapLandscape: {
    bottom: 0, right: 120, top: 'auto' as any,
  },
  brandFrameComposeWrap: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
  },
  brandFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  brandLeft:     { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  brandAvatar:   { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: GOLD },
  brandAvatarFallback: { backgroundColor: 'rgba(212,175,55,0.25)', alignItems: 'center', justifyContent: 'center' },
  brandInitial:  { fontSize: 16, fontFamily: FFB, color: GOLD },
  brandTextWrap: { flex: 1 },
  brandName:     { fontSize: 14, fontFamily: FFB, color: '#fff', letterSpacing: 0.3 },
  brandSub:      { fontSize: 11, fontFamily: FFB, color: GOLD, letterSpacing: 0.3, marginTop: 2 },
  brandLogo:     { width: 26, height: 26 },

  // ── Slide-up menu
  menuBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5,
  },
  menuPanel: {
    position: 'absolute', bottom: CONTROLS_HEIGHT, left: 0, right: 0,
    backgroundColor: 'rgba(10,10,10,0.92)',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 16, paddingBottom: 12,
    zIndex: 10,
    gap: 12,
  },
  menuTitle: {
    fontSize: 9, fontFamily: FFB, color: 'rgba(255,255,255,0.4)',
    letterSpacing: 2, textAlign: 'center',
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14, padding: 3, gap: 3,
  },
  modeBtn:       { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center' },
  modeBtnOn:     { backgroundColor: 'rgba(255,255,255,0.18)' },
  modeBtnText:   { fontSize: 14, fontFamily: FFB, color: 'rgba(255,255,255,0.4)' },
  modeBtnTextOn: { fontFamily: FFB, color: '#fff' },

  // ── Main controls bar
  controls: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: CONTROLS_HEIGHT,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: Platform.OS === 'ios' ? 28 : 12,
    zIndex: 6,
  },
  controlsLandscape: {
    bottom: 0, right: 0, top: 0, left: 'auto' as any,
    width: 110, height: 'auto' as any,
    justifyContent: 'center',
    paddingBottom: 0,
  },

  captureRow:          { flexDirection: 'row', alignItems: 'center', gap: 16 },
  captureRowLandscape: { flexDirection: 'column', gap: 16 },

  captureBtn: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 3, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  captureBtnInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  captureBtnVideo: { backgroundColor: '#ef4444' },
  captureBtnStop:  { width: 26, height: 26, borderRadius: 4, backgroundColor: '#ef4444' },
  recordingRing: {
    position: 'absolute', width: 80, height: 80, borderRadius: 40,
    borderWidth: 2, borderColor: '#ef4444', opacity: 0.6,
  },

  sideBtn:      { alignItems: 'center', width: 44 },
  sideBtnIcon:  { fontSize: 20, color: '#fff' },
  sideBtnLabel: { fontSize: 8, fontFamily: FFB, color: 'rgba(255,255,255,0.55)', letterSpacing: 0.8, marginTop: 3 },

  burgerIcon:     { gap: 4, alignItems: 'center', height: 20, justifyContent: 'center' },
  burgerIconOpen: { opacity: 0.5 },
  burgerLine:     { width: 18, height: 2, backgroundColor: '#fff', borderRadius: 1 },

  recTimer: { fontSize: 11, fontFamily: FFB, color: '#ef4444', letterSpacing: 1, marginBottom: 4 },

  // ── Preview
  previewOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingBottom: Platform.OS === 'ios' ? 48 : 28,
    paddingHorizontal: 16,
  },
  previewClose:     {
    alignSelf: 'flex-start', backgroundColor: '#111',
    borderRadius: 20, borderWidth: 1, borderColor: '#1c1c1c',
    paddingHorizontal: 14, paddingVertical: 7,
  },
  previewCloseText: { fontSize: 14, fontFamily: FFB, color: '#fff' },
  previewActions:   { flexDirection: 'row', gap: 12, justifyContent: 'center' },
  previewBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c',
    paddingVertical: 14,
  },
  previewBtnPrimary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: GOLD, borderRadius: 12,
    paddingVertical: 14,
  },
  previewBtnIcon:  { fontSize: 20 },
  previewBtnLabel: { fontSize: 15, fontFamily: FFB, color: '#fff' },
});
