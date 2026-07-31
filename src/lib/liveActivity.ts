import { NativeModules, Platform } from 'react-native';

const { LiveActivityBridge } = NativeModules;

export interface LAPlayer {
  name: string;
  pts: number;
  isLeader: boolean;
}

export interface LAStartPayload {
  matchId: string;
  courseName: string;
  hole: number;
  par: number;
  holesLeft: number;
  format: string;
  players: LAPlayer[];
  matchScore?: string;
}

export interface LAUpdatePayload {
  hole: number;
  par: number;
  holesLeft: number;
  format: string;
  players: LAPlayer[];
  matchScore?: string;
}

const available = () => Platform.OS === 'ios' && !!LiveActivityBridge;

export async function startLiveActivity(payload: LAStartPayload): Promise<string | null> {
  if (!available()) return null;
  try { return await LiveActivityBridge.startActivity(payload); } catch { return null; }
}

export function updateLiveActivity(payload: LAUpdatePayload): void {
  if (!available()) return;
  LiveActivityBridge.updateActivity(payload);
}

export function endLiveActivity(): void {
  if (!available()) return;
  LiveActivityBridge.endActivity();
}
