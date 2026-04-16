import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { authLog } from '@/contexts/AuthContext';
import { colors } from '@/lib/theme';

/**
 * Page de callback OAuth — web uniquement.
 *
 * Flow :
 *  1. Supabase redirige ici après Google OAuth avec ?code=xxx dans l'URL
 *  2. On échange le code contre une session (exchangeCodeForSession)
 *  3. onAuthStateChange dans AuthContext met à jour session
 *  4. Dès que session est non-null dans le contexte, on navigue vers /(tabs)
 *
 * On ne navigue qu'après que le state React soit mis à jour (useAuth()),
 * ce qui évite que le route guard de (tabs)/_layout.tsx redirige vers login
 * parce que session est encore null au moment de la navigation.
 */
export default function AuthCallbackScreen() {
  const router = useRouter();
  const { session, initializing } = useAuth();
  const exchangedRef = useRef(false);

  // Étape 1 — Échanger le code OAuth
  useEffect(() => {
    if (exchangedRef.current || typeof window === 'undefined') return;
    exchangedRef.current = true;

    const href = window.location.href;
    const search = window.location.search;
    const hash = window.location.hash;

    authLog.info('AuthCallback monté', { href: href.slice(0, 120), search, hash: hash.slice(0, 60) });

    // Vérifier d'abord si Supabase a retourné une erreur (redirect URL non autorisée, etc.)
    const hashParams = new URLSearchParams(hash.slice(1));
    const oauthError = hashParams.get('error');
    const oauthErrorCode = hashParams.get('error_code');
    const oauthErrorDesc = hashParams.get('error_description');
    if (oauthError) {
      authLog.error('Erreur OAuth retournée par Supabase', {
        error: oauthError,
        errorCode: oauthErrorCode,
        description: oauthErrorDesc,
        hint: `Vérifier que "${window.location.origin}/auth/callback" est dans Supabase → Authentication → URL Configuration → Redirect URLs`,
      });
      router.replace('/login');
      return;
    }

    const code = new URLSearchParams(search).get('code');
    authLog.info('Code PKCE extrait', { code: code ? code.slice(0, 20) + '…' : 'AUCUN' });

    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          authLog.error('exchangeCodeForSession échoué', {
            message: error.message,
            status: error.status,
            hint: 'Vérifier que le code PKCE n\'a pas déjà été échangé (double appel ?) et que detectSessionInUrl est bien configuré.',
          });
          router.replace('/login');
        } else {
          authLog.info('exchangeCodeForSession réussi — attente mise à jour session dans AuthContext…');
        }
      });
      return;
    }

    // Implicit flow : tokens dans le hash (#access_token=...)
    const implicitParams = new URLSearchParams(hash.slice(1));
    const accessToken = implicitParams.get('access_token');
    const refreshToken = implicitParams.get('refresh_token');

    if (accessToken && refreshToken) {
      authLog.info('Implicit flow détecté — setSession avec tokens du hash');
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error }) => {
        if (error) {
          authLog.error('setSession échoué', { message: error.message, status: error.status });
          router.replace('/login');
        } else {
          authLog.info('setSession réussi — attente mise à jour session…');
        }
      });
      return;
    }

    authLog.warn('Aucun code ni token trouvé dans l\'URL', { href });
    router.replace('/login');
  }, [router]);

  // Étape 2 — Naviguer dès que session est confirmée dans AuthContext
  // (garantit que le route guard de (tabs) voit session !== null)
  useEffect(() => {
    if (!initializing && session) {
      authLog.info('Session confirmée dans AuthContext — redirection vers /(tabs)', {
        userId: session.user?.id,
        email: session.user?.email,
      });
      router.replace('/(tabs)');
    }
  }, [session, initializing, router]);

  // Timeout de sécurité : 20s sans session = erreur
  useEffect(() => {
    const timeout = setTimeout(() => {
      authLog.error('Timeout 20s — aucune session établie, retour login', {
        hint: 'Vérifier les logs ci-dessus pour identifier où la chaîne OAuth a bloqué.',
      });
      router.replace('/login');
    }, 20_000);
    return () => clearTimeout(timeout);
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={styles.text}>Connexion en cours…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  text: {
    fontSize: 15,
    color: colors.textMuted,
  },
});
