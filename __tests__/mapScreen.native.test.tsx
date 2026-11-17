// Écran de carte NATIF (app/(tabs)/map.tsx) — jamais exécuté par le scénario
// navigateur, qui utilise map.web.tsx. Le composant de carte Google
// (react-native-maps) est simulé : on vérifie ce que l'écran lui demande
// d'afficher et comment il pilote la caméra.

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import React from 'react';
import { ActivityIndicator, Text } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { server } from './helpers/fakeSupabase';

// ─── Simulations ─────────────────────────────────────────────────────────────

jest.mock('@/lib/supabase', () => require('./helpers/fakeSupabase'));

const mockAuth = {
  user: null as null | { id: string },
  cachedUserId: 'user-1' as string | null,
  session: null,
  sessionStatus: 'restoring',
};
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => mockAuth }));

// Retour sur l'onglet : useFocusEffect rejoue ses effets (comme React Navigation)
const mockFocusCallbacks = new Set<() => void>();
jest.mock('@react-navigation/native', () => {
  const ReactActual = require('react');
  return {
    useIsFocused: () => true,
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactActual.useEffect(() => {
        let cleanup = callback();
        const refocus = () => {
          if (typeof cleanup === 'function') cleanup();
          cleanup = callback();
        };
        mockFocusCallbacks.add(refocus);
        return () => {
          mockFocusCallbacks.delete(refocus);
          if (typeof cleanup === 'function') cleanup();
        };
      }, [callback]);
    },
  };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn(async () => `data:image/png;base64,${'A'.repeat(200)}`),
}));

// Carte Google simulée : enregistre les ordres de caméra et expose ses props
const mockMapApi = {
  animateToRegion: jest.fn(),
  getCamera: jest.fn(async () => ({ center: { latitude: 46.94, longitude: -71.39 } })),
};
const mockMapProps: { current: Record<string, any> } = { current: {} };
jest.mock('react-native-maps', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  const MapView = ReactActual.forwardRef((props: Record<string, any>, ref: unknown) => {
    ReactActual.useImperativeHandle(ref, () => mockMapApi);
    mockMapProps.current = props;
    ReactActual.useEffect(() => {
      props.onMapReady?.(); // la carte native signale qu'elle est prête
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return ReactActual.createElement(View, { testID: 'map-view' }, props.children);
  });
  const Marker = (props: Record<string, any>) =>
    ReactActual.createElement(
      View,
      { testID: 'map-marker', coordinate: props.coordinate, onPress: props.onPress },
      props.children,
    );
  return { __esModule: true, default: MapView, Marker, Polygon: () => null };
});

// ─── Imports testés (après les simulations) ──────────────────────────────────

import MapScreen from '@/app/(tabs)/map';
import { saveCatchesCache, type CachedCatch } from '@/lib/catchCache';
import { resetCatchStoreForTests } from '@/lib/catchStore';
import { enqueueCatch } from '@/lib/offlineQueue';
import { trySyncOfflineCatches } from '@/lib/offlineSync';
import type { CatchPayload } from '@/lib/types';

const net = NetInfo as unknown as { __setState: (s: object) => void; __reset: () => void };
const USER = 'user-1';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function cached(id: string, species: string, latitude: number, longitude: number, day: number): CachedCatch {
  return {
    id, species, latitude, longitude, lake_name: 'Lac Saint-Charles', lure: 'Rapala',
    weight_lbs: 3, length_inches: null, depth_meters: null, depth_source: null, size_category: 'medium',
    weather_conditions: 'Ensoleillé', temperature_c: 18, wind_speed_kmh: 10, wind_direction_deg: 180,
    speed_kmh: null, notes: null, caught_at: `2026-06-0${day}T12:00:00.000Z`, trip_id: null,
  };
}

function payload(latitude: number, longitude: number): CatchPayload {
  return {
    user_id: USER, map_id: null, trip_id: null, species: 'Brochet', lure: null, latitude, longitude,
    lake_name: null, depth_meters: null, depth_source: null, temperature_c: 18, wind_speed_kmh: 5,
    wind_direction_deg: 90, speed_kmh: null, weather_conditions: 'Ensoleillé', size_category: 'medium',
    weight_lbs: null, length_inches: null, notes: null, caught_at: new Date().toISOString(), local_id: null,
  };
}

/** Laisse s'exécuter la lecture locale et les mises à jour React. */
async function flush(ms = 30) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

/** Zoom maximal : chaque prise a son propre marqueur (pas de regroupement). */
async function zoomIn() {
  await act(async () => {
    mockMapProps.current.onRegionChangeComplete?.({
      latitude: 46.94, longitude: -71.39, latitudeDelta: 0.001, longitudeDelta: 0.001,
    });
  });
}

const markers = (r: ReactTestRenderer) => r.root.findAll((n) => n.props.testID === 'map-marker' && typeof n.type !== 'string' && n.props.coordinate != null);
const markerAt = (r: ReactTestRenderer, lat: number) =>
  markers(r).find((m) => Math.abs(m.props.coordinate.latitude - lat) < 1e-9);
const texts = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map((t) => ([] as unknown[]).concat(t.props.children).join('')).join(' | ');

let renderer: ReactTestRenderer | null = null;

beforeEach(async () => {
  await AsyncStorage.clear();
  server.reset();
  net.__reset();
  resetCatchStoreForTests();
  mockFocusCallbacks.clear();
  mockMapApi.animateToRegion.mockClear();
  mockPush.mockClear();
  Object.assign(mockAuth, { user: null, cachedUserId: USER, session: null, sessionStatus: 'restoring' });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);

  // Données présentes sur l'appareil : 3 prises du cache + 1 prise en attente
  await saveCatchesCache(USER, [
    cached('aaaaaaaa-0000-4000-8000-000000000001', 'Doré jaune', 46.9412, -71.3871, 1),
    cached('aaaaaaaa-0000-4000-8000-000000000002', 'Brochet', 46.9437, -71.3902, 2),
    cached('aaaaaaaa-0000-4000-8000-000000000003', 'Truite mouchetée', 46.9571, -71.2853, 3),
  ]);
  await enqueueCatch({ payload: payload(46.9425, -71.3885) });
});

afterEach(async () => {
  if (renderer) await act(async () => { renderer?.unmount(); });
  renderer = null;
  jest.restoreAllMocks();
});

async function renderMap() {
  await act(async () => { renderer = TestRenderer.create(<MapScreen />); });
  await flush();
  return renderer as unknown as ReactTestRenderer;
}

describe('carte native : démarrage hors-ligne', () => {
  beforeEach(() => net.__setState({ isConnected: false, isInternetReachable: false }));

  it('affiche un marqueur par prise — cache ET prise en attente — sans aucune requête', async () => {
    const r = await renderMap();
    await zoomIn();

    expect(markers(r)).toHaveLength(4);
    expect(markerAt(r, 46.9425)).toBeDefined(); // la prise en attente
    expect(server.log).toEqual([]); // rien n'a été demandé au serveur
  });

  it('regroupe les prises proches au dézoom (un seul marqueur pour 4 prises)', async () => {
    const r = await renderMap();
    expect(markers(r)).toHaveLength(1); // vue initiale large : groupe unique
  });

  it('cadre la caméra une seule fois, sur toutes les prises', async () => {
    const r = await renderMap();
    await flush(400); // le cadrage initial attend 300 ms

    expect(mockMapApi.animateToRegion).toHaveBeenCalledTimes(1);
    const [region] = mockMapApi.animateToRegion.mock.calls[0];
    for (const lat of [46.9412, 46.9425, 46.9437, 46.9571]) {
      expect(Math.abs(lat - region.latitude)).toBeLessThanOrEqual(region.latitudeDelta / 2);
    }
    for (const lng of [-71.3871, -71.3885, -71.3902, -71.2853]) {
      expect(Math.abs(lng - region.longitude)).toBeLessThanOrEqual(region.longitudeDelta / 2);
    }
    expect(r.root.findAll((n) => n.type === ActivityIndicator)).toHaveLength(0); // aucun chargement bloqué
  });

  it('revenir sur l\'onglet ne déplace plus la caméra ; le bouton « tout voir » recadre', async () => {
    const r = await renderMap();
    await flush(400);
    expect(mockMapApi.animateToRegion).toHaveBeenCalledTimes(1);

    await act(async () => { mockFocusCallbacks.forEach((refocus) => refocus()); });
    await flush(400);
    expect(mockMapApi.animateToRegion).toHaveBeenCalledTimes(1);

    const fitAll = r.root.find((n) => n.props.accessibilityLabel === 'map.fitAll' && typeof n.props.onPress === 'function');
    await act(async () => { fitAll.props.onPress(); });
    expect(mockMapApi.animateToRegion).toHaveBeenCalledTimes(2);
  });

  it('toucher la prise en attente affiche sa fiche, marquée « en attente »', async () => {
    const r = await renderMap();
    await zoomIn();

    const pending = markerAt(r, 46.9425);
    await act(async () => { pending?.props.onPress({ stopPropagation: () => undefined }); });

    expect(texts(r)).toContain('Brochet');
    expect(texts(r)).toContain('sync.pendingBadge');
  });

  it('une prise enregistrée pendant que la carte est ouverte apparaît aussitôt', async () => {
    const r = await renderMap();
    await zoomIn();
    expect(markers(r)).toHaveLength(4);

    await act(async () => { await enqueueCatch({ payload: payload(46.9500, -71.3500) }); });
    await flush();

    expect(markers(r)).toHaveLength(5);
    expect(markerAt(r, 46.95)).toBeDefined();
  });
});

describe('carte native : retour du réseau', () => {
  it('après la synchronisation, la prise garde son marqueur et n\'est plus « en attente »', async () => {
    Object.assign(mockAuth, { user: { id: USER }, sessionStatus: 'active' });
    // En ligne, l'écran se met à jour depuis le serveur : il contient les 3 prises déjà synchronisées
    server.rows('catches').push(
      { ...cached('aaaaaaaa-0000-4000-8000-000000000001', 'Doré jaune', 46.9412, -71.3871, 1), user_id: USER },
      { ...cached('aaaaaaaa-0000-4000-8000-000000000002', 'Brochet', 46.9437, -71.3902, 2), user_id: USER },
      { ...cached('aaaaaaaa-0000-4000-8000-000000000003', 'Truite mouchetée', 46.9571, -71.2853, 3), user_id: USER },
    );
    const r = await renderMap();
    await zoomIn();
    expect(markers(r)).toHaveLength(4);

    await act(async () => { await trySyncOfflineCatches(USER); });
    await flush();

    expect(server.rows('catches')).toHaveLength(4);
    expect(markers(r)).toHaveLength(4); // ni doublon ni disparition
    const synced = markerAt(r, 46.9425);
    await act(async () => { synced?.props.onPress({ stopPropagation: () => undefined }); });
    expect(texts(r)).toContain('Brochet');
    expect(texts(r)).not.toContain('sync.pendingBadge');
  });
});
