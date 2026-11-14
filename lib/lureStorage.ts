import AsyncStorage from '@react-native-async-storage/async-storage';

import { isNetworkError, isOnline, withTimeout } from '@/lib/net';
import { generateUuid } from '@/lib/uuid';
import { SESSION_MISSING_MESSAGE, supabase } from './supabase';

// ─── Leurres personnels : cache local + Supabase ─────────────────────────────
//
// Le sélecteur de leurre doit fonctionner sur l'eau, sans réseau :
//  • la liste vient du cache local, mise à jour quand le serveur répond ;
//  • un échec réseau ne modifie JAMAIS le cache (avant, il était remplacé par
//    une liste vide : plus aucun leurre n'était proposé hors-ligne) ;
//  • un leurre créé sans réseau est gardé localement (`pending`) et envoyé plus
//    tard. Son UUID est créé sur l'appareil : l'envoi peut être rejoué sans
//    créer de doublon.

export type UserLure = {
  id: string;
  user_id: string;
  name: string;
  size: string | null;
  color: string | null;
  notes: string | null;
  photo_url: string | null;
  created_at: string;
  /** Local uniquement : créé hors-ligne, pas encore envoyé au serveur. */
  pending?: boolean;
};

type LureInput = {
  name: string;
  size: string | null;
  color: string | null;
  notes: string | null;
  photo_url?: string | null;
};

const LURE_COLUMNS = 'id, user_id, name, size, color, notes, photo_url, created_at';
const REQUEST_TIMEOUT_MS = 10_000;

const cacheKey = (userId: string) => `user_lures_cache_${userId}`;

const byName = (a: UserLure, b: UserLure) => a.name.localeCompare(b.name);

export async function getCachedLures(userId: string): Promise<UserLure[]> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(userId));
    return raw ? (JSON.parse(raw) as UserLure[]) : [];
  } catch {
    return [];
  }
}

export async function setCachedLures(userId: string, lures: UserLure[]): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKey(userId), JSON.stringify(lures));
  } catch {}
}

/** Liste du serveur, ou null si elle n'a pas pu être obtenue (≠ liste vide). */
async function fetchUserLures(userId: string): Promise<UserLure[] | null> {
  try {
    const { data, error } = await withTimeout(
      supabase.from('user_lures').select(LURE_COLUMNS).eq('user_id', userId).order('name'),
      REQUEST_TIMEOUT_MS,
      'user_lures',
    );
    if (error || !data) return null;
    return data as UserLure[];
  } catch {
    return null;
  }
}

/** Compatibilité : liste du serveur, vide en cas d'échec. Préférer loadLuresWithCache. */
export async function loadUserLures(userId: string): Promise<UserLure[]> {
  return (await fetchUserLures(userId)) ?? [];
}

/** Envoie les leurres créés hors-ligne. Retourne true s'il n'en reste aucun. */
export async function syncPendingLures(userId: string): Promise<boolean> {
  const cached = await getCachedLures(userId);
  const pending = cached.filter((l) => l.pending);
  if (pending.length === 0) return true;

  const sent = new Set<string>();
  for (const lure of pending) {
    try {
      const { error } = await withTimeout(
        supabase.from('user_lures').insert({
          id: lure.id,
          user_id: userId,
          name: lure.name,
          size: lure.size,
          color: lure.color,
          notes: lure.notes,
          photo_url: lure.photo_url,
        }),
        REQUEST_TIMEOUT_MS,
        'user_lures insert',
      );
      // 23505 = déjà présent (envoi précédent dont la réponse s'était perdue)
      if (!error || error.code === '23505') sent.add(lure.id);
      else if (isNetworkError(error) || error.message?.includes(SESSION_MISSING_MESSAGE)) break;
    } catch {
      break; // réseau indisponible : inutile d'essayer les suivants
    }
  }

  if (sent.size > 0) {
    // Relire le cache : il a pu changer pendant les envois
    const latest = await getCachedLures(userId);
    await setCachedLures(
      userId,
      latest.map((l) => (sent.has(l.id) ? { ...l, pending: undefined } : l)),
    );
  }
  return sent.size === pending.length;
}

/**
 * Leurres de l'utilisateur. Répond avec le cache local dès que le serveur ne
 * peut pas être joint ; sinon met le cache à jour (en conservant les leurres
 * créés hors-ligne pas encore envoyés).
 */
export async function loadLuresWithCache(userId: string): Promise<UserLure[]> {
  if (!(await isOnline())) return getCachedLures(userId);

  await syncPendingLures(userId).catch(() => false);

  const remote = await fetchUserLures(userId);
  const cached = await getCachedLures(userId);
  if (!remote) return cached;

  const remoteIds = new Set(remote.map((l) => l.id));
  const stillPending = cached.filter((l) => l.pending && !remoteIds.has(l.id));
  const merged = [...remote, ...stillPending].sort(byName);
  await setCachedLures(userId, merged);
  return merged;
}

/**
 * Fournit la liste en deux temps : le cache local tout de suite, puis la
 * version à jour si le serveur répond. À utiliser dans les écrans — la liste
 * est disponible immédiatement, même avec un signal faible.
 * Retourne une fonction d'annulation.
 */
export function watchLures(userId: string, onUpdate: (lures: UserLure[]) => void): () => void {
  let cancelled = false;
  let freshDelivered = false;
  getCachedLures(userId)
    .then((cached) => { if (!cancelled && !freshDelivered) onUpdate(cached); })
    .catch(() => undefined);
  loadLuresWithCache(userId)
    .then((fresh) => {
      if (cancelled) return;
      freshDelivered = true;
      onUpdate(fresh);
    })
    .catch(() => undefined);
  return () => { cancelled = true; };
}

/**
 * Crée un leurre. Sans réseau, il est enregistré localement et utilisable tout
 * de suite ; il sera envoyé plus tard. Retourne null seulement si le serveur a
 * explicitement refusé la création.
 */
export async function createUserLure(userId: string, input: LureInput): Promise<UserLure | null> {
  const id = generateUuid();
  const row = { id, user_id: userId, ...input, photo_url: input.photo_url ?? null };

  if (await isOnline()) {
    try {
      const { data, error } = await withTimeout(
        supabase.from('user_lures').insert(row).select(LURE_COLUMNS).single(),
        REQUEST_TIMEOUT_MS,
        'createUserLure',
      );
      if (!error && data) return data as UserLure;
      const transient =
        !error || isNetworkError(error) || error.message?.includes(SESSION_MISSING_MESSAGE);
      if (!transient) return null; // refus explicite du serveur
    } catch {
      /* timeout / réseau : on bascule sur la création locale */
    }
  }

  const local: UserLure = { ...row, created_at: new Date().toISOString(), pending: true };
  const cached = await getCachedLures(userId);
  await setCachedLures(userId, [...cached.filter((l) => l.id !== id), local].sort(byName));
  return local;
}

export async function updateUserLure(id: string, input: Partial<LureInput>): Promise<boolean> {
  try {
    const { error } = await withTimeout(
      supabase
        .from('user_lures')
        .update({ ...input, updated_at: new Date().toISOString() })
        .eq('id', id),
      REQUEST_TIMEOUT_MS,
      'updateUserLure',
    );
    return !error;
  } catch {
    return false;
  }
}

export async function deleteUserLure(id: string): Promise<boolean> {
  try {
    const { error } = await withTimeout(
      supabase.from('user_lures').delete().eq('id', id),
      REQUEST_TIMEOUT_MS,
      'deleteUserLure',
    );
    return !error;
  } catch {
    return false;
  }
}
