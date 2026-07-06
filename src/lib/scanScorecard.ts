import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';

export interface ScannedHole {
  hole:    number;
  par:     number | null;
  yardage: number | null;  // legacy fallback — prefer tees
  si:      number | null;
  tees:    Record<string, number> | null;
}

export interface ScannedCourse {
  name:  string | null;
  holes: ScannedHole[];
}

export async function scanScorecardFromCamera(): Promise<ScannedCourse[]> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== 'granted') throw new Error('Camera permission denied');

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.8,
    base64: true,
  });

  if (result.canceled || !result.assets[0]) throw new Error('Cancelled');
  const asset = result.assets[0];
  if (!asset.base64) throw new Error('Could not read image data');
  return callScanFunction(asset.base64, asset.mimeType ?? 'image/jpeg');
}

export async function scanScorecardFromLibrary(): Promise<ScannedCourse[]> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') throw new Error('Photo library permission denied');

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.8,
    base64: true,
  });

  if (result.canceled || !result.assets[0]) throw new Error('Cancelled');
  const asset = result.assets[0];
  if (!asset.base64) throw new Error('Could not read image data');
  return callScanFunction(asset.base64, asset.mimeType ?? 'image/jpeg');
}

async function callScanFunction(imageBase64: string, mediaType: string): Promise<ScannedCourse[]> {
  const { data, error } = await supabase.functions.invoke('scan-scorecard', {
    body: { imageBase64, mediaType },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);

  // New multi-course format
  if (data?.courses && Array.isArray(data.courses)) {
    return data.courses as ScannedCourse[];
  }

  // Backward-compat: old format returned a flat holes array
  if (data?.holes && Array.isArray(data.holes)) {
    return [{ name: null, holes: data.holes as ScannedHole[] }];
  }

  throw new Error('No hole data returned — try a clearer photo');
}
