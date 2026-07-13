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

import ConnectionBadge from '@/components/ConnectionBadge';
import LurePicker from '@/components/LurePicker';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { loadCatchesCache } from '@/lib/catchCache';
import { getPositionSafe } from '@/lib/locationSafe';
import { loadLuresWithCache, type UserLure } from '@/lib/lureStorage';
import { useNetworkStatus } from '@/lib/hooks/useNetworkStatus';
import { reverseGeocodeLakeName } from '@/lib/hooks/useLocation';
import { fetchWithTimeout, isOnline, withTimeout } from '@/lib/net';
import { enqueueOfflineCatch, getQueuedTripCatchCount } from '@/lib/offlineSync';
import { getSpeciesConfig, SPECIES_CONFIG } from '@/lib/species';
import { colors, radius, spacing, typography } from '@/lib/theme';
import {
  type Trip,
  deleteTripFromHistory,
  endActiveTrip,
  loadActiveTrip,
  generateTripId,
  loadLastCatchSettings,
  loadTripHistory,
  saveActiveTrip,
  saveLastCatchSettings,
  savePrefillTrip,
  syncLocalTripsToSupabase,
} from '@/lib/tripStorage';
import { supabase } from '@/lib/supabase';

type QuickCatchState = 'idle' | 'loading' | 'success';

async function fetchWeatherQuick(
  latitude: number,
  longitude: number,
): Promise<{ tempC: number | null; windKmh: number | null } | null> {
  const apiKey = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetchWithTimeout(
      `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&units=metric&appid=${apiKey}`,
      {},
      8000,
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

/** Nom du lac le plus proche (best-effort, null si indisponible ou hors-ligne). */
async function fetchGpsLakeNameQuick(): Promise<string | null> {
  try {
    // Le reverse geocoding exige le réseau — vérifier AVANT de payer un fix GPS
    if (!(await isOnline())) return null;
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const loc = await getPositionSafe();
    if (!loc) return null;
    return reverseGeocodeLakeName(loc.coords.latitude, loc.coords.longitude);
  } catch {
    return null;
  }
}

/**
 * Nombre de prises du voyage : par trip_id (+ prises en file offline).
 * Fallback par date (Date.parse, pas de comparaison lexicographique) pour les
 * entrées de cache écrites avant l'ajout du champ trip_id.
 */
async function countTripCatches(trip: Trip, userId: string | null): Promise<number | null> {
  if (!userId) return null;
  const queued = await getQueuedTripCatchCount(trip.id);
  try {
    if (await isOnline()) {
      const { count, error } = await withTimeout(
        supabase
          .from('catches')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('trip_id', trip.id),
        8000,
        'countTripCatches',
      );
      if (!error && typeof count === 'number') return count + queued;
    }
  } catch {}
  try {
    const cached = await loadCatchesCache(userId);
    if (cached) {
      const startedMs = Date.parse(trip.startedAt);
      const inTrip = cached.filter((c) =>
        c.trip_id !== undefined
          ? c.trip_id === trip.id
          : typeof c.caught_at === 'string' && Date.parse(c.caught_at) >= startedMs,
      ).length;
      return inTrip + queued;
    }
  } catch {}
  // Pas de source fiable : au moins la file offline si elle contient des prises du voyage
  return queued > 0 ? queued : null;
}

/** Jour calendaire du voyage (Jour 1 = jour de départ), en heure locale. */
function tripDayNumber(startedAt: string): number {
  const start = new Date(startedAt);
  const now = new Date();
  const startMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(1, Math.round((nowMidnight - startMidnight) / 86_400_000) + 1);
}

function formatTripDate(isoDate: string, locale: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatLakeNames(trip: Trip): string {
  return trip.lakes.map((l) => l.name).join(' · ') || '—';
}

export default function TripScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, cachedUserId } = useAuth();
  const { t } = useSettings();
  const isConnected = useNetworkStatus();

  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  // Miroir toujours à jour du voyage actif — lu par les callbacks en arrière-plan
  const activeTripRef = useRef<Trip | null>(null);
  activeTripRef.current = activeTrip;
  const [tripHistory, setTripHistory] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [quickState, setQuickState] = useState<QuickCatchState>('idle');
  const [ending, setEnding] = useState(false);
  const [startingTrip, setStartingTrip] = useState(false);
  const [tripCatchCount, setTripCatchCount] = useState<number | null>(null);
  const [quickSpecies, setQuickSpecies] = useState<string | null>(null);
  const [quickLure, setQuickLure] = useState<string | null>(null);
  const [userLures, setUserLures] = useState<UserLure[]>([]);
  const [showLurePickerForQuick, setShowLurePickerForQuick] = useState(false);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      const refresh = async () => {
        setLoading(true);
        setHistoryLoading(true);

        // Migrer les voyages locaux vers Supabase AVANT de charger, sinon
        // loadActiveTrip/loadTripHistory pourraient lire l'état serveur
        // périmé et écraser les voyages créés/terminés hors-ligne.
        if (isConnected === true) {
          try {
            await syncLocalTripsToSupabase();
          } catch (e) {
            console.warn('[TripScreen] syncLocalTrips error:', e);
          }
        }

        const [active, history] = await Promise.all([
          loadActiveTrip(),
          loadTripHistory(),
        ]);

        if (mounted) {
          setActiveTrip(active);
          setLoading(false);
          if (active) {
            const firstSpecies = active.lakes.flatMap((l) => l.targetSpecies)[0] ?? null;
            setQuickSpecies((prev) => prev ?? firstSpecies);
            setQuickLure((prev) => prev ?? active.luresSelected[0] ?? null);
            countTripCatches(active, user?.id ?? cachedUserId).then((count) => {
              if (mounted) setTripCatchCount(count);
            });
          } else {
            setTripCatchCount(null);
          }
          setTripHistory(history);
          setHistoryLoading(false);
        }
      };
      refresh();
      if (user?.id) loadLuresWithCache(user.id).then(setUserLures);
      return () => { mounted = false; };
    }, [user?.id, cachedUserId, isConnected]),
  );

  // ── Démarrage rapide : voyage créé immédiatement, lac résolu en arrière-plan ─
  const handleQuickStartTrip = async () => {
    if (startingTrip) return;
    setStartingTrip(true);
    try {
      const trip: Trip = {
        id: generateTripId(),
        startedAt: new Date().toISOString(),
        lakes: [],
        companions: [],
        luresSelected: [],
      };
      await saveActiveTrip(trip);
      const last = await loadLastCatchSettings();
      setActiveTrip(trip);
      setTripCatchCount(0);
      setQuickSpecies(last?.species ?? null);
      setQuickLure(last?.lure ?? null);

      // GPS + reverse geocoding en arrière-plan : ne bloque pas le démarrage
      fetchGpsLakeNameQuick()
        .then((lakeName) => {
          if (!lakeName) return;
          const current = activeTripRef.current;
          // Ne mettre à jour que si CE voyage est toujours actif et toujours sans lac
          if (!current || current.id !== trip.id || current.lakes.length > 0) return;
          const updated: Trip = { ...current, lakes: [{ name: lakeName, targetSpecies: [] }] };
          setActiveTrip(updated);
          saveActiveTrip(updated).catch((e) =>
            console.warn('[TripScreen] maj lac quick-start:', e),
          );
        })
        .catch(() => {});
    } catch (e) {
      console.warn('[TripScreen] handleQuickStartTrip error:', e);
      Alert.alert(t('common.error'), t('plan.startError'));
    } finally {
      setStartingTrip(false);
    }
  };

  const handleEndTrip = async () => {
    if (ending) return;
    setEnding(true);
    try {
      await endActiveTrip();
      setActiveTrip(null);
      const history = await loadTripHistory();
      setTripHistory(history);
    } catch (e) {
      console.warn('[TripScreen] handleEndTrip error:', e);
    } finally {
      setEnding(false);
    }
  };

  const handleRelaunch = async (trip: Trip) => {
    await savePrefillTrip(trip);
    router.push('/plan-trip');
  };

  const handleEditTrip = () => {
    router.push({ pathname: '/plan-trip', params: { mode: 'edit' } });
  };

  const handleOpenDetailCatch = () => {
    router.push({
      pathname: '/log-catch',
      params: {
        prefillSpecies: quickSpecies ?? '',
        prefillLure: quickLure ?? '',
        prefillTripId: activeTrip?.id ?? '',
        returnTo: 'trip',
      },
    });
  };

  const handleDeleteTrip = async (tripId: string) => {
    await deleteTripFromHistory(tripId);
    const history = await loadTripHistory();
    setTripHistory(history);
  };

  const handleQuickCatch = async () => {
    // Hors-ligne sans session : cachedUserId permet la mise en file d'attente
    const effectiveUserId = user?.id ?? cachedUserId;
    if (!effectiveUserId) return;
    setQuickState('loading');

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('log.locationTitle'), t('trip.gpsDenied'));
        setQuickState('idle');
        return;
      }

      const loc = await getPositionSafe();
      if (!loc) {
        Alert.alert(t('log.locationTitle'), t('trip.gpsNotFound'));
        setQuickState('idle');
        return;
      }

      const last = await loadLastCatchSettings();
      const species = quickSpecies ?? last?.species ?? null;

      if (!species) {
        Alert.alert(t('trip.missingSpeciesTitle'), t('trip.missingSpeciesBody'));
        setQuickState('idle');
        return;
      }

      const lure = quickLure ?? last?.lure ?? null;

      const online = await isOnline();

      let tempC: number | null = null;
      let windKmh: number | null = null;
      if (online) {
        try {
          const weather = await Promise.race([
            fetchWeatherQuick(loc.coords.latitude, loc.coords.longitude),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
          ]);
          if (weather) { tempC = weather.tempC; windKmh = weather.windKmh; }
        } catch {}
      }

      const payload = {
        user_id: effectiveUserId,
        map_id: null,
        trip_id: activeTrip?.id ?? null,
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

      if (!online || !user?.id) {
        // Hors-ligne → file d'attente directement, sans attendre un échec réseau
        await enqueueOfflineCatch({ payload, media: [] });
      } else {
        // En ligne : insert avec annulation réelle après 15 s
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          const { local_id: _lid, ...insertPayload } = payload;
          const { error } = await supabase
            .from('catches')
            .insert(insertPayload)
            .abortSignal(controller.signal);
          if (error) {
            await enqueueOfflineCatch({ payload, media: [] });
          }
        } catch {
          await enqueueOfflineCatch({ payload, media: [] });
        } finally {
          clearTimeout(timer);
        }
      }

      await saveLastCatchSettings({
        species,
        lure: lure ?? undefined,
        sizeCategory: last?.sizeCategory,
      });

      setQuickState('success');
      // Compteur inconnu (null) → le laisser inconnu plutôt que d'afficher un faux « 1 »
      setTripCatchCount((c) => (c == null ? c : c + 1));
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
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + 32 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.pageTitleRow}>
        <Text style={styles.pageTitle}>{t('trip.title')}</Text>
        <ConnectionBadge />
      </View>

      {activeTrip ? (
        <ActiveTripView
          trip={activeTrip}
          catchCount={tripCatchCount}
          quickState={quickState}
          ending={ending}
          quickSpecies={quickSpecies}
          quickLure={quickLure}
          onSelectSpecies={setQuickSpecies}
          onSelectLure={setQuickLure}
          onOpenLurePicker={() => setShowLurePickerForQuick(true)}
          onQuickCatch={handleQuickCatch}
          onOpenDetailCatch={handleOpenDetailCatch}
          onEndTrip={handleEndTrip}
          onEdit={handleEditTrip}
        />
      ) : (
        <>
          <TouchableOpacity
            style={[styles.quickStartButton, startingTrip && { opacity: 0.7 }]}
            onPress={startingTrip ? undefined : handleQuickStartTrip}
            activeOpacity={0.85}
          >
            {startingTrip ? (
              <ActivityIndicator color={colors.bg} size="small" />
            ) : (
              <>
                <Ionicons name="flash" size={22} color={colors.bg} />
                <Text style={styles.planButtonText}>{t('trip.quickStart')}</Text>
              </>
            )}
          </TouchableOpacity>
          <Text style={styles.quickStartHint}>{t('trip.quickStartHint')}</Text>

          <TouchableOpacity style={styles.planButton} onPress={() => router.push('/plan-trip')} activeOpacity={0.85}>
            <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
            <Text style={styles.planButtonTextOutline}>{t('trip.plan')}</Text>
          </TouchableOpacity>

          {tripHistory.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🎣</Text>
              <Text style={styles.emptyTitle}>{t('trip.emptyTitle')}</Text>
              <Text style={styles.emptySubtitle}>{t('trip.emptySub')}</Text>
            </View>
          )}
        </>
      )}

      {/* Historique — toujours visible */}
      <View style={styles.historySection}>
        <View style={styles.historySectionHeader}>
          <Ionicons name="time-outline" size={16} color={colors.accent} />
          <Text style={styles.sectionLabel}>{t('trip.history')}</Text>
        </View>
        {historyLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
        ) : tripHistory.length === 0 ? (
          <View style={styles.historyEmptyBox}>
            <Text style={styles.historyEmpty}>{t('trip.historyEmpty')}</Text>
            <Text style={styles.historyEmptySub}>{t('trip.historyEmptySub')}</Text>
          </View>
        ) : (
          tripHistory.map((trip) => (
            <TripHistoryCard
              key={trip.id}
              trip={trip}
              onRelaunch={() => handleRelaunch(trip)}
              onDelete={() => handleDeleteTrip(trip.id)}
            />
          ))
        )}
      </View>
    </ScrollView>
    <LurePicker
      visible={showLurePickerForQuick}
      selectedLureName={quickLure}
      userLures={userLures}
      onSelect={(lure) => { setQuickLure(lure.name); setShowLurePickerForQuick(false); }}
      onCreateNew={() => setShowLurePickerForQuick(false)}
      onClose={() => setShowLurePickerForQuick(false)}
    />
    </>
  );
}

// ─── Active trip view ─────────────────────────────────────────────────────────

function ActiveTripView({
  trip,
  catchCount,
  quickState,
  ending,
  quickSpecies,
  quickLure,
  onSelectSpecies,
  onSelectLure,
  onOpenLurePicker,
  onQuickCatch,
  onOpenDetailCatch,
  onEndTrip,
  onEdit,
}: {
  trip: Trip;
  catchCount: number | null;
  quickState: QuickCatchState;
  ending: boolean;
  quickSpecies: string | null;
  quickLure: string | null;
  onSelectSpecies: (s: string) => void;
  onSelectLure: (l: string) => void;
  onOpenLurePicker: () => void;
  onQuickCatch: () => void;
  onOpenDetailCatch: () => void;
  onEndTrip: () => void;
  onEdit: () => void;
}) {
  const { t, locale } = useSettings();
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  // Espèces disponibles : celles du voyage, sinon toutes (sauf site prometteur)
  const tripSpecies = [...new Set(trip.lakes.flatMap((l) => l.targetSpecies))];
  const speciesList = tripSpecies.length > 0
    ? tripSpecies
    : Object.keys(SPECIES_CONFIG).filter((s) => s !== 'Site prometteur');

  return (
    <View>
      <View style={styles.activeTripHeader}>
        <View style={styles.activeBadge}>
          <View style={styles.activeDot} />
          <Text style={styles.activeBadgeText}>{t('trip.active')}</Text>
        </View>
        <TouchableOpacity onPress={onEdit} style={styles.editTripButton} activeOpacity={0.75}>
          <Ionicons name="pencil-outline" size={14} color={colors.accent} />
          <Text style={styles.editTripText}>{t('detail.edit')}</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.tripDate}>{t('trip.since', { date: formatTripDate(trip.startedAt, locale) })}</Text>

      {/* Résumé du voyage : jour en cours + prises */}
      <View style={styles.tripStatsRow}>
        <View style={styles.tripStatPill}>
          <Ionicons name="calendar-outline" size={13} color={colors.accent} />
          <Text style={styles.tripStatText}>{t('trip.dayN', { n: tripDayNumber(trip.startedAt) })}</Text>
        </View>
        {catchCount != null && (
          <View style={styles.tripStatPill}>
            <Ionicons name="fish-outline" size={13} color={colors.accent} />
            <Text style={styles.tripStatText}>
              {catchCount === 1 ? t('trip.catch1') : t('trip.catchN', { n: catchCount })}
            </Text>
          </View>
        )}
      </View>

      {trip.lakes.length > 0 && (
        <InfoCard label={t('trip.lakes')} icon="map-outline">
          <View style={styles.chipRow}>
            {trip.lakes.map((lake) => (
              <View key={lake.name} style={styles.chip}>
                <Text style={styles.chipText}>{lake.name}</Text>
              </View>
            ))}
          </View>
        </InfoCard>
      )}

      {trip.companions.length > 0 && (
        <InfoCard label={t('trip.companions')} icon="people-outline">
          <View style={styles.chipRow}>
            {trip.companions.map((c) => (
              <View key={c} style={styles.chip}>
                <Text style={styles.chipText}>{c}</Text>
              </View>
            ))}
          </View>
        </InfoCard>
      )}

      {trip.notes ? (
        <InfoCard label={t('trip.notes')} icon="document-text-outline">
          <Text style={styles.notesText}>{trip.notes}</Text>
        </InfoCard>
      ) : null}

      {/* ── Sélection prise rapide ─────────────────────────────────── */}
      <InfoCard label={t('trip.quick')} icon="flash-outline">
        <Text style={styles.quickSelectLabel}>{t('trip.species')}</Text>
        <View style={styles.chipRow}>
          {speciesList.map((s) => {
            const cfg = getSpeciesConfig(s);
            const isSelected = quickSpecies === s;
            return (
              <TouchableOpacity
                key={s}
                style={[styles.chip, isSelected && { backgroundColor: cfg.bgColor, borderColor: cfg.color }]}
                onPress={() => onSelectSpecies(s)}
                activeOpacity={0.75}
              >
                {isSelected && <Ionicons name="checkmark" size={11} color={cfg.color} />}
                <Text style={[styles.chipText, isSelected && { color: cfg.color, fontWeight: '600' }]}>{s}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.quickSelectLabel, { marginTop: spacing.md }]}>{t('trip.lure')}</Text>
        <View style={styles.chipRow}>
          {trip.luresSelected.map((name) => {
            const isSelected = quickLure === name;
            return (
              <TouchableOpacity
                key={name}
                style={[styles.chip, isSelected && { backgroundColor: colors.accentSubtle, borderColor: colors.accent }]}
                onPress={() => onSelectLure(name)}
                activeOpacity={0.75}
              >
                {isSelected && <Ionicons name="checkmark" size={11} color={colors.accent} />}
                <Text style={[styles.chipText, isSelected && { color: colors.accent, fontWeight: '600' }]}>🪝 {name}</Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity style={styles.chip} onPress={onOpenLurePicker} activeOpacity={0.75}>
            <Ionicons name="add" size={13} color={colors.accent} />
            <Text style={[styles.chipText, { color: colors.accent }]}>{t('common.other')}</Text>
          </TouchableOpacity>
        </View>
      </InfoCard>

      <View style={styles.quickCatchRow}>
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
              <Text style={styles.quickButtonText}>{t('trip.quickSaved')}</Text>
            </>
          ) : (
            <>
              <Ionicons name="fish" size={24} color={colors.bg} />
              <Text style={styles.quickButtonText}>{t('trip.quickBtn')}</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.detailCatchButton} onPress={onOpenDetailCatch} activeOpacity={0.85}>
          <Ionicons name="create-outline" size={22} color={colors.accent} />
        </TouchableOpacity>
      </View>

      {confirmingEnd ? (
        <View style={styles.endTripConfirmRow}>
          <TouchableOpacity style={styles.cancelConfirmButton} onPress={() => setConfirmingEnd(false)} activeOpacity={0.75}>
            <Text style={styles.cancelConfirmText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.confirmEndButton, ending && { opacity: 0.6 }]}
            onPress={() => { if (!ending) { setConfirmingEnd(false); onEndTrip(); } }}
            activeOpacity={0.75}
          >
            {ending
              ? <ActivityIndicator size="small" color={colors.bg} />
              : <Text style={styles.confirmEndText}>{t('common.confirm')}</Text>
            }
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.endTripButton} onPress={() => setConfirmingEnd(true)} activeOpacity={0.75}>
          <Text style={styles.endTripText}>{t('trip.end')}</Text>
        </TouchableOpacity>
      )}
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

function TripHistoryCard({ trip, onRelaunch, onDelete }: { trip: Trip; onRelaunch: () => void; onDelete: () => void }) {
  const { t, locale } = useSettings();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const lakeNames = formatLakeNames(trip);
  const companionsText = trip.companions.length > 0 ? trip.companions.join(', ') : t('trip.solo');
  const allSpecies = [...new Set(trip.lakes.flatMap((l) => l.targetSpecies))];

  return (
    <View style={styles.historyCard}>
      <View style={styles.historyCardHeader}>
        <Text style={styles.historyDate}>{formatTripDate(trip.startedAt, locale)}</Text>
        <View style={styles.historyCardActions}>
          <TouchableOpacity onPress={onRelaunch} style={styles.relaunchButton} activeOpacity={0.75}>
            <Ionicons name="refresh-outline" size={14} color={colors.accent} />
            <Text style={styles.relaunchText}>{t('trip.relaunch')}</Text>
          </TouchableOpacity>
          {confirmingDelete ? (
            <TouchableOpacity onPress={() => { setConfirmingDelete(false); onDelete(); }} style={styles.deleteConfirmButton} activeOpacity={0.75}>
              <Text style={styles.deleteConfirmText}>{t('trip.deleteConfirm')}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => setConfirmingDelete(true)} style={styles.deleteButton} activeOpacity={0.75} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="trash-outline" size={15} color={colors.error} />
            </TouchableOpacity>
          )}
        </View>
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
  pageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  pageTitle: {
    ...typography.h2,
    color: colors.textPrimary,
  },

  // Quick start (action principale)
  quickStartButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  quickStartHint: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },

  // Plan button (action secondaire)
  planButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accent + '50',
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  planButtonText: {
    ...typography.h3,
    color: colors.bg,
    fontWeight: '700',
  },
  planButtonTextOutline: {
    ...typography.h3,
    color: colors.accent,
    fontWeight: '700',
  },

  // Trip stats (voyage actif)
  tripStatsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  tripStatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.accent + '40',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  tripStatText: {
    ...typography.bodySmall,
    color: colors.accent,
    fontWeight: '600',
  },

  // Section label
  sectionLabel: {
    ...typography.caption,
    color: colors.accent,
    marginBottom: spacing.md,
  },

  // Active trip
  activeTripHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  editTripButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.accent + '50',
  },
  editTripText: {
    ...typography.label,
    color: colors.accent,
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
    marginBottom: spacing.sm,
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

  // Quick catch row
  quickCatchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  detailCatchButton: {
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },

  // Quick catch button
  quickButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg + 4,
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

  quickSelectLabel: {
    ...typography.caption,
    color: colors.accent,
    marginBottom: spacing.sm,
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
  endTripConfirmRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  cancelConfirmButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelConfirmText: {
    ...typography.body,
    color: colors.textMuted,
  },
  confirmEndButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.error,
  },
  confirmEndText: {
    ...typography.body,
    color: colors.bg,
    fontWeight: '600' as const,
  },

  // History card
  historySection: {
    marginTop: spacing.xxl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.xl,
  },
  historySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  historyEmptyBox: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  historyEmpty: {
    ...typography.body,
    color: colors.textMuted,
  },
  historyEmptySub: {
    ...typography.bodySmall,
    color: colors.textSubtle,
    marginTop: spacing.xs,
  },

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
  historyCardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  deleteButton: {
    padding: 4,
  },
  deleteConfirmButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: colors.error + '20',
    borderWidth: 1,
    borderColor: colors.error + '50',
  },
  deleteConfirmText: {
    ...typography.label,
    color: colors.error,
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
