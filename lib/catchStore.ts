import {
  CATCH_SELECT_ALL,
  getCacheDate,
  loadCatchesCache,
  saveCatchesCache,
  type CachedCatch,
} from '@/lib/catchCache';
import { mayReachNetwork } from '@/lib/net';
import { getQueue, queueItemToCatch, subscribeQueue } from '@/lib/offlineQueue';
import { getSessionUserId, supabase } from '@/lib/supabase';

// ─── Magasin local des prises (source unique pour TOUS les écrans) ───────────
//
// Avant : chaque écran (accueil, carte, stats, détail) interrogeait Supabase
// lui-même et ne lisait le cache qu'en dernier recours. Avec un signal faible,
// la requête restait suspendue et l'écran restait vide.
//
// Maintenant : les écrans lisent ce magasin, qui répond TOUJOURS immédiatement
// avec les données locales :
//
//      prises affichées = cache du serveur  +  prises en file d'attente
//
// Le serveur n'est consulté qu'en arrière-plan ; s'il répond, le cache est mis
// à jour et les écrans abonnés se rafraîchissent. S'il ne répond pas, rien ne
// change à l'écran.

export type CatchStoreSnapshot = {
  userId: string | null;
  /** Prises en attente + prises du serveur, de la plus récente à la plus ancienne. */
  catches: CachedCatch[];
  /** Nombre de prises pas encore confirmées par le serveur. */
  pendingCount: number;
  /** La lecture locale (cache + file) est terminée. */
  hydrated: boolean;
  /** Une requête serveur est en cours (en arrière-plan). */
  refreshing: boolean;
  /**
   * 'server' : la dernière tentative de rafraîchissement a réussi pendant cette
   * session. 'cache' : on affiche ce qui est stocké sur l'appareil.
   */
  source: 'server' | 'cache';
  lastServerSyncAt: number | null;
};

const EMPTY: CachedCatch[] = [];

let userId: string | null = null;
let server: CachedCatch[] = EMPTY;
let pending: CachedCatch[] = EMPTY;
let hydrated = false;
let refreshing = false;
let source: 'server' | 'cache' = 'cache';
let lastServerSyncAt: number | null = null;

let snapshot: CatchStoreSnapshot = buildSnapshot();
const listeners = new Set<() => void>();

let hydratePromise: Promise<void> | null = null;
let refreshPromise: Promise<boolean> | null = null;
/** Date de la dernière requête réellement envoyée au serveur (succès ou échec). */
let lastRefreshAttemptAt = 0;

/** Délai minimal entre deux rafraîchissements non forcés (changement d'onglet…). */
const MIN_REFRESH_INTERVAL_MS = 20_000;
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

/**
 * Prises tout juste synchronisées : conservées quelques minutes pour qu'une
 * réponse serveur partie AVANT leur insertion ne les fasse pas disparaître.
 */
const recentlySynced = new Map<string, { row: CachedCatch; at: number }>();
const RECENT_TTL_MS = 3 * 60 * 1000;

// ─── Fusion et instantané ────────────────────────────────────────────────────

function sortByDateDesc(list: CachedCatch[]): CachedCatch[] {
  return list
    .map((c) => ({ c, t: Date.parse(c.caught_at) || 0 }))
    .sort((a, b) => b.t - a.t)
    .map((x) => x.c);
}

function buildSnapshot(): CatchStoreSnapshot {
  const serverIds = new Set(server.map((c) => c.id));
  // Une prise déjà sur le serveur n'est plus « en attente », même si son entrée
  // de file n'a pas encore été retirée (médias restants).
  const stillPending = pending.filter((p) => !serverIds.has(p.id));
  return {
    userId,
    catches: stillPending.length === 0 ? server : sortByDateDesc([...stillPending, ...server]),
    pendingCount: stillPending.length,
    hydrated,
    refreshing,
    source,
    lastServerSyncAt,
  };
}

function emit(): void {
  snapshot = buildSnapshot();
  listeners.forEach((l) => {
    try { l(); } catch (e) { console.warn('[CatchStore] listener error', e); }
  });
}

export function subscribeCatchStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Instantané courant — référence stable tant que rien ne change (useSyncExternalStore). */
export function getCatchStoreSnapshot(): CatchStoreSnapshot {
  return snapshot;
}

export function getCatchById(id: string): CachedCatch | null {
  return snapshot.catches.find((c) => c.id === id) ?? null;
}

// ─── Chargement local ────────────────────────────────────────────────────────

async function loadPending(forUser: string): Promise<CachedCatch[]> {
  const queue = await getQueue();
  return queue
    .filter((i) => i.payload.user_id === forUser && !i.catchSynced)
    .map(queueItemToCatch);
}

async function hydrate(forUser: string): Promise<void> {
  const [cached, cacheDate, queued] = await Promise.all([
    loadCatchesCache(forUser),
    getCacheDate(forUser),
    loadPending(forUser),
  ]);
  if (userId !== forUser) return; // l'utilisateur a changé entre-temps
  // Ne pas écraser un résultat serveur arrivé pendant la lecture du disque.
  if (source !== 'server') {
    server = cached ? sortByDateDesc(cached.filter((c) => !c.pending)) : EMPTY;
    lastServerSyncAt = cacheDate ? cacheDate.getTime() : null;
  }
  pending = queued;
  hydrated = true;
  emit();
}

/**
 * Définit l'utilisateur dont on affiche les prises et charge ses données
 * locales. Sans effet si c'est déjà l'utilisateur courant.
 */
export function setCatchStoreUser(nextUserId: string | null): Promise<void> {
  if (nextUserId === userId) return hydratePromise ?? Promise.resolve();

  userId = nextUserId;
  server = EMPTY;
  pending = EMPTY;
  hydrated = false;
  refreshing = false;
  source = 'cache';
  lastServerSyncAt = null;
  lastRefreshAttemptAt = 0;
  refreshPromise = null;
  recentlySynced.clear();
  emit();

  if (!nextUserId) {
    hydratePromise = null;
    return Promise.resolve();
  }
  const promise = hydrate(nextUserId).catch((e) => {
    console.warn('[CatchStore] Lecture locale impossible', e);
    if (userId === nextUserId) { hydrated = true; emit(); }
  });
  hydratePromise = promise;
  return promise;
}

// La file change (saisie, synchronisation, suppression) → recalculer « en attente ».
subscribeQueue(() => {
  const forUser = userId;
  if (!forUser) return;
  loadPending(forUser)
    .then((queued) => {
      if (userId !== forUser) return;
      pending = queued;
      emit();
    })
    .catch(() => undefined);
});

// ─── Rafraîchissement depuis le serveur (arrière-plan) ───────────────────────

async function fetchAllFromServer(forUser: string): Promise<CachedCatch[] | null> {
  const all: CachedCatch[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from('catches')
      .select(CATCH_SELECT_ALL)
      .eq('user_id', forUser)
      .order('caught_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error || !data) {
      console.warn('[CatchStore] Rafraîchissement refusé', error?.message ?? 'réponse vide');
      return null;
    }
    const rows = data as unknown as CachedCatch[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

async function doRefresh(forUser: string): Promise<boolean> {
  if (!(await mayReachNetwork())) return false;

  // Sans session valide pour CET utilisateur, la requête serait refusée (ou,
  // pire, répondrait « aucune prise »). On ne touche alors à rien.
  const sessionUser = await getSessionUserId(20_000);
  if (sessionUser !== forUser) return false;

  // Le délai anti-rafale ne compte qu'à partir d'une vraie requête : une
  // tentative abandonnée faute de réseau ou de session ne doit pas retarder la
  // suivante (ex. session restaurée 2 s après l'ouverture de l'écran).
  lastRefreshAttemptAt = Date.now();
  const rows = await fetchAllFromServer(forUser);
  if (userId !== forUser) return false;
  if (!rows) {
    if (source !== 'cache') { source = 'cache'; }
    return false;
  }

  // Réinjecter les prises synchronisées pendant que la requête était en vol.
  const now = Date.now();
  const ids = new Set(rows.map((r) => r.id));
  const extra: CachedCatch[] = [];
  recentlySynced.forEach((entry, id) => {
    if (now - entry.at > RECENT_TTL_MS) recentlySynced.delete(id);
    else if (!ids.has(id)) extra.push(entry.row);
  });

  server = sortByDateDesc(extra.length > 0 ? [...extra, ...rows] : rows);
  source = 'server';
  lastServerSyncAt = now;
  await saveCatchesCache(forUser, server, now);
  return true;
}

/**
 * Demande une mise à jour depuis le serveur. Ne bloque jamais l'affichage :
 * les écrans montrent déjà les données locales. Retourne true si le serveur a
 * répondu. Les appels concurrents partagent la même requête ; les appels
 * rapprochés non forcés sont ignorés.
 */
export function refreshCatches(options: { force?: boolean } = {}): Promise<boolean> {
  const forUser = userId;
  if (!forUser) return Promise.resolve(false);
  if (refreshPromise) return refreshPromise;
  if (!options.force && Date.now() - lastRefreshAttemptAt < MIN_REFRESH_INTERVAL_MS) {
    return Promise.resolve(false);
  }

  refreshing = true;
  emit();

  const promise = doRefresh(forUser)
    .catch((e) => {
      console.warn('[CatchStore] Rafraîchissement impossible', e);
      if (userId === forUser) source = 'cache';
      return false;
    })
    .finally(() => {
      if (refreshPromise === promise) refreshPromise = null;
      if (userId === forUser) {
        refreshing = false;
        emit();
      }
    });
  refreshPromise = promise;
  return promise;
}

// ─── Mises à jour locales après une écriture réussie ─────────────────────────

function persist(): void {
  const forUser = userId;
  if (!forUser) return;
  saveCatchesCache(forUser, server).catch(() => undefined);
}

/**
 * Une prise vient d'être confirmée par le serveur (synchronisation, édition,
 * duplication) : on la place tout de suite dans le cache, sans attendre le
 * prochain rafraîchissement complet.
 */
export function applyServerCatch(row: CachedCatch, forUser: string | null = userId): void {
  if (!forUser || forUser !== userId) return;
  const clean: CachedCatch = { ...row, pending: undefined, sync_error: undefined, pending_media: undefined };
  recentlySynced.set(clean.id, { row: clean, at: Date.now() });
  server = sortByDateDesc([clean, ...server.filter((c) => c.id !== clean.id)]);
  persist();
  emit();
}

/** Une prise a été supprimée sur le serveur : on la retire du cache local. */
export function removeLocalCatch(id: string): void {
  if (!userId) return;
  recentlySynced.delete(id);
  if (!server.some((c) => c.id === id)) return;
  server = server.filter((c) => c.id !== id);
  persist();
  emit();
}

/** Tests seulement : remet le magasin à zéro. */
export function resetCatchStoreForTests(): void {
  userId = null;
  server = EMPTY;
  pending = EMPTY;
  hydrated = false;
  refreshing = false;
  source = 'cache';
  lastServerSyncAt = null;
  lastRefreshAttemptAt = 0;
  refreshPromise = null;
  hydratePromise = null;
  recentlySynced.clear();
  snapshot = buildSnapshot();
}
