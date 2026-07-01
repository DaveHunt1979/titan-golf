import { Platform } from 'react-native';

// Graceful import — NFC is unavailable in Expo Go / simulator
let NfcManager: any = null;
let NfcTech: any = null;
try {
  const mod = require('react-native-nfc-manager');
  NfcManager = mod.default;
  NfcTech    = mod.NfcTech;
} catch {}

export async function isNfcSupported(): Promise<boolean> {
  if (!NfcManager || Platform.OS !== 'ios') return false;
  try {
    await NfcManager.start();
    return await NfcManager.isSupported();
  } catch {
    return false;
  }
}

/**
 * Scans for a single NFC tag and returns its hardware UID.
 * Shows the iOS system NFC sheet automatically.
 * Returns null if cancelled or unsupported.
 */
export async function scanNfcTagId(): Promise<string | null> {
  if (!NfcManager) return null;
  try {
    await NfcManager.start();
    await NfcManager.requestTechnology(
      [NfcTech.Ndef, NfcTech.MifareIOS, NfcTech.Iso15693],
      { alertMessage: 'Hold your phone near the club sticker' }
    );
    const tag = await NfcManager.getTag();
    return tag?.id ?? null;
  } catch {
    return null;
  } finally {
    await NfcManager.cancelTechnologyRequest().catch(() => {});
  }
}

export function formatTagId(raw: string): string {
  return raw.toUpperCase().match(/.{1,2}/g)?.join(':') ?? raw;
}
