import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

// ─── Helpers réseau partagés ──────────────────────────────────────────────────
// Sur Android, un fetch sans timeout peut bloquer plusieurs minutes avec un
// signal faible (1 barre). Tous les appels réseau de l'app doivent passer par
// ces helpers pour garantir une expérience fluide hors-ligne / signal faible.
//
// Deux notions DISTINCTES — ne pas les confondre :
//
//  • isOnline()      « internet semble utilisable » (connecté ET joignable).
//                    Sert à décider d'un enrichissement facultatif (météo,
//                    géocodage) ou d'une action qui exige le réseau (zones).
//
//  • mayReachNetwork() « un réseau est présent » (connecté, joignable ou non).
//                    Sert au moteur de synchronisation : on TENTE quand même,
//                    chaque requête étant bornée par un timeout. La joignabilité
//                    rapportée par l'OS peut être fausse (réseau qui bloque la
//                    sonde de Google) ou en retard de quelques secondes au
//                    retour du signal — s'y fier bloquerait la synchronisation.

/** Fenêtre pendant laquelle une réponse du serveur prouve que le réseau fonctionne. */
const SERVER_CONTACT_TTL_MS = 2 * 60 * 1000;

let lastServerContactAt = 0;

/**
 * À appeler quand le serveur a répondu (peu importe le code HTTP) : preuve
 * directe de connectivité, plus fiable que la sonde de l'OS.
 */
export function noteServerReachable(): void {
  lastServerContactAt = Date.now();
}

/** Test seulement : réinitialise la preuve de connectivité. */
export function resetServerReachable(): void {
  lastServerContactAt = 0;
}

type NetLike = Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>;

/** « Internet semble utilisable » à partir d'un état NetInfo. */
export function isStateOnline(state: NetLike): boolean {
  if (state.isConnected !== true) return false;
  // isInternetReachable peut être null (inconnu) → on ne bloque que si false…
  if (state.isInternetReachable !== false) return true;
  // …sauf si le serveur vient de nous répondre : la sonde de l'OS se trompe.
  return Date.now() - lastServerContactAt < SERVER_CONTACT_TTL_MS;
}

/** « Un réseau est présent » (même si l'OS ne l'a pas encore validé). */
export function isStateConnected(state: NetLike): boolean {
  return state.isConnected !== false;
}

/** Vérifie l'état réseau actuel (instantané, pas de requête réseau). */
export async function isOnline(): Promise<boolean> {
  try {
    return isStateOnline(await NetInfo.fetch());
  } catch {
    // En cas de doute, on tente la requête (elle a son propre timeout)
    return true;
  }
}

/**
 * Un réseau est-il présent ? Utilisé par la synchronisation : on tente dès
 * qu'un réseau existe, sans attendre que l'OS l'ait déclaré « joignable ».
 */
export async function mayReachNetwork(): Promise<boolean> {
  try {
    return isStateConnected(await NetInfo.fetch());
  } catch {
    return true;
  }
}

/**
 * S'abonne aux changements réseau. Le listener reçoit l'état brut : chaque
 * changement (connexion OU joignabilité) est une occasion de relancer la sync.
 */
export function subscribeNetwork(listener: (state: NetInfoState) => void): () => void {
  return NetInfo.addEventListener(listener);
}

/** Rejette la promesse après `ms` millisecondes. */
export function withTimeout<T>(promise: Promise<T> | PromiseLike<T>, ms: number, label = 'opération'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout ${label} (${ms} ms)`)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** fetch avec annulation réelle après `timeoutMs` (la requête est abandonnée, pas juste ignorée). */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Une erreur est-elle « réseau » (transitoire : réessayer plus tard) plutôt
 * qu'un refus du serveur (définitif pour ces données) ?
 * Accepte une Error, un objet d'erreur PostgREST/Storage ou une chaîne.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false;
  const e = error as { name?: string; message?: string; code?: string; status?: number };
  const text = `${e.name ?? ''} ${e.message ?? ''} ${typeof error === 'string' ? error : ''}`.toLowerCase();
  if (e.name === 'AbortError') return true;
  return (
    text.includes('network request failed') ||
    text.includes('failed to fetch') ||
    text.includes('networkerror') ||
    text.includes('load failed') ||
    text.includes('aborted') ||
    text.includes('abort') ||
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('fetcherror') ||
    text.includes('typeerror: fetch')
  );
}
