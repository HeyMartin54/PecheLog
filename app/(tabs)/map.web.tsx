import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { useAuth } from '@/contexts/AuthContext';
import { DEV_TEST_USER_ID } from '@/lib/dev-test-user';
import { supabase } from '@/lib/supabase';

// Leaflet est chargé dynamiquement pour éviter les erreurs SSR
let MapContainer: any = null;
let TileLayer: any = null;
let Marker: any = null;
let Popup: any = null;
let useMap: any = null;

if (typeof window !== 'undefined') {
  const RL = require('react-leaflet');
  MapContainer = RL.MapContainer;
  TileLayer = RL.TileLayer;
  Marker = RL.Marker;
  Popup = RL.Popup;
  useMap = RL.useMap;
}

type CatchPin = {
  id: string;
  species: string;
  latitude: number;
  longitude: number;
  lake_name: string | null;
  lure: string | null;
  weight_lbs: number | null;
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

// Composant interne qui recentre la carte quand les données arrivent
function MapFitter({ catches }: { catches: CatchPin[] }) {
  const map = useMap?.();
  const fitted = useRef(false);

  useEffect(() => {
    if (!map || fitted.current || catches.length === 0) return;
    const L = require('leaflet');
    const bounds = L.latLngBounds(catches.map((c) => [c.latitude, c.longitude]));
    map.fitBounds(bounds, { padding: [40, 40] });
    fitted.current = true;
  }, [map, catches]);

  return null;
}

// Crée une icône circulaire colorée via DivIcon Leaflet
function makeIcon(color: string) {
  if (typeof window === 'undefined') return undefined;
  const L = require('leaflet');
  return L.divIcon({
    className: '',
    html: `<div style="
      width:34px;height:34px;border-radius:50%;
      background:${color};border:2.5px solid #fff;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 6px rgba(0,0,0,0.45);
      font-size:17px;line-height:34px;text-align:center;
    ">🐟</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
  });
}

export default function MapScreen() {
  const { user } = useAuth();
  const [catches, setCatches] = useState<CatchPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSpecies, setActiveSpecies] = useState<string | null>(null);
  const [leafletReady, setLeafletReady] = useState(false);

  // Injecter le CSS Leaflet une seule fois
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (document.getElementById('leaflet-css')) {
      setLeafletReady(true);
      return;
    }
    const link = document.createElement('link');
    link.id = 'leaflet-css';
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    link.onload = () => setLeafletReady(true);
    document.head.appendChild(link);
  }, []);

  const loadCatches = useCallback(async () => {
    const userId = user?.id ?? DEV_TEST_USER_ID;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('catches')
        .select('id, species, latitude, longitude, lake_name, lure, weight_lbs, caught_at')
        .eq('user_id', userId)
        .order('caught_at', { ascending: false });

      if (error) {
        console.warn('[Map web] Erreur', error);
        return;
      }
      const valid = (data ?? []).filter(
        (c) => typeof c.latitude === 'number' && typeof c.longitude === 'number',
      );
      setCatches(valid);
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

  if (loading || !leafletReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={ACCENT} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Carte Leaflet via div */}
      <div style={{ flex: 1, width: '100%', height: '100%' }}>
        {MapContainer && (
          <MapContainer
            center={[47.5, -71.5]}
            zoom={6}
            style={{ width: '100%', height: '100%' }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />
            <MapFitter catches={visibleCatches} />
            {visibleCatches.map((c) => (
              <Marker
                key={c.id}
                position={[c.latitude, c.longitude]}
                icon={makeIcon(getSpeciesColor(c.species))}
              >
                <Popup>
                  <div style={{ fontFamily: 'sans-serif', minWidth: 140 }}>
                    <strong style={{ fontSize: 14 }}>{c.species}</strong>
                    {c.lake_name && <div style={{ marginTop: 4, fontSize: 12 }}>📍 {c.lake_name}</div>}
                    {c.lure && <div style={{ fontSize: 12 }}>🪝 {c.lure}</div>}
                    {c.weight_lbs != null && (
                      <div style={{ fontSize: 12 }}>⚖️ {c.weight_lbs.toFixed(1)} lb</div>
                    )}
                    <div style={{ marginTop: 4, fontSize: 11, color: '#888' }}>
                      {formatDateFr(c.caught_at)}
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        )}
      </div>

      {/* Chips de filtre */}
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
                  <View style={[styles.chipDot, { backgroundColor: getSpeciesColor(species) }]} />
                  <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                    {species} ({count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Empty state */}
      {catches.length === 0 && (
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
  container: { flex: 1 },
  center: {
    flex: 1,
    backgroundColor: '#061425',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  emptyCard: {
    position: 'absolute',
    bottom: 36,
    left: 24,
    right: 24,
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
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
