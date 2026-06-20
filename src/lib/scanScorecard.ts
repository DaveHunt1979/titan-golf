import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';

export interface ScannedHole {
  hole:    number;
  par:     number | null;
  yardage: number | null;
  si:      number | null;
}

export async function scanScorecardFromCamera(): Promise<ScannedHole[]> {
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

export async function scanScorecardFromLibrary(): Promise<ScannedHole[]> {
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

async function callScanFunction(imageBase64: string, mediaType: string): Promise<ScannedHole[]> {
  const { data, error } = await supabase.functions.invoke('scan-scorecard', {
    body: { imageBase64, mediaType },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  if (!data?.holes || !Array.isArray(data.holes)) throw new Error('No hole data returned');
  return data.holes as ScannedHole[];
}
