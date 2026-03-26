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
import MapView, { Callout, Marker, Region } from 'react-native-maps';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { DEV_TEST_USER_ID } from '@/lib/dev-test-user';
import { supabase } from '@/lib/supabase';

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

const EMPTY_FILTERS: FilterState = { species: [], lures: [], dateFrom: null, dateTo: null, weather: [] };

// ─── Constantes ──────────────────────────────────────────────────────────────

const SPECIES_COLORS: Record<string, string> = {
  doré: '#FFD700',
  brochet: '#2ECC71',
  truite: '#3498DB',
  touladi: '#9E9E9E',
  site: '#FFFFFF',
};

const WEATHER_OPTIONS = ['☀️ Ensoleillé', '⛅ Nuageux', '🌧️ Pluie', '💨 Vent', '❄️ Froid'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSpeciesColor(species: string): string {
  const lower = species.toLowerCase();
  const key = Object.keys(SPECIES_COLORS).find((k) => lower.includes(k));
  return key ? SPECIES_COLORS[key] : '#AAAAAA';
}

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

// ─── Composant principal ──────────────────────────────────────────────────────

export default function MapScreen() {
  const router = useRouter();
  const { user } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);

  const [catches, setCatches] = useState<CatchPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [satellite, setSatellite] = useState(false);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [openPanel, setOpenPanel] = useState<FilterPanel>(null);
  const [showDatePicker, setShowDatePicker] = useState<'from' | 'to' | null>(null);

  // ─── Chargement ────────────────────────────────────────────────────────────

  const loadCatches = useCallback(async () => {
    const userId = user?.id ?? DEV_TEST_USER_ID;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('catches')
        .select('id, species, latitude, longitude, lake_name, lure, weight_lbs, size_category, weather_conditions, caught_at')
        .eq('user_id', userId)
        .order('caught_at', { ascending: false });

      if (error) { console.warn('[Map] Erreur', error); return; }

      const valid = (data ?? []).filter(
        (c) => typeof c.latitude === 'number' && typeof c.longitude === 'number',
      );
      setCatches(valid);

      const region = computeRegion(valid);
      if (region) setTimeout(() => mapRef.current?.animateToRegion(region, 700), 400);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(useCallback(() => { loadCatches(); }, [loadCatches]));

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
                  style={[styles.pChip, active && { backgroundColor: 'rgba(0,230,181,0.15)', borderColor: getSpeciesColor(s) }]}
                  onPress={() => setFilters((f) => ({ ...f, species: toggleItem(f.species, s) }))}
                  activeOpacity={0.8}
                >
                  <View style={[styles.pChipDot, { backgroundColor: getSpeciesColor(s) }]} />
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
      >
        {visibleCatches.map((c) => (
          <Marker key={c.id} coordinate={{ latitude: c.latitude, longitude: c.longitude }}>
            <View style={[styles.pin, { backgroundColor: getSpeciesColor(c.species) }]}>
              <Text style={styles.pinEmoji}>🐟</Text>
            </View>
            <Callout style={styles.calloutWrapper} onPress={() => router.push(`/catch-detail?id=${c.id}`)}>
              <View style={styles.callout}>
                <Text style={styles.calloutSpecies}>{c.species}</Text>
                {!!c.lake_name && <Text style={styles.calloutRow}>📍 {c.lake_name}</Text>}
                {!!c.lure && <Text style={styles.calloutRow}>🪝 {c.lure}</Text>}
                {c.weight_lbs != null && <Text style={styles.calloutRow}>⚖️ {c.weight_lbs.toFixed(1)} lb</Text>}
                <Text style={styles.calloutDate}>{formatDateFr(c.caught_at)}</Text>
                <Text style={styles.calloutLink}>Voir le détail →</Text>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      {/* Bouton satellite */}
      <TouchableOpacity style={styles.satelliteBtn} onPress={() => setSatellite((v) => !v)} activeOpacity={0.85}>
        <Text style={styles.satelliteBtnText}>{satellite ? '🗺 Carte' : '🛰 Satellite'}</Text>
      </TouchableOpacity>

      {/* Barre de filtres */}
      <View style={styles.filterBar}>
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

const ACCENT = '#00E6B5';
const CARD_BG = '#0E2236';
const BG = '#061425';

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },

  pin: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.45, shadowRadius: 4, elevation: 5,
  },
  pinEmoji: { fontSize: 18 },

  calloutWrapper: { width: 190 },
  callout: { padding: 8 },
  calloutSpecies: { fontSize: 15, fontWeight: '700', color: '#111', marginBottom: 5 },
  calloutRow: { fontSize: 12, color: '#444', marginBottom: 2 },
  calloutDate: { marginTop: 5, fontSize: 11, color: '#888' },
  calloutLink: { marginTop: 6, fontSize: 12, color: '#007AFF', fontWeight: '600' },

  // ── Barre de filtres ──
  filterBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  filterScroll: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
    flexDirection: 'row',
  },
  filterBtn: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(6,20,37,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  filterBtnActive: {
    backgroundColor: 'rgba(0,230,181,0.15)',
    borderColor: ACCENT,
  },
  filterBtnText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '500',
  },
  filterBtnTextActive: {
    color: ACCENT,
    fontWeight: '600',
  },
  resetBtn: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(231,76,60,0.15)',
    borderWidth: 1,
    borderColor: '#E74C3C',
  },
  resetBtnText: {
    fontSize: 12,
    color: '#E74C3C',
    fontWeight: '600',
  },

  // ── Panneau d'options ──
  panel: {
    backgroundColor: 'rgba(6,20,37,0.97)',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    borderTopWidth: 0,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingBottom: 14,
  },
  panelSection: { paddingHorizontal: 14, paddingTop: 12 },
  panelTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  panelChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  panelEmpty: { fontSize: 13, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' },
  pChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  pChipActive: {
    backgroundColor: 'rgba(0,230,181,0.12)',
    borderColor: ACCENT,
  },
  pChipDot: { width: 8, height: 8, borderRadius: 4 },
  pChipText: { fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: '500' },
  pChipTextActive: { color: ACCENT, fontWeight: '600' },

  // ── Résultats ──
  resultBadge: {
    position: 'absolute',
    bottom: 80,
    alignSelf: 'center',
    backgroundColor: 'rgba(6,20,37,0.9)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: ACCENT,
  },
  resultBadgeText: { fontSize: 12, color: ACCENT, fontWeight: '600' },

  // ── Satellite ──
  satelliteBtn: {
    position: 'absolute',
    bottom: 24,
    right: 14,
    zIndex: 5,
    backgroundColor: 'rgba(6,20,37,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  satelliteBtnText: { color: '#fff', fontSize: 13, fontWeight: '500' },

  // ── Loading ──
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6,20,37,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Empty ──
  emptyCard: {
    position: 'absolute',
    bottom: 36,
    left: 24,
    right: 24,
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    elevation: 6,
  },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: '#fff', marginBottom: 5 },
  emptySubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.55)', textAlign: 'center', lineHeight: 19 },

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
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    minWidth: 90,
  },
  dateBtnActive: {
    backgroundColor: 'rgba(0,230,181,0.12)',
    borderColor: ACCENT,
  },
  dateBtnLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  dateBtnValue: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
  },
  dateBtnValueActive: {
    color: ACCENT,
  },
  dateSep: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.35)',
  },
  dateClearBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(231,76,60,0.15)',
    borderWidth: 1,
    borderColor: '#E74C3C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateClearText: {
    fontSize: 12,
    color: '#E74C3C',
    fontWeight: '700',
  },
});
