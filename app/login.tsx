import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { colors, radius, spacing, typography } from '@/lib/theme';

export default function LoginScreen() {
  const router = useRouter();
  const { session, initializing, signInWithEmail } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!initializing && session) {
    router.replace('/(tabs)');
    return null;
  }

  const handleEmailLogin = async () => {
    if (loading) return;
    setErrorMessage(null);

    if (!email || !password) {
      setErrorMessage('Entre ton courriel et ton mot de passe.');
      return;
    }

    setLoading(true);
    const error = await signInWithEmail(email.trim(), password);
    setLoading(false);

    if (error) {
      setErrorMessage(error.message ?? "Impossible de te connecter. Vérifie tes infos.");
      return;
    }

    router.replace('/(tabs)');
  };

  const handleFacebookLogin = () => {
    setErrorMessage(null);
    router.replace('/(tabs)');
  };

  const isAuthInProgress = loading || initializing;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>

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

        {/* Connexion courriel */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Connexion</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Courriel</Text>
            <TextInput
              style={styles.input}
              placeholder="pecheur@exemple.com"
              placeholderTextColor={colors.textSubtle}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Mot de passe</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={colors.textSubtle}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, isAuthInProgress && styles.disabledButton]}
            onPress={handleEmailLogin}
            disabled={isAuthInProgress}
            activeOpacity={0.88}
          >
            {isAuthInProgress ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Text style={styles.primaryButtonText}>Se connecter</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Ou — Facebook */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>ou</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity
          style={[styles.facebookButton, isAuthInProgress && styles.disabledButton]}
          onPress={handleFacebookLogin}
          disabled={isAuthInProgress}
          activeOpacity={0.88}
        >
          <View style={styles.facebookIcon}>
            <Text style={styles.facebookIconText}>f</Text>
          </View>
          <Text style={styles.facebookButtonText}>Continuer avec Facebook</Text>
        </TouchableOpacity>

        {errorMessage ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <Text style={styles.terms}>
          En continuant, tu acceptes nos{' '}
          <Text style={styles.termsLink}>Conditions d'utilisation</Text> et notre{' '}
          <Text style={styles.termsLink}>Politique de confidentialité</Text>.
        </Text>
      </View>
    </KeyboardAvoidingView>
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
    paddingTop: 72,
    paddingBottom: spacing.xxl,
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

  // Card connexion
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  cardTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
  },
  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    color: colors.textPrimary,
    fontSize: 15,
    backgroundColor: colors.surface2,
  },
  primaryButton: {
    marginTop: 4,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 5,
  },
  primaryButtonText: {
    color: colors.bg,
    fontWeight: '700',
    fontSize: 16,
  },

  // Divider
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  dividerText: {
    ...typography.label,
    color: colors.textSubtle,
  },

  // Facebook
  facebookButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: '#1877F2',
    paddingVertical: 15,
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  facebookButtonText: {
    color: '#FFFFFF',
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
  },
  facebookIconText: {
    color: '#1877F2',
    fontWeight: '800',
    fontSize: 16,
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
});
