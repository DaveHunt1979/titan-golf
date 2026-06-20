import { supabase } from './supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

/**
 * Upload a local file URI to Supabase Storage via the REST API using FormData.
 * React Native's fetch().blob() doesn't produce a blob the Supabase JS client
 * can consume, so we bypass the client and POST directly.
 *
 * Returns the public URL of the uploaded file.
 */
export async function uploadImage(
  localUri: string,
  bucket: string,
  path: string,
  contentType = 'image/jpeg',
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const formData = new FormData();
  formData.append('file', {
    uri: localUri,
    name: path.split('/').pop() ?? 'upload.jpg',
    type: contentType,
  } as any);

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'x-upsert': 'true',
      },
      body: formData,
    },
  );

  if (!response.ok) {
    let message = 'Upload failed';
    try { message = (await response.json()).message ?? message; } catch {}
    throw new Error(message);
  }

  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}
