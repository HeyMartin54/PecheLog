import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { enqueueOfflineCatch } from '@/lib/offlineSync';
import { getSpeciesConfig } from '@/lib/species';
import { colors, radius, spacing, typography } from '@/lib/theme';
import {
  type Trip,
  endActiveTrip,
  loadActiveTrip,
  loadLastCatchSettings,
  loadTripHistory,
  saveLastCatchSettings,
  savePrefillTrip,
} from '@/lib/tripStorage';
import { supabase } from '@/lib/supabase';
import { getLureByName } from '@/lib/lures';

type QuickCatchState = 'idle' | 'loading' | 'success';

async function fetchWeatherQuick(
  latitude: number,
  longitude: number,
): Promise<{ tempC: number | null; windKmh: number | null } | null> {
  const apiKey = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&units=metric&appid=${apiKey}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const tempC = typeof data?.main?.temp === 'number' ? data.main.temp : null;
    const windMs = typeof data?.wind?.speed === 'number' ? data.wind.speed : null;
    return { tempC, windKmh: windMs != null ? windMs * 3.6 : null };
  } catch {
    return null;
  }
}

function formatTripDate(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatLakeNames(trip: Trip): string {
  return trip.lakes.map((l) => l.name).join(' · ') || '—';
}

export default function TripScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [tripHistory, setTripHistory] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [quickState, setQuickState] = useState<QuickCatchState>('idle');
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      const refresh = async () => {
        setLoading(true);
        const [active, history] = await Promise.all([loadActiveTrip(), loadTripHistory()]);
        if (mounted) {
          setActiveTrip(active);
          setTripHistory(history);
          setLoading(false);
        }
      };
      refresh();
      return () => { mounted = false; };
    }, []),
  );

  const handleEndTrip = () => {
    Alert.alert(
      'Terminer le voyage',
      'Es-tu sûr de vouloir terminer ce voyage ? Il sera archivé dans ton historique.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Terminer',
          style: 'destructive',
          onPress: async () => {
            await endActiveTrip();
            setActiveTrip(null);
            const history = await loadTripHistory();
            setTripHistory(history);
          },
        },
      ],
    );
  };

  const handleRelaunch = async (trip: Trip) => {
    await savePrefillTrip(trip);
    router.push('/plan-trip');
  };

  const handleQuickCatch = async () => {
    if (!user?.id) return;
    setQuickState('loading');

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Localisation', 'Permission GPS refusée.');
        setQuickState('idle');
        return;
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const last = await loadLastCatchSettings();
      let species = last?.species;

      if (!species && activeTrip) {
        for (const lake of activeTrip.lakes) {
          if (lake.targetSpecies.length > 0) {
            species = lake.targetSpecies[0];
            break;
          }
        }
      }

      if (!species) {
        Alert.alert(
          'Espèce manquante',
          "Utilise d'abord le formulaire complet pour enregistrer une prise, ou ajoute des espèces cibles à ton voyage.",
        );
        setQuickState('idle');
        return;
      }

      const lure = last?.lure ?? (activeTrip?.luresSelected?.[0] ?? null);

      let tempC: number | null = null;
      let windKmh: number | null = null;
      try {
        const weather = await Promise.race([
          fetchWeatherQuick(loc.coords.latitude, loc.coords.longitude),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);
        if (weather) { tempC = weather.tempC; windKmh = weather.windKmh; }
      } catch {}

      const payload = {
        user_id: user.id,
        map_id: null,
        species,
        lure,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        lake_name: null,
        depth_meters: null,
        depth_source: null,
        temperature_c: tempC,
        wind_speed_kmh: windKmh,
        wind_direction_deg: null,
        speed_kmh: null,
        weather_conditions: null,
        size_category: last?.sizeCategory ?? null,
        weight_lbs: null,
        length_inches: null,
        notes: null,
        caught_at: new Date().toISOString(),
        local_id: `local_${Date.now()}`,
      };

      const { local_id: _lid, ...insertPayload } = payload;
      const { error } = await supabase.from('catches').insert(insertPayload);
      if (error) {
        await enqueueOfflineCatch({ payload, media: [] });
      }

      await saveLastCatchSettings({
        species,
        lure: lure ?? undefined,
        sizeCategory: last?.sizeCategory,
      });

      setQuickState('success');
      if (successTimer.current) clearTimeout(successTimer.current);
      successTimer.current = setTimeout(() => setQuickState('idle'), 2500);
    } catch (e) {
      console.warn('[QuickCatch] Erreur', e);
      setQuickState('idle');
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + 32 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.pageTitle}>Voyage de pêche</Text>

      {activeTrip ? (
        <ActiveTripView
          trip={activeTrip}
          quickState={quickState}
          onQuickCatch={handleQuickCatch}
          onEndTrip={handleEndTrip}
        />
      ) : (
        <>
          <TouchableOpacity style={styles.planButton} onPress={() => router.push('/plan-trip')} activeOpacity={0.85}>
            <Ionicons name="add-circle-outline" size={22} color={colors.bg} />
            <Text style={styles.planButtonText}>Planifier un voyage</Text>
          </TouchableOpacity>

          {tripHistory.length > 0 && (
            <View style={{ marginTop: spacing.xl }}>
              <Text style={styles.sectionLabel}>DERNIERS VOYAGES</Text>
              {tripHistory.map((trip) => (
                <TripHistoryCard key={trip.id} trip={trip} onRelaunch={() => handleRelaunch(trip)} />
              ))}
            </View>
          )}

          {tripHistory.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🎣</Text>
              <Text style={styles.emptyTitle}>Ton premier voyage t'attend</Text>
              <Text style={styles.emptySubtitle}>
                Planifie un voyage pour pré-remplir tes infos et enregistrer tes prises d'un seul clic.
              </Text>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ─── Active trip view ─────────────────────────────────────────────────────────

function ActiveTripView({
  trip,
  quickState,
  onQuickCatch,
  onEndTrip,
}: {
  trip: Trip;
  quickState: QuickCatchState;
  onQuickCatch: () => void;
  onEndTrip: () => void;
}) {
  const allSpecies = trip.lakes.flatMap((l) => l.targetSpecies);
  const uniqueSpecies = [...new Set(allSpecies)];

  return (
    <View>
      <View style={styles.activeBadge}>
        <View style={styles.activeDot} />
        <Text style={styles.activeBadgeText}>VOYAGE EN COURS</Text>
      </View>
      <Text style={styles.tripDate}>Depuis le {formatTripDate(trip.startedAt)}</Text>

      <InfoCard label="LACS VISITÉS" icon="map-outline">
        <View style={styles.chipRow}>
          {trip.lakes.map((lake) => (
            <View key={lake.name} style={styles.chip}>
              <Text style={styles.chipText}>{lake.name}</Text>
            </View>
          ))}
        </View>
      </InfoCard>

      {trip.companions.length > 0 && (
        <InfoCard label="COMPAGNONS" icon="people-outline">
          <View style={styles.chipRow}>
            {trip.companions.map((c) => (
              <View key={c} style={styles.chip}>
                <Text style={styles.chipText}>{c}</Text>
              </View>
            ))}
          </View>
        </InfoCard>
      )}

      {uniqueSpecies.length > 0 && (
        <InfoCard label="ESPÈCES CIBLES" icon="fish-outline">
          <View style={styles.chipRow}>
            {uniqueSpecies.map((s) => {
              const cfg = getSpeciesConfig(s);
              return (
                <View key={s} style={[styles.chip, { backgroundColor: cfg.bgColor, borderColor: cfg.color + '40' }]}>
                  <Text style={[styles.chipText, { color: cfg.color }]}>{s}</Text>
                </View>
              );
            })}
          </View>
        </InfoCard>
      )}

      {trip.luresSelected.length > 0 && (
        <InfoCard label="LEURRES AMENÉS" icon="ellipsis-horizontal-circle-outline">
          <View style={styles.chipRow}>
            {trip.luresSelected.map((name) => {
              const lure = getLureByName(name);
              return (
                <View key={name} style={styles.chip}>
                  <Text style={styles.chipText}>{lure?.emoji ?? '🪝'} {name}</Text>
                </View>
              );
            })}
          </View>
        </InfoCard>
      )}

      {trip.notes ? (
        <InfoCard label="NOTES" icon="document-text-outline">
          <Text style={styles.notesText}>{trip.notes}</Text>
        </InfoCard>
      ) : null}

      <TouchableOpacity
        style={[styles.quickButton, quickState === 'success' && styles.quickButtonSuccess]}
        onPress={quickState === 'idle' ? onQuickCatch : undefined}
        activeOpacity={0.85}
      >
        {quickState === 'loading' ? (
          <ActivityIndicator color={colors.bg} size="small" />
        ) : quickState === 'success' ? (
          <>
            <Ionicons name="checkmark-circle" size={24} color={colors.bg} />
            <Text style={styles.quickButtonText}>Prise enregistrée !</Text>
          </>
        ) : (
          <>
            <Ionicons name="fish" size={24} color={colors.bg} />
            <Text style={styles.quickButtonText}>Prise rapide</Text>
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.endTripButton} onPress={onEndTrip} activeOpacity={0.75}>
        <Text style={styles.endTripText}>Terminer le voyage</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Info card ────────────────────────────────────────────────────────────────

function InfoCard({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  children: React.ReactNode;
}) {
  return (
    <View style={styles.infoCard}>
      <View style={styles.infoCardHeader}>
        <Ionicons name={icon} size={14} color={colors.accent} />
        <Text style={styles.infoCardLabel}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

// ─── History card ─────────────────────────────────────────────────────────────

function TripHistoryCard({ trip, onRelaunch }: { trip: Trip; onRelaunch: () => void }) {
  const lakeNames = formatLakeNames(trip);
  const companionsText = trip.companions.length > 0 ? trip.companions.join(', ') : 'Seul(e)';
  const allSpecies = [...new Set(trip.lakes.flatMap((l) => l.targetSpecies))];

  return (
    <View style={styles.historyCard}>
      <View style={styles.historyCardHeader}>
        <Text style={styles.historyDate}>{formatTripDate(trip.startedAt)}</Text>
        <TouchableOpacity onPress={onRelaunch} style={styles.relaunchButton} activeOpacity={0.75}>
          <Ionicons name="refresh-outline" size={14} color={colors.accent} />
          <Text style={styles.relaunchText}>Relancer</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.historyLakes}>{lakeNames}</Text>
      <Text style={styles.historyMeta}>{companionsText}</Text>

      {allSpecies.length > 0 && (
        <View style={styles.chipRow}>
          {allSpecies.slice(0, 4).map((s) => {
            const cfg = getSpeciesConfig(s);
            return (
              <View key={s} style={[styles.chipSmall, { borderColor: cfg.color + '40' }]}>
                <Text style={[styles.chipSmallText, { color: cfg.color }]}>{cfg.code}</Text>
              </View>
            );
          })}
          {allSpecies.length > 4 && (
            <Text style={styles.historyMeta}>+{allSpecies.length - 4}</Text>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    paddingHorizontal: spacing.lg,
  },
  pageTitle: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: spacing.xl,
  },

  // Plan button
  planButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  planButtonText: {
    ...typography.h3,
    color: colors.bg,
    fontWeight: '700',
  },

  // Section label
  sectionLabel: {
    ...typography.caption,
    color: colors.accent,
    marginBottom: spacing.md,
  },

  // Active trip
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  activeBadgeText: {
    ...typography.caption,
    color: colors.success,
  },
  tripDate: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },

  // Info card
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  infoCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  infoCardLabel: {
    ...typography.caption,
    color: colors.accent,
  },
  notesText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },

  // Chips
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    backgroundColor: colors.surface2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipText: {
    ...typography.bodySmall,
    color: colors.textPrimary,
  },
  chipSmall: {
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chipSmallText: {
    ...typography.label,
  },

  // Quick catch button
  quickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg + 4,
    marginTop: spacing.lg,
    ...{
      shadowColor: colors.accent,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35,
      shadowRadius: 16,
      elevation: 8,
    },
  },
  quickButtonSuccess: {
    backgroundColor: colors.success,
  },
  quickButtonText: {
    ...typography.h3,
    color: colors.bg,
    fontWeight: '700',
  },

  // End trip
  endTripButton: {
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
  },
  endTripText: {
    ...typography.body,
    color: colors.error,
  },

  // History card
  historyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  historyCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  historyDate: {
    ...typography.label,
    color: colors.textMuted,
  },
  historyLakes: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  historyMeta: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  relaunchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.accent + '50',
  },
  relaunchText: {
    ...typography.label,
    color: colors.accent,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    marginTop: spacing.xxxl,
    paddingHorizontal: spacing.xl,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
});
