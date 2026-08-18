import { supabase } from './supabase';
import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';

let audioQueue: Promise<void> = Promise.resolve();

// Queues audio so voices never overlap — each clip waits for the previous to
// finish. This queue is module-level and outlives any individual match, so
// every entry MUST settle on its own — if a single native playback ever
// hangs (e.g. an interrupted/backgrounded audio session), an unbounded chain
// here would wedge every future voice call, in every later game, until the
// app is fully restarted. The timeout below guarantees that can't happen.
function playWithTimeout(b64: string): Promise<void> {
  return new Promise(resolve => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    const timer = setTimeout(() => { console.warn('[caddie] audio playback timed out — unwedging queue'); done(); }, 15000);
    _playAudio(b64)
      .then(() => { clearTimeout(timer); done(); })
      .catch(() => { clearTimeout(timer); done(); });
  });
}

export function playBase64Audio(b64: string): Promise<void> {
  audioQueue = audioQueue.then(() => playWithTimeout(b64));
  return audioQueue;
}

async function _playAudio(b64: string): Promise<void> {
  const path = `${FileSystem.cacheDirectory}caddie_${Date.now()}.mp3`;
  await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
  await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
  const { sound, status } = await Audio.Sound.createAsync({ uri: path }, { shouldPlay: true });
  const durationMs = (status.isLoaded ? (status.durationMillis ?? 10000) : 10000) + 1500;
  await new Promise<void>(resolve => {
    const fallback = setTimeout(() => {
      sound.unloadAsync();
      FileSystem.deleteAsync(path, { idempotent: true });
      resolve();
    }, durationMs);
    sound.setOnPlaybackStatusUpdate(s => {
      if (s.isLoaded && s.didJustFinish) {
        clearTimeout(fallback);
        sound.unloadAsync();
        FileSystem.deleteAsync(path, { idempotent: true });
        resolve();
      }
    });
  });
}

export async function speakIntro(players: string[], startHole?: number, finishHole?: number): Promise<void> {
  try {
    const { data, error } = await supabase.functions.invoke('tts-caddie', {
      body: { mode: 'intro', players, startHole, finishHole },
    });
    if (error || !data?.chipAudio) return;
    await playBase64Audio(data.chipAudio);
    if (data?.birdieAudio) await playBase64Audio(data.birdieAudio);
  } catch {}
}

export async function speakOutro(playerName: string, score: string): Promise<void> {
  try {
    const { data, error } = await supabase.functions.invoke('tts-caddie', {
      body: { mode: 'outro', players: [playerName], score },
    });
    if (error || !data?.chipAudio) return;
    await playBase64Audio(data.chipAudio);
    if (data?.birdieAudio) await playBase64Audio(data.birdieAudio);
  } catch {}
}

export async function speakBack9(
  playerName: string,
  format: 'stableford' | 'medal',
  frontPts: number,
  frontGross: number,
  frontVsPar: number,
): Promise<void> {
  try {
    const { data, error } = await supabase.functions.invoke('tts-caddie', {
      body: { mode: 'back9', players: [playerName], format, frontPts, frontGross, frontVsPar },
    });
    if (error || !data?.chipAudio) return;
    await playBase64Audio(data.chipAudio);
    if (data?.birdieAudio) await playBase64Audio(data.birdieAudio);
  } catch {}
}

export async function speakDebrief(stats: {
  player: string;
  course: string;
  gross: number;
  toPar: number;
  stablefordPts: number;
  putts: number;
  fairwaysHit: number;
  fairwaysTracked: number;
  birdies: number;
  bogeys: number;
  doubles: number;
  bestHole: { hole: number; pts: number } | null;
  worstHole: { hole: number; gross: number; par: number } | null;
}): Promise<void> {
  try {
    const { data, error } = await supabase.functions.invoke('tts-caddie', {
      body: { mode: 'debrief', ...stats },
    });
    if (error || !data?.chipAudio) return;
    await playBase64Audio(data.chipAudio);
    if (data?.birdieAudio) await playBase64Audio(data.birdieAudio);
  } catch {}
}

let lastVoice: 'chip' | 'birdie' = 'birdie';

export type PressureStanding = { name: string; pts: number };

export async function speakPressure(params: {
  standings?: PressureStanding[];
  holeNumber: number;
  holesLeft: number;
  format: 'stableford' | 'matchplay';
  matchplay?: { homeTeam: string; awayTeam: string; homeUp: number; remaining: number };
}): Promise<void> {
  try {
    const voice: 'chip' | 'birdie' = lastVoice === 'chip' ? 'birdie' : 'chip';
    lastVoice = voice;
    const { data } = await supabase.functions.invoke('tts-caddie', {
      body: { mode: 'pressure', ...params, voice },
    });
    if (data?.audio) await playBase64Audio(data.audio);
  } catch {}
}

export async function speakHole(
  holeNumber: number,
  par: number | null,
  yardage: number | null,
  si: number | null,
  players: string[] = [],
): Promise<void> {
  try {
    const voice: 'chip' | 'birdie' = lastVoice === 'chip' ? 'birdie' : 'chip';
    lastVoice = voice;

    const body = players.length > 0
      ? { hole: holeNumber, par, yardage, si, players, voice }
      : { text: `Hole ${holeNumber}. Par ${par}${yardage ? `, ${yardage} yards` : ''}.`, voice };

    const { data } = await supabase.functions.invoke('tts-caddie', { body });
    if (data?.audio) await playBase64Audio(data.audio);
  } catch {}
}
