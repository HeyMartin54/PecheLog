import { supabase } from '@/lib/supabase';

export async function uploadMediaFile(
  uri: string,
  userId: string,
  catchId: string,
  mediaType: 'photo' | 'video',
): Promise<{ storagePath: string }> {
  const ext = mediaType === 'video' ? 'mp4' : 'jpg';
  const storagePath = `${userId}/${catchId}/${Date.now()}.${ext}`;

  const response = await fetch(uri);
  if (!response.ok) throw new Error(`[Media] Impossible de lire le fichier : ${uri}`);

  const blob = await response.blob();
  const contentType = blob.type || (mediaType === 'video' ? 'video/mp4' : 'image/jpeg');

  const { error } = await supabase.storage
    .from('catch-media')
    .upload(storagePath, blob, { contentType, upsert: false });

  if (error) throw error;
  return { storagePath };
}
