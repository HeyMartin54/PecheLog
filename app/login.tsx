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

const BG_COLOR = '#0B1A2B';
const CARD_COLOR = '#122236';
const ACCENT_COLOR = '#00D4AA';
const TEXT_PRIMARY = '#EAF0F7';
const TEXT_SECONDARY = '#8AA4C0';

export default function LoginScreen() {
  const router = useRouter();
  const { session, initializing, signInWithEmail } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Si la session est déjà active, on redirige vers l'accueil.
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
    // TEMPORAIRE : redirection directe vers l'accueil sans auth Facebook.
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
        <View style={styles.logoContainer}>
          <View style={styles.logo}>
            <Text style={styles.logoEmoji}>🐟</Text>
          </View>
          <Text style={styles.title}>PêcheLog</Text>
          <Text style={styles.subtitle}>Votre journal de pêche intelligent</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Connexion par courriel</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Courriel</Text>
            <TextInput
              style={styles.input}
              placeholder="ex: pecheur@exemple.com"
              placeholderTextColor={TEXT_SECONDARY}
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
              placeholder="Mot de passe"
              placeholderTextColor={TEXT_SECONDARY}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, isAuthInProgress && styles.disabledButton]}
            onPress={handleEmailLogin}
            disabled={isAuthInProgress}
          >
            {isAuthInProgress ? (
              <ActivityIndicator color={BG_COLOR} />
            ) : (
              <Text style={styles.primaryButtonText}>Se connecter avec courriel</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Ou</Text>

          <TouchableOpacity
            style={[styles.facebookButton, isAuthInProgress && styles.disabledButton]}
            onPress={handleFacebookLogin}
            disabled={isAuthInProgress}
          >
            <View style={styles.buttonIcon}>
              <Text style={styles.buttonIconText}>f</Text>
            </View>
            <Text style={styles.facebookButtonText}>Continuer avec Facebook</Text>
          </TouchableOpacity>

          <Text style={styles.terms}>
            En continuant, tu acceptes nos{' '}
            <Text style={styles.termsLink}>Conditions d’utilisation</Text> et notre{' '}
            <Text style={styles.termsLink}>Politique de confidentialité</Text>.
          </Text>
        </View>

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG_COLOR,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 40,
    justifyContent: 'flex-start',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logo: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: ACCENT_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoEmoji: {
    fontSize: 48,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: TEXT_PRIMARY,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: TEXT_SECONDARY,
  },
  card: {
    backgroundColor: CARD_COLOR,
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(138,164,192,0.25)',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: TEXT_PRIMARY,
    marginBottom: 12,
  },
  inputGroup: {
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    color: TEXT_SECONDARY,
    marginBottom: 4,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(138,164,192,0.35)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: TEXT_PRIMARY,
    fontSize: 15,
    backgroundColor: '#18263A',
  },
  primaryButton: {
    marginTop: 8,
    borderRadius: 14,
    backgroundColor: ACCENT_COLOR,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: BG_COLOR,
    fontWeight: '700',
    fontSize: 15,
  },
  facebookButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#1877F2',
    paddingVertical: 14,
    marginTop: 4,
    gap: 10,
  },
  facebookButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
  buttonIcon: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonIconText: {
    color: '#1877F2',
    fontWeight: '800',
    fontSize: 16,
  },
  terms: {
    marginTop: 12,
    fontSize: 11,
    color: TEXT_SECONDARY,
    textAlign: 'center',
  },
  termsLink: {
    color: ACCENT_COLOR,
  },
  error: {
    marginTop: 8,
    textAlign: 'center',
    color: '#FF5A5A',
    fontSize: 13,
  },
  disabledButton: {
    opacity: 0.7,
  },
});

