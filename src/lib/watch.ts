import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const { WatchBridge } = NativeModules;
const emitter = WatchBridge ? new NativeEventEmitter(WatchBridge) : null;

// Diagnostic — visible in Metro / Xcode console
if (Platform.OS === 'ios') {
  console.log('[WatchBridge] module:', WatchBridge ? 'FOUND' : 'NULL — native module not registered');
  if (WatchBridge) {
    console.log('[WatchBridge] methods:', Object.keys(WatchBridge).join(', '));
  }
}

export function watchBridgeAvailable(): boolean {
  return !!WatchBridge;
}

export interface WatchMatchPayload {
  matchId: string;
  matchNumber: number;
  homeLabel: string;
  awayLabel: string;
  homeColor: string;
  awayColor: string;
  currentHole: number;
  holesString: string;
}

export interface WatchScoreEntry {
  matchId: string;
  hole: number;
  result: 'h' | 'f' | 'a';
}

export function sendMatchToWatch(payload: WatchMatchPayload) {
  if (Platform.OS !== 'ios' || !WatchBridge) return;
  WatchBridge.sendMatchToWatch(payload);
}

export function clearMatchFromWatch() {
  if (Platform.OS !== 'ios' || !WatchBridge) return;
  WatchBridge.clearMatchFromWatch();
}

export function onWatchScoreEntry(callback: (entry: WatchScoreEntry) => void) {
  if (!emitter) return () => {};
  const sub = emitter.addListener('onWatchScoreEntry', callback);
  return () => sub.remove();
}

export interface WatchSoloPayload {
  matchId: string;
  playerName: string;
  format: 'stableford' | 'medal';
  currentHole: number;
  par: number;
  extraStrokes: number;
  holesCompleted: number;
  yardage?: number | null;
  totalPts?: number;
  toPar?: number;
}

export interface WatchSoloScoreEntry {
  matchId: string;
  hole: number;
  score: number;
}

export function sendSoloMatchToWatch(payload: WatchSoloPayload) {
  if (Platform.OS !== 'ios' || !WatchBridge) return;
  WatchBridge.sendSoloMatchToWatch({ type: 'soloMatchUpdate', ...payload });
}

export function clearSoloMatchFromWatch() {
  if (Platform.OS !== 'ios' || !WatchBridge) return;
  WatchBridge.sendSoloMatchToWatch({ type: 'clearSoloMatch' });
}

export function onWatchSoloScoreEntry(callback: (entry: WatchSoloScoreEntry) => void) {
  if (!emitter) return () => {};
  const sub = emitter.addListener('onWatchSoloScoreEntry', callback);
  return () => sub.remove();
}

export function onWatchRequestsState(callback: () => void) {
  if (!emitter) return () => {};
  const sub = emitter.addListener('onWatchRequestsState', callback);
  return () => sub.remove();
}
