import { AppState, type AppStateStatus } from 'react-native';

import { refreshCatches } from '@/lib/catchStore';
import { isStateConnected, mayReachNetwork, subscribeNetwork } from '@/lib/net';
import { getQueueSummary, subscribeQueue } from '@/lib/offlineQueue';
import { trySyncOfflineCatches, type SyncResult } from '@/lib/offlineSync';
import { getSessionUserId } from '@/lib/supabase';
import { syncLocalTripsToSupabase } from '@/lib/tripStorage';

// ─── Moteur de synchronisation ───────────────────────────────────────────────
//
// Décide QUAND synchroniser. (Le COMMENT est dans lib/offlineSync.ts.)
//
// Avant, la synchronisation n'était tentée qu'une fois, à l'instant précis où
// le téléphone signalait le retour du réseau — instant où l'accès internet
// n'est pas encore validé. La tentative échouait et rien ne la relançait.
//
// Maintenant, une synchronisation est demandée :
//   • quand l'état du réseau change (connexion OU accès internet validé) ;
//   • quand l'app revient au premier plan ;
//   • quand une prise est ajoutée à la file ;
//   • quand la session utilisateur devient disponible ;
//   • et, tant qu'il reste quelque chose à envoyer, à intervalles croissants
//     (15 s → 30 s → 1 min → 2 min → 5 min).
//
// La présence d'un réseau suffit pour tenter : chaque requête a son timeout.

export type SyncReason = 'start' | 'network' | 'foreground' | 'queue' | 'session' | 'retry' | 'manual';

export type EngineStatus = SyncResult['status'] | 'no-session';

export type EngineResult = Omit<SyncResult, 'status'> & { status: EngineStatus };

export type SyncEngineState = {
  running: boolean;
  lastResult: EngineResult | null;
  lastRunAt: number | null;
};

const RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000, 300_000];
const DEBOUNCE_MS = 400;

let sessionUserId: string | null = null;
let knownUserId: string | null = null;

let started = false;
let unsubscribers: (() => void)[] = [];

let runPromise: Promise<EngineResult> | null = null;
let rerunReason: SyncReason | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryIndex = 0;

let lastConnected: boolean | null = null;
let lastReachable: boolean | null | undefined;

let state: SyncEngineState = { running: false, lastResult: null, lastRunAt: null };
const listeners = new Set<() => void>();

function setState(patch: Partial<SyncEngineState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => {
    try { l(); } catch (e) { console.warn('[SyncEngine] listener error', e); }
  });
}

export function subscribeSyncEngine(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getSyncEngineState(): SyncEngineState {
  return state;
}

function clearRetry(): void {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
}

function scheduleRetry(): void {
  clearRetry();
  const delay = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)];
  retryIndex++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    requestSync('retry');
  }, delay);
}

function emptyResult(status: EngineStatus): EngineResult {
  return { status, synced: 0, mediaUploaded: 0, remaining: 0, blocked: 0, error: null };
}

async function runOnce(reason: SyncReason): Promise<EngineResult> {
  const userForQueue = sessionUserId ?? knownUserId;

  if (!(await mayReachNetwork())) {
    const summary = await getQueueSummary(userForQueue);
    return { ...emptyResult('offline'), remaining: summary.total, blocked: summary.blocked };
  }

  // Session pas encore restaurée (jeton expiré pendant la période hors-ligne) :
  // la demander déclenche son rafraîchissement, sans attendre le minuteur
  // interne de Supabase (30 s).
  let userId = sessionUserId;
  if (!userId && knownUserId) userId = await getSessionUserId(20_000);
  if (!userId) {
    const summary = await getQueueSummary(userForQueue);
    return { ...emptyResult('no-session'), remaining: summary.total, blocked: summary.blocked };
  }

  // Voyages : inutile à chaque prise ajoutée, utile à chaque « reprise »
  if (reason !== 'queue' && reason !== 'retry') {
    await syncLocalTripsToSupabase();
  }

  const result = await trySyncOfflineCatches(userId, { includeBlocked: reason === 'manual' });

  // Récupérer ce qui a changé côté serveur (autre appareil, édition web…).
  // Les prises envoyées à l'instant sont DÉJÀ dans le cache local : inutile de
  // tout retélécharger après chaque prise. Le magasin limite la fréquence, sauf
  // demande explicite de l'utilisateur.
  await refreshCatches({ force: reason === 'manual' });

  return result;
}

function run(reason: SyncReason): Promise<EngineResult> {
  if (runPromise) {
    // Un passage est en cours : on en refera un juste après (une prise a pu être
    // ajoutée après la lecture de la file).
    if (reason !== 'retry') rerunReason = reason;
    return runPromise;
  }

  clearRetry();
  setState({ running: true });

  const promise = runOnce(reason)
    .catch((e): EngineResult => {
      console.warn('[SyncEngine] Passage en erreur', e);
      return { ...emptyResult('interrupted'), error: String((e as Error)?.message ?? e) };
    })
    .then((result) => {
      runPromise = null;
      setState({ running: false, lastResult: result, lastRunAt: Date.now() });

      if (result.synced > 0 || result.mediaUploaded > 0) retryIndex = 0;

      const next = rerunReason;
      rerunReason = null;
      if (next) {
        requestSync(next);
      } else if (started && result.remaining - result.blocked > 0) {
        // Il reste des éléments envoyables : nouvel essai automatique.
        scheduleRetry();
      }
      return result;
    });
  runPromise = promise;
  return promise;
}

/** Demande une synchronisation (regroupée si plusieurs demandes arrivent ensemble). */
export function requestSync(reason: SyncReason): void {
  if (!started) return;
  if (reason !== 'retry') retryIndex = 0;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    run(reason).catch(() => undefined);
  }, DEBOUNCE_MS);
}

/** Synchronisation immédiate, sur demande de l'utilisateur. Retourne le résultat réel. */
export function syncNow(): Promise<EngineResult> {
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  retryIndex = 0;
  if (runPromise) {
    // Attendre le passage en cours, puis en refaire un complet (éléments bloqués inclus)
    return runPromise.then(() => run('manual'));
  }
  return run('manual');
}

/**
 * Identité connue du moteur.
 *  - sessionUserId : utilisateur d'une session VALIDE (peut écrire sur le serveur)
 *  - knownUserId   : dernier utilisateur connu sur l'appareil (session peut-être
 *                    expirée) — sert à tenter de restaurer la session.
 */
export function setSyncIdentity(nextSessionUserId: string | null, nextKnownUserId: string | null): void {
  const sessionArrived = nextSessionUserId != null && nextSessionUserId !== sessionUserId;
  sessionUserId = nextSessionUserId;
  knownUserId = nextKnownUserId ?? nextSessionUserId;
  if (sessionArrived) requestSync('session');
}

/** Démarre l'écoute du réseau, du premier plan et de la file. Retourne l'arrêt. */
export function startSyncEngine(): () => void {
  if (started) return stopSyncEngine;
  started = true;

  unsubscribers.push(
    subscribeNetwork((net) => {
      const connected = isStateConnected(net);
      const reachable = net.isInternetReachable;
      const changed = connected !== lastConnected || reachable !== lastReachable;
      lastConnected = connected;
      lastReachable = reachable;
      // Chaque changement d'état est une occasion : le réseau vient d'apparaître,
      // ou son accès internet vient d'être validé.
      if (changed && connected) requestSync('network');
    }),
  );

  const appStateSub = AppState.addEventListener('change', (status: AppStateStatus) => {
    if (status === 'active') requestSync('foreground');
  });
  unsubscribers.push(() => appStateSub.remove());

  unsubscribers.push(
    subscribeQueue((event) => {
      if (event === 'enqueue') requestSync('queue');
    }),
  );

  requestSync('start');
  return stopSyncEngine;
}

export function stopSyncEngine(): void {
  started = false;
  unsubscribers.forEach((u) => {
    try { u(); } catch { /* rien */ }
  });
  unsubscribers = [];
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  clearRetry();
  rerunReason = null;
  lastConnected = null;
  lastReachable = undefined;
}
