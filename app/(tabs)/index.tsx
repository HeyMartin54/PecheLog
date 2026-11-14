import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ConnectionBadge from '@/components/ConnectionBadge';
import SyncStatusBanner from '@/components/SyncStatusBanner';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { displayWeight } from '@/lib/settingsStorage';
import { useCatches } from '@/lib/hooks/useCatches';
import { useLocation } from '@/lib/hooks/useLocation';
import { useNetworkStatus } from '@/lib/hooks/useNetworkStatus';
import { useWeather } from '@/lib/hooks/useWeather';
import { withTimeout } from '@/lib/net';
import { supabase } from '@/lib/supabase';
import { colors, typography, spacing, radius, shadow } from '@/lib/theme';
import { getSpeciesConfig } from '@/lib/species';

type HomeSummary = {
  count: number;
  lakes: number;
  recordLb: number | null;
};

type CatchRow = {
  id: string;
  species: string;
  lake_name: string | null;
  lure: string | null;
  weight_lbs: number | null;
  caught_at: string;
  latitude?: number | null;
  longitude?: number | null;
  pending?: boolean;
};

const displayNameKey = (userId: string) => `@pechelog_display_name_${userId}`;

/**
 * Nom du lac de la prise connue la plus proche (≤ 5 km). Permet d'afficher un
 * vrai nom de lac sans réseau, quand le géocodage en ligne est impossible.
 */
function nearestKnownLake(
  catches: CatchRow[],
  latitude: number,
  longitude: number,
): string | null {
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  let best: { name: string; km: number } | null = null;
  for (const c of catches) {
    const name = c.lake_name?.trim();
    if (!name || typeof c.latitude !== 'number' || typeof c.longitude !== 'number') continue;
    const dLat = (c.latitude - latitude) * 111.32;
    const dLng = (c.longitude - longitude) * 111.32 * cosLat;
    const km = Math.sqrt(dLat * dLat + dLng * dLng);
    if (km <= 5 && (!best || km < best.km)) best = { name, km };
  }
  return best?.name ?? null;
}

type Translator = (key: string, vars?: Record<string, string | number>) => string;

function formatRelativeTime(iso: string, t: Translator, locale: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffM = Math.floor(diffMs / 60000);
  if (diffM < 1) return t('time.justNow');
  if (diffM < 60) return t('time.minAgo', { n: diffM });
  const diffH = Math.floor(diffM / 60);
  if (diffH < 24) return t('time.hourAgo', { n: diffH });
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return t('time.yesterday');
  if (diffD < 7) return t('time.dayAgo', { n: diffD });
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

function catchMetaLine(row: CatchRow, t: Translator, locale: string): string {
  const lake = row.lake_name?.trim() || t('home.unknownPlace');
  const when = formatRelativeTime(row.caught_at, t, locale);
  const lure = row.lure?.trim();
  return lure ? `${lake} · ${when} · ${lure}` : `${lake} · ${when}`;
}

// ── Composant avatar d'espèce ──────────────────────────────────────────────

function SpeciesAvatar({ species, size = 46 }: { species: string; size?: number }) {
  const cfg = getSpeciesConfig(species);
  const [imgError, setImgError] = useState(false);

  if (cfg.photoUrl && !imgError) {
    return (
      <View
        style={[
          speciesAvatarStyles.container,
          { width: size, height: size, borderRadius: size / 2, borderColor: cfg.color },
        ]}
      >
        <Image
          source={{ uri: cfg.photoUrl }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          onError={() => setImgError(true)}
          resizeMode="cover"
        />
      </View>
    );
  }

  return (
    <View
      style={[
        speciesAvatarStyles.fallback,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: cfg.bgColor,
          borderColor: cfg.color,
        },
      ]}
    >
      <Text style={[speciesAvatarStyles.code, { color: cfg.color, fontSize: size * 0.3 }]}>
        {cfg.code}
      </Text>
    </View>
  );
}

const speciesAvatarStyles = StyleSheet.create({
  container: {
    borderWidth: 2,
    overflow: 'hidden',
  },
  fallback: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  code: {
    fontWeight: '700',
  },
});

// ── Écran principal ────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const { user, cachedUserId, cachedEmail } = useAuth();
  const insets = useSafeAreaInsets();
  const { coords, lakeName, loading: locationLoading } = useLocation();
  const { temperatureC, windKmh, windDirection, loading: weatherLoading } = useWeather(
    coords?.coords.latitude ?? null,
    coords?.coords.longitude ?? null,
  );
  const isConnected = useNetworkStatus();
  const { settings, t, locale, fmtWeight, fmtTemp } = useSettings();

  // Prises : lues localement (cache + file d'attente), jamais bloquées par le réseau
  const { catches, loading: homeDataLoading, fromCache } = useCatches();
  const list = catches as CatchRow[];

  const [displayName, setDisplayName] = useState<string | null>(null);
  const knownUserId = user?.id ?? cachedUserId;

  const summary = useMemo<HomeSummary>(() => {
    const lakeSet = new Set(
      list.map((r) => r.lake_name?.trim()).filter((n): n is string => !!n?.length),
    );
    const weights = list
      .map((r) => r.weight_lbs)
      .filter((w): w is number => typeof w === 'number' && !Number.isNaN(w));
    return {
      count: list.length,
      lakes: lakeSet.size,
      recordLb: weights.length > 0 ? Math.max(...weights) : null,
    };
  }, [list]);

  const recentCatches = useMemo(() => list.slice(0, 5), [list]);

  // Nom affiché : valeur mémorisée d'abord (disponible hors-ligne), puis mise à
  // jour depuis le profil quand une session et le réseau sont disponibles.
  useEffect(() => {
    if (!knownUserId) { setDisplayName(null); return; }
    let cancelled = false;
    const fallback = (user?.email ?? cachedEmail)?.split('@')[0] ?? null;

    AsyncStorage.getItem(displayNameKey(knownUserId))
      .then((stored) => { if (!cancelled) setDisplayName(stored?.trim() || fallback); })
      .catch(() => { if (!cancelled) setDisplayName(fallback); });

    if (user?.id && isConnected !== false) {
      withTimeout(
        supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
        8000,
        'profil',
      )
        .then(({ data, error }) => {
          if (cancelled || error) return;
          const name = data?.display_name?.trim();
          if (name) {
            setDisplayName(name);
            AsyncStorage.setItem(displayNameKey(user.id), name).catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [knownUserId, user?.id, user?.email, cachedEmail, isConnected]);

  // Sans réseau, pas de géocodage : on retombe sur le lac de la prise la plus proche
  const offlineLakeName = useMemo(() => {
    if (lakeName || !coords) return null;
    return nearestKnownLake(list, coords.coords.latitude, coords.coords.longitude);
  }, [lakeName, coords, list]);

  const headerLakeName = lakeName ?? offlineLakeName ?? t('home.unknownLake');
  const headerTemp =
    temperatureC != null ? fmtTemp(temperatureC) : null;
  const headerWind =
    windKmh != null
      ? `${windDirection ? windDirection + ' ' : ''}${windKmh.toFixed(1)} km/h`
      : null;
  // La météo exige le réseau : on n'affiche un indicateur d'attente que tant
  // qu'une réponse est réellement possible.
  const weatherPending = (locationLoading || weatherLoading) && isConnected !== false;

  const stats = [
    { label: t('home.statCatches'), value: summary ? String(summary.count) : '—', icon: 'fish' },
    { label: t('home.statLakes'), value: summary ? String(summary.lakes) : '—', icon: 'water' },
    {
      label: t('home.statRecord', { unit: t(`unit.${settings.weightUnit}`) }),
      value:
        summary?.recordLb != null
          ? displayWeight(summary.recordLb, settings.weightUnit).toFixed(1)
          : '—',
      icon: 'trophy',
    },
  ];

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <View style={styles.greetingRow}>
            <View>
              <Text style={styles.greeting}>{t('home.greeting')}</Text>
              <Text style={styles.name}>{displayName ?? t('home.fisher')}</Text>
            </View>
            <ConnectionBadge />
          </View>

          {/* Bandeau météo */}
          <View style={styles.weatherCard}>
            <View style={styles.weatherLocation}>
              <Ionicons name="location" size={13} color={colors.accent} />
              <Text style={styles.weatherLocationText} numberOfLines={1}>
                {headerLakeName}
              </Text>
            </View>
            <View style={styles.weatherBadgesRow}>
              {headerTemp && (
                <View style={styles.weatherBadge}>
                  <Ionicons name="thermometer-outline" size={13} color={colors.accent} />
                  <Text style={styles.weatherBadgeText}>{headerTemp}</Text>
                </View>
              )}
              {headerWind && (
                <View style={styles.weatherBadge}>
                  <Ionicons name="navigate-outline" size={13} color={colors.accent} />
                  <Text style={styles.weatherBadgeText}>{headerWind}</Text>
                </View>
              )}
              {!headerTemp && !headerWind && (
                <View style={styles.weatherBadge}>
                  {weatherPending ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Ionicons name="cloud-offline-outline" size={13} color={colors.accent} />
                  )}
                  <Text style={styles.weatherBadgeText}>
                    {weatherPending ? t('home.weatherLoading') : t('home.weatherUnavailable')}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* ── Bouton Nouvelle prise ────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.quickLogButton}
          activeOpacity={0.88}
          onPress={() => router.push('/log-catch')}
        >
          <View style={styles.quickLogIconWrapper}>
            <Ionicons name="add" size={28} color={colors.bg} />
          </View>
          <View style={styles.quickLogText}>
            <Text style={styles.quickLogTitle}>{t('home.newCatch')}</Text>
            <Text style={styles.quickLogSubtitle}>{t('home.newCatchSub')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={`${colors.bg}AA`} />
        </TouchableOpacity>

        {/* ── État de la synchronisation (rien si tout est à jour) ──────────── */}
        <SyncStatusBanner />

        {/* ── Stats ─────────────────────────────────────────────────────────── */}
        <View style={styles.statsRow}>
          {homeDataLoading ? (
            <View style={styles.statsLoading}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : (
            stats.map((stat) => (
              <View key={stat.label} style={styles.statCard}>
                <Text style={styles.statValue}>{stat.value}</Text>
                <Text style={styles.statLabel}>{stat.label}</Text>
              </View>
            ))
          )}
        </View>

        {/* ── Prises récentes ───────────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('home.recentCatches')}</Text>
          {fromCache ? (
            <View style={styles.cacheNotice}>
              <Ionicons name="cloud-offline-outline" size={11} color={colors.warning} />
              <Text style={styles.cacheNoticeText}>{t('home.localData')}</Text>
            </View>
          ) : (
            <TouchableOpacity>
              <Text style={styles.sectionLink}>{t('home.seeAll')}</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.catchList}>
          {recentCatches.length === 0 && !homeDataLoading ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateIcon}>🎣</Text>
              <Text style={styles.emptyStateTitle}>{t('home.emptyTitle')}</Text>
              <Text style={styles.emptyStateBody}>{t('home.emptyBody')}</Text>
            </View>
          ) : (
            recentCatches.map((catchItem, index) => {
              const size =
                catchItem.weight_lbs != null && !Number.isNaN(catchItem.weight_lbs)
                  ? fmtWeight(catchItem.weight_lbs)
                  : '';
              const cfg = getSpeciesConfig(catchItem.species);
              return (
                <TouchableOpacity
                  key={catchItem.id}
                  style={[
                    styles.catchCard,
                    index < recentCatches.length - 1 && styles.catchCardBorder,
                  ]}
                  activeOpacity={0.75}
                  onPress={() => router.push(`/catch-detail?id=${catchItem.id}`)}
                >
                  <SpeciesAvatar species={catchItem.species} size={46} />
                  <View style={styles.catchInfo}>
                    <View style={styles.catchTopRow}>
                      <Text style={styles.catchSpecies}>{catchItem.species}</Text>
                      {catchItem.pending ? (
                        <View style={styles.pendingBadge}>
                          <Ionicons name="time-outline" size={11} color={colors.warning} />
                          <Text style={styles.pendingBadgeText}>{t('sync.pendingShort')}</Text>
                        </View>
                      ) : null}
                      {size ? (
                        <View style={styles.catchSizeBadge}>
                          <Text style={styles.catchSizeText}>{size}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.catchMeta} numberOfLines={1}>
                      {catchMetaLine(catchItem, t, locale)}
                    </Text>
                  </View>
                  <View style={[styles.speciesDot, { backgroundColor: cfg.color }]} />
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    paddingTop: 14,
    paddingBottom: 96,
  },

  // Header
  header: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  greeting: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginBottom: 2,
  },
  name: {
    ...typography.h1,
    color: colors.textPrimary,
  },

  // Carte météo
  weatherCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  weatherLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  weatherLocationText: {
    ...typography.bodySmall,
    color: colors.textMuted,
    flex: 1,
  },
  weatherBadgesRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  weatherBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
    borderWidth: 1,
    borderColor: colors.accentGlow,
  },
  weatherBadgeText: {
    ...typography.label,
    color: colors.accent,
  },

  // Bouton "Nouvelle prise"
  quickLogButton: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.xl,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.accent,
    ...shadow.accent,
  },
  quickLogIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLogText: {
    flex: 1,
  },
  quickLogTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.bg,
  },
  quickLogSubtitle: {
    fontSize: 12,
    marginTop: 2,
    color: `${colors.bg}BB`,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.xl,
    gap: spacing.sm,
    minHeight: 82,
  },
  statsLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statCard: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: 3,
  },
  statValue: {
    ...typography.numeric,
    color: colors.accent,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  sectionLink: {
    ...typography.bodySmall,
    color: colors.accent,
    fontWeight: '500',
  },
  cacheNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.warningSubtle,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.25)',
  },
  cacheNoticeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.warning,
  },

  // Liste des prises
  catchList: {
    marginHorizontal: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  catchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    gap: 13,
  },
  catchCardBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  catchInfo: {
    flex: 1,
    gap: 3,
  },
  catchTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  catchSpecies: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  catchSizeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: colors.surface2,
  },
  catchSizeText: {
    ...typography.label,
    color: colors.textMuted,
  },
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: colors.warningSubtle,
  },
  pendingBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.warning,
  },
  catchMeta: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  speciesDot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
    marginLeft: 4,
  },

  // État vide
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyStateIcon: {
    fontSize: 40,
    marginBottom: spacing.xs,
  },
  emptyStateTitle: {
    ...typography.h3,
    color: colors.textMuted,
  },
  emptyStateBody: {
    ...typography.bodySmall,
    color: colors.textSubtle,
    textAlign: 'center',
    lineHeight: 19,
  },
});
