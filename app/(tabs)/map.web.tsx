import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { useNetworkStatus } from '@/lib/hooks/useNetworkStatus';
import { supabase } from '@/lib/supabase';
import { CATCH_SELECT_ALL, loadCatchesCache, saveCatchesCache } from '@/lib/catchCache';
import { colors } from '@/lib/theme';

// ─── Leaflet (web uniquement) ─────────────────────────────────────────────────
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

// ─── Types ────────────────────────────────────────────────────────────────────

type CatchPin = {
  id: string;
  species: string;
  latitude: number;
  longitude: number;
  lake_name: string | null;
  lure: string | null;
  weight_lbs: number | null;
  weather_conditions: string | null;
  caught_at: string;
};

type FilterState = {
  species: string[];
  lures: string[];
  dateFrom: string | null;  // format YYYY-MM-DD (input type="date")
  dateTo: string | null;
  weather: string[];
};

type FilterPanel = 'species' | 'lure' | 'dates' | 'weather' | null;

const EMPTY_FILTERS: FilterState = { species: [], lures: [], dateFrom: null, dateTo: null, weather: [] };

// ─── Constantes ───────────────────────────────────────────────────────────────

const SPECIES_COLORS: Record<string, string> = {
  doré: '#FFD700',
  brochet: '#2ECC71',
  truite: '#3498DB',
  touladi: '#9E9E9E',
  site: '#FFFFFF',
};

const WEATHER_OPTIONS = ['☀️ Ensoleillé', '⛅ Nuageux', '🌧️ Pluie', '💨 Vent', '❄️ Froid'];

const TILES = {
  standard: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; <a href="https://www.esri.com">Esri</a>',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSpeciesColor(species: string): string {
  const lower = species.toLowerCase();
  const key = Object.keys(SPECIES_COLORS).find((k) => lower.includes(k));
  return key ? SPECIES_COLORS[key] : '#AAAAAA';
}

function formatDateFr(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function countActiveFilters(f: FilterState): number {
  return f.species.length + f.lures.length + (f.dateFrom ? 1 : 0) + (f.dateTo ? 1 : 0) + f.weather.length;
}

function toggleItem(arr: string[], item: string): string[] {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}

function makeIcon(color: string) {
  if (typeof window === 'undefined') return undefined;
  const L = require('leaflet');
  return L.divIcon({
    className: '',
    html: `<div style="width:34px;height:34px;border-radius:50%;background:${color};border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.45);font-size:17px;line-height:34px;text-align:center;">🐟</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
  });
}

// ─── MapFitter ────────────────────────────────────────────────────────────────

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

// ─── Composant principal ──────────────────────────────────────────────────────

export default function MapScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isConnected = useNetworkStatus();

  const [catches, setCatches] = useState<CatchPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [leafletReady, setLeafletReady] = useState(false);
  const [satellite, setSatellite] = useState(false);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [openPanel, setOpenPanel] = useState<FilterPanel>(null);

  // ─── CSS Leaflet ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (document.getElementById('leaflet-css')) { setLeafletReady(true); return; }
    const link = document.createElement('link');
    link.id = 'leaflet-css';
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    link.onload = () => setLeafletReady(true);
    document.head.appendChild(link);
  }, []);

  // ─── Chargement ─────────────────────────────────────────────────────────────
  const loadCatches = useCallback(async () => {
    if (!user?.id) return;
    const userId = user.id;
    setLoading(true);

    // Si hors-ligne : charger depuis le cache
    if (isConnected === false) {
      const cached = await loadCatchesCache(userId);
      if (cached) {
        setCatches(cached.filter(
          (c) => typeof c.latitude === 'number' && typeof c.longitude === 'number',
        ) as CatchPin[]);
        setFromCache(true);
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
        console.warn('[Map web]', error);
        const cached = await loadCatchesCache(userId);
        if (cached) {
          setCatches(cached.filter(
            (c) => typeof c.latitude === 'number' && typeof c.longitude === 'number',
          ) as CatchPin[]);
          setFromCache(true);
        }
        return;
      }
      setCatches((data ?? []).filter(
        (c) => typeof c.latitude === 'number' && typeof c.longitude === 'number',
      ));
      await saveCatchesCache(userId, data as never);
    } finally {
      setLoading(false);
    }
  }, [user?.id, isConnected]);

  useFocusEffect(useCallback(() => { loadCatches(); }, [loadCatches]));

  // ─── Listes dynamiques ──────────────────────────────────────────────────────
  const speciesList = useMemo(() => Array.from(new Set(catches.map((c) => c.species))).sort(), [catches]);
  const lureList = useMemo(() => Array.from(new Set(catches.map((c) => c.lure).filter(Boolean) as string[])).sort(), [catches]);
  const weatherList = useMemo(() => Array.from(new Set(catches.map((c) => c.weather_conditions).filter(Boolean) as string[])).sort(), [catches]);

  // ─── Filtrage ───────────────────────────────────────────────────────────────
  const visibleCatches = useMemo(() => {
    let list = catches;
    if (filters.species.length > 0) list = list.filter((c) => filters.species.includes(c.species));
    if (filters.lures.length > 0) list = list.filter((c) => c.lure && filters.lures.includes(c.lure));
    if (filters.dateFrom) list = list.filter((c) => c.caught_at >= filters.dateFrom! + 'T00:00:00');
    if (filters.dateTo) list = list.filter((c) => c.caught_at <= filters.dateTo! + 'T23:59:59');
    if (filters.weather.length > 0) list = list.filter((c) => c.weather_conditions && filters.weather.includes(c.weather_conditions));
    return list;
  }, [catches, filters]);

  const activeCount = countActiveFilters(filters);

  if (loading || !leafletReady) {
    return <View style={styles.center}><ActivityIndicator color={ACCENT} size="large" /></View>;
  }

  // ─── Panneau d'options ──────────────────────────────────────────────────────
  const renderPanel = () => {
    if (!openPanel) return null;

    let items: { key: string; label: string; color?: string }[] = [];
    let onToggle = (_: string) => {};
    let isActive = (_: string) => false;

    if (openPanel === 'species') {
      items = speciesList.map((s) => ({ key: s, label: s, color: getSpeciesColor(s) }));
      onToggle = (s) => setFilters((f) => ({ ...f, species: toggleItem(f.species, s) }));
      isActive = (s) => filters.species.includes(s);
    } else if (openPanel === 'lure') {
      items = lureList.length > 0
        ? lureList.map((l) => ({ key: l, label: `🪝 ${l}` }))
        : [{ key: '__empty__', label: 'Aucun leurre enregistré' }];
      onToggle = (l) => l !== '__empty__' && setFilters((f) => ({ ...f, lures: toggleItem(f.lures, l) }));
      isActive = (l) => filters.lures.includes(l);
    } else if (openPanel === 'dates') {
      // Panneau dates géré séparément ci-dessous — ne pas utiliser items/onToggle
    } else if (openPanel === 'weather') {
      const list = weatherList.length > 0 ? weatherList : WEATHER_OPTIONS;
      items = list.map((w) => ({ key: w, label: w }));
      onToggle = (w) => setFilters((f) => ({ ...f, weather: toggleItem(f.weather, w) }));
      isActive = (w) => filters.weather.includes(w);
    }

    const panelStyle: React.CSSProperties = {
      position: 'absolute', top: 52, left: 0, right: 0, zIndex: 1100,
      background: 'rgba(6,20,37,0.97)',
      borderBottom: '1px solid rgba(255,255,255,0.1)',
      padding: '12px 14px 14px',
    };

    if (openPanel === 'dates') {
      return (
        <div style={panelStyle}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>
            Plage de dates
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Du</span>
              <input
                type="date"
                value={filters.dateFrom ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value || null }))}
                style={{ background: 'rgba(255,255,255,0.08)', color: filters.dateFrom ? ACCENT : 'rgba(255,255,255,0.6)', border: `1px solid ${filters.dateFrom ? ACCENT : 'rgba(255,255,255,0.2)'}`, borderRadius: 8, padding: '6px 10px', fontSize: 13, outline: 'none' }}
              />
            </label>
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 18 }}>→</span>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Au</span>
              <input
                type="date"
                value={filters.dateTo ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value || null }))}
                style={{ background: 'rgba(255,255,255,0.08)', color: filters.dateTo ? ACCENT : 'rgba(255,255,255,0.6)', border: `1px solid ${filters.dateTo ? ACCENT : 'rgba(255,255,255,0.2)'}`, borderRadius: 8, padding: '6px 10px', fontSize: 13, outline: 'none' }}
              />
            </label>
            {(filters.dateFrom || filters.dateTo) && (
              <button
                onClick={() => setFilters((f) => ({ ...f, dateFrom: null, dateTo: null }))}
                style={{ background: 'rgba(231,76,60,0.15)', color: '#E74C3C', border: '1px solid #E74C3C', borderRadius: 15, width: 30, height: 30, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
              >✕</button>
            )}
          </div>
        </div>
      );
    }

    return (
      <div style={panelStyle}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {items.map((item) => {
            const active = isActive(item.key);
            return (
              <button
                key={item.key}
                onClick={() => onToggle(item.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
                  fontSize: 13, fontWeight: active ? 600 : 500,
                  color: active ? ACCENT : 'rgba(255,255,255,0.7)',
                  background: active ? 'rgba(0,230,181,0.12)' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${active ? ACCENT : 'rgba(255,255,255,0.15)'}`,
                }}
              >
                {item.color && (
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, display: 'inline-block' }} />
                )}
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Carte */}
      <div style={{ flex: 1, width: '100%', height: '100%' }}>
        {MapContainer && (
          <MapContainer center={[47.5, -71.5]} zoom={6} style={{ width: '100%', height: '100%' }}>
            <TileLayer url={satellite ? TILES.satellite.url : TILES.standard.url} attribution={satellite ? TILES.satellite.attribution : TILES.standard.attribution} />
            <MapFitter catches={visibleCatches} />
            {visibleCatches.map((c) => (
              <Marker key={c.id} position={[c.latitude, c.longitude]} icon={makeIcon(getSpeciesColor(c.species))}>
                <Popup>
                  <div style={{ fontFamily: 'sans-serif', minWidth: 140 }}>
                    <strong style={{ fontSize: 14 }}>{c.species}</strong>
                    {c.lake_name && <div style={{ marginTop: 4, fontSize: 12 }}>📍 {c.lake_name}</div>}
                    {c.lure && <div style={{ fontSize: 12 }}>🪝 {c.lure}</div>}
                    {c.weight_lbs != null && <div style={{ fontSize: 12 }}>⚖️ {c.weight_lbs.toFixed(1)} lb</div>}
                    <div style={{ marginTop: 4, fontSize: 11, color: '#888' }}>{formatDateFr(c.caught_at)}</div>
                    <div style={{ marginTop: 6, fontSize: 12, color: '#007AFF', fontWeight: 600, cursor: 'pointer' }} onClick={() => router.push(`/catch-detail?id=${c.id}`)}>
                      Voir le détail →
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        )}
      </div>

      {/* Barre de filtres (overlay) */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1000 }}>
        {/* Ligne de boutons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px 0', overflowX: 'auto' }}>
          {(
            [
              { key: 'species', label: `🐟 Espèce${filters.species.length > 0 ? ` (${filters.species.length})` : ''}`, active: openPanel === 'species' || filters.species.length > 0 },
              { key: 'lure', label: `🪝 Leurre${filters.lures.length > 0 ? ` (${filters.lures.length})` : ''}`, active: openPanel === 'lure' || filters.lures.length > 0 },
              { key: 'dates', label: filters.dateFrom || filters.dateTo ? `📅 ${filters.dateFrom ?? '…'} → ${filters.dateTo ?? '…'}` : '📅 Dates', active: openPanel === 'dates' || !!(filters.dateFrom || filters.dateTo) },
              { key: 'weather', label: `☀️ Météo${filters.weather.length > 0 ? ` (${filters.weather.length})` : ''}`, active: openPanel === 'weather' || filters.weather.length > 0 },
            ] as { key: FilterPanel; label: string; active: boolean }[]
          ).map((btn) => (
            <button
              key={btn.key!}
              onClick={() => setOpenPanel((p) => p === btn.key ? null : btn.key)}
              style={{
                flexShrink: 0, padding: '7px 13px', borderRadius: 20, cursor: 'pointer',
                fontSize: 12, fontWeight: btn.active ? 600 : 500,
                color: btn.active ? ACCENT : 'rgba(255,255,255,0.75)',
                background: btn.active ? 'rgba(0,230,181,0.15)' : 'rgba(6,20,37,0.9)',
                border: `1px solid ${btn.active ? ACCENT : 'rgba(255,255,255,0.18)'}`,
              }}
            >
              {btn.label}
            </button>
          ))}
          {activeCount > 0 && (
            <button
              onClick={() => { setFilters(EMPTY_FILTERS); setOpenPanel(null); }}
              style={{
                flexShrink: 0, padding: '7px 13px', borderRadius: 20, cursor: 'pointer',
                fontSize: 12, fontWeight: 600, color: '#E74C3C',
                background: 'rgba(231,76,60,0.15)', border: '1px solid #E74C3C',
              }}
            >
              ✕ Réinitialiser
            </button>
          )}
        </div>

        {/* Panneau d'options */}
        {renderPanel()}
      </div>

      {/* Compteur de résultats */}
      {activeCount > 0 && (
        <div style={{
          position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1000, background: 'rgba(6,20,37,0.9)', color: ACCENT,
          padding: '6px 14px', borderRadius: 20, border: `1px solid ${ACCENT}`,
          fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
        }}>
          {visibleCatches.length} résultat{visibleCatches.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Indicateur données locales */}
      {fromCache && (
        <div style={{
          position: 'absolute', bottom: 64, left: 14, zIndex: 1000,
          display: 'flex', alignItems: 'center', gap: 5,
          background: 'rgba(6,20,37,0.92)', borderRadius: 20,
          border: '1px solid rgba(245,166,35,0.4)',
          padding: '5px 10px', fontSize: 11, fontWeight: 600, color: colors.warning,
        }}>
          ☁️ Données locales
        </div>
      )}

      {/* Bouton satellite */}
      <button
        onClick={() => setSatellite((v) => !v)}
        style={{
          position: 'absolute', bottom: 24, right: 14, zIndex: 1000,
          background: 'rgba(6,20,37,0.88)', color: '#fff',
          border: '1px solid rgba(255,255,255,0.18)', borderRadius: 20,
          padding: '7px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
        }}
      >
        {satellite ? '🗺 Carte' : '🛰 Satellite'}
      </button>

      {/* Overlay pour fermer le panneau */}
      {openPanel && (
        <div
          style={{ position: 'absolute', inset: 0, zIndex: 999 }}
          onClick={() => setOpenPanel(null)}
        />
      )}

      {/* Empty state */}
      {visibleCatches.length === 0 && (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>
            {activeCount > 0 ? 'Aucun résultat pour ces filtres' : 'Aucune prise sur la carte'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {activeCount > 0 ? 'Essaie de modifier ou réinitialiser les filtres.' : 'Tes prises apparaîtront ici une fois enregistrées avec GPS.'}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ACCENT = colors.accent;

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCard: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: colors.surface,
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
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
  },
});
