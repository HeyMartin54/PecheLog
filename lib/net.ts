import NetInfo from '@react-native-community/netinfo';

// ─── Helpers réseau partagés ──────────────────────────────────────────────────
// Sur Android, un fetch sans timeout peut bloquer plusieurs minutes avec un
// signal faible (1 barre). Tous les appels réseau de l'app doivent passer par
// ces helpers pour garantir une expérience fluide hors-ligne / signal faible.

/** Vérifie l'état réseau actuel (instantané, pas de requête réseau). */
export async function isOnline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    // isInternetReachable peut être null (inconnu) → on ne bloque que si false
    return state.isConnected === true && state.isInternetReachable !== false;
  } catch {
    // En cas de doute, on tente la requête (elle a son propre timeout)
    return true;
  }
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
