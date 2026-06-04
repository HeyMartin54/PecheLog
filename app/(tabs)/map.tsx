import { useCallback, useMemo, useRef, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { useNetworkStatus } from '@/lib/hooks/useNetworkStatus';
import { useSpeciesColors } from '@/lib/hooks/useSpeciesColors';
import { supabase } from '@/lib/supabase';
import { CATCH_SELECT_ALL, loadCatchesCache, saveCatchesCache } from '@/lib/catchCache';
import { colors } from '@/lib/theme';

// ─── Types ───────────────────────────────────────────────────────────────────

type CatchPin = {
  id: string;
  species: string;
  latitude: number;
  longitude: number;
  lake_name: string | null;
  lure: string | null;
  weight_lbs: number | null;
  size_category: string | null;
  weather_conditions: string | null;
  caught_at: string;
};

type FilterState = {
  species: string[];
  lures: string[];
  dateFrom: Date | null;
  dateTo: Date | null;
  weather: string[];
};

type FilterPanel = 'species' | 'lure' | 'dates' | 'weather' | null;

type Cluster = {
  id: string;
  latitude: number;
  longitude: number;
  catches: CatchPin[];
  speciesCounts: Record<string, number>;
};

const EMPTY_FILTERS: FilterState = { species: [], lures: [], dateFrom: null, dateTo: null, weather: [] };

// ─── Constantes ──────────────────────────────────────────────────────────────

const WEATHER_OPTIONS = ['☀️ Ensoleillé', '⛅ Nuageux', '🌧️ Pluie', '💨 Vent', '❄️ Froid'];

// ─── Helpers ─────────────────────────────────────────────────────────────────


function formatDateFr(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-CA', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}


function computeRegion(pins: CatchPin[]): Region | null {
  if (pins.length === 0) return null;
  const lats = pins.map((p) => p.latitude);
  const lngs = pins.map((p) => p.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.05),
    longitudeDelta: Math.max((maxLng - minLng) * 1.5, 0.05),
  };
}

function countActiveFilters(f: FilterState): number {
  return f.species.length + f.lures.length + (f.dateFrom ? 1 : 0) + (f.dateTo ? 1 : 0) + f.weather.length;
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
}

function toggleItem(arr: string[], item: string): string[] {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}

function clusterCatches(catches: CatchPin[], latDelta: number, lngDelta: number): Cluster[] {
  // Au zoom maximum, afficher tous les points individuellement
  if (latDelta < 0.005) {
    return catches.map((c) => ({
      id: c.id,
      latitude: c.latitude,
      longitude: c.longitude,
      catches: [c],
      speciesCounts: { [c.species]: 1 },
    }));
  }
  const latR = latDelta * 0.08;
  const lngR = lngDelta * 0.08;
  const visited = new Set<string>();
  const clusters: Cluster[] = [];
  for (const c of catches) {
    if (visited.has(c.id)) continue;
    const nearby = catches.filter((o) => {
      if (visited.has(o.id)) return false;
      return Math.abs(o.latitude - c.latitude) < latR && Math.abs(o.longitude - c.longitude) < lngR;
    });
    nearby.forEach((o) => visited.add(o.id));
    const avgLat = nearby.reduce((s, o) => s + o.latitude, 0) / nearby.length;
    const avgLng = nearby.reduce((s, o) => s + o.longitude, 0) / nearby.length;
    const speciesCounts: Record<string, number> = {};
    nearby.forEach((o) => { speciesCounts[o.species] = (speciesCounts[o.species] ?? 0) + 1; });
    clusters.push({
      id: nearby.map((o) => o.id).join('|'),
      latitude: avgLat,
      longitude: avgLng,
      catches: nearby,
      speciesCounts,
    });
  }
  return clusters;
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function MapScreen() {
  const router = useRouter();
  const { user, cachedUserId } = useAuth();
  const isConnected = useNetworkStatus();
  const insets = useSafeAreaInsets();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);

  const { getColor } = useSpeciesColors();

  const [catches, setCatches] = useState<CatchPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [satellite, setSatellite] = useState(false);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [openPanel, setOpenPanel] = useState<FilterPanel>(null);
  const [showDatePicker, setShowDatePicker] = useState<'from' | 'to' | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [selectedCatch, setSelectedCatch] = useState<CatchPin | null>(null);
  const [mapDeltas, setMapDeltas] = useState({ lat: 8, lng: 8 });

  // ─── Chargement ────────────────────────────────────────────────────────────

  const loadCatches = useCallback(async () => {
    const userId = user?.id ?? cachedUserId;
    if (!userId) return;
    setLoading(true);

    // Pas de session active ou hors-ligne → toujours utiliser le cache
    if (!user?.id || isConnected === false) {
      const cached = await loadCatchesCache(userId);
      if (cached) {
        const valid = cached.filter(
          (c) => typeof c.latitude === 'number' && typeof c.longitude === 'number',
        ) as CatchPin[];
        setCatches(valid);
        setFromCache(true);
        const region = computeRegion(valid);
        if (region) setTimeout(() => mapRef.current?.animateToRegion(region, 700), 400);
      }
      setLoading(false);
      return;
    }

    setFromCache(false);
    try {
      const { data, error } = await supabase
        .from('catches')
        .select(CATCH_SELECT_ALL)
        .eq('user_id', userId)
        .order('caught_at', { ascending: false });

      if (error) {
        console.warn('[Map] Erreur', error);
        // Fallback cache si erreur réseau inattendue
        const cached = await loadCatchesCache(userId);
        if (cached) {
          const valid = cached.filter(
            (c) => typeof c.latitude === 'number' && typeof c.longitude === 'number',
          ) as CatchPin[];
          setCatches(valid);
          setFromCache(true);
          const region = computeRegion(valid);
          if (region) setTimeout(() => mapRef.current?.animateToRegion(region, 700), 400);
        }
        return;
      }

      const valid = (data ?? []).filter(
        (c) => typeof c.latitude === 'number' && typeof c.longitude === 'number',
      );
      setCatches(valid);
      setFromCache(false);

      // Sauvegarder dans le cache
      await saveCatchesCache(userId, data as never);

      const region = computeRegion(valid);
      if (region) setTimeout(() => mapRef.current?.animateToRegion(region, 700), 400);
    } finally {
      setLoading(false);
    }
  }, [user?.id, cachedUserId, isConnected]);

  useFocusEffect(useCallback(() => { loadCatches().catch(console.warn); }, [loadCatches]));

  // ─── Listes dynamiques pour les filtres ────────────────────────────────────

  const lureList = useMemo(
    () => Array.from(new Set(catches.map((c) => c.lure).filter(Boolean) as string[])).sort(),
    [catches],
  );

  const weatherList = useMemo(
    () => Array.from(new Set(catches.map((c) => c.weather_conditions).filter(Boolean) as string[])).sort(),
    [catches],
  );

  const speciesList = useMemo(
    () => Array.from(new Set(catches.map((c) => c.species))).sort(),
    [catches],
  );

  // ─── Filtrage ──────────────────────────────────────────────────────────────

  const visibleCatches = useMemo(() => {
    let list = catches;
    if (filters.species.length > 0)
      list = list.filter((c) => filters.species.includes(c.species));
    if (filters.lures.length > 0)
      list = list.filter((c) => c.lure && filters.lures.includes(c.lure));
    if (filters.dateFrom)
      list = list.filter((c) => new Date(c.caught_at) >= filters.dateFrom!);
    if (filters.dateTo) {
      const end = new Date(filters.dateTo); end.setHours(23, 59, 59, 999);
      list = list.filter((c) => new Date(c.caught_at) <= end);
    }
    if (filters.weather.length > 0)
      list = list.filter((c) => c.weather_conditions && filters.weather.includes(c.weather_conditions));
    return list;
  }, [catches, filters]);

  const activeCount = countActiveFilters(filters);

  const clusters = useMemo(
    () => clusterCatches(visibleCatches, mapDeltas.lat, mapDeltas.lng),
    [visibleCatches, mapDeltas],
  );

  // ─── Panneau de filtre ─────────────────────────────────────────────────────

  const FilterPanelContent = () => {
    if (openPanel === 'species') {
      return (
        <View style={styles.panelSection}>
          <Text style={styles.panelTitle}>Espèce</Text>
          <View style={styles.panelChips}>
            {speciesList.map((s) => {
              const active = filters.species.includes(s);
              return (
                <TouchableOpacity
                  key={s}
                  style={[styles.pChip, active && { backgroundColor: 'rgba(0,230,181,0.15)', borderColor: getColor(s) }]}
                  onPress={() => setFilters((f) => ({ ...f, species: toggleItem(f.species, s) }))}
                  activeOpacity={0.8}
                >
                  <View style={[styles.pChipDot, { backgroundColor: getColor(s) }]} />
                  <Text style={[styles.pChipText, active && styles.pChipTextActive]}>{s}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      );
    }

    if (openPanel === 'lure') {
      return (
        <View style={styles.panelSection}>
          <Text style={styles.panelTitle}>Leurre</Text>
          {lureList.length === 0 ? (
            <Text style={styles.panelEmpty}>Aucun leurre enregistré</Text>
          ) : (
            <View style={styles.panelChips}>
              {lureList.map((l) => {
                const active = filters.lures.includes(l);
                return (
                  <TouchableOpacity
                    key={l}
                    style={[styles.pChip, active && styles.pChipActive]}
                    onPress={() => setFilters((f) => ({ ...f, lures: toggleItem(f.lures, l) }))}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.pChipText, active && styles.pChipTextActive]}>🪝 {l}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      );
    }

    if (openPanel === 'dates') {
      return (
        <View style={styles.panelSection}>
          <Text style={styles.panelTitle}>Plage de dates</Text>
          <View style={styles.dateRow}>
            <TouchableOpacity
              style={[styles.dateBtn, filters.dateFrom && styles.dateBtnActive]}
              onPress={() => setShowDatePicker('from')}
              activeOpacity={0.8}
            >
              <Text style={styles.dateBtnLabel}>Du</Text>
              <Text style={[styles.dateBtnValue, filters.dateFrom && styles.dateBtnValueActive]}>
                {filters.dateFrom ? formatShortDate(filters.dateFrom) : 'Début'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.dateSep}>→</Text>
            <TouchableOpacity
              style={[styles.dateBtn, filters.dateTo && styles.dateBtnActive]}
              onPress={() => setShowDatePicker('to')}
              activeOpacity={0.8}
            >
              <Text style={styles.dateBtnLabel}>Au</Text>
              <Text style={[styles.dateBtnValue, filters.dateTo && styles.dateBtnValueActive]}>
                {filters.dateTo ? formatShortDate(filters.dateTo) : 'Fin'}
              </Text>
            </TouchableOpacity>
            {(filters.dateFrom || filters.dateTo) && (
              <TouchableOpacity
                style={styles.dateClearBtn}
                onPress={() => setFilters((f) => ({ ...f, dateFrom: null, dateTo: null }))}
                activeOpacity={0.8}
              >
                <Text style={styles.dateClearText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
          {showDatePicker && (
            <DateTimePicker
              value={showDatePicker === 'from' ? (filters.dateFrom ?? new Date()) : (filters.dateTo ?? new Date())}
              mode="date"
              display="default"
              onChange={(_event, selectedDate) => {
                setShowDatePicker(null);
                if (!selectedDate) return;
                if (showDatePicker === 'from') setFilters((f) => ({ ...f, dateFrom: selectedDate }));
                else setFilters((f) => ({ ...f, dateTo: selectedDate }));
              }}
            />
          )}
        </View>
      );
    }

    if (openPanel === 'weather') {
      const list = weatherList.length > 0 ? weatherList : WEATHER_OPTIONS;
      return (
        <View style={styles.panelSection}>
          <Text style={styles.panelTitle}>Météo</Text>
          <View style={styles.panelChips}>
            {list.map((w) => {
              const active = filters.weather.includes(w);
              return (
                <TouchableOpacity
                  key={w}
                  style={[styles.pChip, active && styles.pChipActive]}
                  onPress={() => setFilters((f) => ({ ...f, weather: toggleItem(f.weather, w) }))}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.pChipText, active && styles.pChipTextActive]}>{w}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      );
    }

    return null;
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Carte */}
      <MapView
        ref={mapRef}
        style={styles.map}
        mapType={satellite ? 'hybrid' : 'standard'}
        initialRegion={{ latitude: 47.5, longitude: -71.5, latitudeDelta: 8, longitudeDelta: 8 }}
        showsUserLocation
        showsMyLocationButton
        onPress={() => setSelectedCatch(null)}
        onRegionChangeComplete={(r) => setMapDeltas({ lat: r.latitudeDelta, lng: r.longitudeDelta })}
      >
        {clusters.map((cluster) => {
          const isCluster = cluster.catches.length > 1;
          const singleCatch = cluster.catches[0];

          if (!isCluster) {
            return (
              <Marker
                key={cluster.id}
                coordinate={{ latitude: cluster.latitude, longitude: cluster.longitude }}
                anchor={{ x: 0.5, y: 1 }}

                onPress={(e) => { e.stopPropagation(); setSelectedCatch(singleCatch); setOpenPanel(null); }}
              >
                <View style={styles.pinContainer}>
                  <View style={[styles.pinShape, { backgroundColor: getColor(singleCatch.species) }]}>
                    <View style={styles.pinDot} />
                  </View>
                </View>
              </Marker>
            );
          }

          const sorted = Object.entries(cluster.speciesCounts).sort((a, b) => b[1] - a[1]);
          const total = cluster.catches.length;
          const cnt1 = sorted[0][1];
          const cnt2 = total - cnt1;
          const color1 = getColor(sorted[0][0]);
          const color2 = sorted.length > 1 ? getColor(sorted[1][0]) : color1;
          const multiSpecies = sorted.length > 1;
          const label = total > 99 ? '99+' : String(total);

          return (
            <Marker
              key={cluster.id}
              coordinate={{ latitude: cluster.latitude, longitude: cluster.longitude }}
              anchor={{ x: 0.5, y: 0.5 }}
              onPress={(e) => {
                e.stopPropagation();
                setSelectedCatch(null);
                setOpenPanel(null);
                const lats = cluster.catches.map((o) => o.latitude);
                const lngs = cluster.catches.map((o) => o.longitude);
                mapRef.current?.animateToRegion({
                  latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
                  longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
                  latitudeDelta: Math.max((Math.max(...lats) - Math.min(...lats)) * 2.5, 0.01),
                  longitudeDelta: Math.max((Math.max(...lngs) - Math.min(...lngs)) * 2.5, 0.01),
                }, 400);
              }}
            >
              <View style={styles.clusterWrap}>
                <View style={styles.clusterInner}>
                  {multiSpecies ? (
                    <>
                      <View style={[styles.clusterSegL, { flex: cnt1, backgroundColor: color1 }]} />
                      <View style={[styles.clusterSegR, { flex: cnt2, backgroundColor: color2 }]} />
                    </>
                  ) : (
                    <View style={[styles.clusterSegFull, { backgroundColor: color1 }]} />
                  )}
                </View>
                <View style={styles.clusterNumWrap}>
                  <Text style={[styles.clusterNum, total > 99 ? { fontSize: 11 } : null]}>
                    {label}
                  </Text>
                </View>
              </View>
            </Marker>
          );
        })}
      </MapView>

      {/* Callout personnalisé (fonctionne sur Android + iOS) */}
      {selectedCatch && (
        <TouchableOpacity
          style={styles.customCallout}
          onPress={() => { setSelectedCatch(null); router.push(`/catch-detail?id=${selectedCatch.id}`); }}
          activeOpacity={0.92}
        >
          <View style={styles.calloutInner}>
            <View style={[styles.calloutAccent, { backgroundColor: getColor(selectedCatch.species) }]} />
            <View style={styles.calloutBody}>
              <Text style={styles.calloutSpecies}>{selectedCatch.species}</Text>
              {!!selectedCatch.lake_name && <Text style={styles.calloutRow}>📍 {selectedCatch.lake_name}</Text>}
              {!!selectedCatch.lure && <Text style={styles.calloutRow}>🪝 {selectedCatch.lure}</Text>}
              {selectedCatch.weight_lbs != null && (
                <Text style={styles.calloutRow}>⚖️ {selectedCatch.weight_lbs.toFixed(1)} lb</Text>
              )}
              <Text style={styles.calloutDate}>{formatDateFr(selectedCatch.caught_at)}</Text>
            </View>
            <View style={styles.calloutArrow}>
              <Text style={styles.calloutLink}>→</Text>
            </View>
          </View>
        </TouchableOpacity>
      )}

      {/* Indicateur données locales */}
      {fromCache && (
        <View style={styles.cacheNotice}>
          <Ionicons name="cloud-offline-outline" size={12} color={colors.warning} />
          <Text style={styles.cacheNoticeText}>Données locales</Text>
        </View>
      )}

      {/* Bouton satellite */}
      <TouchableOpacity style={styles.satelliteBtn} onPress={() => setSatellite((v) => !v)} activeOpacity={0.85}>
        <Text style={styles.satelliteBtnText}>{satellite ? '🗺 Carte' : '🛰 Satellite'}</Text>
      </TouchableOpacity>

      {/* Barre de filtres */}
      <View style={[styles.filterBar, { top: insets.top }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>

          {/* Bouton Espèce */}
          <TouchableOpacity
            style={[styles.filterBtn, (openPanel === 'species' || filters.species.length > 0) && styles.filterBtnActive]}
            onPress={() => setOpenPanel((p) => p === 'species' ? null : 'species')}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterBtnText, (openPanel === 'species' || filters.species.length > 0) && styles.filterBtnTextActive]}>
              🐟 Espèce{filters.species.length > 0 ? ` (${filters.species.length})` : ''}
            </Text>
          </TouchableOpacity>

          {/* Bouton Leurre */}
          <TouchableOpacity
            style={[styles.filterBtn, (openPanel === 'lure' || filters.lures.length > 0) && styles.filterBtnActive]}
            onPress={() => setOpenPanel((p) => p === 'lure' ? null : 'lure')}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterBtnText, (openPanel === 'lure' || filters.lures.length > 0) && styles.filterBtnTextActive]}>
              🪝 Leurre{filters.lures.length > 0 ? ` (${filters.lures.length})` : ''}
            </Text>
          </TouchableOpacity>

          {/* Bouton Dates */}
          <TouchableOpacity
            style={[styles.filterBtn, (openPanel === 'dates' || filters.dateFrom || filters.dateTo) && styles.filterBtnActive]}
            onPress={() => setOpenPanel((p) => p === 'dates' ? null : 'dates')}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterBtnText, (openPanel === 'dates' || filters.dateFrom || filters.dateTo) && styles.filterBtnTextActive]}>
              {filters.dateFrom || filters.dateTo
                ? `📅 ${filters.dateFrom ? formatShortDate(filters.dateFrom) : '…'} → ${filters.dateTo ? formatShortDate(filters.dateTo) : '…'}`
                : '📅 Dates'}
            </Text>
          </TouchableOpacity>

          {/* Bouton Météo */}
          <TouchableOpacity
            style={[styles.filterBtn, (openPanel === 'weather' || filters.weather.length > 0) && styles.filterBtnActive]}
            onPress={() => setOpenPanel((p) => p === 'weather' ? null : 'weather')}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterBtnText, (openPanel === 'weather' || filters.weather.length > 0) && styles.filterBtnTextActive]}>
              ☀️ Météo{filters.weather.length > 0 ? ` (${filters.weather.length})` : ''}
            </Text>
          </TouchableOpacity>

          {/* Réinitialiser */}
          {activeCount > 0 && (
            <TouchableOpacity
              style={styles.resetBtn}
              onPress={() => { setFilters(EMPTY_FILTERS); setOpenPanel(null); }}
              activeOpacity={0.8}
            >
              <Text style={styles.resetBtnText}>✕ Réinitialiser</Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        {/* Panneau d'options (sous la barre) */}
        {openPanel && (
          <View style={styles.panel}>
            <FilterPanelContent />
          </View>
        )}
      </View>

      {/* Compteur de résultats */}
      {activeCount > 0 && (
        <View style={styles.resultBadge}>
          <Text style={styles.resultBadgeText}>{visibleCatches.length} résultat{visibleCatches.length !== 1 ? 's' : ''}</Text>
        </View>
      )}

      {/* Loading */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={ACCENT} size="large" />
        </View>
      )}

      {/* Empty state */}
      {!loading && visibleCatches.length === 0 && (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>
            {activeCount > 0 ? 'Aucun résultat pour ces filtres' : 'Aucune prise sur la carte'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {activeCount > 0
              ? 'Essaie de modifier ou réinitialiser les filtres.'
              : 'Tes prises apparaîtront ici une fois enregistrées avec GPS.'}
          </Text>
        </View>
      )}

      {/* Overlay pour fermer le panneau */}
      {openPanel && (
        <Pressable style={styles.dismissOverlay} onPress={() => setOpenPanel(null)} />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ACCENT = colors.accent;
const CARD_BG = colors.surface;

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },

  pinContainer: {
    width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center',
  },
  pinShape: {
    width: 26, height: 26,
    borderTopLeftRadius: 13, borderTopRightRadius: 13,
    borderBottomRightRadius: 13, borderBottomLeftRadius: 0,
    transform: [{ rotate: '-45deg' }],
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5, shadowRadius: 4, elevation: 6,
  },
  pinDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },

  customCallout: {
    position: 'absolute',
    bottom: 120,
    left: 20,
    right: 20,
    zIndex: 20,
    borderRadius: 16,
    backgroundColor: '#F0F6FF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 12,
    overflow: 'hidden',
  },
  calloutInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  calloutAccent: {
    width: 6,
    alignSelf: 'stretch',
  },
  calloutBody: {
    flex: 1,
    padding: 14,
  },
  calloutArrow: {
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  calloutSpecies: { fontSize: 15, fontWeight: '700', color: '#0D1E2F', marginBottom: 5 },
  calloutRow: { fontSize: 13, color: '#3A5068', marginBottom: 3 },
  calloutDate: { marginTop: 4, fontSize: 11, color: '#6B8BA4' },
  calloutLink: { fontSize: 22, color: colors.accent, fontWeight: '700' },

  // ── Clusters ──
  clusterWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    padding: 3,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  clusterInner: {
    width: 38,
    height: 38,
    flexDirection: 'row',
  },
  clusterSegFull: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  clusterSegL: {
    height: 38,
    borderTopLeftRadius: 19,
    borderBottomLeftRadius: 19,
  },
  clusterSegR: {
    height: 38,
    borderTopRightRadius: 19,
    borderBottomRightRadius: 19,
  },
  clusterNumWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterNum: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },

  // ── Barre de filtres ──
  filterBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  filterScroll: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    flexDirection: 'row',
  },
  filterBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(6,15,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  filterBtnActive: {
    backgroundColor: colors.accentSubtle,
    borderColor: ACCENT,
  },
  filterBtnText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.72)',
    fontWeight: '500',
  },
  filterBtnTextActive: {
    color: ACCENT,
    fontWeight: '700',
  },
  resetBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.errorSubtle,
    borderWidth: 1,
    borderColor: colors.error,
  },
  resetBtnText: {
    fontSize: 12,
    color: colors.error,
    fontWeight: '600',
  },

  // ── Panneau d'options ──
  panel: {
    backgroundColor: 'rgba(6,15,26,0.97)',
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    borderTopWidth: 0,
    borderWidth: 1,
    borderColor: colors.border,
    paddingBottom: 16,
  },
  panelSection: { paddingHorizontal: 16, paddingTop: 12 },
  panelTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: ACCENT,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  panelChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  panelEmpty: { fontSize: 13, color: colors.textSubtle, fontStyle: 'italic' },
  pChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  pChipActive: {
    backgroundColor: colors.accentSubtle,
    borderColor: ACCENT,
  },
  pChipDot: { width: 8, height: 8, borderRadius: 4 },
  pChipText: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  pChipTextActive: { color: ACCENT, fontWeight: '700' },

  // ── Résultats ──
  resultBadge: {
    position: 'absolute',
    bottom: 84,
    alignSelf: 'center',
    backgroundColor: 'rgba(6,15,26,0.92)',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: ACCENT,
  },
  resultBadgeText: { fontSize: 12, color: ACCENT, fontWeight: '700' },

  // ── Données locales ──
  cacheNotice: {
    position: 'absolute',
    bottom: 68,
    left: 14,
    zIndex: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(6,15,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.4)',
  },
  cacheNoticeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.warning,
  },

  // ── Satellite ──
  satelliteBtn: {
    position: 'absolute',
    bottom: 28,
    right: 14,
    zIndex: 5,
    backgroundColor: 'rgba(6,15,26,0.9)',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  satelliteBtnText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },

  // ── Loading ──
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6,15,26,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Empty ──
  emptyCard: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: CARD_BG,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 6 },
  emptySubtitle: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19 },

  // ── Dismiss overlay ──
  dismissOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },

  // ── Date picker ──
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  dateBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    minWidth: 90,
  },
  dateBtnActive: {
    backgroundColor: colors.accentSubtle,
    borderColor: ACCENT,
  },
  dateBtnLabel: {
    fontSize: 10,
    color: colors.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  dateBtnValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  dateBtnValueActive: {
    color: ACCENT,
  },
  dateSep: {
    fontSize: 16,
    color: colors.textSubtle,
  },
  dateClearBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.errorSubtle,
    borderWidth: 1,
    borderColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateClearText: {
    fontSize: 13,
    color: colors.error,
    fontWeight: '700',
  },
});
