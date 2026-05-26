import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ConnectionBadge from '@/components/ConnectionBadge';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from '@/lib/hooks/useLocation';
import { useNetworkStatus } from '@/lib/hooks/useNetworkStatus';
import { useWeather } from '@/lib/hooks/useWeather';
import { supabase } from '@/lib/supabase';
import { CATCH_SELECT_ALL, loadCatchesCache, saveCatchesCache } from '@/lib/catchCache';
import { colors, typography, spacing, radius, shadow } from '@/lib/theme';
import { getSpeciesConfig } from '@/lib/species';

type Stat = {
  label: string;
  value: string;
  icon: string;
};

type CatchRow = {
  id: string;
  species: string;
  lake_name: string | null;
  lure: string | null;
  weight_lbs: number | null;
  caught_at: string;
};

function formatRelativeTimeFr(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffM = Math.floor(diffMs / 60000);
  if (diffM < 1) return "à l'instant";
  if (diffM < 60) return `il y a ${diffM} min`;
  const diffH = Math.floor(diffM / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'hier';
  if (diffD < 7) return `il y a ${diffD} j`;
  return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
}

function catchMetaLine(row: CatchRow): string {
  const lake = row.lake_name?.trim() || 'Lieu inconnu';
  const when = formatRelativeTimeFr(row.caught_at);
  const lure = row.lure?.trim();
  return lure ? `${lake} · ${when} · ${lure}` : `${lake} · ${when}`;
}

function sizeLabel(row: CatchRow): string {
  if (row.weight_lbs != null && !Number.isNaN(row.weight_lbs)) {
    return `${row.weight_lbs.toFixed(1)} lb`;
  }
  return '';
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
  const { user, cachedUserId } = useAuth();
  const insets = useSafeAreaInsets();
  const { coords, lakeName } = useLocation();
  const { temperatureC, windKmh, windDirection } = useWeather(
    coords?.coords.latitude ?? null,
    coords?.coords.longitude ?? null,
  );
  const isConnected = useNetworkStatus();

  const [displayName, setDisplayName] = useState<string>('Pêcheur');
  const [stats, setStats] = useState<Stat[]>([
    { label: 'Prises', value: '—', icon: 'fish' },
    { label: 'Lacs', value: '—', icon: 'water' },
    { label: 'lb record', value: '—', icon: 'trophy' },
  ]);
  const [recentCatches, setRecentCatches] = useState<CatchRow[]>([]);
  const [homeDataLoading, setHomeDataLoading] = useState(false);
  const [fromCache, setFromCache] = useState(false);

  const applyList = (list: CatchRow[]) => {
    const lakeSet = new Set(
      list.map((r) => r.lake_name?.trim()).filter((n): n is string => !!n?.length),
    );
    const weights = list
      .map((r) => r.weight_lbs)
      .filter((w): w is number => typeof w === 'number' && !Number.isNaN(w));
    const recordLb = weights.length > 0 ? Math.max(...weights) : null;

    setStats([
      { label: 'Prises', value: String(list.length), icon: 'fish' },
      { label: 'Lacs', value: String(lakeSet.size), icon: 'water' },
      {
        label: 'lb record',
        value: recordLb != null ? recordLb.toFixed(1) : '—',
        icon: 'trophy',
      },
    ]);
    setRecentCatches(list.slice(0, 5));
  };

  const loadHomeData = useCallback(async () => {
    const effectiveUserId = user?.id ?? cachedUserId;
    if (!effectiveUserId) return;
    setHomeDataLoading(true);

    // Pas de session active ou hors-ligne → toujours utiliser le cache
    if (!user?.id || isConnected === false) {
      const cached = await loadCatchesCache(effectiveUserId);
      if (cached) {
        applyList(cached as CatchRow[]);
        setFromCache(true);
      }
      setHomeDataLoading(false);
      return;
    }

    setFromCache(false);
    try {
      if (user?.id) {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', user.id)
          .maybeSingle();

        if (profileError) {
          console.warn('[Home] Erreur profil', profileError);
        } else if (profile?.display_name?.trim()) {
          setDisplayName(profile.display_name.trim());
        } else if (user.email) {
          setDisplayName(user.email.split('@')[0] ?? 'Pêcheur');
        }
      }

      const { data: rows, error: catchesError } = await supabase
        .from('catches')
        .select(CATCH_SELECT_ALL)
        .eq('user_id', effectiveUserId)
        .order('caught_at', { ascending: false });

      if (catchesError) {
        console.warn('[Home] Erreur prises', catchesError);
        // Fallback cache si erreur réseau inattendue
        const cached = await loadCatchesCache(effectiveUserId);
        if (cached) { applyList(cached as CatchRow[]); setFromCache(true); }
        return;
      }

      const list = rows ?? [];
      applyList(list as CatchRow[]);
      // Sauvegarder dans le cache pour la prochaine utilisation hors-ligne
      await saveCatchesCache(effectiveUserId, list as never);
    } finally {
      setHomeDataLoading(false);
    }
  }, [user?.id, user?.email, cachedUserId, isConnected]);

  useFocusEffect(
    useCallback(() => {
      loadHomeData().catch(console.warn);
    }, [loadHomeData]),
  );

  const headerLakeName = lakeName ?? 'Lac inconnu';
  const headerTemp =
    temperatureC != null ? `${temperatureC.toFixed(1)}°C` : null;
  const headerWind =
    windKmh != null
      ? `${windDirection ? windDirection + ' ' : ''}${windKmh.toFixed(1)} km/h`
      : null;

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
              <Text style={styles.greeting}>Bonjour 👋</Text>
              <Text style={styles.name}>{displayName}</Text>
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
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text style={styles.weatherBadgeText}>Météo…</Text>
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
            <Text style={styles.quickLogTitle}>Nouvelle prise !</Text>
            <Text style={styles.quickLogSubtitle}>1 bouton — on s'occupe du reste</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={`${colors.bg}AA`} />
        </TouchableOpacity>

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
          <Text style={styles.sectionTitle}>Prises récentes</Text>
          {fromCache ? (
            <View style={styles.cacheNotice}>
              <Ionicons name="cloud-offline-outline" size={11} color={colors.warning} />
              <Text style={styles.cacheNoticeText}>Données locales</Text>
            </View>
          ) : (
            <TouchableOpacity>
              <Text style={styles.sectionLink}>Voir tout</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.catchList}>
          {recentCatches.length === 0 && !homeDataLoading ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateIcon}>🎣</Text>
              <Text style={styles.emptyStateTitle}>Aucune prise encore</Text>
              <Text style={styles.emptyStateBody}>
                Enregistre ta première prise avec le bouton ci-dessus.
              </Text>
            </View>
          ) : (
            recentCatches.map((catchItem, index) => {
              const size = sizeLabel(catchItem);
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
                      {size ? (
                        <View style={styles.catchSizeBadge}>
                          <Text style={styles.catchSizeText}>{size}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.catchMeta} numberOfLines={1}>
                      {catchMetaLine(catchItem)}
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
