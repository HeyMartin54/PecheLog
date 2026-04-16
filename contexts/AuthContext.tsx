import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { Session, User, AuthError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

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

type AuthContextType = {
  session: Session | null;
  user: User | null;
  initializing: boolean;
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
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    authLog.info('AuthProvider monté — abonnement onAuthStateChange');

    // Pattern recommandé Supabase : onAuthStateChange déclenche INITIAL_SESSION
    // dès l'abonnement, ce qui remplace l'appel manuel à getSession().
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      authLog.info(`onAuthStateChange`, { event, userId: newSession?.user?.id ?? null });

      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (event === 'INITIAL_SESSION') {
        authLog.info('INITIAL_SESSION reçu', { sessionExists: !!newSession });
        setInitializing(false);
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

  const signInWithGoogle = () => openOAuth('google');
  const signInWithFacebook = () => openOAuth('facebook');
  const signInWithApple = () => openOAuth('apple');

  const signInWithEmail = async (email: string, password: string): Promise<AuthError | null> => {
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
    authLog.info('signOut — déconnexion locale');
    // scope:'local' garantit que la session locale est effacée même si le réseau échoue.
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      authLog.error('signOut échoué', { message: error.message });
    } else {
      authLog.info('signOut réussi');
    }
    return error ?? null;
  };

  return (
    <AuthContext.Provider value={{
      session,
      user,
      initializing,
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
