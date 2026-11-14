import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import type { CachedCatch } from '@/lib/catchCache';
import type { CatchPayload, MediaItem, MediaType } from '@/lib/types';
import { generateUuid, isUuid } from '@/lib/uuid';

// ─── File d'attente des prises (« boîte d'envoi ») ───────────────────────────
//
// Toute prise est d'abord écrite ICI, puis envoyée au serveur par le moteur de
// synchronisation (lib/offlineSync.ts). Il n'y a plus de chemin « en ligne »
// séparé : enregistrer est toujours instantané et fonctionne sans réseau.
//
// Règles de ce module :
//  1. Chaque modification relit le stockage et réécrit DANS un verrou. Deux
//     opérations concurrentes (une saisie pendant une synchronisation) ne
//     peuvent donc plus s'écraser — c'était une perte de données réelle.
//  2. Une écriture qui échoue LÈVE une erreur : l'écran ne doit jamais afficher
//     « enregistré » si rien n'a été écrit.
//  3. Rien n'est supprimé de la file sans confirmation du serveur.

/** Même clé que les versions précédentes : les prises déjà en file sont conservées. */
export const OFFLINE_QUEUE_KEY = 'offline_catches_queue_v1';

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueuedMedia = {
  /** UUID client → nom de fichier dans le Storage + clé de catch_media. */
  id: string;
  uri: string;
  type: MediaType;
  uploaded: boolean;
};

export type QueueItem = {
  /** = payload.id : l'UUID de la prise, identique en local et sur le serveur. */
  id: string;
  payload: CatchPayload & { id: string };
  media: QueuedMedia[];
  createdAt: number;
  attempts: number;
  lastAttemptAt: number | null;
  lastError: string | null;
  /** Refus définitif du serveur : visible dans Réglages, plus de réessai automatique. */
  blocked: boolean;
  /** La ligne `catches` est sur le serveur ; il ne reste que des médias à envoyer. */
  catchSynced: boolean;
};

/** Ancien format (avant le verrou et les UUID) : { payload, media }. */
export type OfflineQueuedCatch = {
  payload: CatchPayload;
  media: MediaItem[];
};

export type QueueSummary = {
  /** Éléments de la file appartenant à cet utilisateur. */
  total: number;
  /** Prises pas encore confirmées par le serveur. */
  pendingCatches: number;
  /** Photos / vidéos pas encore envoyées. */
  pendingMedia: number;
  /** Prises refusées par le serveur (intervention requise). */
  blocked: number;
  /** Éléments d'un autre compte présents sur l'appareil (ignorés). */
  otherUsers: number;
  lastError: string | null;
};

// ─── Verrou (toutes les lectures-écritures sont sérialisées) ─────────────────

let chain: Promise<unknown> = Promise.resolve();

function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

// ─── Abonnements ─────────────────────────────────────────────────────────────

/**
 * 'enqueue' : une nouvelle prise attend d'être envoyée (→ lancer une synchro).
 * 'update'  : la file a changé pour une autre raison (envoi réussi, retrait…).
 */
export type QueueEvent = 'enqueue' | 'update';

const listeners = new Set<(event: QueueEvent) => void>();

/** Notifié après chaque modification de la file (ajout, mise à jour, retrait). */
export function subscribeQueue(listener: (event: QueueEvent) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify(event: QueueEvent): void {
  listeners.forEach((l) => {
    try { l(event); } catch (e) { console.warn('[Queue] listener error', e); }
  });
}

// ─── Lecture / écriture brutes ───────────────────────────────────────────────

function normalizeMedia(raw: unknown): { media: QueuedMedia[]; changed: boolean } {
  if (!Array.isArray(raw)) return { media: [], changed: raw != null };
  let changed = false;
  const media: QueuedMedia[] = [];
  for (const m of raw as Partial<QueuedMedia>[]) {
    if (!m || typeof m.uri !== 'string' || m.uri.length === 0) { changed = true; continue; }
    const id = isUuid(m.id) ? m.id : generateUuid();
    if (id !== m.id || typeof m.uploaded !== 'boolean') changed = true;
    media.push({ id, uri: m.uri, type: m.type === 'video' ? 'video' : 'photo', uploaded: m.uploaded === true });
  }
  return { media, changed };
}

/**
 * Ramène n'importe quelle entrée (ancien ou nouveau format) au format courant.
 * Les anciennes entrées n'avaient pas d'UUID : on leur en attribue un, qui est
 * PERSISTÉ avant tout envoi (sinon chaque tentative utiliserait un nouvel
 * identifiant et l'idempotence serait perdue).
 */
function normalizeItem(raw: unknown): { item: QueueItem | null; changed: boolean } {
  const r = raw as Partial<QueueItem> | null;
  if (!r || typeof r !== 'object' || !r.payload || typeof r.payload !== 'object') {
    return { item: null, changed: true };
  }
  const payload = r.payload as CatchPayload;
  if (typeof payload.user_id !== 'string' || typeof payload.species !== 'string') {
    return { item: null, changed: true };
  }

  let changed = false;
  const id = isUuid(r.id) ? r.id : isUuid(payload.id) ? payload.id : generateUuid();
  if (id !== r.id || id !== payload.id) changed = true;

  const { media, changed: mediaChanged } = normalizeMedia(r.media);
  if (mediaChanged) changed = true;

  const item: QueueItem = {
    id,
    payload: { ...payload, id },
    media,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
    attempts: typeof r.attempts === 'number' ? r.attempts : 0,
    lastAttemptAt: typeof r.lastAttemptAt === 'number' ? r.lastAttemptAt : null,
    lastError: typeof r.lastError === 'string' ? r.lastError : null,
    blocked: r.blocked === true,
    catchSynced: r.catchSynced === true,
  };
  if (
    typeof r.createdAt !== 'number' || typeof r.attempts !== 'number' ||
    typeof r.blocked !== 'boolean' || typeof r.catchSynced !== 'boolean'
  ) changed = true;

  return { item, changed };
}

async function readUnlocked(): Promise<{ items: QueueItem[]; changed: boolean }> {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  if (!raw) return { items: [], changed: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // JSON illisible : on met le contenu de côté plutôt que de le détruire.
    console.warn('[Queue] File illisible — sauvegarde de secours créée', e);
    try {
      await AsyncStorage.setItem(`${OFFLINE_QUEUE_KEY}_corrupt_${Date.now()}`, raw);
    } catch { /* rien */ }
    return { items: [], changed: true };
  }
  if (!Array.isArray(parsed)) return { items: [], changed: true };

  let changed = false;
  const items: QueueItem[] = [];
  for (const entry of parsed) {
    const { item, changed: c } = normalizeItem(entry);
    if (c) changed = true;
    if (item) items.push(item);
  }
  return { items, changed };
}

async function writeUnlocked(items: QueueItem[]): Promise<void> {
  if (items.length === 0) await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
  else await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
}

/**
 * Lecture-modification-écriture atomique. `mutator` reçoit la file telle
 * qu'elle est SUR DISQUE à cet instant et retourne la nouvelle file (ou null
 * pour ne rien écrire).
 */
async function mutate<T>(
  mutator: (items: QueueItem[]) => { items: QueueItem[] | null; result: T },
  event: QueueEvent = 'update',
): Promise<T> {
  let didWrite = false;
  const result = await withQueueLock(async () => {
    const { items, changed } = await readUnlocked();
    const out = mutator(items);
    if (out.items) {
      await writeUnlocked(out.items);
      didWrite = true;
    } else if (changed) {
      // Migration de format : on persiste même sans autre modification.
      await writeUnlocked(items);
      didWrite = true;
    }
    return out.result;
  });
  if (didWrite) notify(event);
  return result;
}

// ─── API ─────────────────────────────────────────────────────────────────────

/** Contenu actuel de la file (tous utilisateurs confondus). Ne lève jamais. */
export async function getQueue(): Promise<QueueItem[]> {
  try {
    return await mutate<QueueItem[]>((items) => ({ items: null, result: items }));
  } catch (e) {
    console.warn('[Queue] Lecture impossible', e);
    return [];
  }
}

/**
 * Ajoute une prise à la file. LÈVE une erreur si l'écriture échoue : l'appelant
 * doit alors prévenir l'utilisateur que la prise n'est PAS enregistrée.
 */
export async function enqueueCatch(input: {
  payload: CatchPayload;
  media?: MediaItem[];
}): Promise<QueueItem> {
  const id = isUuid(input.payload.id) ? input.payload.id : generateUuid();
  const item: QueueItem = {
    id,
    payload: { ...input.payload, id },
    media: (input.media ?? []).map((m) => ({
      id: isUuid(m.id) ? m.id : generateUuid(),
      uri: m.uri,
      type: m.type,
      uploaded: false,
    })),
    createdAt: Date.now(),
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    blocked: false,
    catchSynced: false,
  };
  return mutate<QueueItem>((items) => {
    // Idempotent : ré-enregistrer la même prise remplace l'entrée existante.
    const without = items.filter((i) => i.id !== id);
    return { items: [...without, item], result: item };
  }, 'enqueue');
}

/** Compatibilité avec l'ancienne signature ({ payload, media }). */
export async function enqueueOfflineCatch(item: OfflineQueuedCatch): Promise<void> {
  await enqueueCatch({ payload: item.payload, media: item.media });
}

/** Met à jour un élément (s'il existe encore). Retourne l'élément mis à jour. */
export async function updateQueueItem(
  id: string,
  patch: Partial<QueueItem> | ((item: QueueItem) => QueueItem),
): Promise<QueueItem | null> {
  return mutate<QueueItem | null>((items) => {
    const index = items.findIndex((i) => i.id === id);
    if (index === -1) return { items: null, result: null };
    const current = items[index];
    const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
    // L'identité ne change jamais, quoi que contienne le patch.
    const safe: QueueItem = { ...next, id: current.id, payload: { ...next.payload, id: current.id } };
    const copy = items.slice();
    copy[index] = safe;
    return { items: copy, result: safe };
  });
}

/** Retire un élément de la file (après confirmation du serveur, ou sur demande). */
export async function removeQueueItem(id: string, options: { deleteMedia?: boolean } = {}): Promise<void> {
  const removed = await mutate<QueueItem | null>((items) => {
    const found = items.find((i) => i.id === id) ?? null;
    if (!found) return { items: null, result: null };
    return { items: items.filter((i) => i.id !== id), result: found };
  });
  if (removed && options.deleteMedia) {
    for (const m of removed.media) await deleteLocalMedia(m.uri);
  }
}

export async function getQueueItem(id: string): Promise<QueueItem | null> {
  const items = await getQueue();
  return items.find((i) => i.id === id) ?? null;
}

export function summarizeQueue(items: QueueItem[], userId: string | null): QueueSummary {
  const mine = userId ? items.filter((i) => i.payload.user_id === userId) : [];
  const errors = mine.filter((i) => i.lastError).sort((a, b) => (b.lastAttemptAt ?? 0) - (a.lastAttemptAt ?? 0));
  return {
    total: mine.length,
    pendingCatches: mine.filter((i) => !i.catchSynced).length,
    pendingMedia: mine.reduce((n, i) => n + i.media.filter((m) => !m.uploaded).length, 0),
    blocked: mine.filter((i) => i.blocked).length,
    otherUsers: items.length - mine.length,
    lastError: errors[0]?.lastError ?? null,
  };
}

export async function getQueueSummary(userId: string | null): Promise<QueueSummary> {
  return summarizeQueue(await getQueue(), userId);
}

/** Nombre total d'éléments en file (compatibilité). */
export async function getOfflineQueueCount(): Promise<number> {
  return (await getQueue()).length;
}

/** Nombre de prises EN ATTENTE (pas encore sur le serveur) appartenant à un voyage. */
export async function getQueuedTripCatchCount(tripId: string): Promise<number> {
  const items = await getQueue();
  return items.filter((i) => !i.catchSynced && i.payload.trip_id === tripId).length;
}

/** Vue « prise » d'un élément de la file, pour l'afficher comme les autres. */
export function queueItemToCatch(item: QueueItem): CachedCatch {
  const p = item.payload;
  return {
    id: item.id,
    species: p.species,
    latitude: p.latitude,
    longitude: p.longitude,
    lake_name: p.lake_name,
    lure: p.lure,
    weight_lbs: p.weight_lbs,
    length_inches: p.length_inches,
    depth_meters: p.depth_meters,
    depth_source: p.depth_source,
    size_category: p.size_category,
    weather_conditions: p.weather_conditions,
    temperature_c: p.temperature_c,
    wind_speed_kmh: p.wind_speed_kmh,
    wind_direction_deg: p.wind_direction_deg,
    speed_kmh: p.speed_kmh,
    notes: p.notes,
    caught_at: p.caught_at,
    trip_id: p.trip_id,
    pending: true,
    sync_error: item.lastError,
    pending_media: item.media.filter((m) => !m.uploaded).length,
  };
}

// ─── Médias locaux ───────────────────────────────────────────────────────────

const OFFLINE_MEDIA_DIR = (FileSystem.documentDirectory ?? '') + 'offline_media/';
const KNOWN_MEDIA_EXT = new Set(['jpg', 'jpeg', 'png', 'heic', 'webp', 'mp4', 'mov', 'm4v']);

/**
 * Web : les médias choisis sont des data-URI de plusieurs Mo, impossibles à
 * stocker dans localStorage (quota 5 Mo). On les garde en mémoire pour la
 * session ; ils sont perdus si la page est rechargée avant l'envoi.
 */
const webMemoryMedia = new Map<string, string>();
const MEMORY_SCHEME = 'mem://';

/** Retourne l'URI réellement lisible d'un média en file (null si introuvable). */
export function resolveMediaUri(uri: string): string | null {
  if (!uri.startsWith(MEMORY_SCHEME)) return uri;
  return webMemoryMedia.get(uri.slice(MEMORY_SCHEME.length)) ?? null;
}

/**
 * Met les médias à l'abri pour un envoi différé.
 *  - Natif : copie dans documentDirectory/offline_media (survit au redémarrage).
 *    Si la copie échoue, on conserve l'URI d'origine plutôt que de perdre la photo.
 *  - Web : référence en mémoire (voir webMemoryMedia).
 */
export async function persistMediaForOffline(media: MediaItem[]): Promise<MediaItem[]> {
  if (media.length === 0) return [];

  if (Platform.OS === 'web') {
    return media.map((item) => {
      const id = isUuid(item.id) ? item.id : generateUuid();
      webMemoryMedia.set(id, item.uri);
      return { id, uri: `${MEMORY_SCHEME}${id}`, type: item.type };
    });
  }

  let dirReady = true;
  try {
    const dirInfo = await FileSystem.getInfoAsync(OFFLINE_MEDIA_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(OFFLINE_MEDIA_DIR, { intermediates: true });
    }
  } catch (e) {
    console.warn('[Queue] Impossible de créer le dossier offline_media', e);
    dirReady = false;
  }

  const persisted: MediaItem[] = [];
  for (const item of media) {
    const id = isUuid(item.id) ? item.id : generateUuid();
    if (!dirReady) { persisted.push({ id, uri: item.uri, type: item.type }); continue; }
    try {
      // Conserver l'extension d'origine quand elle est connue (ex. .mov sur iOS) :
      // elle détermine le type MIME à l'envoi.
      const srcExt = item.uri.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
      const ext = KNOWN_MEDIA_EXT.has(srcExt) ? srcExt : item.type === 'video' ? 'mp4' : 'jpg';
      const destUri = `${OFFLINE_MEDIA_DIR}${id}.${ext}`;
      await FileSystem.copyAsync({ from: item.uri, to: destUri });
      persisted.push({ id, uri: destUri, type: item.type });
    } catch (e) {
      console.warn('[Queue] Copie du média impossible, URI d\'origine conservée', item.uri, e);
      persisted.push({ id, uri: item.uri, type: item.type });
    }
  }
  return persisted;
}

/** Le fichier local d'un média existe-t-il encore ? */
export async function localMediaExists(uri: string): Promise<boolean> {
  if (uri.startsWith(MEMORY_SCHEME)) return resolveMediaUri(uri) != null;
  if (Platform.OS === 'web') return true;
  try {
    return (await FileSystem.getInfoAsync(uri)).exists;
  } catch {
    return false;
  }
}

/** Supprime la copie locale d'un média (seulement celles créées par ce module). */
export async function deleteLocalMedia(uri: string): Promise<void> {
  if (uri.startsWith(MEMORY_SCHEME)) {
    webMemoryMedia.delete(uri.slice(MEMORY_SCHEME.length));
    return;
  }
  if (Platform.OS === 'web' || !uri.startsWith(OFFLINE_MEDIA_DIR)) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch { /* rien */ }
}
