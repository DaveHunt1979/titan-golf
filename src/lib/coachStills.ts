import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import type { VideoPlayer } from 'expo-video';
import { supabase } from './supabase';

// Grab the frame at `time` as a local PNG. generateThumbnailsAsync gives a
// native image ref (SharedRef<'image'>), which ImageManipulator.manipulate
// accepts directly, so nothing is screen-captured from the video surface.
export async function grabFrame(player: VideoPlayer, time: number): Promise<{ uri: string; width: number; height: number }> {
  const [thumb] = await player.generateThumbnailsAsync(time, { maxWidth: 2160 });
  if (!thumb) throw new Error('Could not grab this frame.');
  const img = await ImageManipulator.manipulate(thumb).renderAsync();
  const out = await img.saveAsync({ format: SaveFormat.PNG });
  return { uri: out.uri, width: out.width, height: out.height };
}

// Upload the frame to the coach's library (same storage pattern as the
// library screen) and add it as an image row.
export async function saveStill({ coachId, title, frameUri }: { coachId: string; title: string; frameUri: string }): Promise<{ libraryId: string }> {
  const base64 = await FileSystem.readAsStringAsync(frameUri, { encoding: FileSystem.EncodingType.Base64 });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const path = `library/${coachId}/${filename}`;
  const { error: uploadError } = await supabase.storage
    .from('coaching-videos').upload(path, bytes, { contentType: 'image/png' });
  if (uploadError) throw uploadError;

  const { data, error: insertError } = await supabase.from('coach_video_library').insert({
    coach_id: coachId, title, storage_path: path, media_type: 'image', area: 'general',
  }).select('id').single();
  if (insertError || !data) {
    try { await supabase.storage.from('coaching-videos').remove([path]); } catch { /* best effort */ }
    throw insertError ?? new Error('Could not save the still.');
  }
  return { libraryId: data.id };
}

// Add-only access to Photos. Returns false if the user said no.
export async function saveToPhotos(uri: string): Promise<boolean> {
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) return false;
  await MediaLibrary.saveToLibraryAsync(uri);
  return true;
}
