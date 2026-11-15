import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSyncExternalStore } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { getCatchStoreSnapshot, subscribeCatchStore } from '@/lib/catchStore';
import { getSyncEngineState, subscribeSyncEngine, syncNow } from '@/lib/syncEngine';
import { colors, radius, spacing } from '@/lib/theme';

/**
 * Bandeau d'état de la synchronisation. N'affiche rien quand tout est à jour.
 *  - Session expirée  → invitation à se reconnecter (les données locales restent
 *    utilisables sans cela).
 *  - Prises en attente → nombre + appui pour synchroniser tout de suite.
 */
export default function SyncStatusBanner() {
  const router = useRouter();
  const { sessionStatus } = useAuth();
  const { t } = useSettings();
  const store = useSyncExternalStore(subscribeCatchStore, getCatchStoreSnapshot, getCatchStoreSnapshot);
  const engine = useSyncExternalStore(subscribeSyncEngine, getSyncEngineState, getSyncEngineState);

  const pending = store.pendingCount;
  const expired = sessionStatus === 'expired';
  if (!expired && pending === 0) return null;

  return (
    <View style={styles.wrapper}>
      {expired && (
        <TouchableOpacity
          style={[styles.banner, styles.bannerWarning]}
          onPress={() => router.replace('/login')}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
          <Text style={[styles.text, { color: colors.warning }]}>{t('sync.sessionExpired')}</Text>
          <Text style={styles.action}>{t('sync.reconnect')}</Text>
        </TouchableOpacity>
      )}

      {pending > 0 && (
        <TouchableOpacity
          style={styles.banner}
          onPress={() => { syncNow().catch(() => undefined); }}
          disabled={engine.running}
          activeOpacity={0.85}
          accessibilityRole="button"
          testID="sync-pending-banner"
        >
          {engine.running ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Ionicons name="cloud-upload-outline" size={16} color={colors.accent} />
          )}
          <Text style={styles.text}>
            {pending === 1 ? t('sync.pendingBanner1') : t('sync.pendingBannerN', { n: pending })}
          </Text>
          {!engine.running && <Text style={styles.action}>{t('sync.syncNowShort')}</Text>}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.accentSubtle,
    borderWidth: 1,
    borderColor: colors.accentGlow,
  },
  bannerWarning: {
    backgroundColor: colors.warningSubtle,
    borderColor: 'rgba(245, 166, 35, 0.25)',
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  action: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accent,
  },
});
