import { supabase } from './supabase';
import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';

async function playBase64Audio(b64: string): Promise<void> {
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

export async function speakIntro(players: string[]): Promise<void> {
  try {
    const { data, error } = await supabase.functions.invoke('tts-caddie', {
      body: { mode: 'intro', players },
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

let lastVoice: 'chip' | 'birdie' = 'birdie';

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
