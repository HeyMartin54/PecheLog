import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { colors, radius, spacing, typography } from '@/lib/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);

    const error = await signOut();
    if (error) {
      console.warn('[Settings] Erreur déconnexion (session locale effacée quand même)', error);
    }

    // Toujours naviguer vers login, même si l'invalidation réseau a échoué
    router.replace('/login');
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Profil */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Profil</Text>
        <View style={styles.card}>
          <View style={styles.profileRow}>
            <View style={styles.avatarWrapper}>
              <Text style={styles.avatar}>👤</Text>
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.profileEmail} numberOfLines={1}>
                {user?.email || 'Utilisateur'}
              </Text>
              <Text style={styles.profileSubtext}>Connecté</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Paramètres */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Paramètres</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <Ionicons name="language" size={20} color={colors.accent} />
              <Text style={styles.settingLabel}>Langue</Text>
            </View>
            <View style={styles.settingRight}>
              <Text style={styles.settingValue}>Français</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <Ionicons name="locate" size={20} color={colors.accent} />
              <Text style={styles.settingLabel}>Unités</Text>
            </View>
            <View style={styles.settingRight}>
              <Text style={styles.settingValue}>Métriques</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Équipement */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Équipement</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.settingRow} onPress={() => router.push('/my-lures')} activeOpacity={0.8}>
            <View style={styles.settingLeft}>
              <Ionicons name="fish" size={20} color={colors.accent} />
              <Text style={styles.settingLabel}>Mes leurres</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.settingRow, { borderBottomWidth: 0 }]} onPress={() => router.push('/my-species')} activeOpacity={0.8}>
            <View style={styles.settingLeft}>
              <Ionicons name="color-palette" size={20} color={colors.accent} />
              <Text style={styles.settingLabel}>Espèces & marqueurs</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* À propos */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>À propos</Text>
        <View style={styles.card}>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Version</Text>
            <Text style={styles.aboutValue}>1.0.0</Text>
          </View>
        </View>
      </View>

      {/* Déconnexion */}
      <View style={styles.logoutSection}>
        <TouchableOpacity
          style={[styles.logoutButton, loggingOut && styles.logoutButtonDisabled]}
          onPress={handleLogout}
          disabled={loggingOut}
          activeOpacity={0.88}
        >
          {loggingOut ? (
            <ActivityIndicator color={colors.error} />
          ) : (
            <>
              <Ionicons name="log-out" size={18} color={colors.error} />
              <Text style={styles.logoutText}>Déconnexion</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xxl,
  },

  // Section
  section: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },

  // Carte
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },

  // Profil
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.lg,
  },
  avatarWrapper: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accentGlow,
  },
  avatar: {
    fontSize: 24,
  },
  profileInfo: {
    flex: 1,
    gap: 4,
  },
  profileEmail: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  profileSubtext: {
    ...typography.caption,
    color: colors.textMuted,
  },

  // Paramètres
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  settingLabel: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  settingRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  settingValue: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },

  // À propos
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  aboutLabel: {
    ...typography.bodySmall,
    color: colors.textPrimary,
  },
  aboutValue: {
    ...typography.bodySmall,
    color: colors.textMuted,
    fontWeight: '600',
  },

  // Déconnexion
  logoutSection: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.xl,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.errorSubtle,
    borderWidth: 1,
    borderColor: 'rgba(255,94,94,0.25)',
  },
  logoutButtonDisabled: {
    opacity: 0.65,
  },
  logoutText: {
    ...typography.bodySmall,
    color: colors.error,
    fontWeight: '600',
  },
});
