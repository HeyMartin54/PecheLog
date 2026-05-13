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
import { useSpeciesColors } from '@/lib/hooks/useSpeciesColors';
import { SPECIES_CONFIG } from '@/lib/species';
import { colors, radius, spacing, typography } from '@/lib/theme';

const PRESET_COLORS = [
  '#FFD700', '#F0B429', '#E8894A', '#E74C3C', '#FF6B6B',
  '#C77DDB', '#9B59B6', '#3498DB', '#4BAEE8', '#1ABC9C',
  '#00D4AA', '#3DBA78', '#2ECC71', '#27AE60', '#9BA8B5',
  '#BDC3C7', '#34495E', '#FF8C42', '#E91E63', '#FFFFFF',
];

const SPECIES_LIST = Object.keys(SPECIES_CONFIG).filter((s) => s !== 'Site prometteur');

export default function SettingsScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const [loggingOut, setLoggingOut] = useState(false);
  const [openSpecies, setOpenSpecies] = useState<string | null>(null);
  const { getColor, setColor, resetColor, customColors } = useSpeciesColors();

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
          <TouchableOpacity style={[styles.settingRow, { borderBottomWidth: 0 }]} onPress={() => router.push('/my-lures')} activeOpacity={0.8}>
            <View style={styles.settingLeft}>
              <Ionicons name="fish" size={20} color={colors.accent} />
              <Text style={styles.settingLabel}>Mes leurres</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Couleurs des marqueurs */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Couleurs des marqueurs</Text>
        <View style={styles.card}>
          {SPECIES_LIST.map((species, index) => {
            const currentColor = getColor(species);
            const isCustom = !!customColors[species];
            const isOpen = openSpecies === species;
            return (
              <View key={species}>
                <TouchableOpacity
                  style={[
                    styles.settingRow,
                    index === SPECIES_LIST.length - 1 && !isOpen && { borderBottomWidth: 0 },
                  ]}
                  onPress={() => setOpenSpecies(isOpen ? null : species)}
                  activeOpacity={0.8}
                >
                  <View style={styles.settingLeft}>
                    {/* Mini épingle */}
                    <View style={[styles.miniPin, { backgroundColor: currentColor }]} />
                    <Text style={styles.settingLabel}>{species}</Text>
                  </View>
                  <View style={styles.settingRight}>
                    <View style={[styles.colorSwatch, { backgroundColor: currentColor }]} />
                    <Ionicons
                      name={isOpen ? 'chevron-up' : 'chevron-forward'}
                      size={18}
                      color={colors.textMuted}
                    />
                  </View>
                </TouchableOpacity>

                {isOpen && (
                  <View style={styles.colorPicker}>
                    <View style={styles.colorGrid}>
                      {PRESET_COLORS.map((hex) => (
                        <TouchableOpacity
                          key={hex}
                          style={[
                            styles.colorCell,
                            { backgroundColor: hex },
                            currentColor === hex && styles.colorCellSelected,
                          ]}
                          onPress={() => { setColor(species, hex); setOpenSpecies(null); }}
                          activeOpacity={0.8}
                        />
                      ))}
                    </View>
                    {isCustom && (
                      <TouchableOpacity
                        style={styles.resetColorBtn}
                        onPress={() => { resetColor(species); setOpenSpecies(null); }}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="refresh" size={14} color={colors.textMuted} />
                        <Text style={styles.resetColorText}>Réinitialiser</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            );
          })}
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

  // Couleurs des marqueurs
  miniPin: {
    width: 18, height: 18,
    borderTopLeftRadius: 9, borderTopRightRadius: 9,
    borderBottomRightRadius: 9, borderBottomLeftRadius: 0,
    transform: [{ rotate: '-45deg' }],
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)',
  },
  colorSwatch: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)',
  },
  colorPicker: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  colorGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
    paddingTop: spacing.sm,
  },
  colorCell: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)',
  },
  colorCellSelected: {
    borderWidth: 2.5, borderColor: colors.accent,
    transform: [{ scale: 1.15 }],
  },
  resetColorBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: spacing.md, alignSelf: 'flex-start',
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: colors.border,
  },
  resetColorText: {
    ...typography.caption,
    color: colors.textMuted,
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
    borderColor: colors.errorBorder ?? 'rgba(255,94,94,0.25)',
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
