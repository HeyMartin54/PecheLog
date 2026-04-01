import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, radius, spacing, typography } from '@/lib/theme';

export default function StatsScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.emptyState}>
        <View style={styles.iconWrapper}>
          <Ionicons name="bar-chart" size={40} color={colors.accent} />
        </View>
        <Text style={styles.title}>Statistiques</Text>
        <Text style={styles.subtitle}>
          Vos graphiques de pêche apparaîtront ici — par espèce, leurre, lac et période.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.md,
  },
  iconWrapper: {
    width: 80,
    height: 80,
    borderRadius: radius.xl,
    backgroundColor: colors.accentSubtle,
    borderWidth: 1,
    borderColor: colors.accentGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
});
