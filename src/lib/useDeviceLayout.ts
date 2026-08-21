import { Platform, useWindowDimensions } from 'react-native';

export interface DeviceLayout {
  isPad: boolean;
  width: number;
  height: number;
}

export function useDeviceLayout(): DeviceLayout {
  const { width, height } = useWindowDimensions();
  const isPad = Platform.OS === 'ios' ? !!(Platform as any).isPad : width >= 768;
  return { isPad, width, height };
}

// Static constant — safe to use outside component render (e.g. StyleSheet, IS_PAD checks)
export const IS_PAD    = Platform.OS === 'ios' && !!(Platform as any).isPad;
export const SIDEBAR_W = 220;

// Temporarily hiding the GPS panel in Broadcast Mode (Dave, 2026-08-21) — flip back to true when ready.
export const GPS_PANEL_ENABLED = false;
