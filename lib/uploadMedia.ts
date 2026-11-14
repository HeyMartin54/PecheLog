import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import { withTimeout } from '@/lib/net';
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from '@/lib/supabase';

// ─── Envoi de fichiers vers Supabase Storage ─────────────────────────────────
//
// NATIF : envoi binaire en flux par le système (expo-file-system).
//   L'ancienne méthode — fetch(uri) → Blob → supabase.storage.upload(blob) —
//   ne peut pas fonctionner sur React Native : supabase-js enveloppe le Blob
//   dans un FormData, que la couche réseau native refuse (« Unrecognized
//   FormData part »). L'erreur était avalée : les photos n'arrivaient jamais.
//   L'envoi natif ne charge pas le fichier en mémoire (vidéos) et peut être
//   annulé proprement.
//
// WEB : Blob via supabase-js (fonctionne dans un navigateur).

const BUCKET = 'catch-media';
const UPLOAD_TIMEOUT_MS = 120_000;

/** Erreur d'envoi. `transient` = réessayer plus tard ; sinon le fichier est refusé. */
export class UploadError extends Error {
  status: number;
  transient: boolean;
  constructor(message: string, status: number, transient: boolean) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
    this.transient = transient;
  }
}

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
};

export function contentTypeForPath(path: string, fallback: string): string {
  const ext = path.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? fallback;
}

/** Le Storage répond « Duplicate » si l'objet existe déjà : envoi déjà réussi. */
function isDuplicate(status: number, body: string): boolean {
  if (status === 409) return true;
  const text = body.toLowerCase();
  return text.includes('duplicate') || text.includes('already exists');
}

function isTransientStatus(status: number): boolean {
  // 0 = pas de réponse ; 401/403 = jeton expiré (sera rafraîchi) ; 408/429/5xx = réessayer
  return status === 0 || status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;
}

async function uploadNative(localUri: string, storagePath: string, contentType: string): Promise<void> {
  const { data } = await withTimeout(supabase.auth.getSession(), 20_000, 'getSession');
  const token = data.session?.access_token;
  if (!token) throw new UploadError('Session absente', 0, true);

  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`;
  const task = FileSystem.createUploadTask(url, localUri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': contentType,
      'cache-control': 'max-age=3600',
      'x-upsert': 'false',
    },
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    task.cancelAsync().catch(() => undefined);
  }, UPLOAD_TIMEOUT_MS);

  let result: FileSystem.FileSystemUploadResult | null | undefined;
  try {
    result = await task.uploadAsync();
  } catch (e) {
    throw new UploadError(timedOut ? 'Timeout envoi média' : String((e as Error)?.message ?? e), 0, true);
  } finally {
    clearTimeout(timer);
  }

  if (!result) throw new UploadError(timedOut ? 'Timeout envoi média' : 'Envoi annulé', 0, true);
  if (result.status >= 200 && result.status < 300) return;
  if (isDuplicate(result.status, result.body ?? '')) return;
  throw new UploadError(
    `Storage ${result.status}: ${(result.body ?? '').slice(0, 200)}`,
    result.status,
    isTransientStatus(result.status),
  );
}

async function uploadWeb(sourceUri: string, storagePath: string, contentType: string): Promise<void> {
  let blob: Blob;
  try {
    const response = await fetch(sourceUri);
    if (!response.ok) throw new Error(`lecture ${response.status}`);
    blob = await response.blob();
  } catch (e) {
    // Le fichier local n'est plus lisible : réessayer ne servira à rien.
    throw new UploadError(`Fichier illisible : ${String((e as Error)?.message ?? e)}`, 0, false);
  }

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, blob, { contentType: blob.type || contentType, upsert: false });
  if (!error) return;

  const err = error as { message?: string; status?: number; statusCode?: string | number };
  const status = Number(err.statusCode ?? err.status ?? 0) || 0;
  const message = err.message ?? 'Erreur Storage';
  if (isDuplicate(status, message)) return;
  throw new UploadError(message, status, isTransientStatus(status));
}

/**
 * Envoie un fichier local vers le bucket. Idempotent : si l'objet existe déjà
 * à ce chemin (envoi précédent dont la réponse s'est perdue), c'est un succès.
 */
export async function uploadFileToStorage(
  localUri: string,
  storagePath: string,
  fallbackContentType: string,
): Promise<void> {
  const contentType = contentTypeForPath(localUri, contentTypeForPath(storagePath, fallbackContentType));
  if (Platform.OS === 'web') await uploadWeb(localUri, storagePath, contentType);
  else await uploadNative(localUri, storagePath, contentType);
}

/**
 * Envoie une photo/vidéo de prise.
 * `mediaId` (UUID client) rend le chemin DÉTERMINISTE : rejouer l'envoi vise le
 * même objet au lieu d'en créer un second.
 */
export async function uploadMediaFile(
  uri: string,
  userId: string,
  catchId: string,
  mediaType: 'photo' | 'video',
  mediaId?: string,
): Promise<{ storagePath: string }> {
  const fromUri = uri.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  const ext = CONTENT_TYPES[fromUri] ? fromUri : mediaType === 'video' ? 'mp4' : 'jpg';
  const storagePath = `${userId}/${catchId}/${mediaId ?? Date.now()}.${ext}`;
  await uploadFileToStorage(uri, storagePath, mediaType === 'video' ? 'video/mp4' : 'image/jpeg');
  return { storagePath };
}
