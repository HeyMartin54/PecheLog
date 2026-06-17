import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { isOnline } from '@/lib/net';
import { getOfflineQueueCount, trySyncOfflineCatches } from '@/lib/offlineSync';
import { colors, radius, spacing, typography } from '@/lib/theme';

// ─── Sélecteur segmenté générique ─────────────────────────────────────────────

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[styles.segment, active && styles.segmentActive]}
            onPress={() => onChange(opt.value)}
            activeOpacity={0.8}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { settings, updateSettings, t } = useSettings();
  const insets = useSafeAreaInsets();
  const [loggingOut, setLoggingOut] = useState(false);

  // ── File d'attente hors-ligne ──
  const [queueCount, setQueueCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const refreshQueueCount = useCallback(async () => {
    setQueueCount(await getOfflineQueueCount());
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshQueueCount();
    }, [refreshQueueCount]),
  );

  const handleSyncNow = async () => {
    if (syncing || !user?.id) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      if (!(await isOnline())) {
        setSyncMessage(t('settings.syncOffline'));
        return;
      }
      await trySyncOfflineCatches(user.id);
      await refreshQueueCount();
      setSyncMessage(t('settings.syncDone'));
    } finally {
      setSyncing(false);
    }
  };

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
        <Text style={styles.sectionTitle}>{t('settings.profile')}</Text>
        <View style={styles.card}>
          <View style={styles.profileRow}>
            <View style={styles.avatarWrapper}>
              <Text style={styles.avatar}>👤</Text>
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.profileEmail} numberOfLines={1}>
                {user?.email || t('settings.user')}
              </Text>
              <Text style={styles.profileSubtext}>{t('settings.connected')}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Paramètres */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings.preferences')}</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <Ionicons name="language" size={20} color={colors.accent} />
              <Text style={styles.settingLabel}>{t('settings.language')}</Text>
            </View>
            <Segmented
              options={[
                { value: 'fr', label: t('settings.french') },
                { value: 'en', label: t('settings.english') },
              ]}
              value={settings.language}
              onChange={(language) => updateSettings({ language })}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <Ionicons name="thermometer" size={20} color={colors.accent} />
              <Text style={styles.settingLabel}>{t('settings.temperature')}</Text>
            </View>
            <Segmented
              options={[
                { value: 'C', label: '°C' },
                { value: 'F', label: '°F' },
              ]}
              value={settings.tempUnit}
              onChange={(tempUnit) => updateSettings({ tempUnit })}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <Ionicons name="barbell" size={20} color={colors.accent} />
              <Text style={styles.settingLabel}>{t('settings.weight')}</Text>
            </View>
            <Segmented
              options={[
                { value: 'lb', label: t('unit.lb') },
                { value: 'kg', label: t('unit.kg') },
              ]}
              value={settings.weightUnit}
              onChange={(weightUnit) => updateSettings({ weightUnit })}
            />
          </View>

          <View style={[styles.settingRow, { borderBottomWidth: 0 }]}>
            <View style={styles.settingLeft}>
              <Ionicons name="resize" size={20} color={colors.accent} />
              <Text style={styles.settingLabel}>{t('settings.length')}</Text>
            </View>
            <Segmented
              options={[
                { value: 'in', label: t('unit.in') },
                { value: 'cm', label: t('unit.cm') },
              ]}
              value={settings.lengthUnit}
              onChange={(lengthUnit) => updateSettings({ lengthUnit })}
            />
          </View>
        </View>
      </View>

      {/* Synchronisation */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings.sync')}</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <Ionicons name="cloud-upload" size={20} color={colors.accent} />
              <Text style={styles.settingLabel}>{t('settings.pendingCatches')}</Text>
            </View>
            <View style={[styles.queueBadge, queueCount > 0 && styles.queueBadgeActive]}>
              <Text style={[styles.queueBadgeText, queueCount > 0 && styles.queueBadgeTextActive]}>
                {queueCount}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.settingRow, { borderBottomWidth: 0 }, (syncing || queueCount === 0) && styles.settingRowDisabled]}
            onPress={handleSyncNow}
            disabled={syncing || queueCount === 0}
            activeOpacity={0.8}
          >
            <View style={styles.settingLeft}>
              {syncing ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Ionicons name="sync" size={20} color={colors.accent} />
              )}
              <Text style={styles.settingLabel}>
                {syncing ? t('settings.syncing') : t('settings.syncNow')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        {syncMessage ? <Text style={styles.syncMessage}>{syncMessage}</Text> : null}
      </View>

      {/* Équipement */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings.equipment')}</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.settingRow} onPress={() => router.push('/my-lures')} activeOpacity={0.8}>
            <View style={styles.settingLeft}>
              <Ionicons name="fish" size={20} color={colors.accent} />
              <Text style={styles.settingLabel}>{t('settings.myLures')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.settingRow, { borderBottomWidth: 0 }]} onPress={() => router.push('/my-species')} activeOpacity={0.8}>
            <View style={styles.settingLeft}>
              <Ionicons name="color-palette" size={20} color={colors.accent} />
              <Text style={styles.settingLabel}>{t('settings.speciesMarkers')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* À propos */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings.about')}</Text>
        <View style={styles.card}>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>{t('settings.version')}</Text>
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
              <Text style={styles.logoutText}>{t('settings.logout')}</Text>
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
  settingRowDisabled: {
    opacity: 0.5,
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

  // Sélecteur segmenté
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  segment: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    minWidth: 44,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: colors.accentSubtle,
  },
  segmentText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: colors.accent,
  },

  // File d'attente
  queueBadge: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  queueBadgeActive: {
    backgroundColor: colors.accentSubtle,
    borderColor: colors.accentGlow,
  },
  queueBadgeText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  queueBadgeTextActive: {
    color: colors.accent,
  },
  syncMessage: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginLeft: spacing.sm,
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
