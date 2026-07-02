import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { playBase64Audio } from './caddie';

export interface VoiceCommandContext {
  playerName: string;
  holeNumber: number;
  par: number;
  yardage?: number | null;
  strokeIndex?: number | null;
  format: string;
  holesCompleted: number;
  runningScore?: string;
  kronosPosition?: number | null;
}

export interface VoiceCommandResult {
  transcript: string;
  voice: 'chip' | 'birdie';
  response: string;
  action: { type: string; club?: string; distance?: number } | null;
}

let activeRecording: Audio.Recording | null = null;

export async function startRecording(): Promise<void> {
  await Audio.requestPermissionsAsync();
  await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
  const { recording } = await Audio.Recording.createAsync(
    Audio.RecordingOptionsPresets.HIGH_QUALITY
  );
  activeRecording = recording;
}

export async function stopAndSendCommand(ctx: VoiceCommandContext): Promise<VoiceCommandResult | null> {
  if (!activeRecording) return null;
  try {
    await activeRecording.stopAndUnloadAsync();
    const uri = activeRecording.getURI();
    activeRecording = null;
    if (!uri) return null;

    await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });

    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    FileSystem.deleteAsync(uri, { idempotent: true });

    const { data, error } = await supabase.functions.invoke('voice-command', {
      body: { audio: b64, context: ctx },
    });

    if (error || !data?.audio) return null;

    await playBase64Audio(data.audio);

    return {
      transcript: data.transcript ?? '',
      voice: data.voice ?? 'chip',
      response: data.response ?? '',
      action: data.action ?? null,
    };
  } catch {
    activeRecording = null;
    return null;
  }
}

export function cancelRecording(): void {
  if (!activeRecording) return;
  activeRecording.stopAndUnloadAsync().catch(() => {});
  activeRecording = null;
}
