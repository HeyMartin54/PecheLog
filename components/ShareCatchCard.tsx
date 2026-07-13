// ─── Carte visuelle de partage d'une prise ────────────────────────────────────
// Rendue en aperçu dans le modal de partage, puis capturée en PNG via
// react-native-view-shot pour être partagée en image (mobile).

import { Image, StyleSheet, Text, View } from 'react-native';

import { useSettings } from '@/contexts/SettingsContext';
import { SPECIES_CONFIG } from '@/lib/species';
import { colors } from '@/lib/theme';
import {
  formatCaughtAt,
  formatSizeLine,
  formatWeatherLine,
  type ShareableCatch,
} from '@/lib/shareCatch';

type Props = {
  catch_: ShareableCatch;
  /** Première photo de la prise (URL publique ou URI locale), si disponible. */
  photoUri: string | null;
  includeCoords: boolean;
};

export default function ShareCatchCard({ catch_, photoUri, includeCoords }: Props) {
  const { t, locale, fmtTemp, fmtWeight, fmtLength } = useSettings();

  const speciesColor = SPECIES_CONFIG[catch_.species]?.color ?? colors.species.default;
  const size = formatSizeLine(catch_, { t, fmtWeight, fmtLength });
  const weather = formatWeatherLine(catch_, { t, fmtTemp });

  return (
    <View style={styles.card}>
      {/* En-tête branding */}
      <View style={styles.header}>
        <Text style={styles.brand}>🎣 {t('share.appName')}</Text>
        <Text style={styles.tagline}>{t('share.cardTagline')}</Text>
      </View>

      {/* Photo de la prise */}
      {photoUri ? <Image source={{ uri: photoUri }} style={styles.photo} /> : null}

      {/* Espèce */}
      <View style={styles.speciesRow}>
        <View style={[styles.speciesDot, { backgroundColor: speciesColor }]} />
        <Text style={styles.speciesName}>{catch_.species}</Text>
      </View>

      {size ? <Text style={styles.sizeLine}>🏆 {size}</Text> : null}

      {/* Détails */}
      <View style={styles.details}>
        {catch_.lake_name ? <Text style={styles.detailLine}>📍 {catch_.lake_name}</Text> : null}
        {includeCoords && catch_.latitude != null && catch_.longitude != null ? (
          <Text style={styles.detailLine}>
            🧭 {catch_.latitude.toFixed(5)}, {catch_.longitude.toFixed(5)}
          </Text>
        ) : null}
        <Text style={styles.detailLine}>📅 {formatCaughtAt(catch_.caught_at, locale)}</Text>
        {catch_.lure ? <Text style={styles.detailLine}>🪝 {catch_.lure}</Text> : null}
        {weather ? <Text style={styles.detailLine}>🌤 {weather}</Text> : null}
      </View>

      {/* Barre d'accent en pied de carte */}
      <View style={styles.footerBar} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 320,
    backgroundColor: colors.bg,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
    paddingBottom: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  brand: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.accent,
    letterSpacing: 0.3,
  },
  tagline: {
    fontSize: 11,
    color: colors.textMuted,
  },
  photo: {
    width: '100%',
    height: 190,
    backgroundColor: colors.surface2,
  },
  speciesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  speciesDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  speciesName: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: -0.3,
    flex: 1,
  },
  sizeLine: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.accent,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  details: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    gap: 5,
  },
  detailLine: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
  },
  footerBar: {
    height: 4,
    backgroundColor: colors.accent,
  },
});
