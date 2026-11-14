import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';

import { noteServerReachable, withTimeout } from '@/lib/net';

// Surchargeables par variables d'environnement (EXPO_PUBLIC_* est injecté au
// build). Les valeurs par défaut restent celles du projet de production : sans
// .env, l'app se comporte exactement comme avant.
export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://qgkwbjnqzhcesxtucrvt.supabase.co';
export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_Xz50Y3urEx41FUph_sD_rg_SEOo1LNm'; // clé anon publique

/**
 * Clé de stockage de la session. Identique à la valeur par défaut de
 * supabase-js (`sb-<premier label de l'hôte>-auth-token`) pour que les
 * utilisateurs déjà connectés le restent — mais fixée explicitement ici pour
 * pouvoir lire la session locale SANS passer par le client (voir
 * readStoredAuthUser).
 */
function projectRef(url: string): string {
  const match = url.match(/^https?:\/\/([^/.:]+)/i);
  return match ? match[1] : 'pechelog';
}
export const AUTH_STORAGE_KEY = `sb-${projectRef(SUPABASE_URL)}-auth-token`;

/** localStorage avec garde SSR (pas de window en Node lors du rendu statique / build). */
const webAuthStorage = {
  getItem: (key: string) => {
    if (typeof window === 'undefined') return Promise.resolve(null);
    return Promise.resolve(window.localStorage.getItem(key));
  },
  setItem: (key: string, value: string) => {
    if (typeof window === 'undefined') return Promise.resolve();
    window.localStorage.setItem(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    if (typeof window === 'undefined') return Promise.resolve();
    window.localStorage.removeItem(key);
    return Promise.resolve();
  },
};

const authStorage = Platform.OS === 'web' ? webAuthStorage : AsyncStorage;

// ─── fetch borné + garde d'authentification ──────────────────────────────────
//
// 1) TIMEOUT. supabase-js n'en met aucun : sur Android avec 1 barre de signal,
//    une requête peut rester suspendue plusieurs minutes — et avec elle tout
//    écran qui l'attend. Ici CHAQUE requête Supabase est abandonnée après un
//    délai fixe.
//
// 2) GARDE « SESSION ABSENTE ». Quand le jeton est expiré et que son
//    rafraîchissement échoue, supabase-js envoie quand même la requête avec la
//    clé anonyme. Le RLS répond alors « 0 ligne » SANS erreur : l'app croirait
//    que l'utilisateur n'a aucune prise et écraserait son cache local. On
//    refuse donc localement toute requête de données non authentifiée : elle
//    échoue proprement et le cache reste intact.

const AUTH_TIMEOUT_MS = 15_000;
const DATA_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 120_000;

/** Erreur levée par la garde : aucune session utilisateur pour cette requête. */
export const SESSION_MISSING_MESSAGE = 'SESSION_MISSING';

function readAuthorization(headers: RequestInit['headers']): string | null {
  if (!headers) return null;
  try {
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      return headers.get('Authorization');
    }
    if (Array.isArray(headers)) {
      const found = headers.find(([k]) => k.toLowerCase() === 'authorization');
      return found ? found[1] : null;
    }
    const record = headers as Record<string, string>;
    const key = Object.keys(record).find((k) => k.toLowerCase() === 'authorization');
    return key ? record[key] : null;
  } catch {
    return null;
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (typeof URL !== 'undefined' && input instanceof URL) return input.toString();
  return (input as Request).url ?? String(input);
}

export async function supabaseFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = requestUrl(input);
  const method = (init.method ?? 'GET').toUpperCase();

  const isAuth = url.includes('/auth/v1/');
  const isStorage = url.includes('/storage/v1/');
  const isData = url.includes('/rest/v1/') || (isStorage && !url.includes('/object/public/'));

  if (isData) {
    const authorization = readAuthorization(init.headers);
    if (!authorization || authorization === `Bearer ${SUPABASE_ANON_KEY}`) {
      throw new Error(SESSION_MISSING_MESSAGE);
    }
  }

  const timeoutMs = isAuth
    ? AUTH_TIMEOUT_MS
    : isStorage && method !== 'GET'
      ? UPLOAD_TIMEOUT_MS
      : DATA_TIMEOUT_MS;

  // Le signal de l'appelant (abortSignal de PostgREST) reste respecté : les deux
  // sources d'annulation sont fusionnées dans un seul contrôleur.
  const controller = new AbortController();
  const outer = init.signal;
  const onOuterAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onOuterAbort);
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input as RequestInfo, { ...init, signal: controller.signal });
    // Une réponse — même 4xx/5xx — prouve que le réseau fonctionne.
    noteServerReachable();
    return response;
  } finally {
    clearTimeout(timer);
    if (outer) outer.removeEventListener('abort', onOuterAbort);
  }
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: authStorage,
    storageKey: AUTH_STORAGE_KEY,
    autoRefreshToken: true,
    persistSession: true,
    // detectSessionInUrl : Supabase scrute l'URL pour #access_token (implicit flow).
    // Sur web, c'est utile. Sur mobile, l'URL n'est pas accessible donc on désactive.
    detectSessionInUrl: Platform.OS === 'web',
  },
  global: { fetch: supabaseFetch },
});

console.log('[Supabase] Client initialisé', {
  platform: Platform.OS,
  url: SUPABASE_URL,
  detectSessionInUrl: Platform.OS === 'web',
});

// ─── Identité locale (aucun accès réseau) ────────────────────────────────────

export type StoredAuthUser = { id: string; email: string | null };

/**
 * Lit l'utilisateur de la session persistée, directement dans le stockage.
 *
 * NE PAS remplacer par supabase.auth.getSession() : quand le jeton d'accès
 * (durée de vie 1 h) est expiré, getSession() tente un rafraîchissement réseau
 * avec ~30 s de réessais avant de répondre. Hors-ligne, l'app resterait figée.
 * Cette lecture-ci est purement locale et instantanée.
 */
export async function readStoredAuthUser(): Promise<StoredAuthUser | null> {
  try {
    const raw = await authStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user?: { id?: string; email?: string | null } } | null;
    const id = parsed?.user?.id;
    if (typeof id !== 'string' || id.length === 0) return null;
    return { id, email: parsed?.user?.email ?? null };
  } catch {
    return null;
  }
}

/** Supprime la session persistée (déconnexion locale garantie, même hors-ligne). */
export async function clearStoredAuthSession(): Promise<void> {
  try {
    await authStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    /* rien */
  }
}

/**
 * ID de l'utilisateur de la session ACTIVE (jeton valide), ou null.
 * Peut déclencher un rafraîchissement réseau du jeton → toujours borné par un
 * timeout. À n'appeler que lorsqu'un réseau est présent.
 */
export async function getSessionUserId(timeoutMs = 8000): Promise<string | null> {
  try {
    const { data } = await withTimeout(supabase.auth.getSession(), timeoutMs, 'getSession');
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}
