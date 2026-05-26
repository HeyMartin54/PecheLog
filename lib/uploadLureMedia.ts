import { supabase } from '@/lib/supabase';

export async function uploadLureMedia(
  uri: string,
  userId: string,
): Promise<{ storagePath: string }> {
  const storagePath = `lures/${userId}/${Date.now()}.jpg`;

  const response = await fetch(uri);
  if (!response.ok) throw new Error(`[LureMedia] Impossible de lire le fichier : ${uri}`);

  const blob = await response.blob();
  const contentType = blob.type || 'image/jpeg';

  const { error } = await supabase.storage
    .from('catch-media')
    .upload(storagePath, blob, { contentType, upsert: false });

  if (error) throw error;
  return { storagePath };
}
