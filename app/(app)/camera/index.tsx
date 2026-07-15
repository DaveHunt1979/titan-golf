import { useRef, useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  useWindowDimensions, Image, Platform, Animated, Pressable,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { supabase } from '../../../src/lib/supabase';
import { getPlayerAvatar } from '../../../src/lib/assets';

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
  tournament: string | null;
  hole: number | null;
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
    name: '', avatarUrl: null, playerId: null, tournament: null, hole: null,
  });

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  // Font loading guard
  if (!fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000' }}><StatusBar style="light" /></View>
  );

  // Unlock screen rotation on this screen only
  useFocusEffect(useCallback(() => {
    ScreenOrientation.unlockAsync();
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, []));

  // Load player + competition info
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: player } = await supabase
        .from('players')
        .select('id, display_name, avatar_url')
        .eq('auth_uid', user.id)
        .maybeSingle();
      if (!player) return;

      const { data: comp } = await supabase
        .from('competitions')
        .select('name')
        .eq('is_active', true)
        .maybeSingle();

      // Find current hole if in an active match
      let hole: number | null = null;
      const { data: match } = await supabase
        .from('matches')
        .select('holes_string')
        .eq('status', 'in_progress')
        .or(`home_player_ids.cs.{${player.id}},away_player_ids.cs.{${player.id}}`)
        .maybeSingle();
      if (match?.holes_string) {
        const played = (match.holes_string as string).split('').filter(c => c !== '.').length;
        hole = Math.min(played + 1, 18);
      }

      setInfo({
        name:       player.display_name ?? '',
        avatarUrl:  player.avatar_url ?? null,
        playerId:   player.id,
        tournament: comp?.name ?? null,
        hole,
      });
    })();
  }, []);

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
      if (photo?.uri) setPreview({ uri: photo.uri, type: 'photo' });
    } catch (e: any) {
      Alert.alert('Capture failed', e.message);
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

  async function saveToLibrary() {
    if (!preview) return;
    setSaving(true);
    try {
      await MediaLibrary.saveToLibraryAsync(preview.uri);
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
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
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
  const avatar = info.playerId ? getPlayerAvatar(info.playerId, 'normal') : null;

  const Banner = (
    <View style={[s.banner, isLandscape && s.bannerLandscape]}>
      <View style={s.bannerLeft}>
        {avatar
          ? <Image source={avatar} style={s.bannerAvatar} />
          : info.avatarUrl
            ? <Image source={{ uri: info.avatarUrl }} style={s.bannerAvatar} />
            : <View style={[s.bannerAvatar, s.bannerAvatarFallback]}>
                <Text style={s.bannerInitial}>{info.name?.[0] ?? '?'}</Text>
              </View>
        }
        <View>
          <Text style={s.bannerName} numberOfLines={1}>{info.name || 'Player'}</Text>
          {info.tournament && (
            <Text style={s.bannerSub} numberOfLines={1}>{info.tournament}</Text>
          )}
        </View>
      </View>
      {info.hole && (
        <View style={s.bannerHoleChip}>
          <Text style={s.bannerHoleLabel}>HOLE</Text>
          <Text style={s.bannerHoleNum}>{info.hole}</Text>
        </View>
      )}
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
        onPress={() => router.back()}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={s.closeBtnText}>✕</Text>
      </TouchableOpacity>

      {/* Player banner */}
      {Banner}

      {/* Camera controls */}
      {Controls}
    </View>
  );
}

const BANNER_HEIGHT   = 72;
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

  // ── Banner
  banner: {
    position: 'absolute',
    bottom: CONTROLS_HEIGHT,
    left: 0, right: 0,
    height: BANNER_HEIGHT,
    backgroundColor: 'rgba(0,0,0,0.55)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  bannerLandscape: {
    bottom: 0, right: 120, top: 'auto' as any,
    height: 60,
  },
  bannerLeft:      { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  bannerAvatar:    { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: GOLD },
  bannerAvatarFallback: { backgroundColor: 'rgba(212,175,55,0.25)', alignItems: 'center', justifyContent: 'center' },
  bannerInitial:   { fontSize: 18, fontFamily: FFB, color: GOLD },
  bannerName:      { fontSize: 15, fontFamily: FFB, color: '#fff' },
  bannerSub:       { fontSize: 11, fontFamily: FFB, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  bannerHoleChip:  {
    alignItems: 'center', backgroundColor: GOLD,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, minWidth: 44,
  },
  bannerHoleLabel: { fontSize: 8, fontFamily: FFB, color: '#000', letterSpacing: 1 },
  bannerHoleNum:   { fontSize: 22, fontFamily: FFB, color: '#000', lineHeight: 24 },

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
