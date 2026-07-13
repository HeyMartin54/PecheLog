import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, Polygon, Region } from 'react-native-maps';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useMarkerIcons, CLUSTER_ANCHOR, type MarkerSpec } from '@/components/MarkerIconFactory';
import { useNetworkStatus } from '@/lib/hooks/useNetworkStatus';
import { useSpeciesColors } from '@/lib/hooks/useSpeciesColors';
import { supabase } from '@/lib/supabase';
import { CATCH_SELECT_ALL, loadCatchesCache, saveCatchesCache } from '@/lib/catchCache';
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_QUICK_ZONE_RADIUS_IDX,
  QUICK_ZONE_RADII,
  createZone,
  deleteZone,
  fetchZoneCatches,
  formatRadius,
  leaveZone,
  loadZones,
  makeCirclePolygon,
  pointInPolygon,
  redeemZoneCode,
  type SharedZone,
  type ZonePoint,
} from '@/lib/zones';
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

type FilterPanel = 'search' | 'zones' | 'species' | 'lure' | 'dates' | 'weather' | null;

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


function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}


function computeRegion(pins: { latitude: number; longitude: number }[]): Region | null {
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

function formatShortDate(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
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

// ─── Marqueur auto-traqué ──────────────────────────────────────────────────────
// Sur Android, react-native-maps capture la vue custom d'un marqueur dans un bitmap.
// Avec tracksViewChanges=false dès le départ, la capture a lieu AVANT que la vue ait
// sa taille finale → marqueur rogné (typiquement à droite/en bas) ou invisible.
// Ici chaque marqueur traque ses changements le temps d'être peint à la bonne taille,
// puis fige (tracksViewChanges=false) pour éviter la re-capture continue (fuite mémoire
// / ANR / OOM au zoom). Le remount (changement de key au reclustering) relance la traque.
function TrackedMarker({ children, ...props }: ComponentProps<typeof Marker>) {
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTracks(false), 800);
    return () => clearTimeout(t);
  }, []);
  return (
    <Marker {...props} tracksViewChanges={tracks}>
      {children}
    </Marker>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function MapScreen() {
  const router = useRouter();
  const { user, cachedUserId } = useAuth();
  const { t, locale, fmtWeight } = useSettings();
  const isConnected = useNetworkStatus();
  const insets = useSafeAreaInsets();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // Dernière région affichée — sert de centre au mode « Zone rapide »
  const lastRegionRef = useRef<Region | null>(null);

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
  const [lakeQuery, setLakeQuery] = useState('');

  // ─── Zones partagées ───────────────────────────────────────────────────────
  const [zones, setZones] = useState<SharedZone[]>([]);
  const [mapSource, setMapSource] = useState<'mine' | string>('mine'); // 'mine' ou zoneId
  const [zoneCatches, setZoneCatches] = useState<CatchPin[]>([]);
  const [zoneLoading, setZoneLoading] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [drawMode, setDrawMode] = useState<'points' | 'circle'>('points');
  const [circleCenter, setCircleCenter] = useState<ZonePoint | null>(null);
  const [circleRadiusIdx, setCircleRadiusIdx] = useState(DEFAULT_QUICK_ZONE_RADIUS_IDX);
  const [draftPoints, setDraftPoints] = useState<ZonePoint[]>([]);
  // Sauvegarde du tracé manuel pendant un passage en mode cercle (bascule non destructive)
  const manualPointsRef = useRef<ZonePoint[]>([]);
  const [showNameModal, setShowNameModal] = useState(false);
  const [zoneName, setZoneName] = useState('');
  const [savingZone, setSavingZone] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

  const myId = user?.id ?? cachedUserId;
  const activeZone = mapSource !== 'mine' ? zones.find((z) => z.id === mapSource) ?? null : null;
  const isOwnActiveZone = activeZone != null && activeZone.owner_id === myId;

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

      const valid = ((data ?? []) as unknown as CatchPin[]).filter(
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

  // ─── Chargement des zones ──────────────────────────────────────────────────

  const refreshZones = useCallback(async () => {
    if (!myId) return;
    const loaded = await loadZones(myId);
    setZones(loaded);
    // La zone affichée a pu être supprimée / quittée → retour à ma carte
    setMapSource((prev) => (prev === 'mine' || loaded.some((z) => z.id === prev) ? prev : 'mine'));
  }, [myId]);

  useFocusEffect(useCallback(() => { refreshZones().catch(console.warn); }, [refreshZones]));

  // Charge les prises d'une zone reçue quand elle devient la source affichée
  useEffect(() => {
    if (!activeZone || isOwnActiveZone) { setZoneCatches([]); return; }
    let cancelled = false;
    (async () => {
      setZoneLoading(true);
      try {
        const rows = await fetchZoneCatches(activeZone.id);
        if (cancelled) return;
        const valid = rows.filter(
          (c) => typeof c.latitude === 'number' && typeof c.longitude === 'number',
        ) as unknown as CatchPin[];
        setZoneCatches(valid);
      } finally {
        if (!cancelled) setZoneLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeZone?.id, isOwnActiveZone]);

  // ─── Actions zones ─────────────────────────────────────────────────────────

  const selectMapSource = (source: 'mine' | string) => {
    setMapSource(source);
    setSelectedCatch(null);
    setOpenPanel(null);
    if (source !== 'mine') {
      const zone = zones.find((z) => z.id === source);
      if (zone && zone.polygon.length > 0) {
        const region = computeRegion(zone.polygon);
        if (region) mapRef.current?.animateToRegion(region, 600);
      }
    }
  };

  const startDrawing = () => {
    setOpenPanel(null);
    setSelectedCatch(null);
    setDraftPoints([]);
    manualPointsRef.current = [];
    setDrawMode('points');
    setCircleCenter(null);
    setDrawing(true);
  };

  /** Centre actuel de la vue — getCamera est fiable même avant le premier
   *  onRegionChangeComplete (carte encore en cours d'animation). */
  const resolveMapCenter = async (): Promise<ZonePoint> => {
    try {
      const cam = await mapRef.current?.getCamera();
      if (cam?.center?.latitude != null && cam?.center?.longitude != null) {
        return { latitude: cam.center.latitude, longitude: cam.center.longitude };
      }
    } catch {}
    const r = lastRegionRef.current;
    return r ? { latitude: r.latitude, longitude: r.longitude } : DEFAULT_MAP_CENTER;
  };

  // Zone rapide : cercle ajustable centré sur la vue actuelle de la carte
  const startQuickZone = async () => {
    setOpenPanel(null);
    setSelectedCatch(null);
    manualPointsRef.current = [];
    const center = await resolveMapCenter();
    setDrawMode('circle');
    moveCircle(center, circleRadiusIdx);
    setDrawing(true);
  };

  const moveCircle = (center: ZonePoint, radiusIdx: number) => {
    setCircleCenter(center);
    setCircleRadiusIdx(radiusIdx);
    setDraftPoints(makeCirclePolygon(center, QUICK_ZONE_RADII[radiusIdx]));
  };

  // Bascule non destructive : le tracé manuel est sauvegardé puis restauré
  const switchToCircleMode = async () => {
    if (drawMode === 'circle') return;
    manualPointsRef.current = draftPoints;
    const center = circleCenter ?? (await resolveMapCenter());
    setDrawMode('circle');
    moveCircle(center, circleRadiusIdx);
  };

  const switchToPointsMode = () => {
    if (drawMode === 'points') return;
    setDrawMode('points');
    setDraftPoints(manualPointsRef.current);
  };

  const cancelDrawing = () => {
    setDrawing(false);
    setDraftPoints([]);
    manualPointsRef.current = [];
    setCircleCenter(null);
    setZoneName('');
    setShowNameModal(false);
  };

  const handleCreateZone = async () => {
    const name = zoneName.trim();
    if (!name || draftPoints.length < 3 || !myId || savingZone) return;
    setSavingZone(true);
    try {
      const zone = await createZone(myId, name, draftPoints);
      if (!zone) {
        Alert.alert(t('common.error'), t('zones.offline'));
        return;
      }
      setShowNameModal(false);
      setDrawing(false);
      setDraftPoints([]);
      setCircleCenter(null);
      setZoneName('');
      await refreshZones();
      setMapSource(zone.id);
      Alert.alert(t('zones.nameTitle'), t('zones.created', { name: zone.name, code: zone.invite_code }));
    } finally {
      setSavingZone(false);
    }
  };

  const handleShareZone = async (zone: SharedZone) => {
    try {
      await Share.share({
        message: t('zones.shareMessage', { name: zone.name, code: zone.invite_code }),
      });
    } catch {}
  };

  const handleDeleteZone = (zone: SharedZone) => {
    Alert.alert(
      t('zones.deleteConfirmTitle'),
      t('zones.deleteConfirmBody', { name: zone.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            const ok = await deleteZone(zone.id);
            if (!ok) { Alert.alert(t('common.error'), t('zones.offline')); return; }
            if (mapSource === zone.id) setMapSource('mine');
            await refreshZones();
          },
        },
      ],
    );
  };

  const handleLeaveZone = (zone: SharedZone) => {
    if (!myId) return;
    Alert.alert(
      t('zones.leaveConfirmTitle'),
      t('zones.leaveConfirmBody', { name: zone.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('zones.leave'),
          style: 'destructive',
          onPress: async () => {
            const ok = await leaveZone(zone.id, myId);
            if (!ok) { Alert.alert(t('common.error'), t('zones.offline')); return; }
            if (mapSource === zone.id) setMapSource('mine');
            await refreshZones();
          },
        },
      ],
    );
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
        Alert.alert(t('common.error'), msg);
        return;
      }
      setJoinCode('');
      await refreshZones();
      Alert.alert(t('zones.panelTitle'), t('zones.joined', { name: result.zoneName }));
    } finally {
      setJoining(false);
    }
  };

  // ─── Source affichée : ma carte ou une zone partagée ──────────────────────

  const baseCatches = useMemo(() => {
    if (!activeZone) return catches;
    if (isOwnActiveZone) {
      // Ma propre zone : filtrage local (fonctionne hors-ligne)
      return catches.filter((c) =>
        pointInPolygon({ latitude: c.latitude, longitude: c.longitude }, activeZone.polygon),
      );
    }
    return zoneCatches;
  }, [catches, activeZone, isOwnActiveZone, zoneCatches]);

  // ─── Listes dynamiques pour les filtres ────────────────────────────────────

  const lureList = useMemo(
    () => Array.from(new Set(baseCatches.map((c) => c.lure).filter(Boolean) as string[])).sort(),
    [baseCatches],
  );

  const weatherList = useMemo(
    () => Array.from(new Set(baseCatches.map((c) => c.weather_conditions).filter(Boolean) as string[])).sort(),
    [baseCatches],
  );

  const speciesList = useMemo(
    () => Array.from(new Set(baseCatches.map((c) => c.species))).sort(),
    [baseCatches],
  );

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
    const region = computeRegion(pins);
    if (region) mapRef.current?.animateToRegion(region, 600);
    setOpenPanel(null);
    setLakeQuery('');
  }, [catches]);

  // ─── Filtrage ──────────────────────────────────────────────────────────────

  const visibleCatches = useMemo(() => {
    let list = baseCatches;
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
  }, [baseCatches, filters]);

  const activeCount = countActiveFilters(filters);

  const clusters = useMemo(
    () => clusterCatches(visibleCatches, mapDeltas.lat, mapDeltas.lng),
    [visibleCatches, mapDeltas],
  );

  // ─── Icônes de marqueurs (PNG générés hors-écran) ──────────────────────────
  // Calcule la signature d'un cluster/pin de façon cohérente avec MarkerIconFactory.
  const clusterSpec = useCallback(
    (cluster: Cluster): MarkerSpec => {
      if (cluster.catches.length <= 1) {
        const color = getColor(cluster.catches[0].species);
        return { kind: 'pin', sig: `p:${color}`, color };
      }
      const sorted = Object.entries(cluster.speciesCounts).sort((a, b) => b[1] - a[1]);
      const color1 = getColor(sorted[0][0]);
      const multi = sorted.length > 1;
      const color2 = multi ? getColor(sorted[1][0]) : color1;
      const total = cluster.catches.length;
      const n1 = sorted[0][1];
      const n2 = total - n1;
      const label = total > 99 ? '99+' : String(total);
      return {
        kind: 'cluster',
        sig: `c:${color1}:${multi ? color2 : ''}:${label}:${n1}:${n2}`,
        color1,
        color2,
        multi,
        label,
        big: total > 99,
        n1,
        n2,
      };
    },
    [getColor],
  );

  const markerSpecs = useMemo<MarkerSpec[]>(() => {
    const seen = new Set<string>();
    const list: MarkerSpec[] = [];
    for (const c of clusters) {
      // Seuls les clusters utilisent une image ; les prises uniques restent en épingle custom.
      if (c.catches.length <= 1) continue;
      const spec = clusterSpec(c);
      if (!seen.has(spec.sig)) {
        seen.add(spec.sig);
        list.push(spec);
      }
    }
    return list;
  }, [clusters, clusterSpec]);

  const { icons: markerIcons, renderer: markerIconRenderer } = useMarkerIcons(markerSpecs);

  // ─── Panneau de filtre ─────────────────────────────────────────────────────

  const FilterPanelContent = () => {
    if (openPanel === 'search') {
      return (
        <View style={styles.panelSection}>
          <Text style={styles.panelTitle}>{t('map.searchLake')}</Text>
          <View style={styles.searchInputRow}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={lakeQuery}
              onChangeText={setLakeQuery}
              placeholder={t('map.searchPlaceholder')}
              placeholderTextColor={colors.textSubtle}
              autoFocus
              autoCorrect={false}
            />
            {lakeQuery.length > 0 && (
              <TouchableOpacity onPress={() => setLakeQuery('')} activeOpacity={0.7}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          {lakeMatches.length === 0 ? (
            <Text style={styles.panelEmpty}>{t('map.noLakeFound')}</Text>
          ) : (
            <View style={styles.panelChips}>
              {lakeMatches.map((lake) => (
                <TouchableOpacity
                  key={lake}
                  style={styles.pChip}
                  onPress={() => goToLake(lake)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.pChipText}>📍 {lake}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      );
    }

    if (openPanel === 'zones') {
      const myZones = zones.filter((z) => z.owner_id === myId);
      const receivedZones = zones.filter((z) => z.owner_id !== myId);
      return (
        <View style={styles.panelSection}>
          <Text style={styles.panelTitle}>{t('zones.displayedMap')}</Text>
          <View style={styles.panelChips}>
            <TouchableOpacity
              style={[styles.pChip, mapSource === 'mine' && styles.pChipActive]}
              onPress={() => selectMapSource('mine')}
              activeOpacity={0.8}
            >
              <Text style={[styles.pChipText, mapSource === 'mine' && styles.pChipTextActive]}>
                🐟 {t('zones.myMap')}
              </Text>
            </TouchableOpacity>
            {zones.map((z) => {
              const active = mapSource === z.id;
              const mine = z.owner_id === myId;
              return (
                <TouchableOpacity
                  key={z.id}
                  style={[styles.pChip, active && styles.pChipActive]}
                  onPress={() => selectMapSource(z.id)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.pChipText, active && styles.pChipTextActive]}>
                    {mine ? '📐' : '👥'} {z.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.panelTitle, { marginTop: 14 }]}>{t('zones.myZones')}</Text>
          {myZones.length === 0 ? (
            <Text style={styles.panelEmpty}>{t('zones.noZones')}</Text>
          ) : (
            myZones.map((z) => (
              <View key={z.id} style={styles.zoneRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.zoneName} numberOfLines={1}>{z.name}</Text>
                  <Text style={styles.zoneCode}>{t('zones.code', { code: z.invite_code })}</Text>
                </View>
                <TouchableOpacity style={styles.zoneActionBtn} onPress={() => handleShareZone(z)} activeOpacity={0.8}>
                  <Ionicons name="share-social-outline" size={15} color={ACCENT} />
                  <Text style={styles.zoneActionText}>{t('zones.share')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.zoneDeleteBtn} onPress={() => handleDeleteZone(z)} activeOpacity={0.8} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Ionicons name="trash-outline" size={15} color="#E74C3C" />
                </TouchableOpacity>
              </View>
            ))
          )}
          <View style={styles.drawButtonsPair}>
            <TouchableOpacity style={[styles.drawZoneBtn, { flex: 1 }]} onPress={startQuickZone} activeOpacity={0.85}>
              <Text style={styles.drawZoneBtnText}>{t('zones.quickZone')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.drawZoneBtn, { flex: 1 }]} onPress={startDrawing} activeOpacity={0.85}>
              <Text style={styles.drawZoneBtnText}>{t('zones.draw')}</Text>
            </TouchableOpacity>
          </View>

          {receivedZones.length > 0 && (
            <>
              <Text style={[styles.panelTitle, { marginTop: 14 }]}>{t('zones.received')}</Text>
              {receivedZones.map((z) => (
                <View key={z.id} style={styles.zoneRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.zoneName} numberOfLines={1}>👥 {z.name}</Text>
                  </View>
                  <TouchableOpacity style={styles.zoneActionBtn} onPress={() => handleLeaveZone(z)} activeOpacity={0.8}>
                    <Ionicons name="exit-outline" size={15} color="#E74C3C" />
                    <Text style={[styles.zoneActionText, { color: '#E74C3C' }]}>{t('zones.leave')}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </>
          )}

          <Text style={[styles.panelTitle, { marginTop: 14 }]}>{t('zones.join')}</Text>
          <View style={styles.joinRow}>
            <TextInput
              style={styles.joinInput}
              value={joinCode}
              onChangeText={setJoinCode}
              placeholder={t('zones.codePlaceholder')}
              placeholderTextColor={colors.textSubtle}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.joinBtn, (!joinCode.trim() || joining) && { opacity: 0.5 }]}
              onPress={handleJoinZone}
              disabled={!joinCode.trim() || joining}
              activeOpacity={0.85}
            >
              {joining ? (
                <ActivityIndicator size="small" color={colors.bg} />
              ) : (
                <Text style={styles.joinBtnText}>{t('zones.joinBtn')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    if (openPanel === 'species') {
      return (
        <View style={styles.panelSection}>
          <Text style={styles.panelTitle}>{t('map.species')}</Text>
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
          <Text style={styles.panelTitle}>{t('map.lure')}</Text>
          {lureList.length === 0 ? (
            <Text style={styles.panelEmpty}>{t('map.noLures')}</Text>
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
          <Text style={styles.panelTitle}>{t('map.dateRange')}</Text>
          <View style={styles.dateRow}>
            <TouchableOpacity
              style={[styles.dateBtn, filters.dateFrom && styles.dateBtnActive]}
              onPress={() => setShowDatePicker('from')}
              activeOpacity={0.8}
            >
              <Text style={styles.dateBtnLabel}>{t('map.from')}</Text>
              <Text style={[styles.dateBtnValue, filters.dateFrom && styles.dateBtnValueActive]}>
                {filters.dateFrom ? formatShortDate(filters.dateFrom, locale) : t('map.start')}
              </Text>
            </TouchableOpacity>
            <Text style={styles.dateSep}>→</Text>
            <TouchableOpacity
              style={[styles.dateBtn, filters.dateTo && styles.dateBtnActive]}
              onPress={() => setShowDatePicker('to')}
              activeOpacity={0.8}
            >
              <Text style={styles.dateBtnLabel}>{t('map.to')}</Text>
              <Text style={[styles.dateBtnValue, filters.dateTo && styles.dateBtnValueActive]}>
                {filters.dateTo ? formatShortDate(filters.dateTo, locale) : t('map.end')}
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
          <Text style={styles.panelTitle}>{t('map.weather')}</Text>
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
        onPress={(e) => {
          if (drawing) {
            const { latitude, longitude } = e.nativeEvent.coordinate;
            if (drawMode === 'circle') {
              // Zone rapide : toucher la carte déplace le cercle
              moveCircle({ latitude, longitude }, circleRadiusIdx);
            } else {
              setDraftPoints((prev) => [...prev, { latitude, longitude }]);
            }
          } else {
            setSelectedCatch(null);
          }
        }}
        onRegionChangeComplete={(r) => {
          lastRegionRef.current = r;
          setMapDeltas({ lat: r.latitudeDelta, lng: r.longitudeDelta });
        }}
      >
        {/* Polygone de la zone affichée */}
        {activeZone && activeZone.polygon.length >= 3 && (
          <Polygon
            coordinates={activeZone.polygon}
            strokeColor={ACCENT}
            strokeWidth={2}
            fillColor="rgba(0,230,181,0.08)"
          />
        )}

        {/* Polygone en cours de dessin */}
        {drawing && draftPoints.length >= 2 && (
          <Polygon
            coordinates={draftPoints}
            strokeColor={ACCENT}
            strokeWidth={2}
            fillColor="rgba(0,230,181,0.15)"
          />
        )}
        {/* Mode points : sommets déplaçables par glisser */}
        {drawing && drawMode === 'points' && draftPoints.map((p, idx) => (
          <TrackedMarker
            key={`draft-${idx}`}
            coordinate={p}
            anchor={{ x: 0.5, y: 0.5 }}
            draggable
            onDragEnd={(e) => {
              const { latitude, longitude } = e.nativeEvent.coordinate;
              setDraftPoints((prev) => prev.map((pt, i) => (i === idx ? { latitude, longitude } : pt)));
            }}
          >
            <View style={styles.draftVertex} />
          </TrackedMarker>
        ))}
        {/* Mode cercle : centre déplaçable par glisser */}
        {drawing && drawMode === 'circle' && circleCenter && (
          <TrackedMarker
            key="circle-center"
            coordinate={circleCenter}
            anchor={{ x: 0.5, y: 0.5 }}
            draggable
            onDragEnd={(e) => {
              const { latitude, longitude } = e.nativeEvent.coordinate;
              moveCircle({ latitude, longitude }, circleRadiusIdx);
            }}
          >
            {/* Vues simples uniquement (pas de glyphe de police) : la capture bitmap
                Android rogne les vues custom complexes — cf. mémoire projet marqueurs */}
            <View style={styles.circleCenterMarker}>
              <View style={styles.circleCenterDot} />
            </View>
          </TrackedMarker>
        )}
        {clusters.map((cluster) => {
          const isCluster = cluster.catches.length > 1;

          // ── Prise unique : épingle custom d'origine (fiable, fonctionnait bien) ──
          if (!isCluster) {
            const singleCatch = cluster.catches[0];
            return (
              <TrackedMarker
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
              </TrackedMarker>
            );
          }

          // ── Cluster : marqueur image PNG (généré hors-écran) ──
          const spec = clusterSpec(cluster);
          const uri = markerIcons[spec.sig];
          const clusterColor = spec.kind === 'cluster' ? spec.color1 : '#888';
          const zoomToCluster = (e: { stopPropagation: () => void }) => {
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
          };

          // Tant que l'image n'est pas prête (ou si la capture échoue durablement) :
          // épingle custom colorée — fiable et JAMAIS rouge (contrairement au pinColor natif).
          if (!uri) {
            return (
              <TrackedMarker
                key={`${cluster.id}:ph`}
                coordinate={{ latitude: cluster.latitude, longitude: cluster.longitude }}
                anchor={{ x: 0.5, y: 1 }}
                onPress={zoomToCluster}
              >
                <View style={styles.pinContainer}>
                  <View style={[styles.pinShape, { backgroundColor: clusterColor }]}>
                    <View style={styles.pinDot} />
                  </View>
                </View>
              </TrackedMarker>
            );
          }

          return (
            <Marker
              key={`${cluster.id}:img`}
              coordinate={{ latitude: cluster.latitude, longitude: cluster.longitude }}
              anchor={CLUSTER_ANCHOR}
              tracksViewChanges={false}
              onPress={zoomToCluster}
              image={{ uri }}
            />
          );
        })}
      </MapView>

      {/* Fabrique d'icônes : vues de capture cachées hors-écran (génèrent les PNG). */}
      {markerIconRenderer}

      {/* Callout personnalisé (fonctionne sur Android + iOS).
          Zone reçue : pas de navigation vers le détail (prise d'un autre utilisateur). */}
      {selectedCatch && (
        <TouchableOpacity
          style={styles.customCallout}
          onPress={() => {
            if (activeZone && !isOwnActiveZone) return;
            setSelectedCatch(null);
            router.push(`/catch-detail?id=${selectedCatch.id}`);
          }}
          activeOpacity={0.92}
        >
          <View style={styles.calloutInner}>
            <View style={[styles.calloutAccent, { backgroundColor: getColor(selectedCatch.species) }]} />
            <View style={styles.calloutBody}>
              <Text style={styles.calloutSpecies}>{selectedCatch.species}</Text>
              {!!selectedCatch.lake_name && <Text style={styles.calloutRow}>📍 {selectedCatch.lake_name}</Text>}
              {!!selectedCatch.lure && <Text style={styles.calloutRow}>🪝 {selectedCatch.lure}</Text>}
              {selectedCatch.weight_lbs != null && (
                <Text style={styles.calloutRow}>⚖️ {fmtWeight(selectedCatch.weight_lbs)}</Text>
              )}
              <Text style={styles.calloutDate}>{formatDate(selectedCatch.caught_at, locale)}</Text>
            </View>
            {(!activeZone || isOwnActiveZone) && (
              <View style={styles.calloutArrow}>
                <Text style={styles.calloutLink}>→</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      )}

      {/* Indicateur données locales */}
      {fromCache && (
        <View style={styles.cacheNotice}>
          <Ionicons name="cloud-offline-outline" size={12} color={colors.warning} />
          <Text style={styles.cacheNoticeText}>{t('home.localData')}</Text>
        </View>
      )}

      {/* Bouton satellite */}
      <TouchableOpacity style={styles.satelliteBtn} onPress={() => setSatellite((v) => !v)} activeOpacity={0.85}>
        <Text style={styles.satelliteBtnText}>{satellite ? t('map.standard') : t('map.satellite')}</Text>
      </TouchableOpacity>

      {/* Barre de filtres (masquée en mode dessin) */}
      {!drawing && (
      <View style={[styles.filterBar, { top: insets.top }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>

          {/* Bouton Recherche de lac */}
          <TouchableOpacity
            style={[styles.filterBtn, openPanel === 'search' && styles.filterBtnActive]}
            onPress={() => setOpenPanel((p) => p === 'search' ? null : 'search')}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterBtnText, openPanel === 'search' && styles.filterBtnTextActive]}>
              🔍 {t('map.searchLake')}
            </Text>
          </TouchableOpacity>

          {/* Bouton Zones partagées */}
          <TouchableOpacity
            style={[styles.filterBtn, (openPanel === 'zones' || mapSource !== 'mine') && styles.filterBtnActive]}
            onPress={() => setOpenPanel((p) => p === 'zones' ? null : 'zones')}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterBtnText, (openPanel === 'zones' || mapSource !== 'mine') && styles.filterBtnTextActive]}>
              📐 {t('zones.button')}{activeZone ? ` · ${activeZone.name}` : ''}
            </Text>
          </TouchableOpacity>

          {/* Bouton Espèce */}
          <TouchableOpacity
            style={[styles.filterBtn, (openPanel === 'species' || filters.species.length > 0) && styles.filterBtnActive]}
            onPress={() => setOpenPanel((p) => p === 'species' ? null : 'species')}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterBtnText, (openPanel === 'species' || filters.species.length > 0) && styles.filterBtnTextActive]}>
              🐟 {t('map.species')}{filters.species.length > 0 ? ` (${filters.species.length})` : ''}
            </Text>
          </TouchableOpacity>

          {/* Bouton Leurre */}
          <TouchableOpacity
            style={[styles.filterBtn, (openPanel === 'lure' || filters.lures.length > 0) && styles.filterBtnActive]}
            onPress={() => setOpenPanel((p) => p === 'lure' ? null : 'lure')}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterBtnText, (openPanel === 'lure' || filters.lures.length > 0) && styles.filterBtnTextActive]}>
              🪝 {t('map.lure')}{filters.lures.length > 0 ? ` (${filters.lures.length})` : ''}
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
                ? `📅 ${filters.dateFrom ? formatShortDate(filters.dateFrom, locale) : '…'} → ${filters.dateTo ? formatShortDate(filters.dateTo, locale) : '…'}`
                : `📅 ${t('map.dates')}`}
            </Text>
          </TouchableOpacity>

          {/* Bouton Météo */}
          <TouchableOpacity
            style={[styles.filterBtn, (openPanel === 'weather' || filters.weather.length > 0) && styles.filterBtnActive]}
            onPress={() => setOpenPanel((p) => p === 'weather' ? null : 'weather')}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterBtnText, (openPanel === 'weather' || filters.weather.length > 0) && styles.filterBtnTextActive]}>
              ☀️ {t('map.weather')}{filters.weather.length > 0 ? ` (${filters.weather.length})` : ''}
            </Text>
          </TouchableOpacity>

          {/* Réinitialiser */}
          {activeCount > 0 && (
            <TouchableOpacity
              style={styles.resetBtn}
              onPress={() => { setFilters(EMPTY_FILTERS); setOpenPanel(null); }}
              activeOpacity={0.8}
            >
              <Text style={styles.resetBtnText}>✕ {t('map.reset')}</Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        {/* Panneau d'options (sous la barre) */}
        {openPanel && (
          <View style={styles.panel}>
            {FilterPanelContent()}
          </View>
        )}
      </View>
      )}

      {/* Bandeau zone partagée affichée */}
      {activeZone && !drawing && (
        <View style={[styles.zoneBadge, { top: insets.top + 54 }]}>
          {zoneLoading ? (
            <ActivityIndicator size="small" color={ACCENT} />
          ) : (
            <Ionicons name={isOwnActiveZone ? 'create-outline' : 'people-outline'} size={13} color={ACCENT} />
          )}
          <Text style={styles.zoneBadgeText} numberOfLines={1}>
            {t('zones.sharedBadge', { name: activeZone.name })}
          </Text>
          <TouchableOpacity onPress={() => selectMapSource('mine')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* Barre d'outils du mode dessin */}
      {drawing && (
        <View style={[styles.drawToolbar, { bottom: 24 }]}>
          {/* Bascule Points / Cercle */}
          <View style={styles.drawModeRow}>
            <TouchableOpacity
              style={[styles.drawModeBtn, drawMode === 'points' && styles.drawModeBtnActive]}
              onPress={switchToPointsMode}
              activeOpacity={0.8}
            >
              <Text style={[styles.drawModeText, drawMode === 'points' && styles.drawModeTextActive]}>
                {t('zones.modePoints')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.drawModeBtn, drawMode === 'circle' && styles.drawModeBtnActive]}
              onPress={switchToCircleMode}
              activeOpacity={0.8}
            >
              <Text style={[styles.drawModeText, drawMode === 'circle' && styles.drawModeTextActive]}>
                {t('zones.modeCircle')}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.drawHint}>
            {drawMode === 'circle'
              ? t('zones.quickZoneHint')
              : draftPoints.length < 3
                ? t('zones.drawMin')
                : t('zones.drawHint', { n: draftPoints.length })}
          </Text>

          {/* Contrôle du rayon (mode cercle) */}
          {drawMode === 'circle' && (
            <View style={styles.radiusRow}>
              <TouchableOpacity
                style={[styles.radiusBtn, circleRadiusIdx === 0 && { opacity: 0.4 }]}
                onPress={() => { if (circleRadiusIdx > 0 && circleCenter) moveCircle(circleCenter, circleRadiusIdx - 1); }}
                disabled={circleRadiusIdx === 0}
                activeOpacity={0.8}
              >
                <Ionicons name="remove" size={18} color={colors.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.radiusLabel}>
                {t('zones.radius', { r: formatRadius(QUICK_ZONE_RADII[circleRadiusIdx]) })}
              </Text>
              <TouchableOpacity
                style={[styles.radiusBtn, circleRadiusIdx === QUICK_ZONE_RADII.length - 1 && { opacity: 0.4 }]}
                onPress={() => { if (circleRadiusIdx < QUICK_ZONE_RADII.length - 1 && circleCenter) moveCircle(circleCenter, circleRadiusIdx + 1); }}
                disabled={circleRadiusIdx === QUICK_ZONE_RADII.length - 1}
                activeOpacity={0.8}
              >
                <Ionicons name="add" size={18} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.drawButtonsRow}>
            <TouchableOpacity style={styles.drawCancelBtn} onPress={cancelDrawing} activeOpacity={0.8}>
              <Text style={styles.drawCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            {drawMode === 'points' && (
              <TouchableOpacity
                style={[styles.drawUndoBtn, draftPoints.length === 0 && { opacity: 0.4 }]}
                onPress={() => setDraftPoints((prev) => prev.slice(0, -1))}
                disabled={draftPoints.length === 0}
                activeOpacity={0.8}
              >
                <Ionicons name="arrow-undo-outline" size={15} color={colors.textPrimary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.drawFinishBtn, draftPoints.length < 3 && { opacity: 0.4 }]}
              onPress={() => setShowNameModal(true)}
              disabled={draftPoints.length < 3}
              activeOpacity={0.85}
            >
              <Text style={styles.drawFinishText}>✓ {t('zones.finish')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Modal nom de la zone */}
      <Modal visible={showNameModal} transparent animationType="fade" onRequestClose={() => setShowNameModal(false)}>
        <Pressable style={styles.nameModalOverlay} onPress={() => setShowNameModal(false)}>
          <Pressable style={styles.nameModalCard} onPress={() => {}}>
            <Text style={styles.nameModalTitle}>{t('zones.nameTitle')}</Text>
            <TextInput
              style={styles.nameModalInput}
              value={zoneName}
              onChangeText={setZoneName}
              placeholder={t('zones.namePlaceholder')}
              placeholderTextColor={colors.textSubtle}
              autoFocus
              maxLength={50}
            />
            <View style={styles.nameModalRow}>
              <TouchableOpacity style={styles.nameModalCancel} onPress={() => setShowNameModal(false)} activeOpacity={0.8}>
                <Text style={styles.drawCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.nameModalCreate, (!zoneName.trim() || savingZone) && { opacity: 0.5 }]}
                onPress={handleCreateZone}
                disabled={!zoneName.trim() || savingZone}
                activeOpacity={0.85}
              >
                {savingZone ? (
                  <ActivityIndicator size="small" color={colors.bg} />
                ) : (
                  <Text style={styles.drawFinishText}>{t('zones.create')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Compteur de résultats */}
      {activeCount > 0 && (
        <View style={styles.resultBadge}>
          <Text style={styles.resultBadgeText}>
            {t(visibleCatches.length === 1 ? 'map.result1' : 'map.resultN', { n: visibleCatches.length })}
          </Text>
        </View>
      )}

      {/* Loading */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={ACCENT} size="large" />
        </View>
      )}

      {/* Empty state */}
      {!loading && !drawing && !zoneLoading && visibleCatches.length === 0 && (
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

  // ── Épingle d'une prise unique (vue custom, comme avant le fix clusters) ──
  pinContainer: {
    width: 44, height: 44,
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
  searchInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    padding: 0,
  },

  // ── Zones partagées ──
  draftVertex: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: ACCENT,
    borderWidth: 2,
    borderColor: '#fff',
  },
  circleCenterMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: ACCENT,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleCenterDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#fff',
  },
  drawButtonsPair: {
    flexDirection: 'row',
    gap: 8,
  },
  drawModeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  drawModeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  drawModeBtnActive: {
    borderColor: ACCENT,
    backgroundColor: 'rgba(0,230,181,0.12)',
  },
  drawModeText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  drawModeTextActive: {
    color: ACCENT,
  },
  radiusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  radiusBtn: {
    width: 40,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface2,
  },
  radiusLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    minWidth: 110,
    textAlign: 'center',
  },
  zoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  zoneName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  zoneCode: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  zoneActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  zoneActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: ACCENT,
  },
  zoneDeleteBtn: {
    padding: 6,
  },
  drawZoneBtn: {
    marginTop: 10,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: ACCENT,
    backgroundColor: 'rgba(0,230,181,0.10)',
  },
  drawZoneBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: ACCENT,
  },
  joinRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  joinInput: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.textPrimary,
  },
  joinBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.bg,
  },
  zoneBadge: {
    position: 'absolute',
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: CARD_BG,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,230,181,0.35)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    zIndex: 15,
  },
  zoneBadgeText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  drawToolbar: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 10,
    zIndex: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 10,
  },
  drawHint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
  },
  drawButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  drawCancelBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  drawCancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  drawUndoBtn: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  drawFinishBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: ACCENT,
  },
  drawFinishText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.bg,
  },
  nameModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  nameModalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: CARD_BG,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 12,
  },
  nameModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  nameModalInput: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
  },
  nameModalRow: {
    flexDirection: 'row',
    gap: 8,
  },
  nameModalCancel: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  nameModalCreate: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: ACCENT,
  },
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
