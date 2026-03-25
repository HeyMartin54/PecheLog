import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Callout, Marker, Region } from 'react-native-maps';
import { useFocusEffect } from '@react-navigation/native';

import { useAuth } from '@/contexts/AuthContext';
import { DEV_TEST_USER_ID } from '@/lib/dev-test-user';
import { supabase } from '@/lib/supabase';

type CatchPin = {
  id: string;
  species: string;
  latitude: number;
  longitude: number;
  lake_name: string | null;
  lure: string | null;
  weight_lbs: number | null;
  size_category: string | null;
  caught_at: string;
};

const SPECIES_COLORS: Record<string, string> = {
  achigan: '#FF6B35',
  doré: '#FFD700',
  brochet: '#00E6B5',
  truite: '#FF69B4',
  perchaude: '#9B59B6',
  crapet: '#E74C3C',
  maskinongé: '#3498DB',
};

function getSpeciesColor(species: string): string {
  const lower = species.toLowerCase();
  const key = Object.keys(SPECIES_COLORS).find((k) => lower.includes(k));
  return key ? SPECIES_COLORS[key] : '#AAAAAA';
}

function formatDateFr(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-CA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function computeRegion(pins: CatchPin[]): Region | null {
  if (pins.length === 0) return null;
  const lats = pins.map((p) => p.latitude);
  const lngs = pins.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.05),
    longitudeDelta: Math.max((maxLng - minLng) * 1.5, 0.05),
  };
}

export default function MapScreen() {
  const { user } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);

  const [catches, setCatches] = useState<CatchPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSpecies, setActiveSpecies] = useState<string | null>(null);

  const loadCatches = useCallback(async () => {
    const userId = user?.id ?? DEV_TEST_USER_ID;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('catches')
        .select(
          'id, species, latitude, longitude, lake_name, lure, weight_lbs, size_category, caught_at',
        )
        .eq('user_id', userId)
        .order('caught_at', { ascending: false });

      if (error) {
        console.warn('[Map] Erreur chargement', error);
        return;
      }

      const valid = (data ?? []).filter(
        (c) => typeof c.latitude === 'number' && typeof c.longitude === 'number',
      );
      setCatches(valid);

      const region = computeRegion(valid);
      if (region) {
        setTimeout(() => mapRef.current?.animateToRegion(region, 700), 400);
      }
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadCatches();
    }, [loadCatches]),
  );

  const speciesList = useMemo(
    () => Array.from(new Set(catches.map((c) => c.species))).sort(),
    [catches],
  );

  const visibleCatches = useMemo(
    () => (activeSpecies ? catches.filter((c) => c.species === activeSpecies) : catches),
    [catches, activeSpecies],
  );

return (
    <View style={styles.container}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: 47.5,
          longitude: -71.5,
          latitudeDelta: 8,
          longitudeDelta: 8,
        }}
        showsUserLocation
        showsMyLocationButton
      >
        {visibleCatches.map((c) => (
          <Marker
            key={c.id}
            coordinate={{ latitude: c.latitude, longitude: c.longitude }}
          >
            <View
              style={[styles.pin, { backgroundColor: getSpeciesColor(c.species) }]}
            >
              <Text style={styles.pinEmoji}>🐟</Text>
            </View>
            <Callout style={styles.calloutWrapper}>
              <View style={styles.callout}>
                <Text style={styles.calloutSpecies}>{c.species}</Text>
                {!!c.lake_name && (
                  <Text style={styles.calloutRow}>📍 {c.lake_name}</Text>
                )}
                {!!c.lure && (
                  <Text style={styles.calloutRow}>🪝 {c.lure}</Text>
                )}
                {c.weight_lbs != null && (
                  <Text style={styles.calloutRow}>
                    ⚖️ {c.weight_lbs.toFixed(1)} lb
                  </Text>
                )}
                <Text style={styles.calloutDate}>{formatDateFr(c.caught_at)}</Text>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      {/* Filter chips */}
      {speciesList.length > 0 && (
        <View style={styles.filterBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScroll}
          >
            <TouchableOpacity
              style={[styles.chip, !activeSpecies && styles.chipActive]}
              onPress={() => setActiveSpecies(null)}
              activeOpacity={0.8}
            >
              <Text style={[styles.chipText, !activeSpecies && styles.chipTextActive]}>
                Tout ({catches.length})
              </Text>
            </TouchableOpacity>

            {speciesList.map((species) => {
              const isActive = activeSpecies === species;
              const count = catches.filter((c) => c.species === species).length;
              return (
                <TouchableOpacity
                  key={species}
                  style={[
                    styles.chip,
                    isActive && styles.chipActive,
                    isActive && { borderColor: getSpeciesColor(species) },
                  ]}
                  onPress={() => setActiveSpecies(isActive ? null : species)}
                  activeOpacity={0.8}
                >
                  <View
                    style={[styles.chipDot, { backgroundColor: getSpeciesColor(species) }]}
                  />
                  <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                    {species} ({count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Loading overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={ACCENT} size="large" />
        </View>
      )}

      {/* Empty state */}
      {!loading && catches.length === 0 && (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Aucune prise sur la carte</Text>
          <Text style={styles.emptySubtitle}>
            Tes prises apparaîtront ici une fois enregistrées avec une localisation GPS.
          </Text>
        </View>
      )}
    </View>
  );
}

const ACCENT = '#00E6B5';
const CARD_BG = '#0E2236';

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },

  // Marker pin
  pin: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.45,
    shadowRadius: 4,
    elevation: 5,
  },
  pinEmoji: {
    fontSize: 18,
  },

  // Callout
  calloutWrapper: {
    width: 190,
  },
  callout: {
    padding: 8,
  },
  calloutSpecies: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111',
    marginBottom: 5,
  },
  calloutRow: {
    fontSize: 12,
    color: '#444',
    marginBottom: 2,
  },
  calloutDate: {
    marginTop: 5,
    fontSize: 11,
    color: '#888',
  },

  // Filter bar
  filterBar: {
    position: 'absolute',
    top: 14,
    left: 0,
    right: 0,
  },
  filterScroll: {
    paddingHorizontal: 12,
    gap: 8,
    flexDirection: 'row',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(6,20,37,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  chipActive: {
    backgroundColor: 'rgba(0,230,181,0.15)',
    borderColor: ACCENT,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chipText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '500',
  },
  chipTextActive: {
    color: ACCENT,
    fontWeight: '600',
  },

  // Loading overlay
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6,20,37,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Empty state
  emptyCard: {
    position: 'absolute',
    bottom: 36,
    left: 24,
    right: 24,
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 5,
  },
  emptySubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    lineHeight: 19,
  },

});
