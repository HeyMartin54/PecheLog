import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useNetworkStatus } from '@/lib/hooks/useNetworkStatus';
import { useSpeciesColors } from '@/lib/hooks/useSpeciesColors';
import { supabase } from '@/lib/supabase';
import { CATCH_SELECT_ALL, loadCatchesCache, saveCatchesCache } from '@/lib/catchCache';
import {
  createZone,
  deleteZone,
  fetchZoneCatches,
  leaveZone,
  loadZones,
  pointInPolygon,
  redeemZoneCode,
  type SharedZone,
  type ZonePoint,
} from '@/lib/zones';
import { colors } from '@/lib/theme';

// ─── Leaflet (web uniquement) ─────────────────────────────────────────────────
let MapContainer: any = null;
let TileLayer: any = null;
let Marker: any = null;
let Popup: any = null;
let useMap: any = null;
let Polygon: any = null;
let CircleMarker: any = null;

if (typeof window !== 'undefined') {
  const RL = require('react-leaflet');
  MapContainer = RL.MapContainer;
  TileLayer = RL.TileLayer;
  Marker = RL.Marker;
  Popup = RL.Popup;
  useMap = RL.useMap;
  Polygon = RL.Polygon;
  CircleMarker = RL.CircleMarker;
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

type FilterPanel = 'search' | 'zones' | 'species' | 'lure' | 'dates' | 'weather' | null;

type Cluster = {
  id: string;
  latitude: number;
  longitude: number;
  catches: CatchPin[];
  speciesCounts: Record<string, number>;
};

const EMPTY_FILTERS: FilterState = { species: [], lures: [], dateFrom: null, dateTo: null, weather: [] };

// ─── Constantes ───────────────────────────────────────────────────────────────

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

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

function countActiveFilters(f: FilterState): number {
  return f.species.length + f.lures.length + (f.dateFrom ? 1 : 0) + (f.dateTo ? 1 : 0) + f.weather.length;
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

function makeClusterIcon(speciesCounts: Record<string, number>, getColor: (s: string) => string) {
  if (typeof window === 'undefined') return undefined;
  const L = require('leaflet');
  const sorted = Object.entries(speciesCounts).sort((a, b) => b[1] - a[1]);
  const total = Object.values(speciesCounts).reduce((s, n) => s + n, 0);
  const cnt1 = sorted[0][1];
  const cnt2 = total - cnt1;
  const color1 = getColor(sorted[0][0]);
  const color2 = sorted.length > 1 ? getColor(sorted[1][0]) : color1;
  const multi = sorted.length > 1;
  const pct1 = Math.round(cnt1 / total * 100);
  const label = total > 99 ? '99+' : String(total);
  const fontSize = total > 99 ? 11 : 14;
  const segments = multi
    ? `<div style="flex:${pct1};background:${color1};border-radius:19px 0 0 19px;height:100%;"></div><div style="flex:${100 - pct1};background:${color2};border-radius:0 19px 19px 0;height:100%;"></div>`
    : `<div style="flex:1;background:${color1};border-radius:19px;height:100%;"></div>`;
  const html = `<div style="width:44px;height:44px;border-radius:22px;background:#fff;padding:3px;box-sizing:border-box;position:relative;box-shadow:0 2px 6px rgba(0,0,0,0.3);">
    <div style="width:100%;height:100%;display:flex;flex-direction:row;overflow:hidden;border-radius:19px;">${segments}</div>
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">
      <span style="font-size:${fontSize}px;font-weight:800;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.7);">${label}</span>
    </div>
  </div>`;
  return L.divIcon({ className: '', html, iconSize: [44, 44], iconAnchor: [22, 22] });
}

function makeIcon(color: string) {
  if (typeof window === 'undefined') return undefined;
  const L = require('leaflet');
  return L.divIcon({
    className: '',
    html: `<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;"><div style="width:26px;height:26px;border-top-left-radius:13px;border-top-right-radius:13px;border-bottom-right-radius:13px;border-bottom-left-radius:0;transform:rotate(-45deg);background:${color};box-shadow:0 2px 6px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;"><div style="width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,0.85);"></div></div></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -36],
  });
}

// ─── MapController ────────────────────────────────────────────────────────────

function MapController({ catches, onBoundsChange, mapRef }: {
  catches: CatchPin[];
  onBoundsChange: (latDelta: number, lngDelta: number) => void;
  mapRef: React.MutableRefObject<any>;
}) {
  const map = useMap?.();
  const fitted = useRef(false);

  useEffect(() => {
    if (!map) return;
    mapRef.current = map;
    const update = () => {
      const b = map.getBounds();
      onBoundsChange(b.getNorth() - b.getSouth(), b.getEast() - b.getWest());
    };
    map.on('zoomend', update);
    map.on('moveend', update);
    update();
    return () => { map.off('zoomend', update); map.off('moveend', update); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

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
  const { user, cachedUserId } = useAuth();
  const { t, locale, fmtWeight } = useSettings();
  const isConnected = useNetworkStatus();

  const { getColor } = useSpeciesColors();

  const leafletMapRef = useRef<any>(null);

  const [catches, setCatches] = useState<CatchPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [leafletReady, setLeafletReady] = useState(false);
  const [satellite, setSatellite] = useState(false);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [openPanel, setOpenPanel] = useState<FilterPanel>(null);
  const [mapBounds, setMapBounds] = useState({ lat: 12, lng: 20 });
  const [lakeQuery, setLakeQuery] = useState('');

  // ─── Zones partagées ───────────────────────────────────────────────────────
  const [zones, setZones] = useState<SharedZone[]>([]);
  const [mapSource, setMapSource] = useState<'mine' | string>('mine');
  const [zoneCatches, setZoneCatches] = useState<CatchPin[]>([]);
  const [zoneLoading, setZoneLoading] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [draftPoints, setDraftPoints] = useState<ZonePoint[]>([]);
  const [showNameModal, setShowNameModal] = useState(false);
  const [zoneName, setZoneName] = useState('');
  const [savingZone, setSavingZone] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

  const myId = user?.id ?? cachedUserId;
  const activeZone = mapSource !== 'mine' ? zones.find((z) => z.id === mapSource) ?? null : null;
  const isOwnActiveZone = activeZone != null && activeZone.owner_id === myId;

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
    const userId = user?.id ?? cachedUserId;
    if (!userId) return;
    setLoading(true);

    // Pas de session active ou hors-ligne → toujours utiliser le cache
    if (!user?.id || isConnected === false) {
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
      setCatches(((data ?? []) as unknown as CatchPin[]).filter(
        (c) => typeof c.latitude === 'number' && typeof c.longitude === 'number',
      ));
      await saveCatchesCache(userId, data as never);
    } finally {
      setLoading(false);
    }
  }, [user?.id, cachedUserId, isConnected]);

  useFocusEffect(useCallback(() => { loadCatches().catch(console.warn); }, [loadCatches]));

  // ─── Zones : chargement + dessin (clic sur la carte Leaflet) ──────────────

  const refreshZones = useCallback(async () => {
    if (!myId) return;
    const loaded = await loadZones(myId);
    setZones(loaded);
    setMapSource((prev) => (prev === 'mine' || loaded.some((z) => z.id === prev) ? prev : 'mine'));
  }, [myId]);

  useFocusEffect(useCallback(() => { refreshZones().catch(console.warn); }, [refreshZones]));

  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map || !drawing) return;
    const handler = (e: any) => {
      setDraftPoints((prev) => [...prev, { latitude: e.latlng.lat, longitude: e.latlng.lng }]);
    };
    map.on('click', handler);
    return () => { map.off('click', handler); };
  }, [drawing]);

  // Prises d'une zone reçue
  useEffect(() => {
    if (!activeZone || isOwnActiveZone) { setZoneCatches([]); return; }
    let cancelled = false;
    (async () => {
      setZoneLoading(true);
      try {
        const rows = await fetchZoneCatches(activeZone.id);
        if (cancelled) return;
        setZoneCatches(rows.filter(
          (c) => typeof c.latitude === 'number' && typeof c.longitude === 'number',
        ) as unknown as CatchPin[]);
      } finally {
        if (!cancelled) setZoneLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeZone?.id, isOwnActiveZone]);

  // ─── Actions zones (web : window.confirm / clipboard) ─────────────────────

  const selectMapSource = (source: 'mine' | string) => {
    setMapSource(source);
    setOpenPanel(null);
    if (source !== 'mine') {
      const zone = zones.find((z) => z.id === source);
      if (zone && zone.polygon.length > 0 && leafletMapRef.current) {
        const L = require('leaflet');
        leafletMapRef.current.fitBounds(
          L.latLngBounds(zone.polygon.map((p) => [p.latitude, p.longitude])),
          { padding: [60, 60] },
        );
      }
    }
  };

  const startDrawing = () => {
    setOpenPanel(null);
    setDraftPoints([]);
    setDrawing(true);
  };

  const cancelDrawing = () => {
    setDrawing(false);
    setDraftPoints([]);
    setZoneName('');
    setShowNameModal(false);
  };

  const handleCreateZone = async () => {
    const name = zoneName.trim();
    if (!name || draftPoints.length < 3 || !myId || savingZone) return;
    setSavingZone(true);
    try {
      const zone = await createZone(myId, name, draftPoints);
      if (!zone) { window.alert(t('zones.offline')); return; }
      setShowNameModal(false);
      setDrawing(false);
      setDraftPoints([]);
      setZoneName('');
      await refreshZones();
      setMapSource(zone.id);
      window.alert(t('zones.created', { name: zone.name, code: zone.invite_code }));
    } finally {
      setSavingZone(false);
    }
  };

  const handleShareZone = async (zone: SharedZone) => {
    const message = t('zones.shareMessage', { name: zone.name, code: zone.invite_code });
    try {
      if (navigator.share) {
        await navigator.share({ text: message });
      } else {
        await navigator.clipboard.writeText(message);
        window.alert(message);
      }
    } catch {}
  };

  const handleDeleteZone = async (zone: SharedZone) => {
    if (!window.confirm(t('zones.deleteConfirmBody', { name: zone.name }))) return;
    const ok = await deleteZone(zone.id);
    if (!ok) { window.alert(t('zones.offline')); return; }
    if (mapSource === zone.id) setMapSource('mine');
    await refreshZones();
  };

  const handleLeaveZone = async (zone: SharedZone) => {
    if (!myId) return;
    if (!window.confirm(t('zones.leaveConfirmBody', { name: zone.name }))) return;
    const ok = await leaveZone(zone.id, myId);
    if (!ok) { window.alert(t('zones.offline')); return; }
    if (mapSource === zone.id) setMapSource('mine');
    await refreshZones();
  };

  const handleJoinZone = async () => {
    const code = joinCode.trim();
    if (!code || joining) return;
    setJoining(true);
    try {
      const result = await redeemZoneCode(code);
      if (!result.ok) {
        const msg =
          result.reason === 'invalid_code' ? t('zones.invalidCode')
          : result.reason === 'own_zone' ? t('zones.ownZone')
          : result.reason === 'offline' ? t('zones.offline')
          : t('zones.error');
        window.alert(msg);
        return;
      }
      setJoinCode('');
      await refreshZones();
      window.alert(t('zones.joined', { name: result.zoneName }));
    } finally {
      setJoining(false);
    }
  };

  // ─── Source affichée : ma carte ou une zone partagée ──────────────────────
  const baseCatches = useMemo(() => {
    if (!activeZone) return catches;
    if (isOwnActiveZone) {
      return catches.filter((c) =>
        pointInPolygon({ latitude: c.latitude, longitude: c.longitude }, activeZone.polygon),
      );
    }
    return zoneCatches;
  }, [catches, activeZone, isOwnActiveZone, zoneCatches]);

  // ─── Listes dynamiques ──────────────────────────────────────────────────────
  const speciesList = useMemo(() => Array.from(new Set(baseCatches.map((c) => c.species))).sort(), [baseCatches]);
  const lureList = useMemo(() => Array.from(new Set(baseCatches.map((c) => c.lure).filter(Boolean) as string[])).sort(), [baseCatches]);
  const weatherList = useMemo(() => Array.from(new Set(baseCatches.map((c) => c.weather_conditions).filter(Boolean) as string[])).sort(), [baseCatches]);

  // ─── Recherche de lac (dans les prises de l'utilisateur, fonctionne hors-ligne) ─
  const lakeList = useMemo(
    () => Array.from(new Set(catches.map((c) => c.lake_name?.trim()).filter(Boolean) as string[])).sort(),
    [catches],
  );

  const lakeMatches = useMemo(() => {
    const q = lakeQuery.trim().toLowerCase();
    if (!q) return lakeList.slice(0, 8);
    return lakeList.filter((l) => l.toLowerCase().includes(q)).slice(0, 8);
  }, [lakeList, lakeQuery]);

  const goToLake = useCallback((lake: string) => {
    const pins = catches.filter((c) => c.lake_name?.trim() === lake);
    if (pins.length > 0 && leafletMapRef.current) {
      const L = require('leaflet');
      leafletMapRef.current.fitBounds(
        L.latLngBounds(pins.map((p) => [p.latitude, p.longitude])),
        { padding: [60, 60] },
      );
    }
    setOpenPanel(null);
    setLakeQuery('');
  }, [catches]);

  // ─── Filtrage ───────────────────────────────────────────────────────────────
  const visibleCatches = useMemo(() => {
    let list = baseCatches;
    if (filters.species.length > 0) list = list.filter((c) => filters.species.includes(c.species));
    if (filters.lures.length > 0) list = list.filter((c) => c.lure && filters.lures.includes(c.lure));
    if (filters.dateFrom) list = list.filter((c) => c.caught_at >= filters.dateFrom! + 'T00:00:00');
    if (filters.dateTo) list = list.filter((c) => c.caught_at <= filters.dateTo! + 'T23:59:59');
    if (filters.weather.length > 0) list = list.filter((c) => c.weather_conditions && filters.weather.includes(c.weather_conditions));
    return list;
  }, [baseCatches, filters]);

  const activeCount = countActiveFilters(filters);

  const clusters = useMemo(
    () => clusterCatches(visibleCatches, mapBounds.lat, mapBounds.lng),
    [visibleCatches, mapBounds],
  );

  const handleBoundsChange = useCallback((latDelta: number, lngDelta: number) => {
    setMapBounds({ lat: latDelta, lng: lngDelta });
  }, []);

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
      items = speciesList.map((s) => ({ key: s, label: s, color: getColor(s) }));
      onToggle = (s) => setFilters((f) => ({ ...f, species: toggleItem(f.species, s) }));
      isActive = (s) => filters.species.includes(s);
    } else if (openPanel === 'lure') {
      items = lureList.length > 0
        ? lureList.map((l) => ({ key: l, label: `🪝 ${l}` }))
        : [{ key: '__empty__', label: t('map.noLures') }];
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

    if (openPanel === 'zones') {
      const myZones = zones.filter((z) => z.owner_id === myId);
      const receivedZones = zones.filter((z) => z.owner_id !== myId);
      const sectionTitle: React.CSSProperties = {
        fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)',
        textTransform: 'uppercase', letterSpacing: '0.8px', margin: '12px 0 8px',
      };
      const chipStyle = (active: boolean): React.CSSProperties => ({
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
        fontSize: 13, fontWeight: active ? 600 : 500,
        color: active ? ACCENT : 'rgba(255,255,255,0.7)',
        background: active ? 'rgba(0,230,181,0.12)' : 'rgba(255,255,255,0.06)',
        border: `1px solid ${active ? ACCENT : 'rgba(255,255,255,0.15)'}`,
      });
      const smallBtn: React.CSSProperties = {
        padding: '5px 10px', borderRadius: 14, cursor: 'pointer', fontSize: 12, fontWeight: 600,
        color: ACCENT, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.18)',
      };
      return (
        <div style={{ ...panelStyle, maxHeight: '70vh', overflowY: 'auto' }}>
          <div style={{ ...sectionTitle, marginTop: 0 }}>{t('zones.displayedMap')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button style={chipStyle(mapSource === 'mine')} onClick={() => selectMapSource('mine')}>
              🐟 {t('zones.myMap')}
            </button>
            {zones.map((z) => (
              <button key={z.id} style={chipStyle(mapSource === z.id)} onClick={() => selectMapSource(z.id)}>
                {z.owner_id === myId ? '📐' : '👥'} {z.name}
              </button>
            ))}
          </div>

          <div style={sectionTitle}>{t('zones.myZones')}</div>
          {myZones.length === 0 ? (
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>
              {t('zones.noZones')}
            </div>
          ) : (
            myZones.map((z) => (
              <div key={z.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{z.name}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>{t('zones.code', { code: z.invite_code })}</div>
                </div>
                <button style={smallBtn} onClick={() => handleShareZone(z)}>📤 {t('zones.share')}</button>
                <button style={{ ...smallBtn, color: '#E74C3C' }} onClick={() => handleDeleteZone(z)}>🗑</button>
              </div>
            ))
          )}
          <button
            style={{
              marginTop: 10, width: '100%', padding: '9px 0', borderRadius: 10, cursor: 'pointer',
              fontSize: 13, fontWeight: 600, color: ACCENT,
              background: 'rgba(0,230,181,0.10)', border: `1px solid ${ACCENT}`,
            }}
            onClick={startDrawing}
          >
            {t('zones.draw')}
          </button>

          {receivedZones.length > 0 && (
            <>
              <div style={sectionTitle}>{t('zones.received')}</div>
              {receivedZones.map((z) => (
                <div key={z.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#fff' }}>👥 {z.name}</div>
                  <button style={{ ...smallBtn, color: '#E74C3C' }} onClick={() => handleLeaveZone(z)}>
                    {t('zones.leave')}
                  </button>
                </div>
              ))}
            </>
          )}

          <div style={sectionTitle}>{t('zones.join')}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder={t('zones.codePlaceholder')}
              style={{
                flex: 1, background: 'rgba(255,255,255,0.08)', color: '#fff',
                border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8,
                padding: '8px 12px', fontSize: 13, outline: 'none',
              }}
            />
            <button
              style={{
                padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700,
                color: '#06141F', background: ACCENT, border: 'none',
                opacity: !joinCode.trim() || joining ? 0.5 : 1,
              }}
              disabled={!joinCode.trim() || joining}
              onClick={handleJoinZone}
            >
              {joining ? '…' : t('zones.joinBtn')}
            </button>
          </div>
        </div>
      );
    }

    if (openPanel === 'search') {
      return (
        <div style={panelStyle}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>
            {t('map.searchLake')}
          </div>
          <input
            type="text"
            value={lakeQuery}
            onChange={(e) => setLakeQuery(e.target.value)}
            placeholder={t('map.searchPlaceholder')}
            autoFocus
            style={{
              width: '100%', maxWidth: 320, boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.08)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8,
              padding: '8px 12px', fontSize: 13, outline: 'none', marginBottom: 10,
            }}
          />
          {lakeMatches.length === 0 ? (
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>
              {t('map.noLakeFound')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {lakeMatches.map((lake) => (
                <button
                  key={lake}
                  onClick={() => goToLake(lake)}
                  style={{
                    padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
                    fontSize: 13, fontWeight: 500,
                    color: 'rgba(255,255,255,0.7)',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.15)',
                  }}
                >
                  📍 {lake}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (openPanel === 'dates') {
      return (
        <div style={panelStyle}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>
            {t('map.dateRange')}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>{t('map.from')}</span>
              <input
                type="date"
                value={filters.dateFrom ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value || null }))}
                style={{ background: 'rgba(255,255,255,0.08)', color: filters.dateFrom ? ACCENT : 'rgba(255,255,255,0.6)', border: `1px solid ${filters.dateFrom ? ACCENT : 'rgba(255,255,255,0.2)'}`, borderRadius: 8, padding: '6px 10px', fontSize: 13, outline: 'none' }}
              />
            </label>
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 18 }}>→</span>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>{t('map.to')}</span>
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
            <MapController catches={visibleCatches} onBoundsChange={handleBoundsChange} mapRef={leafletMapRef} />

            {/* Polygone de la zone affichée */}
            {Polygon && activeZone && activeZone.polygon.length >= 3 && (
              <Polygon
                positions={activeZone.polygon.map((p) => [p.latitude, p.longitude])}
                pathOptions={{ color: ACCENT, weight: 2, fillColor: ACCENT, fillOpacity: 0.08 }}
              />
            )}

            {/* Polygone en cours de dessin */}
            {Polygon && drawing && draftPoints.length >= 2 && (
              <Polygon
                positions={draftPoints.map((p) => [p.latitude, p.longitude])}
                pathOptions={{ color: ACCENT, weight: 2, fillColor: ACCENT, fillOpacity: 0.15 }}
              />
            )}
            {CircleMarker && drawing && draftPoints.map((p, idx) => (
              <CircleMarker
                key={`draft-${idx}`}
                center={[p.latitude, p.longitude]}
                radius={6}
                pathOptions={{ color: '#fff', weight: 2, fillColor: ACCENT, fillOpacity: 1 }}
              />
            ))}

            {clusters.map((cluster) => {
              const isCluster = cluster.catches.length > 1;
              const singleCatch = cluster.catches[0];

              if (!isCluster) {
                return (
                  <Marker key={cluster.id} position={[cluster.latitude, cluster.longitude]} icon={makeIcon(getColor(singleCatch.species))}>
                    <Popup>
                      <div style={{ fontFamily: 'sans-serif', minWidth: 140 }}>
                        <strong style={{ fontSize: 14 }}>{singleCatch.species}</strong>
                        {singleCatch.lake_name && <div style={{ marginTop: 4, fontSize: 12 }}>📍 {singleCatch.lake_name}</div>}
                        {singleCatch.lure && <div style={{ fontSize: 12 }}>🪝 {singleCatch.lure}</div>}
                        {singleCatch.weight_lbs != null && <div style={{ fontSize: 12 }}>⚖️ {fmtWeight(singleCatch.weight_lbs)}</div>}
                        <div style={{ marginTop: 4, fontSize: 11, color: '#888' }}>{formatDate(singleCatch.caught_at, locale)}</div>
                        {(!activeZone || isOwnActiveZone) && (
                          <div style={{ marginTop: 6, fontSize: 12, color: '#007AFF', fontWeight: 600, cursor: 'pointer' }} onClick={() => router.push(`/catch-detail?id=${singleCatch.id}`)}>
                            {t('map.viewDetail')}
                          </div>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                );
              }

              return (
                <Marker
                  key={cluster.id}
                  position={[cluster.latitude, cluster.longitude]}
                  icon={makeClusterIcon(cluster.speciesCounts, getColor)}
                  eventHandlers={{
                    click: () => {
                      const lats = cluster.catches.map((o) => o.latitude);
                      const lngs = cluster.catches.map((o) => o.longitude);
                      const L = require('leaflet');
                      leafletMapRef.current?.fitBounds(
                        L.latLngBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]]),
                        { padding: [60, 60] },
                      );
                    },
                  }}
                />
              );
            })}
          </MapContainer>
        )}
      </div>

      {/* Barre de filtres (overlay) — masquée en mode dessin */}
      {!drawing && (
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1000 }}>
        {/* Ligne de boutons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px 0', overflowX: 'auto' }}>
          {(
            [
              { key: 'search', label: `🔍 ${t('map.searchLake')}`, active: openPanel === 'search' },
              { key: 'zones', label: `📐 ${t('zones.button')}${activeZone ? ` · ${activeZone.name}` : ''}`, active: openPanel === 'zones' || mapSource !== 'mine' },
              { key: 'species', label: `🐟 ${t('map.species')}${filters.species.length > 0 ? ` (${filters.species.length})` : ''}`, active: openPanel === 'species' || filters.species.length > 0 },
              { key: 'lure', label: `🪝 ${t('map.lure')}${filters.lures.length > 0 ? ` (${filters.lures.length})` : ''}`, active: openPanel === 'lure' || filters.lures.length > 0 },
              { key: 'dates', label: filters.dateFrom || filters.dateTo ? `📅 ${filters.dateFrom ?? '…'} → ${filters.dateTo ?? '…'}` : `📅 ${t('map.dates')}`, active: openPanel === 'dates' || !!(filters.dateFrom || filters.dateTo) },
              { key: 'weather', label: `☀️ ${t('map.weather')}${filters.weather.length > 0 ? ` (${filters.weather.length})` : ''}`, active: openPanel === 'weather' || filters.weather.length > 0 },
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
              ✕ {t('map.reset')}
            </button>
          )}
        </div>

        {/* Panneau d'options */}
        {renderPanel()}
      </div>
      )}

      {/* Bandeau zone partagée affichée */}
      {activeZone && !drawing && (
        <div style={{
          position: 'absolute', top: 52, left: 14, right: 14, zIndex: 1000,
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(6,20,37,0.92)', borderRadius: 20,
          border: '1px solid rgba(0,230,181,0.35)',
          padding: '6px 12px', fontSize: 12, fontWeight: 600, color: '#fff',
        }}>
          <span>{zoneLoading ? '⏳' : isOwnActiveZone ? '📐' : '👥'}</span>
          <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {t('zones.sharedBadge', { name: activeZone.name })}
          </span>
          <button
            onClick={() => selectMapSource('mine')}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Barre d'outils du mode dessin */}
      {drawing && (
        <div style={{
          position: 'absolute', bottom: 24, left: 16, right: 16, zIndex: 1100,
          background: 'rgba(6,20,37,0.97)', borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.12)', padding: 12,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', textAlign: 'center' }}>
            {draftPoints.length < 3 ? t('zones.drawMin') : t('zones.drawHint', { n: draftPoints.length })}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={cancelDrawing}
              style={{ flex: 1, padding: '10px 0', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.6)', background: 'none', border: '1px solid rgba(255,255,255,0.18)' }}
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => setDraftPoints((prev) => prev.slice(0, -1))}
              disabled={draftPoints.length === 0}
              style={{ width: 48, borderRadius: 10, cursor: 'pointer', fontSize: 15, color: '#fff', background: 'none', border: '1px solid rgba(255,255,255,0.18)', opacity: draftPoints.length === 0 ? 0.4 : 1 }}
            >
              ↩
            </button>
            <button
              onClick={() => setShowNameModal(true)}
              disabled={draftPoints.length < 3}
              style={{ flex: 1, padding: '10px 0', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#06141F', background: ACCENT, border: 'none', opacity: draftPoints.length < 3 ? 0.4 : 1 }}
            >
              ✓ {t('zones.finish')}
            </button>
          </div>
        </div>
      )}

      {/* Modal nom de la zone */}
      {showNameModal && (
        <div
          style={{ position: 'absolute', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setShowNameModal(false)}
        >
          <div
            style={{ width: '100%', maxWidth: 360, background: 'rgba(6,20,37,0.98)', borderRadius: 18, border: '1px solid rgba(255,255,255,0.12)', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{t('zones.nameTitle')}</div>
            <input
              type="text"
              value={zoneName}
              onChange={(e) => setZoneName(e.target.value)}
              placeholder={t('zones.namePlaceholder')}
              autoFocus
              maxLength={50}
              style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10, padding: '10px 12px', fontSize: 14, outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setShowNameModal(false)}
                style={{ flex: 1, padding: '10px 0', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.6)', background: 'none', border: '1px solid rgba(255,255,255,0.18)' }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCreateZone}
                disabled={!zoneName.trim() || savingZone}
                style={{ flex: 1, padding: '10px 0', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#06141F', background: ACCENT, border: 'none', opacity: !zoneName.trim() || savingZone ? 0.5 : 1 }}
              >
                {savingZone ? '…' : t('zones.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Compteur de résultats */}
      {activeCount > 0 && (
        <div style={{
          position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1000, background: 'rgba(6,20,37,0.9)', color: ACCENT,
          padding: '6px 14px', borderRadius: 20, border: `1px solid ${ACCENT}`,
          fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
        }}>
          {t(visibleCatches.length === 1 ? 'map.result1' : 'map.resultN', { n: visibleCatches.length })}
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
          ☁️ {t('home.localData')}
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
        {satellite ? t('map.standard') : t('map.satellite')}
      </button>

      {/* Overlay pour fermer le panneau */}
      {openPanel && (
        <div
          style={{ position: 'absolute', inset: 0, zIndex: 999 }}
          onClick={() => setOpenPanel(null)}
        />
      )}

      {/* Empty state */}
      {visibleCatches.length === 0 && !drawing && !zoneLoading && (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>
            {activeCount > 0
              ? t('map.emptyFiltered')
              : activeZone
                ? t('zones.zoneEmpty')
                : t('map.empty')}
          </Text>
          <Text style={styles.emptySubtitle}>
            {activeCount > 0 ? t('map.emptyFilteredSub') : activeZone ? '' : t('map.emptySub')}
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
