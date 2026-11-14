import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/lib/theme';
import { useSettings } from '@/contexts/SettingsContext';
import { useNetworkStatus } from '@/lib/hooks/useNetworkStatus';

export default function ConnectionBadge() {
  const { t } = useSettings();
  // « En ligne » = internet réellement utilisable. Un réseau sans accès internet
  // (1 barre, wifi captif) est affiché « Hors-ligne », ce qu'il est en pratique.
  const isConnected = useNetworkStatus();

  if (isConnected === null) return null;

  return (
    <View style={[styles.badge, isConnected ? styles.online : styles.offline]}>
      <Ionicons
        name={isConnected ? 'wifi' : 'wifi-outline'}
        size={10}
        color={isConnected ? colors.success : colors.warning}
        style={styles.icon}
      />
      <Text style={[styles.text, { color: isConnected ? colors.success : colors.warning }]}>
        {isConnected ? t('common.online') : t('common.offline')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  online: {
    backgroundColor: colors.successSubtle,
    borderColor: 'rgba(46, 204, 113, 0.25)',
  },
  offline: {
    backgroundColor: colors.warningSubtle,
    borderColor: 'rgba(245, 166, 35, 0.25)',
  },
  icon: {
    marginRight: 3,
  },
  text: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
