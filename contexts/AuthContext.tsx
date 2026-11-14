import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { Session, User, AuthError } from '@supabase/supabase-js';

import { withTimeout } from '@/lib/net';
import { clearStoredAuthSession, readStoredAuthUser, supabase } from '@/lib/supabase';

const CACHED_USER_ID_KEY = '@pechelog_cached_user_id';
const CACHED_USER_EMAIL_KEY = '@pechelog_cached_user_email';

// Ferme le navigateur OAuth si l'app est rouverte depuis un redirect (web uniquement)
WebBrowser.maybeCompleteAuthSession();

// ── Logger structuré Auth ─────────────────────────────────────────────────────
function ts() {
  return new Date().toISOString().slice(11, 23); // HH:mm:ss.mmm
}
export const authLog = {
  info:  (step: string, data?: unknown) => data !== undefined ? console.log(`[Auth ${ts()}] ✓ ${step}`, data)  : console.log(`[Auth ${ts()}] ✓ ${step}`),
  warn:  (step: string, data?: unknown) => data !== undefined ? console.warn(`[Auth ${ts()}] ⚠ ${step}`, data) : console.warn(`[Auth ${ts()}] ⚠ ${step}`),
  error: (step: string, data?: unknown) => data !== undefined ? console.error(`[Auth ${ts()}] ✗ ${step}`, data) : console.error(`[Auth ${ts()}] ✗ ${step}`),
};

/**
 * État de la session, du point de vue de l'utilisateur :
 *  - loading   : lecture de l'identité locale en cours (quelques ms)
 *  - active    : session valide — lecture/écriture serveur possibles
 *  - restoring : utilisateur connu, jeton expiré pas encore rafraîchi (typique
 *                hors-ligne). L'app est pleinement utilisable en local ; la
 *                session reviendra d'elle-même avec le réseau.
 *  - expired   : utilisateur connu mais session définitivement perdue (jeton
 *                révoqué). L'app reste utilisable en local ; il faudra se
 *                reconnecter pour synchroniser.
 *  - signedOut : personne n'est connecté sur cet appareil → écran de login.
 */
export type SessionStatus = 'loading' | 'active' | 'restoring' | 'expired' | 'signedOut';

type AuthContextType = {
  session: Session | null;
  user: User | null;
  initializing: boolean;
  /**
   * Dernier utilisateur connu sur cet appareil. Disponible SANS réseau et sans
   * session valide : c'est lui qui donne accès aux données locales (cache, file
   * d'attente). Effacé uniquement par une déconnexion explicite.
   */
  cachedUserId: string | null;
  cachedEmail: string | null;
  sessionStatus: SessionStatus;
  signInWithGoogle: () => Promise<AuthError | null>;
  signInWithFacebook: () => Promise<AuthError | null>;
  signInWithApple: () => Promise<AuthError | null>;
  signInWithEmail: (email: string, password: string) => Promise<AuthError | null>;
  signOut: () => Promise<AuthError | null>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ── Échange le callback OAuth contre une session Supabase ────────────────────
// Supporte le PKCE flow (?code=) et l'implicit flow (#access_token=).
// Ne fait rien si l'URL n'est pas un callback OAuth.
async function handleOAuthCallback(url: string): Promise<void> {
  authLog.info('handleOAuthCallback appelé', { url: url.slice(0, 80) + (url.length > 80 ? '…' : '') });

  // Extraire ?code= (PKCE flow)
  let code: string | null = null;
  try {
    // Utiliser URL natif si disponible (web), sinon parser manuellement
    if (typeof URL !== 'undefined') {
      const parsed = new URL(url);
      code = parsed.searchParams.get('code');
    } else {
      // Fallback : chercher code= dans la query string
      const match = url.match(/[?&]code=([^&]+)/);
      code = match ? decodeURIComponent(match[1]) : null;
    }
  } catch {
    authLog.warn('Impossible de parser l\'URL OAuth', { url });
  }

  if (code) {
    authLog.info('PKCE flow — échange du code', { codePrefix: code.slice(0, 20) + '…' });
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        authLog.error('exchangeCodeForSession échoué', { message: error.message, status: error.status });
      } else {
        authLog.info('exchangeCodeForSession réussi — session établie');
      }
    } catch (err) {
      authLog.error('Exception dans exchangeCodeForSession', err);
    }
    return;
  }

  // Implicit flow : tokens dans le fragment (#access_token=...)
  let hash = '';
  try {
    hash = url.split('#')[1] ?? '';
  } catch { /* rien */ }

  if (hash) {
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    if (accessToken && refreshToken) {
      authLog.info('Implicit flow — setSession avec tokens du hash');
      try {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (error) {
          authLog.error('setSession échoué', { message: error.message });
        } else {
          authLog.info('setSession réussi — session établie');
        }
      } catch (err) {
        authLog.error('Exception dans setSession', err);
      }
      return;
    }

    // Vérifier si Supabase a renvoyé une erreur OAuth dans le fragment
    const oauthError = params.get('error');
    const oauthErrorDesc = params.get('error_description');
    if (oauthError) {
      authLog.error('Erreur OAuth dans le fragment', { error: oauthError, description: oauthErrorDesc });
      return;
    }
  }

  authLog.warn('handleOAuthCallback — aucun code ni token trouvé dans l\'URL', { url });
}

// ── Lancement du flow OAuth ──────────────────────────────────────────────────
async function openOAuth(provider: 'google' | 'facebook' | 'apple'): Promise<AuthError | null> {
  authLog.info(`openOAuth start`, { provider, platform: Platform.OS });

  // ── Web ────────────────────────────────────────────────────────────────────
  if (Platform.OS === 'web') {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const redirectTo = `${origin}/auth/callback`;
    authLog.info('OAuth web — redirect URL', { redirectTo });

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    });

    if (error) {
      authLog.error(`signInWithOAuth web échoué (${provider})`, { message: error.message, status: error.status });
    } else {
      authLog.info(`signInWithOAuth web OK — redirection navigateur en cours (${provider})`);
    }

    return error ?? null;
  }

  // ── Mobile (iOS / Android) ─────────────────────────────────────────────────
  // redirectTo doit correspondre exactement à l'URL configurée dans Supabase
  // Authentication → URL Configuration → Redirect URLs.
  // Sur iOS/Android Expo Go : exp://... | Build standalone : pechelog://
  const redirectTo = Linking.createURL('/');
  authLog.info('OAuth mobile — redirect URL', { redirectTo });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });

  if (error) {
    authLog.error(`signInWithOAuth mobile échoué (${provider})`, { message: error.message, status: error.status });
    return error;
  }

  if (!data?.url) {
    authLog.error(`Aucune URL OAuth retournée par Supabase (${provider})`);
    return { message: 'Aucune URL OAuth retournée. Vérifie la configuration Supabase.', name: 'OAuthError', status: 500 } as unknown as AuthError;
  }

  authLog.info(`Ouverture navigateur OAuth (${provider})`, { oauthUrlPrefix: data.url.slice(0, 60) + '…' });

  // openAuthSessionAsync (recommandé pour OAuth) :
  //   - iOS : ASWebAuthenticationSession — intercepte la redirect URL nativement
  //   - Android : Chrome Custom Tabs — retourne l'URL de redirect au code
  // Contrairement à openBrowserAsync, le navigateur se ferme automatiquement
  // dès que Google redirige vers pechelog:// et l'URL est retournée ici.
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  authLog.info(`Navigateur OAuth fermé (${provider})`, { type: result.type });

  if (result.type === 'success') {
    const callbackUrl = (result as { type: 'success'; url: string }).url;
    authLog.info(`Callback URL reçue`, { url: callbackUrl.slice(0, 80) + (callbackUrl.length > 80 ? '…' : '') });
    await handleOAuthCallback(callbackUrl);
  } else if (result.type === 'cancel') {
    authLog.warn(`OAuth annulé par l'utilisateur (${provider})`);
  } else {
    authLog.warn(`Navigateur OAuth fermé sans succès (${provider})`, result);
  }

  return null;
}

// ── Provider ─────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [cachedUserId, setCachedUserId] = useState<string | null>(null);
  const [cachedEmail, setCachedEmail] = useState<string | null>(null);
  // L'identité locale (AsyncStorage) a été lue
  const [localLoaded, setLocalLoaded] = useState(false);
  // Supabase a émis INITIAL_SESSION (peut prendre jusqu'à ~1 min hors-ligne avec
  // un jeton expiré : on ne l'attend QUE si aucun utilisateur n'est connu)
  const [initialEventReceived, setInitialEventReceived] = useState(false);
  // Une session (même expirée) est-elle encore persistée ? null = pas encore su
  const [storedSessionExists, setStoredSessionExists] = useState<boolean | null>(null);
  // Déconnexion explicite en cours : ignorer une session résiduelle qui
  // reviendrait d'un rafraîchissement de jeton encore en vol.
  const explicitSignOutRef = useRef(false);

  // ── 1. Identité locale : lecture directe du stockage, AUCUN accès réseau ──
  // C'est ce qui permet d'ouvrir l'app immédiatement hors-ligne. Ne pas la
  // remplacer par supabase.auth.getSession() (voir readStoredAuthUser).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [legacyId, legacyEmail, stored] = await Promise.all([
        AsyncStorage.getItem(CACHED_USER_ID_KEY).catch(() => null),
        AsyncStorage.getItem(CACHED_USER_EMAIL_KEY).catch(() => null),
        readStoredAuthUser(),
      ]);
      if (cancelled) return;
      const id = stored?.id ?? legacyId;
      if (id) {
        setCachedUserId((prev) => prev ?? id);
        setCachedEmail((prev) => prev ?? stored?.email ?? legacyEmail ?? null);
      }
      setStoredSessionExists((prev) => prev ?? stored != null);
      setLocalLoaded(true);
      authLog.info('Identité locale lue', { knownUser: !!id, storedSession: stored != null });
    })();
    return () => { cancelled = true; };
  }, []);

  // Filet de sécurité : si Supabase ne répond jamais, on ne reste pas bloqué
  useEffect(() => {
    const timer = setTimeout(() => setInitialEventReceived(true), 8000);
    return () => clearTimeout(timer);
  }, []);

  // ── 2. Session Supabase : arrive (ou revient) en arrière-plan ──
  useEffect(() => {
    authLog.info('AuthProvider monté — abonnement onAuthStateChange');

    // Pattern recommandé Supabase : onAuthStateChange déclenche INITIAL_SESSION
    // dès l'abonnement, ce qui remplace l'appel manuel à getSession().
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      authLog.info(`onAuthStateChange`, { event, userId: newSession?.user?.id ?? null });

      if (explicitSignOutRef.current) {
        if (event === 'SIGNED_IN' && newSession) {
          explicitSignOutRef.current = false; // nouvelle connexion volontaire
        } else if (newSession) {
          authLog.warn('Session ignorée : déconnexion explicite en cours', { event });
          return;
        }
      }

      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (newSession?.user?.id) {
        // Mémoriser l'utilisateur pour l'accès hors-ligne aux données locales
        const { id, email } = newSession.user;
        setCachedUserId(id);
        setCachedEmail(email ?? null);
        setStoredSessionExists(true);
        AsyncStorage.setItem(CACHED_USER_ID_KEY, id).catch(() => {});
        if (email) AsyncStorage.setItem(CACHED_USER_EMAIL_KEY, email).catch(() => {});
      } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') {
        // Pas de session : simplement pas rafraîchie (hors-ligne) ou réellement
        // disparue (jeton révoqué) ? Le stockage tranche. Lecture directe : ne
        // PAS appeler supabase.auth.* depuis ce callback (verrou interne).
        readStoredAuthUser().then((stored) => setStoredSessionExists(stored != null));
      }

      if (event === 'INITIAL_SESSION') {
        authLog.info('INITIAL_SESSION reçu', { sessionExists: !!newSession });
        setInitialEventReceived(true);
      }

      if (event === 'SIGNED_IN') {
        authLog.info('SIGNED_IN — utilisateur connecté', {
          userId: newSession?.user?.id,
          email: newSession?.user?.email,
          provider: newSession?.user?.app_metadata?.provider,
        });
      }

      if (event === 'SIGNED_OUT') {
        authLog.info('SIGNED_OUT');
      }

      if (event === 'TOKEN_REFRESHED') {
        authLog.info('TOKEN_REFRESHED');
      }
    });

    // Listener deep link pour le callback OAuth mobile (fallback cold start)
    // openAuthSessionAsync retourne l'URL directement dans result.url,
    // mais ce listener reste utile si l'app est ouverte depuis un deep link
    // externe (ex: lien partagé) ou si openAuthSessionAsync échoue.
    const urlSub = Linking.addEventListener('url', ({ url }) => {
      authLog.info('Linking.addEventListener — URL reçue', { url: url.slice(0, 80) + (url.length > 80 ? '…' : '') });
      handleOAuthCallback(url);
    });

    // Cold start : l'app a été ouverte directement depuis un deep link OAuth
    Linking.getInitialURL().then((url) => {
      if (url) {
        authLog.info('getInitialURL — cold start URL', { url: url.slice(0, 80) + (url.length > 80 ? '…' : '') });
        handleOAuthCallback(url);
      } else {
        authLog.info('getInitialURL — aucune URL (démarrage normal)');
      }
    });

    return () => {
      authLog.info('AuthProvider démonté — nettoyage subscriptions');
      subscription.unsubscribe();
      urlSub.remove();
    };
  }, []);

  // Un utilisateur connu localement n'attend JAMAIS Supabase pour entrer dans
  // l'app. Seul un appareil sans utilisateur connu attend INITIAL_SESSION (qui
  // est alors immédiat : il n'y a aucun jeton à rafraîchir).
  const initializing = !localLoaded || (!cachedUserId && !session && !initialEventReceived);

  const sessionStatus: SessionStatus = initializing
    ? 'loading'
    : session
      ? 'active'
      : !cachedUserId
        ? 'signedOut'
        : storedSessionExists === false && initialEventReceived
          ? 'expired'
          : 'restoring';

  const startSignIn = (provider: 'google' | 'facebook' | 'apple') => {
    explicitSignOutRef.current = false;
    return openOAuth(provider);
  };
  const signInWithGoogle = () => startSignIn('google');
  const signInWithFacebook = () => startSignIn('facebook');
  const signInWithApple = () => startSignIn('apple');

  const signInWithEmail = async (email: string, password: string): Promise<AuthError | null> => {
    explicitSignOutRef.current = false;
    authLog.info('signInWithEmail — tentative', { email });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      authLog.error('signInWithEmail échoué', { message: error.message, status: error.status });
    } else {
      authLog.info('signInWithEmail réussi');
    }
    return error ?? null;
  };

  const signOut = async (): Promise<AuthError | null> => {
    authLog.info('signOut — déconnexion explicite');
    explicitSignOutRef.current = true;

    // Déconnexion EXPLICITE : c'est le seul cas où l'on oublie l'utilisateur
    // local (les prises encore en file restent sur l'appareil et repartiront
    // quand ce même compte se reconnectera).
    setCachedUserId(null);
    setCachedEmail(null);
    setSession(null);
    setUser(null);
    setStoredSessionExists(false);
    await AsyncStorage.multiRemove([CACHED_USER_ID_KEY, CACHED_USER_EMAIL_KEY]).catch(() => {});

    // Même avec scope:'local', supabase-js tente d'abord un rafraîchissement du
    // jeton puis un appel /logout : hors-ligne, cela peut durer ~30 s. On borne
    // l'attente et on efface la session locale nous-mêmes dans tous les cas.
    let error: AuthError | null = null;
    try {
      const res = await withTimeout(supabase.auth.signOut({ scope: 'local' }), 4000, 'signOut');
      error = res.error ?? null;
    } catch (e) {
      authLog.warn('signOut distant non confirmé (hors-ligne ?) — session locale effacée', e);
    }
    await clearStoredAuthSession();

    if (error) {
      authLog.error('signOut échoué', { message: error.message });
    } else {
      authLog.info('signOut réussi');
    }
    return error;
  };

  return (
    <AuthContext.Provider value={{
      session,
      user,
      initializing,
      cachedUserId,
      cachedEmail,
      sessionStatus,
      signInWithGoogle,
      signInWithFacebook,
      signInWithApple,
      signInWithEmail,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé à l'intérieur de AuthProvider");
  return ctx;
}
