import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { useNetworkStatus } from '@/lib/hooks/useNetworkStatus';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';

export default function LoginScreen() {
  const router = useRouter();
  const { session, initializing, cachedUserId, signInWithGoogle, signInWithFacebook, signInWithEmail } = useAuth();
  const isConnected = useNetworkStatus();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const DEV_EMAIL = 'test@pechelog.dev';
  const DEV_PASSWORD = 'TestPeche2024!';

  useEffect(() => {
    if (initializing) return;
    if (session) {
      router.replace('/(tabs)');
      return;
    }
    // Hors-ligne sans session (token expiré, refresh impossible) mais utilisateur
    // déjà connu → accès à l'app en mode hors-ligne (cache + file d'attente).
    if (isConnected === false && cachedUserId) {
      router.replace('/(tabs)');
    }
  }, [initializing, session, isConnected, cachedUserId]);

  const handleGoogleLogin = async () => {
    if (loading) return;
    setErrorMessage(null);
    setLoading(true);
    const error = await signInWithGoogle();
    setLoading(false);
    if (error) {
      setErrorMessage(error.message ?? 'Impossible de se connecter avec Google.');
    }
  };

  const handleFacebookLogin = async () => {
    if (loading) return;
    setErrorMessage(null);
    setLoading(true);
    const error = await signInWithFacebook();
    setLoading(false);
    if (error) {
      setErrorMessage(error.message ?? 'Impossible de se connecter avec Facebook.');
    }
  };

  const handleDevLogin = async () => {
    if (loading) return;
    setErrorMessage(null);
    setLoading(true);
    const error = await signInWithEmail(DEV_EMAIL, DEV_PASSWORD);
    setLoading(false);
    if (error) setErrorMessage(error.message ?? 'Identifiants incorrects.');
  };

  // ── Réinitialisation session (dev uniquement) ─────────────────────────────
  const handleClearSession = async () => {
    await supabase.auth.signOut();
    await AsyncStorage.clear();
    Alert.alert('Session effacée', 'Redémarre l\'app pour recommencer.');
  };

  const isAuthInProgress = loading || initializing;

  return (
    <View style={styles.container}>
      <View style={[styles.inner, { paddingTop: insets.top + 32, paddingBottom: spacing.xxl + insets.bottom }]}>

        {/* Logo */}
        <View style={styles.logoContainer}>
          <View style={styles.logoRing}>
            <View style={styles.logo}>
              <Text style={styles.logoEmoji}>🎣</Text>
            </View>
          </View>
          <Text style={styles.title}>PêcheLog</Text>
          <Text style={styles.subtitle}>Votre journal de pêche intelligent</Text>
        </View>

        {/* Boutons OAuth */}
        <View style={styles.buttonsContainer}>
          <TouchableOpacity
            style={[styles.oauthButton, styles.googleButton, isAuthInProgress && styles.disabledButton]}
            onPress={handleGoogleLogin}
            disabled={isAuthInProgress}
            activeOpacity={0.88}
          >
            {loading ? (
              <ActivityIndicator color={colors.textPrimary} />
            ) : (
              <>
                <Text style={styles.oauthIcon}>🔵</Text>
                <Text style={styles.oauthButtonText}>Continuer avec Google</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.oauthButton, styles.facebookButton, isAuthInProgress && styles.disabledButton]}
            onPress={handleFacebookLogin}
            disabled={isAuthInProgress}
            activeOpacity={0.88}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Text style={styles.facebookIcon}>f</Text>
                <Text style={styles.facebookButtonText}>Continuer avec Facebook</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {errorMessage ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <Text style={styles.terms}>
          En continuant, tu acceptes nos{' '}
          <Text style={styles.termsLink}>Conditions d&apos;utilisation</Text> et notre{' '}
          <Text style={styles.termsLink}>Politique de confidentialité</Text>.
        </Text>

        {/* ── Connexion usager de test (dev uniquement) ─────────────────── */}
        {__DEV__ && (
          <View style={styles.devSection}>
            <Text style={styles.devLabel}>Développement</Text>
            <TouchableOpacity
              style={[styles.devLoginBtn, loading && styles.disabledButton]}
              onPress={handleDevLogin}
              disabled={loading}
              activeOpacity={0.8}
            >
              <Text style={styles.devLoginBtnText}>Se connecter comme usager de test</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.clearBtn} onPress={handleClearSession} activeOpacity={0.7}>
              <Text style={styles.clearBtnText}>🗑 Effacer session persistée</Text>
            </TouchableOpacity>
          </View>
        )}

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  inner: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: 0,
    paddingBottom: 0,
    justifyContent: 'flex-start',
  },

  // Logo
  logoContainer: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  logoRing: {
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 1.5,
    borderColor: colors.accentGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    backgroundColor: colors.accentSubtle,
  },
  logo: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
  logoEmoji: {
    fontSize: 44,
  },
  title: {
    ...typography.h1,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 6,
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
  },

  // OAuth Buttons
  buttonsContainer: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  oauthButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    paddingVertical: 15,
    gap: spacing.md,
  },
  googleButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  facebookButton: {
    backgroundColor: '#1877F2',
  },
  oauthIcon: {
    fontSize: 18,
  },
  oauthButtonText: {
    color: colors.textPrimary,
    fontWeight: '600',
    fontSize: 15,
  },
  facebookIcon: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '800',
    fontSize: 16,
  },
  facebookButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },

  // Erreur
  errorCard: {
    backgroundColor: colors.errorSubtle,
    borderWidth: 1,
    borderColor: 'rgba(255,94,94,0.25)',
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    textAlign: 'center',
  },

  // Termes
  terms: {
    marginTop: spacing.xs,
    fontSize: 11,
    color: colors.textSubtle,
    textAlign: 'center',
    lineHeight: 17,
  },
  termsLink: {
    color: colors.accent,
  },
  disabledButton: {
    opacity: 0.65,
  },

  // Dev section
  devSection: {
    marginTop: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  devLabel: {
    fontSize: 11,
    color: colors.textSubtle,
    textAlign: 'center',
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  devInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
  },
  devLoginBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 11,
    alignItems: 'center',
  },
  devLoginBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  clearBtn: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  clearBtnText: {
    fontSize: 11,
    color: colors.textSubtle,
  },
});
