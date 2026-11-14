import { uploadFileToStorage } from '@/lib/uploadMedia';

export async function uploadLureMedia(
  uri: string,
  userId: string,
): Promise<{ storagePath: string }> {
  const storagePath = `lures/${userId}/${Date.now()}.jpg`;
  // Même mécanisme que les médias de prises (envoi natif en flux sur mobile).
  await uploadFileToStorage(uri, storagePath, 'image/jpeg');
  return { storagePath };
}
